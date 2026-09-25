"""The error contract (contracts.md §0, §2.9): one enum, one exception, one envelope.

    { "detail": "human-readable sentence, safe to show", "code": "<ErrorCode>", "retryable": false }

EVERY non-2xx JSON response this service sends has exactly that shape, and it takes more than one
handler to make that true, because non-2xx responses come out of different machinery:

    a route's own refusal          `ApiError`, raised anywhere below a route
    a data-layer refusal           `HighlightRejected`, `PaperNotFound`, `GenerationNotFound`
                                   escaping a route: mapped here once, not per route
    FastAPI's request validation   re-wrapped as `validation_failed`, naming the FIRST failing
                                   field and NEVER echoing the rejected value (FastAPI's default
                                   422 body carries `input`, which for `/auth/register` is the
                                   password the user just typed)
    Starlette's router             404 for an unknown path, 405 for a known path with the wrong
                                   method: both answered before any route runs
    anything else                  500 `internal` from `InternalErrorMiddleware`, with a fixed
                                   sentence: an exception's text names tables, paths and ids

`test_error_envelope_shape.py` drives one request through each of them.
"""

from __future__ import annotations

import traceback
from collections.abc import Mapping, Sequence
from typing import Any, Final, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from papertree_db import GenerationNotFound, HighlightRejected, PaperNotFound
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

#: contracts.md §2.9. The ONE enum; `apps/web/src/lib/api/types.ts` mirrors it and
#: `apps/web/test/contracts.spec.ts` fails if the two differ.
ErrorCode = Literal[
    "auth_required",
    "invalid_credentials",
    "email_taken",
    "not_found",
    "validation_failed",
    "empty_upload",
    "payload_too_large",
    "unsupported_media_type",
    "not_parsed",
    "not_failed",
    "busy",
    "stale_version",
    "generation_not_found",
    "anchor_incomplete",
    "anchor_mismatch",
    "budget_exhausted",
    "agent_unavailable",
    "not_configured",
    "internal",
    # A CONTRACT ADDITION (S0b): the dedicated code of the 501 every not-yet-built route answers
    # with (`not_implemented()` below). The 501 is a non-2xx JSON response, so it is the §0
    # envelope, and its code has to be a member of the one enum the web mirrors.
    "not_implemented",
]

#: contracts.md §2.9's second list: `done.error.code` of a run (the agent's own classification,
#: §3.3), which a stored `Message.error.code` may also carry.
RunErrorCode = Literal[
    "provider_auth",
    "rate_limited",
    "quota",
    "upstream_unavailable",
    "timeout",
    "aborted",
    "bad_request",
    "tool_failed",
    "tool_budget_exhausted",
    "output_truncated",
    "agent_unavailable",
    "internal",
]

#: The status each code is sent with (contracts.md §2.9).
ERROR_STATUS: Final[dict[ErrorCode, int]] = {
    "auth_required": 401,
    "invalid_credentials": 401,
    "email_taken": 409,
    "not_found": 404,
    "validation_failed": 422,
    "empty_upload": 400,
    "payload_too_large": 413,
    "unsupported_media_type": 415,
    "not_parsed": 409,
    "not_failed": 409,
    "busy": 409,
    "stale_version": 409,
    "generation_not_found": 409,
    "anchor_incomplete": 422,
    "anchor_mismatch": 422,
    "budget_exhausted": 429,
    "agent_unavailable": 503,
    "not_configured": 503,
    "internal": 500,
    "not_implemented": 501,
}

#: The sentence a 500 carries. Fixed on purpose: see the module docstring.
INTERNAL_DETAIL: Final = "Something went wrong on the server. Nothing was changed; try again."


class ErrorEnvelope(BaseModel):
    """contracts.md §0. `extra="forbid"` so the exported schema says `additionalProperties: false`
    and a client-side envelope type with a stray field fails `contracts.spec.ts`."""

    model_config = ConfigDict(extra="forbid", strict=True)

    detail: str
    code: ErrorCode
    retryable: bool


class ApiError(Exception):
    """A contract error, raised anywhere below a route and rendered as the envelope.

    `status` defaults to the code's §2.9 status. It is overridable for the few responses whose
    status the contract does not tie to a code (ask.py's 502/504, until S5 deletes it).
    `extra` adds fields beside the three, for the one contract error that carries a body:
    `409 stale_version` with the current node (§2.7).
    """

    def __init__(
        self,
        code: ErrorCode,
        detail: str,
        *,
        status: int | None = None,
        retryable: bool = False,
        headers: Mapping[str, str] | None = None,
        extra: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(detail)
        self.code: ErrorCode = code
        self.detail = detail
        self.status = ERROR_STATUS[code] if status is None else status
        self.retryable = retryable
        self.headers = dict(headers or {})
        self.extra = dict(extra or {})


def not_implemented(slice_name: str) -> ApiError:
    """The 501 every route in contracts.md §2 answers until the slice that owns it builds it.

    Raised AFTER the route's final models have validated the request (auth, path, query, body),
    so a stub already refuses what the finished route will refuse, and a client written against
    the contract gets its 401s and 422s now.
    """
    return ApiError("not_implemented", f"Not implemented yet (slice {slice_name})")


def envelope_response(error: ApiError) -> JSONResponse:
    body: dict[str, Any] = {
        "detail": error.detail,
        "code": error.code,
        "retryable": error.retryable,
    }
    body.update(error.extra)
    return JSONResponse(body, status_code=error.status, headers=error.headers or None)


def validation_detail(errors: Sequence[Mapping[str, Any]], *, from_fastapi: bool = False) -> str:
    """`"<field>: <reason>"` for the FIRST error, the shape wave 1's highlight routes used.

    FastAPI's locations start with where the value came from (`("body", "email")`,
    `("query", "page")`); with `from_fastapi` that first element is dropped when a field follows
    it. A JSON syntax error is always `body`. The rejected VALUE is never included: pydantic's
    `input` is dropped and only its `msg` is used.
    """
    if not errors:
        return "body: the request is not valid"
    first = errors[0]
    loc = [str(part) for part in first.get("loc", ())]
    if first.get("type") == "json_invalid":
        loc = ["body"]
    elif from_fastapi and len(loc) > 1 and loc[0] in {"body", "query", "path", "header", "cookie"}:
        loc = loc[1:]
    where = ".".join(loc) or "body"
    return f"{where}: {first.get('msg', 'is not valid')}"


#: Starlette's own HTTPExceptions carry only a status. These are the codes they get; a status
#: with no single §2.9 meaning is `internal`, never a guessed code.
_STATUS_CODE: Final[dict[int, ErrorCode]] = {
    400: "validation_failed",
    401: "auth_required",
    404: "not_found",
    # A known path with a method it does not serve: "no such route", as far as a client can act.
    405: "not_found",
    413: "payload_too_large",
    415: "unsupported_media_type",
    422: "validation_failed",
    501: "not_implemented",
}


def _http_exception(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code = _STATUS_CODE.get(exc.status_code, "internal")
    detail = exc.detail if isinstance(exc.detail, str) and exc.detail else code
    return envelope_response(
        ApiError(code, detail, status=exc.status_code, headers=exc.headers or None)
    )


def _request_validation(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    return envelope_response(
        ApiError("validation_failed", validation_detail(exc.errors(), from_fastapi=True))
    )


def _api_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return envelope_response(exc)


def _highlight_rejected(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, HighlightRejected)
    return envelope_response(ApiError(exc.code, exc.detail))


def _paper_not_found(_: Request, exc: Exception) -> JSONResponse:
    return envelope_response(ApiError("not_found", "no such paper"))


def _generation_not_found(_: Request, exc: Exception) -> JSONResponse:
    return envelope_response(ApiError("generation_not_found", str(exc) or "no such generation"))


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error)
    app.add_exception_handler(StarletteHTTPException, _http_exception)
    app.add_exception_handler(RequestValidationError, _request_validation)
    app.add_exception_handler(HighlightRejected, _highlight_rejected)
    app.add_exception_handler(PaperNotFound, _paper_not_found)
    app.add_exception_handler(GenerationNotFound, _generation_not_found)


class InternalErrorMiddleware:
    """Any exception a route did not turn into a response becomes `500 internal`.

    An ASGI middleware rather than `add_exception_handler(Exception, ...)`: that handler runs in
    Starlette's OUTERMOST `ServerErrorMiddleware`, outside CORS and the request-id middleware, so
    its response would carry neither `Access-Control-Allow-Origin` (the browser could not read the
    envelope) nor `X-Request-Id`. `create_app` installs this one INSIDE both.

    If the response had already started (a stream that failed half way), nothing can be sent in
    its place, so the exception is re-raised for the server to close the connection.
    """

    def __init__(self, app: ASGIApp, on_error: Any = None) -> None:
        self.app = app
        self.on_error = on_error

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as exc:
            if self.on_error is not None:
                self.on_error(scope, exc)
            if started:
                raise
            response = envelope_response(ApiError("internal", INTERNAL_DETAIL))
            await response(scope, receive, send)


def where(exc: BaseException) -> str:
    """`module:function:line` of the frame that raised: enough to find it, and no message text
    (an exception's message can carry a value from the request)."""
    frames = traceback.extract_tb(exc.__traceback__)
    if not frames:
        return "unknown"
    last = frames[-1]
    return f"{last.filename.rsplit('/', 1)[-1]}:{last.name}:{last.lineno}"
