"""The parse as a DURABLE, RESUMABLE job. `packages/jobs` is not optional here.

findings.md C1 is the defect: generation ran **inside the HTTP request**. That is unworkable
independently of anything else - findings.md H2 measured Docling at 19 s/page on ResNet, and even
the deterministic path at 134 ms/page is ~10 s for a 75-page paper. A request that long is a
request that times out.

WHAT PER-STEP CHECKPOINTING ACTUALLY BUYS, AND WHERE THE SEAM MUST GO

`ctx.step(name, fn)` runs `fn` **once per job, ever**. A step whose record is `succeeded` is
never re-run: on resume the recorded RESULT is returned instead. So the seam between steps has
to fall where the intermediate value is small and JSON-round-trippable, because that is what
gets stored and handed back.

That rules out the obvious split. "extract every page" cannot be a step whose result is the page
objects - they are `PageContent` dataclasses holding thousands of spans, and `json.loads` would
hand back dicts on resume. The steps here are therefore coarse and their results are SMALL:

    parse     -> a summary dict (counts, status). The document goes to disk, not through the
                 step result, because a 3,000-block document is not a checkpoint value.
    persist   -> the (paper_id, generation) that was written.

`ctx.progress(done, total, note)` both publishes progress AND RENEWS THE LEASE, so it is called
between steps rather than only at the end - a parse that takes 10 s under a 30 s lease is fine,
one that takes 60 s without renewing is a job another worker steals mid-flight.

THE ONE THING THIS EPIC IS FIRST TO DO FOR REAL

Epic 0.1 (#24) fenced `_fail_step` so a superseded worker cannot overwrite a live worker's
committed `succeeded`. Nothing had exercised it: Epic 1 is the first epic to run multi-step jobs
at all, which is why `test_job_resume.py` kills a job mid-step and asserts the completed step is
NOT re-run rather than merely that the job finishes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from papertree_db import OwnerId, PaperTreeDb
from papertree_jobs import JobContext, JobRunner, JobStore

from papertree_document_worker.pipeline import ParserConfig, parse_document

__all__ = ["PARSE_KIND", "ParseJobDeps", "enqueue_parse", "make_parse_handler"]

#: The job kind. One string, used by the enqueuer and the runner registration alike.
PARSE_KIND = "parse"


@dataclass(slots=True)
class ParseJobDeps:
    """Everything the handler needs that is not in the payload.

    Passed in rather than imported, so a test can point the whole thing at a tmpdir and an
    in-memory database without monkeypatching.
    """

    database: PaperTreeDb
    #: Where rendered crops go. MUST be outside the repository - see crops.py.
    asset_root: Path
    #: Where the parsed document JSON is staged between the parse and persist steps.
    staging_root: Path
    config: ParserConfig | None = None


def enqueue_parse(
    store: JobStore,
    owner: OwnerId,
    *,
    paper_id: str,
    source_path: str,
    source_hash: str,
) -> str:
    """Enqueue one parse, idempotently.

    `owner` MUST come from `JobStore.owner_for()`, not from `PaperTreeDb.owner_for()`. An
    `OwnerId` is an opaque PER-CONNECTION handle - 32 bytes of CSPRNG output resolved through a
    dict that lives on the connection and nowhere else - so a handle minted by a `PaperTreeDb`
    is rejected by a `JobStore` even when both are open on the same file:

        OwnershipError: that value was not minted by this JobStore.

    That is the design working, not an inconvenience. `ids.py` records three separate ways the
    previous user-id-based scheme was broken in one afternoon, each a full cross-tenant read AND
    write. The handler bridges the two sides through `ctx.owner_id`, which is a bare string, and
    re-authenticates it against the database with `PaperTreeDb.owner_for()`.

    The idempotency key is `parse:<source_hash>:<paper_id>`, so re-uploading identical bytes for
    the same paper returns the EXISTING job rather than queueing a second parse of the same file.
    `JobStore.enqueue` reads the unique index inside the same IMMEDIATE transaction as the
    insert, so two concurrent enqueues produce one job rather than a race.
    """
    return store.enqueue(
        owner,
        PARSE_KIND,
        f"{PARSE_KIND}:{source_hash}:{paper_id}",
        {"paper_id": paper_id, "source_path": source_path, "source_hash": source_hash},
    )


def make_parse_handler(deps: ParseJobDeps) -> Any:
    """Build the handler `JobRunner` will call. Two steps, both resumable."""

    def handle(ctx: JobContext) -> None:
        payload = ctx.payload
        paper_id = str(payload["paper_id"])
        source_path = str(payload["source_path"])
        staged = deps.staging_root / f"{paper_id}.paperir.json"

        def do_parse() -> dict[str, Any]:
            result = parse_document(
                source_path,
                paper_id=paper_id,
                asset_root=deps.asset_root,
                config=deps.config,
            )
            # The DOCUMENT goes to disk; only a summary becomes the step result. A step result
            # is stored as JSON and handed back on resume, and a 3,000-block document is not a
            # checkpoint value - it is the output.
            staged.parent.mkdir(parents=True, exist_ok=True)
            staged.write_text(
                json.dumps(
                    result.paper.model_dump(mode="json", by_alias=True, exclude_unset=True),
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            return {
                "blocks": len(result.paper.blocks),
                "pages": result.page_count,
                "status": result.paper.status,
                "crops": result.crops_written,
                "staged": str(staged),
            }

        summary = ctx.step("parse", do_parse)
        # Publishes progress AND renews the lease. Between steps, not only at the end: a parse
        # that outlives its lease is a job another worker takes over mid-flight.
        ctx.progress(1, 2, f"parsed {summary['pages']} pages, {summary['blocks']} blocks")

        def do_persist() -> dict[str, Any]:
            document = json.loads(Path(summary["staged"]).read_text(encoding="utf-8"))
            # `authenticate` is what turns the job's bare owner_id string into an OwnerId. It
            # performs NO authentication - it checks a users row exists - and the caller is the
            # trust boundary, which is why the job payload never carries one.
            owner = deps.database.owner_for(ctx.owner_id)
            deps.database.put_paper(owner, document)
            return {"paper_id": document["paper_id"], "generation": document["generation"]}

        written = ctx.step("persist", do_persist)
        ctx.progress(2, 2, f"stored {written['paper_id']} generation {written['generation']}")

    return handle


def build_runner(store: JobStore, deps: ParseJobDeps) -> JobRunner:
    """A runner with the parse handler registered. `run_once()` returns None when idle."""
    return JobRunner(store, {PARSE_KIND: make_parse_handler(deps)})
