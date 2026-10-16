"""S6a (#211): the board's v0.2 wire - new card kinds, typed pins, notebook counts, frames.

The v0.1 contract stays in ``test_s7_canvas_api.py``; this file holds only what v0.2 adds.
"""

from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Any

from api_support import Harness, assert_envelope, auth, harness, register, seed_paper

SLUG = "resnet-cvpr-2col"
PIN_SENTENCE = "that pin does not take that thread"


def _node(node_id: str, kind: str = "note", **fields: Any) -> dict[str, Any]:
    return {"node_id": node_id, "kind": kind, "x": 10, "y": 20, "w": 240, "h": 120, **fields}


def _send(h: Harness, token: str, paper_id: str, node: dict[str, Any]) -> Any:
    return h.client.post(f"/papers/{paper_id}/board/nodes", headers=auth(token), json=node)


def test_new_kinds_round_trip_and_the_board_returns_them(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, SLUG)
        sent = [
            _node("cn_frame001", "group", title="Why attention only", w=600, h=400),
            _node("cn_quest001", "question", body="Why scale by sqrt(d)?"),
            _node("cn_notebk01", "notebook", source_page_id="pg_unchecked"),
            _node("cn_diagrm01", "diagram", source_diagram_id="dg_unchecked"),
        ]
        for node in sent:
            made = _send(h, token, paper_id, node)
            assert made.status_code == 201, made.text
        board = h.client.get(f"/papers/{paper_id}/board", headers=auth(token)).json()
        by_id = {n["node_id"]: n for n in board["nodes"]}
        assert [by_id[n["node_id"]]["kind"] for n in sent] == [n["kind"] for n in sent]
        assert by_id["cn_notebk01"]["source_page_id"] == "pg_unchecked"
        assert by_id["cn_notebk01"]["counts"] == {
            "quotes": 0, "stickies": 0, "text": 0, "shapes": 0, "strokes": 0,
        }  # fmt: skip
        assert by_id["cn_diagrm01"]["source_diagram_id"] == "dg_unchecked"
        assert by_id["cn_quest001"]["counts"] is None
        # A frame is a group: empty, titled, and moving it touches no other row.
        patched = h.client.patch(
            f"/boards/{board['board']['board_id']}/nodes/cn_frame001",
            headers=auth(token),
            json={"version": 1, "x": 99},
        )
        assert patched.status_code == 200 and patched.json()["x"] == 99
        assert all(
            n["version"] == 1 for n in h.client.get(
                f"/papers/{paper_id}/board", headers=auth(token)
            ).json()["nodes"] if n["node_id"] != "cn_frame001"
        )  # fmt: skip


def test_notebook_and_diagram_cards_need_their_pointer(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, SLUG)
        for kind in ("notebook", "diagram"):
            assert_envelope(
                _send(h, token, paper_id, _node("cn_nopointer", kind)), 422, "validation_failed"
            )
        assert_envelope(
            _send(h, token, paper_id, _node("cn_stray0001", "note", source_page_id="pg_1")),
            422,
            "validation_failed",
        )


def test_pins_are_checked_and_ports_come_back(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, SLUG)
        board_id = ""
        for node in (_node("cn_note00001"), _node("cn_quest0001", "question")):
            board_id = _send(h, token, paper_id, node).json()["board"]["board_id"]
        url = f"/boards/{board_id}/edges"

        def edge(edge_id: str, a: str, b: str, **ports: Any) -> Any:
            body = {"edge_id": edge_id, "from_node_id": a, "to_node_id": b, "kind": "supports"}
            return h.client.post(url, headers=auth(token), json={**body, **ports})

        ok = edge("ce_ok000001", "cn_note00001", "cn_quest0001", from_port="claim_out",
                  to_port="evidence_in")  # fmt: skip
        assert ok.status_code == 201, ok.text
        assert (ok.json()["from_port"], ok.json()["to_port"]) == ("claim_out", "evidence_in")
        assert ok.json()["created_at"]
        # A question offers no out-pin; a note takes no question pin.
        no_out = edge("ce_bad00001", "cn_quest0001", "cn_note00001", from_port="claim_out")
        assert_envelope(no_out, 422, "validation_failed")
        assert PIN_SENTENCE in no_out.json()["detail"]
        assert_envelope(
            edge("ce_bad00002", "cn_note00001", "cn_note00001x", to_port="evidence_in"),
            422,
            "validation_failed",
        )
        no_in = edge("ce_bad00003", "cn_quest0001", "cn_note00001", to_port="question_in")
        assert PIN_SENTENCE in no_in.json()["detail"]
        # An unknown pin name is refused by the schema; no ports at all stays legal.
        assert (
            edge("ce_bad00004", "cn_note00001", "cn_quest0001", to_port="bogus").status_code == 422
        )
        plain = edge("ce_plain001", "cn_quest0001", "cn_note00001")
        assert plain.status_code == 201 and plain.json()["from_port"] is None


def test_a_500_card_board_answers_in_one_request(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, SLUG)
        for i in range(500):
            kind = "notebook" if i % 50 == 0 else "note"
            extra = {"source_page_id": f"pg_{i}"} if kind == "notebook" else {}
            made = _send(h, token, paper_id, _node(f"cn_bulk{i:05d}", kind, x=i, **extra))
            assert made.status_code == 201
        started = time.perf_counter()
        board = h.client.get(f"/papers/{paper_id}/board", headers=auth(token))
        elapsed_ms = (time.perf_counter() - started) * 1000
        load = subprocess.run(["uptime"], capture_output=True, text=True, check=False).stdout
        print(f"500-card board GET: {elapsed_ms:.0f} ms; {load.strip()}")
        assert board.status_code == 200 and len(board.json()["nodes"]) == 500
        assert elapsed_ms < 1000
