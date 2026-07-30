"""papertree_jobs — the durable job runner for PaperTree v2 (EPIC-00 F0.6).

Two tables (infrastructure/migrations/0002_jobs.sql), a store, and a loop. A job is a row;
every step it has finished is a row. A worker that is killed loses only the step it was
inside, because everything before it was committed; a worker that starts finds those rows
and skips them. That sentence is the entire design.

WHAT IS NOT HERE, AND WHY
  - No workflow framework. research/literature/21-durable-workflows.md priced the field:
    Temporal Cloud has a $100/month floor, DBOS and Hatchet self-host need Postgres, and
    arq is in maintenance-only mode. None of them survives "SQLite, no Docker, laptop".
  - No new dependency of any kind. Standard library plus papertree-db.
  - No fan-out/fan-in, no cron, no DAG, no operator UI, no priorities, no worker pool.
    Nothing in Epic 1-5 asks for them yet, and this repo's documented failure mode is
    accumulated unreachable code, not missing features (findings.md §A: 1,698 lines of
    geometry-aware extraction with zero importers).

WHY THIS PACKAGE IS PYTHON-ONLY, WHICH IS A DECISION AND NOT AN OMISSION
  Its consumers are the Python document-worker (Epic 1) and the Python API. A TypeScript
  twin would have no caller — and shipping a job runner nobody imports would reproduce
  exactly the failure named above, in the same repo, in the same epic that exists to stop
  it. packages/db has a TS twin because the web app reads the database; nothing in the web
  app runs jobs.

USAGE
    store = JobStore("papertree.sqlite")
    store.migrate()
    job_id = store.enqueue(owner, "parse", f"parse:{source_hash}", {"paper_id": paper_id})

    def parse(ctx: JobContext) -> None:
        pages = ctx.step("extract", lambda: extract(ctx.payload["paper_id"]))
        ctx.progress(1, 2, "extracted")
        ctx.step("layout", lambda: analyse(pages))

    runner = JobRunner(store, {"parse": parse})
    while not shutting_down:
        if runner.run_once() is None:
            time.sleep(0.25)
"""

from .model import (
    DEFAULT_BACKOFF_BASE_SECONDS,
    DEFAULT_BACKOFF_CAP_SECONDS,
    DEFAULT_BACKOFF_FACTOR,
    DEFAULT_LEASE_SECONDS,
    DEFAULT_MAX_ATTEMPTS,
    TERMINAL_STATES,
    Cancelled,
    Job,
    JobError,
    JobState,
    LeaseLost,
    StepRecord,
    StepState,
    backoff_delay,
)
from .runner import Handler, JobContext, JobRunner
from .store import JobStore

__all__ = [
    "DEFAULT_BACKOFF_BASE_SECONDS",
    "DEFAULT_BACKOFF_CAP_SECONDS",
    "DEFAULT_BACKOFF_FACTOR",
    "DEFAULT_LEASE_SECONDS",
    "DEFAULT_MAX_ATTEMPTS",
    "TERMINAL_STATES",
    "Cancelled",
    "Handler",
    "Job",
    "JobContext",
    "JobError",
    "JobRunner",
    "JobState",
    "JobStore",
    "LeaseLost",
    "StepRecord",
    "StepState",
    "backoff_delay",
]
