"""contracts.md §2.2: `GET /jobs/{job_id}`. S1 owns this module."""

from __future__ import annotations

from fastapi import APIRouter

from ..deps import CallerDep
from ..errors import ApiError
from ..library import job_status
from ..schemas import JobStatus

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobStatus)
async def get_job(call: CallerDep, job_id: str) -> JobStatus:
    """One job's state and step ledger: "the existing shape plus `error_code`" (§2.2).

    The raw `error` text stays in the DB and the worker's log: it is an exception's message
    (`FileDataError: Failed to open stream`, a validator's rule list, a path), written for a
    developer, not for the reader. `error_code` is what a client can act on.
    """
    job = call.store.get_job(call.store_owner, job_id)
    if job is None or job.kind != "parse":
        raise ApiError("not_found", "no such job")
    return job_status(job, call.store.list_steps(call.store_owner, job_id))
