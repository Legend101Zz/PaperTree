"""What more than one router needs: the JSON body reader, the `?gen=` parameter, and rows as
response bodies.

WHY BODIES ARE READ HERE AND NOT BY FASTAPI. A FastAPI body parameter decodes with the stdlib
`json.loads`, which accepts what pydantic's own JSON parser refuses: a lone surrogate (`"\\ud800"`,
which then fails to ENCODE at the SQLite bind, a 500), and nesting deep enough to raise
`RecursionError` (also a 500, because FastAPI catches only `JSONDecodeError`). Wave 1 measured
both on the highlight routes and fixed them by parsing in the handler with `model_validate_json`;
this is that parser, shared, so every JSON route gets the same "never 500 on a bad body".

It runs as a DEPENDENCY listed after the caller, so an unauthenticated request is a 401 before its
body is looked at, and a malformed body is a 422 before the handler runs.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Annotated, Any, Final

from fastapi import Depends, Request
from papertree_db import SQLITE_INTEGER_MAX
from pydantic import BaseModel, ValidationError
from pydantic_core import from_json

from ..errors import ApiError, validation_detail
from ..wiretime import wire_time


async def read_json[M: BaseModel](request: Request, model: type[M]) -> tuple[M, Any]:
    """The body as `model`, plus the same bytes as plain JSON data (for a caller that must store
    what the client sent verbatim, such as an Anchor record). 422 `validation_failed` naming the
    first failing field otherwise."""
    raw = await request.body()
    try:
        parsed = model.model_validate_json(raw)
    except ValidationError as exc:
        raise ApiError(
            "validation_failed", validation_detail(exc.errors(include_url=False))
        ) from exc
    # Cannot fail: the bytes just parsed as JSON under the same parser.
    return parsed, from_json(raw)


def json_body[M: BaseModel](model: type[M]) -> Callable[[Request], Awaitable[M]]:
    """`Depends(json_body(Model))`: the body as `model`, read by `read_json`."""

    async def dependency(request: Request) -> M:
        parsed, _ = await read_json(request, model)
        return parsed

    dependency.__name__ = f"json_body_{model.__name__}"
    return dependency


#: `?gen=`: ASCII digits only. `str.isdigit()` is also True for "²" (then `int()` raises, a 500)
#: and for "٣" (which `int()` silently reads as 3); 19 digits cover SQLite's range. Wave 1's grammar
#: for the highlight routes, now the ONE grammar for every route that takes `?gen=`.
_GEN_PARAM: Final = re.compile(r"[0-9]{1,19}")


async def gen_param(request: Request) -> int | None:
    """`?gen=` as a generation (1 to `SQLITE_INTEGER_MAX`), absent as None, anything else 422."""
    raw = request.query_params.get("gen")
    if raw is None:
        return None
    if _GEN_PARAM.fullmatch(raw) is None or not 1 <= int(raw) <= SQLITE_INTEGER_MAX:
        raise ApiError(
            "validation_failed", f"gen: must be an integer from 1 to {SQLITE_INTEGER_MAX}"
        )
    return int(raw)


GenParam = Annotated[int | None, Depends(gen_param)]


def public_row(row: Any) -> dict[str, Any]:
    """A DB row as a response body: minus `owner_id`, and every `*_at` in the §0 wire shape.

    Every owned table carries `owner_id` and several of the reads are `SELECT *`, so `dict(row)`
    puts an opaque owner handle straight into a JSON response — which is precisely what AGENTS.md
    §4 forbids, and it happened: `test_no_response_anywhere_carries_an_owner_handle` caught it on
    `GET /papers` before anything shipped. Stripping it centrally rather than per route is the
    point: a per-route `del` is one route away from being forgotten, and the failure is silent.

    The times: the row keeps what its writer stamped (`isoformat()`, `…Z`, a legacy value), and
    the response gets contracts.md §0's one shape (`wiretime.wire_time`).
    """
    return {
        key: wire_time(value) if key.endswith("_at") and isinstance(value, str) else value
        for key, value in dict(row).items()
        if key != "owner_id"
    }
