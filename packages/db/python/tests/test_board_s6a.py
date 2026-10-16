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
    generation,
    open_database,
)

from .saved_shapes import load_fixture_paper, migrations_through

KINDS = ("excerpt", "explanation", "note", "group", "question", "notebook", "diagram")
NODES_SQL = "SELECT node_id, kind, group_id, x, w, source_anchor_json FROM canvas_nodes ORDER BY 1"
EDGES_SQL = (
    "SELECT edge_id, from_node_id, to_node_id, label, created_at FROM canvas_edges ORDER BY 1"
)
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


def test_the_pin_table_is_the_designs(env: Env) -> None:
    outs = {k: sorted(p.out) for k, p in PIN_TABLE.items() if p.out}
    ins = {k: sorted(p.into) for k, p in PIN_TABLE.items() if p.into}
    assert set(outs) == {"excerpt", "note", "explanation", "notebook", "diagram"}
    assert [k for k, v in outs.items() if "answer_out" in v] == ["explanation"]
    assert set(ins) == {"explanation", "note", "question", "notebook", "diagram"}
    assert {k for k, v in ins.items() if "question_in" in v} == {"question", "explanation"}
    assert PIN_TABLE["group"].out == PIN_TABLE["group"].into == frozenset()


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


def test_ports_follow_the_table(env: Env) -> None:
    """Every allowed (source, out-pin, target, in-pin) passes; every other combination of the
    cards that can be built without an AI thread is 422 with the pin sentence."""
    kinds = ("note", "question", "notebook", "diagram", "group")
    ids = {k: f"cn_{k}" for k in kinds}
    for kind in kinds:
        extra = {"source_page_id": "pg_x"} if kind == "notebook" else {}
        extra |= {"source_diagram_id": "dg_x"} if kind == "diagram" else {}
        env.db.create_node(env.owner, env.paper_id, _node(ids[kind], kind, **extra))
    board_id = env.db.get_board(env.owner, env.paper_id).board.board_id  # type: ignore[union-attr]
    n = 0
    for a in kinds:
        for b in kinds:
            if a == b:
                continue
            for out in (None, "claim_out", "answer_out"):
                for into in (None, "evidence_in", "question_in"):
                    n += 1
                    edge = _edge(f"ce_{n}", ids[a], ids[b], from_port=out, to_port=into)
                    allowed = (out is None or out in PIN_TABLE[a].out) and (
                        into is None or into in PIN_TABLE[b].into
                    )
                    if allowed:
                        stored = env.db.create_edge(env.owner, board_id, edge)
                        assert (stored.from_port, stored.to_port) == (out, into)
                    else:
                        with pytest.raises(CanvasRejected, match=REFUSED):
                            env.db.create_edge(env.owner, board_id, edge)
    assert n == 20 * 9


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
    before_nodes = _rows(
        conn,
        NODES_SQL,
    )
    before_edges = _rows(
        conn,
        EDGES_SQL,
    )
    conn.close()

    with open_database(file) as db:
        result = db.migrate()
        assert result.applied[-1] == 8 and result.backups
    conn = sqlite3.connect(file)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        assert before_nodes == _rows(
            conn,
            NODES_SQL,
        )
        assert before_edges == _rows(
            conn,
            EDGES_SQL,
        )
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
        assert result.applied[-1] == 8 and result.backups == ()
