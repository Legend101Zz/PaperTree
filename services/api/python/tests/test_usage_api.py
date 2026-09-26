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


def test_usage_puts_no_float_noise_on_the_wire(tmp_path: Path) -> None:
    """Review S5: summing floats gave `0.006207000000000001`; the wire carries the dollars to
    the nano-dollar (9 places, finer than one token's price), per kind and in total."""
    scripts = [Script("explain-ok"), Script("followup-ok"), Script("summary-ok")]
    with ai_harness(tmp_path, scripts, budget_usd=2.5) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        thread_id = next(f for f in frames if f.event == "run").data["thread_id"]
        read_sse(
            h.client.post(
                f"/papers/{paper_id}/threads/{thread_id}/messages",
                json={"question": "Why?"},
                headers=auth(token),
            )
        )
        read_sse(h.client.post(f"/papers/{paper_id}/summary", json={}, headers=auth(token)))
        costs = [DONE[n]["usage_totals"]["cost_usd_est"] for n in ("explain-ok", "summary-ok")]
        followup = next(f for f in load_fixture("followup-ok") if f.event == "done").data or {}
        costs.append(followup["usage_totals"]["cost_usd_est"])
        # By kind (explain 0.003158, ask 0, summary 0.003049) the plain sum is 0.006207000000000001.
        response = h.client.get("/usage", headers=auth(token))
        usage = response.json()
        assert usage["runs"] == 3
        assert usage["cost_usd_est"] == round(sum(costs), 9) == 0.006207
        assert usage["by_kind"]["explain"]["cost_usd_est"] == 0.003158
        assert "0000000" not in response.text, response.text
