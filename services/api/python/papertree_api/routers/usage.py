"""contracts.md §2.5: ``GET /usage?since=ISO`` (default now − 24 h). S5.

The caller's runs STARTED since the cut, their token counts and estimated cost (``ai_runs``), per
kind, beside the daily budget the spend cap enforces. A run still streaming counts as a run with
no tokens yet. The numbers are the agent's estimates (``cost_usd_est``), not an invoice.
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
            "cost_usd_est": totals.cost_usd_est,
            "budget_usd": settings.daily_budget_usd,
            "by_kind": {kind: asdict(bucket) for kind, bucket in totals.by_kind.items()},
        }
    )
