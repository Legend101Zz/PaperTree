"""The HTTP surface #74 specifies. A TRANSPORT, NOT A REWRITE.

Every route below is a shape change plus one or two calls into `packages/db`, `packages/jobs` or
`services/document-worker`. If business logic starts appearing here, it is being built beside
something that already exists — `PaperTreeDb` is a complete owner-scoped data layer with 25
methods and `job.py` already has `enqueue_parse` / `make_parse_handler` / `build_runner`.

The surface, against #74's table:

    POST   /auth/register              create_user + credentials + session
    POST   /auth/login                 verify + session
    POST   /auth/logout                delete the session row
    GET    /auth/me
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
    POST   /papers/{id}/ask           the grounded agent turn (#76)  <- see ask.py
    GET    /jobs/{id}                  parse status - makes the library's PENDING state real
    GET|POST  /papers/{id}/highlights          contracts.md §2.4 on 0005's schema (S0)
    PATCH|DELETE  /papers/{id}/highlights/{highlight_id}
    PUT   /papers/{id}/highlights/resolutions

`OwnerId` never appears in a request or a response. See `deps.py`.
"""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from papertree_agent_tools import Transport
from papertree_db import (
    SQLITE_INTEGER_MAX,
    AnchorIn,
    BlockId,
    GenerationNotFound,
    HighlightRejected,
    HighlightWithAnchors,
    PaperId,
    PaperNotFound,
    ResolutionIn,
    generation,
)
from papertree_document_worker.crops import CropStore
from papertree_document_worker.job import enqueue_parse
from pydantic import BaseModel, Field, ValidationError

from .ask import mount_ask
from .deps import AuthConnDep, Caller, CallerDep, SettingsDep
from .deps import promoted_or_404 as _promoted
from .ir import block_location, paper_document
from .security import create_session, hash_password, now_iso, revoke_session, verify_password
from .settings import Settings

# ─── request/response bodies ──────────────────────────────────────────────────────────────────


class Credentials(BaseModel):
    # A constrained `str`, not pydantic's `EmailStr`. `EmailStr` needs `email-validator`, which
    # needs `dnspython` — two packages for a check that guards nothing here. `users.email` is a
    # unique login string; no mail is sent, no address is trusted, and RFC 5322 conformance is not
    # a security property. The pattern rejects the typo class (no `@`, no dot, whitespace) and
    # stops there. If this service ever sends mail, that is the moment to add the dependency.
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    # 8 is the floor, not a policy. A policy belongs in a product decision nobody has made;
    # accepting a one-character password because no rule was written is worse than a stated floor.
    password: str = Field(min_length=8, max_length=1024)


class Session(BaseModel):
    token: str
    user_id: str
    email: str


class Upload(BaseModel):
    paper_id: str
    job_id: str
    #: False when these exact bytes were already uploaded — `enqueue_parse`'s idempotency key is
    #: `parse:{source_hash}:{paper_id}`, so the second upload returns the FIRST job rather than
    #: parsing again. The client needs to be able to tell those apart.
    created: bool


# ─── helpers ──────────────────────────────────────────────────────────────────────────────────


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


def create_app(
    settings: Settings | None = None, *, llm_transport: Transport | None = None
) -> FastAPI:
    """`llm_transport` is the ONE seam that lets `/ask` be tested without a socket.

    It is a constructor argument rather than an environment variable because a test that has to
    set an env var to avoid the network is a test that reaches the network when someone forgets.
    `deps.provider_for` reads it off `app.state`; `None` means `UrllibTransport`, the real one.
    """
    resolved = settings or Settings.from_env()
    resolved.ensure_directories()

    app = FastAPI(
        title="PaperTree",
        version="1.0.0",
        summary=(
            "PaperIR over HTTP: upload a PDF, watch it parse, read the document a client can index."
        ),
    )
    app.state.settings = resolved
    app.state.llm_transport = llm_transport

    # The reader is a separate origin in development (`next dev` on :3000, this on :8000).
    # Credentials are a bearer token in a header, never a cookie, so there is no CSRF surface and
    # no need for `allow_credentials`.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Migrations run at startup rather than in a separate step, because "git clone && install &&
    # run" is a stated project constraint and a service that needs a second command to be usable
    # does not satisfy it. `migrate()` is forward-only and idempotent, and raises if an applied
    # migration's checksum changed.
    @app.on_event("startup")
    async def _migrate() -> None:
        from papertree_db import open_database

        db = open_database(resolved.database_file)
        try:
            db.migrate()
        finally:
            db.close()

    _mount_auth(app)
    _mount_papers(app)
    _mount_highlights(app)
    _mount_jobs(app)
    mount_ask(app)
    return app


# ─── auth ─────────────────────────────────────────────────────────────────────────────────────


def _mount_auth(app: FastAPI) -> None:
    @app.post("/auth/register", response_model=Session, status_code=status.HTTP_201_CREATED)
    async def register(body: Credentials, conn: AuthConnDep, settings: SettingsDep) -> Session:
        from papertree_db import PaperTreeDb

        db = PaperTreeDb(settings.database_file)
        try:
            try:
                created = db.create_user(body.email)
            except Exception as exc:  # sqlite3.IntegrityError on users_email_unique
                # 409 rather than a 500, and deliberately not "that email is taken" phrasing in a
                # way that differs from a wrong-password response — see `login`.
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "could not create that account"
                ) from exc
        finally:
            db.close()

        stamp = now_iso()
        conn.execute(
            "INSERT INTO user_credentials (user_id, password_hash, created_at, updated_at) "
            "VALUES (?, ?, ?, ?)",
            (created.user_id, hash_password(body.password), stamp, stamp),
        )
        token = create_session(conn, created.user_id, hours=settings.session_hours)
        return Session(token=token, user_id=created.user_id, email=body.email)

    @app.post("/auth/login", response_model=Session)
    async def login(body: Credentials, conn: AuthConnDep, settings: SettingsDep) -> Session:
        row = conn.execute(
            "SELECT u.user_id AS user_id, u.email AS email, c.password_hash AS password_hash "
            "FROM users u JOIN user_credentials c ON c.user_id = u.user_id WHERE u.email = ?",
            (body.email,),
        ).fetchone()

        # ONE message and ONE status for "no such user" and "wrong password". Distinguishing them
        # turns the login route into an account-enumeration oracle.
        if row is None or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "invalid email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        token = create_session(conn, row["user_id"], hours=settings.session_hours)
        return Session(token=token, user_id=row["user_id"], email=row["email"])

    @app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
    async def logout(
        conn: AuthConnDep,
        authorization: Annotated[str | None, Depends(_raw_bearer)],
    ) -> Response:
        # Revocation is what the session table buys over a signed token; see 0004_auth.sql.
        if authorization is not None:
            revoke_session(conn, authorization)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/auth/me")
    async def me(call: CallerDep, conn: AuthConnDep) -> dict[str, str]:
        row = conn.execute("SELECT email FROM users WHERE user_id = ?", (call.user_id,)).fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such user")
        return {"user_id": call.user_id, "email": row["email"]}


def _raw_bearer(
    credentials: Annotated[
        Any, Depends(__import__("fastapi").security.HTTPBearer(auto_error=False))
    ],
) -> str | None:
    return None if credentials is None else str(credentials.credentials)


# ─── papers ───────────────────────────────────────────────────────────────────────────────────


def _mount_papers(app: FastAPI) -> None:
    @app.post("/papers", response_model=Upload, status_code=status.HTTP_202_ACCEPTED)
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

    @app.get("/papers")
    async def list_papers(call: CallerDep) -> list[dict[str, Any]]:
        return [_public(row) for row in call.db.list_papers(call.db_owner)]

    @app.get("/papers/{paper_id}")
    async def get_paper(
        call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None
    ) -> dict[str, Any]:
        row = call.db.get_paper(
            call.db_owner, PaperId(paper_id), generation(_promoted(call, paper_id, gen))
        )
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such paper")
        return _public(row)

    @app.get("/papers/{paper_id}/ir")
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

    @app.get("/papers/{paper_id}/pages")
    async def pages(
        call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None
    ) -> list[dict[str, Any]]:
        g = generation(_promoted(call, paper_id, gen))
        return [_public(row) for row in call.db.list_pages(call.db_owner, PaperId(paper_id), g)]

    @app.get("/papers/{paper_id}/blocks")
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

    @app.get("/papers/{paper_id}/relations")
    async def relations(
        call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None
    ) -> list[dict[str, Any]]:
        g = generation(_promoted(call, paper_id, gen))
        return [_public(row) for row in call.db.list_relations(call.db_owner, PaperId(paper_id), g)]

    @app.get("/papers/{paper_id}/blocks/{block_id}/location")
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

    @app.get("/papers/{paper_id}/file")
    async def original(call: CallerDep, settings: SettingsDep, paper_id: str) -> FileResponse:
        # The ownership check is `_promoted`, which is owner-scoped: a paper this caller cannot see
        # 404s BEFORE any path is built. The filename is the paper_id, so nothing user-supplied
        # ever reaches the filesystem.
        _promoted(call, paper_id, None)
        path = settings.upload_root / f"{paper_id}.pdf"
        if not path.is_file():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "the original file is not on this host")
        return FileResponse(path, media_type="application/pdf")

    @app.get("/papers/{paper_id}/assets/{kind}/{block_id}")
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
            block_location(
                call.db, call.db_owner, PaperId(paper_id), generation(g), BlockId(block_id)
            )
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


# ─── highlights (contracts.md §2.4) ───────────────────────────────────────────────────────────
#
# SELF-CONTAINED ON PURPOSE: wave 2 (S0b) moves this block into `routers/highlights.py` unchanged
# and swaps the local models for `schemas.py`'s. Until then it carries its own request models, its
# own error envelope (`{detail, code, retryable}`, contracts.md §0) and its own body parsing, so
# that "422 validation_failed", "never 500 on a bad body" and "never a partial write" hold for
# these routes without a global exception handler (that is S0b's).
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


class _Refused(Exception):
    """A contract error response, raised inside a handler and rendered by `_refusal`."""

    def __init__(self, status_code: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail


def _refusal(exc: _Refused) -> JSONResponse:
    return JSONResponse(
        {"detail": exc.detail, "code": exc.code, "retryable": False},
        status_code=exc.status_code,
    )


async def _parse_body[M: BaseModel](request: Request, model: type[M]) -> M:
    """The body as `model`, or 422 `validation_failed` naming the first failing field."""
    raw = await request.body()
    try:
        return model.model_validate_json(raw)
    except ValidationError as exc:
        first = exc.errors(include_url=False)[0]
        where = ".".join(str(part) for part in first["loc"]) or "body"
        raise _Refused(422, "validation_failed", f"{where}: {first['msg']}") from exc


#: `?gen=`: ASCII digits only. `str.isdigit()` is also True for "²" (then `int()` raises, a 500)
#: and for "٣" (which `int()` silently reads as 3); 19 digits cover SQLite's range.
_GEN_PARAM = re.compile(r"[0-9]{1,19}")


def _gen_param(request: Request) -> int | None:
    raw = request.query_params.get("gen")
    if raw is None:
        return None
    if _GEN_PARAM.fullmatch(raw) is None or not 1 <= int(raw) <= SQLITE_INTEGER_MAX:
        raise _Refused(
            422, "validation_failed", f"gen: must be an integer from 1 to {SQLITE_INTEGER_MAX}"
        )
    return int(raw)


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
        raise _Refused(404, "not_found", "no such paper")


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


def _db_refusal(exc: Exception) -> _Refused:
    """The data layer's typed refusals, as contract errors. Anything else is not a bad body."""
    if isinstance(exc, PaperNotFound):
        return _Refused(404, "not_found", "no such paper")
    if isinstance(exc, GenerationNotFound):
        return _Refused(409, "generation_not_found", str(exc))
    if isinstance(exc, HighlightRejected):
        return _Refused(422, exc.code, exc.detail)
    raise exc


def _mount_highlights(app: FastAPI) -> None:
    @app.get("/papers/{paper_id}/highlights")
    async def list_highlights(call: CallerDep, paper_id: str, request: Request) -> Response:
        """Every highlight, INCLUDING orphans and legacy rows, with each anchor's cache entry for
        `?gen=` (default: the promoted generation; none promoted means every resolution is null)."""
        try:
            gen = _gen_param(request)
            _owned_or_404(call, paper_id)
            if gen is None:
                gen = call.db.promoted_generation(call.db_owner, PaperId(paper_id))
            rows = call.db.list_highlights(call.db_owner, PaperId(paper_id), gen)
        except _Refused as refused:
            return _refusal(refused)
        return JSONResponse([_highlight_wire(row) for row in rows])

    @app.post("/papers/{paper_id}/highlights")
    async def create_highlight(call: CallerDep, paper_id: str, request: Request) -> Response:
        """201 on create, 200 on an idempotent replay (same `highlight_id` and body). One
        transaction: the highlight, every anchor and every resolution, or nothing."""
        try:
            body = await _parse_body(request, _HighlightCreate)
            _owned_or_404(call, paper_id)
            promoted = call.db.promoted_generation(call.db_owner, PaperId(paper_id))
            if promoted is None:
                # In this release the reader enables Highlight only once the IR is loaded, and a
                # highlight's `created_generation` is the promoted one (contracts.md §2.4).
                raise _Refused(409, "not_parsed", "this paper has not been parsed yet")
            try:
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
            except (PaperNotFound, GenerationNotFound, HighlightRejected) as exc:
                raise _db_refusal(exc) from exc
            highlight = call.db.get_highlight(
                call.db_owner, PaperId(paper_id), stored.highlight_id, promoted
            )
        except _Refused as refused:
            return _refusal(refused)
        assert highlight is not None  # stored one statement ago, in a committed transaction
        return JSONResponse(_highlight_wire(highlight), status_code=201 if stored.created else 200)

    @app.put("/papers/{paper_id}/highlights/resolutions")
    async def put_resolutions(call: CallerDep, paper_id: str, request: Request) -> Response:
        """Upserts the T0 cache for one generation; an `upgraded_anchor` replaces a legacy-0001
        record in the same transaction (contracts.md §2.4, ADR-002 §6.3)."""
        try:
            body = await _parse_body(request, _ResolutionsPut)
            _owned_or_404(call, paper_id)
            try:
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
            except (PaperNotFound, GenerationNotFound, HighlightRejected) as exc:
                raise _db_refusal(exc) from exc
        except _Refused as refused:
            return _refusal(refused)
        return Response(status_code=204)

    @app.patch("/papers/{paper_id}/highlights/{highlight_id}")
    async def update_highlight(
        call: CallerDep, paper_id: str, highlight_id: str, request: Request
    ) -> Response:
        """`{color?, note?}`. An absent field is unchanged; `note: null` clears the note."""
        try:
            body = await _parse_body(request, _HighlightPatch)
            _owned_or_404(call, paper_id)
            given = body.model_fields_set
            if "color" in given and body.color is None:
                raise _Refused(422, "validation_failed", "color: may not be null")
            note = None if "note" not in given else (body.note if body.note is not None else "")
            try:
                updated = call.db.update_highlight(
                    call.db_owner, PaperId(paper_id), highlight_id, color=body.color, note=note
                )
            except HighlightRejected as exc:
                raise _db_refusal(exc) from exc
            if updated is None:
                raise _Refused(404, "not_found", "no such highlight on this paper")
            highlight = call.db.get_highlight(
                call.db_owner,
                PaperId(paper_id),
                highlight_id,
                call.db.promoted_generation(call.db_owner, PaperId(paper_id)),
            )
        except _Refused as refused:
            return _refusal(refused)
        assert highlight is not None
        return JSONResponse(_highlight_wire(highlight))

    @app.delete("/papers/{paper_id}/highlights/{highlight_id}")
    async def delete_highlight(call: CallerDep, paper_id: str, highlight_id: str) -> Response:
        try:
            _owned_or_404(call, paper_id)
            if call.db.delete_highlight(call.db_owner, PaperId(paper_id), highlight_id) == 0:
                raise _Refused(404, "not_found", "no such highlight on this paper")
        except _Refused as refused:
            return _refusal(refused)
        return Response(status_code=204)


# ─── jobs ─────────────────────────────────────────────────────────────────────────────────────


def _mount_jobs(app: FastAPI) -> None:
    @app.get("/jobs/{job_id}")
    async def get_job(call: CallerDep, job_id: str) -> dict[str, Any]:
        """What makes the library's PENDING state real (#74).

        `dashboard/page.tsx` defaults every paper to `processing: 'pending'` because "a row that
        has never been told about a job is a paper nobody has parsed yet". This is the thing that
        tells it.
        """
        job = call.store.get_job(call.store_owner, job_id)
        if job is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such job")
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
            "created_at": job.created_at,
            "updated_at": job.updated_at,
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
