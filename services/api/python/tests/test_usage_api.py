"""contracts.md §2.5 ``GET /usage``: the caller's runs, tokens and estimated cost since a cut."""

from __future__ import annotations

from pathlib import Path

import pytest
from ai_support import (
    ai_harness,
    alice_with_paper,
    contract_errors,
    explain,
    paragraph_anchor,
    read_sse,
)
from api_support import auth, register
from fake_agent import Script, load_fixture
from papertree_api.schemas import UsageTotals

DONE = {
    name: next(f for f in load_fixture(name) if f.event == "done").data or {}
    for name in ("explain-ok", "summary-ok")
}


def test_usage_sums_the_callers_runs_by_kind_against_the_budget(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [Script("explain-ok"), Script("summary-ok")], budget_usd=2.5) as h:
        token, paper_id = alice_with_paper(h)
        read_sse(explain(h, token, paper_id, paragraph_anchor()))
        read_sse(h.client.post(f"/papers/{paper_id}/summary", json={}, headers=auth(token)))
        usage = h.client.get("/usage", headers=auth(token)).json()
        assert contract_errors(usage, "api/usage.schema.json", "UsageTotals", UsageTotals) == []
        explain_totals = DONE["explain-ok"]["usage_totals"]
        summary_totals = DONE["summary-ok"]["usage_totals"]
        assert usage["runs"] == 2 and usage["budget_usd"] == 2.5
        assert usage["input_tokens"] == explain_totals["input"] + summary_totals["input"]
        assert usage["output_tokens"] == explain_totals["output"] + summary_totals["output"]
        assert usage["cost_usd_est"] == pytest.approx(
            explain_totals["cost_usd_est"] + summary_totals["cost_usd_est"]
        )
        assert usage["by_kind"]["explain"]["runs"] == 1
        assert usage["by_kind"]["summary"]["input_tokens"] == summary_totals["input"]
        assert usage["by_kind"]["ask"] == {
            "runs": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_usd_est": 0.0,
        }
        later = h.client.get(
            "/usage", params={"since": "2099-01-01T00:00:00Z"}, headers=auth(token)
        ).json()
        assert later["runs"] == 0 and later["since"] == "2099-01-01T00:00:00.000Z"
        # Another user's usage is theirs alone.
        bob = register(h.client, "bob@example.com")
        assert h.client.get("/usage", headers=auth(bob)).json()["runs"] == 0
