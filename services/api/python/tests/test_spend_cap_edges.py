"""contracts.md §3.4 spend cap, held AT ITS EDGE on every route that starts a run (W2API item 5).

The S5F reviewer's mutants r1 (summary reserve 0), r2 (the summary route skips ``require_budget``),
r10 (ask reserve 0) and r12 (the follow-up route skips ``require_budget``) all survived, because
the cap was only ever tested through the explain route and with explain runs in flight. Here the
five routes (explain thread, ask thread, follow-up message, summary, and since v0.2 S7a the
diagram thread) each meet:

  * the SPENT edge: a finished spend of exactly the budget is 429 ``budget_exhausted``; a budget a
    millionth of a dollar larger lets the run start;
  * the RESERVE edge, per KIND in flight (explain $0.01, ask $0.02, summary $0.05, diagram
    $0.02, and topic $0.01: #242's run is not built, but a row of it must not break the cap):
    ``spent +
    reservation == budget`` is 429 with the in-flight sentence, a millionth more is admitted.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
from ai_support import (
    AiHarness,
    ai_harness,
    alice_with_paper,
    contract_errors,
    events,
    explain,
    paragraph_anchor,
    read_sse,
)
from api_support import assert_envelope, auth, seed_paper
from fake_agent import Script
from papertree_api.agent_client import RUN_RESERVE_USD
from papertree_api.schemas import UsageTotals
from papertree_db import PaperTreeDb

ROUTES = ("explain", "ask", "followup", "summary", "diagram")
EDGE = 1e-6


def _scripts(route: str) -> list[Script]:
    first = [Script("explain-ok")]  # the setup run that leaves a spend behind
    return {
        "explain": [*first, Script("explain-ok")],
        "ask": [*first, Script("explain-ok")],
        "followup": [*first, Script("followup-ok")],
        "summary": [*first, Script("summary-ok")],
        "diagram": [*first, Script("diagram-ok")],
    }[route]


def _start(h: AiHarness, token: str, paper_id: str, route: str, thread_id: str) -> httpx.Response:
    headers = {**auth(token), "Accept": "text/event-stream"}
    if route == "explain":
        return explain(h, token, paper_id, paragraph_anchor())
    response: httpx.Response
    if route == "ask":
        response = h.client.post(
            f"/papers/{paper_id}/threads",
            json={"kind": "ask", "question": "What does the paper claim?"},
            headers=headers,
        )
    elif route == "diagram":
        response = h.client.post(
            f"/papers/{paper_id}/threads",
            json={"kind": "diagram", "anchor": paragraph_anchor()},
            headers=headers,
        )
    elif route == "followup":
        response = h.client.post(
            f"/papers/{paper_id}/threads/{thread_id}/messages",
            json={"question": "Why does that make it faster?"},
            headers=headers,
        )
    else:
        response = h.client.post(f"/papers/{paper_id}/summary", json={}, headers=headers)
    return response


def _other_paper(h: AiHarness, token: str) -> str:
    """ANOTHER paper of the caller's: a run in flight on the same paper (a live summary, say)
    would answer ``busy`` before the cap is reached."""
    return seed_paper(h.settings, h.client, token, "attention-is-all-you-need")


def _in_flight(h: AiHarness, token: str, paper_id: str, run_id: str, kind: str) -> None:
    user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
    db = PaperTreeDb(h.settings.database_file)
    try:
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
            expires_at="2099-01-01T00:00:00Z",
            code_path="x",
            request_id=None,
            prompt_version=None,
        )
    finally:
        db.close()


def _set_budget(h: AiHarness, budget: float) -> None:
    object.__setattr__(h.settings, "daily_budget_usd", budget)  # frozen dataclass: the test's lever


def _spent(h: AiHarness) -> float:
    (row,) = h.rows("SELECT COALESCE(SUM(cost_usd_est), 0) AS spent FROM ai_runs")
    return float(row["spent"])


def _after_setup_run(h: AiHarness) -> tuple[str, str, str, float]:
    token, paper_id = alice_with_paper(h)
    frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
    thread_id = events(frames, "run")[0]["thread_id"]
    spent = _spent(h)
    assert spent > 0, "the setup run left a spend behind"
    return token, paper_id, thread_id, spent


def _rows(h: AiHarness) -> tuple[int, int, int]:
    return h.count("ai_threads"), h.count("ai_runs"), len(h.fake.requests)


@pytest.mark.parametrize("route", ROUTES)
def test_a_spend_of_exactly_the_budget_is_429_on_every_route(tmp_path: Path, route: str) -> None:
    with ai_harness(tmp_path, _scripts(route)) as h:
        token, paper_id, thread_id, spent = _after_setup_run(h)
        before = _rows(h)
        _set_budget(h, spent)
        refused = assert_envelope(
            _start(h, token, paper_id, route, thread_id), 429, "budget_exhausted"
        )
        assert refused["detail"].endswith("."), "a sentence"
        assert _rows(h) == before, "refused before any row and before the agent"
        _set_budget(h, spent + EDGE)
        assert _start(h, token, paper_id, route, thread_id).status_code == 200


@pytest.mark.parametrize("kind", sorted(RUN_RESERVE_USD))
@pytest.mark.parametrize("route", ROUTES)
def test_a_run_in_flight_reserves_its_kind_on_every_route(
    tmp_path: Path, route: str, kind: str
) -> None:
    reserve = RUN_RESERVE_USD[kind]
    with ai_harness(tmp_path, _scripts(route)) as h:
        token, paper_id, thread_id, spent = _after_setup_run(h)
        other = _other_paper(h, token)
        _in_flight(h, token, other, "run_01K63AE8M4Q2T7V9X3B5N6R0H1", kind)
        before = _rows(h)
        _set_budget(h, spent + reserve)
        refused = assert_envelope(
            _start(h, token, paper_id, route, thread_id), 429, "budget_exhausted"
        )
        assert refused["detail"].startswith("Answers that are still being written"), refused
        assert _rows(h) == before
        _set_budget(h, spent + reserve + EDGE)
        assert _start(h, token, paper_id, route, thread_id).status_code == 200


def test_the_reserves_are_the_contracts_numbers() -> None:
    assert RUN_RESERVE_USD == {
        "explain": 0.01,
        "ask": 0.02,
        "summary": 0.05,
        "diagram": 0.02,
        "topic": 0.01,
    }


def test_a_topic_run_row_is_counted_and_breaks_no_route(tmp_path: Path) -> None:
    """0011 allows `topic` (#242) before its run exists: a row of it, in flight, is reserved for and
    shows in `GET /usage` in the contract's shape, and a run still starts (review N9)."""
    with ai_harness(tmp_path, _scripts("explain")) as h:
        token, paper_id, _thread, _spent = _after_setup_run(h)
        _in_flight(h, token, _other_paper(h, token), "run_01K63AE8M4Q2T7V9X3B5N6R0T1", "topic")
        usage = h.client.get("/usage", headers=auth(token))
        assert usage.status_code == 200, usage.text
        body = usage.json()
        assert body["by_kind"]["topic"]["runs"] == 1
        assert contract_errors(body, "api/usage.schema.json", "UsageTotals", UsageTotals) == []
        assert _start(h, token, paper_id, "explain", _thread).status_code == 200


def test_two_runs_in_flight_reserve_twice(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _scripts("summary")) as h:
        token, paper_id, thread_id, spent = _after_setup_run(h)
        other = _other_paper(h, token)
        for n in (1, 2):
            _in_flight(h, token, other, f"run_01K63AE8M4Q2T7V9X3B5N6R0J{n}", "ask")
        _set_budget(h, spent + 2 * RUN_RESERVE_USD["ask"])
        assert_envelope(_start(h, token, paper_id, "summary", thread_id), 429, "budget_exhausted")
        _set_budget(h, spent + 2 * RUN_RESERVE_USD["ask"] + EDGE)
        assert _start(h, token, paper_id, "summary", thread_id).status_code == 200


_ = Any  # (kept for the signature style of sibling modules)
