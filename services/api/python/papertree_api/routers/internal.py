"""contracts.md §4: the agent's four read-only paper tools, served to the agent (never the browser)
under ``/internal/agent/runs/{run_id}/…`` (S5).

    GET  …/outline                          get_outline()
    GET  …/sections/{handle}?cursor=        get_section({handle, cursor?})
    GET  …/passages/{handle}                get_passage({handle})
    GET  …/search?q=&limit=                 search_passages({query, limit ≤ 8})

THE GATES, IN ORDER.

  1. LOOPBACK ONLY: ``request.client.host`` must be ``127.0.0.1`` or ``::1``; anything else is a
     404 (the routes do not exist for it). Starlette's ``TestClient`` reports the host
     ``testclient``; it is admitted only while ``PAPERTREE_INTERNAL_ALLOW_TESTCLIENT=1``, and no
     real socket has that host.
  2. The parameters (handle, cursor, query, limit) — 422 as usual.
  3. ``Authorization: Bearer <run token>``: ``run_grant(run_id, sha256(token))`` must exist, be
     ``running`` and unexpired, else 401 ``auth_required``. Then ``owner_for(grant.user_id)``.
  4. 16 tool requests per run; the 17th is 429 ``tool_budget_exhausted`` (counted atomically on
     ``ai_runs.tool_calls_json``, which also records what was asked for journey E).

``tool_budget_exhausted`` is a RUN error code (§2.9's second list), not a member of the API's
``ErrorCode`` enum: the 429 is written here as ``internal-tools.schema.json``'s ``ToolError``
(whose ``code`` enum is ``auth_required | not_found | tool_budget_exhausted``), the contract the
agent reads, and never reaches a browser.

WHAT IS READ. The paper through a READ-ONLY ``AgentDataHandle`` bound to the grant's user and the
``PaperIndex`` it loads (cached, ``PaperIndexCache``); the run's handles and its tool count through
``PaperTreeDb`` with the owner handle. Every response is ``{text, handles, next_cursor}``: ``text``
is the blocks rendered by ``evidence.render_block`` (the §4 header, then the datamarked wrapper),
``handles`` the handles in this response, assigned first-seen and persisted.

The OUTLINE is a list of block headers only — ``[bN] (p. {page} · {heading} · heading)`` per
section, indented by level — with each heading's text made header-safe (``evidence.header_text``),
exactly as every block header carries its section title; no body text.
"""

from __future__ import annotations

import hashlib
import os
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import JSONResponse
from papertree_db import OwnerId, PaperId, PaperTreeDb, generation
from papertree_memory import AgentDataHandle
from papertree_retrieval import CachedPaper, PaperIndex

from .. import evidence
from ..deps import IndexCacheDep, SettingsDep, open_database
from ..errors import ApiError, ErrorEnvelope
from ..logging import log_event
from ..schemas import HANDLE_PATTERN, ToolResult

PREFIX: Final = "/internal/agent/runs/{run_id}"
LOOPBACK: Final = frozenset({"127.0.0.1", "::1"})
TESTCLIENT_HOST: Final = "testclient"
ALLOW_TESTCLIENT_ENV: Final = "PAPERTREE_INTERNAL_ALLOW_TESTCLIENT"
#: contracts.md §4: "Server-side cap: 16 tool requests per run".
TOOL_REQUEST_CAP: Final = 16
#: contracts.md §4: `get_section` pages at <= 6,000 characters of block text per response.
SECTION_PAGE_CHARS: Final = 6_000
NOT_AVAILABLE: Final = "Passage {handle} is not available."

HandlePath = Annotated[str, Path(pattern=HANDLE_PATTERN)]
TOOL_ERRORS: Final[dict[int | str, dict[str, Any]]] = {
    401: {"model": ErrorEnvelope, "description": "auth_required: bad or expired run token"},
    404: {"model": ErrorEnvelope, "description": "not_found: an unknown handle, or not loopback"},
    429: {"description": "tool_budget_exhausted: the 17th request of a run"},
}


def loopback_only(request: Request) -> None:
    host = request.client.host if request.client is not None else None
    if host in LOOPBACK:
        return
    if host == TESTCLIENT_HOST and os.environ.get(ALLOW_TESTCLIENT_ENV) == "1":
        return
    raise ApiError("not_found", "Not Found")


#: Gate 1 runs as a ROUTER dependency, before FastAPI validates a single parameter, so a caller
#: that is not loopback learns nothing, not even which parameters these routes take.
router = APIRouter(dependencies=[Depends(loopback_only)])


@dataclass
class ToolCall:
    run_id: str
    user_id: str
    paper_id: str
    generation: int
    datamark: str
    db: PaperTreeDb
    owner: OwnerId
    cached: CachedPaper

    @property
    def index(self) -> PaperIndex:
        return self.cached.index

    def handles_for(self, block_ids: Sequence[str]) -> list[str]:
        return self.db.assign_run_handles(self.owner, self.run_id, self.generation, block_ids)

    def block_of(self, handle: str) -> str:
        block_id = self.db.run_handles(self.owner, self.run_id).get(handle)
        if block_id is None or block_id not in self.index:
            raise ApiError("not_found", NOT_AVAILABLE.format(handle=handle))
        return block_id

    def render(self, block_ids: Sequence[str]) -> tuple[str, list[str]]:
        ids = list(dict.fromkeys(block_ids))
        handles = self.handles_for(ids)
        text = "\n\n".join(
            evidence.render_block(
                handle, self.index, block_id, paper_id=self.paper_id, datamark=self.datamark
            )
            for handle, block_id in zip(handles, ids, strict=True)
        )
        return text, handles


def _token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    return value.strip() if scheme.lower() == "bearer" and value.strip() else None


async def _open(
    request: Request,
    run_id: str,
    tool: str,
    detail: dict[str, Any],
    db: PaperTreeDb,
    settings: Any,
    cache: Any,
) -> ToolCall:
    """Gates 3 and 4, then the paper. Called INSIDE the handler, after FastAPI validated the
    parameters (gate 2), so a malformed request is a 422 whatever its token."""
    unauthorised = ApiError("auth_required", "The run token is missing, wrong or expired.")
    token = _token(request)
    if token is None:
        raise unauthorised
    grant = db.run_grant(run_id, hashlib.sha256(token.encode("utf-8")).hexdigest())
    if grant is None or not grant.live_at(datetime.now(UTC)):
        raise unauthorised
    owner = db.owner_for(grant.user_id)
    count = db.record_tool_request(
        owner,
        run_id,
        {"tool": tool, **detail, "at": datetime.now(UTC).isoformat()},
        cap=TOOL_REQUEST_CAP,
    )
    if count is None:
        raise _BudgetExhausted()
    with AgentDataHandle(settings.database_file, grant.user_id) as handle:
        row = handle.get_paper(PaperId(grant.paper_id), generation(grant.generation))
        if row is None:
            raise ApiError("not_found", "The paper of this run is no longer available.")
        cached = cache.get(
            grant.user_id,
            grant.paper_id,
            grant.generation,
            stamp=str(row["created_at"]),
            load=lambda: PaperIndex.from_reader(
                handle, PaperId(grant.paper_id), generation(grant.generation)
            ),
        )
    return ToolCall(
        run_id=run_id,
        user_id=grant.user_id,
        paper_id=grant.paper_id,
        generation=grant.generation,
        datamark=grant.datamark,
        db=db,
        owner=owner,
        cached=cached,
    )


class _BudgetExhausted(Exception):
    pass


def _budget_response() -> JSONResponse:
    return JSONResponse(
        {
            "detail": "Tool budget exhausted; answer from what you have.",
            "code": "tool_budget_exhausted",
            "retryable": False,
        },
        status_code=429,
    )


def _logged(run_id: str, tool: str, started: float, status: int) -> None:
    log_event(
        "internal.tool",
        run_id=run_id,
        tool=tool,
        status=status,
        ms=round((time.perf_counter() - started) * 1000, 1),
    )


def outline_text(call: ToolCall, note: str | None = None) -> ToolResult:
    index = call.index
    headings = [s.heading_block_id for s in index.sections if s.heading_block_id in index]
    handles = call.handles_for(headings)
    levels = {s.heading_block_id: s.level for s in index.sections}
    lines = [note] if note else []
    lines.append(f"Outline ({len(headings)} sections):")
    for handle, block_id in zip(handles, headings, strict=True):
        block = index.block(block_id)
        assert block is not None
        indent = "  " * max(0, levels.get(block_id, 1) - 1)
        title = evidence.header_text(block.text) or block.type
        lines.append(f"{indent}[{handle}] (p. {evidence.page_label(block.page_index)} · {title})")
    return ToolResult(text="\n".join(lines), handles=handles, next_cursor=None)


async def _serve(
    request: Request,
    run_id: str,
    tool: str,
    detail: dict[str, Any],
    db: PaperTreeDb,
    settings: Any,
    cache: Any,
    build: Any,
) -> Any:
    started = time.perf_counter()
    try:
        call = await _open(request, run_id, tool, detail, db, settings, cache)
        result: ToolResult = build(call)
    except _BudgetExhausted:
        _logged(run_id, tool, started, 429)
        return _budget_response()
    except ApiError as exc:
        _logged(run_id, tool, started, exc.status)
        raise
    _logged(run_id, tool, started, 200)
    return result


DbDep = Annotated[PaperTreeDb, Depends(open_database)]


@router.get(f"{PREFIX}/outline", response_model=ToolResult, responses=TOOL_ERRORS)
async def get_outline(
    request: Request, run_id: str, db: DbDep, settings: SettingsDep, cache: IndexCacheDep
) -> Any:
    return await _serve(request, run_id, "get_outline", {}, db, settings, cache, outline_text)


@router.get(f"{PREFIX}/sections/{{handle}}", response_model=ToolResult, responses=TOOL_ERRORS)
async def get_section(
    request: Request,
    run_id: str,
    handle: HandlePath,
    db: DbDep,
    settings: SettingsDep,
    cache: IndexCacheDep,
    cursor: Annotated[str | None, Query(min_length=1, max_length=64)] = None,
) -> Any:
    def build(call: ToolCall) -> ToolResult:
        index = call.index
        block_id = call.block_of(handle)
        members = section_members(index, block_id)
        start = _cursor_offset(cursor, len(members))
        page: list[str] = []
        used = 0
        position = start
        while position < len(members):
            block = index.block(members[position])
            size = len(block.text) if block is not None else 0
            if page and used + size > SECTION_PAGE_CHARS:
                break
            page.append(members[position])
            used += size
            position += 1
        text, handles = call.render(page) if page else ("(This section has no more text.)", [])
        next_cursor = f"c{position}" if position < len(members) else None
        return ToolResult(text=text, handles=handles, next_cursor=next_cursor)

    detail = {"handle": handle, **({"cursor": cursor} if cursor else {})}
    return await _serve(request, run_id, "get_section", detail, db, settings, cache, build)


@router.get(f"{PREFIX}/passages/{{handle}}", response_model=ToolResult, responses=TOOL_ERRORS)
async def get_passage(
    request: Request,
    run_id: str,
    handle: HandlePath,
    db: DbDep,
    settings: SettingsDep,
    cache: IndexCacheDep,
) -> Any:
    def build(call: ToolCall) -> ToolResult:
        block_id = call.block_of(handle)
        text, handles = call.render([block_id, *related_blocks(call.index, block_id)])
        return ToolResult(text=text, handles=handles, next_cursor=None)

    return await _serve(
        request, run_id, "get_passage", {"handle": handle}, db, settings, cache, build
    )


@router.get(f"{PREFIX}/search", response_model=ToolResult, responses=TOOL_ERRORS)
async def search_passages(
    request: Request,
    run_id: str,
    db: DbDep,
    settings: SettingsDep,
    cache: IndexCacheDep,
    q: Annotated[str, Query(min_length=1, max_length=500)],
    limit: Annotated[int, Query(ge=1, le=8)] = 8,
) -> Any:
    def build(call: ToolCall) -> ToolResult:
        hits = call.cached.lexical.search(q, limit)
        if not hits:
            # contracts.md §4 (spike §3 lesson): a miss answers with the outline, so the model
            # can navigate instead of guessing another query.
            return outline_text(call, note="No passage matched that search. The outline:")
        text, handles = call.render([hit.block_id for hit in hits])
        return ToolResult(text=text, handles=handles, next_cursor=None)

    return await _serve(
        request, run_id, "search_passages", {"limit": limit}, db, settings, cache, build
    )


# ── what a section or a passage contains ─────────────────────────────────────────────────────


def section_members(index: PaperIndex, block_id: str) -> list[str]:
    """The text blocks of the section ``block_id`` heads or belongs to, in reading order: its
    heading, then its own blocks (``Section.block_ids``). A block in no section (front matter)
    answers with the front matter: every section-less top-level text block."""
    section = index.section_of(block_id)
    if section is None:
        members = [
            b for b in index.reading_order if index.is_top_level(b) and index.section_of(b) is None
        ]
    else:
        members = [section.heading_block_id, *section.block_ids]
    ordered = sorted(dict.fromkeys(m for m in members if m in index), key=index.rank)
    return [m for m in ordered if (block := index.block(m)) is not None and block.text.strip()]


def related_blocks(index: PaperIndex, block_id: str) -> list[str]:
    """A figure's or table's caption, and a caption's figure or table (``caption_of``)."""
    out: list[str] = []
    for relation in (*index.relations_to(block_id), *index.relations_from(block_id)):
        if relation.type != "caption_of":
            continue
        other = relation.from_block if relation.to_block == block_id else relation.to_block
        if other != block_id and other in index:
            out.append(other)
    return out


def _cursor_offset(cursor: str | None, total: int) -> int:
    if cursor is None:
        return 0
    if not (cursor.startswith("c") and cursor[1:].isdigit() and cursor[1:].isascii()):
        raise ApiError("validation_failed", "cursor: not a cursor this tool issued")
    offset = int(cursor[1:])
    if offset > total:
        raise ApiError("validation_failed", "cursor: past the end of this section")
    return offset
