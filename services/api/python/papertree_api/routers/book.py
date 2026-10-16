"""The opened book's routes (v0.2 S3, #200): a paper's figures, its cover plate and its abstract.

GET    /papers/{id}/figures    PaperFigure[]: every figure FOUND in the promoted parse, in reading
                               order, each with its caption, label, signed crop URL and an Anchor
PUT    /papers/{id}/plate      {anchor}: that figure becomes the cover; 204
DELETE /papers/{id}/plate      back to the typographic cover; 204 whether or not one was set
GET    /papers/{id}/abstract   PaperAbstract: the abstract's text and an Anchor on it

All four: 404 ``not_found`` for a paper that is not the caller's; the three that read the parse
answer 409 ``not_parsed`` until a generation is promoted (``/ir``'s rule). The plate is stored as
the Anchor the client sends back (minus its ``resolution`` cache), after two checks: it is on this
paper's bytes (422 ``anchor_mismatch``) and it finds a figure of the promoted generation by the
rule the library reads it with (``papertree_db.plate``; 422 ``validation_failed`` otherwise).
"""

from __future__ import annotations

import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import Response
from papertree_db import PaperId, generation
from pydantic_core import from_json

from ..deps import Caller, CallerDep, DocumentsDep, SettingsDep
from ..errors import ApiError
from ..figures import asset_signer, paper_abstract, paper_figures
from ..schemas import PaperAbstract, PaperFigure, PlatePut
from ._shared import json_body
from .threads import check_anchor

router = APIRouter()


def _owned(call: Caller, paper_id: str) -> Any:
    """The caller's ``paper_owners`` row, or 404."""
    row = call.db.owned_paper(call.db_owner, PaperId(paper_id))
    if row is None:
        raise ApiError("not_found", "no such paper")
    return row


def _promoted(call: Caller, paper_id: str) -> int:
    """The promoted generation of one of the caller's papers; 404, or 409 while it is read."""
    _owned(call, paper_id)
    promoted = call.db.promoted_generation(call.db_owner, PaperId(paper_id))
    if promoted is None:
        raise ApiError("not_parsed", "this paper has not been parsed yet", retryable=True)
    return promoted


@router.get("/papers/{paper_id}/figures", response_model=list[PaperFigure])
async def figures(
    request: Request,
    call: CallerDep,
    settings: SettingsDep,
    documents: DocumentsDep,
    paper_id: str,
) -> list[PaperFigure]:
    """Every figure block of the promoted generation, in reading order (see ``PaperFigure``)."""
    gen = _promoted(call, paper_id)
    document = documents.get(call.db, call.db_owner, call.user_id, paper_id, gen)
    if document is None:
        raise ApiError("not_found", "no such paper")
    relations = call.db.list_relations(call.db_owner, PaperId(paper_id), generation(gen))
    sign = asset_signer(str(request.base_url), settings.signing_secret, time.time())
    return paper_figures(document, relations, lambda uri: sign(paper_id, uri))


@router.put("/papers/{paper_id}/plate", status_code=status.HTTP_204_NO_CONTENT)
async def put_plate(
    request: Request,
    call: CallerDep,
    paper_id: str,
    body: Annotated[PlatePut, Depends(json_body(PlatePut))],
) -> Response:
    """Makes the figure ``body.anchor`` names the paper's cover (replacing any earlier choice)."""
    owned = _owned(call, paper_id)
    gen = _promoted(call, paper_id)
    # The anchor as the client sent it (validated as `PlatePut` above), minus the T0 cache.
    raw = from_json(await request.body())
    anchor = {k: v for k, v in dict(raw["anchor"]).items() if k != "resolution"}
    check_anchor(anchor, paper_id, str(owned["source_hash"]))
    if body.anchor.targetKind != "figure" or (
        call.db.plate_figure(call.db_owner, PaperId(paper_id), generation(gen), anchor) is None
    ):
        raise ApiError("validation_failed", "anchor: it names no figure of this paper")
    call.db.set_plate(call.db_owner, PaperId(paper_id), anchor)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/papers/{paper_id}/plate", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plate(call: CallerDep, paper_id: str) -> Response:
    """The typographic cover again. Idempotent: no plate set is still 204."""
    _owned(call, paper_id)
    call.db.clear_plate(call.db_owner, PaperId(paper_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/papers/{paper_id}/abstract", response_model=PaperAbstract)
async def abstract(call: CallerDep, documents: DocumentsDep, paper_id: str) -> PaperAbstract:
    """The abstract the parser found in the promoted generation; all null when it found none."""
    gen = _promoted(call, paper_id)
    document = documents.get(call.db, call.db_owner, call.user_id, paper_id, gen)
    paper = call.db.get_paper(call.db_owner, PaperId(paper_id), generation(gen))
    if document is None or paper is None:
        raise ApiError("not_found", "no such paper")
    return paper_abstract(document, paper["metadata"])
