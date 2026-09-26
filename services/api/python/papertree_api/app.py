"""The HTTP surface. A TRANSPORT, NOT A REWRITE.

Every route is a shape change plus one or two calls into `packages/db`, `packages/jobs` or
`services/document-worker`. If business logic starts appearing here, it is being built beside
something that already exists — `PaperTreeDb` is a complete owner-scoped data layer and `job.py`
already has `enqueue_parse` / `make_parse_handler` / `build_runner`.

This module only BUILDS the app: settings, CORS, the startup migration, and the routers. The routes
live in `routers/`, one module per slice that owns them (contracts.md §2, slice-plan.md §3); the
list is in `routers/__init__.py`. (`POST /papers/{id}/ask`, #76, is gone: S5 replaced it with the
threads and summary routes, which broker `services/agent`; slice-plan §R R9.)

`OwnerId` never appears in a request or a response. See `deps.py`.
"""

from __future__ import annotations

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .errors import InternalErrorMiddleware, install_error_handlers
from .middleware import REQUEST_ID_HEADER, CompressJson, RequestIdMiddleware, log_unhandled
from .routers import (
    auth,
    boards,
    health,
    highlights,
    internal,
    jobs,
    papers,
    summary,
    threads,
    usage,
)
from .routers.papers import derive_paper_id  # re-exported: it lived here before the split
from .settings import Settings

__all__ = ["create_app", "derive_paper_id"]


def create_app(
    settings: Settings | None = None, *, agent_transport: httpx.AsyncBaseTransport | None = None
) -> FastAPI:
    """`agent_transport` is the ONE seam that lets the AI routes be tested without the agent.

    An `httpx` transport the API's agent client sends `POST /v1/runs` and `DELETE /v1/runs/{id}`
    through (the tests' `FakeAgent`, which replays `contracts/agent/fixtures/*.sse`). It is a
    constructor argument rather than an environment variable because a test that has to set an env
    var to avoid the network is a test that reaches the network when someone forgets.
    `deps.agent_transport_of` reads it off `app.state`; `None` means the real network.
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
    app.state.agent_transport = agent_transport

    # MIDDLEWARE, outermost first. `add_middleware` wraps what is already there, so they are
    # added innermost first:
    #
    #   RequestIdMiddleware     every response gets X-Request-Id, every request one log line
    #   CORSMiddleware          so even the 500 below carries Access-Control-Allow-Origin
    #   InternalErrorMiddleware an exception nothing caught -> the §0 envelope, 500 `internal`
    #   CompressJson            GZipMiddleware(minimum_size=1024), minus the PDF and the PNGs
    #
    # Every other non-2xx is the envelope through the typed handlers (`errors.py`).
    install_error_handlers(app)
    app.add_middleware(CompressJson)
    app.add_middleware(InternalErrorMiddleware, on_error=log_unhandled)

    # The reader is a separate origin in development (`next dev` on :3000, this on :8000).
    # Credentials are a bearer token in a header, never a cookie, so there is no CSRF surface and
    # no need for `allow_credentials`. `allow_origins` is `PAPERTREE_CORS_ORIGINS` (contracts.md
    # §2), beside the localhost regex. `expose_headers`: a cross-origin fetch can only READ the
    # request id if CORS says so.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_origins=list(resolved.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER],
    )
    app.add_middleware(RequestIdMiddleware)

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

    # The pre-split `app.py`'s order first, then what S0 added (`routers/__init__.py` lists them).
    app.include_router(auth.router)
    app.include_router(papers.router)
    app.include_router(highlights.router)
    app.include_router(jobs.router)
    app.include_router(health.router)
    app.include_router(threads.router)
    app.include_router(summary.router)
    app.include_router(usage.router)
    app.include_router(boards.router)
    app.include_router(internal.router)
    return app
