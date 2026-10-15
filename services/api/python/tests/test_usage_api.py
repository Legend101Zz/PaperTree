"""contracts.md §2.5 ``GET /usage``: the caller's runs, tokens and estimated cost since a cut."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from ai_support import (
    ai_harness,
    alice_with_paper,
    contract_errors,
    events,
    explain,
    paragraph_anchor,
    read_sse,
)
from api_support import assert_envelope, auth, register
from fake_agent import Script, load_fixture
from papertree_api.schemas import UsageTotals
from papertree_db import PaperTreeDb

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


# ── S5F: the cap counts runs in flight; orphans are ended ────────────────────────────────────


def _running(
    h: Any, token: str, paper_id: str, run_id: str, *, kind: str = "explain", expires: str
) -> None:
    user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
    db = PaperTreeDb(h.settings.database_file)
    db.create_run(
        db.owner_for(user_id),
        run_id=run_id,
        paper_id=paper_id,  # type: ignore[arg-type]
        generation=1,
        kind=kind,
        thread_id=None,
        message_id=None,
        token_sha256="0" * 64,
        datamark="^00000000",
        expires_at=expires,
        code_path="x",
        request_id=None,
        prompt_version=None,
    )
    db.close()


def test_runs_in_flight_reserve_budget_so_concurrent_runs_cannot_overshoot(tmp_path: Path) -> None:
    """Five explains in flight reserve 5 x $0.01 = $0.05 of a $0.05 budget although none has a
    cost yet: the sixth is 429 with a sentence that says why; with four in flight it passes."""
    with ai_harness(tmp_path, Script("explain-ok"), budget_usd=0.05) as h:
        token, paper_id = alice_with_paper(h)
        for n in range(4):
            _running(
                h,
                token,
                paper_id,
                f"run_01K63AE8M4Q2T7V9X3B5N6R0F{n}",
                expires="2099-01-01T00:00:00Z",
            )
        assert h.client.get("/usage", headers=auth(token)).json()["cost_usd_est"] == 0, (
            "nothing has a cost yet: the old check would let every one of these through"
        )
        _running(
            h, token, paper_id, "run_01K63AE8M4Q2T7V9X3B5N6R0F9", expires="2099-01-01T00:00:00Z"
        )
        body = assert_envelope(
            explain(h, token, paper_id, paragraph_anchor()), 429, "budget_exhausted"
        )
        assert body["detail"].startswith("Answers that are still being written")
        assert body["detail"].endswith("."), "a sentence"
        assert h.fake.requests == [] and h.count("ai_threads") == 0, "refused before any row"
    with ai_harness(tmp_path / "four", Script("explain-ok"), budget_usd=0.05) as h:
        token, paper_id = alice_with_paper(h)
        for n in range(4):
            _running(
                h,
                token,
                paper_id,
                f"run_01K63AE8M4Q2T7V9X3B5N6R0F{n}",
                expires="2099-01-01T00:00:00Z",
            )
        assert explain(h, token, paper_id, paragraph_anchor()).status_code == 200


def test_a_reservation_frees_up_when_the_run_ends(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok"), budget_usd=0.05) as h:
        token, paper_id = alice_with_paper(h)
        for n in range(5):
            _running(
                h,
                token,
                paper_id,
                f"run_01K63AE8M4Q2T7V9X3B5N6R0G{n}",
                expires="2099-01-01T00:00:00Z",
            )
        assert_envelope(explain(h, token, paper_id, paragraph_anchor()), 429, "budget_exhausted")
        db = PaperTreeDb(h.settings.database_file)
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        for n in range(5):
            db.finish_run(
                db.owner_for(user_id), f"run_01K63AE8M4Q2T7V9X3B5N6R0G{n}", status="aborted"
            )
        db.close()
        assert explain(h, token, paper_id, paragraph_anchor()).status_code == 200


def test_the_spent_budget_message_is_a_sentence(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok"), budget_usd=0.001) as h:
        token, paper_id = alice_with_paper(h)
        read_sse(explain(h, token, paper_id, paragraph_anchor()))
        body = assert_envelope(
            explain(h, token, paper_id, paragraph_anchor()), 429, "budget_exhausted"
        )
        assert body["detail"] == (
            "The AI budget for the last 24 hours ($0.001) is used up. "
            "It frees up as older answers roll off."
        )


def test_an_orphaned_run_is_ended_by_the_next_read_and_never_shows_as_running(
    tmp_path: Path,
) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        _running(
            h, token, paper_id, "run_01K63AE8M4Q2T7V9X3B5N6R0H1", expires="2026-01-01T00:00:00Z"
        )
        _running(
            h, token, paper_id, "run_01K63AE8M4Q2T7V9X3B5N6R0H2", expires="2099-01-01T00:00:00Z"
        )
        h.client.get("/usage", headers=auth(token))
        rows = {
            r["run_id"][-2:]: (r["status"], r["error_code"])
            for r in h.rows("SELECT run_id, status, error_code FROM ai_runs")
        }
        assert rows == {"H1": ("error", "internal"), "H2": ("running", None)}


def test_the_api_ends_orphans_when_it_starts(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient
    from papertree_api.app import create_app

    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        _running(
            h, token, paper_id, "run_01K63AE8M4Q2T7V9X3B5N6R0J1", expires="2026-01-01T00:00:00Z"
        )
        with TestClient(create_app(h.settings)):  # the startup hook runs on entering the client
            pass
        (row,) = h.rows("SELECT status, error_code FROM ai_runs")
        assert (row["status"], row["error_code"]) == ("error", "internal")


def test_an_aborted_run_with_no_reported_usage_stores_null_tokens_not_zero(tmp_path: Path) -> None:
    """Pi reported cache reads but no input/output for the aborted message although text had
    streamed: the tokens are UNKNOWN. The row, the `usage` event and `/usage` say null/0-sum, and
    the cost the agent did report stays."""
    patch: dict[str, Any] = {
        "status": "aborted",
        "stop_reason": "aborted",
        "error": {"code": "aborted", "retryable": True, "message": "The answer was stopped."},
        "usage_totals": {
            "input": 0,
            "output": 0,
            "cache_read": 4388,
            "cache_write": 0,
            "reasoning": None,
            "cost_usd_est": 0.00026328,
        },
    }
    with ai_harness(tmp_path, Script("explain-ok", done_patch=patch)) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        usage = events(frames, "usage")[0]
        assert usage["input_tokens"] is None and usage["output_tokens"] is None
        assert usage["cache_read_tokens"] == 4388 and usage["cost_usd_est"] == 0.00026328
        (row,) = h.rows("SELECT * FROM ai_runs")
        # An `aborted` done nobody asked for is the agent going away (W2API item 4): the run is
        # an `agent_unavailable` error, and its unknown tokens stay unknown.
        assert (row["status"], row["error_code"]) == ("error", "agent_unavailable")
        assert row["input_tokens"] is None and row["output_tokens"] is None
        assert row["reasoning_tokens"] is None and row["cache_read_tokens"] == 4388
    zero_cost = {
        **patch,
        "usage_totals": {**patch["usage_totals"], "cache_read": 0, "cost_usd_est": 0},
    }
    with ai_harness(tmp_path / "zero", Script("explain-ok", done_patch=zero_cost)) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        assert events(frames, "usage")[0]["cost_usd_est"] is None, (
            "0 beside unknown tokens is unknown"
        )
        (row,) = h.rows("SELECT input_tokens, cost_usd_est FROM ai_runs")
        assert row["input_tokens"] is None and row["cost_usd_est"] is None
    with ai_harness(tmp_path / "real", Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        read_sse(explain(h, token, paper_id, paragraph_anchor()))
        (row,) = h.rows("SELECT input_tokens FROM ai_runs")
        assert row["input_tokens"] == DONE["explain-ok"]["usage_totals"]["input"], (
            "reported is kept"
        )
