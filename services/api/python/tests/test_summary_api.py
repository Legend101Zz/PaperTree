"""contracts.md §2.5/§3.4: the paper summary — a run whose answer becomes a cached derivation.

The cache is the product claim ("a reload shows the cached summary without a new run", journey
C), so it is asserted on the ROWS: ``ai_runs`` and the fake's request log do not move.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ai_support import (
    ai_harness,
    alice_with_paper,
    anchor_errors,
    contract_errors,
    events,
    read_sse,
)
from api_support import assert_envelope, auth, harness, load_fixture, register, seed_paper
from fake_agent import RunContext, Script
from papertree_api.schemas import SummaryStatus
from papertree_db import PaperTreeDb


def _post(h: Any, token: str, paper_id: str, body: dict[str, Any] | None = None) -> Any:
    return h.client.post(f"/papers/{paper_id}/summary", json=body or {}, headers=auth(token))


def test_a_summary_streams_then_is_served_from_the_cache_without_a_new_run(
    tmp_path: Path,
) -> None:
    with ai_harness(tmp_path, Script("summary-ok")) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(_post(h, token, paper_id))
        run = events(frames, "run")[0]
        assert run["thread_id"] is None and run["user_message_id"] is None
        assert run["message_id"].startswith("msg_")
        request = h.fake.requests[0]
        assert request["kind"] == "summary" and request["seed"] is None
        assert request["prompt_version"] == "summary-v1"
        assert request["limits"] == {
            "deadline_ms": 90000,
            "idle_ms": 20000,
            "max_tool_calls": 12,
            "max_turns": 6,
            "max_output_tokens": 6144,
            "max_retries": 1,
        }
        assert h.fake.contract_errors == []
        citations = events(frames, "citations")[0]["items"]
        assert len(citations) == 7, "one citation per marker per bullet (b13 and b14 share one)"
        assert all(anchor_errors(c["anchor"]) == [] for c in citations)
        (row,) = h.rows("SELECT * FROM ai_runs")
        assert row["code_path"].startswith("api.summary>") and row["kind"] == "summary"
        assert row["thread_id"] is None and row["message_id"] == run["message_id"]
        assert h.count("ai_messages") == 0, "a summary is a derivation, not a message"
        (stored,) = h.rows("SELECT * FROM derivations WHERE kind = 'paper_summary'")
        assert (stored["prompt_hash"], stored["model_id"]) == ("summary-v1", "MiniMax-M3")
        summary = json.loads(stored["content"])
        assert len(summary["bullets"]) == 6
        handles = {r["handle"]: r["block_id"] for r in h.rows("SELECT * FROM ai_run_handles")}
        assert set(json.loads(stored["derived_from"])) == {handles[c["marker"]] for c in citations}
        # Every bullet cites a valid marker, so the summary is complete; YOLO's claims are not in
        # resnet's text, so each bullet is FLAGGED (supported: false), and that is not "partial".
        assert summary["status"] == "complete"
        assert [b["supported"] for b in summary["bullets"]] == [False] * 6

        runs_before, requests_before = h.count("ai_runs"), len(h.fake.requests)
        cached = _post(h, token, paper_id)
        assert cached.status_code == 200
        assert cached.headers["content-type"].startswith("application/json")
        body = cached.json()
        assert body["state"] == "ready" and body["summary"] == summary
        assert (
            contract_errors(body, "api/summary.schema.json", "SummaryStatus", SummaryStatus) == []
        )
        reloaded = h.client.get(f"/papers/{paper_id}/summary", headers=auth(token)).json()
        assert reloaded == body
        assert (h.count("ai_runs"), len(h.fake.requests)) == (runs_before, requests_before), (
            "a reload started a run"
        )


def test_regenerate_replaces_the_cached_summary(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("summary-ok")) as h:
        token, paper_id = alice_with_paper(h)
        read_sse(_post(h, token, paper_id))
        first = h.rows("SELECT derivation_id FROM derivations WHERE kind = 'paper_summary'")
        read_sse(_post(h, token, paper_id, {"regenerate": True}))
        second = h.rows("SELECT derivation_id FROM derivations WHERE kind = 'paper_summary'")
        assert len(second) == 1 and second != first
        assert h.count("ai_runs") == 2


def test_grounded_bullets_are_supported_and_an_unmarked_bullet_makes_it_partial(
    tmp_path: Path,
) -> None:
    def bullets(context: RunContext) -> str:
        grounded = [h for h in context.seen if len(context.texts.get(h, "").split()) > 12][:2]
        lines = [f"- {' '.join(context.texts[h].split()[:12])} [{h}]." for h in grounded]
        lines.append("- This bullet cites nothing at all.")
        return "\n".join(lines)

    with ai_harness(tmp_path, Script("summary-ok", final_text=bullets)) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(_post(h, token, paper_id))
        assert events(frames, "done")[0]["status"] == "partial"
        status = h.client.get(f"/papers/{paper_id}/summary", headers=auth(token)).json()
        assert status["state"] == "partial"
        assert [b["supported"] for b in status["summary"]["bullets"]] == [True, True, False]
        assert status["summary"]["bullets"][2]["citations"] == []


def test_a_failed_summary_run_reads_back_as_failed(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("auth-error")) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(_post(h, token, paper_id))
        assert events(frames, "done")[0]["error"]["code"] == "provider_auth"
        status = h.client.get(f"/papers/{paper_id}/summary", headers=auth(token)).json()
        assert status == {"state": "failed", "summary": None}
        assert h.count("derivations") == 0


def test_the_states_none_and_running_and_a_second_run_is_busy(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("summary-ok")) as h:
        token, paper_id = alice_with_paper(h)
        assert h.client.get(f"/papers/{paper_id}/summary", headers=auth(token)).json() == {
            "state": "none",
            "summary": None,
        }
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        db = PaperTreeDb(h.settings.database_file)
        db.create_run(
            db.owner_for(user_id),
            run_id="run_01K63AE8M4Q2T7V9X3B5N6R0S1",
            paper_id=paper_id,  # type: ignore[arg-type]
            generation=1,
            kind="summary",
            thread_id=None,
            message_id=None,
            token_sha256="0" * 64,
            datamark="^00000000",
            expires_at="2099-01-01T00:00:00Z",
            code_path="api.summary>test",
            request_id=None,
            prompt_version="summary-v1",
        )
        db.close()
        assert h.client.get(f"/papers/{paper_id}/summary", headers=auth(token)).json()["state"] == (
            "running"
        )
        assert_envelope(_post(h, token, paper_id), 409, "busy")
        assert h.fake.requests == []


def test_summary_refusals(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")
        assert_envelope(_post(h, token, paper_id), 503, "not_configured")
        assert_envelope(_post(h, token, "ppr_0000000000000000000000NONE"), 404, "not_found")
        body = assert_envelope(
            h.client.post(
                f"/papers/{paper_id}/summary", json={"regenerate": "yes"}, headers=auth(token)
            ),
            422,
            "validation_failed",
        )
        assert body["detail"].startswith("regenerate")
    with ai_harness(tmp_path / "unparsed", Script("summary-ok")) as h:
        token = register(h.client, "alice@example.com")
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        document = load_fixture("resnet-cvpr-2col")
        db = PaperTreeDb(h.settings.database_file)
        db.put_paper(db.owner_for(user_id), document)
        db.close()
        assert_envelope(_post(h, token, document["paper_id"]), 409, "not_parsed")


def test_bob_cannot_read_or_start_alices_summary(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("summary-ok")) as h:
        alice, paper_id = alice_with_paper(h)
        read_sse(_post(h, alice, paper_id))
        bob = register(h.client, "bob@example.com")
        assert_envelope(
            h.client.get(f"/papers/{paper_id}/summary", headers=auth(bob)), 404, "not_found"
        )
        assert_envelope(_post(h, bob, paper_id), 404, "not_found")
        assert h.client.get(f"/papers/{paper_id}/summary", headers=auth(alice)).json()["state"] in (
            "ready",
            "partial",
        )
