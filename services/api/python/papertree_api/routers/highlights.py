"""contracts.md §2.4 on 0005's schema: list, create, patch, delete, and the resolution cache. S4.

    GET|POST      /papers/{id}/highlights
    PUT           /papers/{id}/highlights/resolutions
    PATCH|DELETE  /papers/{id}/highlights/{highlight_id}

Registration order is GET, POST, PUT `/resolutions`, PATCH, DELETE: `PUT …/resolutions` and
`PATCH|DELETE …/{highlight_id}` differ by method, so `/resolutions` never shadows a highlight id.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from papertree_db import (
    SQLITE_INTEGER_MAX,
    AnchorIn,
    HighlightWithAnchors,
    PaperId,
    ResolutionIn,
)
from pydantic import BaseModel, Field

from ..deps import Caller, CallerDep
from ..errors import ApiError
from ._shared import GenParam, read_json

router = APIRouter()

# MOVED HERE FROM `app.py` (S0b's router split). The error envelope and the body parser are now
# the shared ones (`errors.py`, `_shared.read_json`), which are wave 1's, generalised: "422
# validation_failed naming the first failing field", "never 500 on a bad body" and "never a partial
# write" hold for every route, not only these.
#
# Every integer a body or `?gen=` carries is bounded to SQLite's INTEGER (`SQLITE_INTEGER_MAX`)
# here AND in `papertree_db.highlights`: JSON integers are unbounded, and one past 2**63-1 raised
# OverflowError at the SQL bind, a 500 (S0 review F1).

#: contracts.md §2.4.
HighlightColor = Literal["amber", "green", "blue", "pink", "purple"]


class _AnchorItem(BaseModel):
    anchor: dict[str, Any]


class _ResolutionItem(BaseModel):
    anchor_id: str = Field(min_length=1)
    tier: int = Field(ge=0, le=6)
    state: Literal["anchored", "approximate", "orphan"]
    block_ids: list[str]
    score: float | None = Field(default=None, ge=0, le=1)
    reason: str | None = None
    resolver_version: str = Field(min_length=1)


class _CreateResolution(_ResolutionItem):
    generation: int = Field(ge=1, le=SQLITE_INTEGER_MAX)


class _HighlightCreate(BaseModel):
    highlight_id: str = Field(pattern=r"^[a-z]{2,4}_[0-9A-Za-z-]{8,64}$")
    color: HighlightColor
    note: str | None = None
    anchors: list[_AnchorItem] = Field(min_length=1, max_length=64)
    resolutions: list[_CreateResolution] = Field(default_factory=list)


class _HighlightPatch(BaseModel):
    color: HighlightColor | None = None
    note: str | None = None


class _PutItem(_ResolutionItem):
    upgraded_anchor: dict[str, Any] | None = None


class _ResolutionsPut(BaseModel):
    generation: int = Field(ge=1, le=SQLITE_INTEGER_MAX)
    items: list[_PutItem] = Field(max_length=500)


def _wire_time(stored: str) -> str:
    """A stored time in contracts.md §0's shape, `2026-09-25T15:09:25.123Z`.

    The store stamps `datetime.isoformat()` (`…274228+00:00`), and a legacy 0001 row keeps what
    its runner wrote, so the one wire shape is made here, on the way out. Every writer in this
    repo stamps UTC, so a time without an offset is read as UTC. A value that is not a time at all
    is returned as stored: listing a user's highlights must not fail over a timestamp.
    """
    try:
        moment = datetime.fromisoformat(stored)
    except ValueError:
        return stored
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    moment = moment.astimezone(UTC)
    return f"{moment:%Y-%m-%dT%H:%M:%S}.{moment.microsecond // 1000:03d}Z"


def _owned_or_404(call: Caller, paper_id: str) -> None:
    if call.db.owned_paper(call.db_owner, PaperId(paper_id)) is None:
        raise ApiError("not_found", "no such paper")


def _highlight_wire(highlight: HighlightWithAnchors) -> dict[str, Any]:
    """contracts.md §2.4 `Highlight`. Built field by field: nothing here can carry `owner_id`."""
    return {
        "highlight_id": highlight.highlight_id,
        "color": highlight.color,
        "note": highlight.note,
        "created_generation": highlight.created_generation,
        "created_at": _wire_time(highlight.created_at),
        "updated_at": _wire_time(highlight.updated_at),
        "anchors": [
            {
                "anchor_id": anchor.anchor_id,
                "ordinal": anchor.ordinal,
                "anchor": anchor.anchor,
                "resolution": None
                if anchor.resolution is None
                else {
                    "generation": anchor.resolution.generation,
                    "tier": anchor.resolution.tier,
                    "state": anchor.resolution.state,
                    "block_ids": list(anchor.resolution.block_ids),
                    "score": anchor.resolution.score,
                    "reason": anchor.resolution.reason,
                    "resolver_version": anchor.resolution.resolver_version,
                },
            }
            for anchor in highlight.anchors
        ],
    }


@router.get("/papers/{paper_id}/highlights")
async def list_highlights(call: CallerDep, paper_id: str, gen: GenParam) -> Response:
    """Every highlight, INCLUDING orphans and legacy rows, with each anchor's cache entry for
    `?gen=` (default: the promoted generation; none promoted means every resolution is null)."""
    _owned_or_404(call, paper_id)
    if gen is None:
        gen = call.db.promoted_generation(call.db_owner, PaperId(paper_id))
    rows = call.db.list_highlights(call.db_owner, PaperId(paper_id), gen)
    return JSONResponse([_highlight_wire(row) for row in rows])


@router.post("/papers/{paper_id}/highlights")
async def create_highlight(call: CallerDep, paper_id: str, request: Request) -> Response:
    """201 on create, 200 on an idempotent replay (same `highlight_id` and body). One
    transaction: the highlight, every anchor and every resolution, or nothing.

    The data layer's refusals (`HighlightRejected`, `PaperNotFound`, `GenerationNotFound`) are
    not caught here: `errors.py` maps each to its contract code for every route at once."""
    body, _ = await read_json(request, _HighlightCreate)
    _owned_or_404(call, paper_id)
    promoted = call.db.promoted_generation(call.db_owner, PaperId(paper_id))
    if promoted is None:
        # In this release the reader enables Highlight only once the IR is loaded, and a
        # highlight's `created_generation` is the promoted one (contracts.md §2.4).
        raise ApiError("not_parsed", "this paper has not been parsed yet")
    stored = call.db.create_highlight(
        call.db_owner,
        PaperId(paper_id),
        highlight_id=body.highlight_id,
        color=body.color,
        note=body.note,
        created_generation=promoted,
        anchors=[AnchorIn(item.anchor) for item in body.anchors],
        resolutions=[
            ResolutionIn(
                anchor_id=r.anchor_id,
                generation=r.generation,
                tier=r.tier,
                state=r.state,
                block_ids=r.block_ids,
                score=r.score,
                reason=r.reason,
                resolver_version=r.resolver_version,
            )
            for r in body.resolutions
        ],
    )
    highlight = call.db.get_highlight(
        call.db_owner, PaperId(paper_id), stored.highlight_id, promoted
    )
    assert highlight is not None  # stored one statement ago, in a committed transaction
    return JSONResponse(_highlight_wire(highlight), status_code=201 if stored.created else 200)


@router.put("/papers/{paper_id}/highlights/resolutions")
async def put_resolutions(call: CallerDep, paper_id: str, request: Request) -> Response:
    """Upserts the T0 cache for one generation; an `upgraded_anchor` replaces a legacy-0001
    record in the same transaction (contracts.md §2.4, ADR-002 §6.3)."""
    body, _ = await read_json(request, _ResolutionsPut)
    _owned_or_404(call, paper_id)
    with call.db.transaction():
        for item in body.items:
            if item.upgraded_anchor is not None:
                call.db.upgrade_legacy_anchor(
                    call.db_owner,
                    PaperId(paper_id),
                    item.anchor_id,
                    item.upgraded_anchor,
                )
        call.db.put_resolutions(
            call.db_owner,
            PaperId(paper_id),
            body.generation,
            [
                ResolutionIn(
                    anchor_id=item.anchor_id,
                    generation=body.generation,
                    tier=item.tier,
                    state=item.state,
                    block_ids=item.block_ids,
                    score=item.score,
                    reason=item.reason,
                    resolver_version=item.resolver_version,
                )
                for item in body.items
            ],
        )
    return Response(status_code=204)


@router.patch("/papers/{paper_id}/highlights/{highlight_id}")
async def update_highlight(
    call: CallerDep, paper_id: str, highlight_id: str, request: Request
) -> Response:
    """`{color?, note?}`. An absent field is unchanged; `note: null` clears the note."""
    body, _ = await read_json(request, _HighlightPatch)
    _owned_or_404(call, paper_id)
    given = body.model_fields_set
    if "color" in given and body.color is None:
        raise ApiError("validation_failed", "color: may not be null")
    note = None if "note" not in given else (body.note if body.note is not None else "")
    updated = call.db.update_highlight(
        call.db_owner, PaperId(paper_id), highlight_id, color=body.color, note=note
    )
    if updated is None:
        raise ApiError("not_found", "no such highlight on this paper")
    highlight = call.db.get_highlight(
        call.db_owner,
        PaperId(paper_id),
        highlight_id,
        call.db.promoted_generation(call.db_owner, PaperId(paper_id)),
    )
    assert highlight is not None
    return JSONResponse(_highlight_wire(highlight))


@router.delete("/papers/{paper_id}/highlights/{highlight_id}")
async def delete_highlight(call: CallerDep, paper_id: str, highlight_id: str) -> Response:
    _owned_or_404(call, paper_id)
    if call.db.delete_highlight(call.db_owner, PaperId(paper_id), highlight_id) == 0:
        raise ApiError("not_found", "no such highlight on this paper")
    return Response(status_code=204)
