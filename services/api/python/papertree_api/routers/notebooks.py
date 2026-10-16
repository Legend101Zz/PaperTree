"""v0.2 S5a (#206): the notebook. Pages, items, ink strokes, "Dive in", and search.

    POST   /papers/{id}/notebook/pages              NotebookPageCreate -> 201 {page, items}
    GET    /papers/{id}/notebook/pages                                 -> [NotebookPageSummary]
    GET    /papers/{id}/notebook/search?q=                             -> [NotebookHit]
    GET    /notebook/pages/{pid}                                       -> {page, items, strokes}
    PATCH  /notebook/pages/{pid}                    NotebookPagePatch  -> page | 409 stale_version
    DELETE /notebook/pages/{pid}                                       -> 204
    POST   /notebook/pages/{pid}/items              NotebookItemCreate -> 201 item
    PATCH  /notebook/pages/{pid}/items/{iid}        NotebookItemPatch  -> item | 409 stale_version
    DELETE /notebook/pages/{pid}/items/{iid}                           -> 204
    POST   /notebook/pages/{pid}/strokes            [NotebookStrokeIn] -> 201 {added}
    DELETE /notebook/pages/{pid}/strokes/{sid}                         -> 204   (the eraser)

All SQL is `papertree_db.notebook`; this module is the transport. Bodies are built field by field
like the canvas routes, so `owner_id` cannot leak and a stored Anchor leaves as it arrived. A page
that is not the caller's is a 404, never a 403 (no existence oracle).
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import Callable, Mapping
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from papertree_db import NotebookRejected, NotebookStale, PaperId, PaperNotFound

from .. import evidence
from ..deps import CallerDep
from ..errors import ApiError
from ..schemas import (
    NotebookHit,
    NotebookItem,
    NotebookItemCreate,
    NotebookItemPatch,
    NotebookItemStale,
    NotebookPage,
    NotebookPageCreate,
    NotebookPageCreated,
    NotebookPagePatch,
    NotebookPageStale,
    NotebookPageSummary,
    NotebookPageView,
    NotebookStrokeBatch,
    NotebookStrokesAdded,
)
from ..wiretime import wire_time
from ._shared import read_json

router = APIRouter()

#: Longest search query; a notebook search is a few words.
SEARCH_QUERY_MAX = 200


def _passage_key(generation: int, anchor: Mapping[str, Any], marker: str) -> str:
    """S4a's passage key for a stored citation, built as the explain panel's coverage builds it.

    Args:
        generation: The citation's generation.
        anchor: The citation's stored Anchor.
        marker: The citation's handle (the fallback when the Anchor has no BlockSelector).

    Returns:
        ``evidence.passage_key`` over the Anchor's BlockSelector block id, else the marker.
    """
    return evidence.passage_key(generation, evidence.anchor_block_id(anchor) or marker)


def _guard[T](action: Callable[[], T]) -> T:
    """Runs a data-layer call and turns its refusals into the contract envelope."""
    try:
        return action()
    except NotebookRejected as exc:
        raise ApiError(exc.code, exc.detail) from exc
    except PaperNotFound as exc:
        raise ApiError("not_found", "no such paper") from exc


def _time(row: dict[str, Any], *names: str) -> dict[str, Any]:
    return {k: wire_time(v) if k in names else v for k, v in row.items()}


def _page_wire(row: dict[str, Any]) -> dict[str, Any]:
    return _time(row, "created_at", "updated_at")


def _item_wire(row: dict[str, Any]) -> dict[str, Any]:
    return _time(row, "created_at", "updated_at")


def _stroke_wire(row: dict[str, Any]) -> dict[str, Any]:
    out = _time(row, "created_at")
    out["points_b64"] = base64.b64encode(out.pop("points")).decode("ascii")
    return out


def _stale(noun: str, current: dict[str, Any]) -> ApiError:
    return ApiError(
        "stale_version",
        f"This {noun} changed somewhere else. The latest version is shown; try again.",
        extra={"current": current},
    )


# ── pages ────────────────────────────────────────────────────────────────────────────────────


@router.post(
    "/papers/{paper_id}/notebook/pages", response_model=NotebookPageCreated, status_code=201
)
async def create_page(call: CallerDep, paper_id: str, request: Request) -> Response:
    """Creates a page; with `from_message_id` it is "Dive in" and the server seeds the items."""
    body, _ = await read_json(request, NotebookPageCreate)
    page, items = _guard(
        lambda: call.db.create_notebook_page(
            call.db_owner,
            PaperId(paper_id),
            page_id=body.page_id,
            title=body.title,
            template=body.template or "dot",
            from_message_id=body.from_message_id,
            passage_key=_passage_key,
        )
    )
    return JSONResponse(
        {"page": _page_wire(page), "items": [_item_wire(i) for i in items]}, status_code=201
    )


@router.get("/papers/{paper_id}/notebook/pages", response_model=list[NotebookPageSummary])
async def list_pages(call: CallerDep, paper_id: str) -> Response:
    """The paper's pages with their counts."""
    if call.db.owned_paper(call.db_owner, PaperId(paper_id)) is None:
        raise ApiError("not_found", "no such paper")
    rows = call.db.list_notebook_pages(call.db_owner, PaperId(paper_id))
    return JSONResponse([_time(r, "updated_at") for r in rows])


@router.get("/papers/{paper_id}/notebook/search", response_model=list[NotebookHit])
async def search(call: CallerDep, paper_id: str, request: Request) -> Response:
    """Typed text, sticky text, quote text and the AI slip's words; never ink."""
    q = request.query_params.get("q", "").strip()
    if not q or len(q) > SEARCH_QUERY_MAX:
        raise ApiError("validation_failed", f"q: 1 to {SEARCH_QUERY_MAX} characters")
    if call.db.owned_paper(call.db_owner, PaperId(paper_id)) is None:
        raise ApiError("not_found", "no such paper")
    return JSONResponse(call.db.search_notebook(call.db_owner, PaperId(paper_id), q))


@router.get("/notebook/pages/{page_id}", response_model=NotebookPageView)
async def get_page(call: CallerDep, page_id: str) -> Response:
    """The page with its items and its strokes (points as base64)."""
    found = call.db.get_notebook_page(call.db_owner, page_id)
    if found is None:
        raise ApiError("not_found", "no such page")
    page, items, strokes = found
    return JSONResponse(
        {
            "page": _page_wire(page),
            "items": [_item_wire(i) for i in items],
            "strokes": [_stroke_wire(s) for s in strokes],
        }
    )


@router.patch(
    "/notebook/pages/{page_id}",
    response_model=NotebookPage,
    responses={409: {"model": NotebookPageStale}},
)
async def patch_page(call: CallerDep, page_id: str, request: Request) -> Response:
    """Title and/or template; a stale `version` is 409 `stale_version` carrying `current`."""
    body, _ = await read_json(request, NotebookPagePatch)
    fields = {k: getattr(body, k) for k in body.model_fields_set if k != "version"}
    result = _guard(
        lambda: call.db.patch_notebook_page(call.db_owner, page_id, body.version, fields)
    )
    if result is None:
        raise ApiError("not_found", "no such page")
    if isinstance(result, NotebookStale):
        raise _stale("page", _page_wire(result.current))
    return JSONResponse(_page_wire(result))


@router.delete("/notebook/pages/{page_id}", status_code=204)
async def delete_page(call: CallerDep, page_id: str) -> Response:
    """Deletes the page; its items and strokes go with it. 422 while a board card shows it."""
    if _guard(lambda: call.db.delete_notebook_page(call.db_owner, page_id)) == 0:
        raise ApiError("not_found", "no such page")
    return Response(status_code=204)


# ── items ────────────────────────────────────────────────────────────────────────────────────


@router.post("/notebook/pages/{page_id}/items", response_model=NotebookItem, status_code=201)
async def create_item(call: CallerDep, page_id: str, request: Request) -> Response:
    """A quote must carry the full Anchor (422 otherwise, and 422 if it is on another paper)."""
    body, raw = await read_json(request, NotebookItemCreate)
    item: dict[str, Any] = body.model_dump(exclude={"anchor"})
    anchor = raw.get("anchor")
    item["anchor"] = anchor if isinstance(anchor, dict) else None
    return JSONResponse(
        _item_wire(_guard(lambda: call.db.create_notebook_item(call.db_owner, page_id, item))),
        status_code=201,
    )


@router.patch(
    "/notebook/pages/{page_id}/items/{item_id}",
    response_model=NotebookItem,
    responses={409: {"model": NotebookItemStale}},
)
async def patch_item(call: CallerDep, page_id: str, item_id: str, request: Request) -> Response:
    """Moves, resizes, re-stacks or retypes an item; stale `version` is 409."""
    body, _ = await read_json(request, NotebookItemPatch)
    fields = {k: getattr(body, k) for k in body.model_fields_set if k != "version"}
    result = _guard(
        lambda: call.db.patch_notebook_item(call.db_owner, page_id, item_id, body.version, fields)
    )
    if result is None:
        raise ApiError("not_found", "no such item on this page")
    if isinstance(result, NotebookStale):
        raise _stale("item", _item_wire(result.current))
    return JSONResponse(_item_wire(result))


@router.delete("/notebook/pages/{page_id}/items/{item_id}", status_code=204)
async def delete_item(call: CallerDep, page_id: str, item_id: str) -> Response:
    """Deletes one item."""
    if call.db.delete_notebook_item(call.db_owner, page_id, item_id) == 0:
        raise ApiError("not_found", "no such item on this page")
    return Response(status_code=204)


# ── strokes ──────────────────────────────────────────────────────────────────────────────────


@router.post(
    "/notebook/pages/{page_id}/strokes", response_model=NotebookStrokesAdded, status_code=201
)
async def add_strokes(call: CallerDep, page_id: str, request: Request) -> Response:
    """One pen-up batch. 413 over the per-stroke or per-batch byte cap, 422 for a bad blob."""
    body, _ = await read_json(request, NotebookStrokeBatch)
    strokes: list[dict[str, Any]] = []
    for n, s in enumerate(body.root):
        try:
            points = base64.b64decode(s.points_b64, validate=True)
        except binascii.Error as exc:
            raise ApiError("validation_failed", f"strokes.{n}.points_b64: not base64") from exc
        strokes.append(
            {
                "stroke_id": s.stroke_id,
                "tool": s.tool,
                "nib": s.nib,
                "colour": s.colour,
                "points": points,
            }
        )
    added = _guard(lambda: call.db.add_notebook_strokes(call.db_owner, page_id, strokes))
    return JSONResponse({"added": added}, status_code=201)


@router.delete("/notebook/pages/{page_id}/strokes/{stroke_id}", status_code=204)
async def delete_stroke(call: CallerDep, page_id: str, stroke_id: str) -> Response:
    """The eraser."""
    if call.db.delete_notebook_stroke(call.db_owner, page_id, stroke_id) == 0:
        raise ApiError("not_found", "no such stroke on this page")
    return Response(status_code=204)
