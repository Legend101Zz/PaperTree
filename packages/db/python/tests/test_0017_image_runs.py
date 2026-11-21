"""0017_image_runs.sql: the run kinds gain ``image`` (v0.3 #348, the image ask).

The migration over a real database with every AI table filled (it rebuilds ``ai_runs`` and its child
``ai_run_handles``): every row, FK, cascade and index survives, the widened CHECK is live (``image``
and 0013's ``glance`` in, anything else still out), a backup is taken first, and the row-count guard
is made to fire. The thread table is NOT rebuilt: an image thread is an ``ask`` thread.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

import pytest
from papertree_db import open_database
from papertree_db.ai import RUN_KINDS
from papertree_db.migrate import BACKUP_BEFORE_VERSIONS

from .saved_shapes import MIGRATIONS_DIR, migrations_through
from .test_0011_diagrams import _populated, _rows

REBUILT = {
    "ai_runs": "SELECT * FROM ai_runs ORDER BY run_id",
    "ai_run_handles": "SELECT * FROM ai_run_handles ORDER BY run_id, handle",
}
UNTOUCHED = {
    "ai_threads": "SELECT * FROM ai_threads ORDER BY thread_id",
    "ai_messages": "SELECT * FROM ai_messages ORDER BY message_id",
    "ai_citations": "SELECT * FROM ai_citations ORDER BY citation_id",
}


def _at_0016(tmp_path: Path) -> Path:
    """A database at 0016 with every AI table filled (filled at 0010, then migrated up)."""
    file, _owner, _paper = _populated(tmp_path, 10)
    with open_database(file, migrations_through(16, tmp_path / "m16")) as db:
        assert 17 not in db.migrate().applied
    return file


def test_0017_carries_every_run_row_fk_cascade_and_index(tmp_path: Path) -> None:
    file = _at_0016(tmp_path)
    conn = sqlite3.connect(file)
    before = {table: _rows(conn, sql) for table, sql in {**REBUILT, **UNTOUCHED}.items()}
    conn.close()
    assert all(before.values()), "every table held rows before"

    with open_database(file) as db:
        result = db.migrate()
        assert result.applied == (17,)
        assert [path.name for path in result.backups] == ["old.sqlite.pre-0017.bak"]

    conn = sqlite3.connect(file)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        for table, sql in {**REBUILT, **UNTOUCHED}.items():
            assert _rows(conn, sql) == before[table], table  # every column, every row
        assert _rows(conn, "PRAGMA foreign_key_check") == []
        assert _rows(conn, "PRAGMA integrity_check") == [("ok",)]
        assert _rows(conn, "SELECT name FROM sqlite_master WHERE name LIKE '%_new'") == []
        indexes = {r[0] for r in _rows(conn, "SELECT name FROM sqlite_master WHERE type='index'")}
        assert "ai_runs_by_owner" in indexes
        # The widened CHECK is live, and still refuses what it refused.
        for kind in ("image", "glance"):
            conn.execute("UPDATE ai_runs SET kind = ? WHERE run_id = 'run_2'", (kind,))
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE ai_runs SET kind = 'chat' WHERE run_id = 'run_2'")
        # The cascade from a run to its handles still cascades through the renamed tables.
        conn.execute("DELETE FROM ai_runs WHERE run_id = 'run_1'")
        assert _rows(conn, "SELECT COUNT(*) FROM ai_run_handles") == [(0,)]
        assert _rows(conn, "SELECT COUNT(*) FROM ai_messages") == [(3,)]
        # ai_threads still refuses an `image` thread kind: it is stored as `ask`.
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE ai_threads SET kind = 'image'")
    finally:
        conn.close()


def test_the_row_count_guard_aborts_0017_and_leaves_the_database_as_it_was(tmp_path: Path) -> None:
    """Non-vacuity for the guard: a copy of 0017 that loses one handle in the copy must fail on the
    guard's CHECK, and the rollback must leave every table and the record unchanged."""
    file = _at_0016(tmp_path)
    broken = migrations_through(16, tmp_path / "broken")
    source = MIGRATIONS_DIR / "0017_image_runs.sql"
    sql = source.read_text(encoding="utf-8")
    lossy = "SELECT owner_id, run_id, handle, block_id, generation FROM ai_run_handles;\n"
    assert sql.count(lossy) == 1
    (broken / source.name).write_text(
        sql.replace(lossy, lossy.replace(";\n", " WHERE handle <> 'b2';\n"))
    )
    conn = sqlite3.connect(file)
    schema = _rows(conn, "SELECT type, name, sql FROM sqlite_master ORDER BY name")
    rows = {table: _rows(conn, sql) for table, sql in REBUILT.items()}
    conn.close()
    with open_database(file, broken) as db, pytest.raises(sqlite3.IntegrityError, match="ok = 1"):
        db.migrate()
    conn = sqlite3.connect(file)
    try:
        assert _rows(conn, "SELECT type, name, sql FROM sqlite_master ORDER BY name") == schema
        assert {table: _rows(conn, sql) for table, sql in REBUILT.items()} == rows
        assert 17 not in {v for (v,) in _rows(conn, "SELECT version FROM schema_migrations")}
    finally:
        conn.close()


def test_a_fresh_database_gets_a_strict_ai_runs_and_no_backup(tmp_path: Path) -> None:
    with open_database(tmp_path / "fresh.sqlite") as db:
        result = db.migrate()
        assert 17 in result.applied and 17 in BACKUP_BEFORE_VERSIONS and result.backups == ()
        assert db.migrate().applied == ()
    conn = sqlite3.connect(tmp_path / "fresh.sqlite")
    try:
        strict = {r[1]: r[5] for r in conn.execute("PRAGMA table_list")}
        assert strict["ai_runs"] == 1 and strict["ai_run_handles"] == 1
    finally:
        conn.close()


def _plan(conn: sqlite3.Connection, sql: str, params: tuple[str, ...]) -> str:
    return " | ".join(str(row[3]) for row in conn.execute(f"EXPLAIN QUERY PLAN {sql}", params))


def test_the_thread_read_probes_ai_runs_by_an_index_not_a_scan(tmp_path: Path) -> None:
    """``_THREAD_SELECT`` asks ``EXISTS (... ai_runs ... thread_id ... kind = 'image')`` per thread.
    Without an index on the run's thread that is a walk of the owner's runs per thread row."""
    from papertree_db.ai import _THREAD_SELECT

    for upgraded in (False, True):  # a fresh database, and one migrated up from 0016
        (tmp_path / str(upgraded)).mkdir()
        file = _at_0016(tmp_path / str(upgraded)) if upgraded else tmp_path / "fresh.sqlite"
        with open_database(file) as db:
            db.migrate()
        conn = sqlite3.connect(file)
        try:
            indexes = {
                row[1]: [c[2] for c in conn.execute(f"PRAGMA index_info({row[1]})")]
                for row in conn.execute("PRAGMA index_list(ai_runs)").fetchall()
            }
            assert ["owner_id", "thread_id", "kind"] in indexes.values(), indexes
            plan = _plan(
                conn,
                _THREAD_SELECT + " WHERE t.owner_id = ? AND t.paper_id = ? GROUP BY t.thread_id",
                ("o", "p"),
            )
            probes = [part for part in plan.split(" | ") if "ai_runs" in part]
            assert probes, plan
            assert all("USING" in part and "INDEX" in part for part in probes), plan
        finally:
            conn.close()


def _check_kinds(conn: sqlite3.Connection) -> set[str]:
    """The kinds ``ai_runs.kind``'s CHECK names, read from the stored DDL (not from the code)."""
    ddl = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'ai_runs'").fetchone()[0]
    match = re.search(r"kind\s+TEXT\s+NOT NULL CHECK \(kind IN \(([^)]*)\)\)", ddl)
    assert match is not None, ddl
    return set(re.findall(r"'([a-z]+)'", match.group(1)))


def _every_kind_is_accepted(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON")
    for kind in sorted(RUN_KINDS):
        conn.execute("UPDATE ai_runs SET kind = ? WHERE run_id = 'run_2'", (kind,))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE ai_runs SET kind = 'chat' WHERE run_id = 'run_2'")


def test_the_final_check_names_all_seven_kinds_on_a_fresh_database(tmp_path: Path) -> None:
    with open_database(tmp_path / "fresh.sqlite") as db:
        assert 17 in db.migrate().applied
    conn = sqlite3.connect(tmp_path / "fresh.sqlite")
    try:
        assert _check_kinds(conn) == {
            "explain",
            "ask",
            "summary",
            "diagram",
            "topic",
            "glance",
            "image",
        }
        assert _check_kinds(conn) == set(RUN_KINDS)  # the code's list and the schema agree
    finally:
        conn.close()


def test_a_database_at_0011_migrates_through_0017_and_keeps_glance_and_image(
    tmp_path: Path,
) -> None:
    """0013 adds ``glance``, 0017 rebuilds ``ai_runs`` again: the end state must accept both (and
    every older kind), keep every run row filled at 0011 and keep both indexes."""
    file, _owner, _paper = _populated(tmp_path, 10)  # the shared filler writes the pre-0011 shape
    with open_database(file, migrations_through(11, tmp_path / "m11")) as db:
        assert db.migrate().applied == (11,)
    conn = sqlite3.connect(file)
    before = _rows(conn, REBUILT["ai_runs"])
    conn.close()
    assert before, "the runs table held rows before"

    with open_database(file) as db:
        result = db.migrate()
        assert result.applied == (12, 13, 14, 15, 16, 17)
        assert [p.name for p in result.backups] == [
            "old.sqlite.pre-0013.bak",
            "old.sqlite.pre-0015.bak",
            "old.sqlite.pre-0017.bak",
        ]
        assert db.migrate().applied == ()

    conn = sqlite3.connect(file)
    try:
        assert _check_kinds(conn) == set(RUN_KINDS) and len(RUN_KINDS) == 7
        assert _rows(conn, REBUILT["ai_runs"]) == before
        indexes = {r[0] for r in _rows(conn, "SELECT name FROM sqlite_master WHERE type='index'")}
        assert {"ai_runs_by_owner", "ai_runs_by_thread"} <= indexes
        assert _rows(conn, "PRAGMA foreign_key_check") == []
        _every_kind_is_accepted(conn)
    finally:
        conn.close()


def test_0017_keeps_a_glance_run_written_at_0013(tmp_path: Path) -> None:
    """A run row of kind ``glance`` (0013's) survives 0017's rebuild untouched."""
    file = _at_0016(tmp_path)
    conn = sqlite3.connect(file)
    conn.execute("UPDATE ai_runs SET kind = 'glance' WHERE run_id = 'run_2'")
    conn.commit()
    conn.close()
    with open_database(file) as db:
        assert db.migrate().applied == (17,)
    conn = sqlite3.connect(file)
    try:
        assert _rows(conn, "SELECT kind FROM ai_runs WHERE run_id = 'run_2'") == [("glance",)]
    finally:
        conn.close()
