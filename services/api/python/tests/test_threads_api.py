"""contracts.md §2.5/§2.6/§3.4: explain, ask, follow-up and cancel, against a FakeAgent that
replays ``contracts/agent/fixtures/*.sse`` and calls the API's real internal tools.

Every positive test asserts something the REPLAY could not have produced by itself (AGENTS.md
§2): the rows the API wrote, the handles it issued and the fake then cited, the Anchors it minted
against the real stored parse, the verifier's verdict on text the fake quoted from that parse.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import pytest
from ai_support import (
    SECRET,
    ai_harness,
    alice_with_paper,
    anchor_errors,
    block_of,
    contract_errors,
    events,
    explain,
    paragraph_anchor,
    read_sse,
)
from api_support import assert_envelope, auth, harness, load_fixture, register, seed_paper
from fake_agent import RunContext, Script
from fake_agent import load_fixture as load_agent_fixture
from fastapi.testclient import TestClient
from papertree_api import agent_client, create_app
from papertree_api.schemas import BROWSER_EVENTS, Message, Thread, ThreadDetail
from papertree_api.settings import Settings
from papertree_db import PaperTreeDb

EXPLAIN_DONE = next(f for f in load_agent_fixture("explain-ok") if f.event == "done").data or {}
SSE_DEFS = {
    "run": "SseRun",
    "status": "SseStatus",
    "text": "SseText",
    "citations": "SseCitations",
    "usage": "RunSummary",
    "done": "SseDone",
}


def _assert_browser_stream(frames: list[Any]) -> None:
    """§2.6: `run` first, `citations` then `usage` then `done` last, every `data` the contract's."""
    names = [f.event for f in frames]
    assert names[0] == "run" and names[-1] == "done", names
    assert names[-3:] == ["citations", "usage", "done"], names
    assert names.count("citations") == names.count("usage") == names.count("done") == 1
    for frame in frames:
        assert not contract_errors(
            frame.data, "api/sse.schema.json", SSE_DEFS[frame.event], BROWSER_EVENTS[frame.event]
        ), frame


# ── explain: the happy path, and what only the API could have produced ───────────────────────


def test_explain_streams_the_contract_and_persists_the_whole_turn(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        anchor = paragraph_anchor()
        response = explain(h, token, paper_id, anchor)
        frames, _pings = read_sse(response)
        _assert_browser_stream(frames)
        assert h.fake.contract_errors == [], "the API sent a run request the contract refuses"

        run = events(frames, "run")[0]
        done = events(frames, "done")[0]
        assert done == {"status": "complete", "error": None, "message_id": run["message_id"]}
        streamed = "".join(t["delta"] for t in events(frames, "text"))

        # The REQUEST the API sent: the selected block is b1, datamarked, no block id leaks.
        request = h.fake.requests[0]
        assert request["kind"] == "explain" and request["prompt_version"] == "explain-v1"
        assert request["history"] is None and request["limits"]["deadline_ms"] == 45000
        seed = request["seed"]
        handles = dict(
            (r["handle"], r["block_id"])
            for r in h.rows("SELECT handle, block_id FROM ai_run_handles")
        )
        assert seed["passages"][0]["handle"] == "b1"
        assert handles["b1"] == block_of(anchor), "the SELECTED block is the first passage"
        assert seed["quote"] == next(
            s["exact"] for s in anchor["selectors"] if s["type"] == "TextQuoteSelector"
        )
        assert all(request["datamark"] in p["text"] for p in seed["passages"])
        assert "blk_" not in json.dumps(request), "the model is shown handles, never block ids"
        agent_headers = h.fake.headers[0]
        assert agent_headers["x-papertree-agent-secret"] == SECRET
        assert agent_headers["x-request-id"] == response.headers["x-request-id"]

        # The ROWS.
        (thread,) = h.rows("SELECT * FROM ai_threads")
        assert thread["thread_id"] == run["thread_id"] and thread["kind"] == "explain"
        assert json.loads(thread["origin_anchor_json"])["id"] == anchor["id"]
        assert json.loads(thread["agent_state_json"]) == EXPLAIN_DONE["entries"]
        messages = h.rows("SELECT * FROM ai_messages ORDER BY ordinal")
        assert [(m["role"], m["status"]) for m in messages] == [
            ("user", "complete"),
            ("assistant", "complete"),
        ]
        assert messages[0]["content"] == "Explain this passage."
        assert messages[1]["content"] == streamed and messages[1]["run_id"] == run["run_id"]
        (row,) = h.rows("SELECT * FROM ai_runs")
        assert row["status"] == "done" and row["error_code"] is None
        assert row["code_path"] == (
            "api.threads.explain>agent.v1.runs>pi.createAgentSession>minimax.anthropic-messages"
        )
        assert (row["provider"], row["model"], row["agent_sdk"]) == (
            "minimax",
            "MiniMax-M3",
            "pi-coding-agent@0.87.1",
        )
        totals = EXPLAIN_DONE["usage_totals"]
        assert (row["input_tokens"], row["output_tokens"], row["cache_read_tokens"]) == (
            totals["input"],
            totals["output"],
            totals["cache_read"],
        )
        assert row["cost_usd_est"] == pytest.approx(totals["cost_usd_est"])
        assert row["tool_calls"] == 1 and row["retries"] == 0
        assert 0 <= row["first_text_ms"] <= row["latency_ms"]
        assert json.loads(row["tool_calls_json"])[0]["tool"] == "search_passages"
        assert row["datamark"] == request["datamark"]
        # The token is shown to the agent once and stored only as its hash.
        token_sent = request["tool"]["token"]
        assert row["token_sha256"] == hashlib.sha256(token_sent.encode()).hexdigest()
        assert token_sent not in json.dumps(h.rows("SELECT * FROM ai_runs"))
        assert request["tool"]["base_url"].endswith(f"/internal/agent/runs/{run['run_id']}")

        # The CITATIONS: the three markers the answer carries, each a server-minted Anchor on the
        # stored parse, each checked by the verifier (the YOLO prose does not match resnet).
        citations = events(frames, "citations")[0]["items"]
        assert [c["marker"] for c in citations] == ["b2", "b1", "b3"]
        stored = h.rows("SELECT * FROM ai_citations ORDER BY ordinal")
        assert [c["marker"] for c in stored] == ["b2", "b1", "b3"]
        source_hash = load_fixture("resnet-cvpr-2col")["source_hash"]
        for wire, row_ in zip(citations, stored, strict=True):
            assert wire["citation_id"] == row_["citation_id"] == wire["anchor"]["id"]
            assert row_["block_id"] == handles[wire["marker"]]
            assert anchor_errors(wire["anchor"]) == []
            assert wire["anchor"]["targetKind"] == "citation"
            assert wire["anchor"]["doc"]["pdfSha256"] == source_hash
            assert wire["anchor"]["doc"]["textStreamId"] == f"api/{paper_id}/g1/0.1.0"
            assert wire["supported"] is False, "YOLO's text is not in resnet's blocks"
        usage = events(frames, "usage")[0]
        assert usage["run_id"] == run["run_id"] and usage["input_tokens"] == totals["input"]


def test_the_seed_is_spent_on_the_marked_text_and_stays_under_budget(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        explain(h, token, paper_id, paragraph_anchor())
        seed = h.fake.requests[0]["seed"]
    from papertree_retrieval import DEFAULT_TOKEN_ESTIMATOR

    spent = sum(DEFAULT_TOKEN_ESTIMATOR.estimate(p["text"]) for p in seed["passages"])
    assert 0 < spent <= 3000, spent
    assert len(seed["passages"]) >= 2, "context beyond the selection fits"
    labels = [p["label"] for p in seed["passages"]]
    assert all(label.startswith("p. ") for label in labels), labels


def _first_sentence(context: RunContext) -> str:
    text = context.texts[context.seen[0]]
    return text.split(". ")[0].rstrip(".")


def test_grounding_flags_the_fabrication_and_not_the_quote(tmp_path: Path) -> None:
    def answer(context: RunContext) -> str:
        quote, other = context.seen[0], context.seen[1]
        return (
            f"{_first_sentence(context)} [{quote}]. "
            f"The method reaches 99.9 percent accuracy on the Mars benchmark [{other}]."
        )

    with ai_harness(tmp_path, Script("explain-ok", final_text=answer)) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        by_marker = {c["marker"]: c["supported"] for c in events(frames, "citations")[0]["items"]}
        assert by_marker == {"b1": True, "b2": False}
        assert [bool(r["supported"]) for r in h.rows("SELECT supported FROM ai_citations")] == [
            True,
            False,
        ]
        # The verifier's reasons (which list the missing words) never reach the reader: not in
        # the stream's non-text events, not in the thread read back.
        thread_id = events(frames, "run")[0]["thread_id"]
        detail = h.client.get(f"/papers/{paper_id}/threads/{thread_id}", headers=auth(token))
        shown = json.dumps([f.data for f in frames if f.event != "text"]) + detail.text
        for reason_text in ("threshold", "content words", "Lexical overlap", "cited blocks"):
            assert reason_text not in shown


def test_a_marker_the_run_never_issued_is_dropped_and_logged(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    script = Script("explain-ok", final_text=lambda c: f"{_first_sentence(c)} [b1] and [b999].")
    with ai_harness(tmp_path, script) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        assert [c["marker"] for c in events(frames, "citations")[0]["items"]] == ["b1"]
        assert h.count("ai_citations") == 1
    logged = [
        json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")
    ]
    dropped = [e for e in logged if e["event"] == "run.citation_dropped"]
    assert (
        dropped and dropped[0]["marker"] == "b999" and dropped[0]["error_code"] == "unknown_marker"
    )


# ── follow-up: history, handles, busy ────────────────────────────────────────────────────────


def test_a_follow_up_resumes_the_thread_with_its_history_and_its_handles(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [Script("explain-ok"), Script("followup-ok")]) as h:
        token, paper_id = alice_with_paper(h)
        first, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        thread_id = events(first, "run")[0]["thread_id"]
        first_run = events(first, "run")[0]["run_id"]
        response = h.client.post(
            f"/papers/{paper_id}/threads/{thread_id}/messages",
            json={"question": "Why does that make it faster?"},
            headers=auth(token),
        )
        frames, _ = read_sse(response)
        _assert_browser_stream(frames)
        assert h.fake.contract_errors == []
        second = h.fake.requests[1]
        assert second["kind"] == "explain", "a follow-up runs under its thread's kind"
        assert second["history"] == {"session_id": thread_id, "entries": EXPLAIN_DONE["entries"]}
        assert second["question"] == "Why does that make it faster?"
        assert second["seed"]["passages"][0]["handle"] == "b1", "the seed is rebuilt"
        run = events(frames, "run")[0]
        before = {
            r["handle"]: r["block_id"]
            for r in h.rows("SELECT * FROM ai_run_handles WHERE run_id = ?", first_run)
        }
        after = {
            r["handle"]: r["block_id"]
            for r in h.rows("SELECT * FROM ai_run_handles WHERE run_id = ?", run["run_id"])
        }
        assert before.items() <= after.items(), "every earlier handle still names its block"
        messages = h.rows("SELECT ordinal, role, status FROM ai_messages ORDER BY ordinal")
        assert [(m["ordinal"], m["role"]) for m in messages] == [
            (0, "user"),
            (1, "assistant"),
            (2, "user"),
            (3, "assistant"),
        ]
        assert run["user_message_id"] is not None
        (thread,) = h.rows("SELECT agent_state_json FROM ai_threads")
        followup_done = (
            next(f for f in load_agent_fixture("followup-ok") if f.event == "done").data or {}
        )
        assert json.loads(thread["agent_state_json"]) == followup_done["entries"]


def test_a_follow_up_while_a_run_is_live_is_409_busy_before_any_row(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        first, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        thread_id = events(first, "run")[0]["thread_id"]
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        db = PaperTreeDb(h.settings.database_file)
        owner = db.owner_for(user_id)
        db.create_run(
            owner,
            run_id="run_01K63AE8M4Q2T7V9X3B5N6R0L1",
            paper_id=paper_id,  # type: ignore[arg-type]
            generation=1,
            kind="explain",
            thread_id=thread_id,
            message_id=None,
            token_sha256="0" * 64,
            datamark="^00000000",
            expires_at="2099-01-01T00:00:00Z",
            code_path="x",
            request_id=None,
            prompt_version=None,
        )
        db.close()
        before = (h.count("ai_messages"), h.count("ai_runs"))
        response = h.client.post(
            f"/papers/{paper_id}/threads/{thread_id}/messages",
            json={"question": "and?"},
            headers=auth(token),
        )
        assert_envelope(response, 409, "busy")
        assert (h.count("ai_messages"), h.count("ai_runs")) == before
        assert len(h.fake.requests) == 1


def test_a_retry_answers_the_same_user_turn(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [Script("auth-error"), Script("explain-ok")]) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        run = events(frames, "run")[0]
        response = h.client.post(
            f"/papers/{paper_id}/threads/{run['thread_id']}/messages",
            json={"question": "Explain this passage.", "retry_of": run["message_id"]},
            headers=auth(token),
        )
        retried, _ = read_sse(response)
        assert events(retried, "run")[0]["user_message_id"] == run["user_message_id"]
        roles = [m["role"] for m in h.rows("SELECT role FROM ai_messages ORDER BY ordinal")]
        assert roles == ["user", "assistant", "assistant"], "no second user turn"
        refused = h.client.post(
            f"/papers/{paper_id}/threads/{run['thread_id']}/messages",
            json={"question": "x", "retry_of": events(retried, "run")[0]["message_id"]},
            headers=auth(token),
        )
        assert assert_envelope(refused, 422, "validation_failed")["detail"].startswith("retry_of")


# ── cancel, a killed agent, a stall, errors, the one retry ───────────────────────────────────


def test_cancel_propagates_delete_and_keeps_the_partial_answer(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok", hold_after_text=3)) as h:
        token, paper_id = alice_with_paper(h)
        anchor = paragraph_anchor()
        box: dict[str, Any] = {}
        streamer = threading.Thread(
            target=lambda: box.update(r=explain(h, token, paper_id, anchor))
        )
        streamer.start()
        deadline = time.monotonic() + 20
        while not h.fake.requests and time.monotonic() < deadline:
            time.sleep(0.02)
        run_id = h.fake.requests[0]["run_id"]
        while "text" not in json.dumps(h.rows("SELECT content FROM ai_messages")) and (
            time.monotonic() < deadline
        ):
            time.sleep(0.02)
        time.sleep(0.2)
        cancelled = h.client.post(f"/runs/{run_id}/cancel", headers=auth(token))
        assert cancelled.status_code == 202
        streamer.join(20)
        assert not streamer.is_alive()
        frames, _ = read_sse(box["r"])
        done = events(frames, "done")[0]
        assert done["status"] == "aborted" and done["error"]["code"] == "aborted"
        assert h.fake.deletes == [run_id], "the cancel reached the agent as DELETE /v1/runs/{id}"
        (assistant,) = h.rows("SELECT * FROM ai_messages WHERE role = 'assistant'")
        streamed = "".join(t["delta"] for t in events(frames, "text"))
        assert assistant["status"] == "aborted" and assistant["content"] == streamed != ""
        (run,) = h.rows("SELECT status, error_code FROM ai_runs")
        assert (run["status"], run["error_code"]) == ("aborted", "aborted")
        # A second cancel of a finished run is a no-op 202.
        assert h.client.post(f"/runs/{run_id}/cancel", headers=auth(token)).status_code == 202
        assert h.fake.deletes == [run_id]


def test_an_agent_killed_mid_answer_keeps_the_partial_text(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok", drop_after_text=5)) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        _assert_browser_stream(frames)
        done = events(frames, "done")[0]
        assert done["status"] == "partial"
        assert done["error"] == {
            "code": "agent_unavailable",
            "retryable": True,
            "message": "The AI service stopped responding. Try again.",
        }
        streamed = "".join(t["delta"] for t in events(frames, "text"))
        (assistant,) = h.rows("SELECT * FROM ai_messages WHERE role = 'assistant'")
        assert (assistant["status"], assistant["error_code"]) == ("partial", "agent_unavailable")
        assert assistant["content"] == streamed and streamed
        (run,) = h.rows("SELECT status, error_code FROM ai_runs")
        assert run["status"] == "error"
        # The markers in what did arrive are still cited (the fifth delta carries `[b2]`).
        assert [c["marker"] for c in events(frames, "citations")[0]["items"]] == ["b2"]


def test_a_stalled_agent_times_out_and_is_cancelled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Read timeout = idle_ms + 5 s (contracts.md §3.4), shrunk here to 0.1 + 0.2 s."""
    monkeypatch.setattr(agent_client, "READ_GRACE_SECONDS", 0.2)
    fast = agent_client.LIMITS["explain"].model_copy(update={"idle_ms": 100})
    monkeypatch.setitem(agent_client.LIMITS, "explain", fast)
    with ai_harness(tmp_path, Script("explain-ok", stall_after_text=2, stall_seconds=30)) as h:
        token, paper_id = alice_with_paper(h)
        started = time.monotonic()
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        assert time.monotonic() - started < 15, "the stall did not wait for the fake"
        done = events(frames, "done")[0]
        assert done["status"] == "partial" and done["error"]["code"] == "timeout"
        assert h.fake.deletes == [h.fake.requests[0]["run_id"]]
        (assistant,) = h.rows("SELECT status FROM ai_messages WHERE role = 'assistant'")
        assert assistant["status"] == "partial"


def test_a_provider_auth_error_is_a_designed_failure_not_a_500(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("auth-error")) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        _assert_browser_stream(frames)
        assert events(frames, "done")[0]["error"] == {
            "code": "provider_auth",
            "retryable": False,
            "message": "The AI provider rejected this service's API key.",
        }
        assert events(frames, "citations")[0]["items"] == []
        (run,) = h.rows("SELECT status, error_code FROM ai_runs")
        assert (run["status"], run["error_code"]) == ("error", "provider_auth")
        (thread,) = h.rows("SELECT agent_state_json FROM ai_threads")
        assert thread["agent_state_json"] is None, "an error with no text resumes nothing"


def _upstream(fixture: str = "auth-error") -> Script:
    return Script(
        fixture,
        done_patch={
            "error": {"code": "upstream_unavailable", "retryable": True, "message": "503"},
        },
    )


def test_upstream_unavailable_before_any_text_is_retried_exactly_once(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [_upstream(), Script("explain-ok")]) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        assert [r["run_id"] for r in h.fake.requests] == [h.fake.requests[0]["run_id"]] * 2
        retrying = [s for s in events(frames, "status") if s["phase"] == "retrying"]
        assert retrying == [
            {
                "phase": "retrying",
                "label": "The model service is busy; trying again",
                "attempt": 1,
                "delay_ms": 1000,
            }
        ]
        assert events(frames, "done")[0]["status"] == "complete"
        (run,) = h.rows("SELECT status, retries FROM ai_runs")
        assert (run["status"], run["retries"]) == ("done", 1)
    with ai_harness(tmp_path / "twice", [_upstream(), _upstream()]) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        assert len(h.fake.requests) == 2, "exactly ONE retry"
        assert events(frames, "done")[0]["error"]["code"] == "upstream_unavailable"


def test_no_retry_once_text_has_reached_the_browser(tmp_path: Path) -> None:
    late = Script(
        "explain-ok",
        done_patch={
            "status": "error",
            "error": {"code": "upstream_unavailable", "retryable": True, "message": "503"},
        },
    )
    with ai_harness(tmp_path, [late, Script("explain-ok")]) as h:
        token, paper_id = alice_with_paper(h)
        frames, _ = read_sse(explain(h, token, paper_id, paragraph_anchor()))
        assert len(h.fake.requests) == 1
        assert events(frames, "done")[0]["status"] == "error"


def test_content_is_written_at_most_every_500_ms_while_streaming(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    writes: list[tuple[float, bool]] = []
    original = PaperTreeDb.update_message

    def spy(self: PaperTreeDb, owner: Any, message_id: str, **fields: Any) -> None:
        if fields.get("content") is not None:
            writes.append((time.monotonic(), fields.get("status") is not None))
        original(self, owner, message_id, **fields)

    monkeypatch.setattr(PaperTreeDb, "update_message", spy)
    with ai_harness(tmp_path, Script("explain-ok", text_delay=0.1)) as h:
        token, paper_id = alice_with_paper(h)
        read_sse(explain(h, token, paper_id, paragraph_anchor()))
    streaming = [at for at, final in writes if not final]
    finals = [at for at, final in writes if final]
    assert len(finals) == 1, "once more on done"
    assert len(streaming) >= 2, f"content is written WHILE streaming, not only at the end: {writes}"
    gaps = [b - a for a, b in zip(streaming, streaming[1:], strict=False)]
    assert all(gap >= 0.5 for gap in gaps), gaps


# ── pre-stream refusals: JSON, before any SSE byte, nothing left behind ──────────────────────


def test_without_an_agent_secret_it_is_503_not_configured_and_writes_nothing(
    tmp_path: Path,
) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")
        response = h.client.post(
            f"/papers/{paper_id}/threads",
            json={"kind": "explain", "anchor": paragraph_anchor()},
            headers=auth(token),
        )
        assert_envelope(response, 503, "not_configured")
    for table in ("ai_threads", "ai_messages", "ai_runs"):
        assert _count(h.settings, table) == 0, table


def test_an_unreachable_agent_is_503_agent_unavailable_and_the_thread_is_removed(
    tmp_path: Path,
) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    settings = Settings(root=tmp_path / "data", agent_secret=SECRET, agent_url="http://agent.test")
    app = create_app(settings, agent_transport=httpx.MockTransport(refuse))
    with TestClient(app) as client:
        token = register(client, "alice@example.com")
        paper_id = seed_paper(settings, client, token, "resnet-cvpr-2col")
        response = client.post(
            f"/papers/{paper_id}/threads",
            json={"kind": "explain", "anchor": paragraph_anchor()},
            headers=auth(token),
        )
        body = assert_envelope(response, 503, "agent_unavailable")
        assert body["retryable"] is True
    assert _count(settings, "ai_threads") == 0 and _count(settings, "ai_messages") == 0
    conn = sqlite3.connect(settings.database_file)
    run = dict(
        zip(
            ("status", "error_code"),
            conn.execute("SELECT status, error_code FROM ai_runs").fetchone(),
            strict=True,
        )
    )
    conn.close()
    assert (run["status"], run["error_code"]) == ("error", "agent_unavailable")


def test_an_agent_that_refuses_the_run_as_busy_is_409(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok", status=409)) as h:
        token, paper_id = alice_with_paper(h)
        assert_envelope(explain(h, token, paper_id, paragraph_anchor()), 409, "busy")
        assert h.count("ai_threads") == 0


def test_a_paper_with_no_promoted_generation_is_409_not_parsed(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token = register(h.client, "alice@example.com")
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        document = load_fixture("resnet-cvpr-2col")
        db = PaperTreeDb(h.settings.database_file)
        db.put_paper(db.owner_for(user_id), document)  # stored, never promoted
        db.close()
        response = explain(h, token, document["paper_id"], paragraph_anchor())
        assert_envelope(response, 409, "not_parsed")
        assert h.fake.requests == [] and h.count("ai_runs") == 0


def test_an_anchor_on_another_paper_or_other_bytes_is_422_anchor_mismatch(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        other = paragraph_anchor()
        other["doc"] = {**other["doc"], "paperId": "ppr_0000000000000000000000STUB"}
        assert_envelope(explain(h, token, paper_id, other), 422, "anchor_mismatch")
        bytes_ = paragraph_anchor()
        bytes_["doc"] = {**bytes_["doc"], "pdfSha256": "sha256:" + "0" * 64}
        assert_envelope(explain(h, token, paper_id, bytes_), 422, "anchor_mismatch")
        assert h.count("ai_threads") == 0 and h.fake.requests == []


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"kind": "explain"}, "anchor"),
        ({"kind": "ask", "anchor": None}, "anchor"),
        ({"kind": "ask", "question": ""}, "question"),
        ({"kind": "summary"}, "kind"),
    ],
)
def test_a_bad_thread_body_is_422_naming_the_field(
    tmp_path: Path, body: dict[str, Any], field: str
) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        response = h.client.post(f"/papers/{paper_id}/threads", json=body, headers=auth(token))
        assert assert_envelope(response, 422, "validation_failed")["detail"].startswith(field)


def test_a_follow_up_retry_of_null_is_refused(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        run = events(read_sse(explain(h, token, paper_id, paragraph_anchor()))[0], "run")[0]
        response = h.client.post(
            f"/papers/{paper_id}/threads/{run['thread_id']}/messages",
            json={"question": "q", "retry_of": None},
            headers=auth(token),
        )
        assert assert_envelope(response, 422, "validation_failed")["detail"].startswith("retry_of")


def test_the_daily_budget_is_429_budget_exhausted_before_any_row(tmp_path: Path) -> None:
    # explain-ok costs $0.001553; a budget of $0.001 is spent by one run.
    with ai_harness(tmp_path, Script("explain-ok"), budget_usd=0.001) as h:
        token, paper_id = alice_with_paper(h)
        read_sse(explain(h, token, paper_id, paragraph_anchor()))
        before = (h.count("ai_threads"), h.count("ai_runs"), len(h.fake.requests))
        body = assert_envelope(
            explain(h, token, paper_id, paragraph_anchor()), 429, "budget_exhausted"
        )
        assert "($0.001)" in body["detail"], body["detail"]
        assert (h.count("ai_threads"), h.count("ai_runs"), len(h.fake.requests)) == before
        # Another user has their own budget.
        bob = register(h.client, "bob@example.com")
        bob_paper = seed_paper(h.settings, h.client, bob, "attention-is-all-you-need")
        anchor = paragraph_anchor("attention-is-all-you-need")
        assert explain(h, bob, bob_paper, anchor).status_code == 200


# ── reads, and isolation ─────────────────────────────────────────────────────────────────────


def test_threads_read_back_in_the_contract_shape(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [Script("explain-ok"), Script("explain-ok", drop_after_text=2)]) as h:
        token, paper_id = alice_with_paper(h)
        run = events(read_sse(explain(h, token, paper_id, paragraph_anchor()))[0], "run")[0]
        h.client.post(
            f"/papers/{paper_id}/threads/{run['thread_id']}/messages",
            json={"question": "and then?"},
            headers=auth(token),
        )
        listed = h.client.get(f"/papers/{paper_id}/threads", headers=auth(token))
        assert listed.status_code == 200
        (thread,) = listed.json()
        assert contract_errors(thread, "api/threads.schema.json", "Thread", Thread) == []
        assert thread["message_count"] == 4 and thread["origin_anchor"]["targetKind"] == "text"
        detail = h.client.get(
            f"/papers/{paper_id}/threads/{run['thread_id']}", headers=auth(token)
        ).json()
        assert (
            contract_errors(detail, "api/threads.schema.json", "ThreadDetail", ThreadDetail) == []
        )
        messages = detail["messages"]
        for message in messages:
            assert contract_errors(message, "api/threads.schema.json", "Message", Message) == []
        assert [m["status"] for m in messages] == ["complete", "complete", "complete", "partial"]
        assert messages[1]["run"]["model"] == "MiniMax-M3" and len(messages[1]["citations"]) == 3
        assert messages[3]["error"]["code"] == "agent_unavailable"
        assert messages[0]["run"] is None and messages[0]["citations"] == []
        assert "owner_id" not in listed.text + json.dumps(detail)


def test_bob_cannot_read_follow_up_or_cancel_alices_threads(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        alice, paper_id = alice_with_paper(h)
        run = events(read_sse(explain(h, alice, paper_id, paragraph_anchor()))[0], "run")[0]
        bob = register(h.client, "bob@example.com")
        base = f"/papers/{paper_id}/threads"
        assert_envelope(h.client.get(base, headers=auth(bob)), 404, "not_found")
        assert_envelope(
            h.client.get(f"{base}/{run['thread_id']}", headers=auth(bob)), 404, "not_found"
        )
        assert_envelope(
            h.client.post(
                f"{base}/{run['thread_id']}/messages", json={"question": "q"}, headers=auth(bob)
            ),
            404,
            "not_found",
        )
        assert_envelope(
            h.client.post(f"/runs/{run['run_id']}/cancel", headers=auth(bob)), 404, "not_found"
        )
        # Non-vacuous: the same requests as alice succeed.
        assert h.client.get(f"{base}/{run['thread_id']}", headers=auth(alice)).status_code == 200
        assert (
            h.client.post(f"/runs/{run['run_id']}/cancel", headers=auth(alice)).status_code == 202
        )
        # Bob with a paper of his own still sees nothing of alice's there.
        bobs = seed_paper(h.settings, h.client, bob, "attention-is-all-you-need")
        assert h.client.get(f"/papers/{bobs}/threads", headers=auth(bob)).json() == []


def test_an_ask_without_an_anchor_has_no_seed(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        response = h.client.post(
            f"/papers/{paper_id}/threads",
            json={"kind": "ask", "question": "What is a residual block?"},
            headers=auth(token),
        )
        frames, _ = read_sse(response)
        request = h.fake.requests[0]
        assert request["kind"] == "ask" and request["seed"] is None
        assert request["prompt_version"] == "ask-v1" and request["limits"]["deadline_ms"] == 60000
        (row,) = h.rows("SELECT code_path, kind FROM ai_runs")
        assert row["code_path"].startswith("api.threads.ask>") and row["kind"] == "ask"
        (thread,) = h.rows("SELECT kind, title, origin_anchor_json FROM ai_threads")
        assert thread == {
            "kind": "ask",
            "title": "What is a residual block?",
            "origin_anchor_json": None,
        }
        assert events(frames, "done")[0]["status"] == "complete"


def test_the_seed_finds_a_pdfjs_capture_by_its_quads(tmp_path: Path) -> None:
    """A capture on the pdf.js path carries no BlockSelector; its ShapeSelector quads (PDF space)
    still find the block on the stored parse (`evidence.selected_block_ids`, rung 2)."""
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        anchor = paragraph_anchor()
        selected = block_of(anchor)
        anchor["selectors"] = [
            s
            for s in anchor["selectors"]
            if s["type"] not in ("BlockSelector", "TextPositionSelector")
        ]
        anchor["doc"] = {**anchor["doc"], "textStreamId": "pdfjs@5.7.284/page-text"}
        read_sse(explain(h, token, paper_id, anchor))
        (b1,) = h.rows("SELECT block_id FROM ai_run_handles WHERE handle = 'b1'")
        assert b1["block_id"] == selected


def test_the_generation_used_is_recorded_on_every_row(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        read_sse(explain(h, token, paper_id, paragraph_anchor()))
        assert {r["generation"] for r in h.rows("SELECT generation FROM ai_messages")} == {1}
        assert {r["generation"] for r in h.rows("SELECT generation FROM ai_citations")} == {1}
        assert {r["generation"] for r in h.rows("SELECT generation FROM ai_run_handles")} == {1}


def _count(settings: Settings, table: str) -> int:
    conn = sqlite3.connect(settings.database_file)
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    finally:
        conn.close()


def test_an_answer_whose_run_can_no_longer_finish_reads_back_as_ended(tmp_path: Path) -> None:
    """The API process died mid-answer: the row says `streaming`, its run token has expired, and
    no `done` will ever come. It reads back as `partial` (it has text) with `agent_unavailable`,
    so a reader is not left waiting; a LIVE run's message still reads `streaming`."""
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        run = events(read_sse(explain(h, token, paper_id, paragraph_anchor()))[0], "run")[0]
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        db = PaperTreeDb(h.settings.database_file)
        owner = db.owner_for(user_id)
        for run_id, expires, message_id in (
            (
                "run_01K63AE8M4Q2T7V9X3B5N6R0X1",
                "2026-01-01T00:00:00Z",
                "msg_01K63AE8M4Q2T7V9X3B5N6R0X1",
            ),
            (
                "run_01K63AE8M4Q2T7V9X3B5N6R0X2",
                "2099-01-01T00:00:00Z",
                "msg_01K63AE8M4Q2T7V9X3B5N6R0X2",
            ),
        ):
            db.create_run(
                owner,
                run_id=run_id,
                paper_id=paper_id,  # type: ignore[arg-type]
                generation=1,
                kind="explain",
                thread_id=run["thread_id"],
                message_id=message_id,
                token_sha256="0" * 64,
                datamark="^00000000",
                expires_at=expires,
                code_path="x",
                request_id=None,
                prompt_version=None,
            )
            db.append_message(
                owner,
                run["thread_id"],
                message_id=message_id,
                role="assistant",
                generation=1,
                content="half an answer",
                status="streaming",
                run_id=run_id,
            )
        db.close()
        detail = h.client.get(f"/papers/{paper_id}/threads/{run['thread_id']}", headers=auth(token))
        stale, live = detail.json()["messages"][-2:]
        assert (stale["status"], stale["error"]["code"]) == ("partial", "agent_unavailable")
        assert (live["status"], live["error"]) == ("streaming", None)
        assert contract_errors(stale, "api/threads.schema.json", "Message", Message) == []
