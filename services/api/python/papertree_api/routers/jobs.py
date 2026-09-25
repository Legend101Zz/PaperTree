"""contracts.md §2.2: `GET /jobs/{job_id}`. S1 owns this next."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ..deps import CallerDep
from ..errors import ApiError
from ..wiretime import wire_time

router = APIRouter()


@router.get("/jobs/{job_id}")
async def get_job(call: CallerDep, job_id: str) -> dict[str, Any]:
    """What makes the library's PENDING state real (#74).

    `dashboard/page.tsx` defaults every paper to `processing: 'pending'` because "a row that
    has never been told about a job is a paper nobody has parsed yet". This is the thing that
    tells it.
    """
    job = call.store.get_job(call.store_owner, job_id)
    if job is None:
        raise ApiError("not_found", "no such job")
    return {
        "job_id": job.job_id,
        "kind": job.kind,
        "state": job.state,
        "attempt": job.attempt,
        "max_attempts": job.max_attempts,
        "progress_done": job.progress_done,
        "progress_total": job.progress_total,
        "progress_note": job.progress_note,
        "error": job.error,
        "is_terminal": job.is_terminal,
        "created_at": wire_time(job.created_at),
        "updated_at": wire_time(job.updated_at),
        # `owner_id` is on the Job dataclass and is DELIBERATELY not in this dict. It is the
        # opaque handle, and #74's one non-negotiable is that it never crosses the wire.
        "steps": [
            {
                "name": step.step_name,
                "index": step.step_index,
                "state": step.state,
                "error": step.error,
            }
            for step in call.store.list_steps(call.store_owner, job_id)
        ],
    }
