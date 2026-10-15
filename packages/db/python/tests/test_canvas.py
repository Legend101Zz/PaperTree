"""``papertree_db.canvas`` (S7): the per-paper board as rows.

The rules under test: a board exists only after a send; the first ``create_node`` creates it in the
same transaction; ``patch_node`` is optimistic (stale -> ``StaleVersion`` carrying the current node,
nothing written); deleting a group ungroups its members (the trigger, measured here on a real copy
of the schema); deleting a node deletes its edges; everything is owner-scoped.
"""

from __future__ import annotations

import copy
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from papertree_db import (
    CanvasRejected,
    NodeRow,
    OwnerId,
    PaperId,
    PaperNotFound,
    PaperTreeDb,
    StaleVersion,
    generation,
    open_database,
)

from .saved_shapes import load_capture_anchor, load_fixture_paper


@dataclass(frozen=True, slots=True)
class Env:
    db: PaperTreeDb
    owner: OwnerId
    paper_id: PaperId
    file: Path
    anchor: dict[str, Any]


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    file = tmp_path / "canvas.sqlite"
    db = open_database(file)
    db.migrate()
    owner = db.create_user("reader@papertree.test").owner
    document = load_fixture_paper()
    db.put_paper(owner, document)
    paper_id = PaperId(document["paper_id"])
    db.promote_generation(owner, paper_id, generation(1))
    yield Env(db, owner, paper_id, file, load_capture_anchor())
    db.close()


def _note(node_id: str, **fields: Any) -> dict[str, Any]:
    return {"node_id": node_id, "kind": "note", "x": 10, "y": 20, "w": 240, "h": 120, **fields}


def _count(file: Path, table: str) -> int:
    conn = sqlite3.connect(file)
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    finally:
        conn.close()


def _node(env: Env, node_id: str) -> NodeRow:
    snapshot = env.db.get_board(env.owner, env.paper_id)
    return next(n for n in snapshot.nodes if n.node_id == node_id)


def test_get_board_is_empty_and_writes_nothing(env: Env) -> None:
    snapshot = env.db.get_board(env.owner, env.paper_id)
    assert snapshot.board is None and snapshot.nodes == () and snapshot.edges == ()
    assert _count(env.file, "canvas_boards") == 0


def test_the_first_node_creates_the_board_in_the_same_transaction(env: Env) -> None:
    node = env.db.create_node(env.owner, env.paper_id, _note("cn_one", body="hello"))
    assert node.version == 1 and node.body == "hello" and node.z == 0
    snapshot = env.db.get_board(env.owner, env.paper_id)
    assert snapshot.board is not None and snapshot.board.board_id == node.board_id
    assert snapshot.board.viewport is None
    second = env.db.create_node(env.owner, env.paper_id, _note("cn_two"))
    assert second.board_id == node.board_id and _count(env.file, "canvas_boards") == 1


def test_a_refused_first_node_leaves_no_board(env: Env) -> None:
    """The board and the node are one transaction: a node the store refuses leaves no board."""
    with pytest.raises(CanvasRejected):
        env.db.create_node(env.owner, env.paper_id, _note("cn_bad", group_id="cn_nope"))
    assert _count(env.file, "canvas_boards") == 0
    assert _count(env.file, "canvas_nodes") == 0


def test_create_node_is_idempotent_on_node_id(env: Env) -> None:
    a = env.db.create_node(env.owner, env.paper_id, _note("cn_one"))
    b = env.db.create_node(env.owner, env.paper_id, _note("cn_one", body="different"))
    assert a == b and _count(env.file, "canvas_nodes") == 1


def test_an_excerpt_stores_the_anchor_verbatim_and_strips_the_cache(env: Env) -> None:
    sent = copy.deepcopy(env.anchor)
    sent["resolution"] = {"tier": 1}
    node = env.db.create_node(
        env.owner,
        env.paper_id,
        {"node_id": "cn_ex", "kind": "excerpt", "x": 0, "y": 0, "w": 300, "h": 160,
         "body": "quote", "source_anchor": sent},
    )  # fmt: skip
    assert node.source_anchor is not None and "resolution" not in node.source_anchor
    expected = {k: v for k, v in env.anchor.items() if k != "resolution"}
    assert dict(node.source_anchor) == expected


def test_an_excerpt_on_another_paper_is_refused(env: Env) -> None:
    foreign = copy.deepcopy(env.anchor)
    foreign["doc"]["paperId"] = "ppr_someone_elses_paper"
    with pytest.raises(CanvasRejected, match="not on this paper"):
        env.db.create_node(
            env.owner,
            env.paper_id,
            {"node_id": "cn_ex", "kind": "excerpt", "x": 0, "y": 0, "w": 300, "h": 160,
             "source_anchor": foreign},
        )  # fmt: skip
    assert _count(env.file, "canvas_boards") == 0


def test_an_explanation_must_point_at_an_assistant_answer_on_this_paper(env: Env) -> None:
    body = {"node_id": "cn_exp", "kind": "explanation", "x": 0, "y": 0, "w": 300, "h": 160,
            "source_message_id": "msg_missing"}  # fmt: skip
    with pytest.raises(CanvasRejected, match="source_message_id"):
        env.db.create_node(env.owner, env.paper_id, body)
    env.db.create_thread(
        env.owner,
        env.paper_id,
        thread_id="thr_canvas_test_0001",
        kind="explain",
        title="Explain",
        origin_anchor=None,
    )
    for role, msg in (("user", "msg_user_0001"), ("assistant", "msg_assistant_0001")):
        env.db.append_message(
            env.owner,
            "thr_canvas_test_0001",
            message_id=msg,
            role=role,
            generation=1,
            content="text",
            status="complete",
        )
    with pytest.raises(CanvasRejected):
        env.db.create_node(env.owner, env.paper_id, {**body, "source_message_id": "msg_user_0001"})
    ok = env.db.create_node(
        env.owner, env.paper_id, {**body, "source_message_id": "msg_assistant_0001"}
    )
    assert ok.source_message_id == "msg_assistant_0001"


def test_patch_node_bumps_the_version_and_changes_only_what_is_present(env: Env) -> None:
    env.db.create_node(env.owner, env.paper_id, _note("cn_one", title="t", body="b"))
    board_id = _node(env, "cn_one").board_id
    patched = env.db.patch_node(env.owner, board_id, "cn_one", 1, {"x": 99.5})
    assert isinstance(patched, NodeRow)
    assert (patched.x, patched.y, patched.version, patched.body, patched.title) == (
        99.5, 20, 2, "b", "t",
    )  # fmt: skip
    cleared = env.db.patch_node(env.owner, board_id, "cn_one", 2, {"title": None})
    assert isinstance(cleared, NodeRow) and cleared.title is None and cleared.version == 3


def test_stale_version_changes_nothing_and_carries_the_current_node(env: Env) -> None:
    env.db.create_node(env.owner, env.paper_id, _note("cn_one", body="mine"))
    board_id = _node(env, "cn_one").board_id
    first = env.db.patch_node(env.owner, board_id, "cn_one", 1, {"body": "theirs"})
    assert isinstance(first, NodeRow) and first.version == 2
    stale = env.db.patch_node(env.owner, board_id, "cn_one", 1, {"body": "late"})
    assert isinstance(stale, StaleVersion)
    assert stale.current.version == 2 and stale.current.body == "theirs"
    assert _node(env, "cn_one").body == "theirs" and _node(env, "cn_one").version == 2


def test_patch_and_delete_of_an_unknown_node_find_nothing(env: Env) -> None:
    env.db.create_node(env.owner, env.paper_id, _note("cn_one"))
    board_id = _node(env, "cn_one").board_id
    assert env.db.patch_node(env.owner, board_id, "cn_nope", 1, {"x": 1}) is None
    assert env.db.delete_node(env.owner, board_id, "cn_nope") == 0
    assert env.db.delete_node(env.owner, "brd_nope", "cn_one") == 0


def test_group_delete_ungroups_members_via_the_trigger(env: Env) -> None:
    """s7-group-delete-ungroups: deleting the group row nulls its members' ``group_id`` (the
    trigger), and neither member is deleted."""
    env.db.create_node(
        env.owner, env.paper_id, {**_note("cn_grp"), "kind": "group", "title": "Group"}
    )
    env.db.create_node(env.owner, env.paper_id, _note("cn_a", group_id="cn_grp"))
    env.db.create_node(env.owner, env.paper_id, _note("cn_b"))
    board_id = _node(env, "cn_grp").board_id
    joined = env.db.patch_node(env.owner, board_id, "cn_b", 1, {"group_id": "cn_grp"})
    assert isinstance(joined, NodeRow) and joined.group_id == "cn_grp"
    assert _node(env, "cn_a").group_id == "cn_grp"
    assert env.db.delete_node(env.owner, board_id, "cn_grp") == 1
    snapshot = env.db.get_board(env.owner, env.paper_id)
    assert {n.node_id: n.group_id for n in snapshot.nodes} == {"cn_a": None, "cn_b": None}


def test_group_rules(env: Env) -> None:
    env.db.create_node(env.owner, env.paper_id, {**_note("cn_grp"), "kind": "group"})
    env.db.create_node(env.owner, env.paper_id, _note("cn_a"))
    board_id = _node(env, "cn_a").board_id
    with pytest.raises(CanvasRejected, match="nest"):
        env.db.patch_node(env.owner, board_id, "cn_grp", 1, {"group_id": "cn_a"})
    with pytest.raises(CanvasRejected, match="in itself"):
        env.db.patch_node(env.owner, board_id, "cn_a", 1, {"group_id": "cn_a"})
    env.db.create_node(env.owner, env.paper_id, _note("cn_b"))
    with pytest.raises(CanvasRejected, match="not a group"):
        env.db.patch_node(env.owner, board_id, "cn_a", 1, {"group_id": "cn_b"})
    assert _node(env, "cn_a").version == 1


def test_edges_cascade_with_their_nodes(env: Env) -> None:
    for node_id in ("cn_a", "cn_b", "cn_c"):
        env.db.create_node(env.owner, env.paper_id, _note(node_id))
    board_id = _node(env, "cn_a").board_id
    for edge_id, a, b in (("ce_1", "cn_a", "cn_b"), ("ce_2", "cn_b", "cn_c")):
        env.db.create_edge(
            env.owner,
            board_id,
            {"edge_id": edge_id, "from_node_id": a, "to_node_id": b, "kind": "supports"},
        )
    env.db.delete_node(env.owner, board_id, "cn_b")
    assert env.db.get_board(env.owner, env.paper_id).edges == ()


def test_edge_rules(env: Env) -> None:
    for node_id in ("cn_a", "cn_b"):
        env.db.create_node(env.owner, env.paper_id, _note(node_id))
    board_id = _node(env, "cn_a").board_id
    edge = {"edge_id": "ce_1", "from_node_id": "cn_a", "to_node_id": "cn_b", "kind": "supports"}
    with pytest.raises(CanvasRejected, match="not_found|no such board") as missing:
        env.db.create_edge(env.owner, "brd_nope", edge)
    assert missing.value.code == "not_found"
    with pytest.raises(CanvasRejected, match="on this board"):
        env.db.create_edge(env.owner, board_id, {**edge, "to_node_id": "cn_elsewhere"})
    with pytest.raises(CanvasRejected, match="seven"):
        env.db.create_edge(env.owner, board_id, {**edge, "kind": "likes"})
    made = env.db.create_edge(env.owner, board_id, {**edge, "label": "because"})
    assert (made.kind, made.label) == ("supports", "because")
    assert env.db.create_edge(env.owner, board_id, edge) == made  # idempotent
    changed = env.db.patch_edge(env.owner, board_id, "ce_1", {"kind": "contradicts", "label": None})
    assert changed is not None and (changed.kind, changed.label) == ("contradicts", None)
    assert env.db.patch_edge(env.owner, board_id, "ce_nope", {"label": "x"}) is None
    assert env.db.delete_edge(env.owner, board_id, "ce_1") == 1
    assert env.db.delete_edge(env.owner, board_id, "ce_1") == 0


def test_patch_board_title_and_viewport(env: Env) -> None:
    env.db.create_node(env.owner, env.paper_id, _note("cn_a"))
    board_id = _node(env, "cn_a").board_id
    board = env.db.patch_board(env.owner, board_id, {"viewport": {"x": 5, "y": -3, "zoom": 1.5}})
    assert board is not None and dict(board.viewport or {}) == {"x": 5, "y": -3, "zoom": 1.5}
    assert board.title == "Canvas"
    renamed = env.db.patch_board(env.owner, board_id, {"title": "My map"})
    assert renamed is not None and renamed.title == "My map" and renamed.viewport is not None
    cleared = env.db.patch_board(env.owner, board_id, {"viewport": None})
    assert cleared is not None and cleared.viewport is None
    with pytest.raises(CanvasRejected):
        env.db.patch_board(env.owner, board_id, {"viewport": {"x": 1, "y": 1, "zoom": 0}})
    assert env.db.patch_board(env.owner, "brd_nope", {"title": "x"}) is None


def test_everything_is_owner_scoped(env: Env) -> None:
    env.db.create_node(env.owner, env.paper_id, _note("cn_a"))
    board_id = _node(env, "cn_a").board_id
    other = env.db.create_user("other@papertree.test").owner
    assert env.db.get_board(other, env.paper_id).board is None
    assert env.db.patch_node(other, board_id, "cn_a", 1, {"x": 1}) is None
    assert env.db.delete_node(other, board_id, "cn_a") == 0
    assert env.db.patch_board(other, board_id, {"title": "mine now"}) is None
    with pytest.raises(PaperNotFound):
        env.db.create_node(other, env.paper_id, _note("cn_theirs"))
    with pytest.raises(CanvasRejected) as raised:
        env.db.create_edge(
            other,
            board_id,
            {"edge_id": "ce_x", "from_node_id": "cn_a", "to_node_id": "cn_b", "kind": "relates"},
        )
    assert raised.value.code == "not_found"
    assert _node(env, "cn_a").x == 10
