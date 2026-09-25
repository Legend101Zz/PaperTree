"""What the reader release's ingest loop (S1) needs from the runner, on top of the F0.6 spec.

- a CLASSIFIED failure (`JobFailed`): a code that survives into `jobs.error`, and a
  non-retryable one that dead-letters on the attempt that raised it;
- an OBSERVER seam: the worker's JSON log lines, and a deterministic moment between two
  steps for a test to SIGKILL a worker at;
- `list_jobs(kind=, payload=)` and `delete_job`, for "every parse of this paper";
- `release_dead_local_workers`: a restarted worker resumes a SIGKILLed worker's job NOW,
  not a lease from now. The kill is a real SIGKILL of a real process.
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import textwrap
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from papertree_db import OwnerId, PaperTreeDb, open_database
from papertree_jobs import (
    CRASH_LOOP_CODE,
    Job,
    JobContext,
    JobFailed,
    JobObserver,
    JobRunner,
    JobStore,
    coded_error,
    error_code,
    pid_is_alive,
)


@dataclass(frozen=True, slots=True)
class Env:
    db_file: Path
    store: JobStore
    owner: OwnerId
    other: OwnerId
    user_id: str
    paper_db: PaperTreeDb


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    db_file = tmp_path / "papertree.sqlite"
    paper_db = open_database(db_file)
    paper_db.migrate()
    user = paper_db.create_user("ingest@papertree.test")
    other = paper_db.create_user("other@papertree.test")
    store = JobStore(db_file)
    try:
        yield Env(
            db_file=db_file,
            store=store,
            owner=store.owner_for(user.user_id),
            other=store.owner_for(other.user_id),
            user_id=user.user_id,
            paper_db=paper_db,
        )
    finally:
        store.close()
        paper_db.close()


# ── classified failures ──────────────────────────────────────────────────────────────────────


def test_a_non_retryable_failure_dead_letters_on_the_attempt_that_raised_it(env: Env) -> None:
    """At base a garbage PDF was retried three times (~11 s of backoff) to reach the same answer.
    A `JobFailed(retryable=False)` is final at once, and its code is in the stored error."""
    calls: list[int] = []

    def handler(ctx: JobContext) -> None:
        def body() -> None:
            calls.append(ctx.attempt)
            raise JobFailed("pdf_unreadable", "FileDataError: Failed to open stream")

        ctx.step("parse", body)

    job_id = env.store.enqueue(env.owner, "parse", "k", {})
    final = JobRunner(env.store, {"parse": handler}).run_once()
    assert final is not None
    assert (final.state, final.attempt, calls) == ("dead_letter", 1, [1])
    assert final.error == "[pdf_unreadable] FileDataError: Failed to open stream"
    assert error_code(final.error) == "pdf_unreadable"
    (step,) = env.store.list_steps(env.owner, job_id)
    assert (step.state, step.error) == ("failed", final.error)


def test_a_retryable_classified_failure_is_rescheduled_and_keeps_its_code(env: Env) -> None:
    def handler(ctx: JobContext) -> None:
        raise JobFailed("internal", "the disk was full", retryable=True)

    env.store.enqueue(env.owner, "parse", "k", {})
    final = JobRunner(env.store, {"parse": handler}, backoff_base=0.01).run_once()
    assert final is not None and final.state == "pending" and final.attempt == 1
    assert error_code(final.error) == "internal"


def test_error_code_reads_only_the_coded_form() -> None:
    assert error_code(coded_error("validation_failed", "G7 at blocks[15]")) == "validation_failed"
    assert error_code("SemanticValidationError: PaperIR failed") is None  # pre-S1 text
    assert error_code(None) is None
    assert error_code("[Not A Code] x") is None
    with pytest.raises(ValueError, match="not an error code"):
        JobFailed("Bad Code", "x")


def test_the_crash_loop_dead_letter_carries_the_timeout_code(env: Env) -> None:
    """The store's own dead-letter (a lease that expired with the budget spent) is coded too."""
    job_id = env.store.enqueue(env.owner, "parse", "k", {}, max_attempts=1)
    claimed = env.store._claim("gone:1", ("parse",), lease_seconds=0.01)
    assert claimed is not None and claimed.attempt == 1
    time.sleep(0.05)
    assert env.store._claim("next:2", ("parse",), lease_seconds=10.0) is None
    dead = env.store.get_job(env.owner, job_id)
    assert dead is not None and dead.state == "dead_letter"
    assert error_code(dead.error) == CRASH_LOOP_CODE == "timeout"
    assert dead.error is not None and "retry budget is exhausted" in dead.error


# ── the observer ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Recorder(JobObserver):
    events: list[tuple[Any, ...]] = field(default_factory=list)

    def claimed(self, job: Job) -> None:
        self.events.append(("claimed", job.attempt))

    def step_started(self, job: Job, name: str) -> None:
        self.events.append(("started", name))

    def step_finished(
        self,
        job: Job,
        name: str,
        *,
        outcome: Any,
        ms: float,
        result: Any,
        error: str | None,
    ) -> None:
        assert ms >= 0
        self.events.append(("step", name, outcome, error))

    def finished(self, job: Job, *, outcome: Any) -> None:
        self.events.append(("finished", job.state, outcome))


def test_the_observer_sees_claim_steps_resume_and_outcome(env: Env) -> None:
    fail_second = {"armed": True}

    def handler(ctx: JobContext) -> None:
        ctx.step("parse", lambda: {"pages": 1})

        def persist() -> dict[str, int]:
            if fail_second["armed"]:
                fail_second["armed"] = False
                raise RuntimeError("transient")
            return {"generation": 1}

        ctx.step("persist", persist)

    env.store.enqueue(env.owner, "parse", "k", {})
    recorder = Recorder()
    runner = JobRunner(env.store, {"parse": handler}, observer=recorder, backoff_base=0.0)
    first = runner.run_once()
    assert first is not None and first.state == "pending"
    time.sleep(0.01)
    second = runner.run_once()
    assert second is not None and second.state == "succeeded"
    assert recorder.events == [
        ("claimed", 1),
        ("started", "parse"),
        ("step", "parse", "succeeded", None),
        ("started", "persist"),
        ("step", "persist", "failed", "RuntimeError: transient"),
        ("finished", "pending", "retry"),
        ("claimed", 2),
        # The committed checkpoint is NOT re-run on the second attempt: it is reported resumed.
        ("step", "parse", "resumed", None),
        ("started", "persist"),
        ("step", "persist", "succeeded", None),
        ("finished", "succeeded", "succeeded"),
    ]
    assert runner.observer_errors == 0


def test_an_observer_that_raises_cannot_fail_a_job(env: Env) -> None:
    class Broken(JobObserver):
        def claimed(self, job: Job) -> None:
            raise OSError("stdout is closed")

        def step_started(self, job: Job, name: str) -> None:
            raise OSError("stdout is closed")

        def finished(self, job: Job, *, outcome: Any) -> None:
            raise OSError("stdout is closed")

    env.store.enqueue(env.owner, "parse", "k", {})
    runner = JobRunner(
        env.store, {"parse": lambda ctx: ctx.step("parse", lambda: 1)}, observer=Broken()
    )
    final = runner.run_once()
    assert final is not None and final.state == "succeeded"
    assert runner.observer_errors == 3


# ── listing and deleting one paper's jobs ────────────────────────────────────────────────────


def test_list_jobs_filters_by_kind_and_payload_newest_first_and_owner_scoped(env: Env) -> None:
    a1 = env.store.enqueue(env.owner, "parse", "a1", {"paper_id": "ppr_A", "generation": 1})
    env.store.enqueue(env.owner, "parse", "b1", {"paper_id": "ppr_B", "generation": 1})
    a2 = env.store.enqueue(env.owner, "parse", "a2", {"paper_id": "ppr_A", "generation": 2})
    env.store.enqueue(env.owner, "other", "a3", {"paper_id": "ppr_A"})
    env.store.enqueue(env.other, "parse", "a1", {"paper_id": "ppr_A", "generation": 1})

    mine = env.store.list_jobs(env.owner, kind="parse", payload={"paper_id": "ppr_A"})
    assert [job.job_id for job in mine] == [a2, a1]
    gen2 = env.store.list_jobs(
        env.owner, kind="parse", payload={"paper_id": "ppr_A", "generation": 2}
    )
    assert [job.job_id for job in gen2] == [a2]
    assert len(env.store.list_jobs(env.owner)) == 4
    with pytest.raises(ValueError, match="not a payload key"):
        env.store.list_jobs(env.owner, payload={"paper_id') OR 1=1 --": "x"})


def test_delete_job_removes_the_job_and_its_ledger_and_only_for_its_owner(env: Env) -> None:
    job_id = env.store.enqueue(env.owner, "parse", "k", {"paper_id": "ppr_A"})
    JobRunner(env.store, {"parse": lambda ctx: ctx.step("parse", lambda: 1)}).run_once()
    assert len(env.store.list_steps(env.owner, job_id)) == 1

    assert env.store.delete_job(env.other, job_id) is False
    assert env.store.get_job(env.owner, job_id) is not None
    assert env.store.delete_job(env.owner, job_id) is True
    assert env.store.get_job(env.owner, job_id) is None
    assert env.store.list_steps(env.owner, job_id) == []


def test_a_job_deleted_while_it_runs_is_abandoned_without_a_write(env: Env) -> None:
    """DELETE /papers/{id} removes the paper's jobs; a worker mid-job must not resurrect one."""

    def handler(ctx: JobContext) -> None:
        ctx.step("parse", lambda: env.store.delete_job(env.owner, ctx.job_id))
        ctx.step("persist", lambda: pytest.fail("a deleted job ran its next step"))

    recorder = Recorder()
    env.store.enqueue(env.owner, "parse", "k", {})
    assert JobRunner(env.store, {"parse": handler}, observer=recorder).run_once() is None
    assert env.store.list_jobs(env.owner) == []
    assert recorder.events[-1] == ("finished", "running", "gone")


# ── a restarted worker resumes a dead worker's job at once ───────────────────────────────────

_HOLDER = textwrap.dedent(
    """
    import sys, time
    from pathlib import Path
    from papertree_jobs import JobRunner, JobStore

    db, marker = Path(sys.argv[1]), Path(sys.argv[2])

    def handler(ctx):
        def hang():
            marker.write_text("inside", encoding="utf-8")
            time.sleep(600)
        ctx.step("parse", hang)

    with JobStore(db) as store:
        # The DEFAULT worker id, <hostname>:<pid>: what papertree_api.worker runs with.
        runner = JobRunner(store, {"parse": handler}, lease_seconds=600.0)
        while runner.run_once() is None:
            time.sleep(0.05)
    """
)


def test_a_sigkilled_workers_job_is_claimable_at_once_not_a_lease_later(
    env: Env, tmp_path: Path
) -> None:
    job_id = env.store.enqueue(env.owner, "parse", "k", {})
    marker = tmp_path / "inside"
    holder = subprocess.Popen(
        [sys.executable, "-c", _HOLDER, str(env.db_file), str(marker)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.time() + 60
        while not marker.exists():
            assert holder.poll() is None, holder.stderr.read() if holder.stderr else ""
            assert time.time() < deadline, "the holder never entered its step"
            time.sleep(0.02)
        running = env.store.get_job(env.owner, job_id)
        assert running is not None and running.state == "running"
        assert running.lease_owner == f"{socket.gethostname()}:{holder.pid}"
        runner = JobRunner(env.store, {"parse": lambda ctx: ctx.step("parse", lambda: "done")})

        # While the holder is ALIVE its lease is left alone, and nothing is claimable.
        assert runner.release_dead_local_workers() == []
        assert runner.run_once() is None

        holder.send_signal(signal.SIGKILL)
        holder.wait(timeout=30)
        assert not pid_is_alive(holder.pid)
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait()

    # The lease has ~600 s to run. Without the release, run_once() would find nothing.
    started = time.monotonic()
    assert runner.release_dead_local_workers() == [job_id]
    final = runner.run_once()
    assert final is not None and final.state == "succeeded" and final.attempt == 2
    assert time.monotonic() - started < 10


def test_release_leaves_other_hosts_and_other_id_formats_alone(env: Env) -> None:
    dead = subprocess.Popen([sys.executable, "-c", "pass"])
    dead.wait()
    assert not pid_is_alive(dead.pid)
    ids = {}
    for owner_id in (
        f"elsewhere.example:{dead.pid}",
        f"worker:{dead.pid}",
        f"{socket.gethostname()}:x1",
    ):
        job_id = env.store.enqueue(env.owner, "parse", owner_id, {})
        claimed = env.store._claim(owner_id, ("parse",), lease_seconds=600.0)
        assert claimed is not None and claimed.job_id == job_id
        ids[owner_id] = job_id
    assert JobRunner(env.store, {}).release_dead_local_workers() == []
    for job_id in ids.values():
        job = env.store.get_job(env.owner, job_id)
        assert job is not None and job.lease_expires_at is not None
        assert job.lease_expires_at > time.time() + 500


def test_pid_is_alive_answers_for_this_process_and_a_reaped_one() -> None:
    assert pid_is_alive(os.getpid())
    gone = subprocess.Popen([sys.executable, "-c", "pass"])
    gone.wait()
    assert pid_is_alive(gone.pid) is False
