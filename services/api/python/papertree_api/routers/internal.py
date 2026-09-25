"""contracts.md §4: the agent's four read-only paper tools, served to the agent (never the browser)
under `/internal/agent/runs/{run_id}/…`. S5 builds these.

    GET  …/outline                          get_outline()
    GET  …/sections/{handle}?cursor=        get_section({handle, cursor?})
    GET  …/passages/{handle}                get_passage({handle})
    GET  …/search?q=&limit=                 search_passages({query, limit ≤ 8})

Every answer is a `ToolResult` `{text, handles, next_cursor?}`. Auth is `Authorization: Bearer
<run token>` checked through `run_grant`, the route is refused unless `request.client.host` is
loopback, and a run gets 16 tool requests (the 17th is 429): all S5's.

501 STUBS WITH THEIR FINAL MODELS (S0): the handle, cursor and query parameters are already
validated. Note for S5: §4's `429 tool_budget_exhausted` names a code that is a RUN error code
(§2.9's second list), not a member of the API's ErrorCode enum, which every non-2xx envelope is
drawn from; that needs a contracts decision before the route can send it (see the S0 report).
"""

from __future__ import annotations

from typing import Annotated, Any, Final

from fastapi import APIRouter, Path, Query

from ..errors import ErrorEnvelope, not_implemented
from ..schemas import HANDLE_PATTERN, ToolResult

router = APIRouter()

SLICE: Final = "S5"
NOT_YET: Final[dict[int | str, dict[str, Any]]] = {
    501: {"model": ErrorEnvelope, "description": f"Not implemented yet (slice {SLICE})"}
}
PREFIX: Final = "/internal/agent/runs/{run_id}"

HandlePath = Annotated[str, Path(pattern=HANDLE_PATTERN)]


@router.get(f"{PREFIX}/outline", response_model=ToolResult, responses=NOT_YET)
async def get_outline(run_id: str) -> ToolResult:
    raise not_implemented(SLICE)


@router.get(f"{PREFIX}/sections/{{handle}}", response_model=ToolResult, responses=NOT_YET)
async def get_section(
    run_id: str,
    handle: HandlePath,
    cursor: Annotated[str | None, Query(min_length=1, max_length=64)] = None,
) -> ToolResult:
    raise not_implemented(SLICE)


@router.get(f"{PREFIX}/passages/{{handle}}", response_model=ToolResult, responses=NOT_YET)
async def get_passage(run_id: str, handle: HandlePath) -> ToolResult:
    raise not_implemented(SLICE)


@router.get(f"{PREFIX}/search", response_model=ToolResult, responses=NOT_YET)
async def search_passages(
    run_id: str,
    q: Annotated[str, Query(min_length=1, max_length=500)],
    limit: Annotated[int, Query(ge=1, le=8)] = 8,
) -> ToolResult:
    raise not_implemented(SLICE)
