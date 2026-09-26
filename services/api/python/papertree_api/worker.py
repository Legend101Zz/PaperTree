"""`python -m papertree_api.worker` — the loop that runs the queued parse jobs.

    PAPERTREE_DATA_ROOT=~/.papertree python -m papertree_api.worker

Run it beside `python -m papertree_api`: two processes against one SQLite file is the arrangement
`packages/jobs` documents as intended (`busy_timeout`). It lives in this package rather than in
`services/document-worker` because wiring a database, a job store and the data root together is a
deployment concern, and `settings.py` is where those live; the worker package owns the PARSE and
the job's steps (`papertree_document_worker.job`).

WHAT THE LOOP DOES, AND WHAT IT NO LONGER DOES

  * It runs jobs. The job itself is `parse -> persist -> promote`, three DURABLE steps
    (contracts.md §2.2). Promotion used to happen HERE, after `run_once()` returned: a worker killed
    between the job finishing and that call left a stored, "succeeded" paper nobody could open, and
    nothing would ever retry it. It is the job's last step now, so a restart finishes it.
  * On start and whenever it is idle, it releases the leases of workers on this host that are dead
    (`JobRunner.release_dead_local_workers`), so a worker SIGKILLed between two steps is resumed at
    the next step by the next worker to run, not a full lease later.
  * It gives the promote step its validator: the STORED generation, recomposed exactly as
    `GET /papers/{id}/ir` recomposes it (`ir.paper_document`), must validate as PaperIR. Only a
    generation that does is promoted (§2.2), so a promoted generation is one the reader can load.
  * It writes contracts.md §8's JSON lines on stdout, `service: "worker"`: `job.claim`, `job.step`
    `{step, ms, parser_version, status}` and `job.done` — with the error CODE and the error TEXT.
    Before S1 a failure logged only "-> pending", and the reason lived nowhere but the jobs table.
"""

from __future__ import annotations

import json
import re
import shutil
import signal
import sys
import threading
import time
from types import FrameType
from typing import Any, Final, Literal

from papertree_db import OwnerId, OwnershipError, PaperId, PaperTreeDb, generation
from papertree_document_ir import Paper
from papertree_document_ir.validate import assert_valid_paper
from papertree_document_worker.job import (
    PARSE_KIND,
    PARSER_VERSION,
    ParseJobDeps,
    build_runner,
    payload_generation,
    staging_path,
)
from papertree_jobs import (
    Job,
    JobFailed,
    JobObserver,
    JobStore,
    RunOutcome,
    StepOutcome,
    error_code,
)

from .ir import paper_document
from .logging import user_ref
from .settings import Settings
from .wiretime import now_wire

#: How long to sleep when `run_once()` finds nothing. Short enough that an upload starts parsing
#: while the user is still looking at the page; long enough that an idle worker is not a spinloop.
IDLE_SLEEP_SECONDS = 0.5

SERVICE: Final = "worker"

#: What a worker line may carry: contracts.md §8's fields, plus the job's own. An ALLOWLIST, like
#: `papertree_api.logging.FIELDS`, and for the same reason: no email, token or key can be logged,
#: because there is no keyword to log it under. `error` is the job's stored error text, which is an
#: exception's message (a PyMuPDF or validator sentence, sometimes a local path) — the reason the
#: operator needs, and never shown to the reader (the API sends only `error_code`).
FIELDS: Final = frozenset(
    {
        "job_id",
        "paper_id",
        "user_ref",
        "worker_id",
        "step",
        "ms",
        "parser_version",
        "status",
        "outcome",
        "attempt",
        "max_attempts",
        "generation",
        "attempt_seq",
        "error_code",
        "error",
        "released",
    }
)

_PAPER_ID: Final = re.compile(r"ppr_[0-9A-HJKMNP-TV-Z]{26}")
_ERROR_TEXT_LIMIT: Final = 2000

Level = Literal["debug", "info", "warning", "error"]
LogValue = str | int | float | bool | None


def log_event(event: str, *, level: Level = "info", **fields: LogValue) -> None:
    """One JSON line on stdout. `None` values are omitted; an unknown field is a `TypeError`."""
    unknown = set(fields) - FIELDS
    if unknown:
        raise TypeError(f"log_event: fields outside the worker allowlist: {sorted(unknown)}")
    record: dict[str, LogValue] = {"ts": now_wire(), "level": level, "service": SERVICE}
    record["event"] = event
    record.update((key, value) for key, value in fields.items() if value is not None)
    sys.stdout.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def verify_stored_generation(
    database: PaperTreeDb, owner: OwnerId, paper_id: PaperId, gen: int
) -> None:
    """The promote step's check: the stored generation, recomposed as `/ir` serves it, is PaperIR.

    `Paper.model_validate` is the schema; `assert_valid_paper` is the semantic rules the parser's
    own output already passed. What this adds is the round trip through the database: a generation
    whose `Page.flows` cannot be rebuilt (#91's `ReadingOrderUnrecoverable`) or whose rows lost a
    required field fails HERE, and is never promoted, instead of 500ing in the reader.
    """
    document = paper_document(database, owner, paper_id, generation(gen))
    if document is None:
        raise LookupError(f"generation {gen} of {paper_id} is not stored")
    assert_valid_paper(Paper.model_validate(document))


def _paper_of(job: Job) -> str | None:
    paper_id = job.payload.get("paper_id") if isinstance(job.payload, dict) else None
    return paper_id if isinstance(paper_id, str) and _PAPER_ID.fullmatch(paper_id) else None


def _error_text(error: str | None) -> str | None:
    return None if error is None else error[:_ERROR_TEXT_LIMIT]


class JobLog(JobObserver):
    """contracts.md §8's worker lines, and the cleanup a job that vanished mid-run needs."""

    def __init__(self, database: PaperTreeDb, settings: Settings) -> None:
        self._database = database
        self._settings = settings
        self._claimed_at: dict[str, float] = {}

    def claimed(self, job: Job) -> None:
        self._claimed_at[job.job_id] = time.perf_counter()
        gen: int | None
        attempt_seq: int | None
        try:
            gen, attempt_seq = payload_generation(job.payload)
        except JobFailed:
            gen = attempt_seq = None
        log_event(
            "job.claim",
            job_id=job.job_id,
            paper_id=_paper_of(job),
            user_ref=user_ref(job.owner_id),
            attempt=job.attempt,
            max_attempts=job.max_attempts,
            generation=gen,
            attempt_seq=attempt_seq,
        )

    def step_finished(
        self,
        job: Job,
        name: str,
        *,
        outcome: StepOutcome,
        ms: float,
        result: Any,
        error: str | None,
    ) -> None:
        parser_version = result.get("parser_version") if isinstance(result, dict) else None
        log_event(
            "job.step",
            level="warning" if outcome == "failed" else "info",
            job_id=job.job_id,
            paper_id=_paper_of(job),
            step=name,
            ms=ms,
            parser_version=parser_version if isinstance(parser_version, str) else PARSER_VERSION,
            status=outcome,
            error_code=error_code(error) if error is not None else None,
            error=_error_text(error),
        )

    def finished(self, job: Job, *, outcome: RunOutcome) -> None:
        started = self._claimed_at.pop(job.job_id, None)
        failed = outcome in ("retry", "dead_letter")
        log_event(
            "job.done",
            level="error" if outcome == "dead_letter" else "warning" if failed else "info",
            job_id=job.job_id,
            paper_id=_paper_of(job),
            status=job.state if outcome != "gone" else "deleted",
            outcome=outcome,
            attempt=job.attempt,
            ms=None if started is None else round((time.perf_counter() - started) * 1000, 1),
            error_code=(error_code(job.error) or "internal") if failed and job.error else None,
            error=_error_text(job.error) if failed else None,
        )
        if outcome == "gone":
            self._clean_after_delete(job)

    def _clean_after_delete(self, job: Job) -> None:
        """The job's row went with its paper (`DELETE /papers/{id}`) while this worker ran it. The
        route removed the files it could see; the parse may have written crops and a staged
        document after that. Removed here, unless the paper exists again (a re-upload since)."""
        paper_id = _paper_of(job)
        if paper_id is None:
            return
        try:
            gen, _ = payload_generation(job.payload)
        except JobFailed:
            return
        staging_path(self._settings.staging_root, paper_id, gen, job.job_id).unlink(missing_ok=True)
        try:
            owner = self._database.owner_for(job.owner_id)
            exists = self._database.owned_paper(owner, PaperId(paper_id)) is not None
        except OwnershipError:
            exists = False  # the user is gone too
        if not exists:
            shutil.rmtree(self._settings.asset_root / paper_id, ignore_errors=True)


class _Claims(JobObserver):
    """Counts claims. `run_once` returns None both when nothing was due AND when the job it ran
    lost its row mid-run (its paper was deleted): only the first means the queue is empty, so a
    drain (`max_jobs`) that stopped on either quit with work still queued (S1 review nit)."""

    def __init__(self) -> None:
        self.count = 0

    def claimed(self, job: Job) -> None:
        self.count += 1


class _Fanout(JobObserver):
    """Tells every observer, even when one raises; then re-raises the first error so the runner
    counts it (`JobRunner.observer_errors`)."""

    def __init__(self, *observers: JobObserver) -> None:
        self._observers = observers

    def _each(self, call: str, *args: Any, **kwargs: Any) -> None:
        first: Exception | None = None
        for observer in self._observers:
            try:
                getattr(observer, call)(*args, **kwargs)
            except Exception as exc:
                first = first or exc
        if first is not None:
            raise first

    def claimed(self, job: Job) -> None:
        self._each("claimed", job)

    def step_started(self, job: Job, name: str) -> None:
        self._each("step_started", job, name)

    def step_finished(
        self,
        job: Job,
        name: str,
        *,
        outcome: StepOutcome,
        ms: float,
        result: Any,
        error: str | None,
    ) -> None:
        self._each("step_finished", job, name, outcome=outcome, ms=ms, result=result, error=error)

    def finished(self, job: Job, *, outcome: RunOutcome) -> None:
        self._each("finished", job, outcome=outcome)


def run(
    settings: Settings,
    *,
    max_jobs: int | None = None,
    observer: JobObserver | None = None,
    lease_seconds: float | None = None,
) -> int:
    """Claim and run jobs until stopped. Returns the number of jobs run.

    `max_jobs` exists for the tests: an end-to-end check wants "drain the queue and stop", not a
    loop it has to kill. Production passes None. `observer` is told everything the log is told
    (a test holds a worker at a step boundary through it). Signal handlers are installed only on
    the main thread, where Python allows them; a test may run this on another.
    """
    settings.ensure_directories()

    database = PaperTreeDb(settings.database_file)
    store = JobStore(settings.database_file)
    try:
        database.migrate()
        store.migrate()
        log = JobLog(database, settings)
        claims = _Claims()
        runner = build_runner(
            store,
            ParseJobDeps(
                database=database,
                asset_root=settings.asset_root,
                staging_root=settings.staging_root,
                verify_stored=verify_stored_generation,
            ),
            observer=_Fanout(claims, log) if observer is None else _Fanout(observer, claims, log),
            lease_seconds=lease_seconds,
        )

        stopping = False

        def stop(_signum: int, _frame: FrameType | None) -> None:
            # SIGTERM is how a supervisor asks for a graceful stop. The flag is checked between
            # jobs rather than inside one: `run_once` runs a job to conclusion, and interrupting a
            # parse mid-step would leave the lease held until it expires. (SIGKILL is the other
            # stop, and the durable steps are what make it safe.)
            nonlocal stopping
            stopping = True
            log_event("worker.stopping", worker_id=runner.worker_id)

        if threading.current_thread() is threading.main_thread():
            for signal_number in (signal.SIGINT, signal.SIGTERM):
                signal.signal(signal_number, stop)

        def release() -> None:
            for job_id in runner.release_dead_local_workers():
                log_event("job.release", level="warning", job_id=job_id, released=True)

        log_event("worker.start", worker_id=runner.worker_id)
        release()
        ran = 0
        while not stopping and (max_jobs is None or ran < max_jobs):
            before = claims.count
            runner.run_once()
            if claims.count == before:  # nothing was due (not: a job whose row vanished)
                if max_jobs is not None:
                    break  # draining, and the queue is empty
                release()
                time.sleep(IDLE_SLEEP_SECONDS)
                continue
            ran += 1
        return ran
    finally:
        store.close()
        database.close()


def main() -> None:  # pragma: no cover - the process entry point
    run(Settings.from_env())


__all__ = ["PARSE_KIND", "JobLog", "log_event", "main", "run", "verify_stored_generation"]


if __name__ == "__main__":  # pragma: no cover
    main()
