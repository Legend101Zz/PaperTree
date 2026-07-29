"""``JobStore`` — every SQL statement papertree_jobs will ever run.

Same two gates as ``packages/db`` (findings.md §F), for the same reason:

  1. THE CONNECTION IS PRIVATE. ``_conn`` is not exported and there is no accessor, so no
     SQL exists outside this module and none can forget a WHERE clause.
  2. EVERY TENANT-FACING METHOD TAKES ``owner: OwnerId`` FIRST, and ``OwnerId`` is
     papertree_db's guarded-constructor class — ``OwnerId("usr_x")`` raises, so the check
     here is a real gate rather than a type annotation. It is deliberately the SAME class
     and not a second one: two spellings of "the owner" is how this repo ended up with two
     ``Highlight`` types (findings.md §G5).

  THE ONE DELIBERATE EXCEPTION is the claim path (``_claim`` and friends, all underscored
  and used only by ``runner.py``). A worker is not a tenant: it drains every tenant's
  queue, so it cannot hold an ``OwnerId``. What it gets instead is ``job.owner_id`` as a
  bare ``str``, which is worth nothing until it is passed to ``PaperTreeDb.authenticate``
  — i.e. the handler re-earns the owner against a real ``users`` row before it can touch
  any paper data. The privilege boundary is where it should be.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import fields
from datetime import UTC, datetime
from pathlib import Path
from types import TracebackType
from typing import Any, Final

import sqlite_vec  # type: ignore[import-untyped]
from papertree_db import MigrationResult, OwnerId, OwnershipError, migrate, new_id

from .model import DEFAULT_MAX_ATTEMPTS, Job, JobState, StepRecord

# The SELECT lists are DERIVED from the dataclasses, and the row mappers below splat the
# row straight in. Restating eighteen column names in three places is how a column gets
# added to the table and forgotten by the reader; here that is not expressible. The tables
# are STRICT, so SQLite hands back exactly the Python type the column declares and there is
# nothing to coerce — only the two JSON columns and the boolean flag need a transform.
_JOB_COLUMNS: Final = ", ".join(f.name for f in fields(Job))
_STEP_COLUMNS: Final = ", ".join(f.name for f in fields(StepRecord))

#: Recorded on a job whose worker died repeatedly without ever raising. There is no
#: exception to quote, so the runner never got to write one — see `_claim`.
_CRASH_LOOP_ERROR: Final = (
    "worker died without finishing the job and the retry budget is exhausted "
    "(lease expired with attempt >= max_attempts)"
)


class JobStore:
    """The durable side of the job runner. Open one per process."""

    __slots__ = ("_conn", "_migrations_dir")

    def __init__(self, filename: str | Path, migrations_dir: Path | None = None) -> None:
        conn = sqlite3.connect(str(filename), isolation_level=None)
        conn.row_factory = sqlite3.Row
        # 0001_core.sql creates a vec0 virtual table, so the migration runner this package
        # REUSES cannot apply the schema unless the extension is loaded. sqlite-vec is not
        # a new dependency: it is declared by papertree-db, which papertree-jobs requires.
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        # This store is multi-process BY DESIGN — a worker executes, the API enqueues, and
        # a third connection cancels. Without a busy timeout the second writer does not
        # wait, it raises "database is locked".
        conn.execute("PRAGMA busy_timeout = 5000")
        self._conn = conn
        self._migrations_dir = migrations_dir

    # ── lifecycle ────────────────────────────────────────────────────────────────────

    def migrate(self) -> MigrationResult:
        """Applies packages/db's migrations. F0.6 ships DDL, not a second runner."""
        return migrate(self._conn, self._migrations_dir)

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> JobStore:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    # ── tenant-facing API (owner first, always) ──────────────────────────────────────

    def enqueue(
        self,
        owner: OwnerId,
        kind: str,
        idempotency_key: str,
        payload: Any,
        *,
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
        delay_seconds: float = 0.0,
    ) -> str:
        """Creates a job, or returns the existing one for this ``idempotency_key``.

        The dedup is a UNIQUE index read inside the same IMMEDIATE transaction as the
        insert, so two concurrent enqueues of one key produce one job, not a race.
        """
        _require_owner(owner)
        now = time.time()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            existing = self._conn.execute(
                "SELECT job_id FROM jobs WHERE owner_id = ? AND kind = ? AND idempotency_key = ?",
                (owner.value, kind, idempotency_key),
            ).fetchone()
            if existing is not None:
                job_id = str(existing["job_id"])
            else:
                job_id = new_id("job")
                stamp = _iso()
                self._conn.execute(
                    f"INSERT INTO jobs ({_JOB_COLUMNS}) "
                    "VALUES (?,?,?,?,?,'pending',0,0,?,?,NULL,NULL,0,0,NULL,NULL,?,?)",
                    (
                        job_id,
                        owner.value,
                        kind,
                        idempotency_key,
                        json.dumps(payload, separators=(",", ":")),
                        max_attempts,
                        now + delay_seconds,
                        stamp,
                        stamp,
                    ),
                )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return job_id

    def get_job(self, owner: OwnerId, job_id: str) -> Job | None:
        """Readable from any process at any time — this is the progress endpoint."""
        _require_owner(owner)
        row = self._conn.execute(
            f"SELECT {_JOB_COLUMNS} FROM jobs WHERE owner_id = ? AND job_id = ?",
            (owner.value, job_id),
        ).fetchone()
        return None if row is None else _job(row)

    def list_jobs(self, owner: OwnerId) -> list[Job]:
        _require_owner(owner)
        return [
            _job(r)
            for r in self._conn.execute(
                f"SELECT {_JOB_COLUMNS} FROM jobs WHERE owner_id = ? ORDER BY created_at DESC",
                (owner.value,),
            )
        ]

    def list_steps(self, owner: OwnerId, job_id: str) -> list[StepRecord]:
        """The checkpoint ledger: which steps are done, which is running, which failed."""
        _require_owner(owner)
        return [
            _step(r)
            for r in self._conn.execute(
                f"SELECT {_STEP_COLUMNS} FROM job_steps WHERE owner_id = ? AND job_id = ? "
                "ORDER BY step_index",
                (owner.value, job_id),
            )
        ]

    def request_cancel(self, owner: OwnerId, job_id: str) -> bool:
        """Asks a job to stop. Returns False if it was already terminal (or not yours).

        A pending job is cancelled outright — no worker is involved, so there is nothing to
        wait for. A running job gets the flag, and its worker observes it at the next step
        boundary. That is the whole of "honoured within one step".
        """
        _require_owner(owner)
        cursor = self._conn.execute(
            "UPDATE jobs SET cancel_requested = 1, updated_at = ?, "
            "  state = CASE WHEN state = 'pending' THEN 'cancelled' ELSE state END "
            "WHERE owner_id = ? AND job_id = ? AND state IN ('pending', 'running')",
            (_iso(), owner.value, job_id),
        )
        return cursor.rowcount > 0

    # ── worker path (see the module docstring: a worker is not a tenant) ─────────────

    def _claim(self, worker_id: str, kinds: tuple[str, ...], lease_seconds: float) -> Job | None:
        """Takes the next due job of a registered kind, under a lease, atomically.

        Two claim sources, and the second is the restart story: a job left ``running`` by a
        SIGKILLed worker has a lease that stops being renewed, so once it expires the job
        is due again. Nothing has to notice the crash.

        BEGIN IMMEDIATE takes the write lock BEFORE the SELECT, so two workers racing on
        the same file cannot both claim the same row. Measured, not assumed: with this line
        deleted, 12 concurrent workers run ~50 of 300 jobs twice
        (``test_concurrent_workers_never_claim_the_same_job_twice``).
        """
        if not kinds:
            return None
        now = time.time()
        placeholders = ",".join("?" * len(kinds))
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            # THE RETRY BUDGET APPLIES TO CRASHES TOO. 0002_jobs.sql says incrementing
            # `attempt` on the claim is what stops "a job that reliably kills its worker
            # retrying for ever". On its own it does not: an adversarial review ran a job
            # whose step calls os._exit() and watched `attempt` reach 8 against
            # max_attempts=3, reclaimed every time, never terminal — a poison pill that
            # kills every worker in the pool in a loop. Incrementing only counts the
            # attempts; this dead-letters when the count is spent. It is done here, inside
            # the same IMMEDIATE transaction as the claim, because expiry is only ever
            # observed by a worker looking for work.
            self._conn.execute(
                f"UPDATE jobs SET state = 'dead_letter', lease_owner = NULL, "
                f"  lease_expires_at = NULL, error = COALESCE(error, ?), updated_at = ? "
                f"WHERE kind IN ({placeholders}) AND state = 'running' "
                f"  AND lease_expires_at <= ? AND attempt >= max_attempts",
                (_CRASH_LOOP_ERROR, _iso(), *kinds, now),
            )
            row = self._conn.execute(
                f"SELECT {_JOB_COLUMNS} FROM jobs WHERE kind IN ({placeholders})"
                "  AND attempt < max_attempts AND ("
                "     (state = 'pending' AND run_after <= ?)"
                "  OR (state = 'running' AND lease_expires_at <= ?)"
                ") ORDER BY run_after LIMIT 1",
                (*kinds, now, now),
            ).fetchone()
            if row is None:
                self._conn.execute("COMMIT")
                return None
            self._conn.execute(
                "UPDATE jobs SET state = 'running', attempt = attempt + 1, lease_owner = ?, "
                "lease_expires_at = ?, updated_at = ? WHERE job_id = ?",
                (worker_id, now + lease_seconds, _iso(), row["job_id"]),
            )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        claimed = self._read(str(row["job_id"]))
        assert claimed is not None
        return claimed

    def _read(self, job_id: str) -> Job | None:
        row = self._conn.execute(
            f"SELECT {_JOB_COLUMNS} FROM jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
        return None if row is None else _job(row)

    def _step_record(self, job_id: str, step_name: str) -> StepRecord | None:
        row = self._conn.execute(
            f"SELECT {_STEP_COLUMNS} FROM job_steps WHERE job_id = ? AND step_name = ?",
            (job_id, step_name),
        ).fetchone()
        return None if row is None else _step(row)

    def _begin_step(self, job: Job, step_name: str) -> None:
        self._conn.execute(
            "INSERT INTO job_steps (job_id, owner_id, step_name, step_index, state, attempt, "
            "  result, error, started_at, finished_at) "
            "VALUES (?,?,?,(SELECT count(*) FROM job_steps WHERE job_id = ?),'running',?, "
            "  NULL,NULL,?,NULL) "
            "ON CONFLICT (job_id, step_name) DO UPDATE SET state = 'running', "
            "  attempt = excluded.attempt, error = NULL, started_at = excluded.started_at, "
            "  finished_at = NULL",
            (job.job_id, job.owner_id, step_name, job.job_id, job.attempt, _iso()),
        )

    def _holds_lease(self, job_id: str, worker_id: str) -> bool:
        """Is this worker still the job's lease holder? The fencing check — see LeaseLost."""
        row = self._conn.execute(
            "SELECT 1 FROM jobs WHERE job_id = ? AND state = 'running' AND lease_owner = ?",
            (job_id, worker_id),
        ).fetchone()
        return row is not None

    def _finish_step(self, job_id: str, step_name: str, result: Any) -> None:
        """THE CHECKPOINT COMMIT. After this returns, the step will never run again."""
        self._conn.execute(
            "UPDATE job_steps SET state = 'succeeded', result = ?, error = NULL, "
            "finished_at = ? WHERE job_id = ? AND step_name = ?",
            (json.dumps(result, separators=(",", ":")), _iso(), job_id, step_name),
        )

    def _fail_step(self, job_id: str, step_name: str, error: str) -> None:
        self._conn.execute(
            "UPDATE job_steps SET state = 'failed', error = ?, finished_at = ? "
            "WHERE job_id = ? AND step_name = ?",
            (error, _iso(), job_id, step_name),
        )

    def _set_progress(
        self,
        job_id: str,
        done: int,
        total: int,
        note: str | None,
        lease_seconds: float,
        worker_id: str,
    ) -> None:
        """Progress is also the liveness signal: reporting it extends the lease.

        One mechanism, not two. A step long enough to outlive its lease is exactly a step
        with progress to report, so there is no separate heartbeat to forget to call.

        Fenced on ``lease_owner``: a worker that has already been superseded must not renew
        a lease it no longer holds, nor overwrite the new worker's progress.
        """
        self._conn.execute(
            "UPDATE jobs SET progress_done = ?, progress_total = ?, progress_note = ?, "
            "lease_expires_at = ?, updated_at = ? WHERE job_id = ? AND lease_owner = ?",
            (done, total, note, time.time() + lease_seconds, _iso(), job_id, worker_id),
        )

    def _cancel_requested(self, job_id: str) -> bool:
        row = self._conn.execute(
            "SELECT cancel_requested FROM jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
        return row is not None and bool(row["cancel_requested"])

    def _finalise(self, job_id: str, state: JobState, error: str | None, worker_id: str) -> None:
        """Fenced: only the current lease holder may move a job to a terminal state."""
        self._conn.execute(
            "UPDATE jobs SET state = ?, error = ?, lease_owner = NULL, lease_expires_at = NULL, "
            "updated_at = ? WHERE job_id = ? AND lease_owner = ?",
            (state, error, _iso(), job_id, worker_id),
        )

    def _reschedule(self, job_id: str, delay: float, error: str, worker_id: str) -> None:
        """Fenced, for the same reason as ``_finalise``."""
        self._conn.execute(
            "UPDATE jobs SET state = 'pending', run_after = ?, error = ?, lease_owner = NULL, "
            "lease_expires_at = NULL, updated_at = ? WHERE job_id = ? AND lease_owner = ?",
            (time.time() + delay, error, _iso(), job_id, worker_id),
        )


def _require_owner(owner: OwnerId) -> None:
    # papertree_db.OwnerId has a guarded constructor. `isinstance` alone is NOT enough:
    # `object.__new__(OwnerId)` bypasses `__init__` and still satisfies it. Reading `.value`
    # is the real check — it raises unless the instance carries the mint token (ids.py) —
    # so it is done HERE, at the gate, rather than incidentally at the first bind site.
    if not isinstance(owner, OwnerId):
        raise OwnershipError(
            f"{owner!r} is not an OwnerId. One is minted only by PaperTreeDb.authenticate() "
            f"/ create_user(), which require a users row."
        )
    _ = owner.value


def _iso() -> str:
    return datetime.now(UTC).isoformat()


def _job(row: sqlite3.Row) -> Job:
    data: dict[str, Any] = dict(row)
    data["payload"] = json.loads(data["payload"])
    data["cancel_requested"] = bool(data["cancel_requested"])
    return Job(**data)


def _step(row: sqlite3.Row) -> StepRecord:
    data: dict[str, Any] = dict(row)
    result = data["result"]
    data["result"] = None if result is None else json.loads(result)
    return StepRecord(**data)
