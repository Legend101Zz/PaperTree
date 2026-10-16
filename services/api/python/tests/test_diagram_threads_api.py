"""Diagram threads (v0.2 S7a, #216): the thread, its plate read back, Redraw, and every pre-stream
refusal an explain has, on the real Attention parse (``packages/document-ir/fixtures``).

The plate's parts are written here through the DB layer, as the broker stores them while a run
streams, so this file holds the READ path and the thread rules on their own; the streaming of
parts is held separately, against the agent's recorded diagram stream.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

import httpx
import pytest
from ai_support import (
    AiHarness,
    ai_harness,
    block_of,
    contract_errors,
    events,
    paragraph_anchor,
    read_sse,
)
from api_support import assert_envelope, auth, load_fixture, register, seed_paper
from fake_agent import Script
from papertree_anchoring import capture_citation
from papertree_api import agent_client
from papertree_api.evidence import DocumentCache
from papertree_api.schemas import ThreadDetail
from papertree_db import PaperTreeDb
from papertree_db.ai import DiagramPartIn

ATTENTION = "attention-is-all-you-need"
#: §3.2.1's first paragraph, p. 4: the frames' own example (07a-07c).
NEEDLE = "We call our particular attention"
REDRAW = "Redraw the diagram."


def _alice(h: AiHarness, email: str = "alice@example.com") -> tuple[str, str]:
    token = register(h.client, email)
    return token, seed_paper(h.settings, h.client, token, ATTENTION)


def _anchor() -> dict[str, Any]:
    return paragraph_anchor(ATTENTION, needle=NEEDLE)


def _diagram(
    h: AiHarness, token: str, paper_id: str, anchor: dict[str, Any] | None = None, **extra: Any
) -> httpx.Response:
    body: dict[str, Any] = {"kind": "diagram", "anchor": anchor or _anchor(), **extra}
    response: httpx.Response = h.client.post(
        f"/papers/{paper_id}/threads",
        json=body,
        headers={**auth(token), "Accept": "text/event-stream"},
    )
    return response


def _redraw(h: AiHarness, token: str, paper_id: str, thread_id: str, **body: Any) -> httpx.Response:
    response: httpx.Response = h.client.post(
        f"/papers/{paper_id}/threads/{thread_id}/messages",
        json={"question": REDRAW, **body},
        headers={**auth(token), "Accept": "text/event-stream"},
    )
    return response


def _detail(h: AiHarness, token: str, paper_id: str, thread_id: str) -> dict[str, Any]:
    response = h.client.get(f"/papers/{paper_id}/threads/{thread_id}", headers=auth(token))
    assert response.status_code == 200, response.text
    detail: dict[str, Any] = response.json()
    assert contract_errors(detail, "api/threads.schema.json", "ThreadDetail", ThreadDetail) == []
    return detail


def _db_for(h: AiHarness, token: str) -> tuple[PaperTreeDb, Any, str]:
    user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
    db = PaperTreeDb(h.settings.database_file)
    return db, db.owner_for(user_id), user_id


# ── the thread ───────────────────────────────────────────────────────────────────────────────


def test_a_diagram_thread_starts_like_an_explain_with_its_own_question(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("diagram-ok")) as h:
        token, paper_id = _alice(h)
        frames, _ = read_sse(_diagram(h, token, paper_id))
        run = events(frames, "run")[0]
        (request,) = h.fake.requests
        assert h.fake.contract_errors == []
        assert (request["kind"], request["prompt_version"]) == ("diagram", "diagram-v1")
        assert request["question"] == "Explain with a diagram."
        assert request["limits"] == agent_client.LIMITS["diagram"].model_dump()
        assert request["history"] is None and request["seed"]["passages"], "the selection"
        assert NEEDLE in request["seed"]["quote"]
        (thread,) = h.rows("SELECT kind FROM ai_threads")
        (stored,) = h.rows("SELECT kind, prompt_version, code_path, status FROM ai_runs")
        assert thread["kind"] == stored["kind"] == "diagram"
        assert stored["code_path"] == agent_client.CODE_PATHS["diagram"]
        detail = _detail(h, token, paper_id, run["thread_id"])
        assert detail["thread"]["kind"] == "diagram"
        asked, answer = detail["messages"]
        assert asked["content"] == "Explain with a diagram." and "diagram" not in asked
        assert "coverage" not in answer, "a plate has no prose paragraphs to count"
        assert answer["diagram"]["status"] == "complete" and len(answer["diagram"]["parts"]) == 6
        usage = h.client.get("/usage", headers=auth(token)).json()
        assert usage["by_kind"]["diagram"]["runs"] == 1 and usage["by_kind"]["explain"]["runs"] == 0


def test_the_plate_reads_back_cited_not_verified_and_inferred_parts(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = _alice(h)
        anchor = _anchor()
        run = events(read_sse(_diagram(h, token, paper_id, anchor))[0], "run")[0]
        db, owner, user_id = _db_for(h, token)
        # The replayed prose drew no part (an error); the parts below are written by hand, as the
        # broker writes them, and the answer is marked complete so only the read path is tested.
        db.update_message(owner, run["message_id"], status="complete")
        try:
            document = DocumentCache().get(db, owner, user_id, paper_id, 1)
            assert document is not None
            block = block_of(anchor)
            cited = dict(
                capture_citation(document, block, citation_id="cit_" + "A" * 26, at="2026-10-16")
            )
            common: dict[str, Any] = {"generation": 1, "text": "", "edge": []}
            for part in (
                DiagramPartIn(
                    part_id="dp_1",
                    ordinal=0,
                    label="Q, K, V",
                    kind="input",
                    after=[],
                    quote="queries and keys of dimension dk",
                    anchor=cited,
                    supported=True,
                    block_id=block,
                    page_index=3,
                    **common,
                ),
                DiagramPartIn(
                    part_id="dp_2",
                    ordinal=1,
                    label="Learned",
                    kind="step",
                    after=[],
                    quote="weights are learned by gradient descent",
                    anchor=None,
                    supported=False,
                    block_id=None,
                    page_index=None,
                    **common,
                ),
                DiagramPartIn(
                    part_id="dp_3",
                    ordinal=2,
                    label="Weights sum to 1",
                    kind="concept",
                    after=["A", "B"],
                    quote=None,
                    anchor=None,
                    supported=None,
                    block_id=None,
                    page_index=None,
                    **{**common, "edge": ["scores", None]},
                ),
            ):
                db.put_diagram_part(owner, run["message_id"], part)
            link = {"source": "C", "target": "A", "label": "feeds back"}
            db.set_message_diagram(owner, run["message_id"], {"title": "Plate", "links": [link]})
        finally:
            db.close()
        detail = _detail(h, token, paper_id, run["thread_id"])
        plate = detail["messages"][1]["diagram"]
        assert (plate["title"], plate["status"], plate["links"]) == ("Plate", "complete", [link])
        a, b, c = plate["parts"]
        assert [a["letter"], b["letter"], c["letter"]] == ["A", "B", "C"]
        assert a["cite"]["anchor"] == cited and a["cite"]["citation_id"] == cited["id"]
        assert a["cite"]["supported"] is True and a["cite"]["page_index"] == 3
        assert a["cite"]["locator"]["passage_key"] == f"g1:{block}"
        assert a["cite"]["locator"]["section_heading"] == "Scaled Dot-Product Attention"
        assert b["cite"] == {
            "citation_id": None,
            "quote": "weights are learned by gradient descent",
            "anchor": None,
            "locator": None,
            "page_index": None,
            "supported": False,
        }
        assert c["cite"] is None and (c["after"], c["edge"]) == (["A", "B"], ["scores", None])


def test_a_stopped_plate_reads_as_stopped(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = _alice(h)
        run = events(read_sse(_diagram(h, token, paper_id))[0], "run")[0]
        db, owner, _ = _db_for(h, token)
        db.update_message(owner, run["message_id"], status="aborted", error_code="aborted")
        db.close()
        answer = _detail(h, token, paper_id, run["thread_id"])["messages"][1]
        assert answer["diagram"]["status"] == "stopped" and answer["error"]["code"] == "aborted"


def test_an_ended_plate_with_raw_lines_but_no_part_reads_as_an_error(tmp_path: Path) -> None:
    """The orphan sweep ends a message with text as ``partial``; a plate with no part is still an
    error, never an empty plate (review N10)."""
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = _alice(h)
        run = events(read_sse(_diagram(h, token, paper_id))[0], "run")[0]
        db, owner, _ = _db_for(h, token)
        db.update_message(owner, run["message_id"], status="partial", content='{"t":"plate"')
        db.close()
        answer = _detail(h, token, paper_id, run["thread_id"])["messages"][1]
        assert answer["status"] == "partial" and answer["diagram"]["status"] == "error"


# ── Redraw ───────────────────────────────────────────────────────────────────────────────────


def test_a_redraw_appends_a_new_turn_and_plate_to_the_same_thread(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [Script("explain-ok"), Script("followup-ok")]) as h:
        token, paper_id = _alice(h)
        first = events(read_sse(_diagram(h, token, paper_id))[0], "run")[0]
        frames, _ = read_sse(
            _redraw(h, token, paper_id, first["thread_id"], redraw_of=first["message_id"])
        )
        second = events(frames, "run")[0]
        assert second["thread_id"] == first["thread_id"]
        assert second["message_id"] != first["message_id"]
        assert second["user_message_id"] != first["user_message_id"], "a new turn, not a retry"
        redraw = h.fake.requests[1]
        assert (redraw["kind"], redraw["question"]) == ("diagram", REDRAW)
        assert redraw["history"]["session_id"] == first["thread_id"]
        assert redraw["seed"]["passages"], "the plate is redrawn from the same selection"
        assert h.fake.contract_errors == []
        detail = _detail(h, token, paper_id, first["thread_id"])
        roles = [(m["role"], "diagram" in m) for m in detail["messages"]]
        assert roles == [("user", False), ("assistant", True)] * 2


@pytest.mark.parametrize("case", ["missing", "retry", "null", "a user turn", "another thread"])
def test_a_redraw_must_name_a_finished_diagram_answer_of_this_thread(
    tmp_path: Path, case: str
) -> None:
    with ai_harness(tmp_path, [Script("explain-ok"), Script("explain-ok")]) as h:
        token, paper_id = _alice(h)
        run = events(read_sse(_diagram(h, token, paper_id))[0], "run")[0]
        other = events(read_sse(_diagram(h, token, paper_id))[0], "run")[0]
        body: dict[str, Any] = {
            "missing": {},
            "retry": {"retry_of": run["message_id"]},
            "null": {"redraw_of": None},
            "a user turn": {"redraw_of": run["user_message_id"]},
            "another thread": {"redraw_of": other["message_id"]},
        }[case]
        before = (h.count("ai_messages"), h.count("ai_runs"), len(h.fake.requests))
        refused = _redraw(h, token, paper_id, run["thread_id"], **body)
        assert assert_envelope(refused, 422, "validation_failed")["detail"].startswith("redraw_of")
        assert (h.count("ai_messages"), h.count("ai_runs"), len(h.fake.requests)) == before


def test_only_a_diagram_thread_takes_a_redraw(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [Script("explain-ok"), Script("explain-ok")]) as h:
        token, paper_id = _alice(h)
        plate = events(read_sse(_diagram(h, token, paper_id))[0], "run")[0]
        response = h.client.post(
            f"/papers/{paper_id}/threads",
            json={"kind": "explain", "anchor": _anchor()},
            headers=auth(token),
        )
        explained = events(read_sse(response)[0], "run")[0]
        for redraw_of in (explained["message_id"], plate["message_id"]):
            refused = _redraw(h, token, paper_id, explained["thread_id"], redraw_of=redraw_of)
            detail = assert_envelope(refused, 422, "validation_failed")["detail"]
            assert detail == "redraw_of: only a diagram answer is redrawn"


# ── every pre-stream refusal, before any row and before the agent ────────────────────────────


def test_a_diagram_needs_an_anchor_on_this_paper(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = _alice(h)
        missing = h.client.post(
            f"/papers/{paper_id}/threads", json={"kind": "diagram"}, headers=auth(token)
        )
        detail = assert_envelope(missing, 422, "validation_failed")["detail"]
        assert detail.startswith("anchor") and "a diagram thread" in detail
        other = _anchor()
        other["doc"] = {**other["doc"], "paperId": "ppr_0000000000000000000000STUB"}
        assert_envelope(_diagram(h, token, paper_id, other), 422, "anchor_mismatch")
        assert h.count("ai_threads") == 0 and h.fake.requests == []


def test_a_diagram_on_a_paper_not_parsed_or_not_yours_is_refused(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token = register(h.client, "alice@example.com")
        document = load_fixture(ATTENTION)
        db, owner, _ = _db_for(h, token)
        db.put_paper(owner, document)  # stored, never promoted
        db.close()
        assert_envelope(_diagram(h, token, document["paper_id"]), 409, "not_parsed")
        bob = register(h.client, "bob@example.com")
        assert_envelope(_diagram(h, bob, document["paper_id"]), 404, "not_found")
        assert h.count("ai_runs") == 0 and h.fake.requests == []


def test_the_daily_budget_refuses_a_diagram_before_any_row(tmp_path: Path) -> None:
    # explain-ok costs $0.001553; a budget of $0.001 is spent by one run.
    with ai_harness(tmp_path, Script("explain-ok"), budget_usd=0.001) as h:
        token, paper_id = _alice(h)
        run = events(read_sse(_diagram(h, token, paper_id))[0], "run")[0]
        before = (h.count("ai_threads"), h.count("ai_messages"), len(h.fake.requests))
        assert_envelope(_diagram(h, token, paper_id), 429, "budget_exhausted")
        redraw = _redraw(h, token, paper_id, run["thread_id"], redraw_of=run["message_id"])
        assert_envelope(redraw, 429, "budget_exhausted")
        assert (h.count("ai_threads"), h.count("ai_messages"), len(h.fake.requests)) == before


def test_a_redraw_of_the_plate_still_drawing_is_409_busy(tmp_path: Path) -> None:
    """B7: a run on a busy thread is 409 ``busy``, the drawing plate itself included."""
    with ai_harness(tmp_path, Script("explain-ok", hold_after_text=2)) as h:
        token, paper_id = _alice(h)
        box: dict[str, Any] = {}
        streamer = threading.Thread(target=lambda: box.update(r=_diagram(h, token, paper_id)))
        streamer.start()
        deadline = time.monotonic() + 20
        drawing: list[dict[str, Any]] = []
        while not drawing and time.monotonic() < deadline:
            drawing = h.rows(
                "SELECT message_id, thread_id FROM ai_messages "
                "WHERE role = 'assistant' AND status = 'streaming' AND content <> ''"
            )
            time.sleep(0.02)
        (plate,) = drawing
        before = h.count("ai_messages")
        redraw = _redraw(h, token, paper_id, plate["thread_id"], redraw_of=plate["message_id"])
        assert_envelope(redraw, 409, "busy")
        assert h.count("ai_messages") == before and len(h.fake.requests) == 1
        run_id = h.fake.requests[0]["run_id"]
        assert h.client.post(f"/runs/{run_id}/cancel", headers=auth(token)).status_code == 202
        streamer.join(20)
        assert not streamer.is_alive()
        assert events(read_sse(box["r"])[0], "done")[0]["status"] == "aborted"


def test_bob_cannot_read_or_redraw_alices_plate(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = _alice(h)
        run = events(read_sse(_diagram(h, token, paper_id))[0], "run")[0]
        bob = register(h.client, "bob@example.com")
        url = f"/papers/{paper_id}/threads/{run['thread_id']}"
        assert_envelope(h.client.get(url, headers=auth(bob)), 404, "not_found")
        redraw = _redraw(h, bob, paper_id, run["thread_id"], redraw_of=run["message_id"])
        assert_envelope(redraw, 404, "not_found")
        assert len(h.fake.requests) == 1
