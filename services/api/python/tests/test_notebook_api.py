"""v0.2 S5a (#206): the notebook routes on the real app, with "Dive in" on a REAL parse.

What each group proves beyond status codes (AGENTS.md section 2): "Dive in" is held against the
citations the run stored (same anchors, same first-use order, counts agree with the list endpoint),
the stroke blob is checked on its real header bytes, and isolation is checked from a second user's
token on every route.
"""

from __future__ import annotations

import base64
import json
import math
import sqlite3
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from ai_support import SECRET, ai_harness, alice_with_paper, paragraph_anchor, read_sse
from api_support import assert_envelope, auth, register, seed_paper
from fake_agent import FakeAgent, Script
from fastapi.testclient import TestClient
from papertree_api import create_app
from papertree_api.schemas import (
    NotebookItem,
    NotebookPage,
    NotebookPageCreated,
    NotebookPageSummary,
    NotebookPageView,
)
from papertree_api.settings import Settings
from papertree_api.worker import run as run_worker
from papertree_db.notebook import MAX_STROKE_BYTES
from pydantic import BaseModel
from stroke_codec import encode_stroke

CORPUS = Path(__file__).resolve().parents[4] / "research" / "benchmarks" / "corpus"
ATTENTION = CORPUS / "attention-is-all-you-need.pdf"
requires_corpus = pytest.mark.skipif(
    not ATTENTION.is_file(),
    reason=f"corpus PDF {ATTENTION.name} is absent (fetched, not committed): run "
    "./research/benchmarks/fetch_corpus.sh to test Dive in on a real parse.",
)

#: A valid stroke blob: version 1, no pressure flag, 2 points (0,0) and (1,1) at 1/16 unit.
STROKE = bytes([1, 0, 2, 0, 0, 32, 32])


def _valid(model: type[BaseModel], value: Any) -> None:
    """The wire value held to its pydantic model, parsed from JSON as a client would send it."""
    model.model_validate_json(json.dumps(value))


def _stale(response: httpx.Response) -> dict[str, Any]:
    """A 409 `stale_version`: the envelope plus the row as it now is, under `current`."""
    assert response.status_code == 409, response.text
    body: dict[str, Any] = response.json()
    assert (
        set(body) == {"detail", "code", "retryable", "current"} and body["code"] == "stale_version"
    )
    return body


def b64(blob: bytes) -> str:
    return base64.b64encode(blob).decode("ascii")


def _page_id() -> str:
    return "pg_" + uuid.uuid4().hex[:20]


def _answer(
    client: TestClient, token: str, paper_id: str, anchor: dict[str, Any]
) -> dict[str, Any]:
    """Runs an explain through the fake agent; returns the stored assistant message."""
    frames, _ = read_sse(explain_response(client, token, paper_id, anchor))
    thread_id = next(f.data["thread_id"] for f in frames if f.event == "run")
    detail = client.get(f"/papers/{paper_id}/threads/{thread_id}", headers=auth(token)).json()
    return next(m for m in detail["messages"] if m["role"] == "assistant")


def explain_response(client: TestClient, token: str, paper_id: str, anchor: dict[str, Any]) -> Any:
    return client.post(
        f"/papers/{paper_id}/threads",
        json={"kind": "explain", "anchor": anchor},
        headers={**auth(token), "Accept": "text/event-stream"},
    )


def _quote(item_id: str, anchor: dict[str, Any], **fields: Any) -> dict[str, Any]:
    return {"item_id": item_id, "kind": "quote", "x": 1, "y": 2, "w": 200, "h": 80,
            "body": "words", "anchor": anchor, **fields}  # fmt: skip


def _note(item_id: str, kind: str = "sticky", **fields: Any) -> dict[str, Any]:
    return {"item_id": item_id, "kind": kind, "x": 10, "y": 20, "w": 120, "h": 60, **fields}


def _make_page(client: TestClient, token: str, paper_id: str, **fields: Any) -> dict[str, Any]:
    page_id = fields.pop("page_id", _page_id())
    made = client.post(
        f"/papers/{paper_id}/notebook/pages",
        json={"page_id": page_id, **fields},
        headers=auth(token),
    )
    assert made.status_code == 201, made.text
    body: dict[str, Any] = made.json()
    return body


# ── Dive in on a real parse ─────────────────────────────────────────────────────────────────


@requires_corpus
def test_dive_in_on_a_real_parse_seeds_the_exchange_and_one_quote_per_cited_passage(
    tmp_path: Path,
) -> None:
    settings = Settings(root=tmp_path / "data", agent_secret=SECRET, agent_url="http://agent.test")
    fake = FakeAgent(Script("explain-ok"), secret=SECRET)
    app = create_app(settings, agent_transport=fake.transport())
    fake.tools = httpx.ASGITransport(app=app, client=("127.0.0.1", 50125))
    with TestClient(app) as client:
        token = register(client, "alice@example.com")
        paper_id = client.post(
            "/papers",
            files={"file": (ATTENTION.name, ATTENTION.read_bytes(), "application/pdf")},
            headers=auth(token),
        ).json()["paper_id"]
        assert run_worker(settings, max_jobs=5) >= 1
        ir = client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()
        block = next(
            b for b in ir["blocks"] if b["type"] == "paragraph" and len(b.get("text") or "") > 200
        )
        page = next(p for p in ir["pages"] if p["index"] == block["page_index"])
        anchor = _pdfjs_anchor(paper_id, ir, block, page)
        message = _answer(client, token, paper_id, anchor)
        cited = message["citations"]
        assert cited, "the fake's explain-ok cites passages from the real parse"

        created = _make_page(client, token, paper_id, from_message_id=message["message_id"])
        _valid(NotebookPageCreated, created)
        items = created["items"]
        exchanges = [i for i in items if i["kind"] == "exchange"]
        quotes = [i for i in items if i["kind"] == "quote"]
        assert len(exchanges) == 1 and len(items) == 1 + len(quotes)

        # One quote per DISTINCT cited passage, in order of first use, with the stored Anchor.
        def block_id(a: dict[str, Any]) -> str:
            return str(next(s["blockId"] for s in a["selectors"] if s["type"] == "BlockSelector"))

        expected: list[dict[str, Any]] = []
        for c in cited:
            if block_id(c["anchor"]) not in {block_id(e) for e in expected}:
                expected.append(c["anchor"])
        assert [q["anchor"] for q in quotes] == expected
        # ... and that order IS the explain panel's passage numbering: quote i is the i-th
        # distinct `passage_key` (S4a's locator key) in citation order, and coverage counts the
        # same number of passages.
        numbered: list[str] = []
        first_anchor: dict[str, dict[str, Any]] = {}
        for c in sorted(cited, key=lambda c: c["ordinal"]):
            key = c["locator"]["passage_key"]
            if key not in first_anchor:
                numbered.append(key)
                first_anchor[key] = c["anchor"]
        assert [q["anchor"] for q in quotes] == [first_anchor[k] for k in numbered]
        assert message["coverage"]["passages"] == len(quotes)
        assert len(quotes) >= 1 and all(q["body"] for q in quotes)
        body = json.loads(exchanges[0]["body"])
        assert body["ai"]["message_id"] == message["message_id"]
        assert body["ai"]["content"] == message["content"]
        assert body["call"]["origin_anchor"]["id"] == anchor["id"]
        assert body["call"]["text"]

        # The counts endpoint agrees with the seeded items.
        listing = client.get(f"/papers/{paper_id}/notebook/pages", headers=auth(token)).json()
        [summary] = [s for s in listing if s["page_id"] == created["page"]["page_id"]]
        _valid(NotebookPageSummary, summary)
        assert summary["counts"] == {
            "quotes": len(quotes), "stickies": 0, "text": 0, "shapes": 0, "strokes": 0
        }  # fmt: skip
        print(f"\n[notebook] dive in on the real attention parse: {len(quotes)} quote cards")


def _pdfjs_anchor(
    paper_id: str, ir: dict[str, Any], block: dict[str, Any], page: dict[str, Any]
) -> dict[str, Any]:
    text = block["text"]
    return {
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
            {"type": "PageSelector", "index": block["page_index"]},
            {
                "type": "TextQuoteSelector",
                "exact": text[:120], "prefix": "", "suffix": "",
                "exactNormalised": text[:120], "prefixNormalised": "", "suffixNormalised": "",
            },
            {
                "type": "ShapeSelector", "pageIndex": block["page_index"], "quads": [block["bbox"]],
                "polygons": [], "pageWidth": page["width"], "pageHeight": page["height"],
                "rotation": page["rotation"], "userUnit": page["user_unit"],
                "cropBox": page["crop_box"],
            },
        ],
        "created": {"mode": "source", "at": "2026-09-26T05:00:00.000Z", "client": "tests"},
    }  # fmt: skip


# ── Dive in refusals, and the page/item/stroke routes (fixture parse, always run) ───────────


def test_dive_in_refusals_and_idempotence(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        message = _answer(h.client, token, paper_id, paragraph_anchor())
        c, hdr = h.client, auth(token)
        url = f"/papers/{paper_id}/notebook/pages"

        # A user message is not an answer: 422. An unknown message: 404.
        thread_id = message["thread_id"]
        detail = c.get(f"/papers/{paper_id}/threads/{thread_id}", headers=hdr).json()
        user = next(m for m in detail["messages"] if m["role"] == "user")
        r = c.post(
            url, json={"page_id": _page_id(), "from_message_id": user["message_id"]}, headers=hdr
        )
        assert_envelope(r, 422, "validation_failed")
        r = c.post(url, json={"page_id": _page_id(), "from_message_id": "msg_nope"}, headers=hdr)
        assert_envelope(r, 404, "not_found")

        # Another owner's paper and message are 404 (never 403).
        bob = register(c, "bob@example.com")
        r = c.post(url, json={"page_id": _page_id(), "from_message_id": message["message_id"]},
                   headers=auth(bob))  # fmt: skip
        assert_envelope(r, 404, "not_found")

        # Idempotent on page_id: the retry returns the same page and items, no second seed.
        pid = _page_id()
        first = _make_page(c, token, paper_id, page_id=pid, from_message_id=message["message_id"])
        again = _make_page(c, token, paper_id, page_id=pid, from_message_id=message["message_id"])
        assert again == first
        assert h.count("notebook_items") == len(first["items"])
        assert first["page"]["source_message_id"] == message["message_id"]
        assert first["page"]["source_thread_id"] == thread_id


def test_a_passage_cited_twice_becomes_one_quote_at_its_first_use(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        message = _answer(h.client, token, paper_id, paragraph_anchor())
        cites = message["citations"]
        # Cite the FIRST citation's block again, last: a repeat must not add a card.
        conn = sqlite3.connect(h.settings.database_file)
        try:
            conn.execute(
                "INSERT INTO ai_citations SELECT 'cit_repeat', owner_id, message_id, 99, marker, "
                "anchor_json, generation, block_id, page_index, supported FROM ai_citations "
                "WHERE message_id = ? AND ordinal = ?",
                (message["message_id"], cites[0]["ordinal"]),
            )
            conn.commit()
        finally:
            conn.close()
        quotes = [
            i
            for i in _make_page(h.client, token, paper_id, from_message_id=message["message_id"])[
                "items"
            ]
            if i["kind"] == "quote"
        ]
        assert [q["anchor"] for q in quotes] == [c["anchor"] for c in cites]


def test_deleting_the_thread_keeps_the_page(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        message = _answer(h.client, token, paper_id, paragraph_anchor())
        made = _make_page(h.client, token, paper_id, from_message_id=message["message_id"])
        conn = sqlite3.connect(h.settings.database_file)
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("DELETE FROM ai_threads WHERE thread_id = ?", (message["thread_id"],))
            conn.commit()
        finally:
            conn.close()
        got = h.client.get(f"/notebook/pages/{made['page']['page_id']}", headers=auth(token))
        assert got.status_code == 200 and len(got.json()["items"]) == len(made["items"])


def test_page_lifecycle_counts_and_stale_version(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        c, hdr = h.client, auth(token)
        made = _make_page(c, token, paper_id, title="My page", template="lined")
        page = made["page"]
        _valid(NotebookPage, page)
        assert made["items"] == [] and page["template"] == "lined" and page["version"] == 1
        pid = page["page_id"]
        anchor = paragraph_anchor()

        for body in (_note("ni_sticky0001"), _note("ni_text00001", "text", body="hello"),
                     _quote("ni_quote00001", anchor)):  # fmt: skip
            r = c.post(f"/notebook/pages/{pid}/items", json=body, headers=hdr)
            assert r.status_code == 201, r.text
            _valid(NotebookItem, r.json())
        assert c.post(f"/notebook/pages/{pid}/strokes", headers=hdr, json=[
            {"stroke_id": "sk_0000000001", "tool": "pen", "nib": "F", "colour": "pen",
             "points_b64": b64(STROKE)}
        ]).json() == {"added": 1}  # fmt: skip
        listing = c.get(f"/papers/{paper_id}/notebook/pages", headers=hdr).json()
        assert listing[0]["counts"] == {
            "quotes": 1, "stickies": 1, "text": 1, "shapes": 0, "strokes": 1
        }  # fmt: skip
        view = c.get(f"/notebook/pages/{pid}", headers=hdr).json()
        _valid(NotebookPageView, view)
        assert base64.b64decode(view["strokes"][0]["points_b64"]) == STROKE
        assert next(i for i in view["items"] if i["kind"] == "quote")["anchor"] == anchor

        # Page patch: good, then stale (the old version) with the current page in the 409.
        ok = c.patch(f"/notebook/pages/{pid}", json={"version": 1, "title": "Renamed"}, headers=hdr)
        assert ok.status_code == 200 and ok.json()["version"] == 2
        stale = c.patch(f"/notebook/pages/{pid}", json={"version": 1, "title": "x"}, headers=hdr)
        body = _stale(stale)
        assert body["current"]["title"] == "Renamed"
        assert_envelope(
            c.patch(f"/notebook/pages/{pid}", json={"version": 2, "template": "nope"}, headers=hdr),
            422, "validation_failed",
        )  # fmt: skip

        # Item patch and its stale 409, then delete.
        item_url = f"/notebook/pages/{pid}/items/ni_sticky0001"
        moved = c.patch(item_url, json={"version": 1, "x": 99.5, "body": "moved"}, headers=hdr)
        assert moved.status_code == 200 and moved.json()["x"] == 99.5
        assert (
            _stale(c.patch(item_url, json={"version": 1, "x": 1}, headers=hdr))["current"]["body"]
            == "moved"
        )
        # A delete at a stale version is refused with the item as it now is (S5c, #208): a tab
        # that last saw v1 must not remove an edit made at v2. At the current version it goes.
        stale_delete = c.delete(f"{item_url}?version=1", headers=hdr)
        assert _stale(stale_delete)["current"]["body"] == "moved"
        kept = c.get(f"/notebook/pages/{pid}", headers=hdr).json()["items"]
        assert "ni_sticky0001" in {i["item_id"] for i in kept}
        for bad in ("0", "-1", "two", "", "%C2%B2", "%D9%A1", "1.5"):
            assert_envelope(c.delete(f"{item_url}?version={bad}", headers=hdr),
                            422, "validation_failed")  # fmt: skip
        assert c.delete(f"{item_url}?version=2", headers=hdr).status_code == 204
        assert_envelope(c.delete(f"{item_url}?version=2", headers=hdr), 404, "not_found")
        # Without a version the delete is unconditional, as before.
        text_url = f"/notebook/pages/{pid}/items/ni_text00001"
        assert c.delete(text_url, headers=hdr).status_code == 204
        assert_envelope(c.delete(item_url, headers=hdr), 404, "not_found")

        # The eraser, then the page itself (cascade).
        assert (
            c.delete(f"/notebook/pages/{pid}/strokes/sk_0000000001", headers=hdr).status_code == 204
        )
        assert_envelope(
            c.delete(f"/notebook/pages/{pid}/strokes/sk_0000000001", headers=hdr), 404, "not_found"
        )
        assert c.delete(f"/notebook/pages/{pid}", headers=hdr).status_code == 204
        assert h.count("notebook_items") == h.count("notebook_strokes") == 0
        assert_envelope(c.get(f"/notebook/pages/{pid}", headers=hdr), 404, "not_found")


def test_a_quote_needs_a_whole_anchor_on_this_papers(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        c, hdr = h.client, auth(token)
        pid = _make_page(c, token, paper_id)["page"]["page_id"]
        url = f"/notebook/pages/{pid}/items"
        no_anchor = {k: v for k, v in _quote("ni_noanchor01", {}).items() if k != "anchor"}
        assert_envelope(c.post(url, json=no_anchor, headers=hdr), 422, "validation_failed")
        # A bare block id is not an anchor.
        bare = _quote("ni_bareblock01", {"block_id": "b1"})
        assert c.post(url, json=bare, headers=hdr).status_code == 422
        # A valid anchor from another paper is refused.
        foreign = paragraph_anchor()
        foreign["doc"] = {**foreign["doc"], "paperId": "ppr_" + "0" * 26}
        assert_envelope(
            c.post(url, json=_quote("ni_foreign001", foreign), headers=hdr),
            422,
            "validation_failed",
        )
        # A sticky cannot carry an anchor; the DB check agrees for a direct insert.
        r = c.post(url, json=_note("ni_stickyanc1", anchor=paragraph_anchor()), headers=hdr)
        assert_envelope(r, 422, "validation_failed")
        conn = sqlite3.connect(h.settings.database_file)
        try:
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(
                    "INSERT INTO notebook_items (item_id, owner_id, page_id, kind, x, y, w, h, z, "
                    "body, anchor_json, version, created_at, updated_at) SELECT 'ni_rawquote1', "
                    "owner_id, page_id, 'quote', 0, 0, 1, 1, 0, '', NULL, 1, 'now', 'now' "
                    "FROM notebook_pages LIMIT 1"
                )
        finally:
            conn.close()


def _posting(c: TestClient, hdr: dict[str, str], pid: str) -> Any:
    def post(sid: str, blob: bytes, **over: Any) -> Any:
        stroke = {"stroke_id": sid, "tool": "pen", "nib": "M", "colour": "pen",
                  "points_b64": b64(blob), **over}  # fmt: skip
        return c.post(f"/notebook/pages/{pid}/strokes", json=[stroke], headers=hdr)

    return post


def test_stroke_blobs_are_checked_on_their_header_and_size(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        c, hdr = h.client, auth(token)
        pid = _make_page(c, token, paper_id)["page"]["page_id"]
        url = f"/notebook/pages/{pid}/strokes"
        post = _posting(c, hdr, pid)

        assert post("sk_goodstroke1", STROKE).status_code == 201
        assert post("sk_goodstroke1", STROKE).json() == {"added": 0}  # idempotent retry
        assert_envelope(post("sk_badversion1", bytes([2, 0, 0])), 422, "validation_failed")
        assert_envelope(post("sk_badflags001", bytes([1, 6, 0])), 422, "validation_failed")
        assert_envelope(post("sk_truncated01", bytes([1])), 422, "validation_failed")
        too_many = bytes([1, 0]) + bytes([0xA1, 0x9C, 0x01])  # a varint count of 20,001
        assert_envelope(post("sk_toomany0001", too_many), 422, "validation_failed")
        assert_envelope(
            post("sk_bigstroke01", bytes([1, 0, 0]) + b"\0" * MAX_STROKE_BYTES),
            413,
            "payload_too_large",
        )
        assert_envelope(post("sk_badtool0001", STROKE, tool="brush"), 422, "validation_failed")
        assert_envelope(post("sk_hexcolour01", STROKE, colour="#ff0000"), 422, "validation_failed")
        assert_envelope(
            c.post(url, json=[{"stroke_id": "sk_notbase641", "tool": "pen", "nib": "F",
                               "colour": "pen", "points_b64": "!!!"}], headers=hdr),
            422, "validation_failed",
        )  # fmt: skip
        # 201 strokes in one request is over the batch limit; none are stored.
        many = [{"stroke_id": f"sk_batch{n:06d}", "tool": "pen", "nib": "F", "colour": "pen",
                 "points_b64": b64(STROKE)} for n in range(201)]  # fmt: skip
        assert_envelope(c.post(url, json=many, headers=hdr), 422, "validation_failed")
        assert h.count("notebook_strokes") == 1
        # A batch of 200 is fine; the batch byte cap answers 413 and stores nothing: twelve
        # worst-case strokes (each legal on its own) are over 2 MiB together.
        assert c.post(url, json=many[:200], headers=hdr).json() == {"added": 200}
        big = encode_stroke(_zigzag_points(20_000, 1e6), has_pressure=True)
        batch = [{"stroke_id": f"sk_bigbatch{n:03d}", "tool": "pen", "nib": "F", "colour": "pen",
                  "points_b64": b64(big)} for n in range(12)]  # fmt: skip
        assert_envelope(c.post(url, json=batch, headers=hdr), 413, "payload_too_large")
        assert h.count("notebook_strokes") == 201


def _zigzag_points(n: int, extent: float) -> list[tuple[float, float, float]]:
    """Alternating between the two coordinate extremes: the largest blob the encoder can write."""
    return [(extent if i % 2 else -extent, extent if i % 2 else -extent, 1.0) for i in range(n)]


def _fixture_blobs() -> dict[str, bytes]:
    raw = json.loads((Path(__file__).parent / "fixtures" / "stroke_blobs.json").read_text())
    return {name: base64.b64decode(blob) for name, blob in raw["blobs"].items()}


def test_the_python_encoder_twin_reproduces_the_real_encoders_bytes() -> None:
    blobs = _fixture_blobs()
    assert encode_stroke([], has_pressure=True) == blobs["empty"]
    assert encode_stroke([(10.3, 20.7, 0.4)], has_pressure=True) == blobs["one_point"]
    negative = [(-i * 1000.0, -i * 500.0, 1.0) for i in range(5)]
    assert encode_stroke(negative, has_pressure=True) == blobs["negative_5"]
    assert encode_stroke(_zigzag_points(8, 1e6), has_pressure=True) == blobs["extreme_8"]


def test_every_blob_the_real_encoder_wrote_is_accepted_and_read_back_identical(
    tmp_path: Path,
) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        c, hdr = h.client, auth(token)
        pid = _make_page(c, token, paper_id)["page"]["page_id"]
        post = _posting(c, hdr, pid)
        blobs = _fixture_blobs()
        for n, (name, blob) in enumerate(blobs.items()):
            assert post(f"sk_real{n:08d}", blob).status_code == 201, name
        stored = c.get(f"/notebook/pages/{pid}", headers=hdr).json()["strokes"]
        assert [base64.b64decode(s["points_b64"]) for s in stored] == list(blobs.values())


def test_the_stroke_cap_is_the_encoders_worst_case_and_the_point_cap_still_holds(
    tmp_path: Path,
) -> None:
    worst = encode_stroke(_zigzag_points(20_000, 1e6), has_pressure=True)
    # 2 header bytes + 3 for the count + 20,000 points of 4 + 4 + 1 bytes.
    assert len(worst) == 5 + 20_000 * 9 == 180_005 < MAX_STROKE_BYTES
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        c, hdr = h.client, auth(token)
        pid = _make_page(c, token, paper_id)["page"]["page_id"]
        post = _posting(c, hdr, pid)
        assert post("sk_worstcase01", worst).status_code == 201
        smooth = [(i % 900 + 20.0, 100 + math.sin(i / 50) * 40, 0.6) for i in range(20_000)]
        assert post("sk_smooth20k01", encode_stroke(smooth, has_pressure=True)).status_code == 201
        over = encode_stroke(_zigzag_points(20_001, 1e6), has_pressure=True)
        assert_envelope(post("sk_20001point", over), 422, "validation_failed")
        stored = c.get(f"/notebook/pages/{pid}", headers=hdr).json()["strokes"]
        assert len(stored) == 2


def test_a_blob_is_walked_to_the_end_like_the_webs_decoder_does(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        c, hdr = h.client, auth(token)
        pid = _make_page(c, token, paper_id)["page"]["page_id"]
        post = _posting(c, hdr, pid)
        bad = {
            "claims_points_has_none": bytes([1, 0, 2]),
            "trailing_bytes": STROKE + b"\x09",
            "junk_after_a_zero_count": bytes([1, 0, 0, 9, 9]),
            "a_long_junk_tail": bytes([1, 0, 0]) + b"\xff" * 50_000,
            "truncated_mid_point": STROKE[:-1],
            "pressure_flag_without_the_pressure_byte": bytes([1, 1, 1, 0, 0]),
            "a_varint_that_never_ends": bytes([1, 0, 1]) + b"\x80" * 9,
        }
        for n, (name, blob) in enumerate(bad.items()):
            assert_envelope(post(f"sk_junk{n:07d}", blob), 422, "validation_failed")
            assert name  # the name is the failure message when an assert above trips
        assert h.count("notebook_strokes") == 0
        good = {"one point, pressure": bytes([1, 1, 1, 0, 0, 255]), "no points": bytes([1, 0, 0])}
        for n, blob in enumerate(good.values()):
            assert post(f"sk_fine{n:07d}", blob).status_code == 201


def test_search_finds_text_and_the_ai_slip_but_never_ink(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        c, hdr = h.client, auth(token)
        message = _answer(c, token, paper_id, paragraph_anchor())
        dived = _make_page(c, token, paper_id, from_message_id=message["message_id"])
        plain = _make_page(c, token, paper_id, title="Plain")["page"]["page_id"]
        c.post(f"/notebook/pages/{plain}/items", headers=hdr,
               json=_note("ni_searchtxt1", "text", body="Marginal 100% sure_thing"))  # fmt: skip
        c.post(f"/notebook/pages/{plain}/items", headers=hdr,
               json=_note("ni_searchstk1", body="remember the Residual stream"))  # fmt: skip
        c.post(f"/notebook/pages/{plain}/strokes", headers=hdr, json=[
            {"stroke_id": "sk_searchink1", "tool": "pen", "nib": "F", "colour": "pen",
             "points_b64": b64(STROKE)}])  # fmt: skip

        def hits(q: str) -> list[dict[str, Any]]:
            r = c.get(f"/papers/{paper_id}/notebook/search", params={"q": q}, headers=hdr)
            assert r.status_code == 200, r.text
            out: list[dict[str, Any]] = r.json()
            return out

        assert [x["item_id"] for x in hits("residual")] == ["ni_searchstk1"]
        assert hits("100%")[0]["kind"] == "text"  # % is literal, not a wildcard
        assert hits("%") != [] and all("%" in x["snippet"] for x in hits("%"))
        assert hits("sure_thing") != [] and hits("sure.thing") == []
        words = json.loads(dived["items"][0]["body"])["ai"]["content"].split()[3]
        found = hits(words)
        assert any(
            x["kind"] == "exchange" and x["page_id"] == dived["page"]["page_id"] for x in found
        )
        assert all(x["kind"] != "stroke" for x in found) and hits("sk_searchink1") == []
        assert_envelope(
            c.get(f"/papers/{paper_id}/notebook/search", headers=hdr), 422, "validation_failed"
        )
        assert_envelope(
            c.get(f"/papers/{paper_id}/notebook/search?q=" + "a" * 201, headers=hdr),
            422,
            "validation_failed",
        )


def test_another_user_sees_and_changes_nothing(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        c, hdr = h.client, auth(token)
        pid = _make_page(c, token, paper_id)["page"]["page_id"]
        c.post(
            f"/notebook/pages/{pid}/items", headers=hdr, json=_note("ni_alicenote1", body="secret")
        )
        c.post(f"/notebook/pages/{pid}/strokes", headers=hdr, json=[
            {"stroke_id": "sk_aliceink01", "tool": "pen", "nib": "F", "colour": "pen",
             "points_b64": b64(STROKE)}])  # fmt: skip
        bob = auth(register(c, "bob@example.com"))
        base = f"/notebook/pages/{pid}"
        for r in (
            c.get(base, headers=bob),
            c.patch(base, json={"version": 1, "title": "mine"}, headers=bob),
            c.delete(base, headers=bob),
            c.post(f"{base}/items", json=_note("ni_bobsnote01"), headers=bob),
            c.patch(f"{base}/items/ni_alicenote1", json={"version": 1, "x": 5}, headers=bob),
            c.delete(f"{base}/items/ni_alicenote1", headers=bob),
            # A versioned delete is no existence oracle either: 404 at any version, never 409.
            c.delete(f"{base}/items/ni_alicenote1?version=1", headers=bob),
            c.delete(f"{base}/items/ni_alicenote1?version=2", headers=bob),
            c.delete(f"{base}/strokes/sk_aliceink01", headers=bob),
            c.post(
                f"{base}/strokes",
                headers=bob,
                json=[
                    {
                        "stroke_id": "sk_bobsink001",
                        "tool": "pen",
                        "nib": "F",
                        "colour": "pen",
                        "points_b64": b64(STROKE),
                    }
                ],
            ),  # fmt: skip
            c.get(f"/papers/{paper_id}/notebook/pages", headers=bob),
            c.get(f"/papers/{paper_id}/notebook/search?q=secret", headers=bob),
            c.post(f"/papers/{paper_id}/notebook/pages", json={"page_id": _page_id()}, headers=bob),
        ):
            assert_envelope(r, 404, "not_found")
        # Reusing alice's page id as bob (on his own paper) is refused, not leaked or overwritten.
        # Nothing of alice's changed.
        view = c.get(base, headers=hdr).json()
        assert (
            view["page"]["title"] != "mine"
            and len(view["items"]) == 1
            and len(view["strokes"]) == 1
        )
        # And no response anywhere carries an owner handle.
        assert "owner" not in json.dumps(view)


def test_auth_required_and_bad_bodies_are_422_not_500(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        c, hdr = h.client, auth(token)
        assert_envelope(c.get(f"/papers/{paper_id}/notebook/pages"), 401, "auth_required")
        assert_envelope(c.get("/notebook/pages/pg_x"), 401, "auth_required")
        url = f"/papers/{paper_id}/notebook/pages"
        for body in ({}, {"page_id": "x"}, {"page_id": _page_id(), "template": "grid"},
                     {"page_id": _page_id(), "title": None}, {"page_id": _page_id(), "extra": 1},
                     {"page_id": _page_id(), "title": "\ud800"}):  # fmt: skip
            r = c.post(
                url, content=json.dumps(body), headers={**hdr, "Content-Type": "application/json"}
            )
            assert r.status_code == 422, (body, r.text)
        pid = _make_page(c, token, paper_id)["page"]["page_id"]
        items = f"/notebook/pages/{pid}/items"
        for bad in (
            {**_note("ni_nanwidth01"), "w": 0},
            {**_note("ni_hugecoord1"), "x": 1e12},
            {**_note("ni_hugez00001"), "z": 2**63},
            _note("ni_badkind001", "photo"),
        ):
            assert c.post(items, json=bad, headers=hdr).status_code == 422, bad
        r = c.patch(f"/notebook/pages/{pid}", json={"version": 2**63}, headers=hdr)
        assert_envelope(r, 422, "validation_failed")
        assert_envelope(
            c.post(items, json=_note("ni_shape00001", "shape", body="[1]"), headers=hdr),
            422,
            "validation_failed",
        )


def test_item_patch_holds_exchange_and_shape_bodies_to_a_json_object(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        c, hdr = h.client, auth(token)
        pid = _make_page(c, token, paper_id)["page"]["page_id"]
        url = f"/notebook/pages/{pid}/items"
        good = json.dumps({"call": {"text": "q"}, "ai": {"content": "hello"}})
        for item_id, kind in (("ni_exchange01", "exchange"), ("ni_shape00002", "shape")):
            r = c.post(url, json=_note(item_id, kind, body=good), headers=hdr)
            assert r.status_code == 201, r.text
            for bad in ("not json{", "[1]", "3", '"s"', "null"):
                r = c.patch(f"{url}/{item_id}", json={"version": 1, "body": bad}, headers=hdr)
                assert_envelope(r, 422, "validation_failed")
            r = c.patch(f"{url}/{item_id}", json={"version": 1, "body": good}, headers=hdr)
            assert r.status_code == 200 and r.json()["version"] == 2
        # A sticky or text card is free text: any string is fine there.
        c.post(url, json=_note("ni_sticky0003"), headers=hdr)
        r = c.patch(f"{url}/ni_sticky0003", json={"version": 1, "body": "not json{"}, headers=hdr)
        assert r.status_code == 200
        # An unknown item is still a 404, not a validation error.
        r = c.patch(f"{url}/ni_nothere001", json={"version": 1, "body": "x"}, headers=hdr)
        assert_envelope(r, 404, "not_found")


def test_dive_in_mints_fresh_item_ids_for_pages_that_share_a_suffix_and_for_two_owners(
    tmp_path: Path,
) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        c = h.client
        made: list[dict[str, Any]] = []
        for email, slug, prefixes in (
            ("alice@example.com", "resnet-cvpr-2col", ("pg", "px")),
            ("bob@example.com", "neural-odes-mathheavy", ("py", "pz")),
        ):
            token = register(c, email)
            paper_id = seed_paper(h.settings, c, token, slug)
            message = _answer(c, token, paper_id, paragraph_anchor(slug))
            # The same suffix after the prefix: two pages of one owner, and the other owner's.
            for prefix in prefixes:
                made.append(
                    _make_page(
                        c,
                        token,
                        paper_id,
                        page_id=f"{prefix}_same0000001",
                        from_message_id=message["message_id"],
                    )  # fmt: skip
                )
        ids = [i["item_id"] for page in made for i in page["items"]]
        assert len(made) == 4 and len(ids) == len(set(ids)) == h.count("notebook_items")
        assert all(len(page["items"]) >= 2 for page in made)


def test_a_stored_exchange_body_that_is_not_json_cannot_break_search(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        c, hdr = h.client, auth(token)
        pid = _make_page(c, token, paper_id)["page"]["page_id"]
        url = f"/notebook/pages/{pid}/items"
        good = json.dumps({"call": {"text": "q"}, "ai": {"content": "needle in the slip"}})
        for item_id in ("ni_exchange01", "ni_exchange02", "ni_exchange03"):
            assert (
                c.post(url, json=_note(item_id, "exchange", body=good), headers=hdr).status_code
                == 201
            )
        c.post(url, json=_note("ni_sticky0001", body="needle on a sticky"), headers=hdr)
        # What a bad client or an older build could have stored: not JSON; JSON that is not an
        # object; an object whose text is not a string. Written under the API on purpose.
        conn = sqlite3.connect(h.settings.database_file)
        try:
            for item_id, body in (
                ("ni_exchange01", "needle{ not json"),
                ("ni_exchange02", "[1, 2]"),
                ("ni_exchange03", '{"ai": {"content": 7}, "call": {"text": 8}}'),
            ):
                conn.execute(
                    "UPDATE notebook_items SET body = ? WHERE item_id = ?", (body, item_id)
                )
            conn.commit()
        finally:
            conn.close()
        r = c.get(f"/papers/{paper_id}/notebook/search", params={"q": "needle"}, headers=hdr)
        assert r.status_code == 200, r.text
        assert [x["item_id"] for x in r.json()] == ["ni_sticky0001"]
        assert (
            c.get(f"/papers/{paper_id}/notebook/search", params={"q": "7"}, headers=hdr).status_code
            == 200
        )


def test_the_item_delete_documents_its_version_query(tmp_path: Path) -> None:
    """`?version=` is declared on the DELETE route, so the contract (OpenAPI) shows it."""
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        spec = h.client.get("/openapi.json").json()
        route = spec["paths"]["/notebook/pages/{page_id}/items/{item_id}"]["delete"]
        params = {p["name"]: p for p in route["parameters"]}
        assert params["version"]["in"] == "query"
        assert params["version"]["required"] is False
        assert params["version"]["schema"]["anyOf"][0]["minimum"] == 1
        assert "409" in route["responses"]
