"""0012_paper_title.sql and the name a person gives a paper (v0.3 #337).

The migration on a fresh database and on one already at 0011 (it applies alone, with no backup);
the store (trimmed, replaced, 1 to 300 characters, owner-scoped); the library row that carries
the name next to the parsed title; and the cascade when the paper is deleted.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from papertree_db import OwnerId, PaperId, PaperNotFound, PaperTreeDb, generation, open_database
from papertree_db.migrate import BACKUP_BEFORE_VERSIONS, migrate

from .saved_shapes import (
    load_fixture_paper,
    migrations_through,
    raw_connect,
)

Env = tuple[PaperTreeDb, OwnerId, PaperId]


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    database = open_database(tmp_path / "title.sqlite")
    database.migrate()
    owner = database.create_user("reader@papertree.test").owner
    document = load_fixture_paper()
    database.put_paper(owner, document)
    paper = PaperId(document["paper_id"])
    database.promote_generation(owner, paper, generation(1))
    yield database, owner, paper
    database.close()


def test_a_fresh_database_gets_a_strict_paper_title(tmp_path: Path) -> None:
    with open_database(tmp_path / "fresh.sqlite") as db:
        result = db.migrate()
    assert 12 in result.applied and 12 not in BACKUP_BEFORE_VERSIONS
    conn = sqlite3.connect(tmp_path / "fresh.sqlite")
    try:
        strict = {r[1]: r[5] for r in conn.execute("PRAGMA table_list")}
        assert strict["paper_title"] == 1
    finally:
        conn.close()


def test_a_database_at_0011_gets_0012_alone_without_a_backup(tmp_path: Path) -> None:
    file = tmp_path / "at11.sqlite"
    with open_database(file, migrations_through(11, tmp_path / "m11")) as db:
        db.migrate()
        owner = db.create_user("reader@papertree.test").owner
        document = load_fixture_paper()
        db.put_paper(owner, document)
    conn = raw_connect(file)
    try:
        # Through 0012 only: later migrations (some rebuild tables and take their own backups) are
        # other tests' business, and this one is about 0012 landing alone without a backup.
        result = migrate(conn, migrations_through(12, tmp_path / "m12"))
        assert result.applied == (12,) and result.head[-1] == 12
        assert result.backups == ()
        assert conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0] == 1
    finally:
        conn.close()


def test_the_library_row_carries_the_name_beside_the_parsed_title(env: Env) -> None:
    db, owner, paper = env
    parsed = db.library_row(owner, paper)
    assert parsed is not None and parsed.custom_title is None and parsed.title is not None

    assert db.set_paper_title(owner, paper, "  Skip notes  ") == "Skip notes"

    row = db.library_row(owner, paper)
    assert row is not None
    assert (row.custom_title, row.title) == ("Skip notes", parsed.title)
    assert [r.custom_title for r in db.list_library(owner)] == ["Skip notes"]
    db.set_paper_title(owner, paper, "Second")
    assert db.library_row(owner, paper).custom_title == "Second"  # type: ignore[union-attr]


@pytest.mark.parametrize("title", ["", "   ", "x" * 301])
def test_a_title_the_api_would_refuse_is_refused_here_too(env: Env, title: str) -> None:
    db, owner, paper = env
    with pytest.raises(ValueError, match="1 to 300"):
        db.set_paper_title(owner, paper, title)
    row = db.library_row(owner, paper)
    assert row is not None and row.custom_title is None


def test_another_owner_cannot_name_the_paper_and_deleting_it_drops_the_name(
    env: Env, tmp_path: Path
) -> None:
    db, owner, paper = env
    stranger = db.create_user("stranger@papertree.test").owner
    with pytest.raises(PaperNotFound):
        db.set_paper_title(stranger, paper, "Mine")
    db.set_paper_title(owner, paper, "Skip notes")
    db.delete_paper(owner, paper)
    conn = raw_connect(tmp_path / "title.sqlite")
    try:
        assert conn.execute("SELECT COUNT(*) FROM paper_title").fetchone()[0] == 0
    finally:
        conn.close()
    assert db.library_row(owner, paper) is None
