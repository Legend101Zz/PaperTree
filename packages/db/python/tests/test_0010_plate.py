"""0010_plate.sql and the cover plate's data layer (v0.2 S3, #200).

The migration on real databases (fresh; and an EXISTING database already at 0011, which must still
get 0010 although it arrives after 0011); the table's own rules when the API is bypassed; the
store; the rule that finds the chosen figure in a generation (by its BlockSelector, else by its
ShapeSelector's box after a re-parse retired the id, else nothing); and the library row, which
carries the plate and the notebook count in its ONE statement. Papers are the committed
``resnet-cvpr-2col`` fixture written through ``put_paper``, so the figures, captions and
``caption_of`` relations are a real producer's.
"""

from __future__ import annotations

import copy
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from papertree_db import OwnerId, PaperId, PaperNotFound, PaperTreeDb, generation, open_database
from papertree_db.migrate import BACKUP_BEFORE_VERSIONS, migrate

from .saved_shapes import (
    HEAD_VERSIONS,
    MIGRATIONS_DIR,
    load_fixture_paper,
    migrations_through,
    raw_connect,
)

#: The fixture's Figure 1 (p. 1) and its caption, and a paragraph (not a figure).
FIGURE_1 = "blk_3pzzcn4luvb5qmpc"
FIGURE_1_BOX = [309.0, 224.0, 545.0, 302.0]
FIGURE_2 = "blk_vd6i5hijwlkso3vs"
PARAGRAPH = "blk_msygx2kaxvek74qq"


def _anchor(paper_id: str, block_id: str | None, box: list[float] | None, page: int = 0) -> Any:
    """The selectors the rule reads, in the shape `capture_anchor` writes them."""
    selectors: list[dict[str, Any]] = []
    if block_id is not None:
        selectors.append({"type": "BlockSelector", "blockId": block_id, "blockTextHash": ""})
    selectors.append({"type": "PageSelector", "index": page})
    if box is not None:
        selectors.append(
            {
                "type": "ShapeSelector",
                "pageIndex": page,
                "quads": [box],
                "polygons": [],
                "pageWidth": 612.0,
                "pageHeight": 792.0,
                "rotation": 0,
                "userUnit": 1.0,
                "cropBox": [0.0, 0.0, 612.0, 792.0],
            }
        )
    return {"doc": {"paperId": paper_id}, "targetKind": "figure", "selectors": selectors}


Env = tuple[PaperTreeDb, OwnerId, PaperId]


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    """A migrated file holding one user and the fixture paper, promoted."""
    database = open_database(tmp_path / "plate.sqlite")
    database.migrate()
    owner = database.create_user("reader@papertree.test").owner
    document = load_fixture_paper()
    database.put_paper(owner, document)
    paper = PaperId(document["paper_id"])
    database.promote_generation(owner, paper, generation(1))
    yield database, owner, paper
    database.close()


# ── the migration ─────────────────────────────────────────────────────────────────────────


def test_a_fresh_database_gets_a_strict_paper_plate(tmp_path: Path) -> None:
    with open_database(tmp_path / "fresh.sqlite") as db:
        result = db.migrate()
    assert 10 in result.applied and result.backups == ()
    conn = sqlite3.connect(tmp_path / "fresh.sqlite")
    try:
        strict = {r[1]: r[5] for r in conn.execute("PRAGMA table_list")}
        assert strict["paper_plate"] == 1
    finally:
        conn.close()


def test_a_database_already_at_0011_still_gets_0010(tmp_path: Path) -> None:
    """0010 merged after 0011: the runner applies a missing LOWER version, nothing else, no backup.

    The database is built from every file but 0010 (what a data root migrated before this slice
    holds), with a user, a parsed paper and a reading state in it.
    """
    without = migrations_through(11, tmp_path / "m11")
    (without / "0010_plate.sql").unlink()
    file = tmp_path / "at11.sqlite"
    with open_database(file, without) as db:
        assert 10 not in db.migrate().head
        owner = db.create_user("reader@papertree.test").owner
        document = load_fixture_paper()
        db.put_paper(owner, document)
        db.promote_generation(owner, PaperId(document["paper_id"]), generation(1))
        db.put_reading_state(owner, PaperId(document["paper_id"]), 0)
    conn = raw_connect(file)
    try:
        before = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in _COUNTED}
        result = migrate(conn, MIGRATIONS_DIR)
        assert result.applied == (10,)
        assert result.head == HEAD_VERSIONS
        assert result.backups == () and 10 not in BACKUP_BEFORE_VERSIONS
        assert {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in _COUNTED} == (
            before
        )
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "paper_plate" in tables
        assert migrate(conn, MIGRATIONS_DIR).applied == ()  # and once is enough
    finally:
        conn.close()


_COUNTED = ("users", "paper_owners", "papers", "blocks", "relations", "reading_state")


def test_the_table_refuses_what_the_api_would(env: Env, tmp_path: Path) -> None:
    _db, _owner, paper = env
    conn = raw_connect(tmp_path / "plate.sqlite")
    try:
        user = conn.execute("SELECT user_id FROM users").fetchone()[0]
        insert = (
            "INSERT INTO paper_plate (owner_id, paper_id, anchor_json, chosen_at) "
            "VALUES (?, ?, ?, 'n')"
        )
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):  # another paper's anchor
            conn.execute(insert, (user, paper, '{"doc":{"paperId":"ppr_OTHER"}}'))
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):  # not JSON at all
            conn.execute(insert, (user, paper, "{nope"))
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):  # owner is in the FK
            conn.execute(insert, ("usr_someone_else", paper, f'{{"doc":{{"paperId":"{paper}"}}}}'))
        conn.execute(insert, (user, paper, f'{{"doc":{{"paperId":"{paper}"}}}}'))
        conn.execute("DELETE FROM paper_owners WHERE paper_id = ?", (paper,))  # cascades
        assert conn.execute("SELECT COUNT(*) FROM paper_plate").fetchone()[0] == 0
    finally:
        conn.close()


# ── the store ─────────────────────────────────────────────────────────────────────────────


def test_set_get_and_clear(env: Env) -> None:
    db, owner, paper = env
    assert db.get_plate(owner, paper) is None
    first = _anchor(paper, FIGURE_1, FIGURE_1_BOX)
    db.set_plate(owner, paper, first)
    assert db.get_plate(owner, paper) == first
    second = _anchor(paper, FIGURE_2, None, page=1)
    db.set_plate(owner, paper, second)  # a second choice replaces the first
    assert db.get_plate(owner, paper) == second
    assert db.clear_plate(owner, paper) is True
    assert db.clear_plate(owner, paper) is False
    assert db.get_plate(owner, paper) is None
    with pytest.raises(ValueError, match="another paper"):
        db.set_plate(owner, paper, _anchor("ppr_OTHER", FIGURE_1, None))
    with pytest.raises(PaperNotFound):
        missing = PaperId("ppr_00000000000000000000000000")
        db.set_plate(owner, missing, _anchor(missing, FIGURE_1, None))


def test_another_owner_can_neither_read_nor_write_nor_clear_it(
    env: Env,
) -> None:
    db, owner, paper = env
    db.set_plate(owner, paper, _anchor(paper, FIGURE_1, FIGURE_1_BOX))
    stranger = db.create_user("stranger@papertree.test").owner
    assert db.get_plate(stranger, paper) is None
    assert db.clear_plate(stranger, paper) is False
    with pytest.raises(PaperNotFound):
        db.set_plate(stranger, paper, _anchor(paper, FIGURE_2, None))
    assert db.plate_figure(stranger, paper, generation(1), _anchor(paper, FIGURE_1, None)) is None
    assert db.library_row(stranger, paper) is None
    plate = db.library_row(owner, paper).plate  # type: ignore[union-attr]
    assert plate is not None and plate.block_id == FIGURE_1


# ── finding the figure ────────────────────────────────────────────────────────────────────


def test_the_block_selector_finds_a_figure_and_only_a_figure(
    env: Env,
) -> None:
    db, owner, paper = env
    gen = generation(1)
    assert db.plate_figure(owner, paper, gen, _anchor(paper, FIGURE_1, None)) == FIGURE_1
    assert db.plate_figure(owner, paper, gen, _anchor(paper, FIGURE_2, None, page=1)) == FIGURE_2
    assert db.plate_figure(owner, paper, gen, _anchor(paper, PARAGRAPH, None)) is None
    assert db.plate_figure(owner, paper, gen, _anchor(paper, None, None)) is None
    assert db.plate_figure(owner, paper, generation(2), _anchor(paper, FIGURE_1, None)) is None


def test_after_a_reparse_retired_the_id_the_stored_box_still_finds_it(
    env: Env,
) -> None:
    """A re-parse mints content-derived ids anew; the quad is PDF space and survives it."""
    db, owner, paper = env
    gen = generation(1)
    moved = [v + 3.0 for v in FIGURE_1_BOX]  # re-cropped by a few points: still that figure
    assert db.plate_figure(owner, paper, gen, _anchor(paper, "blk_gone", moved)) == FIGURE_1
    # A box overlapping it by less than half (IoU < 0.5) is not "the same figure".
    x0, y0, x1, y1 = FIGURE_1_BOX
    sliver = [x1 - 40.0, y0, x1 + 160.0, y1]
    assert db.plate_figure(owner, paper, gen, _anchor(paper, "blk_gone", sliver)) is None
    # The right box on the wrong page finds nothing.
    assert db.plate_figure(owner, paper, gen, _anchor(paper, "blk_gone", moved, page=1)) is None
    # A stale id that now names a NON-figure falls through to the box, which wins.
    assert db.plate_figure(owner, paper, gen, _anchor(paper, PARAGRAPH, moved)) == FIGURE_1


# ── the library row ───────────────────────────────────────────────────────────────────────


def test_the_library_row_carries_the_plate_and_the_notebook_count(
    env: Env,
) -> None:
    db, owner, paper = env
    row = db.library_row(owner, paper)
    assert row is not None and row.plate is None and row.notebook_count == 0
    db.set_plate(owner, paper, _anchor(paper, FIGURE_1, FIGURE_1_BOX))
    db.create_notebook_page(owner, paper, page_id="np_01")
    db.create_notebook_page(owner, paper, page_id="np_02")
    row = db.library_row(owner, paper)
    assert row is not None and row.notebook_count == 2
    assert row.plate is not None
    assert (row.plate.block_id, row.plate.page_index) == (FIGURE_1, 0)
    assert row.plate.image_uri == f"fixture://resnet-cvpr-2col/figures/{FIGURE_1}@4x.png"
    assert (row.plate.caption_text or "").startswith("Figure 1. Training error")
    # A plate whose figure is not in the promoted parse is no plate (the typographic cover).
    db.set_plate(owner, paper, _anchor(paper, "blk_gone", [0.0, 0.0, 1.0, 1.0]))
    row = db.library_row(owner, paper)
    assert row is not None and row.plate is None


def test_listing_papers_with_plates_is_one_statement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
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
        base = load_fixture_paper()
        for n in range(20):
            document = copy.deepcopy(base)
            document["paper_id"] = f"ppr_{n:026d}"
            document["source_hash"] = "sha256:" + f"{n:064x}"
            database.put_paper(owner, document)
            paper = PaperId(document["paper_id"])
            database.promote_generation(owner, paper, generation(1))
            database.set_plate(owner, paper, _anchor(paper, "blk_gone", FIGURE_1_BOX))
        statements.clear()
        rows = database.list_library(owner)
        # Every plate found by its box (the id is gone), so both rungs ran for every paper.
        assert len(rows) == 20 and all(r.plate is not None for r in rows)
        assert len(statements) == 1, statements
    finally:
        database.close()
