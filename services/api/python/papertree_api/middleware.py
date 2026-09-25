"""Request ids and the access log line (contracts.md §0 "Request ids", §8).

`RequestIdMiddleware` is the OUTERMOST middleware `create_app` installs, so that EVERY response —
a route's, CORS's preflight answer, a 404 from the router, a 422, the 500 envelope — passes through
it and carries `X-Request-Id`, and every request produces exactly one `http.request` line.

    incoming X-Request-Id   kept if it is `req_<ULID>`; anything else is REPLACED by a minted one
                            (and never logged: a header is attacker-controlled text)
    scope["state"]          `request_id` for the rest of the request (the agent client forwards
                            it, S5); `user_ref`, set by the auth dependency once a token resolved
"""

from __future__ import annotations

import re
import time
from typing import Final

from papertree_db import new_id
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .errors import where
from .logging import log_event

REQUEST_ID_HEADER: Final = "X-Request-Id"
#: `req_` + a 26-character Crockford ULID, which is what `new_id("req")` mints.
REQUEST_ID: Final = re.compile(r"req_[0-9A-HJKMNP-TV-Z]{26}")


def request_id_for(headers: Headers) -> str:
    incoming = headers.get(REQUEST_ID_HEADER)
    if incoming is not None and REQUEST_ID.fullmatch(incoming):
        return incoming
    return new_id("req")


def _route_of(scope: Scope) -> str | None:
    """The matched route's TEMPLATE, e.g. `/papers/{paper_id}`; None when nothing matched."""
    route = scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else None


class RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = request_id_for(Headers(scope=scope))
        state = scope.setdefault("state", {})
        state["request_id"] = request_id
        started = time.perf_counter()
        status: int | None = None

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = int(message["status"])
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            log_event(
                "http.request",
                request_id=request_id,
                method=str(scope.get("method", "")),
                route=_route_of(scope),
                # No status means the app raised before it could answer (the server then
                # answers 500 or drops the connection): the line still says so.
                status=500 if status is None else status,
                ms=round((time.perf_counter() - started) * 1000, 1),
                user_ref=state.get("user_ref"),
            )


def log_unhandled(scope: Scope, exc: BaseException) -> None:
    """`InternalErrorMiddleware`'s hook: the one line an unforeseen exception gets. Its class and
    where it was raised, never its message (which can carry a value from the request)."""
    state = scope.get("state") or {}
    log_event(
        "http.error",
        level="error",
        request_id=state.get("request_id"),
        method=str(scope.get("method", "")),
        route=_route_of(scope),
        status=500,
        error_type=type(exc).__name__,
        where=where(exc),
        user_ref=state.get("user_ref"),
    )
