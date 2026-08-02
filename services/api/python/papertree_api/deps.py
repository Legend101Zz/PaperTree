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

CONNECTIONS ARE PER REQUEST, NOT PER PROCESS, and that is not an oversight. An `OwnerId` is scoped
to the connection that minted it, so a pooled connection shared between requests would let a handle
minted for user A be resolvable while serving user B. Opening a connection per request costs
~100 µs against a local SQLite file and removes that class of bug entirely.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from papertree_db import OwnerId, PaperTreeDb
from papertree_jobs import JobStore

from .security import user_for_token
from .settings import Settings

# `auto_error=False` so a missing header produces OUR 401 with a WWW-Authenticate challenge rather
# than FastAPI's bare 403, which is the wrong code for "you did not authenticate".
_bearer = HTTPBearer(auto_error=False)


def settings_of(request: Request) -> Settings:
    return request.app.state.settings  # type: ignore[no-any-return]


def open_database(settings: Annotated[Settings, Depends(settings_of)]) -> Iterator[PaperTreeDb]:
    db = PaperTreeDb(settings.database_file)
    try:
        yield db
    finally:
        db.close()


def open_store(settings: Annotated[Settings, Depends(settings_of)]) -> Iterator[JobStore]:
    store = JobStore(settings.database_file)
    try:
        yield store
    finally:
        store.close()


def open_auth(settings: Annotated[Settings, Depends(settings_of)]) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(settings.database_file), isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        yield conn
    finally:
        conn.close()


def current_user_id(
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


def caller(
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


CallerDep = Annotated[Caller, Depends(caller)]
SettingsDep = Annotated[Settings, Depends(settings_of)]
AuthConnDep = Annotated[sqlite3.Connection, Depends(open_auth)]
