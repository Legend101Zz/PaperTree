"""What more than one router needs: the JSON body reader.

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

from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request
from pydantic import BaseModel, ValidationError
from pydantic_core import from_json

from ..errors import ApiError, validation_detail


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
