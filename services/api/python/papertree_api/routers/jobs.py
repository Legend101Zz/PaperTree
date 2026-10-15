"""contracts.md §2.2: `GET /jobs/{job_id}`. S1 owns this module."""

from __future__ import annotations

from fastapi import APIRouter
from papertree_db import PaperId, generation
from papertree_document_worker.job import payload_generation
from papertree_jobs import Job

from ..deps import Caller, CallerDep
from ..errors import ApiError
from ..library import job_status
from ..schemas import JobStatus

router = APIRouter()


def _target(call: Caller, job: Job) -> tuple[int | None, str | None]:
    """`(generation, parser_version)` of a parse job (contracts.md §8): the generation its payload
    names, and the parser version stored with that generation once it exists (null before)."""
    payload = job.payload if isinstance(job.payload, dict) else {}
    try:
        gen, _attempt = payload_generation(payload)
    except Exception:  # a malformed payload has no target; the job's own state still answers
        return None, None
    paper_id = payload.get("paper_id")
    if not isinstance(paper_id, str):
        return gen, None
    row = call.db.get_paper(call.db_owner, PaperId(paper_id), generation(gen))
    version = row["parser_version"] if row is not None else None
    return gen, version if isinstance(version, str) else None


@router.get("/jobs/{job_id}", response_model=JobStatus)
async def get_job(call: CallerDep, job_id: str) -> JobStatus:
    """One job's state and step ledger: "the existing shape plus `error_code`" (§2.2), and the
    `generation` and `parser_version` it parses (§8).

    The raw `error` text stays in the DB and the worker's log: it is an exception's message
    (`FileDataError: Failed to open stream`, a validator's rule list, a path), written for a
    developer, not for the reader. `error_code` is what a client can act on.
    """
    job = call.store.get_job(call.store_owner, job_id)
    if job is None or job.kind != "parse":
        raise ApiError("not_found", "no such job")
    gen, version = _target(call, job)
    status = job_status(job, call.store.list_steps(call.store_owner, job_id))
    return status.model_copy(update={"generation": gen, "parser_version": version})
