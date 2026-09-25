"""contracts.md §2.5: AI threads (explain, ask, follow-up) and run cancellation. S5 builds these.

    POST  /papers/{id}/threads                    ThreadCreate      -> 200 SSE (§2.6)
    POST  /papers/{id}/threads/{tid}/messages     FollowUp          -> 200 SSE (§2.6)
    GET   /papers/{id}/threads                                      -> Thread[]
    GET   /papers/{id}/threads/{tid}                                -> ThreadDetail
    POST  /runs/{run_id}/cancel                                     -> 202

501 STUBS WITH THEIR FINAL MODELS (S0): auth, parameters and the body model run first, then
`not_implemented("S5")`. The pre-stream errors §2.5 lists (409 `not_parsed`, 429
`budget_exhausted`, 503 `agent_unavailable` / `not_configured`, 409 `busy`) are S5's.
"""

from __future__ import annotations

from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response

from ..deps import CallerDep
from ..errors import ErrorEnvelope, not_implemented
from ..schemas import FollowUp, Thread, ThreadCreate, ThreadDetail
from ._shared import json_body

router = APIRouter()

SLICE: Final = "S5"
NOT_YET: Final[dict[int | str, dict[str, Any]]] = {
    501: {"model": ErrorEnvelope, "description": f"Not implemented yet (slice {SLICE})"}
}
#: The browser reads these with `fetch` + `ReadableStream`; the events are `schemas.BROWSER_EVENTS`.
EVENT_STREAM: Final[dict[int | str, dict[str, Any]]] = {
    200: {"description": "contracts.md §2.6 events", "content": {"text/event-stream": {}}},
    **NOT_YET,
}


@router.post("/papers/{paper_id}/threads", responses=EVENT_STREAM)
async def create_thread(
    call: CallerDep,
    paper_id: str,
    body: Annotated[ThreadCreate, Depends(json_body(ThreadCreate))],
) -> Response:
    raise not_implemented(SLICE)


@router.post("/papers/{paper_id}/threads/{thread_id}/messages", responses=EVENT_STREAM)
async def follow_up(
    call: CallerDep,
    paper_id: str,
    thread_id: str,
    body: Annotated[FollowUp, Depends(json_body(FollowUp))],
) -> Response:
    raise not_implemented(SLICE)


@router.get("/papers/{paper_id}/threads", response_model=list[Thread], responses=NOT_YET)
async def list_threads(call: CallerDep, paper_id: str) -> list[Thread]:
    raise not_implemented(SLICE)


@router.get(
    "/papers/{paper_id}/threads/{thread_id}", response_model=ThreadDetail, responses=NOT_YET
)
async def get_thread(call: CallerDep, paper_id: str, thread_id: str) -> ThreadDetail:
    raise not_implemented(SLICE)


@router.post("/runs/{run_id}/cancel", status_code=status.HTTP_202_ACCEPTED, responses=NOT_YET)
async def cancel_run(call: CallerDep, run_id: str) -> Response:
    """202; propagates `DELETE agent /v1/runs/{run_id}` (§2.5). A browser disconnect does the
    same, from the stream's side."""
    raise not_implemented(SLICE)
