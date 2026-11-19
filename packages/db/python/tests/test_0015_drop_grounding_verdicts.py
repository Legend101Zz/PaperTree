"""0015_drop_grounding_verdicts.sql (v0.3, #351): the two ``supported`` columns go, the rows stay.

A database at 0014 holds citations and diagram parts WITH verdicts. Migrating it must drop
``ai_citations.supported`` (a plain DROP COLUMN) and rebuild ``ai_diagram_parts`` without its
``supported`` column (a table CHECK names it, so SQLite cannot drop it), keep every other column
of every row, keep the table's other rules and its index, take a backup first (a rebuild), and be
a no-op the second time. Robust to later migrations: it never asserts the head number.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from papertree_db import PaperId, generation, migrate, open_database
from papertree_db.migrate import BACKUP_BEFORE_VERSIONS

from .saved_shapes import (
    HEAD_VERSIONS,
    MIGRATIONS_DIR,
    load_fixture_paper,
    migrations_through,
    raw_connect,
)

NOW = "2026-11-20T00:00:00.000000+00:00"
ANCHOR = '{"doc":{"paperId":"p"},"id":"anc_1"}'


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


def _at_0014(tmp_path: Path) -> Path:
    file = tmp_path / "at14.sqlite"
    with open_database(file, migrations_through(14, tmp_path / "m14")) as db:
        db.migrate()
        owner = db.create_user("reader@papertree.test").owner
        document = load_fixture_paper()
        db.put_paper(owner, document)
        db.promote_generation(owner, PaperId(document["paper_id"]), generation(1))
        owner_id, paper_id = db._resolve(owner), str(document["paper_id"])
    conn = sqlite3.connect(file)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        "INSERT INTO ai_threads VALUES ('thr_1', ?, ?, 'diagram', 'T', ?, NULL, ?, ?)",
        (owner_id, paper_id, ANCHOR, NOW, NOW),
    )
    conn.execute(
        "INSERT INTO ai_messages (message_id, owner_id, thread_id, ordinal, role, generation, "
        "content, status, created_at) VALUES ('msg_a', ?, 'thr_1', 1, 'assistant', 1, 'x', "
        "'complete', ?)",
        (owner_id, NOW),
    )
    for citation_id, ordinal, supported in (("cit_1", 0, 1), ("cit_2", 1, None), ("cit_3", 2, 0)):
        conn.execute(
            "INSERT INTO ai_citations (citation_id, owner_id, message_id, ordinal, marker, "
            "anchor_json, generation, block_id, page_index, supported) "
            "VALUES (?, ?, 'msg_a', ?, 'b1', ?, 1, 'blk_1', 2, ?)",
            (citation_id, owner_id, ordinal, ANCHOR, supported),
        )
    parts = (  # cited, near (anchor, supported 0), found nowhere (no anchor), inferred
        ("A", 0, "q1", ANCHOR, 1, "blk_1", 3),
        ("B", 1, "q2", ANCHOR, 0, "blk_2", 4),
        ("C", 2, "q3", None, 0, None, None),
        ("D", 3, None, None, None, None, None),
    )
    for letter, ordinal, quote, anchor, supported, block, page in parts:
        conn.execute(
            "INSERT INTO ai_diagram_parts (part_id, owner_id, message_id, letter, ordinal, label, "
            "note, part_kind, after_json, edge_json, cite_quote, anchor_json, supported, "
            "generation, block_id, page_index) VALUES (?, ?, 'msg_a', ?, ?, ?, 'n', 'step', '[]', "
            "'[]', ?, ?, ?, 1, ?, ?)",
            (f"dpt_{letter}", owner_id, letter, ordinal, f"L{letter}", quote, anchor, supported)
            + (block, page),
        )
    conn.commit()
    conn.close()
    return file


def test_0015_is_a_rebuild_so_it_is_backed_up() -> None:
    assert 15 in BACKUP_BEFORE_VERSIONS and 15 in HEAD_VERSIONS


def test_a_0014_database_loses_both_columns_and_keeps_every_row(tmp_path: Path) -> None:
    file = _at_0014(tmp_path)
    conn = raw_connect(file)
    try:
        cit_before = [
            tuple(r)
            for r in conn.execute(
                "SELECT citation_id, owner_id, message_id, ordinal, marker, anchor_json, "
                "generation, block_id, page_index FROM ai_citations ORDER BY citation_id"
            )
        ]
        part_cols = [c for c in _columns(conn, "ai_diagram_parts") if c != "supported"]
        parts_before = [
            tuple(r)
            for r in conn.execute(
                f"SELECT {', '.join(part_cols)} FROM ai_diagram_parts ORDER BY part_id"
            )
        ]
        assert "supported" in _columns(conn, "ai_citations") and len(parts_before) == 4

        result = migrate(conn, MIGRATIONS_DIR)

        assert 15 in result.applied
        assert [b.name.rsplit(".pre-", 1)[-1] for b in result.backups] == ["0015.bak"]
        assert "supported" not in _columns(conn, "ai_citations")
        assert _columns(conn, "ai_diagram_parts") == part_cols
        assert [
            tuple(r)
            for r in conn.execute(
                "SELECT citation_id, owner_id, message_id, ordinal, marker, anchor_json, "
                "generation, block_id, page_index FROM ai_citations ORDER BY citation_id"
            )
        ] == cit_before
        assert [
            tuple(r)
            for r in conn.execute(
                f"SELECT {', '.join(part_cols)} FROM ai_diagram_parts ORDER BY part_id"
            )
        ] == parts_before
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        assert migrate(conn, MIGRATIONS_DIR).applied == ()  # once is enough
    finally:
        conn.close()


def test_the_rebuilt_parts_table_keeps_its_other_rules_index_and_cascade(tmp_path: Path) -> None:
    file = _at_0014(tmp_path)
    conn = raw_connect(file)
    try:
        migrate(conn, MIGRATIONS_DIR)
        indexes = {r[1] for r in conn.execute("PRAGMA index_list(ai_diagram_parts)")}
        assert "ai_diagram_parts_by_message" in indexes
        owner_id = conn.execute("SELECT owner_id FROM ai_messages").fetchone()[0]
        insert = (
            "INSERT INTO ai_diagram_parts (part_id, owner_id, message_id, letter, ordinal, label, "
            "part_kind, after_json, edge_json, cite_quote, anchor_json, generation, block_id, "
            "page_index) VALUES ('dpt_X', ?, 'msg_a', ?, ?, 'L', 'step', '[]', '[]', ?, ?, 1, ?, ?)"
        )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):  # letter != A + ordinal
            conn.execute(insert, (owner_id, "F", 4, None, None, None, None))
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):  # an anchor needs its quote
            conn.execute(insert, (owner_id, "E", 4, None, ANCHOR, "b", 1))
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):  # one letter per message
            conn.execute(insert, (owner_id, "A", 0, "q", None, None, None))
        conn.execute("DELETE FROM ai_messages")  # cascades
        assert conn.execute("SELECT COUNT(*) FROM ai_diagram_parts").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM ai_citations").fetchone()[0] == 0
    finally:
        conn.close()


def test_a_fresh_database_never_has_the_columns(tmp_path: Path) -> None:
    with open_database(tmp_path / "fresh.sqlite") as db:
        db.migrate()
    conn = sqlite3.connect(tmp_path / "fresh.sqlite")
    try:
        assert "supported" not in _columns(conn, "ai_citations")
        assert "supported" not in _columns(conn, "ai_diagram_parts")
    finally:
        conn.close()
