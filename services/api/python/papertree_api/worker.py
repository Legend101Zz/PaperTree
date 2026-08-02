"""`python -m papertree_api.worker` — the loop that actually parses the queued PDFs.

WHY THIS EXISTS, because its absence was invisible

`POST /papers` enqueues a job and returns 202. Nothing in this repo ran one. `packages/jobs`
deliberately ships no `run_forever` — `runner.py:205-209` says every caller writes its own loop, and
the only loop that existed was `packages/jobs/python/tests/durability_worker.py`, which is a test
fixture. So before this file, a user could upload a PDF, get a `job_id`, poll it forever, and watch
`pending` never become `running`. Every test passed: `test_job_resume.py` drives `run_once()` by
hand, which is the right way to test a runner and says nothing about whether anything calls it.

It lives here rather than in `services/document-worker` on purpose. The worker package owns the
PARSE; wiring a database, a job store and an asset root together is a deployment concern, and
`services/api` is already the package that knows where those live (`settings.py`). Putting it there
would also give `document-worker` a reason to depend on this package's settings, which is backwards.

    PAPERTREE_DATA_ROOT=~/.papertree python -m papertree_api.worker

Run it beside `python -m papertree_api`. Two processes against one SQLite file is the arrangement
`packages/jobs` documents as intended — `store.py:89` sets `busy_timeout` for exactly this.
"""

from __future__ import annotations

import logging
import signal
import time
from types import FrameType

from papertree_db import PaperId, PaperTreeDb, generation
from papertree_document_worker.job import PARSE_KIND, ParseJobDeps, build_runner
from papertree_jobs import JobStore

from .settings import Settings

#: How long to sleep when `run_once()` finds nothing. Short enough that an upload starts parsing
#: while the user is still looking at the page; long enough that an idle worker is not a spinloop.
IDLE_SLEEP_SECONDS = 0.5

logger = logging.getLogger("papertree.worker")


def _promote(database: PaperTreeDb, store: JobStore, user_id: str, job_id: str) -> None:
    """Make the generation a parse just wrote the one readers get.

    NOTHING ELSE DOES THIS, and its absence is invisible until the very end. `put_paper` writes a
    row keyed `(paper_id, generation)`; `paper_promotions` is separate, mutable state, and
    `promoted_generation` is what every read route resolves through. Grep the worker: it calls
    `put_paper` (`job.py:150`) and never `promote_generation`. So before this function a parse
    would run to `succeeded`, the document would be fully stored, and `GET /papers/{id}/ir` would
    answer:

        404 {"detail": "no such paper"}

    A successful job, a complete document, and a paper the user cannot open. Caught by
    `test_end_to_end.py`, which reads the document back rather than stopping at the job state —
    an assertion that ended at `state == "succeeded"` would have passed over exactly this.

    WHY HERE AND NOT IN THE PARSE HANDLER. Promotion is a product decision — *which* generation a
    reader sees — not a parse step. A re-parse that produced a worse document should not
    automatically replace a good one, and `services/document-worker` is Session B's path besides.
    This is the deployment layer, which is where "and now show it to the user" belongs.

    First-generation-only for now: `promote_generation` overwrites unconditionally, and an
    auto-promote-every-reparse policy is a decision nobody has made. It is logged when skipped so
    the choice is visible rather than silent.
    """
    # `Job.owner_id` is a bare user_id, not an `OwnerId` — `job.py:146-149` relies on exactly that
    # (`deps.database.owner_for(ctx.owner_id)`), and the two stores mint their own handles from it.
    steps = {step.step_name: step for step in store.list_steps(store.owner_for(user_id), job_id)}
    persisted = steps.get("persist")
    if persisted is None or persisted.result is None:
        logger.warning("job %s succeeded with no persist result; nothing promoted", job_id)
        return

    paper_id = PaperId(str(persisted.result["paper_id"]))
    written = generation(int(persisted.result["generation"]))
    owner = database.owner_for(user_id)
    if database.promoted_generation(owner, paper_id) is not None:
        logger.info("%s already has a promoted generation; leaving it", paper_id)
        return
    database.promote_generation(owner, paper_id, written)
    logger.info("promoted %s generation %d", paper_id, written)


def run(settings: Settings, *, max_jobs: int | None = None) -> int:
    """Claim and run jobs until stopped. Returns the number of jobs run.

    `max_jobs` exists for the tests: an end-to-end check wants "drain the queue and stop", not a
    loop it has to kill. Production passes None.
    """
    settings.ensure_directories()

    database = PaperTreeDb(settings.database_file)
    store = JobStore(settings.database_file)
    try:
        database.migrate()
        store.migrate()
        runner = build_runner(
            store,
            ParseJobDeps(
                database=database,
                asset_root=settings.asset_root,
                staging_root=settings.staging_root,
            ),
        )

        stopping = False

        def stop(_signum: int, _frame: FrameType | None) -> None:
            # SIGTERM is how a supervisor asks for a graceful stop. The flag is checked between
            # jobs rather than inside one: `run_once` runs a job to conclusion, and interrupting a
            # parse mid-step would leave the lease held until it expires.
            nonlocal stopping
            stopping = True
            logger.info("stop requested; finishing the current job")

        for signal_number in (signal.SIGINT, signal.SIGTERM):
            signal.signal(signal_number, stop)

        ran = 0
        while not stopping and (max_jobs is None or ran < max_jobs):
            job = runner.run_once()
            if job is None:
                if max_jobs is not None:
                    break  # draining, and the queue is empty
                time.sleep(IDLE_SLEEP_SECONDS)
                continue
            ran += 1
            logger.info("job %s (%s) -> %s", job.job_id, job.kind, job.state)
            if job.state == "succeeded" and job.kind == PARSE_KIND:
                _promote(database, store, job.owner_id, job.job_id)
        return ran
    finally:
        store.close()
        database.close()


def main() -> None:  # pragma: no cover - the process entry point
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    run(Settings.from_env())


if __name__ == "__main__":  # pragma: no cover
    main()
