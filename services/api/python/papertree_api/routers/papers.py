"""contracts.md §2.2 and §2.3: upload, the library, one paper, delete, retry, re-parse, and the
reader's document routes. S1 owns this module.

POST   /papers                     the bytes -> uploads/<id>.pdf, a paper_owners row, a parse job
GET    /papers                     LibraryPaper[], one per paper, newest first
GET    /papers/{id}                one LibraryPaper
DELETE /papers/{id}                the rows, the paper's jobs, its upload, crops and staging
POST   /papers/{id}/retry          the dead-lettered generation again, as a new attempt
POST   /papers/{id}/reparse        generation next_generation
GET    /papers/{id}/file           the original PDF: gated on OWNERSHIP, not on a parse
GET    /papers/{id}/ir             PaperIR 1.0.0 with every asset:// URI signed; 409 until parsed
GET    /papers/{id}/assets/{kind}/{block_id}   a crop, for a signed URL or a Bearer
GET    /papers/{id}/pages · /blocks · /relations · /blocks/{block_id}/location   (unchanged)
"""

from __future__ import annotations

import hashlib
import os
import shutil
import time
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import FileResponse, JSONResponse, Response
from papertree_db import SQLITE_INTEGER_MAX, BlockId, PaperId, PaperTreeDb, generation
from papertree_document_worker.crops import CropStore
from papertree_document_worker.pdf import pymupdf
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from .. import assets
from ..deps import AuthConnDep, Caller, CallerDep, SettingsDep, open_database
from ..deps import promoted_or_404 as _promoted
from ..errors import BODY_UNPARSEABLE, ApiError
from ..ir import block_location, paper_document
from ..library import (
    BUSY_STATES,
    Enqueued,
    enqueue,
    library_paper,
    next_attempt,
    parse_jobs,
    plan_upload,
)
from ..logging import user_ref
from ..schemas import JobAccepted, LibraryPaper, ReparseRequest, UploadAccepted
from ..security import user_for_token
from ..settings import Settings
from ._shared import GenParam, json_body, public_row

router = APIRouter()

#: Crockford base32 — the alphabet `PaperId`'s pattern `^ppr_[0-9A-HJKMNP-TV-Z]{26}$` describes:
#: 0-9 and A-Z minus I, L, O and U, the four that are misread as 1, 1, 0 and V.
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

#: `Content-Length` may exceed the file by its multipart framing (boundaries, part headers, the
#: filename). This much slack keeps a file of exactly the cap acceptable; the FILE is then held to
#: the cap to the byte.
_MULTIPART_SLACK: Final = 64 * 1024

#: `GET /papers/{id}/file`: the bytes of a paper never change (its id is derived from them).
_IMMUTABLE: Final = "private, max-age=31536000, immutable"


def derive_paper_id(user_id: str, source_hash: str) -> str:
    """A `PaperId` that is a pure function of (user, bytes).

    DERIVED, NOT RANDOM, because `0001_core.sql:47` requires it: "a paper_id is minted ONCE per
    (owner, source_hash) and held fixed across every re-parse". Deriving means re-uploading the
    same PDF resolves to the same paper instead of a second copy, with no lookup.

    `source_hash` is the BARE hex digest, as it always was: the ids of every paper already stored
    depend on it. The `user_id` is in the digest, not the `OwnerId`: the handle is opaque and
    per-connection, so it would give a different id on every request. Including the user is what
    stops two people who upload the same public arXiv PDF from colliding onto one row that only one
    of them can read. `tests/test_end_to_end.py` asserts both halves.

    THE SHAPE IS NOT FREE: `PaperId`'s pattern is a 26-character Crockford base32 ULID, so a hex
    digest is REJECTED — by the validator inside the parse job, after the parse has already run.
    """
    digest = hashlib.sha256(f"{user_id}:{source_hash}".encode()).digest()
    value = int.from_bytes(digest[:17], "big")  # 136 bits; 26 base32 chars carry 130
    out = []
    for _ in range(26):
        out.append(_CROCKFORD[value & 31])
        value >>= 5
    return "ppr_" + "".join(reversed(out))


# ── upload ───────────────────────────────────────────────────────────────────────────────────


class _TooLarge(MultiPartException):
    """Raised from inside the multipart parser's stream, so it closes its spooled files."""


def _too_large(cap: int) -> ApiError:
    return ApiError(
        "payload_too_large", f"the file is larger than the {cap // (1024 * 1024)} MB upload limit"
    )


async def _read_upload(request: Request, cap: int) -> tuple[bytes, str | None]:
    """The `file` part of a multipart body, refused as 413 the moment it passes `cap`.

    Parsed HERE rather than by a FastAPI `File()` parameter because FastAPI reads the whole body
    before a route or a dependency runs: a 5 GB upload would be received and spooled to disk before
    anything could say 413. Here a `Content-Length` over the cap is refused before a byte is read,
    and a body without one (chunked) is refused as soon as it passes the cap.
    """
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdecimal() and int(declared) > cap + _MULTIPART_SLACK:
        raise _too_large(cap)
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
        raise ApiError("validation_failed", "file: Field required")

    async def capped() -> AsyncGenerator[bytes, None]:
        received = 0
        async for chunk in request.stream():
            received += len(chunk)
            if received > cap + _MULTIPART_SLACK:
                raise _TooLarge("too large")
            yield chunk

    parser = MultiPartParser(request.headers, capped(), max_files=1, max_fields=16)
    try:
        form = await parser.parse()
    except _TooLarge:
        raise _too_large(cap) from None
    except MultiPartException:
        raise ApiError("validation_failed", BODY_UNPARSEABLE) from None
    try:
        part = form.get("file")
        if not isinstance(part, UploadFile):
            raise ApiError("validation_failed", "file: Field required")
        if part.size is not None and part.size > cap:
            raise _too_large(cap)
        raw = await part.read(cap + 1)
        if len(raw) > cap:
            raise _too_large(cap)
        return raw, part.filename
    finally:
        await form.close()


def _page_count(raw: bytes) -> int | None:
    """contracts.md §2.2: from ONE PyMuPDF open of the bytes already in memory (MEASURED 0.19-0.58
    ms). None when PyMuPDF cannot open them: the upload is still accepted, and the parse job says
    why it cannot read them (`pdf_unreadable`), which is where the library shows it."""
    try:
        document = pymupdf.open(stream=raw, filetype="pdf")
    except (RuntimeError, ValueError):
        return None
    try:
        return int(document.page_count)
    finally:
        document.close()


def _clean_filename(name: str | None) -> str | None:
    """Metadata only, never a path (the file is stored as `<paper_id>.pdf`). The browser's name
    without any directory part, bounded, and None when empty."""
    if not name:
        return None
    base = name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    return base[:255] or None


def _write_upload(target: Path, raw: bytes) -> None:
    """Whole or not at all: a worker opening the file mid-write must never see half a PDF."""
    partial = target.with_name(f".{target.name}.{os.getpid()}.part")
    partial.write_bytes(raw)
    os.replace(partial, target)


@router.post("/papers", response_model=UploadAccepted, status_code=status.HTTP_202_ACCEPTED)
async def upload(request: Request, call: CallerDep, settings: SettingsDep) -> UploadAccepted:
    raw, filename = await _read_upload(request, settings.max_upload_bytes)
    if not raw:
        raise ApiError("empty_upload", "empty upload")
    if not raw.startswith(b"%PDF-"):
        # The parser would fail on a non-PDF anyway; failing here means the caller learns it
        # synchronously instead of by polling a job that dead-letters.
        raise ApiError("unsupported_media_type", "not a PDF")

    hex_digest = hashlib.sha256(raw).hexdigest()
    source_hash = f"sha256:{hex_digest}"
    paper_id = PaperId(derive_paper_id(call.user_id, hex_digest))
    page_count = _page_count(raw)

    # 202 means "the bytes are safe, the paper is listed, and a job exists", in that order: a
    # worker is never handed a path that is not there yet, and the library never lists a job for
    # a paper it cannot show (between registration and enqueue the row is `queued`, job null).
    target = settings.upload_root / f"{paper_id}.pdf"
    _write_upload(target, raw)
    call.db.register_upload(
        call.db_owner, paper_id, source_hash, _clean_filename(filename), len(raw), page_count
    )

    jobs = parse_jobs(call.store, call.store_owner, paper_id)
    latest = jobs[0] if jobs else None
    plan = plan_upload(call.db, call.db_owner, latest, paper_id)
    if plan is None:
        assert latest is not None
        accepted = Enqueued(job_id=latest.job_id, generation=None, created=False)
    else:
        gen, attempt_seq = plan
        accepted = enqueue(
            call.store,
            call.store_owner,
            paper_id=paper_id,
            source_path=str(target),
            source_hash=source_hash,
            generation=gen,
            attempt_seq=attempt_seq,
        )
    call.db.set_latest_job(call.db_owner, paper_id, accepted.job_id)
    return UploadAccepted(
        paper_id=paper_id,
        job_id=accepted.job_id,
        created=accepted.created,
        paper=_library_paper(call, paper_id),
    )


# ── the library ──────────────────────────────────────────────────────────────────────────────


def _library_paper(call: Caller, paper_id: str) -> LibraryPaper:
    row = call.db.library_row(call.db_owner, PaperId(paper_id))
    if row is None:
        raise ApiError("not_found", "no such paper")
    return library_paper(row)


@router.get("/papers", response_model=list[LibraryPaper])
async def list_papers(call: CallerDep) -> list[LibraryPaper]:
    return [library_paper(row) for row in call.db.list_library(call.db_owner)]


@router.get("/papers/{paper_id}", response_model=LibraryPaper)
async def get_paper(call: CallerDep, paper_id: str, gen: GenParam) -> LibraryPaper:
    """The paper's library row. `?gen=` (kept from the pre-release route) answers 404 unless that
    generation is stored; the row itself always describes the paper and its promoted generation."""
    paper = _library_paper(call, paper_id)
    if gen is not None and gen not in call.db.list_generations(call.db_owner, PaperId(paper_id)):
        raise ApiError("not_found", "no such generation")
    return paper


# ── delete, retry, re-parse ──────────────────────────────────────────────────────────────────


def _remove_files(settings: Settings, paper_id: str) -> None:
    """The paper's upload, crops and staged documents. Paths are built from a `paper_id` this
    owner was just shown to hold, never from anything else the request carried."""
    (settings.upload_root / f"{paper_id}.pdf").unlink(missing_ok=True)
    shutil.rmtree(settings.asset_root / paper_id, ignore_errors=True)
    for staged in settings.staging_root.glob(f"{paper_id}.*"):
        staged.unlink(missing_ok=True)


@router.delete("/papers/{paper_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_paper(call: CallerDep, settings: SettingsDep, paper_id: str) -> Response:
    """204: the paper's jobs, then its rows (the `delete_paper` cascade: generations, highlights,
    threads, the board), then `uploads/<id>.pdf`, `assets/<id>/` and staging.

    Jobs FIRST: a worker mid-parse holds a lease on a job row, and every checkpoint it makes is
    fenced on that row, so once the row is gone it writes nothing more (`job.py`). The reverse
    order would leave a window in which its persist step re-creates the paper just deleted."""
    if call.db.owned_paper(call.db_owner, PaperId(paper_id)) is None:
        raise ApiError("not_found", "no such paper")
    for job in parse_jobs(call.store, call.store_owner, paper_id):
        call.store.delete_job(call.store_owner, job.job_id)
    call.db.delete_paper(call.db_owner, PaperId(paper_id))
    _remove_files(settings, paper_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _owned_source(call: Caller, settings: Settings, paper_id: str) -> tuple[str, str]:
    """`(source_path, source_hash)` of one of the caller's papers, or 404."""
    row = call.db.owned_paper(call.db_owner, PaperId(paper_id))
    if row is None:
        raise ApiError("not_found", "no such paper")
    return str(settings.upload_root / f"{paper_id}.pdf"), str(row["source_hash"])


@router.post(
    "/papers/{paper_id}/retry", response_model=JobAccepted, status_code=status.HTTP_202_ACCEPTED
)
async def retry_paper(call: CallerDep, settings: SettingsDep, paper_id: str) -> JobAccepted:
    """202: the same generation, a new `attempt_seq`; 409 `not_failed` unless dead-lettered."""
    source_path, source_hash = _owned_source(call, settings, paper_id)
    jobs = parse_jobs(call.store, call.store_owner, paper_id)
    if not jobs or jobs[0].state != "dead_letter":
        raise ApiError("not_failed", "the paper's latest parse has not failed; nothing to retry")
    gen, attempt_seq = next_attempt(jobs[0])
    accepted = enqueue(
        call.store,
        call.store_owner,
        paper_id=paper_id,
        source_path=source_path,
        source_hash=source_hash,
        generation=gen,
        attempt_seq=attempt_seq,
    )
    call.db.set_latest_job(call.db_owner, PaperId(paper_id), accepted.job_id)
    return JobAccepted(job_id=accepted.job_id, generation=gen)


@router.post(
    "/papers/{paper_id}/reparse", response_model=JobAccepted, status_code=status.HTTP_202_ACCEPTED
)
async def reparse_paper(
    call: CallerDep,
    settings: SettingsDep,
    paper_id: str,
    body: Annotated[ReparseRequest, Depends(json_body(ReparseRequest))],
) -> JobAccepted:
    """202 with `generation = next_generation`; 409 `busy` while a parse is pending or running.
    The promoted generation stays what readers get until the new one is promoted (§2.2)."""
    source_path, source_hash = _owned_source(call, settings, paper_id)
    if any(job.state in BUSY_STATES for job in parse_jobs(call.store, call.store_owner, paper_id)):
        raise ApiError("busy", "this paper is already being parsed")
    gen = call.db.next_generation(call.db_owner, PaperId(paper_id))
    accepted = enqueue(
        call.store,
        call.store_owner,
        paper_id=paper_id,
        source_path=source_path,
        source_hash=source_hash,
        generation=gen,
        attempt_seq=1,
    )
    call.db.set_latest_job(call.db_owner, PaperId(paper_id), accepted.job_id)
    return JobAccepted(job_id=accepted.job_id, generation=gen)


# ── the reader's documents ───────────────────────────────────────────────────────────────────


@router.get("/papers/{paper_id}/ir")
async def get_ir(
    request: Request, call: CallerDep, settings: SettingsDep, paper_id: str, gen: GenParam
) -> JSONResponse:
    """PaperIR 1.0.0 of the promoted generation (or `?gen=`), gzip (`CompressJson`), with every
    `asset://` crop URI rewritten to a signed absolute URL (§2.3). 409 `not_parsed` while the paper
    is the caller's but nothing is promoted: the reader keeps Source mode working meanwhile."""
    if gen is None:
        if call.db.owned_paper(call.db_owner, PaperId(paper_id)) is None:
            raise ApiError("not_found", "no such paper")
        promoted = call.db.promoted_generation(call.db_owner, PaperId(paper_id))
        if promoted is None:
            raise ApiError("not_parsed", "this paper has not been parsed yet", retryable=True)
        gen = promoted
    document = paper_document(call.db, call.db_owner, PaperId(paper_id), generation(gen))
    if document is None:
        raise ApiError("not_found", "no such paper")
    base = str(request.base_url)
    exp = int(time.time()) + assets.SIGNED_URL_SECONDS
    secret = settings.signing_secret
    assets.rewrite_asset_uris(
        document,
        paper_id=paper_id,
        url_for=lambda g, kind, block_id: assets.signed_url(
            base, secret, paper_id=paper_id, gen=g, kind=kind, block_id=block_id, exp=exp
        ),
    )
    return JSONResponse(document)


@router.get("/papers/{paper_id}/pages")
async def pages(call: CallerDep, paper_id: str, gen: GenParam) -> list[dict[str, Any]]:
    g = generation(_promoted(call, paper_id, gen))
    return [public_row(row) for row in call.db.list_pages(call.db_owner, PaperId(paper_id), g)]


@router.get("/papers/{paper_id}/blocks")
async def blocks(
    call: CallerDep,
    paper_id: str,
    gen: GenParam,
    page: Annotated[int | None, Query(ge=0, le=SQLITE_INTEGER_MAX)] = None,
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
    return [public_row(row) for row in rows]


@router.get("/papers/{paper_id}/relations")
async def relations(call: CallerDep, paper_id: str, gen: GenParam) -> list[dict[str, Any]]:
    g = generation(_promoted(call, paper_id, gen))
    return [public_row(row) for row in call.db.list_relations(call.db_owner, PaperId(paper_id), g)]


@router.get("/papers/{paper_id}/blocks/{block_id}/location")
async def location(call: CallerDep, paper_id: str, block_id: str, gen: GenParam) -> dict[str, Any]:
    found = block_location(
        call.db,
        call.db_owner,
        PaperId(paper_id),
        generation(_promoted(call, paper_id, gen)),
        BlockId(block_id),
    )
    if found is None:
        raise ApiError("not_found", "no such block")
    return found


@router.get("/papers/{paper_id}/file")
async def original(
    request: Request, call: CallerDep, settings: SettingsDep, paper_id: str
) -> Response:
    """The uploaded PDF, for pdf.js. GATED ON OWNERSHIP, NOT ON PROMOTION (§2.2): the reader shows
    the pages while the parse is still running, and a failed parse still has a readable PDF.

    `owned_paper` is owner-scoped, so a paper this caller cannot see 404s BEFORE any path is built,
    and the filename is the paper id, so nothing user-supplied reaches the filesystem. The ETag is
    the content hash itself: the bytes behind a paper id never change."""
    row = call.db.owned_paper(call.db_owner, PaperId(paper_id))
    if row is None:
        raise ApiError("not_found", "no such paper")
    path = settings.upload_root / f"{paper_id}.pdf"
    if not path.is_file():
        raise ApiError("not_found", "the original file is not on this host")
    headers = {"ETag": f'"{row["source_hash"]}"', "Cache-Control": _IMMUTABLE}
    wanted = request.headers.get("if-none-match")
    if wanted is not None and headers["ETag"] in {tag.strip() for tag in wanted.split(",")}:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return FileResponse(path, media_type="application/pdf", headers=headers)


@router.get("/papers/{paper_id}/assets/{kind}/{block_id}")
async def asset(
    request: Request,
    settings: SettingsDep,
    auth_conn: AuthConnDep,
    db: Annotated[PaperTreeDb, Depends(open_database)],
    paper_id: str,
    kind: str,
    block_id: str,
    gen: GenParam,
) -> Response:
    """A crop PNG, for `?gen=&exp=&sig=` (§2.3: what an `<img>` sends) OR a Bearer. 401
    `auth_required` when neither is valid.

    A valid signature names ONE (paper, generation, kind, block) and resolves the paper's owner
    through `asset_grant`; from there every read is owner-scoped, exactly as for a Bearer."""
    query = request.query_params
    user_id: str | None = None
    signed = ("sig" in query or "exp" in query) and assets.verify(
        settings.signing_secret,
        paper_id=paper_id,
        gen=gen,
        kind=kind,
        block_id=block_id,
        exp=query.get("exp"),
        sig=query.get("sig"),
        now=time.time(),
    )
    if signed:
        user_id = db.asset_grant(PaperId(paper_id))
        if user_id is None:  # signed, and the paper is gone since
            raise ApiError("not_found", "no such paper")
    if user_id is None:
        header = request.headers.get("authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() == "bearer" and token.strip():
            user_id = user_for_token(auth_conn, token.strip())
    if user_id is None:
        raise ApiError(
            "auth_required",
            "a signed asset URL or a session token is required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    request.state.user_ref = user_ref(user_id)
    owner = db.owner_for(user_id)

    if gen is None:
        g = db.promoted_generation(owner, PaperId(paper_id))
        if g is None:
            raise ApiError("not_found", "no such paper")
    else:
        g = gen
    # Resolve the block through the OWNER-SCOPED query before touching disk: that is what makes
    # `kind`/`block_id` safe to put in a path. A block this owner does not have never reaches
    # `CropStore`, and neither does a kind the parser does not write.
    if kind not in assets.ASSET_KINDS or (
        block_location(db, owner, PaperId(paper_id), generation(g), BlockId(block_id)) is None
    ):
        raise ApiError("not_found", "no such block")
    store = CropStore(root=settings.asset_root, paper_id=paper_id, generation=g)
    try:
        payload = store.read(kind, block_id)
    except OSError as exc:
        raise ApiError("not_found", "no crop for that block") from exc
    # PNG at 3x is what `crops.py` writes. A crop of one generation never changes.
    return Response(
        payload, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )
