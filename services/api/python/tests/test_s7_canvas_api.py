"""S7: every contracts.md §2.7 route and its errors, on the real app.

Also the three regression tests the slice plan names: ``s7-no-autogen`` (a paper with 30
highlights and 20 threads still has NO board, and a GET writes no row), ``s7-stale-version-409``
and ``s7-group-delete-ungroups`` (the trigger, through HTTP).
"""

from __future__ import annotations

import copy
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any

import pytest
from api_support import Harness, assert_envelope, auth, harness, register, seed_paper
from papertree_db import AnchorIn, PaperId, PaperTreeDb

SLUG = "resnet-cvpr-2col"
CAPTURE = (
    Path(__file__).resolve().parents[4]
    / "packages"
    / "db"
    / "python"
    / "tests"
    / "data"
    / "capture_anchor_resnet.json"
)
TABLES = (
    "canvas_boards",
    "canvas_nodes",
    "canvas_edges",
    "highlights",
    "anchors",
    "ai_threads",
    "ai_messages",
)


def _record() -> dict[str, Any]:
    anchor: dict[str, Any] = json.loads(CAPTURE.read_text(encoding="utf-8"))["anchor"]
    return anchor


def _counts(file: Path) -> dict[str, int]:
    conn = sqlite3.connect(file)
    try:
        return {t: int(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]) for t in TABLES}
    finally:
        conn.close()


def _note(node_id: str, **fields: Any) -> dict[str, Any]:
    return {"node_id": node_id, "kind": "note", "x": 10, "y": 20, "w": 240, "h": 120, **fields}


def _setup(h: Harness, email: str = "alice@example.com") -> tuple[str, str]:
    token = register(h.client, email)
    return token, seed_paper(h.settings, h.client, token, SLUG)


def _first_node(h: Harness, token: str, paper_id: str, **fields: Any) -> tuple[str, dict[str, Any]]:
    made = h.client.post(
        f"/papers/{paper_id}/board/nodes",
        headers=auth(token),
        json=_note(fields.pop("node_id", "cn_firstnode"), **fields),
    )
    assert made.status_code == 201, made.text
    body: dict[str, Any] = made.json()
    return str(body["board"]["board_id"]), body


def test_s7_no_autogen_a_busy_paper_has_no_board(tmp_path: Path) -> None:
    """A paper with 30 highlights and 20 threads: ``GET /board`` -> ``board: null``, 0 nodes, and
    not one row written (counted in sqlite before and after, every canvas AND source table)."""
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        db = PaperTreeDb(h.settings.database_file)
        try:
            owner = db.owner_for(user_id)
            for i in range(30):
                record = _record()
                record["id"] = str(uuid.UUID(int=i + 1))
                db.create_highlight(
                    owner,
                    db_paper(paper_id),
                    highlight_id=f"hl_autogen{i:010d}",
                    color="yellow",
                    note=None,
                    created_generation=1,
                    anchors=[AnchorIn(record)],
                    resolutions=[],
                )
            for i in range(20):
                db.create_thread(
                    owner,
                    db_paper(paper_id),
                    thread_id=f"thr_autogen_{i:010d}",
                    kind="ask",
                    title=f"Question {i}",
                    origin_anchor=None,
                )
        finally:
            db.close()
        before = _counts(h.settings.database_file)
        assert before["highlights"] == 30 and before["ai_threads"] == 20
        for _ in range(3):
            response = h.client.get(f"/papers/{paper_id}/board", headers=auth(token))
            assert response.status_code == 200, response.text
            assert response.json() == {"board": None, "nodes": [], "edges": []}
        assert _counts(h.settings.database_file) == before
        assert before["canvas_boards"] == before["canvas_nodes"] == 0


def db_paper(paper_id: str) -> PaperId:
    return PaperId(paper_id)


def test_get_board_requires_auth_and_a_paper_of_yours(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        assert_envelope(h.client.get(f"/papers/{paper_id}/board"), 401, "auth_required")
        assert_envelope(
            h.client.get("/papers/ppr_nope/board", headers=auth(token)), 404, "not_found"
        )
        bob = register(h.client, "bob@example.com")
        assert_envelope(
            h.client.get(f"/papers/{paper_id}/board", headers=auth(bob)), 404, "not_found"
        )


def test_first_send_creates_the_board_and_a_get_returns_it(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        board_id, body = _first_node(h, token, paper_id, body="hello")
        assert body["board"]["paper_id"] == paper_id and body["board"]["viewport"] is None
        assert body["node"]["version"] == 1 and body["node"]["body"] == "hello"
        assert "owner_id" not in json.dumps(body)
        view = h.client.get(f"/papers/{paper_id}/board", headers=auth(token)).json()
        assert view["board"]["board_id"] == board_id
        assert [n["node_id"] for n in view["nodes"]] == ["cn_firstnode"]
        assert view["edges"] == []


def test_create_node_422s(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        url = f"/papers/{paper_id}/board/nodes"
        missing_anchor = assert_envelope(
            h.client.post(url, headers=auth(token), json=_note("cn_xxxxxxxx", kind="excerpt")),
            422,
            "validation_failed",
        )
        assert missing_anchor["detail"].startswith("source_anchor: ")
        missing_message = assert_envelope(
            h.client.post(url, headers=auth(token), json=_note("cn_xxxxxxxx", kind="explanation")),
            422,
            "validation_failed",
        )
        assert missing_message["detail"].startswith("source_message_id: ")
        foreign = _record()
        foreign["doc"]["paperId"] = "ppr_not_this_one"
        wrong_paper = assert_envelope(
            h.client.post(
                url,
                headers=auth(token),
                json=_note("cn_xxxxxxxx", kind="excerpt", source_anchor=foreign),
            ),
            422,
            "validation_failed",
        )
        assert "not on this paper" in wrong_paper["detail"]
        unknown_answer = assert_envelope(
            h.client.post(
                url,
                headers=auth(token),
                json=_note("cn_xxxxxxxx", kind="explanation", source_message_id="msg_nope"),
            ),
            422,
            "validation_failed",
        )
        assert unknown_answer["detail"].startswith("source_message_id: ")
        assert_envelope(
            h.client.post(url, headers=auth(token), json=_note("cn_xxxxxxxx", w=0)),
            422,
            "validation_failed",
        )
        assert _counts(h.settings.database_file)["canvas_boards"] == 0
        assert_envelope(
            h.client.post(
                "/papers/ppr_nope/board/nodes", headers=auth(token), json=_note("cn_xxxxxxxx")
            ),
            404,
            "not_found",
        )


def test_an_excerpt_round_trips_its_anchor_verbatim(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        record = _record()
        sent = copy.deepcopy(record)
        sent["resolution"] = {"tier": 1}
        made = h.client.post(
            f"/papers/{paper_id}/board/nodes",
            headers=auth(token),
            json=_note("cn_excerpt1", kind="excerpt", source_anchor=sent, body="a quote"),
        )
        assert made.status_code == 201, made.text
        view = h.client.get(f"/papers/{paper_id}/board", headers=auth(token)).json()
        assert view["nodes"][0]["source_anchor"] == record


def test_s7_stale_version_409(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        board_id, _ = _first_node(h, token, paper_id, body="v1")
        url = f"/boards/{board_id}/nodes/cn_firstnode"
        first = h.client.patch(url, headers=auth(token), json={"version": 1, "body": "v2"})
        assert first.status_code == 200 and first.json()["version"] == 2
        stale = h.client.patch(url, headers=auth(token), json={"version": 1, "body": "late"})
        assert stale.status_code == 409, stale.text
        body = stale.json()
        assert body["code"] == "stale_version" and body["retryable"] is False
        assert body["current"]["version"] == 2 and body["current"]["body"] == "v2"
        assert set(body) == {"detail", "code", "retryable", "current"}
        view = h.client.get(f"/papers/{paper_id}/board", headers=auth(token)).json()
        assert view["nodes"][0]["body"] == "v2" and view["nodes"][0]["version"] == 2


def test_patch_node_errors(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        board_id, _ = _first_node(h, token, paper_id)
        url = f"/boards/{board_id}/nodes/cn_firstnode"
        assert_envelope(h.client.patch(url, json={"version": 1}), 401, "auth_required")
        assert_envelope(
            h.client.patch(url, headers=auth(token), json={"x": 1}), 422, "validation_failed"
        )
        for null_field in ("body", "w", "x"):
            refused = assert_envelope(
                h.client.patch(url, headers=auth(token), json={"version": 1, null_field: None}),
                422,
                "validation_failed",
            )
            assert refused["detail"].startswith(f"{null_field}: ")
        assert_envelope(
            h.client.patch(
                f"/boards/{board_id}/nodes/cn_nopenope", headers=auth(token), json={"version": 1}
            ),
            404,
            "not_found",
        )
        assert_envelope(
            h.client.patch(
                "/boards/brd_nope/nodes/cn_firstnode", headers=auth(token), json={"version": 1}
            ),
            404,
            "not_found",
        )
        bad_group = assert_envelope(
            h.client.patch(
                url, headers=auth(token), json={"version": 1, "group_id": "cn_nopenope"}
            ),
            422,
            "validation_failed",
        )
        assert bad_group["detail"].startswith("group_id: ")
        cleared = h.client.patch(url, headers=auth(token), json={"version": 1, "title": None})
        assert cleared.status_code == 200 and cleared.json()["title"] is None


def test_s7_group_delete_ungroups(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        board_id, _ = _first_node(h, token, paper_id, node_id="cn_group001", kind="group")
        nodes_url = f"/papers/{paper_id}/board/nodes"
        for node_id in ("cn_aaaaaaaa", "cn_bbbbbbbb"):
            assert (
                h.client.post(nodes_url, headers=auth(token), json=_note(node_id)).status_code
                == 201
            )
        for node_id in ("cn_aaaaaaaa", "cn_bbbbbbbb"):
            joined = h.client.patch(
                f"/boards/{board_id}/nodes/{node_id}",
                headers=auth(token),
                json={"version": 1, "group_id": "cn_group001"},
            )
            assert joined.status_code == 200 and joined.json()["group_id"] == "cn_group001"
        gone = h.client.delete(f"/boards/{board_id}/nodes/cn_group001", headers=auth(token))
        assert gone.status_code == 204 and gone.content == b""
        view = h.client.get(f"/papers/{paper_id}/board", headers=auth(token)).json()
        assert {n["node_id"]: n["group_id"] for n in view["nodes"]} == {
            "cn_aaaaaaaa": None,
            "cn_bbbbbbbb": None,
        }
        assert_envelope(
            h.client.delete(f"/boards/{board_id}/nodes/cn_group001", headers=auth(token)),
            404,
            "not_found",
        )


def test_edges_end_to_end_and_their_errors(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        board_id, _ = _first_node(h, token, paper_id, node_id="cn_aaaaaaaa")
        h.client.post(
            f"/papers/{paper_id}/board/nodes", headers=auth(token), json=_note("cn_bbbbbbbb")
        )
        url = f"/boards/{board_id}/edges"
        edge = {
            "edge_id": "ce_edge0001",
            "from_node_id": "cn_aaaaaaaa",
            "to_node_id": "cn_bbbbbbbb",
            "kind": "supports",
        }
        assert_envelope(h.client.post(url, json=edge), 401, "auth_required")
        assert_envelope(
            h.client.post(url, headers=auth(token), json={**edge, "to_node_id": "cn_aaaaaaaa"}),
            422,
            "validation_failed",
        )
        elsewhere = assert_envelope(
            h.client.post(url, headers=auth(token), json={**edge, "to_node_id": "cn_zzzzzzzz"}),
            422,
            "validation_failed",
        )
        assert "on this board" in elsewhere["detail"]
        assert_envelope(
            h.client.post(url, headers=auth(token), json={**edge, "kind": "likes"}),
            422,
            "validation_failed",
        )
        assert_envelope(
            h.client.post("/boards/brd_nope/edges", headers=auth(token), json=edge),
            404,
            "not_found",
        )
        made = h.client.post(url, headers=auth(token), json={**edge, "label": "because"})
        assert made.status_code == 201, made.text
        body = made.json()
        assert body.pop("created_at")  # v0.2: the wire carries the edge's age
        assert body == {
            "board_id": board_id,
            "label": "because",
            "from_port": None,  # a v0.1-style edge has no pins
            "to_port": None,
            **edge,
        }
        patched = h.client.patch(
            f"{url}/ce_edge0001", headers=auth(token), json={"kind": "contradicts", "label": None}
        )
        assert patched.status_code == 200
        assert (patched.json()["kind"], patched.json()["label"]) == ("contradicts", None)
        assert_envelope(
            h.client.patch(f"{url}/ce_edge0001", headers=auth(token), json={"kind": None}),
            422,
            "validation_failed",
        )
        assert_envelope(
            h.client.patch(f"{url}/ce_nopenope", headers=auth(token), json={"label": "x"}),
            404,
            "not_found",
        )
        assert h.client.delete(f"{url}/ce_edge0001", headers=auth(token)).status_code == 204
        assert_envelope(
            h.client.delete(f"{url}/ce_edge0001", headers=auth(token)), 404, "not_found"
        )


def test_a_deleted_node_takes_its_edges_with_it(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        board_id, _ = _first_node(h, token, paper_id, node_id="cn_aaaaaaaa")
        h.client.post(
            f"/papers/{paper_id}/board/nodes", headers=auth(token), json=_note("cn_bbbbbbbb")
        )
        h.client.post(
            f"/boards/{board_id}/edges",
            headers=auth(token),
            json={
                "edge_id": "ce_edge0001",
                "from_node_id": "cn_aaaaaaaa",
                "to_node_id": "cn_bbbbbbbb",
                "kind": "answers",
            },
        )
        assert (
            h.client.delete(
                f"/boards/{board_id}/nodes/cn_bbbbbbbb", headers=auth(token)
            ).status_code
            == 204
        )
        view = h.client.get(f"/papers/{paper_id}/board", headers=auth(token)).json()
        assert [n["node_id"] for n in view["nodes"]] == ["cn_aaaaaaaa"] and view["edges"] == []


def test_patch_board(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        board_id, _ = _first_node(h, token, paper_id)
        url = f"/boards/{board_id}"
        assert_envelope(h.client.patch(url, json={"title": "x"}), 401, "auth_required")
        saved = h.client.patch(
            url, headers=auth(token), json={"viewport": {"x": 12.5, "y": -4, "zoom": 0.75}}
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["viewport"] == {"x": 12.5, "y": -4, "zoom": 0.75}
        titled = h.client.patch(url, headers=auth(token), json={"title": "My map"}).json()
        assert titled["title"] == "My map" and titled["viewport"] == {
            "x": 12.5,
            "y": -4,
            "zoom": 0.75,
        }
        view = h.client.get(f"/papers/{paper_id}/board", headers=auth(token)).json()
        assert view["board"]["viewport"] == {"x": 12.5, "y": -4, "zoom": 0.75}
        assert_envelope(
            h.client.patch(url, headers=auth(token), json={"title": None}), 422, "validation_failed"
        )
        assert_envelope(
            h.client.patch(url, headers=auth(token), json={"title": ""}), 422, "validation_failed"
        )
        assert_envelope(
            h.client.patch(
                url, headers=auth(token), json={"viewport": {"x": 1, "y": 1, "zoom": 0}}
            ),
            422,
            "validation_failed",
        )
        cleared = h.client.patch(url, headers=auth(token), json={"viewport": None})
        assert cleared.status_code == 200 and cleared.json()["viewport"] is None
        assert_envelope(
            h.client.patch("/boards/brd_nope", headers=auth(token), json={"title": "x"}),
            404,
            "not_found",
        )


@pytest.mark.parametrize("route", ["node", "edge", "board", "delete"])
def test_another_user_cannot_touch_my_board(route: str, tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        board_id, _ = _first_node(h, token, paper_id, node_id="cn_aaaaaaaa")
        bob = register(h.client, "bob@example.com")
        if route == "node":
            response = h.client.patch(
                f"/boards/{board_id}/nodes/cn_aaaaaaaa",
                headers=auth(bob),
                json={"version": 1, "x": 1},
            )
        elif route == "edge":
            response = h.client.post(
                f"/boards/{board_id}/edges",
                headers=auth(bob),
                json={
                    "edge_id": "ce_xxxxxxxx",
                    "from_node_id": "cn_aaaaaaaa",
                    "to_node_id": "cn_bbbbbbbb",
                    "kind": "relates",
                },
            )
        elif route == "board":
            response = h.client.patch(f"/boards/{board_id}", headers=auth(bob), json={"title": "x"})
        else:
            response = h.client.delete(f"/boards/{board_id}/nodes/cn_aaaaaaaa", headers=auth(bob))
        assert_envelope(response, 404, "not_found")
        view = h.client.get(f"/papers/{paper_id}/board", headers=auth(token)).json()
        assert view["nodes"][0]["x"] == 10 and view["board"]["title"] == "Canvas"


def test_canvas_size_limits_422_and_name_the_field(tmp_path: Path) -> None:
    """W2UI (#141): a card is not a document store. Oversized text, absurd coordinates and a
    runaway zoom are refused with a 422 that names the field, and nothing is written."""
    with harness(tmp_path) as h:
        token, paper_id = _setup(h)
        url = f"/papers/{paper_id}/board/nodes"
        board_id, _ = _first_node(h, token, paper_id)

        def refused(response: Any, field: str) -> None:
            envelope = assert_envelope(response, 422, "validation_failed")
            assert envelope["detail"].startswith(f"{field}: "), envelope["detail"]

        refused(
            h.client.post(url, headers=auth(token), json=_note("cn_bigbody01", body="x" * 20_001)),
            "body",
        )
        refused(
            h.client.post(url, headers=auth(token), json=_note("cn_bigtitle1", title="t" * 201)),
            "title",
        )
        refused(
            h.client.post(url, headers=auth(token), json=_note("cn_bigcoord1", x=1_000_001)), "x"
        )
        refused(h.client.post(url, headers=auth(token), json=_note("cn_bigcoord2", y=-1e7)), "y")
        refused(h.client.post(url, headers=auth(token), json=_note("cn_bigwidth1", w=100_001)), "w")
        huge = h.client.post(
            url,
            headers={**auth(token), "content-type": "application/json"},
            content='{"node_id":"cn_hugecoord","kind":"note","x":1e308,"y":0,"w":240,"h":120}',
        )
        refused(huge, "x")
        # The limits themselves are allowed.
        at_limit = h.client.post(
            url,
            headers=auth(token),
            json=_note(
                "cn_atlimit001",
                x=1_000_000,
                y=-1_000_000,
                w=100_000,
                h=1,
                body="x" * 20_000,
                title="t" * 200,
            ),
        )
        assert at_limit.status_code == 201, at_limit.text

        node_url = f"/boards/{board_id}/nodes/cn_firstnode"
        refused(
            h.client.patch(
                node_url, headers=auth(token), json={"version": 1, "body": "x" * 20_001}
            ),
            "body",
        )
        refused(h.client.patch(node_url, headers=auth(token), json={"version": 1, "x": 1e300}), "x")

        other = h.client.post(url, headers=auth(token), json=_note("cn_othernode1", x=300)).json()[
            "node"
        ]["node_id"]
        edges = f"/boards/{board_id}/edges"
        refused(
            h.client.post(
                edges,
                headers=auth(token),
                json={
                    "edge_id": "ce_biglabel01",
                    "from_node_id": "cn_firstnode",
                    "to_node_id": other,
                    "kind": "relates",
                    "label": "l" * 100_000,
                },
            ),
            "label",
        )
        for bad in (
            {"x": 1e300, "y": 0, "zoom": 1},
            {"x": 0, "y": 0, "zoom": 0.01},
            {"x": 0, "y": 0, "zoom": 9},
        ):
            response = h.client.patch(
                f"/boards/{board_id}", headers=auth(token), json={"viewport": bad}
            )
            refused(response, "viewport.x" if bad["x"] > 1e6 else "viewport.zoom")
        ok = h.client.patch(
            f"/boards/{board_id}",
            headers=auth(token),
            json={"viewport": {"x": 1_000_000, "y": -1_000_000, "zoom": 8}},
        )
        assert ok.status_code == 200, ok.text
        counts = _counts(h.settings.database_file)
        assert counts["canvas_nodes"] == 3 and counts["canvas_edges"] == 0
