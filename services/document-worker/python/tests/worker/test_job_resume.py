"""The durable parse job, including the resume path nothing had exercised.

`WAVE-1-EPIC-01-PROMPT.md` item 3: Epic 0.1 (#24) fenced `_fail_step` so a superseded worker
cannot overwrite a live worker's committed `succeeded` checkpoint — *"You are still the first
epic to run multi-step jobs for real, so exercise resume-after-crash deliberately."*

So these tests assert the property that MATTERS rather than the one that is easy. "The job
eventually finishes" is true of a runner with no checkpointing at all. What per-step
checkpointing buys is that **a completed step is never re-run**, and that is what is asserted —
by counting invocations of the step body across a crash.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from _corpus_manifest import CORPUS_DIR as CORPUS
from _corpus_manifest import requires_corpus
from papertree_db import PaperTreeDb
from papertree_document_worker.job import (
    PARSE_KIND,
    ParseJobDeps,
    build_runner,
    enqueue_parse,
)
from papertree_document_worker.pdf import SourceDocument
from papertree_jobs import JobContext, JobRunner, JobStore

pytestmark = requires_corpus

PAPER_ID = "ppr_0123456789ABCDEFGHJKMNP0TV"
SOURCE = "resnet-cvpr-2col.pdf"


@pytest.fixture()
def wiring(tmp_path: Path):  # type: ignore[no-untyped-def]
    """A database, a job store, and both per-connection owner handles.

    TWO handles, deliberately. `OwnerId` is an opaque per-connection value, so a handle minted
    by `PaperTreeDb` is rejected by `JobStore` even over the same file. Getting this wrong
    raises `OwnershipError`, which is the ownership design working rather than a bug.
    """
    db_file = str(tmp_path / "papertree.sqlite")
    database = PaperTreeDb(db_file)
    database.migrate()
    user = database.create_user("owner@example.test")

    store = JobStore(db_file)
    store.migrate()

    deps = ParseJobDeps(
        database=database,
        asset_root=tmp_path / "assets",
        staging_root=tmp_path / "staging",
    )
    try:
        yield {
            "db": database,
            "store": store,
            "deps": deps,
            "job_owner": store.owner_for(user.user_id),
            "db_owner": database.owner_for(user.user_id),
        }
    finally:
        database.close()


def _enqueue(wiring: dict) -> str:  # type: ignore[type-arg]
    with SourceDocument(CORPUS / SOURCE) as document:
        source_hash = document.source_hash
    return enqueue_parse(
        wiring["store"],
        wiring["job_owner"],
        paper_id=PAPER_ID,
        source_path=str(CORPUS / SOURCE),
        source_hash=source_hash,
    )


def test_a_parse_job_runs_and_persists_the_document(wiring: dict) -> None:  # type: ignore[type-arg]
    _enqueue(wiring)
    job = build_runner(wiring["store"], wiring["deps"]).run_once()

    assert job is not None and job.state == "succeeded"
    assert wiring["db"].count_blocks(wiring["db_owner"], PAPER_ID, 1) > 0
    assert len(wiring["db"].list_pages(wiring["db_owner"], PAPER_ID, 1)) == 12


def test_enqueueing_the_same_source_twice_returns_one_job(wiring: dict) -> None:  # type: ignore[type-arg]
    """The idempotency key is `parse:<source_hash>:<paper_id>`.

    Re-uploading identical bytes must not queue a second parse of the same file. `JobStore`
    reads the unique index inside the same IMMEDIATE transaction as the insert, so this holds
    under concurrency too - though this test only covers the sequential case.
    """
    assert _enqueue(wiring) == _enqueue(wiring)


def test_a_completed_step_is_not_re_run_after_a_crash(wiring: dict) -> None:  # type: ignore[type-arg]
    """THE POINT OF THE JOB RUNNER, asserted by counting.

    The handler counts each step body's invocations, and the `persist` step raises the first time - simulating a worker that dies after checkpointing the expensive
    step but before finishing.

    On retry the job must complete with the parse body having run **exactly once**. A runner
    without per-step checkpointing would re-parse, and the only visible difference would be time
    - which is precisely why this counts invocations instead of asserting the job succeeds.
    """
    _enqueue(wiring)
    calls = {"parse": 0, "persist": 0}

    # A handler written here rather than a patched one: `JobContext` uses __slots__, so
    # `ctx.step = ...` raises "attribute 'step' is read-only". Calling ctx.step directly with
    # counting bodies tests the same thing and does not fight the class.
    def counting_handler(ctx: JobContext) -> None:
        def parse_body() -> dict[str, int]:
            calls["parse"] += 1
            return {"blocks": 1}

        ctx.step("parse", parse_body)
        ctx.progress(1, 2, "parsed")

        def persist_body() -> dict[str, int]:
            calls["persist"] += 1
            if calls["persist"] == 1:
                raise RuntimeError("worker died before persisting")
            return {"stored": 1}

        ctx.step("persist", persist_body)

    runner = JobRunner(wiring["store"], {PARSE_KIND: counting_handler})

    first = runner.run_once()
    assert first is not None
    # "pending" is the state a retryable failure returns to - the runner schedules a backoff
    # rather than marking the job failed while attempts remain.
    assert first.state == "pending", first.state
    assert calls["parse"] == 1
    assert calls["persist"] == 1

    # The retry. `run_once` returns None while the backoff delay has not elapsed, so the job is
    # made due explicitly rather than by sleeping - a test that sleeps for a backoff is a test
    # that is slow for no coverage.
    wiring["store"]._conn.execute("UPDATE jobs SET run_after = 0")
    second = runner.run_once()

    assert second is not None and second.state == "succeeded"
    assert calls["parse"] == 1, (
        f"the parse step ran {calls['parse']} times - a committed `succeeded` checkpoint was "
        f"re-run, which is exactly what per-step checkpointing exists to prevent"
    )
    assert calls["persist"] == 2, "persist failed once and must have been retried"

    # And the store agrees: both steps are recorded `succeeded`, with parse recorded once.
    steps = {s.step_name: s for s in wiring["store"].list_steps(wiring["job_owner"], first.job_id)}
    assert steps["parse"].state == "succeeded"
    assert steps["persist"].state == "succeeded"


def test_the_job_payload_carries_no_owner_id(wiring: dict) -> None:  # type: ignore[type-arg]
    """The caller is the trust boundary, so ownership never travels in the payload.

    `ctx.owner_id` comes from the job ROW, which `JobStore.enqueue` wrote from a resolved
    handle. A payload-carried owner would be attacker-controlled data that
    `PaperTreeDb.owner_for` would then happily accept, since it performs no authentication - it
    only checks that a `users` row exists.
    """
    job_id = _enqueue(wiring)
    job = wiring["store"].get_job(wiring["job_owner"], job_id)
    assert job is not None
    assert set(job.payload) == {"paper_id", "source_path", "source_hash"}
    assert "owner" not in job.payload and "owner_id" not in job.payload
