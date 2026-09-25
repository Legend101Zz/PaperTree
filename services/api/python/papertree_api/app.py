"""The HTTP surface. A TRANSPORT, NOT A REWRITE.

Every route is a shape change plus one or two calls into `packages/db`, `packages/jobs` or
`services/document-worker`. If business logic starts appearing here, it is being built beside
something that already exists — `PaperTreeDb` is a complete owner-scoped data layer and `job.py`
already has `enqueue_parse` / `make_parse_handler` / `build_runner`.

This module only BUILDS the app: settings, CORS, the startup migration, and the routers. The routes
live in `routers/`, one module per slice that owns them (contracts.md §2, slice-plan.md §3); the
list is in `routers/__init__.py`. `POST /papers/{id}/ask` (#76) is still `ask.py`'s until S5
replaces it with threads.

`OwnerId` never appears in a request or a response. See `deps.py`.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from papertree_agent_tools import Transport

from .ask import mount_ask
from .routers import auth, highlights, jobs, papers
from .routers.papers import derive_paper_id  # re-exported: it lived here before the split
from .settings import Settings

__all__ = ["create_app", "derive_paper_id"]


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

    # The order the pre-split `app.py` mounted them in.
    app.include_router(auth.router)
    app.include_router(papers.router)
    app.include_router(highlights.router)
    app.include_router(jobs.router)
    mount_ask(app)
    return app
