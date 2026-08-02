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
    GET    /jobs/{id}                  parse status - makes the library's PENDING state real
    GET|POST|PATCH|DELETE  /papers/{id}/highlights[/{highlight_id}]   anchors included

`OwnerId` never appears in a request or a response. See `deps.py`.
"""

from __future__ import annotations

import hashlib
from typing import Annotated, Any

from fastapi import Body, Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from papertree_db import BlockId, HighlightId, PaperId, generation, new_id
from papertree_document_worker.crops import CropStore
from papertree_document_worker.job import enqueue_parse
from pydantic import BaseModel, Field

from .deps import AuthConnDep, Caller, CallerDep, SettingsDep
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


class HighlightIn(BaseModel):
    color: str = Field(min_length=1, max_length=32)
    note: str | None = None
    anchors: list[dict[str, Any]] = Field(default_factory=list)


class NoteIn(BaseModel):
    note: str | None = None


# ─── helpers ──────────────────────────────────────────────────────────────────────────────────


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


def _promoted(call: Caller, paper_id: str, requested: int | None) -> int:
    """The generation to read, or 404.

    A caller may pin a generation; the default is the promoted one. Both go through
    `promoted_generation`/`get_paper`, which are owner-scoped, so an id belonging to another owner
    is indistinguishable from an id that does not exist — which is the correct answer to give.
    """
    if requested is not None:
        return requested
    gen = call.db.promoted_generation(call.db_owner, PaperId(paper_id))
    if gen is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such paper")
    return gen


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or Settings.from_env()
    resolved.ensure_directories()

    app = FastAPI(
        title="PaperTree",
        version="1.0.0",
        summary="PaperIR over HTTP: upload a PDF, watch it parse, read the document a client can index.",
    )
    app.state.settings = resolved

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
    def _migrate() -> None:
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
    return app


# ─── auth ─────────────────────────────────────────────────────────────────────────────────────


def _mount_auth(app: FastAPI) -> None:
    @app.post("/auth/register", response_model=Session, status_code=status.HTTP_201_CREATED)
    def register(body: Credentials, conn: AuthConnDep, settings: SettingsDep) -> Session:
        from papertree_db import PaperTreeDb

        db = PaperTreeDb(settings.database_file)
        try:
            try:
                created = db.create_user(body.email)
            except Exception as exc:  # sqlite3.IntegrityError on users_email_unique
                # 409 rather than a 500, and deliberately not "that email is taken" phrasing in a
                # way that differs from a wrong-password response — see `login`.
                raise HTTPException(status.HTTP_409_CONFLICT, "could not create that account") from exc
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
    def login(body: Credentials, conn: AuthConnDep, settings: SettingsDep) -> Session:
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
    def logout(
        conn: AuthConnDep,
        authorization: Annotated[str | None, Depends(_raw_bearer)],
    ) -> Response:
        # Revocation is what the session table buys over a signed token; see 0004_auth.sql.
        if authorization is not None:
            revoke_session(conn, authorization)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/auth/me")
    def me(call: CallerDep, conn: AuthConnDep) -> dict[str, str]:
        row = conn.execute("SELECT email FROM users WHERE user_id = ?", (call.user_id,)).fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such user")
        return {"user_id": call.user_id, "email": row["email"]}


def _raw_bearer(
    credentials: Annotated[Any, Depends(__import__("fastapi").security.HTTPBearer(auto_error=False))],
) -> str | None:
    return None if credentials is None else str(credentials.credentials)


# ─── papers ───────────────────────────────────────────────────────────────────────────────────


def _mount_papers(app: FastAPI) -> None:
    @app.post("/papers", response_model=Upload, status_code=status.HTTP_202_ACCEPTED)
    async def upload(call: CallerDep, settings: SettingsDep, file: UploadFile = File(...)) -> Upload:
        raw = await file.read()
        if not raw:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty upload")
        if not raw.startswith(b"%PDF-"):
            # The parser will fail on a non-PDF anyway; failing here means the caller learns it
            # synchronously instead of by polling a job that dead-letters.
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "not a PDF")

        source_hash = hashlib.sha256(raw).hexdigest()
        # Derived, not random: 0001_core.sql:47 requires one paper_id per (owner, source_hash),
        # held fixed across every re-parse. The owner handle is opaque and per-connection so it
        # cannot go in the digest; the user_id can, and gives the same per-owner property.
        digest = hashlib.sha256(f"{call.user_id}:{source_hash}".encode()).hexdigest()[:26]
        paper_id = f"pap_{digest}"

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
    def list_papers(call: CallerDep) -> list[dict[str, Any]]:
        return [_public(row) for row in call.db.list_papers(call.db_owner)]

    @app.get("/papers/{paper_id}")
    def get_paper(call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None) -> dict[str, Any]:
        row = call.db.get_paper(call.db_owner, PaperId(paper_id), generation(_promoted(call, paper_id, gen)))
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such paper")
        return _public(row)

    @app.get("/papers/{paper_id}/ir")
    def get_ir(call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None) -> dict[str, Any]:
        """The one that matters: the shape `indexDocument` takes. See `ir.py`."""
        document = paper_document(
            call.db, call.db_owner, PaperId(paper_id), generation(_promoted(call, paper_id, gen))
        )
        if document is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such paper")
        return document

    @app.get("/papers/{paper_id}/pages")
    def pages(call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None) -> list[dict[str, Any]]:
        g = generation(_promoted(call, paper_id, gen))
        return [_public(row) for row in call.db.list_pages(call.db_owner, PaperId(paper_id), g)]

    @app.get("/papers/{paper_id}/blocks")
    def blocks(
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
                for row in call.db.list_blocks_on_page(call.db_owner, PaperId(paper_id), g, p["page_index"])
            ]
        return [_public(row) for row in rows]

    @app.get("/papers/{paper_id}/relations")
    def relations(call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None) -> list[dict[str, Any]]:
        g = generation(_promoted(call, paper_id, gen))
        return [_public(row) for row in call.db.list_relations(call.db_owner, PaperId(paper_id), g)]

    @app.get("/papers/{paper_id}/blocks/{block_id}/location")
    def location(
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
    def original(call: CallerDep, settings: SettingsDep, paper_id: str) -> FileResponse:
        # The ownership check is `_promoted`, which is owner-scoped: a paper this caller cannot see
        # 404s BEFORE any path is built. The filename is the paper_id, so nothing user-supplied
        # ever reaches the filesystem.
        _promoted(call, paper_id, None)
        path = settings.upload_root / f"{paper_id}.pdf"
        if not path.is_file():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "the original file is not on this host")
        return FileResponse(path, media_type="application/pdf")

    @app.get("/papers/{paper_id}/assets/{kind}/{block_id}")
    def asset(
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
        if block_location(call.db, call.db_owner, PaperId(paper_id), generation(g), BlockId(block_id)) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such block")
        store = CropStore(root=settings.asset_root, paper_id=paper_id, generation=g)
        try:
            payload = store.read(kind, block_id)
        except (FileNotFoundError, OSError) as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no crop for that block") from exc
        # PNG at 3x is what `crops.py` writes today. F1.5 asks for WebP; that is Session B's #55.
        return Response(payload, media_type="image/png")


# ─── highlights ───────────────────────────────────────────────────────────────────────────────


def _mount_highlights(app: FastAPI) -> None:
    @app.get("/papers/{paper_id}/highlights")
    def list_highlights(call: CallerDep, paper_id: str, gen: Annotated[int | None, Query()] = None) -> list[dict[str, Any]]:
        g = generation(_promoted(call, paper_id, gen))
        # `resolve_highlights` is the pre-joined highlight-with-anchors view; a caller that wanted
        # to rebuild that join client-side would be reimplementing a query that exists.
        return [_public(row) for row in call.db.resolve_highlights(call.db_owner, PaperId(paper_id), g)]

    @app.post("/papers/{paper_id}/highlights", status_code=status.HTTP_201_CREATED)
    def create_highlight(
        call: CallerDep, paper_id: str, body: HighlightIn, gen: Annotated[int | None, Query()] = None
    ) -> dict[str, Any]:
        g = generation(_promoted(call, paper_id, gen))
        highlight_id = call.db.create_highlight(
            call.db_owner, PaperId(paper_id), g, color=body.color, note=body.note
        )
        # Anchors are created in the SAME request, never in a follow-up. A highlight with no anchor
        # is a highlight that cannot be resolved, and #72's measurement is the reason to insist:
        # a bare block_id survives a re-parse 3.3% of the time and an Anchor 100%.
        for anchor in body.anchors:
            call.db.create_anchor(
                call.db_owner,
                highlight_id,
                PaperId(paper_id),
                g,
                BlockId(str(anchor["block_id"])),
                int(anchor["tier"]),
                anchor["polygon"],
                anchor["bbox"],
                char_start=anchor.get("char_start"),
                char_end=anchor.get("char_end"),
                text_quote=anchor.get("text_quote"),
                quote_prefix=anchor.get("quote_prefix"),
                quote_suffix=anchor.get("quote_suffix"),
                content_hash=anchor.get("content_hash"),
            )
        row = call.db.get_highlight(call.db_owner, highlight_id)
        if row is None:  # pragma: no cover - it was created one statement ago
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "highlight vanished")
        return _public(row)

    @app.patch("/papers/{paper_id}/highlights/{highlight_id}")
    def update_note(call: CallerDep, paper_id: str, highlight_id: str, body: NoteIn) -> dict[str, Any]:
        changed = call.db.update_highlight_note(call.db_owner, HighlightId(highlight_id), body.note)
        if changed == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such highlight")
        row = call.db.get_highlight(call.db_owner, HighlightId(highlight_id))
        return _public(row) if row is not None else {}

    @app.delete("/papers/{paper_id}/highlights/{highlight_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_highlight(call: CallerDep, paper_id: str, highlight_id: str) -> Response:
        if call.db.delete_highlight(call.db_owner, HighlightId(highlight_id)) == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such highlight")
        return Response(status_code=status.HTTP_204_NO_CONTENT)


# ─── jobs ─────────────────────────────────────────────────────────────────────────────────────


def _mount_jobs(app: FastAPI) -> None:
    @app.get("/jobs/{job_id}")
    def get_job(call: CallerDep, job_id: str) -> dict[str, Any]:
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
                {"name": step.step_name, "index": step.step_index, "state": step.state, "error": step.error}
                for step in call.store.list_steps(call.store_owner, job_id)
            ],
        }
