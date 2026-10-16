"""A diagram run's stream (v0.2 S7a, #216): the agent's recorded `diagram-ok` stream (the parts of
§3.2.1 of "Attention Is All You Need", p. 4) replayed by the FakeAgent through the real API, on the
real Attention parse.

Everything asserted is what only the API could have produced: the Anchor each quote resolved to
(over the block of the STORED parse that holds it), whether the quote was verbatim, the rows it
wrote as the parts arrived, the plate read back. The corpus-gated test does the same on a fresh
parse of the corpus PDF.
"""

from __future__ import annotations

import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from ai_support import (
    SECRET,
    AiHarness,
    ai_harness,
    anchor_errors,
    contract_errors,
    events,
    paragraph_anchor,
    read_sse,
)
from api_support import auth, register, seed_paper
from fake_agent import FakeAgent, Script
from fake_agent import load_fixture as load_agent_fixture
from fastapi.testclient import TestClient
from papertree_anchoring import normalise_for_match
from papertree_api import create_app
from papertree_api.evidence import DocumentCache
from papertree_api.schemas import BROWSER_EVENTS, ThreadDetail
from papertree_api.settings import Settings
from papertree_api.worker import run as run_worker
from papertree_db import PaperTreeDb

ATTENTION = "attention-is-all-you-need"
NEEDLE = "We call our particular attention"
SSE_DEFS = {
    "run": "SseRun",
    "status": "SseStatus",
    "plate": "SsePlate",
    "part": "DiagramPart",
    "link": "DiagramLink",
    "usage": "RunSummary",
    "done": "SseDone",
}
RECORDED = [f for f in load_agent_fixture("diagram-ok") if f.event is not None]
#: The model's quotes, by letter, as the recording has them.
QUOTES = {
    f.data["letter"]: (f.data["cite"] or {}).get("quote")
    for f in RECORDED
    if f.event == "part" and f.data
}
NOWHERE = "the attention weights are learned end to end by gradient descent"
NEAR = "We compute the dot product of each query with all of the keys"
CORPUS_PDF = Path(__file__).resolve().parents[4] / "research/benchmarks/corpus" / f"{ATTENTION}.pdf"


def _alice(h: AiHarness) -> tuple[str, str]:
    token = register(h.client, "alice@example.com")
    return token, seed_paper(h.settings, h.client, token, ATTENTION)


def _draw(h: AiHarness, token: str, paper_id: str, anchor: dict[str, Any] | None = None) -> Any:
    return h.client.post(
        f"/papers/{paper_id}/threads",
        json={"kind": "diagram", "anchor": anchor or paragraph_anchor(ATTENTION, needle=NEEDLE)},
        headers={**auth(token), "Accept": "text/event-stream"},
    )


def _assert_browser_stream(frames: list[Any]) -> None:
    """§2.6 for a plate: `run` first, `usage` then `done` last, no raw `text`, no `citations`
    (a plate's evidence is its parts' Anchors), every `data` the contract's."""
    names = [f.event for f in frames]
    assert names[0] == "run" and names[-2:] == ["usage", "done"], names
    assert "text" not in names and "citations" not in names, names
    for frame in frames:
        assert not contract_errors(
            frame.data, "api/sse.schema.json", SSE_DEFS[frame.event], BROWSER_EVENTS[frame.event]
        ), frame


def _passages(h: AiHarness, token: str, paper_id: str) -> dict[str, str]:
    """``block_id -> text`` of the stored parse, as an Anchor's quote selector reads it."""
    user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
    db = PaperTreeDb(h.settings.database_file)
    try:
        document = DocumentCache().get(db, db.owner_for(user_id), user_id, paper_id, 1)
        assert document is not None
        return {block_id: indexed.text for block_id, indexed in document.by_id.items()}
    finally:
        db.close()


def _quote_selector(anchor: dict[str, Any]) -> str:
    return str(next(s for s in anchor["selectors"] if s["type"] == "TextQuoteSelector")["exact"])


def _block(anchor: dict[str, Any]) -> str:
    return str(next(s for s in anchor["selectors"] if s["type"] == "BlockSelector")["blockId"])


def test_a_plate_streams_parts_whose_quotes_resolve_to_anchors_on_the_real_parse(
    tmp_path: Path,
) -> None:
    with ai_harness(tmp_path, Script("diagram-ok")) as h:
        token, paper_id = _alice(h)
        frames, _ = read_sse(_draw(h, token, paper_id))
        _assert_browser_stream(frames)
        assert h.fake.contract_errors == []
        assert events(frames, "plate") == [{"title": "Scaled dot-product attention"}]
        parts = events(frames, "part")
        assert [p["letter"] for p in parts] == list("ABCDEF")
        assert all(a < p["letter"] for p in parts for a in p["after"])
        assert events(frames, "done")[0]["status"] == "complete"
        passages = _passages(h, token, paper_id)
        for part in parts[:5]:
            cite = part["cite"]
            assert cite["supported"] is True, part
            assert cite["quote"] == QUOTES[part["letter"]]
            assert anchor_errors(cite["anchor"]) == [], part["letter"]
            assert cite["citation_id"] == cite["anchor"]["id"]
            # What focusAnchor flashes is the whole passage the quote is in, word for word.
            block = _block(cite["anchor"])
            assert _quote_selector(cite["anchor"]) == passages[block]
            assert (
                normalise_for_match(cite["quote"]).text in normalise_for_match(passages[block]).text
            )
            assert cite["locator"]["passage_key"] == f"g1:{block}"
            assert cite["page_index"] == cite["locator"]["page_index"] == 3  # p. 4
        assert parts[5]["cite"] is None, "F is inferred: no passage, no Anchor"

        rows = h.rows("SELECT * FROM ai_diagram_parts ORDER BY ordinal")
        assert [r["letter"] for r in rows] == list("ABCDEF")
        inferred = rows[5]
        assert (inferred["cite_quote"], inferred["anchor_json"], inferred["supported"]) == (
            None,
            None,
            None,
        )
        (message,) = h.rows(
            "SELECT content, status, diagram_json FROM ai_messages WHERE role = 'assistant'"
        )
        recorded = next(f for f in RECORDED if f.event == "done").data or {}
        assert message["content"] == recorded["final_text"], "the raw lines are kept"
        assert h.count("ai_citations") == 0

        thread_id = events(frames, "run")[0]["thread_id"]
        response = h.client.get(f"/papers/{paper_id}/threads/{thread_id}", headers=auth(token))
        detail = response.json()
        assert (
            contract_errors(detail, "api/threads.schema.json", "ThreadDetail", ThreadDetail) == []
        )
        plate = detail["messages"][1]["diagram"]
        assert plate["status"] == "complete" and plate["title"] == "Scaled dot-product attention"
        assert plate["parts"] == parts, "the plate read back is the plate that streamed"


def test_a_quote_with_differences_is_anchored_not_verified_and_one_found_nowhere_has_no_anchor(
    tmp_path: Path,
) -> None:
    patch = {"B": {"cite": {"quote": NEAR}}, "C": {"cite": {"quote": f"^7f3a91c2 {NOWHERE}"}}}
    with ai_harness(tmp_path, Script("diagram-ok", part_patch=patch)) as h:
        token, paper_id = _alice(h)
        frames, _ = read_sse(_draw(h, token, paper_id))
        _assert_browser_stream(frames)
        a, b, c = events(frames, "part")[:3]
        assert a["cite"]["supported"] is True
        assert b["cite"]["supported"] is False and b["cite"]["anchor"] is not None, (
            "with differences"
        )
        assert _block(b["cite"]["anchor"]) == _block(a["cite"]["anchor"]), "the same paragraph"
        assert c["cite"] == {
            "citation_id": None,
            "quote": NOWHERE,  # the copied datamark is not part of the quote
            "anchor": None,
            "locator": None,
            "page_index": None,
            "supported": False,
        }
        rows = h.rows("SELECT letter, supported, anchor_json IS NULL AS bare FROM ai_diagram_parts")
        assert [(r["letter"], r["supported"], r["bare"]) for r in rows[:3]] == [
            ("A", 1, 0),
            ("B", 0, 0),
            ("C", 0, 1),
        ]


def test_stop_keeps_the_parts_that_arrived_and_the_plate_reads_stopped(tmp_path: Path) -> None:
    texts = 0
    hold = 0
    for frame in RECORDED:  # the text frame right after the third part
        if frame.event == "text":
            texts += 1
        if frame.event == "part" and (frame.data or {}).get("letter") == "C":
            hold = texts + 1
            break
    with ai_harness(tmp_path, Script("diagram-ok", hold_after_text=hold)) as h:
        token, paper_id = _alice(h)
        box: dict[str, Any] = {}
        streamer = threading.Thread(target=lambda: box.update(r=_draw(h, token, paper_id)))
        streamer.start()
        deadline = time.monotonic() + 20
        while h.count("ai_diagram_parts") < 3 and time.monotonic() < deadline:
            time.sleep(0.02)
        run_id = h.fake.requests[0]["run_id"]
        assert h.client.post(f"/runs/{run_id}/cancel", headers=auth(token)).status_code == 202
        streamer.join(20)
        assert not streamer.is_alive()
        frames, _ = read_sse(box["r"])
        done = events(frames, "done")[0]
        assert done["status"] == "aborted" and done["error"]["code"] == "aborted"
        assert [p["letter"] for p in events(frames, "part")] == ["A", "B", "C"]
        thread_id = events(frames, "run")[0]["thread_id"]
        detail = h.client.get(f"/papers/{paper_id}/threads/{thread_id}", headers=auth(token)).json()
        plate = detail["messages"][1]["diagram"]
        assert plate["status"] == "stopped"
        assert [p["letter"] for p in plate["parts"]] == ["A", "B", "C"], "kept, not thrown away"
        assert plate["title"] == "Scaled dot-product attention"


def test_a_run_that_draws_no_part_is_an_error_not_an_empty_plate(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:  # prose, not lines
        token, paper_id = _alice(h)
        frames, _ = read_sse(_draw(h, token, paper_id))
        done = events(frames, "done")[0]
        assert done["status"] == "error" and done["error"]["code"] == "internal"
        assert events(frames, "part") == []
        (message,) = h.rows("SELECT status FROM ai_messages WHERE role = 'assistant'")
        assert message["status"] == "error"


def test_a_redraw_streams_a_second_plate_beside_the_first(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [Script("diagram-ok"), Script("diagram-ok")]) as h:
        token, paper_id = _alice(h)
        first = events(read_sse(_draw(h, token, paper_id))[0], "run")[0]
        response = h.client.post(
            f"/papers/{paper_id}/threads/{first['thread_id']}/messages",
            json={"question": "Redraw the diagram.", "redraw_of": first["message_id"]},
            headers={**auth(token), "Accept": "text/event-stream"},
        )
        frames, _ = read_sse(response)
        _assert_browser_stream(frames)
        second = events(frames, "run")[0]
        assert len(events(frames, "part")) == 6
        rows = h.rows("SELECT message_id, letter FROM ai_diagram_parts ORDER BY message_id, letter")
        by_message: dict[str, str] = {}
        for row in rows:
            by_message[row["message_id"]] = by_message.get(row["message_id"], "") + row["letter"]
        assert by_message == {first["message_id"]: "ABCDEF", second["message_id"]: "ABCDEF"}


# ── a fresh parse of the corpus PDF ──────────────────────────────────────────────────────────


@pytest.mark.skipif(
    not CORPUS_PDF.is_file(),
    reason=(
        f"corpus PDF {CORPUS_PDF.name} is absent — fetched, not committed. Run "
        "./research/benchmarks/fetch_corpus.sh to test diagram quotes on a real parse."
    ),
)
def test_the_plates_quotes_resolve_verbatim_on_a_fresh_parse_of_the_corpus_pdf(
    tmp_path: Path,
) -> None:
    settings = Settings(root=tmp_path / "data", agent_secret=SECRET, agent_url="http://agent.test")
    fake = FakeAgent(Script("diagram-ok"), secret=SECRET)
    app = create_app(settings, agent_transport=fake.transport())
    fake.tools = httpx.ASGITransport(app=app, client=("127.0.0.1", 50125))
    with TestClient(app) as client:
        token = register(client, "alice@example.com")
        paper_id = client.post(
            "/papers",
            files={"file": (CORPUS_PDF.name, CORPUS_PDF.read_bytes(), "application/pdf")},
            headers=auth(token),
        ).json()["paper_id"]
        assert run_worker(settings, max_jobs=5) >= 1
        ir = client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()
        block = next(b for b in ir["blocks"] if (b.get("text") or "").startswith(NEEDLE))
        anchor = {
            "anchorVersion": 1,
            "offsetUnit": "unicode",
            "id": str(uuid.uuid4()),
            "doc": {
                "paperId": paper_id,
                "pdfSha256": ir["source_hash"],
                "parserVersion": ir["parser"]["version"],
                "textStreamId": "pdfjs@5.7.284/page-text",
            },
            "targetKind": "text",
            "provenanceClass": "source",
            "selectors": [
                {"type": "BlockSelector", "blockId": block["block_id"], "blockTextHash": ""},
                {"type": "PageSelector", "index": block["page_index"]},
            ],
            "created": {"mode": "source", "at": "2026-10-16T05:00:00.000Z", "client": "tests"},
        }
        response = client.post(
            f"/papers/{paper_id}/threads",
            json={"kind": "diagram", "anchor": anchor},
            headers=auth(token),
        )
        frames, _ = read_sse(response)
    parts = events(frames, "part")
    assert fake.contract_errors == [] and fake.requests[0]["seed"]["passages"]
    assert [p["cite"]["supported"] for p in parts[:5]] == [True] * 5, parts
    assert all(anchor_errors(p["cite"]["anchor"]) == [] for p in parts[:5])
    assert {p["cite"]["locator"]["page_index"] for p in parts[:5]} == {3}
    print(
        f"\n[diagram] fresh corpus parse of {CORPUS_PDF.name}: 5 of 5 quotes verbatim, F inferred"
    )
