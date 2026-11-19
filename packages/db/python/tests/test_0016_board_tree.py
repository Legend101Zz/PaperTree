"""Migration 0016 (v0.3, #343): the branching board's eight columns on ``canvas_nodes``.

Additive only: no table is rebuilt (so it is not in BACKUP_BEFORE_VERSIONS), every v0.2 card and
edge survives byte for byte and reads as a loose card with the new columns at their defaults, and
the CHECKs on ``branch`` and ``folded`` hold from raw SQL as well as from Python.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from papertree_db import PaperId, generation, open_database
from papertree_db.migrate import BACKUP_BEFORE_VERSIONS

from .saved_shapes import load_fixture_paper, migrations_through

NOW = "2026-10-01T00:00:00+00:00"
NEW_COLUMNS = (
    "parent_id", "branch", "parent_span_json", "question", "uses_json", "offset_x", "offset_y",
    "folded",
)  # fmt: skip


def test_0016_keeps_every_card_and_gives_the_new_columns_their_defaults(tmp_path: Path) -> None:
    file = tmp_path / "old.sqlite"
    with open_database(file, migrations_through(14, tmp_path / "m14")) as db:
        db.migrate()
        owner = db.create_user("reader@papertree.test").owner
        document = load_fixture_paper()
        db.put_paper(owner, document)
        db.promote_generation(owner, PaperId(document["paper_id"]), generation(1))
        owner_id = db._resolve(owner)
        paper_id = str(document["paper_id"])
    conn = sqlite3.connect(file)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        "INSERT INTO canvas_boards VALUES ('brd_1', ?, ?, 'Canvas', NULL, ?, ?)",
        (owner_id, paper_id, NOW, NOW),
    )
    for node_id, kind in (("cn_a", "note"), ("cn_b", "note")):
        conn.execute(
            "INSERT INTO canvas_nodes (node_id, owner_id, board_id, kind, x, y, w, h, title, body, "
            "z, version, created_at, updated_at) "
            "VALUES (?, ?, 'brd_1', ?, 1, 2, 3, 4, 'T', 'body', 3, 4, ?, ?)",
            (node_id, owner_id, kind, NOW, NOW),
        )
    conn.execute(
        "INSERT INTO canvas_edges VALUES "
        "('ce_1', ?, 'brd_1', 'cn_a', 'cn_b', 'supports', 'l', ?, ?, NULL, NULL)",
        (owner_id, NOW, NOW),
    )
    conn.commit()
    old_columns = [r[1] for r in conn.execute("PRAGMA table_info(canvas_nodes)")]
    before = conn.execute(
        f"SELECT {', '.join(old_columns)} FROM canvas_nodes ORDER BY node_id"
    ).fetchall()
    edges_before = conn.execute("SELECT * FROM canvas_edges").fetchall()
    conn.close()

    with open_database(file) as db:
        result = db.migrate()
        assert 16 in result.applied
        # Additive: 0016 takes no backup of its own (0015, applied in the same run from 14, does).
        assert not [b for b in result.backups if b.name.endswith(".pre-0016.bak")]
    assert 16 not in BACKUP_BEFORE_VERSIONS
    conn = sqlite3.connect(file)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        after = conn.execute(
            f"SELECT {', '.join(old_columns)} FROM canvas_nodes ORDER BY node_id"
        ).fetchall()
        assert after == before
        assert conn.execute("SELECT * FROM canvas_edges").fetchall() == edges_before
        rows = conn.execute(f"SELECT {', '.join(NEW_COLUMNS)} FROM canvas_nodes").fetchall()
        assert rows == [(None, None, None, None, None, 0.0, 0.0, 0)] * 2
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        # A board answer's thread is marked by board_id (NULL for every reader thread).
        thread_columns = [r[1] for r in conn.execute("PRAGMA table_info(ai_threads)")]
        assert thread_columns[-1] == "board_id"
        # The CHECKs bite from raw SQL too.
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE canvas_nodes SET branch = 'up' WHERE node_id = 'cn_a'")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE canvas_nodes SET folded = 2 WHERE node_id = 'cn_a'")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "UPDATE canvas_nodes SET parent_span_json = '{nope' WHERE node_id = 'cn_a'"
            )
        conn.execute(
            "UPDATE canvas_nodes SET parent_id = 'cn_b', branch = 'right', offset_x = 4.5, "
            "folded = 1, uses_json = '{}' WHERE node_id = 'cn_a'"
        )
    finally:
        conn.close()
