"""0007_notebook.sql (v0.2 S5a, #206): three new owned tables, nothing rebuilt.

Proves, on real databases and not on the SQL text: a fresh data root gets the tables; a saved 0005
database (the demo shape: real papers, a legacy highlight, a board of its own) migrates to head and
keeps every row it had, with NO backup (only 0005 rewrites user tables); and the schema's own
rules hold when someone bypasses the API (a quote without an anchor, a foreign owner on a child).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from papertree_db import migrate, open_database

from .saved_shapes import (
    HEAD_VERSIONS,
    MIGRATIONS_DIR,
    build_demo_shape,
    counts,
    migrations_through,
    raw_connect,
)

NOTEBOOK_TABLES = ("notebook_pages", "notebook_items", "notebook_strokes")


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def test_a_fresh_database_gets_the_three_tables_and_records_0007(tmp_path: Path) -> None:
    with open_database(tmp_path / "fresh.sqlite") as db:
        result = db.migrate()
    assert 7 in result.applied and result.backups == ()
    conn = sqlite3.connect(tmp_path / "fresh.sqlite")
    try:
        assert set(NOTEBOOK_TABLES) <= _tables(conn)
        strict = {r[1]: r[5] for r in conn.execute("PRAGMA table_list") if r[1] in NOTEBOOK_TABLES}
        assert strict == {t: 1 for t in NOTEBOOK_TABLES}
    finally:
        conn.close()


def test_a_saved_0005_database_migrates_to_0007_and_keeps_every_row(tmp_path: Path) -> None:
    shape = build_demo_shape(tmp_path)
    conn = raw_connect(shape.file)
    try:
        migrate(conn, migrations_through(5, tmp_path / "m5"))
        assert not set(NOTEBOOK_TABLES) & _tables(conn)
        before = counts(conn)
        assert before["highlights"] >= 1  # the demo root has real user rows to lose

        result = migrate(conn, MIGRATIONS_DIR)

        assert result.applied == tuple(v for v in HEAD_VERSIONS if v > 5) and result.backups == ()
        assert counts(conn) == before
        assert set(NOTEBOOK_TABLES) <= _tables(conn)
        assert [tuple(r) for r in conn.execute("PRAGMA foreign_key_check")] == []
    finally:
        conn.close()


def test_the_schema_refuses_what_the_api_would(tmp_path: Path) -> None:
    shape = build_demo_shape(tmp_path)
    conn = raw_connect(shape.file)
    user, paper = shape.promoted[0]
    try:
        migrate(conn, MIGRATIONS_DIR)
        conn.execute(
            "INSERT INTO notebook_pages (page_id, owner_id, paper_id, title, created_at, "
            "updated_at) VALUES ('pg_one', ?, ?, 't', 'n', 'n')",
            (user, paper),
        )
        item = (
            "INSERT INTO notebook_items (item_id, owner_id, page_id, kind, x, y, w, h, body, "
            "anchor_json, created_at, updated_at) VALUES (?,?,?,?,0,0,1,1,'',?,'n','n')"
        )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):  # a quote needs its Anchor
            conn.execute(item, ("ni_q", user, "pg_one", "quote", None))
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):  # and valid JSON at that
            conn.execute(item, ("ni_q", user, "pg_one", "quote", "{not json"))
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):  # owner_id is in the FK
            conn.execute(item, ("ni_x", "usr_someone_else", "pg_one", "sticky", None))
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):  # not a template
            conn.execute(
                "INSERT INTO notebook_pages (page_id, owner_id, paper_id, title, template, "
                "created_at, updated_at) VALUES ('pg_two', ?, ?, 't', 'grid', 'n', 'n')",
                (user, paper),
            )
        conn.execute(item, ("ni_ok", user, "pg_one", "sticky", None))
        conn.execute(  # ink is stored by #240; the table and its cascade are this migration's
            "INSERT INTO notebook_strokes (stroke_id, owner_id, page_id, tool, nib, colour, "
            "points, created_at) VALUES ('sk_one', ?, 'pg_one', 'pen', 'F', 'pen', x'010000', 'n')",
            (user,),
        )
        conn.execute("DELETE FROM notebook_pages WHERE page_id = 'pg_one'")  # cascades
        for table in ("notebook_items", "notebook_strokes"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
    finally:
        conn.close()
