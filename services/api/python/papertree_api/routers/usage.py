"""contracts.md §2.5: `GET /usage?since=ISO` (default now − 24 h). S5 builds it.

501 STUB WITH ITS FINAL MODEL (S0).
"""

from __future__ import annotations

from typing import Annotated, Any, Final

from fastapi import APIRouter, Query

from ..deps import CallerDep
from ..errors import ErrorEnvelope, not_implemented
from ..schemas import UsageTotals

router = APIRouter()

SLICE: Final = "S5"
NOT_YET: Final[dict[int | str, dict[str, Any]]] = {
    501: {"model": ErrorEnvelope, "description": f"Not implemented yet (slice {SLICE})"}
}


@router.get("/usage", response_model=UsageTotals, responses=NOT_YET)
async def get_usage(
    call: CallerDep,
    since: Annotated[str | None, Query(min_length=1, max_length=64)] = None,
) -> UsageTotals:
    raise not_implemented(SLICE)
