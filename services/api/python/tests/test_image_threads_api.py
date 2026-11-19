"""v0.3 (#348): the image ask, end to end through the API with the contract-replaying agent.

A reader thread (``POST /papers/{id}/threads`` with ``kind: "image"``) and a board ask on an image
root both render the crop, find the figure's words and run the ``image`` kind. Every request the API
sends the agent is held to ``run-request.schema.json`` and the pydantic model
(``h.fake.contract_errors == []``); what is asserted here is what is IN it: the picture, its
caption, the passages and their order, the kind, the limits and the prompt version.
"""

from __future__ import annotations

import base64
import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from ai_support import (
    AiHarness,
    ai_harness,
    anchor_errors,
    events,
    paragraph_anchor,
    read_sse,
)
from api_support import assert_envelope, auth, register, seed_paper
from crop_support import image_anchor, store_pdf
from fake_agent import RunContext, Script
from papertree_api import region_crops

SSE = {"Accept": "text/event-stream"}
SLUG = "resnet-cvpr-2col"
#: The committed fixture's Figure 2 (page 1) and its caption block; the paragraph that names it
#: first by doc_order is `FIRST_MENTION`.
FIG2, CAP2 = "blk_vd6i5hijwlkso3vs", "blk_5mol5rifo7auwfaj"
FIG2_BOX = (98.28, 78.4, 231.58, 155.84)
FIRST_MENTION = "blk_7qvf2ybocr37gwjf"


def _answer(context: RunContext) -> str:
    return (
        "## TL;DR\nThe figure shows a residual block.\n\n"
        "## In plain words\nThe input is added back.\n\n"
        "## How it works\nIt outputs $y = F(x) + x$.\n\n"
        "## In the paper\nThe caption says so [b1]."
    )


def _script() -> Script:
    return Script("explain-ok", call_tools=False, final_text=_answer)


def _setup(h: AiHarness, email: str = "alice@example.com") -> tuple[str, str, dict[str, Any]]:
    token = register(h.client, email)
    paper_id = seed_paper(h.settings, h.client, token, SLUG)
    store_pdf(h.settings.upload_root, paper_id)
    return token, paper_id, paragraph_anchor()["doc"]


def _image(h: AiHarness, token: str, paper_id: str, anchor: dict[str, Any], **body: Any) -> Any:
    return h.client.post(
        f"/papers/{paper_id}/threads",
        json={"kind": "image", "anchor": anchor, **body},
        headers={**auth(token), **SSE},
    )


def _same_size(actual: tuple[int, int], expected: tuple[int, int]) -> bool:
    """MuPDF rounds a fractional clip out to whole pixels: within one pixel is the same crop."""
    return all(abs(a - e) <= 1 for a, e in zip(actual, expected, strict=True))


def _runs(h: AiHarness) -> list[dict[str, Any]]:
    return h.rows("SELECT kind, status, prompt_version, code_path FROM ai_runs ORDER BY started_at")


# ── the reader's image thread ────────────────────────────────────────────────────────────────


def test_an_image_thread_sends_the_crop_the_caption_and_the_first_mention(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        anchor = image_anchor(doc, kind="figure", page=1, box=FIG2_BOX, block_id=FIG2)
        assert anchor_errors(anchor) == []
        frames, _ = read_sse(_image(h, token, paper_id, anchor))
        run = events(frames, "run")[0]
        assert frames[-1].event == "done" and frames[-1].data["status"] == "complete"
        assert h.fake.contract_errors == []
        (sent,) = h.fake.requests
        assert (sent["kind"], sent["prompt_version"]) == ("image", "image-v1")
        assert (sent["check"], sent["level"], sent["history"]) == (False, "familiar", None)
        assert sent["question"] == "Explain this figure."
        assert sent["limits"]["max_tool_calls"] == 4 and sent["limits"]["deadline_ms"] == 75_000
        # The picture: a real PNG of the figure box, at the dpi rule, with its caption and page.
        (picture,) = sent["images"]
        assert picture["media_type"] == "image/png" and picture["page"] == 1
        assert picture["caption"].startswith("Figure 2. Residual learning")
        png = base64.b64decode(picture["data_base64"])
        plan = region_crops.plan_crop(1, FIG2_BOX, 612, 792)
        assert _same_size(region_crops.png_size(png), plan.size_px)
        assert 1200 <= max(plan.size_px) <= 1600
        # The words: the caption first, then the paragraph that first mentions the figure.
        passages = sent["seed"]["passages"]
        assert [p["handle"] for p in passages] == ["b1", "b2"]
        assert passages[0]["label"].endswith("the figure's caption")
        assert passages[1]["label"].endswith("where the paper first mentions the figure")
        assert "Residual learning" in passages[0]["text"]
        assert sent["seed"]["page_label"] == "p. 2" and sent["seed"]["quote"] == ""
        # b1 and b2 are the caption and the mention (the replayer's own tool calls add later ones).
        seeded = h.rows(
            "SELECT handle, block_id FROM ai_run_handles WHERE handle IN ('b1', 'b2') "
            "ORDER BY handle"
        )
        assert [(r["handle"], r["block_id"]) for r in seeded] == [
            ("b1", CAP2),
            ("b2", FIRST_MENTION),
        ]
        # Stored as a run of its own kind, on an `ask` thread that reads back as `image`.
        assert _runs(h) == [
            {
                "kind": "image",
                "status": "done",
                "prompt_version": "image-v1",
                "code_path": (
                    "api.threads.image>agent.v1.runs>pi.createAgentSession>minimax.anthropic-messages"
                ),
            }
        ]
        assert h.rows("SELECT kind FROM ai_threads") == [{"kind": "ask"}]
        thread = h.client.get(
            f"/papers/{paper_id}/threads/{run['thread_id']}", headers=auth(token)
        ).json()
        assert thread["thread"]["kind"] == "image"
        assert thread["thread"]["origin_anchor"]["targetKind"] == "figure"
        assert thread["thread"]["title"].startswith("Figure 2")
        question, answer = thread["messages"]
        assert question["content"] == "Explain this figure."
        assert answer["level"] == "familiar" and answer["status"] == "complete"
        listed = h.client.get(f"/papers/{paper_id}/threads", headers=auth(token)).json()
        assert [t["kind"] for t in listed] == ["image"]


def test_a_free_region_inside_a_figure_is_that_figures_context_and_a_question_is_kept(
    tmp_path: Path,
) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        inside = (110.0, 90.0, 200.0, 140.0)
        anchor = image_anchor(doc, kind="figure_region", page=1, box=inside)
        frames, _ = read_sse(
            _image(h, token, paper_id, anchor, question="What is the arrow?", level="new")
        )
        assert frames[-1].data["status"] == "complete"
        (sent,) = h.fake.requests
        assert sent["question"] == "What is the arrow?" and sent["level"] == "new"
        assert [p["handle"] for p in sent["seed"]["passages"]] == ["b1", "b2"]
        # The crop is the REGION, not the whole figure: a different (smaller) box and dpi.
        png = base64.b64decode(sent["images"][0]["data_base64"])
        assert _same_size(
            region_crops.png_size(png), region_crops.plan_crop(1, inside, 612, 792).size_px
        )


def test_a_region_in_no_float_gets_the_nearest_text_and_no_caption(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        anchor = image_anchor(doc, page=1, box=(60.0, 400.0, 280.0, 470.0))
        frames, _ = read_sse(_image(h, token, paper_id, anchor))
        assert frames[-1].data["status"] == "complete"
        (sent,) = h.fake.requests
        labels = [p["label"] for p in sent["seed"]["passages"]]
        assert 1 <= len(labels) <= 3 and all(
            name.endswith("text next to the figure") for name in labels
        )
        assert "caption" not in sent["images"][0]  # nothing to call a caption


def test_a_paragraph_selected_with_the_figure_rides_first(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        paragraph = paragraph_anchor(nth=3)
        anchor = image_anchor(doc, kind="figure", page=1, box=FIG2_BOX, block_id=FIG2)
        frames, _ = read_sse(_image(h, token, paper_id, anchor, with_text_anchor=paragraph))
        assert frames[-1].data["status"] == "complete"
        (sent,) = h.fake.requests
        quote = next(s["exact"] for s in paragraph["selectors"] if s["type"] == "TextQuoteSelector")
        assert sent["seed"]["quote"] == quote
        first = sent["seed"]["passages"][0]
        assert first["handle"] == "b1" and "the figure's caption" not in first["label"]
        assert any(p["label"].endswith("the figure's caption") for p in sent["seed"]["passages"])


def test_a_follow_up_and_a_relevel_attach_the_crop_again_to_their_own_turn(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        anchor = image_anchor(doc, kind="figure", page=1, box=FIG2_BOX, block_id=FIG2)
        frames, _ = read_sse(_image(h, token, paper_id, anchor))
        run = events(frames, "run")[0]
        thread_id, first_answer = run["thread_id"], run["message_id"]
        url = f"/papers/{paper_id}/threads/{thread_id}/messages"
        follow = h.client.post(url, json={"question": "Why add x?"}, headers={**auth(token), **SSE})
        frames, _ = read_sse(follow)
        assert frames[-1].data["status"] == "complete"
        relevel = h.client.post(
            url,
            json={"relevel_of": first_answer, "level": "expert"},
            headers={**auth(token), **SSE},
        )
        assert read_sse(relevel)[0][-1].data["status"] == "complete"
        assert h.fake.contract_errors == []
        first, second, third = h.fake.requests
        for request in (second, third):
            assert request["kind"] == "image" and len(request["images"]) == 1
            assert request["images"][0]["data_base64"] == first["images"][0]["data_base64"]
            assert [p["label"] for p in request["seed"]["passages"]][0].endswith("caption")
        assert second["question"] == "Why add x?" and third["level"] == "expert"
        assert third["question"] == "Explain this figure."  # a relevel re-asks the stored question
        assert [r["kind"] for r in _runs(h)] == ["image", "image", "image"]
        detail = h.client.get(f"/papers/{paper_id}/threads/{thread_id}", headers=auth(token))
        assert detail.json()["thread"]["kind"] == "image"
        levels = [m["level"] for m in detail.json()["messages"] if m["role"] == "assistant"]
        assert levels == ["familiar", "familiar", "expert"]


def test_an_image_thread_is_refused_for_a_bad_anchor_before_a_row_or_a_run(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        good = image_anchor(doc, page=1, box=FIG2_BOX)
        two_quads = image_anchor(doc, page=1, box=FIG2_BOX)
        two_quads["selectors"][1]["quads"].append([1, 2, 30, 40])  # type: ignore[index]
        as_text = {**good, "targetKind": "text"}
        elsewhere = image_anchor({**doc, "paperId": "ppr_00000000000000000000000000"}, page=1)
        cases = {
            "no anchor": ({"kind": "image"}, 422, "validation_failed"),
            "a text anchor": ({"kind": "image", "anchor": as_text}, 422, "validation_failed"),
            "two quads": ({"kind": "image", "anchor": two_quads}, 422, "validation_failed"),
            "text with an explain": (
                {"kind": "explain", "anchor": paragraph_anchor(), "with_text_anchor": good},
                422,
                "validation_failed",
            ),
            "another paper": ({"kind": "image", "anchor": elsewhere}, 422, "anchor_mismatch"),
            "a page past the end": (
                {"kind": "image", "anchor": image_anchor(doc, page=9)},
                422,
                "validation_failed",
            ),
            "off the page": (
                {"kind": "image", "anchor": image_anchor(doc, page=0, box=(700, 100, 900, 200))},
                422,
                "validation_failed",
            ),
        }
        for label, (body, status, code) in cases.items():
            response = h.client.post(
                f"/papers/{paper_id}/threads", json=body, headers={**auth(token), **SSE}
            )
            assert_envelope(response, status, code), label
        assert h.count("ai_threads") == h.count("ai_runs") == 0
        assert h.fake.requests == []


def test_a_paper_without_its_pdf_on_this_host_is_a_404_and_writes_nothing(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        (h.settings.upload_root / f"{paper_id}.pdf").unlink()
        response = _image(h, token, paper_id, image_anchor(doc, page=1, box=FIG2_BOX))
        assert_envelope(response, 404, "not_found")
        assert h.count("ai_threads") == h.count("ai_runs") == 0


def test_another_users_paper_is_a_404_for_an_image_thread(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        bob = register(h.client, "bob@example.com")
        response = _image(h, bob, paper_id, image_anchor(doc, page=1, box=FIG2_BOX))
        assert_envelope(response, 404, "not_found")
        assert h.fake.requests == []


# ── usage and the cap ────────────────────────────────────────────────────────────────────────


def test_an_image_run_is_counted_under_its_own_kind_in_usage(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        read_sse(_image(h, token, paper_id, image_anchor(doc, page=1, box=FIG2_BOX)))
        usage = h.client.get("/usage", headers=auth(token)).json()
        assert usage["by_kind"]["image"]["runs"] == 1
        assert usage["by_kind"]["ask"]["runs"] == 0
        assert usage["runs"] == 1 and usage["by_kind"]["image"]["cost_usd_est"] > 0
        assert usage["by_kind"]["image"]["input_tokens"] > 0


def test_the_daily_cap_applies_to_an_image_ask(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        read_sse(_image(h, token, paper_id, image_anchor(doc, page=1, box=FIG2_BOX)))
        (row,) = h.rows("SELECT SUM(cost_usd_est) AS spent FROM ai_runs")
        object.__setattr__(h.settings, "daily_budget_usd", float(row["spent"]))  # used up
        response = _image(h, token, paper_id, image_anchor(doc, page=1, box=FIG2_BOX))
        assert_envelope(response, 429, "budget_exhausted")
        assert len(h.fake.requests) == 1  # the refused ask never reached the agent
        assert h.count("ai_threads") == 1


def test_an_image_run_in_flight_reserves_its_estimate_against_the_cap(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script(), budget_usd=0.03) as h:
        token, paper_id, doc = _setup(h)
        conn = sqlite3.connect(h.settings.database_file)
        try:
            read_sse(_image(h, token, paper_id, image_anchor(doc, page=1, box=FIG2_BOX)))
            conn.execute("UPDATE ai_runs SET status = 'running', cost_usd_est = NULL")
            conn.execute("UPDATE ai_runs SET expires_at = '2999-01-01T00:00:00+00:00'")
            conn.commit()
        finally:
            conn.close()
        # One image run still running holds $0.02 of a $0.03 budget: a second fits, a third waits.
        assert (
            _image(h, token, paper_id, image_anchor(doc, page=1, box=FIG2_BOX)).status_code == 200
        )
        conn = sqlite3.connect(h.settings.database_file)
        conn.execute("UPDATE ai_runs SET status = 'running', cost_usd_est = NULL")
        conn.commit()
        conn.close()
        waits = _image(h, token, paper_id, image_anchor(doc, page=1, box=FIG2_BOX))
        assert_envelope(waits, 429, "budget_exhausted")


# ── a board whose root is an image card ──────────────────────────────────────────────────────


class ImageBoard:
    """A board whose root is an image card (an excerpt with a figure_region anchor)."""

    def __init__(self, h: AiHarness) -> None:
        self.h = h
        self.token, self.paper_id, doc = _setup(h)
        self.root = "cn_imageroot0001"
        made = h.client.post(
            f"/papers/{self.paper_id}/board/nodes",
            json={
                "node_id": self.root,
                "kind": "excerpt",
                "x": 0,
                "y": 0,
                "w": 360,
                "h": 260,
                "source_anchor": image_anchor(
                    doc, kind="figure", page=1, box=FIG2_BOX, block_id=FIG2
                ),
            },
            headers=auth(self.token),
        )
        assert made.status_code == 201, made.text
        self.board_id: str = made.json()["board"]["board_id"]

    def ask(self, node_id: str, **body: Any) -> tuple[list[Any], dict[str, Any]]:
        response = self.h.client.post(
            f"/boards/{self.board_id}/nodes/{node_id}/asks",
            json=body,
            headers={**auth(self.token), **SSE},
        )
        frames, _ = read_sse(response)
        return frames, events(frames, "node")[0]


def test_every_ask_down_an_image_roots_path_sends_the_roots_crop(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = ImageBoard(h)
        frames, first = b.ask(b.root, question="What is the arrow?")
        assert frames[-1].data["status"] == "complete"
        assert (first["parent_id"], first["branch"]) == (b.root, "right")
        frames, second = b.ask(first["node_id"], question="And the shortcut?")
        assert (second["parent_id"], second["branch"]) == (first["node_id"], "down")
        frames, third = b.ask(second["node_id"], question="Why add?", uses={"paper": "off"})
        assert frames[-1].data["status"] == "complete"
        assert h.fake.contract_errors == []
        one, two, three = h.fake.requests
        pictures = {r["images"][0]["data_base64"] for r in (one, two, three)}
        assert len(pictures) == 1, "the SAME root crop on every ask down the path"
        png = base64.b64decode(next(iter(pictures)))
        assert _same_size(
            region_crops.png_size(png), region_crops.plan_crop(1, FIG2_BOX, 612, 792).size_px
        )
        for request in (one, two, three):
            assert request["kind"] == "image" and request["prompt_version"] == "image-v1"
            assert request["check"] is False
        # The path rides as history: none on the first ask, the earlier turns on the others, and
        # no bytes in it.
        assert one["history"] is None
        assert len(two["history"]["entries"]) == 2 and len(three["history"]["entries"]) == 4
        assert "data_base64" not in str(two["history"]) and "image" not in str(two["history"])
        # The caption and the first mention ride on every ask, `paper: off` too: they describe the
        # image itself (`plan_image_seed`).
        assert [p["handle"] for p in one["seed"]["passages"]] == ["b1", "b2"]
        assert [p["handle"] for p in three["seed"]["passages"]] == ["b1", "b2"]
        # Tools only for paper: whole; the board's default (page) and off have none.
        assert one["limits"]["max_tool_calls"] == 0 and three["limits"]["max_tool_calls"] == 0
        assert [r["kind"] for r in _runs(h)] == ["image", "image", "image"]
        board = h.client.get(f"/papers/{b.paper_id}/board", headers=auth(b.token)).json()
        nodes = {n["node_id"]: n for n in board["nodes"]}
        assert nodes[b.root]["source_anchor"]["targetKind"] == "figure"
        assert nodes[first["node_id"]]["final_text"].startswith("## TL;DR")
        # Board threads stay out of the reader's list, whatever their kind.
        assert h.client.get(f"/papers/{b.paper_id}/threads", headers=auth(b.token)).json() == []


def test_paper_whole_on_an_image_root_allows_the_tools(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = ImageBoard(h)
        b.ask(b.root, question="Anything else in the paper?", uses={"paper": "whole"})
        (sent,) = h.fake.requests
        assert sent["limits"]["max_tool_calls"] == 4 and len(sent["images"]) == 1


def test_a_text_root_still_asks_as_an_ordinary_ask_with_no_picture(tmp_path: Path) -> None:
    from test_board_asks_api import Board
    from test_board_asks_api import _script as text_script

    with ai_harness(tmp_path, text_script()) as h:
        token, paper_id, _ = _setup(h)
        board = Board(h, token, paper_id)
        board.ask(board.root, question="Why does this help?")
        (sent,) = h.fake.requests
        assert sent["kind"] == "ask" and "images" not in sent


def test_an_image_ask_on_the_board_is_counted_and_capped_like_any_ask(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = ImageBoard(h)
        b.ask(b.root, question="What is this?")
        usage = h.client.get("/usage", headers=auth(b.token)).json()
        assert usage["by_kind"]["image"]["runs"] == 1
        (row,) = h.rows("SELECT SUM(cost_usd_est) AS spent FROM ai_runs")
        object.__setattr__(h.settings, "daily_budget_usd", float(row["spent"]))
        response = h.client.post(
            f"/boards/{b.board_id}/nodes/{b.root}/asks",
            json={"question": "Again?"},
            headers={**auth(b.token), **SSE},
        )
        assert_envelope(response, 429, "budget_exhausted")


@pytest.mark.parametrize("quick", ["simpler", "example", "diagram"])
def test_the_quick_asks_work_on_an_image_root(tmp_path: Path, quick: str) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = ImageBoard(h)
        frames, node = b.ask(b.root, quick=quick)
        assert frames[-1].data["status"] == "complete" and node["question"]
        (sent,) = h.fake.requests
        assert sent["kind"] == "image" and len(sent["images"]) == 1


# ── the review's hardening: bad image anchors on a board, and a huge quad ────────────────────


def _bad_anchors(doc: dict[str, Any]) -> dict[str, dict[str, Any]]:
    two: dict[str, Any] = image_anchor(doc, kind="figure", page=1, box=FIG2_BOX, block_id=FIG2)
    two["selectors"][-1]["quads"].append([1, 2, 30, 40])
    no_page: dict[str, Any] = image_anchor(doc, kind="figure", page=1, box=FIG2_BOX)
    no_page["selectors"] = [s for s in no_page["selectors"] if s["type"] != "PageSelector"]
    return {
        "two quads": two,
        "no area": image_anchor(doc, page=1, box=(50, 50, 50, 90)),
        "no page selector": no_page,
        "a huge finite quad": image_anchor(doc, page=1, box=(10.0, 10.0, 1e308, 1e308)),
    }


def test_a_board_card_with_a_malformed_image_anchor_is_refused_where_it_is_written(
    tmp_path: Path,
) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        for label, bad in _bad_anchors(doc).items():
            made = h.client.post(
                f"/papers/{paper_id}/board/nodes",
                json={"node_id": "cn_bad0000000001", "kind": "excerpt", "x": 0, "y": 0, "w": 300,
                      "h": 200, "source_anchor": bad},
                headers=auth(token),
            )  # fmt: skip
            assert_envelope(made, 422, "validation_failed")
            assert "source_anchor" in made.text or "anchor" in made.text, label
        assert h.count("canvas_nodes") == 0


def test_an_ask_on_a_stored_image_anchor_that_is_malformed_is_a_422_not_a_500(
    tmp_path: Path,
) -> None:
    """A card written before the check (or by a client that skipped it) must not 500 the ask."""
    with ai_harness(tmp_path, _script()) as h:
        b = ImageBoard(h)
        doc = paragraph_anchor()["doc"]
        for bad in _bad_anchors(doc).values():
            conn = sqlite3.connect(h.settings.database_file)
            conn.execute(
                "UPDATE canvas_nodes SET source_anchor_json = ? WHERE node_id = ?",
                (json.dumps({**bad, "doc": {**bad["doc"], "paperId": b.paper_id}}), b.root),
            )
            conn.commit()
            conn.close()
            response = h.client.post(
                f"/boards/{b.board_id}/nodes/{b.root}/asks",
                json={"question": "What is this?"},
                headers={**auth(b.token), **SSE},
            )
            assert_envelope(response, 422, "validation_failed")
        assert h.fake.requests == [] and h.count("ai_runs") == 0, "no run was started"


def test_a_huge_finite_quad_is_a_422_not_an_overflow_500(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        token, paper_id, doc = _setup(h)
        for box in ((10.0, 10.0, 1e308, 1e308), (-1e308, 10.0, 50.0, 90.0), (0, 0, 2e6, 50)):
            response = _image(h, token, paper_id, image_anchor(doc, page=1, box=box))
            assert_envelope(response, 422, "validation_failed")
        assert h.count("ai_threads") == h.count("ai_runs") == 0
        assert h.fake.requests == []
        # A box well inside the bound but far off the page is clipped to it, a normal ask.
        clipped = _image(h, token, paper_id, image_anchor(doc, page=1, box=(10.0, 10.0, 9e5, 9e5)))
        assert clipped.status_code == 200, clipped.text
        read_sse(clipped)
