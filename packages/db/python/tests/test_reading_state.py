"""0006 and its two additions: reading state (#192) and the user's display name.

Covers the migration (fresh, and on a saved 0005 database with data), the upsert rules (the
furthest page only grows, ``finished_at`` is never cleared), the progress rule, the read-time
derivations the library row carries (arXiv year and category), owner isolation, and that listing
a ~400-paper library is one fixed set of queries rather than one per paper.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from papertree_db import (
    DISPLAY_NAME_MAX,
    OwnerId,
    PaperId,
    PaperNotFound,
    PaperTreeDb,
    find_migrations_dir,
    generation,
    migrate,
    open_database,
    progress_state,
    reached_last_page,
)
from papertree_db.library import arxiv_year, stamp_category
from papertree_db.migrate import BACKUP_BEFORE_VERSIONS

from .fixtures import block_id_for, make_paper
from .saved_shapes import HEAD_VERSIONS, migrations_through, raw_connect

HASH = "sha256:" + "a" * 64
PAPER = PaperId("ppr_AAAAAAAAAAAAAAAAAAAAAAAAAA")


@pytest.fixture
def db(tmp_path: Path) -> Iterator[PaperTreeDb]:
    database = open_database(tmp_path / "reading.sqlite")
    database.migrate()
    yield database
    database.close()


def backup_suffixes(result: object) -> list[str]:
    """The ``NNNN.bak`` tail of each pre-migration copy the run wrote, in order."""
    return [b.name.rsplit(".pre-", 1)[-1] for b in result.backups]  # type: ignore[attr-defined]


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
        assert result.applied == tuple(v for v in HEAD_VERSIONS if v >= 6)
        assert backup_suffixes(result) == [
            f"{v:04d}.bak" for v in sorted(BACKUP_BEFORE_VERSIONS) if v in result.applied
        ]  # only the rebuilding migrations (0008) are backed up, not 0006/0007
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


def test_arxiv_year_is_the_first_submission_and_null_when_unsure() -> None:
    assert arxiv_year("1706.03762") == 2017
    assert arxiv_year("1706.03762v7") == 2017
    assert arxiv_year("2006.11239") == 2020
    assert arxiv_year("0704.0001") == 2007  # the scheme's first month
    assert arxiv_year("0703.0001") is None  # 0701-0703 are not new-style ids
    assert arxiv_year("0612.0001") is None  # before the scheme: null, not the stamp's year
    assert arxiv_year("1713.00001") is None  # no month 13
    assert arxiv_year("hep-th/9901001") == 1999  # old style
    assert arxiv_year("math.GT/0309136") == 2003
    assert arxiv_year("astro-ph/9205001") == 1992
    assert arxiv_year("hep-th/0704001") is None  # old style ended with 0703
    assert arxiv_year("Smith (1998)") is None and arxiv_year(None) is None


@pytest.mark.parametrize(
    ("category"),
    [
        "cs.CL",
        "stat.ML",
        "math.OC",
        "hep-th",
        "q-bio.NC",
        "astro-ph.GA",
        "eess.IV",
        "physics.optics",
    ],
)
def test_stamp_category_accepts_real_categories_next_to_the_id(category: str) -> None:
    text = f"arXiv:1706.03762v7  [{category}]  2 Aug 2023"
    assert stamp_category(text, "1706.03762") == category


def test_stamp_category_is_null_unless_it_is_a_category_next_to_the_id() -> None:
    assert stamp_category("arXiv:1706.03762v7 [sic] 2 Aug 2023", "1706.03762") is None
    assert stamp_category("arXiv:1706.03762v7 [cs] 2 Aug 2023", "1706.03762") is None
    assert stamp_category("arXiv:1706.03762v7 2 Aug 2023", "1706.03762") is None
    # A category elsewhere in the block, or after a different id, is not this paper's.
    assert stamp_category("see [cs.CL] and arXiv:1706.03762v7 2 Aug", "1706.03762") is None
    assert stamp_category("arXiv:1810.04805v2 [cs.CL] 1 Jan", "1706.03762") is None
    assert stamp_category("arXiv:1706.03762v7 [cs.CL]", None) is None
    assert stamp_category(None, "1706.03762") is None


# ── the library row on promoted papers: counts, facts, statements ─────────────────────────


def _promoted(db: PaperTreeDb, owner: OwnerId, n: int, *, stamp: bool = True) -> PaperId:
    """A promoted generation with 12 blocks; block 0 is an arXiv margin stamp when ``stamp``."""
    paper_id = f"ppr_{n:026d}"
    paper = make_paper(paper_id, "sha256:" + f"{n:064x}", 1, block_count=12, page_count=10)
    if stamp:
        paper["blocks"][0]["text"] = "arXiv:1706.03762v7  [cs.CL]  2 Aug 2023"
        paper["metadata"]["arxiv_id"] = {
            "value": "1706.03762",
            "source_block_id": block_id_for(0),
            "confidence": 0.6,
        }
        paper["metadata"]["year"] = {
            "value": 2023,
            "source_block_id": block_id_for(0),
            "confidence": 0.6,
        }
    db.put_paper(owner, paper)
    db.promote_generation(owner, PaperId(paper_id), generation(1))
    return PaperId(paper_id)


def _thread(db: PaperTreeDb, owner: OwnerId, paper_id: PaperId, n: int) -> None:
    db.create_thread(
        owner, paper_id, thread_id=f"thr_{n:026d}", kind="ask", title="Q", origin_anchor=None
    )


def test_row_facts_come_from_the_id_not_the_parsers_year(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    stamped = _promoted(db, owner, 1)
    plain = _promoted(db, owner, 2, stamp=False)
    row = db.library_row(owner, stamped)
    assert row is not None
    assert (row.year, row.arxiv_id, row.arxiv_category) == (2017, "1706.03762", "cs.CL")
    none = db.library_row(owner, plain)
    assert none is not None
    assert (none.year, none.arxiv_id, none.arxiv_category) == (None, None, None)


def test_thread_count_and_has_summary_are_per_paper_and_per_owner(db: PaperTreeDb) -> None:
    alice = db.create_user("a@b.test").owner
    bob = db.create_user("c@d.test").owner
    a1, a2 = _promoted(db, alice, 1), _promoted(db, alice, 2)
    b1 = _promoted(db, bob, 3)
    _thread(db, alice, a1, 1)
    _thread(db, alice, a1, 2)
    _thread(db, bob, b1, 3)  # another owner's thread must not count for alice
    db.put_summary(
        alice,
        a1,
        generation(1),
        prompt_hash="summary-v1",
        model_id="m",
        content={"status": "complete", "bullets": []},
        derived_from=[block_id_for(0)],
    )
    rows = {r.paper_id: r for r in db.list_library(alice)}
    assert (rows[a1].thread_count, rows[a1].has_summary) == (2, True)
    assert (rows[a2].thread_count, rows[a2].has_summary) == (0, False)
    (bob_row,) = db.list_library(bob)
    assert (bob_row.thread_count, bob_row.has_summary) == (1, False)


def test_a_finished_row_always_has_a_finished_at(db: PaperTreeDb) -> None:
    """Written while the page count was unknown, read after it arrived: finished, and timed."""
    owner = db.create_user("a@b.test").owner
    paper = _paper(db, owner, pages=None)
    db.put_reading_state(owner, paper, 9)
    db.register_upload(owner, paper, "sha256:" + f"{0:064x}", "p0.pdf", 1, 10)
    state = db.get_reading_state(owner, paper)
    assert state is not None and state.state == "finished"
    assert state.finished_at == state.updated_at


def test_listing_400_promoted_papers_is_one_statement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every paper has blocks, a stamp, a thread, a summary and a reading state, so every new
    subquery runs. ``list_library`` must still be ONE statement (sqlite's trace callback sees each
    statement the connection runs, not a subquery), whatever the library's size."""
    statements: list[str] = []
    real_connect = sqlite3.connect

    def counting_connect(*args: Any, **kwargs: Any) -> sqlite3.Connection:
        conn: sqlite3.Connection = real_connect(*args, **kwargs)
        conn.set_trace_callback(statements.append)
        return conn

    monkeypatch.setattr(sqlite3, "connect", counting_connect)
    database = open_database(tmp_path / "many.sqlite")
    database.migrate()
    try:
        owner = database.create_user("a@b.test").owner
        for n in range(400):
            paper = _promoted(database, owner, n)
            _thread(database, owner, paper, n)
            database.put_summary(
                owner,
                paper,
                generation(1),
                prompt_hash="summary-v1",
                model_id="m",
                content={"status": "complete", "bullets": []},
                derived_from=[block_id_for(0)],
            )
            database.put_reading_state(owner, paper, n % 10)
        statements.clear()
        rows = database.list_library(owner)
    finally:
        database.close()
    assert len(rows) == 400
    assert all(r.thread_count == 1 and r.has_summary and r.reading for r in rows)
    assert all(r.year == 2017 and r.arxiv_category == "cs.CL" for r in rows)
    selects = [s for s in statements if s.lstrip().upper().startswith(("SELECT", "WITH"))]
    assert len(statements) == 1 and len(selects) == 1, statements[:5]


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
