"""Board backend, v0.2 (S6a, #211): migration 0008, the pin table, the new card kinds.

Migration 0008 rebuilds ``canvas_nodes`` and ``canvas_edges``; the migration tests run it over a
real 0005-shaped database holding every v0.1 kind, a group with members and edges, and check every
row, every FK and the ungroup trigger survive.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from papertree_db import (
    PIN_TABLE,
    CanvasRejected,
    OwnerId,
    PaperId,
    PaperTreeDb,
    check_ports,
    generation,
    open_database,
)

from .saved_shapes import load_capture_anchor, load_fixture_paper, migrations_through

#: What reference/06-board-1440.png draws, card by card, written out by hand and NOT derived from
#: PIN_TABLE: (pins out, pins in). The first six are drawn on the frame; the rest are marked.
FRAME: dict[str, tuple[set[str], set[str]]] = {
    "excerpt": ({"claim_out"}, {"evidence_in"}),  # ring left, brass dot right
    "explanation": ({"claim_out", "answer_out"}, {"evidence_in", "question_in"}),
    "note": ({"claim_out"}, {"evidence_in"}),
    "question": (set(), {"question_in", "evidence_in"}),
    "notebook": ({"claim_out"}, {"evidence_in"}),
    "diagram": ({"claim_out"}, {"evidence_in"}),
    "group": (set(), set()),
}
#: Allowed although the frame does not draw them (DESIGN.md section 5 / the brief), so a test
#: failing on one of these is a deliberate decision, not a mistake.
NOT_DRAWN = {("explanation", "question_in"), ("question", "evidence_in"), ("notebook", "claim_out")}
KINDS = ("excerpt", "explanation", "note", "group", "question", "notebook", "diagram")
NODES_SQL = "SELECT * FROM canvas_nodes ORDER BY node_id"
EDGES_SQL = "SELECT * FROM canvas_edges ORDER BY edge_id"
REFUSED = "that pin does not take that thread"


@dataclass(frozen=True, slots=True)
class Env:
    db: PaperTreeDb
    owner: OwnerId
    paper_id: PaperId
    file: Path


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    file = tmp_path / "board.sqlite"
    db = open_database(file)
    db.migrate()
    owner = db.create_user("reader@papertree.test").owner
    document = load_fixture_paper()
    db.put_paper(owner, document)
    paper_id = PaperId(document["paper_id"])
    db.promote_generation(owner, paper_id, generation(1))
    yield Env(db, owner, paper_id, file)
    db.close()


def _node(node_id: str, kind: str = "note", **fields: Any) -> dict[str, Any]:
    return {"node_id": node_id, "kind": kind, "x": 1, "y": 2, "w": 240, "h": 120, **fields}


def test_the_pin_table_is_the_frames(env: Env) -> None:
    assert {k: (set(p.out), set(p.into)) for k, p in PIN_TABLE.items()} == FRAME
    for kind, pin in NOT_DRAWN:  # the frame-silent allowances stay explicit and deliberate
        assert pin in FRAME[kind][0] | FRAME[kind][1]
    # The thread the frame itself draws: the diagram's brass pin onto the passage's ring.
    check_ports("diagram", "excerpt", "claim_out", "evidence_in")
    # ... and answer_out onto a question's open diamond.
    check_ports("explanation", "question", "answer_out", "question_in")


def test_every_new_kind_round_trips(env: Env) -> None:
    made = [
        env.db.create_node(env.owner, env.paper_id, _node("cn_q", "question", body="why?")),
        env.db.create_node(
            env.owner, env.paper_id, _node("cn_nb", "notebook", source_page_id="pg_1")
        ),
        env.db.create_node(
            env.owner, env.paper_id, _node("cn_dg", "diagram", source_diagram_id="dg_1")
        ),
    ]
    stored = {n.node_id: n for n in env.db.get_board(env.owner, env.paper_id).nodes}
    assert [stored[n.node_id].kind for n in made] == ["question", "notebook", "diagram"]
    assert stored["cn_nb"].source_page_id == "pg_1" and stored["cn_dg"].source_diagram_id == "dg_1"


@pytest.mark.parametrize(
    "fields",
    [
        _node("cn_a", "notebook"),
        _node("cn_b", "diagram"),
        _node("cn_c", "note", source_page_id="pg_1"),
        _node("cn_d", "notebook", source_page_id="pg_1", source_diagram_id="dg_1"),
        _node("cn_e", "question", source_message_id="msg_nope"),
    ],
)
def test_source_pointers_are_required_and_exclusive(env: Env, fields: dict[str, Any]) -> None:
    with pytest.raises(CanvasRejected) as raised:
        env.db.create_node(env.owner, env.paper_id, fields)
    assert raised.value.code == "validation_failed"


def test_a_notebook_page_that_is_not_yours_is_not_found(env: Env) -> None:
    """Checked against notebook_pages only when 0007 has created it (it is a plain TEXT column)."""
    conn = sqlite3.connect(env.file)
    try:
        conn.executescript(
            "CREATE TABLE notebook_pages (page_id TEXT, owner_id TEXT, paper_id TEXT);"
            "CREATE TABLE notebook_items (item_id TEXT, owner_id TEXT, page_id TEXT, kind TEXT);"
            "CREATE TABLE notebook_strokes (stroke_id TEXT, owner_id TEXT, page_id TEXT);"
        )
        owner = env.db.create_user("other@papertree.test").owner
        owner_id = env.db._resolve(env.owner)
        other_id = env.db._resolve(owner)
        conn.execute(
            "INSERT INTO notebook_pages VALUES ('pg_mine', ?, ?)", (owner_id, env.paper_id)
        )
        conn.execute(
            "INSERT INTO notebook_pages VALUES ('pg_theirs', ?, ?)", (other_id, env.paper_id)
        )
        for kind in ("quote", "quote", "sticky", "text", "shape", "exchange"):
            conn.execute(
                "INSERT INTO notebook_items VALUES (?, ?, 'pg_mine', ?)",
                (kind + "x", owner_id, kind),
            )
        conn.execute("INSERT INTO notebook_strokes VALUES ('s1', ?, 'pg_mine')", (owner_id,))
        conn.commit()
    finally:
        conn.close()
    with pytest.raises(CanvasRejected) as raised:
        env.db.create_node(
            env.owner, env.paper_id, _node("cn_x", "notebook", source_page_id="pg_theirs")
        )
    assert raised.value.code == "not_found"
    env.db.create_node(
        env.owner, env.paper_id, _node("cn_ok", "notebook", source_page_id="pg_mine")
    )
    counts = env.db.get_board(env.owner, env.paper_id).notebook_counts["cn_ok"]
    assert (counts.quotes, counts.stickies, counts.text, counts.shapes, counts.strokes) == (
        2,
        1,
        1,
        1,
        1,
    )


def _edge(edge_id: str, a: str, b: str, **ports: Any) -> dict[str, Any]:
    return {"edge_id": edge_id, "from_node_id": a, "to_node_id": b, "kind": "supports", **ports}


def _make(env: Env, kind: str) -> str:
    """Creates one card of ``kind`` on the board and returns its id."""
    node_id = f"cn_{kind}"
    extra: dict[str, Any] = {}
    if kind == "excerpt":
        anchor = load_capture_anchor()
        anchor["doc"]["paperId"] = env.paper_id
        extra["source_anchor"] = anchor
    elif kind == "explanation":
        env.db.create_thread(
            env.owner, env.paper_id, thread_id="thr_pins_0001", kind="explain", title="T",
            origin_anchor=None,
        )  # fmt: skip
        env.db.append_message(
            env.owner, "thr_pins_0001", message_id="msg_pins_0001", role="assistant",
            generation=1, content="text", status="complete",
        )  # fmt: skip
        extra["source_message_id"] = "msg_pins_0001"
    elif kind == "notebook":
        extra["source_page_id"] = "pg_x"
    elif kind == "diagram":
        extra["source_diagram_id"] = "dg_x"
    env.db.create_node(env.owner, env.paper_id, _node(node_id, kind, **extra))
    return node_id


def test_ports_follow_the_frame(env: Env) -> None:
    """Every (source kind, out-pin, target kind, in-pin) over ALL seven kinds: the answer comes from
    the hand-written FRAME table, never from PIN_TABLE."""
    ids = {kind: _make(env, kind) for kind in FRAME}
    board_id = env.db.get_board(env.owner, env.paper_id).board.board_id  # type: ignore[union-attr]
    n = 0
    for a, b in ((a, b) for a in FRAME for b in FRAME if a != b):
        for out in (None, "claim_out", "answer_out"):
            for into in (None, "evidence_in", "question_in"):
                n += 1
                edge = _edge(f"ce_{n}", ids[a], ids[b], from_port=out, to_port=into)
                if (out is None or out in FRAME[a][0]) and (into is None or into in FRAME[b][1]):
                    stored = env.db.create_edge(env.owner, board_id, edge)
                    assert (stored.from_port, stored.to_port) == (out, into)
                else:
                    with pytest.raises(CanvasRejected, match=REFUSED):
                        env.db.create_edge(env.owner, board_id, edge)
    assert n == 42 * 9


def test_a_question_card_may_point_at_a_user_message_only(env: Env) -> None:
    env.db.create_thread(
        env.owner, env.paper_id, thread_id="thr_q_0001", kind="ask", title="Q", origin_anchor=None
    )
    for role, msg in (("user", "msg_q_user01"), ("assistant", "msg_q_asst01")):
        env.db.append_message(
            env.owner, "thr_q_0001", message_id=msg, role=role, generation=1, content="t",
            status="complete",
        )  # fmt: skip
    ok = env.db.create_node(
        env.owner, env.paper_id, _node("cn_q1", "question", source_message_id="msg_q_user01")
    )
    assert ok.source_message_id == "msg_q_user01"
    with pytest.raises(CanvasRejected, match="source_message_id"):
        env.db.create_node(
            env.owner, env.paper_id, _node("cn_q2", "question", source_message_id="msg_q_asst01")
        )


def test_a_v01_edge_has_no_ports_and_patches(env: Env) -> None:
    for node_id in ("cn_a", "cn_b"):
        env.db.create_node(env.owner, env.paper_id, _node(node_id))
    board_id = env.db.get_board(env.owner, env.paper_id).board.board_id  # type: ignore[union-attr]
    edge = env.db.create_edge(env.owner, board_id, _edge("ce_1", "cn_a", "cn_b"))
    assert (edge.from_port, edge.to_port) == (None, None) and edge.created_at
    patched = env.db.patch_edge(env.owner, board_id, "ce_1", {"label": "x"})
    assert patched is not None and patched.label == "x"
    ported = env.db.patch_edge(
        env.owner, board_id, "ce_1", {"from_port": "claim_out", "to_port": "evidence_in"}
    )
    assert ported is not None and ported.from_port == "claim_out"
    with pytest.raises(CanvasRejected, match=REFUSED):
        env.db.patch_edge(env.owner, board_id, "ce_1", {"to_port": "question_in"})


def test_an_empty_frame_is_a_group_and_moving_it_moves_nothing_else(env: Env) -> None:
    frame = env.db.create_node(env.owner, env.paper_id, _node("cn_frame", "group", title="Why"))
    child = env.db.create_node(env.owner, env.paper_id, _node("cn_kid", group_id="cn_frame"))
    moved = env.db.patch_node(env.owner, frame.board_id, "cn_frame", 1, {"x": 500.0, "y": 600.0})
    assert not isinstance(moved, type(None)) and moved.x == 500.0  # type: ignore[union-attr]
    kid = next(n for n in env.db.get_board(env.owner, env.paper_id).nodes if n.node_id == "cn_kid")
    assert (kid.x, kid.y, kid.version) == (child.x, child.y, child.version)


# ── migration 0008 over a 0005-shaped database ─────────────────────────────────────────────────


def _rows(conn: sqlite3.Connection, sql: str) -> list[tuple[Any, ...]]:
    return [tuple(r) for r in conn.execute(sql).fetchall()]


def test_0008_carries_every_row_fk_and_the_trigger(tmp_path: Path) -> None:
    file = tmp_path / "old.sqlite"
    old = migrations_through(5, tmp_path / "m5")
    with open_database(file, old) as db:
        db.migrate()
        owner = db.create_user("reader@papertree.test").owner
        document = load_fixture_paper()
        db.put_paper(owner, document)
        db.promote_generation(owner, PaperId(document["paper_id"]), generation(1))
        owner_id = db._resolve(owner)
        paper_id = str(document["paper_id"])
    conn = sqlite3.connect(file)
    conn.execute("PRAGMA foreign_keys = ON")
    now = "2026-10-01T00:00:00+00:00"
    conn.execute(
        "INSERT INTO canvas_boards VALUES ('brd_1', ?, ?, 'Canvas', NULL, ?, ?)",
        (owner_id, paper_id, now, now),
    )
    anchor = '{"doc":{"paperId":"p"}}'
    plain = [("cn_g", "group"), ("cn_n", "note"), ("cn_m", "note")]
    for node_id, kind in plain:
        conn.execute(
            "INSERT INTO canvas_nodes (node_id, owner_id, board_id, kind, x, y, w, h, created_at, "
            "updated_at) VALUES (?, ?, 'brd_1', ?, 1, 2, 3, 4, ?, ?)",
            (node_id, owner_id, kind, now, now),
        )
    conn.execute(
        "INSERT INTO canvas_nodes (node_id, owner_id, board_id, kind, x, y, w, h, "
        "source_anchor_json, created_at, updated_at) VALUES ('cn_x', ?, 'brd_1', 'excerpt', "
        "1, 2, 3, 4, ?, ?, ?)",
        (owner_id, anchor, now, now),
    )
    conn.execute("UPDATE canvas_nodes SET group_id = 'cn_g' WHERE node_id IN ('cn_n', 'cn_m')")
    for edge_id, a, b in (("ce_1", "cn_n", "cn_m"), ("ce_2", "cn_x", "cn_n")):
        conn.execute(
            "INSERT INTO canvas_edges VALUES (?, ?, 'brd_1', ?, ?, 'supports', 'l', ?, ?)",
            (edge_id, owner_id, a, b, now, now),
        )
    conn.commit()
    # Fill the columns a bare insert leaves at their defaults, so a dropped one would show.
    conn.execute(
        "UPDATE canvas_nodes SET title = 'T\u00e9', body = 'b\u00f8dy', z = 3, version = 4, "
        "source_message_id = 'msg_x', updated_at = '2026-10-02T00:00:00+00:00'"
        " WHERE node_id IN ('cn_n', 'cn_m')"
    )
    conn.commit()
    before_nodes = _rows(conn, NODES_SQL)
    before_edges = _rows(conn, EDGES_SQL)
    conn.close()

    with open_database(file) as db:
        result = db.migrate()
        assert 8 in result.applied and result.backups
    conn = sqlite3.connect(file)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        # EVERY old column of every row, byte for byte; the four new columns are appended and NULL.
        after_nodes = _rows(conn, NODES_SQL)
        after_edges = _rows(conn, EDGES_SQL)
        assert before_nodes == [r[: len(before_nodes[0])] for r in after_nodes]
        assert before_edges == [r[: len(before_edges[0])] for r in after_edges]
        assert all(r[len(before_nodes[0]) :] == (None, None) for r in after_nodes)
        assert [r[len(before_edges[0]) :] for r in after_edges] == [(None, None)] * 2
        assert _rows(conn, "SELECT from_port, to_port FROM canvas_edges") == [(None, None)] * 2
        assert _rows(conn, "PRAGMA foreign_key_check") == []
        assert _rows(conn, "PRAGMA integrity_check") == [("ok",)]
        assert _rows(conn, "SELECT name FROM sqlite_master WHERE name LIKE '%_new'") == []
        # The new kinds and their CHECKs are live; the ungroup trigger survived the rebuild.
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO canvas_nodes (node_id, owner_id, board_id, kind, x, y, w, h, "
                "created_at, updated_at) VALUES ('cn_bad', ?, 'brd_1', 'notebook', 1, 2, 3, 4, "
                "?, ?)",
                (owner_id, now, now),
            )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE canvas_edges SET from_port = 'nope'")
        conn.execute("DELETE FROM canvas_nodes WHERE node_id = 'cn_g'")
        assert _rows(
            conn, "SELECT group_id FROM canvas_nodes WHERE node_id IN ('cn_n','cn_m')"
        ) == [(None,), (None,)]
        conn.execute("DELETE FROM canvas_nodes WHERE node_id = 'cn_n'")
        assert _rows(conn, "SELECT edge_id FROM canvas_edges") == []  # the cascade still cascades
    finally:
        conn.close()


def test_0008_on_a_fresh_database(tmp_path: Path) -> None:
    with open_database(tmp_path / "fresh.sqlite") as db:
        result = db.migrate()
        assert 8 in result.applied and result.backups == ()


def test_a_source_pointer_cannot_be_cleared_or_set_on_the_wrong_kind(env: Env) -> None:
    note = env.db.create_node(env.owner, env.paper_id, _node("cn_plain"))
    for fields in ({"source_page_id": None}, {"source_page_id": "pg_1"}):
        with pytest.raises(CanvasRejected) as raised:
            env.db.patch_node(env.owner, note.board_id, "cn_plain", 1, fields)
        assert raised.value.code == "validation_failed"
