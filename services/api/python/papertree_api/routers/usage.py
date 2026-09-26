"""contracts.md §2.5: ``GET /usage?since=ISO`` (default now − 24 h). S5.

The caller's runs STARTED since the cut, their token counts and estimated cost (``ai_runs``), per
kind, beside the daily budget the spend cap enforces. A run still streaming counts as a run with
no tokens yet. The numbers are the agent's estimates (``cost_usd_est``), not an invoice. Dollars
go on the wire to the nano-dollar (:data:`USD_PLACES`): a float sum's noise
(``0.006207000000000001``) is not a figure a reader should see.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response

from ..deps import CallerDep, SettingsDep
from ..schemas import IsoTime, UsageTotals
from ..wiretime import format_moment

router = APIRouter()

#: Finer than one token's price, coarser than a float sum's rounding error.
USD_PLACES = 9


@router.get("/usage", response_model=UsageTotals)
async def get_usage(
    call: CallerDep,
    settings: SettingsDep,
    #: An aware UTC `datetime`, or a 422 naming `since` (`schemas.IsoTime`).
    since: Annotated[IsoTime | None, Query()] = None,
) -> Response:
    cut = since if since is not None else datetime.now(UTC) - timedelta(hours=24)
    totals = call.db.usage_since(call.db_owner, cut.isoformat())
    return JSONResponse(
        {
            "since": format_moment(cut),
            "runs": totals.runs,
            "input_tokens": totals.input_tokens,
            "output_tokens": totals.output_tokens,
            "cost_usd_est": round(totals.cost_usd_est, USD_PLACES),
            "budget_usd": settings.daily_budget_usd,
            "by_kind": {
                kind: {**asdict(bucket), "cost_usd_est": round(bucket.cost_usd_est, USD_PLACES)}
                for kind, bucket in totals.by_kind.items()
            },
        }
    )
