"""The request-scoped wiring: three connections, and the one rule that governs all of them.

THE NON-NEGOTIABLE (#74, AGENTS.md §4)

    `OwnerId` is an opaque per-connection handle and must never cross a wire or a boundary.
    Resolve a token to a `user_id`, call `owner_for(user_id)`, pass the handle inward.

So: nothing in this package accepts an owner from a request, serialises one into a response, or
puts one in a log. `owner_for` is called HERE, per request, from a `user_id` this module verified
against the `sessions` table itself. `tests/test_isolation.py` asserts user B cannot read user A's
paper by id, and was watched failing with the owner argument removed from one query.

WHY THREE CONNECTIONS AND NOT ONE

    PaperTreeDb  tenant data.  Its `_conn` is private by convention and is a "forbidden token"
                 outside `packages/db` — gate 1, enforced by an AST scan. This package does not
                 reach for it.
    JobStore     jobs. `store.owner_for()` and `database.owner_for()` mint DIFFERENT, deliberately
                 non-interchangeable handles for the SAME user (job.py:79-89). Mixing them raises
                 `OwnershipError`. Both are minted here, separately, and named so.
    auth         a plain sqlite3 connection this package owns, for `user_credentials` and
                 `sessions` ONLY. Those are identity, not tenant data — they carry no `owner_id`
                 and could not, since `owner_id` is derived from them.

Three connections to one SQLite file is the arrangement `packages/jobs` already documents as
intended ("explicitly multi-process: worker, API and canceller all opening the same file"), and it
sets `busy_timeout` for exactly this. The auth connection does the same.

EVERY DEPENDENCY AND EVERY ROUTE IS `async def`, AND THAT IS LOAD-BEARING

`sqlite3` connections are bound to the thread that created them. FastAPI runs a SYNC dependency in
a threadpool worker and a SYNC route in a separate `run_in_threadpool` call, and an ASYNC route on
the event loop thread — so a sync dependency feeding an async route is guaranteed to hand a
connection across a thread boundary, and a sync dependency feeding a sync route is only
*incidentally* on the same worker. That first case was real:

    services/api/.../app.py:271 in upload
    sqlite3.ProgrammingError: SQLite objects created in a thread can only be used in that same
    thread. The object was created in thread id 6168981504 and this is thread id 6152155136.

Making the whole chain async puts every connection's creation and use on the event loop thread, by
construction rather than by luck. `packages/db` does not expose `check_same_thread`, so the
alternative — the one that "works" until anyio hands out a different worker — was not available and
would not have been worth taking if it were.

THE COST, STATED: SQLite calls now block the event loop. For this service that is the right trade —
the datastore is a local file (the build plan's "SQLite + sqlite-vec, no Postgres, no Docker"), the
reads are milliseconds, and correctness under concurrency beats throughput nobody has measured a
need for. If that stops being true the fix is an explicit per-request executor, not a return to
mixed sync/async.

CONNECTIONS ARE PER REQUEST, NOT PER PROCESS, and that is not an oversight. An `OwnerId` is scoped
to the connection that minted it, so a pooled connection shared between requests would let a handle
minted for user A be resolvable while serving user B. Opening a connection per request costs
~100 µs against a local SQLite file and removes that class of bug entirely.

THE ONE CROSSING WORTH READING TWICE — `AgentDataHandle` TAKES A `user_id`, NOT AN `OwnerId`

Everything else below resolves a token to a `user_id` and then immediately converts it to an
opaque per-connection handle. `AgentDataHandle.__init__(database_path, user_id)` does NOT: it opens
its own guarded read-only connection and binds the RAW user_id, checking it exists in `users`
first. So `agent_handle` passes `call.user_id` and never `call.db_owner` — a handle minted on the
`PaperTreeDb` connection would not resolve on the agent connection anyway, and `owner_for` is not
what that class wants. This is undocumented anywhere else; it is written here because it is the one
place in this service where "always pass the OwnerId inward" is the wrong instruction.
"""

from __future__ import annotations

import sqlite3
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from papertree_agent_tools import MiniMaxProvider, ProviderSettings, Transport, UrllibTransport
from papertree_db import OwnerId, PaperId, PaperTreeDb
from papertree_jobs import JobStore
from papertree_memory import AgentDataHandle

from .security import user_for_token
from .settings import Settings

# `auto_error=False` so a missing header produces OUR 401 with a WWW-Authenticate challenge rather
# than FastAPI's bare 403, which is the wrong code for "you did not authenticate".
_bearer = HTTPBearer(auto_error=False)


def settings_of(request: Request) -> Settings:
    return request.app.state.settings  # type: ignore[no-any-return]


async def open_database(
    settings: Annotated[Settings, Depends(settings_of)],
) -> AsyncIterator[PaperTreeDb]:
    db = PaperTreeDb(settings.database_file)
    try:
        yield db
    finally:
        db.close()


async def open_store(
    settings: Annotated[Settings, Depends(settings_of)],
) -> AsyncIterator[JobStore]:
    store = JobStore(settings.database_file)
    try:
        yield store
    finally:
        store.close()


async def open_auth(
    settings: Annotated[Settings, Depends(settings_of)],
) -> AsyncIterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(settings.database_file), isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        yield conn
    finally:
        conn.close()


async def current_user_id(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    conn: Annotated[sqlite3.Connection, Depends(open_auth)],
) -> str:
    """The verified `user_id`. THE ONLY PLACE a token becomes an identity."""
    unauthorised = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="missing or invalid session token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorised
    user_id = user_for_token(conn, credentials.credentials)
    if user_id is None:
        raise unauthorised
    return user_id


@dataclass(slots=True)
class Caller:
    """One request's verified identity and its two non-interchangeable owner handles.

    `user_id` is here because routes need it for `create_user`-adjacent work and for logging. The
    two handles are NOT interchangeable and are named for the connection each belongs to, so a
    mix-up is visible at the call site rather than as an `OwnershipError` at runtime.
    """

    user_id: str
    db: PaperTreeDb
    store: JobStore
    db_owner: OwnerId
    store_owner: OwnerId


async def caller(
    user_id: Annotated[str, Depends(current_user_id)],
    db: Annotated[PaperTreeDb, Depends(open_database)],
    store: Annotated[JobStore, Depends(open_store)],
) -> Caller:
    # `owner_for` per request, on each connection, from a user_id verified above. This is the whole
    # of the isolation mechanism at this boundary; everything below it is `packages/db`'s four
    # gates. Note it is called TWICE on purpose — see the module header.
    return Caller(
        user_id=user_id,
        db=db,
        store=store,
        db_owner=db.owner_for(user_id),
        store_owner=store.owner_for(user_id),
    )


async def agent_handle(
    call: Annotated[Caller, Depends(caller)],
    settings: Annotated[Settings, Depends(settings_of)],
) -> AsyncIterator[AgentDataHandle]:
    """The READ-ONLY handle the agent turn reads through. Opens its own guarded connection.

    `call.user_id`, NOT `call.db_owner` — see the module header. The handle refuses construction
    for a user_id that is not in `users`, so this cannot open a connection bound to nothing.
    """
    handle = AgentDataHandle(str(settings.database_file), call.user_id)
    try:
        yield handle
    finally:
        handle.close()


def provider_for(request: Request) -> MiniMaxProvider:
    """The model client for one request. Its TRANSPORT is injectable and that is load-bearing.

    `create_app(..., llm_transport=...)` puts a scripted callable on `app.state`, so the whole
    `/ask` route — dependency graph, ownership, tool loop, verifier, serialiser — runs in the test
    suite with no socket. Without the seam the only testable thing would be the route's signature.

    Built per request rather than once: `MiniMaxProvider` is a frozen dataclass over settings and
    a transport, so there is nothing to pool, and a process-level client would have to be rebuilt
    anyway the moment settings became per-tenant.
    """
    settings: Settings = request.app.state.settings
    transport: Transport | None = getattr(request.app.state, "llm_transport", None)
    return MiniMaxProvider(
        ProviderSettings(
            api_key=settings.llm_api_key,
            model=settings.llm_model,
            base_url=settings.llm_base_url,
            timeout_seconds=settings.llm_timeout_seconds,
        ),
        transport if transport is not None else UrllibTransport(),
    )


def promoted_or_404(call: Caller, paper_id: str, requested: int | None) -> int:
    """The generation to read, or 404.

    A caller may pin a generation; the default is the promoted one. Both go through
    `promoted_generation`/`get_paper`, which are owner-scoped, so an id belonging to another owner
    is indistinguishable from an id that does not exist — which is the correct answer to give.

    NOTE WHAT A PINNED `?gen=` SKIPS: the branch returns the caller's number without a query, so
    for a pinned request this function performs NO ownership check at all and the check is entirely
    downstream (`get_paper`, `list_pages`, `AgentDataHandle`). That is fine and it is also what
    `tests/test_ask.py::test_user_b_cannot_ask_even_with_the_generation_pinned` exploits: pinning
    removes one of `/ask`'s two gates, so the remaining one can be watched failing on its own.
    """
    if requested is not None:
        return requested
    gen = call.db.promoted_generation(call.db_owner, PaperId(paper_id))
    if gen is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such paper")
    return gen


CallerDep = Annotated[Caller, Depends(caller)]
SettingsDep = Annotated[Settings, Depends(settings_of)]
AuthConnDep = Annotated[sqlite3.Connection, Depends(open_auth)]
AgentHandleDep = Annotated[AgentDataHandle, Depends(agent_handle)]
ProviderDep = Annotated[MiniMaxProvider, Depends(provider_for)]
