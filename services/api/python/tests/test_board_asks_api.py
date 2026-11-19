"""v0.3 (#343): the branching board's API: asks on a card, keep as note, Tidy, subtree delete.

Spec: ``v03-BOARD-SPEC.md`` §1 (the rules marked S), §2, §3. The agent is the contract replayer
(``FakeAgent``); every request the API sends it is held to ``run-request.schema.json`` and the
pydantic model (``h.fake.contract_errors == []``).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from ai_support import (
    AiHarness,
    ai_harness,
    alice_with_paper,
    contract_errors,
    events,
    paragraph_anchor,
    read_sse,
)
from api_support import assert_envelope, auth, register
from fake_agent import RunContext, Script
from papertree_api import board_path
from papertree_api.schemas import CanvasNode

SSE = {"Accept": "text/event-stream"}


def _answer(context: RunContext) -> str:
    asked = str(context.body["question"]).split("\n")[0][:40]
    return (
        f"## TL;DR\nShort version of {asked}.\n\n"
        "## In plain words\nResidual blocks add the input back.\n\n"
        "## How it works\nThe block outputs the sum [b1].\n\n"
        "## In the paper\nThe paper says so [b1]."
    )


def _script() -> Script:
    return Script("followup-ok", call_tools=False, final_text=_answer)


class Board:
    """A board with one root passage, driven through HTTP."""

    def __init__(self, h: AiHarness, token: str, paper_id: str) -> None:
        self.h, self.token, self.paper_id = h, token, paper_id
        self.root = self.add_root("cn_rootpassage1", nth=3)
        made = h.client.get(f"/papers/{paper_id}/board", headers=auth(token)).json()
        self.board_id: str = made["board"]["board_id"]

    def add_root(self, node_id: str, *, nth: int) -> str:
        made = self.h.client.post(
            f"/papers/{self.paper_id}/board/nodes",
            json={
                "node_id": node_id,
                "kind": "excerpt",
                "x": 0,
                "y": 0,
                "w": 320,
                "h": 160,
                "source_anchor": paragraph_anchor(nth=nth),
            },
            headers=auth(self.token),
        )
        assert made.status_code == 201, made.text
        return node_id

    def ask(self, node_id: str, **body: Any) -> tuple[list[Any], dict[str, Any]]:
        response = self.h.client.post(
            f"/boards/{self.board_id}/nodes/{node_id}/asks",
            json=body,
            headers={**auth(self.token), **SSE},
        )
        frames, _ = read_sse(response)
        node = events(frames, "node")[0]
        return frames, node

    def ask_raw(self, node_id: str, **body: Any) -> Any:
        return self.h.client.post(
            f"/boards/{self.board_id}/nodes/{node_id}/asks",
            json=body,
            headers={**auth(self.token), **SSE},
        )

    def nodes(self) -> dict[str, dict[str, Any]]:
        body = self.h.client.get(f"/papers/{self.paper_id}/board", headers=auth(self.token)).json()
        return {n["node_id"]: n for n in body["nodes"]}


def _setup(h: AiHarness) -> Board:
    token, paper_id = alice_with_paper(h)
    return Board(h, token, paper_id)


def _sql(h: AiHarness, sql: str, *params: Any) -> None:
    conn = sqlite3.connect(h.settings.database_file)
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def test_an_ask_on_a_passage_streams_the_node_first_and_is_a_right_branch(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        frames, node = b.ask(b.root, question="Why does this help?")
        assert [f.event for f in frames][:2] == ["node", "run"]
        assert frames[-1].event == "done" and frames[-1].data["status"] == "complete"
        assert "text" in {f.event for f in frames} and "usage" in {f.event for f in frames}
        assert (node["parent_id"], node["branch"], node["parent_span"]) == (b.root, "right", None)
        assert node["kind"] == "explanation" and node["question"] == "Why does this help?"
        assert node["source_message_id"] == events(frames, "run")[0]["message_id"]
        assert contract_errors(node, "api/sse.schema.json", "CanvasNode", CanvasNode) == []
        request = h.fake.requests[0]
        assert h.fake.contract_errors == []
        assert (request["kind"], request["check"], request["history"]) == ("ask", False, None)
        stored = b.nodes()[node["node_id"]]
        assert stored["final_text"].startswith("## TL;DR")
        assert (stored["level"], stored["answer_status"]) == ("familiar", "complete")
        assert stored["model"]
        assert stored["uses"]["paper"] == "page" and stored["uses"]["path"] is True


def test_down_exists_only_under_an_answer_then_every_other_ask_is_right(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        # Passage: always right, however many times.
        _, first = b.ask(b.root, question="First?")
        _, second = b.ask(b.root, question="Second?")
        assert (first["branch"], second["branch"]) == ("right", "right")
        answer = first["node_id"]
        # Answer: the first plain ask is down, the next is right.
        _, down = b.ask(answer, question="Follow up?")
        _, again = b.ask(answer, question="Another follow up?")
        assert (down["branch"], again["branch"]) == ("down", "right")
        # "Ask differently" is right even where a down slot is free.
        _, fresh = b.ask(second["node_id"], question="Q?", ask_differently=True)
        assert fresh["branch"] == "right"
        # A span ask is right and stores its words.
        text = b.nodes()[second["node_id"]]["final_text"]
        quote = "Residual blocks"
        start = text.index(quote)
        span = {"start": start, "end": start + len(quote), "quote": quote}
        _, spanned = b.ask(second["node_id"], question="What is a residual?", span=span)
        assert (spanned["branch"], spanned["parent_span"]) == ("right", span)


def test_the_down_slot_is_taken_so_a_second_down_is_refused_by_the_store(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        _, answer = b.ask(b.root, question="First?")
        _, down = b.ask(answer["node_id"], question="Follow up?")
        assert down["branch"] == "down"

        def create(node_id: str, parent: str, branch: str) -> Any:
            return h.client.post(
                f"/papers/{b.paper_id}/board/nodes",
                json={
                    "node_id": node_id,
                    "kind": "note",
                    "x": 0,
                    "y": 0,
                    "w": 200,
                    "h": 100,
                    "parent_id": parent,
                    "branch": branch,
                },
                headers=auth(b.token),
            )

        assert_envelope(
            create("cn_secondnote01", answer["node_id"], "down"), 422, "validation_failed"
        )
        assert_envelope(create("cn_thirdnote001", b.root, "down"), 422, "validation_failed")
        assert create("cn_okaynote0001", answer["node_id"], "right").status_code == 201


def test_a_span_must_be_the_words_at_its_offsets_of_the_parents_answer(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        _, answer = b.ask(b.root, question="First?")
        text = b.nodes()[answer["node_id"]]["final_text"]
        start = text.index("Residual")
        good = {"start": start, "end": start + 8, "quote": "Residual"}
        for bad in (
            {**good, "quote": "Residuel"},  # not the words there
            {**good, "end": len(text) + 5},  # past the end
            {"start": 4, "end": 4, "quote": "x"},  # empty
        ):
            response = b.ask_raw(answer["node_id"], question="Q?", span=bad)
            assert response.status_code == 422, bad
        assert b.ask_raw(answer["node_id"], question="Q?", span=good).status_code == 200
        # The same rule on Keep as note.
        noted = h.client.post(
            f"/boards/{b.board_id}/nodes/{answer['node_id']}/notes",
            json={"span": {**good, "quote": "Nope"}, "text": "x"},
            headers=auth(b.token),
        )
        assert_envelope(noted, 422, "validation_failed")


def test_the_span_offsets_count_utf16_code_units(tmp_path: Path) -> None:
    def astral(context: RunContext) -> str:
        return "## TL;DR\nA \U0001d4e7 mark and a word.\n"

    with ai_harness(tmp_path, Script("followup-ok", call_tools=False, final_text=astral)) as h:
        b = _setup(h)
        _, answer = b.ask(b.root, question="First?")
        text = b.nodes()[answer["node_id"]]["final_text"]
        python_start = text.index("word")
        units = python_start + 1  # the astral character is two UTF-16 units
        span = {"start": units, "end": units + 4, "quote": "word"}
        assert b.ask_raw(answer["node_id"], question="Q?", span=span).status_code == 200
        wrong = {"start": python_start, "end": python_start + 4, "quote": "word"}
        assert b.ask_raw(answer["node_id"], question="Q?", span=wrong).status_code == 422


def test_an_answer_with_branches_is_frozen_so_a_retry_makes_a_right_sibling(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        _, answer = b.ask(b.root, question="First?")
        _, child = b.ask(answer["node_id"], question="Follow up?")
        before = b.nodes()
        _sql(
            h,
            "UPDATE ai_messages SET status = 'error' WHERE message_id = ?",
            answer["source_message_id"],
        )
        _, sibling = b.ask(b.root, redo_of=answer["node_id"], level="expert")
        after = b.nodes()
        assert sibling["node_id"] not in before and sibling["node_id"] != answer["node_id"]
        assert (sibling["parent_id"], sibling["branch"]) == (b.root, "right")
        assert sibling["question"] == "First?" and sibling["uses"]["level"] == "expert"
        # The frozen answer is untouched: same message, same version, its child still there.
        assert after[answer["node_id"]]["source_message_id"] == answer["source_message_id"]
        assert after[answer["node_id"]]["version"] == before[answer["node_id"]]["version"]
        assert after[child["node_id"]]["parent_id"] == answer["node_id"]


def test_a_failed_answer_with_no_branches_is_replaced_in_place(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        _, answer = b.ask(b.root, question="First?")
        before = b.nodes()[answer["node_id"]]
        # A complete answer is never rewritten: its redo is a sibling.
        _, sibling = b.ask(b.root, redo_of=answer["node_id"])
        assert sibling["node_id"] != answer["node_id"]
        _sql(
            h,
            "UPDATE ai_messages SET status = 'error' WHERE message_id = ?",
            answer["source_message_id"],
        )
        count = len(b.nodes())
        frames, replaced = b.ask(b.root, redo_of=answer["node_id"])
        assert replaced["node_id"] == answer["node_id"] and len(b.nodes()) == count
        assert replaced["source_message_id"] != answer["source_message_id"]
        assert replaced["version"] == before["version"] + 1
        assert (replaced["parent_id"], replaced["branch"]) == (
            before["parent_id"],
            before["branch"],
        )
        assert frames[-1].data["status"] == "complete"


def test_the_agent_gets_the_path_not_the_siblings_and_the_depth_rule(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        _, a1 = b.ask(b.root, question="Question one?")
        _, a2 = b.ask(a1["node_id"], question="Question two?")  # down
        _, side = b.ask(a2["node_id"], question="A side question?", ask_differently=True)  # right
        _, a3 = b.ask(a2["node_id"], question="Question three?")  # down: the slot is free
        assert (a2["branch"], side["branch"], a3["branch"]) == ("down", "right", "down")
        _, a4 = b.ask(a3["node_id"], question="Question four?")
        h.fake.requests.clear()
        note = h.client.post(
            f"/boards/{b.board_id}/nodes/{a4['node_id']}/notes",
            json={"span": _span(b, a4["node_id"], "Residual blocks"), "text": "my note body"},
            headers=auth(b.token),
        ).json()
        b.ask(
            a4["node_id"],
            question="Question five?",
            uses={"paper": "whole", "extra_node_ids": [note["node_id"]]},
        )
        request = h.fake.requests[0]
        assert h.fake.contract_errors == []
        entries = request["history"]["entries"]
        users = [
            e["message"]["content"][0]["text"] for e in entries if e["message"]["role"] == "user"
        ]
        answers = [
            e["message"]["content"][0]["text"]
            for e in entries
            if e["message"]["role"] == "assistant"
        ]
        # Path: a1 (root's child), a2, a3, a4 — the sibling `side` is not in it.
        assert [u.split("\n")[0] for u in users] == [
            "Question one?",
            "Question two?",
            "Question three?",
            "Question four?",
        ]
        assert "A side question?" not in str(entries)
        assert "<untrusted_document" in users[0]  # the root passage rides in the first turn
        # Parent (a4) and grandparent (a3) in full; a2 and a1 as their TL;DR line only.
        assert answers[3].startswith("## TL;DR") and "## In the paper" in answers[3]
        assert "## In the paper" in answers[2]
        assert all(
            "## In the paper" not in older and "## How it works" not in older
            for older in answers[:2]
        )
        assert answers[0].startswith("Short version of Question one")
        assert "[b" not in str(answers)  # handles of other runs never ride along
        # The attached card is in the question; the chain links are well formed.
        assert "my note body" in request["question"] and request["question"].startswith(
            "Question five?"
        )
        parents = [e["parentId"] for e in entries]
        assert parents == [None, *[e["id"] for e in entries[:-1]]]
        assert request["limits"]["max_tool_calls"] == 8  # `whole`: tools on


def _span(b: Board, node_id: str, quote: str) -> dict[str, Any]:
    text = b.nodes()[node_id]["final_text"]
    start = text.index(quote)
    return {"start": start, "end": start + len(quote), "quote": quote}


def test_a_span_ask_names_the_selected_words_to_the_agent(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        _, answer = b.ask(b.root, question="First?")
        b.ask(
            answer["node_id"],
            question="What does that mean?",
            span=_span(b, answer["node_id"], "Residual blocks"),
        )
        request = h.fake.requests[-1]
        assert request["question"].startswith("What does that mean?")
        assert '"Residual blocks"' in request["question"]


def test_uses_paper_changes_the_seed_and_the_tools(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        for mode in ("page", "whole", "off"):
            b.ask(b.root, question=f"About {mode}?", uses={"paper": mode})
        page, whole, off = h.fake.requests
        assert h.fake.contract_errors == []
        assert (page["limits"]["max_tool_calls"], whole["limits"]["max_tool_calls"]) == (0, 8)
        assert off["limits"]["max_tool_calls"] == 0
        assert len(off["seed"]["passages"]) == 0 and off["seed"]["quote"]
        assert len(page["seed"]["passages"]) > len(whole["seed"]["passages"]) > 0
        first = [
            r["seed"]["passages"][0]["text"].split("\n", 1)[1].rsplit("\n", 1)[0]
            for r in (page, whole)
        ]
        assert first[0] == first[1]  # both open with the selected passage


def test_quick_asks_set_the_question_level_and_diagram(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        _, simpler = b.ask(b.root, quick="simpler", uses={"level": "expert"})
        _, example = b.ask(b.root, quick="example")
        _, diagram = b.ask(b.root, quick="diagram")
        assert simpler["question"] == "Explain this more simply."
        assert example["question"] == "Give me a concrete example of this."
        assert diagram["question"] == "Draw this as a small diagram."
        first, second, third = h.fake.requests
        assert (first["level"], first["diagram"]) == ("new", "may")
        assert (second["level"], second["diagram"]) == ("familiar", "may")
        assert third["diagram"] == "always"
        assert all(r["check"] is False for r in h.fake.requests)
        assert simpler["uses"]["level"] == "new" and diagram["uses"]["diagram"] == "always"


def test_keep_as_note_makes_no_agent_call(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        _, answer = b.ask(b.root, question="First?")
        calls, runs = len(h.fake.requests), h.count("ai_runs")
        span = _span(b, answer["node_id"], "input back")
        made = h.client.post(
            f"/boards/{b.board_id}/nodes/{answer['node_id']}/notes",
            json={"span": span, "text": "Remember this"},
            headers=auth(b.token),
        )
        assert made.status_code == 201, made.text
        note = made.json()
        assert (note["kind"], note["branch"], note["parent_id"]) == (
            "note",
            "right",
            answer["node_id"],
        )
        assert (note["body"], note["parent_span"]) == ("Remember this", span)
        assert contract_errors(note, "api/sse.schema.json", "CanvasNode", CanvasNode) == []
        assert (len(h.fake.requests), h.count("ai_runs")) == (calls, runs)
        # A note is not asked about, and has no words of its own to branch from.
        assert b.ask_raw(note["node_id"], question="Q?").status_code == 422


def test_tidy_zeroes_the_offsets_of_one_tree_only(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        other_root = b.add_root("cn_rootpassage2", nth=4)
        _, a1 = b.ask(b.root, question="One?")
        _, a2 = b.ask(a1["node_id"], question="Two?")
        _, other = b.ask(other_root, question="Elsewhere?")
        loose = h.client.post(
            f"/papers/{b.paper_id}/board/nodes",
            json={"node_id": "cn_loosenote001", "kind": "note", "x": 5, "y": 5, "w": 100, "h": 60},
            headers=auth(b.token),
        ).json()["node"]
        ids = [b.root, a1["node_id"], a2["node_id"], other_root, other["node_id"], loose["node_id"]]
        for node_id in ids:
            version = b.nodes()[node_id]["version"]
            patched = h.client.patch(
                f"/boards/{b.board_id}/nodes/{node_id}",
                json={"version": version, "offset_x": 30, "offset_y": -12, "folded": True},
                headers=auth(b.token),
            )
            assert patched.status_code == 200, patched.text
            assert (patched.json()["offset_x"], patched.json()["folded"]) == (30, True)
        before = b.nodes()
        tidied = h.client.post(
            f"/boards/{b.board_id}/tidy", json={"root_id": a2["node_id"]}, headers=auth(b.token)
        )
        assert tidied.status_code == 200, tidied.text
        returned = {n["node_id"]: n for n in tidied.json()["nodes"]}
        assert set(returned) == {b.root, a1["node_id"], a2["node_id"]}
        after = b.nodes()
        for node_id in (b.root, a1["node_id"], a2["node_id"]):
            assert (after[node_id]["offset_x"], after[node_id]["offset_y"]) == (0, 0)
            assert after[node_id]["version"] == before[node_id]["version"] + 1
            assert returned[node_id]["version"] == after[node_id]["version"]
        for node_id in (other_root, other["node_id"], loose["node_id"]):
            assert after[node_id] == before[node_id]
        assert_envelope(
            h.client.post(
                f"/boards/{b.board_id}/tidy",
                json={"root_id": "cn_nonexistent1"},
                headers=auth(b.token),
            ),
            404,
            "not_found",
        )


def test_deleting_a_node_deletes_its_subtree_and_an_undo_can_put_it_back(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        _, a1 = b.ask(b.root, question="One?")
        _, a2 = b.ask(a1["node_id"], question="Two?")
        _, a3 = b.ask(a2["node_id"], question="Three?")
        _, keep = b.ask(b.root, question="Kept?")
        before = b.nodes()
        gone = h.client.delete(f"/boards/{b.board_id}/nodes/{a1['node_id']}", headers=auth(b.token))
        assert gone.status_code == 204
        assert set(b.nodes()) == {b.root, keep["node_id"]}
        # Undo: the web puts each card back, parents first, with the same source message.
        for node_id in (a1["node_id"], a2["node_id"], a3["node_id"]):
            node = before[node_id]
            body = {
                k: node[k]
                for k in (
                    "node_id",
                    "kind",
                    "x",
                    "y",
                    "w",
                    "h",
                    "source_message_id",
                    "parent_id",
                    "branch",
                    "parent_span",
                    "question",
                    "uses",
                    "offset_x",
                    "offset_y",
                    "folded",
                )  # fmt: skip
                if node[k] is not None
            }
            restored = h.client.post(
                f"/papers/{b.paper_id}/board/nodes", json=body, headers=auth(b.token)
            )
            assert restored.status_code == 201, restored.text
        after = b.nodes()
        for node_id in (a1["node_id"], a2["node_id"], a3["node_id"]):
            for key in ("parent_id", "branch", "question", "source_message_id", "final_text"):
                assert after[node_id][key] == before[node_id][key], (node_id, key)
        assert (
            h.client.delete(
                f"/boards/{b.board_id}/nodes/cn_nothingthere1", headers=auth(b.token)
            ).status_code
            == 404
        )


def test_another_users_board_and_nodes_are_not_found(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        _, answer = b.ask(b.root, question="First?")
        bob = register(h.client, "bob@example.com")
        mine = auth(bob)
        span = _span(b, answer["node_id"], "input back")
        for response in (
            h.client.post(
                f"/boards/{b.board_id}/nodes/{answer['node_id']}/asks",
                json={"question": "Q?"},
                headers={**mine, **SSE},
            ),
            h.client.post(
                f"/boards/{b.board_id}/nodes/{answer['node_id']}/notes",
                json={"span": span, "text": "x"},
                headers=mine,
            ),
            h.client.post(f"/boards/{b.board_id}/tidy", json={"root_id": b.root}, headers=mine),
            h.client.delete(f"/boards/{b.board_id}/nodes/{answer['node_id']}", headers=mine),
        ):
            assert_envelope(response, 404, "not_found")
        # And the owner's own board with a node that is not on it.
        assert_envelope(
            h.client.post(
                f"/boards/{b.board_id}/nodes/cn_nothingthere1/asks",
                json={"question": "Q?"},
                headers={**auth(b.token), **SSE},
            ),
            404,
            "not_found",
        )
        assert answer["node_id"] in b.nodes()  # nothing of the owner's was touched


def test_a_board_ask_counts_as_an_ask_and_obeys_the_daily_cap(tmp_path: Path) -> None:
    with ai_harness(tmp_path, _script()) as h:
        b = _setup(h)
        b.ask(b.root, question="First?")
        usage = h.client.get("/usage", headers=auth(b.token)).json()
        assert usage["by_kind"]["ask"]["runs"] == 1 and usage["runs"] == 1
    with ai_harness(tmp_path / "capped", _script(), budget_usd=0.0) as h:
        b = _setup(h)
        threads, nodes = h.count("ai_threads"), h.count("canvas_nodes")
        assert_envelope(b.ask_raw(b.root, question="First?"), 429, "budget_exhausted")
        assert (h.count("ai_threads"), h.count("canvas_nodes")) == (threads, nodes)
        assert h.fake.requests == []


def test_a_refused_agent_leaves_no_card_behind(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("followup-ok", status=503)) as h:
        b = _setup(h)
        threads, nodes = h.count("ai_threads"), h.count("canvas_nodes")
        assert b.ask_raw(b.root, question="First?").status_code >= 400
        assert (h.count("ai_threads"), h.count("canvas_nodes")) == (threads, nodes)


# ── the path, as pure functions ──────────────────────────────────────────────────────────────


def test_tldr_is_the_tldr_section_else_the_first_sentence() -> None:
    assert board_path.tldr("## TL;DR\nOne idea [b2]. Two.\n\n## How\nx") == "One idea. Two."
    assert board_path.tldr("First sentence here. Second one.") == "First sentence here."
    assert board_path.tldr("## How it works\nOnly this.") == "Only this."


def test_unmarked_drops_handles_diagram_and_check_fences_but_keeps_the_markdown() -> None:
    text = (
        '## TL;DR\nA [b1] idea.\n\n```diagram\n{"t":"plate"}\n```\n\n$$y=x$$\n\n'
        "```check\nprompt: a\n```\n"
    )
    out = board_path.unmarked(text)
    assert "[b1]" not in out and "diagram" not in out and "check" not in out
    assert out.startswith("## TL;DR\nA idea.") and "$$y=x$$" in out
