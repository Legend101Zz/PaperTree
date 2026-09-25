"""contracts.md §2.2: upload, list, read, and the reader's document routes. S1 owns this next.

POST   /papers                     store bytes -> enqueue_parse -> {paper_id, job_id}
GET    /papers                     list_papers
GET    /papers/{id}                get_paper at the promoted generation
GET    /papers/{id}/ir             the shape indexDocument takes  <- the one that matters
GET    /papers/{id}/pages
GET    /papers/{id}/blocks
GET    /papers/{id}/relations
GET    /papers/{id}/blocks/{block_id}/location
GET    /papers/{id}/file           the original PDF, for pdf.js
GET    /papers/{id}/assets/{kind}/{block_id}   figure and equation crops
"""

from __future__ import annotations

import hashlib
from typing import Annotated, Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from papertree_db import BlockId, PaperId, generation
from papertree_document_worker.crops import CropStore
from papertree_document_worker.job import enqueue_parse
from pydantic import BaseModel

from ..deps import CallerDep, SettingsDep
from ..deps import promoted_or_404 as _promoted
from ..ir import block_location, paper_document

router = APIRouter()


class Upload(BaseModel):
    paper_id: str
    job_id: str
    #: False when these exact bytes were already uploaded — `enqueue_parse`'s idempotency key is
    #: `parse:{source_hash}:{paper_id}`, so the second upload returns the FIRST job rather than
    #: parsing again. The client needs to be able to tell those apart.
    created: bool


#: Crockford base32 — the alphabet `PaperId`'s pattern `^ppr_[0-9A-HJKMNP-TV-Z]{26}$` describes:
#: 0-9 and A-Z minus I, L, O and U, the four that are misread as 1, 1, 0 and V.
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def derive_paper_id(user_id: str, source_hash: str) -> str:
    """A `PaperId` that is a pure function of (user, bytes).

    DERIVED, NOT RANDOM, because `0001_core.sql:47` requires it: "a paper_id is minted ONCE per
    (owner, source_hash) and held fixed across every re-parse". Deriving means re-uploading the
    same PDF resolves to the same paper instead of a second copy, with no lookup — and since
    `enqueue_parse`'s idempotency key is `parse:{source_hash}:{paper_id}`, the duplicate upload
    returns the ORIGINAL job rather than parsing again.

    The `user_id` is in the digest, not the `OwnerId`: the handle is opaque and per-connection, so
    it would give a different id on every request. Including the user is what stops two people who
    upload the same public arXiv PDF — the ordinary case for this product — from colliding onto one
    row that only one of them can read. `tests/test_end_to_end.py` asserts both halves.

    THE SHAPE IS NOT FREE, and getting it wrong fails late: `PaperId`'s pattern is a 26-character
    Crockford base32 ULID, so a hex digest is REJECTED — by the validator inside the parse job,
    after the parse has already run:

        ValidationError: paper_id String should match pattern '^ppr_[0-9A-HJKMNP-TV-Z]{26}$'
        [input_value='pap_c12fe40e896a5ab4c580b0c4dc']

    The job then retried twice and dead-lettered, and the only symptom at the HTTP boundary was a
    paper that stayed PENDING. That is why `test_end_to_end` asserts on `job["state"]` rather than
    only on the upload's 202.
    """
    digest = hashlib.sha256(f"{user_id}:{source_hash}".encode()).digest()
    value = int.from_bytes(digest[:17], "big")  # 136 bits; 26 base32 chars carry 130
    out = []
    for _ in range(26):
        out.append(_CROCKFORD[value & 31])
        value >>= 5
    return "ppr_" + "".join(reversed(out))


def _public(row: Any) -> dict[str, Any]:
    """A DB row as a response body, minus `owner_id`.

    Every owned table carries `owner_id` and several of the reads here are `SELECT *`, so
    `dict(row)` puts an opaque owner handle straight into a JSON response — which is precisely what
    AGENTS.md §4 forbids, and it happened: `test_no_response_anywhere_carries_an_owner_handle`
    caught it on `GET /papers` in this PR before anything shipped.

    Stripping it centrally rather than per route is the point. A per-route `del` is one route away
    from being forgotten, and the failure mode is silent.
    """
    return {key: value for key, value in dict(row).items() if key != "owner_id"}


@router.post("/papers", response_model=Upload, status_code=status.HTTP_202_ACCEPTED)
async def upload(
    call: CallerDep,
    settings: SettingsDep,
    # `Annotated[..., File()]` rather than `= File(...)`: a call in a default argument is
    # what ruff's B008 flags. FastAPI accepts both; only this form is lint-clean.
    file: Annotated[UploadFile, File()],
) -> Upload:
    raw = await file.read()
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty upload")
    if not raw.startswith(b"%PDF-"):
        # The parser will fail on a non-PDF anyway; failing here means the caller learns it
        # synchronously instead of by polling a job that dead-letters.
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "not a PDF")

    source_hash = hashlib.sha256(raw).hexdigest()
    paper_id = derive_paper_id(call.user_id, source_hash)

    # 202 means "the bytes are safe and a job exists". Writing before enqueueing is the order
    # that makes that true: the reverse can hand a worker a path that is not there yet.
    target = settings.upload_root / f"{paper_id}.pdf"
    target.write_bytes(raw)

    known = {job.idempotency_key for job in call.store.list_jobs(call.store_owner)}
    key = f"parse:{source_hash}:{paper_id}"
    job_id = enqueue_parse(
        call.store,
        call.store_owner,
        paper_id=paper_id,
        source_path=str(target),
        source_hash=source_hash,
    )
    return Upload(paper_id=paper_id, job_id=job_id, created=key not in known)


@router.get("/papers")
async def list_papers(call: CallerDep) -> list[dict[str, Any]]:
    return [_public(row) for row in call.db.list_papers(call.db_owner)]


@router.get("/papers/{paper_id}")
async def get_paper(
    call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None
) -> dict[str, Any]:
    row = call.db.get_paper(
        call.db_owner, PaperId(paper_id), generation(_promoted(call, paper_id, gen))
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such paper")
    return _public(row)


@router.get("/papers/{paper_id}/ir")
async def get_ir(
    call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None
) -> dict[str, Any]:
    """The one that matters: the shape `indexDocument` takes. See `ir.py`."""
    document = paper_document(
        call.db, call.db_owner, PaperId(paper_id), generation(_promoted(call, paper_id, gen))
    )
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such paper")
    return document


@router.get("/papers/{paper_id}/pages")
async def pages(
    call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None
) -> list[dict[str, Any]]:
    g = generation(_promoted(call, paper_id, gen))
    return [_public(row) for row in call.db.list_pages(call.db_owner, PaperId(paper_id), g)]


@router.get("/papers/{paper_id}/blocks")
async def blocks(
    call: CallerDep,
    paper_id: str,
    page: Annotated[int | None, Query(ge=0)] = None,
    gen: Annotated[int | None, Query()] = None,
) -> list[dict[str, Any]]:
    g = generation(_promoted(call, paper_id, gen))
    if page is not None:
        rows = call.db.list_blocks_on_page(call.db_owner, PaperId(paper_id), g, page)
    else:
        # `/ir` is the complete view; this endpoint is for partial consumers and returns the
        # same set, page by page — NOT `list_blocks_in_doc_order`, which drops every non-body
        # block. See ir.py's header.
        rows = [
            row
            for p in call.db.list_pages(call.db_owner, PaperId(paper_id), g)
            for row in call.db.list_blocks_on_page(
                call.db_owner, PaperId(paper_id), g, p["page_index"]
            )
        ]
    return [_public(row) for row in rows]


@router.get("/papers/{paper_id}/relations")
async def relations(
    call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None
) -> list[dict[str, Any]]:
    g = generation(_promoted(call, paper_id, gen))
    return [_public(row) for row in call.db.list_relations(call.db_owner, PaperId(paper_id), g)]


@router.get("/papers/{paper_id}/blocks/{block_id}/location")
async def location(
    call: CallerDep, paper_id: str, block_id: str, gen: Annotated[int | None, Query()] = None
) -> dict[str, Any]:
    found = block_location(
        call.db,
        call.db_owner,
        PaperId(paper_id),
        generation(_promoted(call, paper_id, gen)),
        BlockId(block_id),
    )
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such block")
    return found


@router.get("/papers/{paper_id}/file")
async def original(call: CallerDep, settings: SettingsDep, paper_id: str) -> FileResponse:
    # The ownership check is `_promoted`, which is owner-scoped: a paper this caller cannot see
    # 404s BEFORE any path is built. The filename is the paper_id, so nothing user-supplied
    # ever reaches the filesystem.
    _promoted(call, paper_id, None)
    path = settings.upload_root / f"{paper_id}.pdf"
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "the original file is not on this host")
    return FileResponse(path, media_type="application/pdf")


@router.get("/papers/{paper_id}/assets/{kind}/{block_id}")
async def asset(
    call: CallerDep,
    settings: SettingsDep,
    paper_id: str,
    kind: str,
    block_id: str,
    gen: Annotated[int | None, Query()] = None,
) -> Response:
    g = _promoted(call, paper_id, gen)
    # Resolve the block through the OWNER-SCOPED query before touching disk: that is what
    # makes `kind`/`block_id` safe to interpolate into a path. A block id that does not belong
    # to this owner never reaches `CropStore`.
    if (
        block_location(call.db, call.db_owner, PaperId(paper_id), generation(g), BlockId(block_id))
        is None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such block")
    store = CropStore(root=settings.asset_root, paper_id=paper_id, generation=g)
    try:
        payload = store.read(kind, block_id)
    except (FileNotFoundError, OSError) as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no crop for that block") from exc
    # PNG at 3x is what `crops.py` writes today. F1.5 asks for WebP; that is Session B's #55.
    return Response(payload, media_type="image/png")
