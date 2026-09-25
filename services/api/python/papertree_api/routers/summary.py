"""contracts.md §2.5: the paper summary. S5 builds these.

    GET   /papers/{id}/summary                     -> SummaryStatus
    POST  /papers/{id}/summary   SummaryRequest    -> 200 SSE (§2.6), or 200 JSON SummaryStatus
                                                      when a cached summary exists and
                                                      `regenerate` is not set

501 STUBS WITH THEIR FINAL MODELS (S0).
"""

from __future__ import annotations

from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from ..deps import CallerDep
from ..errors import ErrorEnvelope, not_implemented
from ..schemas import SummaryRequest, SummaryStatus
from ._shared import json_body

router = APIRouter()

SLICE: Final = "S5"
NOT_YET: Final[dict[int | str, dict[str, Any]]] = {
    501: {"model": ErrorEnvelope, "description": f"Not implemented yet (slice {SLICE})"}
}


@router.get("/papers/{paper_id}/summary", response_model=SummaryStatus, responses=NOT_YET)
async def get_summary(call: CallerDep, paper_id: str) -> SummaryStatus:
    raise not_implemented(SLICE)


@router.post(
    "/papers/{paper_id}/summary",
    response_model=SummaryStatus,
    responses={
        200: {
            "description": "contracts.md §2.6 events, or the cached summary as JSON",
            "content": {"text/event-stream": {}},
        },
        **NOT_YET,
    },
)
async def create_summary(
    call: CallerDep,
    paper_id: str,
    body: Annotated[SummaryRequest, Depends(json_body(SummaryRequest))],
) -> Response:
    raise not_implemented(SLICE)
