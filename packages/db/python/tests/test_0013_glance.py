"""0013_glance.sql and the cached "At a glance" sheet (v0.3 #337).

The migration over a real database with every AI table filled (it rebuilds ``ai_runs`` and its
child ``ai_run_handles`` so the run kinds gain ``glance``): every row, FK, cascade and index
survives, the widened CHECK is live, a backup is taken first, and the row-count guard is made to
fire. Then the store: one sheet per (paper, generation, prompt version), a second write does not
replace it, another owner has none, and a deleted paper takes its sheet with it.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from papertree_db import OwnerId, PaperId, PaperNotFound, PaperTreeDb, generation, open_database
from papertree_db.migrate import BACKUP_BEFORE_VERSIONS

from .saved_shapes import MIGRATIONS_DIR, load_fixture_paper, migrations_through
from .test_0011_diagrams import NOW, _populated, _rows

#: The two tables 0013 rebuilds, and one it leaves alone, each read in a stable order.
REBUILT = {
    "ai_runs": "SELECT * FROM ai_runs ORDER BY run_id",
    "ai_run_handles": "SELECT * FROM ai_run_handles ORDER BY run_id, handle",
}
UNTOUCHED = {
    "ai_threads": "SELECT * FROM ai_threads ORDER BY thread_id",
    "ai_messages": "SELECT * FROM ai_messages ORDER BY message_id",
    "ai_citations": "SELECT * FROM ai_citations ORDER BY citation_id",
}
SHEET = {"gist": "A sheet.", "problem": {"text": "P", "page": 2}}


def _at_0012(tmp_path: Path) -> Path:
    """A database at 0012 with every AI table filled: filled at 0010 (the shape the shared filler
    writes), then taken to 0012 by the migrations on the way."""
    file, _owner, _paper = _populated(tmp_path, 10)
    with open_database(file, migrations_through(12, tmp_path / "m12")) as db:
        assert db.migrate().applied == (11, 12)
    return file


def test_0013_carries_every_run_row_fk_cascade_and_index(tmp_path: Path) -> None:
    file = _at_0012(tmp_path)
    conn = sqlite3.connect(file)
    before = {table: _rows(conn, sql) for table, sql in {**REBUILT, **UNTOUCHED}.items()}
    conn.close()
    assert all(before.values()), "every table held rows before"

    with open_database(file) as db:
        result = db.migrate()
        assert result.applied == (13,)
        assert [path.name for path in result.backups] == ["old.sqlite.pre-0013.bak"]

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
        conn.execute("UPDATE ai_runs SET kind = 'glance' WHERE run_id = 'run_2'")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE ai_runs SET kind = 'chat' WHERE run_id = 'run_2'")
        # The cascade from a run to its handles still cascades through the renamed tables.
        conn.execute("DELETE FROM ai_runs WHERE run_id = 'run_1'")
        assert _rows(conn, "SELECT COUNT(*) FROM ai_run_handles") == [(0,)]
        # A message keeps its thread when a run goes (the run id there is a plain column).
        assert _rows(conn, "SELECT COUNT(*) FROM ai_messages") == [(3,)]
    finally:
        conn.close()


def test_the_row_count_guard_aborts_0013_and_leaves_the_database_as_it_was(tmp_path: Path) -> None:
    """Non-vacuity for the guard: a copy of 0013 that loses one handle in the copy must fail on the
    guard's CHECK, and the rollback must leave every table and the record unchanged."""
    file = _at_0012(tmp_path)
    broken = migrations_through(12, tmp_path / "broken")
    source = MIGRATIONS_DIR / "0013_glance.sql"
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
        assert 13 not in {v for (v,) in _rows(conn, "SELECT version FROM schema_migrations")}
    finally:
        conn.close()


def test_a_fresh_database_gets_a_strict_paper_glance_and_no_backup(tmp_path: Path) -> None:
    with open_database(tmp_path / "fresh.sqlite") as db:
        result = db.migrate()
        assert 13 in result.applied and 13 in BACKUP_BEFORE_VERSIONS and result.backups == ()
        assert db.migrate().applied == ()
    conn = sqlite3.connect(tmp_path / "fresh.sqlite")
    try:
        strict = {r[1]: r[5] for r in conn.execute("PRAGMA table_list")}
        assert strict["paper_glance"] == 1 and strict["ai_runs"] == 1
    finally:
        conn.close()


# ── the store ────────────────────────────────────────────────────────────────────────────────


class Env:
    def __init__(self, db: PaperTreeDb, owner: OwnerId, other: OwnerId, paper: PaperId) -> None:
        self.db, self.owner, self.other, self.paper = db, owner, other, paper


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    database = open_database(tmp_path / "glance.sqlite")
    database.migrate()
    owner = database.create_user("alice@papertree.test").owner
    other = database.create_user("bob@papertree.test").owner
    document = load_fixture_paper()
    database.put_paper(owner, document)
    paper = PaperId(document["paper_id"])
    database.promote_generation(owner, paper, generation(1))
    yield Env(database, owner, other, paper)
    database.close()


def test_a_stored_sheet_reads_back_parsed(env: Env) -> None:
    assert env.db.get_glance(env.owner, env.paper, 1, "glance-v1") is None
    stored = env.db.put_glance(
        env.owner, env.paper, 1, "glance-v1", model="MiniMax-M3.1-Flash", content=SHEET, run_id="r"
    )
    assert stored is True
    row = env.db.get_glance(env.owner, env.paper, 1, "glance-v1")
    assert row is not None
    assert (row["model"], row["content"], row["run_id"]) == ("MiniMax-M3.1-Flash", SHEET, "r")
    assert str(row["created_at"]).startswith("20")
    # The key is the generation and the prompt: another of either has none.
    assert env.db.get_glance(env.owner, env.paper, 2, "glance-v1") is None
    assert env.db.get_glance(env.owner, env.paper, 1, "glance-v2") is None


def test_a_second_sheet_never_replaces_the_first(env: Env) -> None:
    env.db.put_glance(env.owner, env.paper, 1, "glance-v1", model="m1", content=SHEET, run_id=None)
    again = env.db.put_glance(
        env.owner, env.paper, 1, "glance-v1", model="m2", content={"gist": "Other."}, run_id=None
    )
    assert again is False
    row = env.db.get_glance(env.owner, env.paper, 1, "glance-v1")
    assert row is not None and (row["model"], row["content"]) == ("m1", SHEET)


def test_another_owner_has_no_sheet_and_cannot_write_one(env: Env) -> None:
    env.db.put_glance(env.owner, env.paper, 1, "glance-v1", model="m", content=SHEET, run_id=None)
    assert env.db.get_glance(env.other, env.paper, 1, "glance-v1") is None
    with pytest.raises(PaperNotFound):
        env.db.put_glance(
            env.other, env.paper, 1, "glance-v1", model="m", content=SHEET, run_id=None
        )


def test_a_blank_key_is_refused(env: Env) -> None:
    for generation_, version, model in ((0, "glance-v1", "m"), (1, "", "m"), (1, "glance-v1", "")):
        with pytest.raises(ValueError):
            env.db.put_glance(
                env.owner,
                env.paper,
                generation_,
                version,
                model=model,
                content=SHEET,
                run_id=None,
            )


def test_deleting_the_paper_takes_its_sheet(env: Env, tmp_path: Path) -> None:
    env.db.put_glance(env.owner, env.paper, 1, "glance-v1", model="m", content=SHEET, run_id=None)
    env.db.delete_paper(env.owner, env.paper)
    conn = sqlite3.connect(tmp_path / "glance.sqlite")
    try:
        assert conn.execute("SELECT COUNT(*) FROM paper_glance").fetchone()[0] == 0
    finally:
        conn.close()
    assert NOW  # (imported for the shared fixtures' time)
