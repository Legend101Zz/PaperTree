"""0006 and its two additions: reading state (#192) and the user's display name.

Covers the migration (fresh, and on a saved 0005 database with data), the upsert rules (the
furthest page only grows, ``finished_at`` is never cleared), the progress rule, the read-time
derivations the library row carries (arXiv year and category), owner isolation, and that listing
a ~400-paper library is one fixed set of queries rather than one per paper.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from papertree_db import (
    DISPLAY_NAME_MAX,
    OwnerId,
    PaperId,
    PaperNotFound,
    PaperTreeDb,
    find_migrations_dir,
    migrate,
    open_database,
    progress_state,
    reached_last_page,
)
from papertree_db.library import arxiv_year, stamp_category

from .saved_shapes import migrations_through, raw_connect

HASH = "sha256:" + "a" * 64
PAPER = PaperId("ppr_AAAAAAAAAAAAAAAAAAAAAAAAAA")


@pytest.fixture
def db(tmp_path: Path) -> Iterator[PaperTreeDb]:
    database = open_database(tmp_path / "reading.sqlite")
    database.migrate()
    yield database
    database.close()


def _paper(db: PaperTreeDb, owner: OwnerId, pages: int | None = 10, n: int = 0) -> PaperId:
    paper_id = PaperId(f"ppr_{n:026d}")
    db.register_upload(owner, paper_id, "sha256:" + f"{n:064x}", f"p{n}.pdf", 1, pages)
    return paper_id


# ── the migration ─────────────────────────────────────────────────────────────────────────


def test_0006_on_a_fresh_database(db: PaperTreeDb, tmp_path: Path) -> None:
    conn = raw_connect(tmp_path / "reading.sqlite")
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "reading_state" in tables
        users = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
        assert "display_name" in users
        fks = list(conn.execute("PRAGMA foreign_key_list(reading_state)"))
        assert {(r["from"], r["table"]) for r in fks} == {
            ("owner_id", "paper_owners"),
            ("paper_id", "paper_owners"),
        }
    finally:
        conn.close()


def test_0006_keeps_the_rows_of_a_saved_0005_database(tmp_path: Path) -> None:
    file = tmp_path / "saved.sqlite"
    conn = raw_connect(file)
    try:
        assert migrate(conn, migrations_through(5, tmp_path / "m5")).head == (1, 2, 3, 4, 5)
        conn.execute("INSERT INTO users VALUES ('usr_1', 'a@b.test', '2026-01-01T00:00:00Z')")
        conn.execute(
            "INSERT INTO paper_owners (paper_id, owner_id, source_hash, created_at) "
            "VALUES ('ppr_x', 'usr_1', ?, '2026-01-01T00:00:00Z')",
            (HASH,),
        )
        result = migrate(conn, find_migrations_dir())
        assert result.applied == (6,) and result.backups == ()
        assert conn.execute("SELECT email, display_name FROM users").fetchone()[:] == (
            "a@b.test",
            None,
        )
        assert conn.execute("SELECT COUNT(*) FROM paper_owners").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM reading_state").fetchone()[0] == 0
    finally:
        conn.close()


# ── the rule ──────────────────────────────────────────────────────────────────────────────


def test_the_progress_rule() -> None:
    assert progress_state(3, 10, None) == "reading"
    assert progress_state(9, 10, None) == "finished"  # reached the last page (zero-based)
    assert progress_state(2, 10, "2026-01-01T00:00:00Z") == "finished"  # set explicitly
    assert progress_state(99, None, None) == "reading"  # length unknown: nothing is "last"
    assert not reached_last_page(0, 0)


# ── the upsert ────────────────────────────────────────────────────────────────────────────


def test_furthest_page_only_grows_and_finished_is_never_cleared(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    paper = _paper(db, owner)
    assert db.get_reading_state(owner, paper) is None  # not started: no row

    first = db.put_reading_state(owner, paper, 3, "guided")
    assert (first.last_page, first.furthest_page, first.state) == (3, 3, "reading")
    assert first.page_count == 10 and first.finished_at is None

    back = db.put_reading_state(owner, paper, 1)  # scrolled back; no mode keeps "guided"
    assert (back.last_page, back.furthest_page, back.mode) == (1, 3, "guided")

    done = db.put_reading_state(owner, paper, 9)
    assert done.state == "finished" and done.finished_at is not None
    again = db.put_reading_state(owner, paper, 0)
    assert (again.last_page, again.furthest_page, again.state) == (0, 9, "finished")
    assert again.finished_at == done.finished_at  # never cleared, never re-stamped
    assert again.updated_at >= done.updated_at


def test_a_paper_can_be_marked_finished_explicitly(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    paper = _paper(db, owner)
    assert db.put_reading_state(owner, paper, 2, finished=True).state == "finished"


def test_an_unknown_page_count_never_finishes_by_itself(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    paper = _paper(db, owner, pages=None)
    state = db.put_reading_state(owner, paper, 500)
    assert (state.page_count, state.state) == (None, "reading")


def test_bad_pages_and_foreign_papers_are_refused(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    other = db.create_user("c@d.test").owner
    paper = _paper(db, owner)
    for bad in (-1, 10):  # 10 pages: the last index is 9
        with pytest.raises(ValueError):
            db.put_reading_state(owner, paper, bad)
    with pytest.raises(ValueError):
        db.put_reading_state(owner, paper, 1, "bogus")
    with pytest.raises(PaperNotFound):
        db.put_reading_state(other, paper, 1)
    assert db.get_reading_state(other, paper) is None
    assert db.get_reading_state(owner, paper) is None  # nothing was written by the refusals


def test_reading_state_is_private_to_its_owner(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    other = db.create_user("c@d.test").owner
    paper = _paper(db, owner)
    db.put_reading_state(owner, paper, 4)
    assert db.get_reading_state(other, paper) is None
    assert [r.reading for r in db.list_library(other)] == []
    (row,) = db.list_library(owner)
    assert row.reading is not None and row.reading.last_page == 4


# ── the library row ───────────────────────────────────────────────────────────────────────


def test_the_library_row_carries_reading_and_the_new_facts(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    paper = _paper(db, owner)
    row = db.library_row(owner, paper)
    assert row is not None and row.reading is None
    assert (row.year, row.arxiv_id, row.arxiv_category) == (None, None, None)
    assert (row.thread_count, row.has_summary) == (0, False)
    db.put_reading_state(owner, paper, 9)
    row = db.library_row(owner, paper)
    assert row is not None and row.reading is not None and row.reading.state == "finished"


def test_arxiv_year_is_the_first_submission_not_the_stamp_date() -> None:
    assert arxiv_year("1706.03762") == 2017
    assert arxiv_year("1706.03762v7") == 2017
    assert arxiv_year("2006.11239") == 2020
    assert arxiv_year("0704.0001") == 2007
    assert arxiv_year("0612.0001") is None  # before the new-style scheme
    assert arxiv_year("1713.00001") is None  # no month 13
    assert arxiv_year("hep-th/9901001") is None and arxiv_year(None) is None


def test_stamp_category_reads_the_bracketed_primary_category() -> None:
    assert stamp_category("arXiv:1706.03762v7  [cs.CL]  2 Aug 2023") == "cs.CL"
    assert stamp_category("arXiv:2006.11239v2 [cs.LG] 16 Dec 2020") == "cs.LG"
    assert stamp_category("arXiv:hep-th/9901001v1 [hep-th] 1 Jan 1999") == "hep-th"
    assert stamp_category("arXiv:1706.03762v7 2 Aug 2023") is None
    assert stamp_category(None) is None


def test_a_400_paper_library_lists_in_a_fixed_number_of_queries(db: PaperTreeDb) -> None:
    """The list is ONE statement whatever the library's size (the counts are subqueries and the
    reading state a join), so the time grows with the rows, not with a query per row. The bound is
    generous on purpose: AGENTS.md §4, timing tests flake under load."""
    owner = db.create_user("a@b.test").owner
    for n in range(400):
        paper = _paper(db, owner, pages=10, n=n)
        if n % 2:
            db.put_reading_state(owner, paper, n % 10)
    started = time.perf_counter()
    rows = db.list_library(owner)
    elapsed = time.perf_counter() - started
    assert len(rows) == 400
    assert sum(r.reading is not None for r in rows) == 200
    assert elapsed < 3.0, f"listing 400 papers took {elapsed:.2f}s"


# ── the display name ──────────────────────────────────────────────────────────────────────


def test_display_name_set_trim_and_bounds(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    other = db.create_user("c@d.test").owner
    assert db.get_display_name(owner) is None  # never derived from the email
    assert db.set_display_name(owner, "  Ada  ") == "Ada"
    assert db.get_display_name(owner) == "Ada"
    assert db.get_display_name(other) is None  # isolation
    assert db.set_display_name(owner, "x" * DISPLAY_NAME_MAX) == "x" * DISPLAY_NAME_MAX
    for bad in ("", "   ", "x" * (DISPLAY_NAME_MAX + 1)):
        with pytest.raises(ValueError):
            db.set_display_name(owner, bad)
    assert db.get_display_name(owner) == "x" * DISPLAY_NAME_MAX
