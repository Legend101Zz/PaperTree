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
first. The internal paper tools (`routers/internal.py`) are its one user in this service: they
resolve a RUN TOKEN (not a session) to a grant through `run_grant`, and open the handle on the
grant's `user_id` — a handle minted on the `PaperTreeDb` connection would not resolve on the agent
connection anyway. It is the one place where "always pass the OwnerId inward" is the wrong
instruction.

THE AGENT TRANSPORT SEAM. `create_app(..., agent_transport=...)` puts an `httpx` transport on
`app.state`; `agent_transport_of` hands it to `agent_client.AgentClient`. `None` is the real
network. It is a constructor argument, not an environment variable, for the reason the old `/ask`
seam gave: a test that must set a variable to stay off the network reaches the network the day
somebody forgets.
"""

from __future__ import annotations

import sqlite3
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from papertree_db import OwnerId, PaperId, PaperTreeDb
from papertree_jobs import JobStore

from .errors import ApiError
from .logging import user_ref
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
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    conn: Annotated[sqlite3.Connection, Depends(open_auth)],
) -> str:
    """The verified `user_id`. THE ONLY PLACE a token becomes an identity.

    It also leaves `user_ref` (`sha256(user_id)[:12]`, contracts.md §8) in the request state for
    the access log line; the id itself is never logged."""
    unauthorised = ApiError(
        "auth_required",
        "missing or invalid session token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorised
    user_id = user_for_token(conn, credentials.credentials)
    if user_id is None:
        raise unauthorised
    request.state.user_ref = user_ref(user_id)
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


def agent_transport_of(request: Request) -> httpx.AsyncBaseTransport | None:
    """The transport the agent client uses: a test's (`create_app(agent_transport=...)`) or None,
    which is the real network."""
    transport = getattr(request.app.state, "agent_transport", None)
    return transport if isinstance(transport, httpx.AsyncBaseTransport) else None


def promoted_or_404(call: Caller, paper_id: str, requested: int | None) -> int:
    """The generation to read, or 404.

    A caller may pin a generation; the default is the promoted one. Both go through
    `promoted_generation`/`get_paper`, which are owner-scoped, so an id belonging to another owner
    is indistinguishable from an id that does not exist — which is the correct answer to give.

    NOTE WHAT A PINNED `?gen=` SKIPS: the branch returns the caller's number without a query, so
    for a pinned request this function performs NO ownership check at all and the check is entirely
    downstream (`get_paper`, `list_pages`), which is owner-scoped.
    """
    if requested is not None:
        return requested
    gen = call.db.promoted_generation(call.db_owner, PaperId(paper_id))
    if gen is None:
        raise ApiError("not_found", "no such paper")
    return gen


CallerDep = Annotated[Caller, Depends(caller)]
SettingsDep = Annotated[Settings, Depends(settings_of)]
AuthConnDep = Annotated[sqlite3.Connection, Depends(open_auth)]
AgentTransportDep = Annotated[httpx.AsyncBaseTransport | None, Depends(agent_transport_of)]
