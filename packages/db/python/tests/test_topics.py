"""0009 and the topics data layer (#193 part 1).

Covers the migration (fresh, and on a saved 0006 database with data, with the expected version list
DERIVED from the migrations directory so it still holds once 0007 and 0008 merge), the pure
suggestion rule, topic CRUD and the case-insensitive name rule, accept / reject / unshelve and
what each keeps, the delete trigger, owner isolation, and `LibraryRow.topic`.

The arXiv categories of REAL parsed papers (cs.CL for Attention and BERT, cs.LG for DDPM) are
exercised end to end in `services/api/python/tests/test_topics_api.py`; here a paper has no
category, so the data-layer tests drive the rule with `Holding`s.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from papertree_db import (
    CLOTHS,
    Holding,
    OwnerId,
    PaperId,
    PaperNotFound,
    PaperTreeDb,
    TopicExists,
    TopicNotFound,
    TopicSuggestion,
    find_migrations_dir,
    load_migrations,
    migrate,
    open_database,
    suggest_by_category,
)

from .saved_shapes import migrations_through, raw_connect

HASH = "sha256:" + "a" * 64


@pytest.fixture
def db(tmp_path: Path) -> Iterator[PaperTreeDb]:
    database = open_database(tmp_path / "topics.sqlite")
    database.migrate()
    yield database
    database.close()


def _paper(db: PaperTreeDb, owner: OwnerId, n: int = 0, pages: int | None = 10) -> PaperId:
    paper_id = PaperId(f"ppr_{n:026d}")
    db.register_upload(owner, paper_id, "sha256:" + f"{n:064x}", f"p{n}.pdf", 1, pages)
    return paper_id


# ── the migration ─────────────────────────────────────────────────────────────────────────


def test_0009_on_a_fresh_database(db: PaperTreeDb, tmp_path: Path) -> None:
    conn = raw_connect(tmp_path / "topics.sqlite")
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert {"topics", "paper_topics"} <= tables
        fks = {
            (r["from"], r["table"]) for r in conn.execute("PRAGMA foreign_key_list(paper_topics)")
        }
        # Every FK between owned tables carries owner_id (0001 rule).
        assert fks == {
            ("owner_id", "paper_owners"),
            ("paper_id", "paper_owners"),
            ("owner_id", "topics"),
            ("topic_id", "topics"),
        }
        triggers = {
            r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='trigger'")
        }
        assert "topics_before_delete" in triggers
    finally:
        conn.close()


def test_0009_keeps_the_rows_of_a_saved_0006_database(tmp_path: Path) -> None:
    conn = raw_connect(tmp_path / "saved.sqlite")
    try:
        migrate(conn, migrations_through(6, tmp_path / "m6"))
        conn.execute(
            "INSERT INTO users VALUES ('usr_1', 'a@b.test', '2026-01-01T00:00:00Z', 'Ann')"
        )
        conn.execute(
            "INSERT INTO paper_owners (paper_id, owner_id, source_hash, created_at) "
            "VALUES ('ppr_x', 'usr_1', ?, '2026-01-01T00:00:00Z')",
            (HASH,),
        )
        conn.execute(
            "INSERT INTO reading_state VALUES ('usr_1', 'ppr_x', 2, 3, NULL, "
            "'2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL)"
        )
        wanted = tuple(m.version for m in load_migrations(find_migrations_dir()) if m.version > 6)
        result = migrate(conn, find_migrations_dir())
        assert result.applied == wanted and 9 in wanted and result.backups == ()
        assert conn.execute("SELECT COUNT(*) FROM paper_owners").fetchone()[0] == 1
        assert conn.execute("SELECT furthest_page FROM reading_state").fetchone()[0] == 3
        assert conn.execute("SELECT COUNT(*) FROM topics").fetchone()[0] == 0
    finally:
        conn.close()


def test_the_schema_refuses_what_the_api_never_sends(db: PaperTreeDb, tmp_path: Path) -> None:
    owner = db.create_user("a@b.test").owner
    rival = db.create_user("b@b.test")
    topic = db.create_topic(owner, "Vision").topic_id
    paper = _paper(db, owner)
    rival_paper = _paper(db, rival.owner, 1)
    insert = (
        "INSERT INTO paper_topics (owner_id, paper_id, topic_id, status, source, decided_at, "
        "created_at) VALUES (?, ?, ?, ?, 'manual', 't', 't')"
    )
    conn = raw_connect(tmp_path / "topics.sqlite")
    try:
        owner_id = conn.execute("SELECT owner_id FROM topics").fetchone()[0]
        # An unknown cloth, and a name that differs from another only in letter case.
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            conn.execute(
                "INSERT INTO topics VALUES ('top_1', ?, 'X', 'x', 'magenta', 0, 't')", (owner_id,)
            )
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
            conn.execute(
                "INSERT INTO topics VALUES ('top_2', ?, 'vision', 'vision', NULL, 0, 't')",
                (owner_id,),
            )
        # An accepted row with no topic; an unknown status.
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            conn.execute(insert, (owner_id, paper, None, "accepted"))
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            conn.execute(insert, (owner_id, paper, topic, "maybe"))
        # A placement of the rival's paper under the OWNER's topic: the composite FK is
        # (owner_id, topic_id), so the rival cannot name it.
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            conn.execute(insert, (rival.user_id, rival_paper, topic, "accepted"))
        conn.execute(insert, (owner_id, paper, topic, "accepted"))  # the well-formed one is fine
    finally:
        conn.close()


# ── the rule ──────────────────────────────────────────────────────────────────────────────


def test_the_rule_picks_the_topic_holding_the_most_papers_of_the_category() -> None:
    holdings = [
        Holding("top_a", "cs.CL", "2026-01-01T00:00:00+00:00"),
        Holding("top_b", "cs.CL", "2026-01-02T00:00:00+00:00"),
        Holding("top_b", "cs.CL", "2026-01-03T00:00:00+00:00"),
        Holding("top_a", "cs.CV", "2026-01-09T00:00:00+00:00"),
    ]
    got = suggest_by_category("cs.CL", holdings)
    assert got == TopicSuggestion("top_b", None, "arxiv_category", "cs.CL")


def test_a_tie_goes_to_the_most_recently_used_then_the_smaller_id() -> None:
    older = Holding("top_a", "cs.LG", "2026-01-01T00:00:00+00:00")
    newer = Holding("top_b", "cs.LG", "2026-02-01T00:00:00+00:00")
    got = suggest_by_category("cs.LG", [older, newer])
    assert got is not None and got.topic_id == "top_b"
    same = [Holding("top_b", "cs.LG", "t"), Holding("top_a", "cs.LG", "t")]
    for order in (same, same[::-1]):
        got = suggest_by_category("cs.LG", order)
        assert got is not None and got.topic_id == "top_a"


def test_the_rule_never_invents_a_topic() -> None:
    holdings = [Holding("top_a", "cs.CV", "t"), Holding("top_a", None, "t")]
    assert suggest_by_category("cs.LG", holdings) is None  # no topic holds this category
    assert suggest_by_category(None, holdings) is None  # the paper has no category
    assert suggest_by_category("cs.CV", []) is None


# ── topics ────────────────────────────────────────────────────────────────────────────────


def test_topics_are_created_in_order_and_named_once_per_owner(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    other = db.create_user("b@b.test").owner
    first = db.create_topic(owner, "  Transformers & attention ", "transformers")
    second = db.create_topic(owner, "Vision")
    assert (first.name, first.cloth, second.cloth) == (
        "Transformers & attention",
        "transformers",
        None,
    )
    assert first.sort_order < second.sort_order
    assert (first.paper_count, first.page_count, first.categories) == (0, 0, ())
    assert [t.name for t in db.list_topics(owner)] == ["Transformers & attention", "Vision"]

    with pytest.raises(TopicExists):
        db.create_topic(owner, "VISION")
    assert db.create_topic(other, "vision").name == "vision"  # another owner's own namespace
    assert db.list_topics(other)[0].topic_id != second.topic_id
    for bad in ("", "   ", "x" * 61):
        with pytest.raises(ValueError):
            db.create_topic(owner, bad)
    with pytest.raises(ValueError):
        db.create_topic(owner, "Okay", "magenta")
    assert db.create_topic(owner, "x" * 60).name == "x" * 60
    assert set(CLOTHS) == {"transformers", "vision", "generative", "optimization", "language", "rl"}


def test_update_renames_recolours_reorders_and_keeps_names_unique(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    a = db.create_topic(owner, "Alpha")
    b = db.create_topic(owner, "Beta")
    renamed = db.update_topic(owner, a.topic_id, name="ALPHA")  # same topic, new letter case
    assert renamed.name == "ALPHA" and renamed.cloth is None
    assert db.update_topic(owner, a.topic_id, cloth="rl").cloth == "rl"
    assert db.update_topic(owner, a.topic_id, sort_order=9).name == "ALPHA"
    assert [t.name for t in db.list_topics(owner)] == ["Beta", "ALPHA"]
    with pytest.raises(TopicExists):
        db.update_topic(owner, b.topic_id, name="alpha")
    with pytest.raises(ValueError):
        db.update_topic(owner, b.topic_id, sort_order=-1)
    with pytest.raises(TopicNotFound):
        db.update_topic(owner, "top_missing", name="Gamma")


def test_a_topic_is_invisible_to_another_owner(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    thief = db.create_user("b@b.test").owner
    topic = db.create_topic(owner, "Private").topic_id
    paper = _paper(db, thief)
    assert db.get_topic(thief, topic) is None
    with pytest.raises(TopicNotFound):
        db.update_topic(thief, topic, name="Mine")
    with pytest.raises(TopicNotFound):
        db.delete_topic(thief, topic)
    with pytest.raises(TopicNotFound):
        db.accept_topic(thief, paper, topic_id=topic)
    with pytest.raises(PaperNotFound):
        db.accept_topic(owner, paper, topic_id=topic)  # a paper that is not theirs
    with pytest.raises(PaperNotFound):
        db.get_paper_topic(owner, paper)
    assert [t.name for t in db.list_topics(owner)] == ["Private"]


# ── a paper's topic ───────────────────────────────────────────────────────────────────────


def test_a_paper_starts_unshelved_and_accepting_shelves_it(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    paper = _paper(db, owner, pages=12)
    topic = db.create_topic(owner, "Vision")
    assert db.get_paper_topic(owner, paper).status == "none"
    assert db.library_row(owner, paper).topic is None  # type: ignore[union-attr]

    got = db.accept_topic(owner, paper, topic_id=topic.topic_id)
    assert (got.status, got.source, got.source_detail) == ("accepted", "manual", None)
    assert got.topic is not None and got.topic.name == "Vision" and got.decided_at is not None
    shelf = db.library_row(owner, paper).topic  # type: ignore[union-attr]
    assert shelf is not None and (shelf.name, shelf.source) == ("Vision", "manual")
    held = db.get_topic(owner, topic.topic_id)
    assert held is not None and (held.paper_count, held.page_count) == (1, 12)
    assert [row.topic.name if row.topic else None for row in db.list_library(owner)] == ["Vision"]


def test_an_offer_does_not_shelve_and_accepting_it_keeps_where_it_came_from(
    db: PaperTreeDb,
) -> None:
    owner = db.create_user("a@b.test").owner
    paper = _paper(db, owner)
    topic = db.create_topic(owner, "Language")
    offer = TopicSuggestion(topic.topic_id, None, "arxiv_category", "cs.CL")
    got = db.record_suggestion(owner, paper, offer)
    assert (got.status, got.source, got.source_detail) == ("suggested", "arxiv_category", "cs.CL")
    assert db.library_row(owner, paper).topic is None  # type: ignore[union-attr]  # not shelved
    held = db.get_topic(owner, topic.topic_id)
    assert held is not None and held.paper_count == 0

    # Idempotent: a second offer, even a different one, leaves the first row alone.
    again = db.record_suggestion(owner, paper, TopicSuggestion(None, "Other", "model", "m"))
    assert again.source == "arxiv_category" and again.topic == got.topic

    accepted = db.accept_topic(owner, paper, topic_id=topic.topic_id)
    assert (accepted.status, accepted.source, accepted.source_detail) == (
        "accepted",
        "arxiv_category",
        "cs.CL",
    )


def test_choosing_a_different_topic_than_the_offer_is_manual(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    paper = _paper(db, owner)
    offered = db.create_topic(owner, "Language")
    chosen = db.create_topic(owner, "Vision")
    db.record_suggestion(
        owner, paper, TopicSuggestion(offered.topic_id, None, "arxiv_category", "cs.CL")
    )
    got = db.accept_topic(owner, paper, topic_id=chosen.topic_id)
    assert (got.source, got.source_detail) == ("manual", None)


def test_a_new_topic_name_creates_the_topic_or_reuses_the_existing_one(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    one, two = _paper(db, owner, 1), _paper(db, owner, 2)
    db.record_suggestion(owner, one, TopicSuggestion(None, "Diffusion models", "model", "flash-1"))
    assert db.get_paper_topic(owner, one).suggested_name == "Diffusion models"
    assert db.get_paper_topic(owner, one).topic is None
    assert db.list_topics(owner) == []  # an offered NEW name creates nothing

    got = db.accept_topic(owner, one, new_topic_name="diffusion MODELS", cloth="generative")
    assert got.topic is not None and got.topic.name == "diffusion MODELS"
    assert (got.source, got.source_detail, got.suggested_name) == ("model", "flash-1", None)

    same = db.accept_topic(owner, two, new_topic_name="Diffusion Models")  # reuses, no 409
    assert same.topic is not None and same.topic.topic_id == got.topic.topic_id
    assert len(db.list_topics(owner)) == 1
    with pytest.raises(ValueError):
        db.accept_topic(owner, two)
    with pytest.raises(ValueError):
        db.accept_topic(owner, two, topic_id=got.topic.topic_id, new_topic_name="x")


def test_reject_and_unshelve_keep_the_decision(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    paper = _paper(db, owner)
    topic = db.create_topic(owner, "Vision")
    offer = TopicSuggestion(topic.topic_id, None, "arxiv_category", "cs.CV")
    db.record_suggestion(owner, paper, offer)
    rejected = db.reject_topic(owner, paper)
    assert rejected.status == "rejected" and rejected.decided_at is not None
    assert rejected.topic is None  # the topic it remembers is not shown
    assert db.record_suggestion(owner, paper, offer).status == "rejected"  # never re-offered
    assert db.clear_topic(owner, paper).status == "rejected"  # unshelving keeps the no
    assert db.reject_topic(owner, paper).status == "rejected"

    # An ACCEPTED paper: unshelve and reject are both remove-and-reject.
    for leave in (db.clear_topic, db.reject_topic):
        accepted = db.accept_topic(owner, paper, topic_id=topic.topic_id)
        assert accepted.status == "accepted" and accepted.topic is not None
        left = leave(owner, paper)
        assert (left.status, left.topic) == ("rejected", None)
        assert db.library_row(owner, paper).topic is None  # type: ignore[union-attr]
        held = db.get_topic(owner, topic.topic_id)
        assert held is not None and held.paper_count == 0

    # No row at all: unshelving is a no-op, rejecting is a bare no.
    other = _paper(db, owner, 1)
    assert db.clear_topic(owner, other).status == "none"
    bare = db.reject_topic(owner, other)
    assert (bare.status, bare.source, bare.topic) == ("rejected", "manual", None)


def test_unicode_names_collide_by_casefold_and_cloth_can_be_cleared(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    first = db.create_topic(owner, "ÀB straße", "rl")
    with pytest.raises(TopicExists):
        db.create_topic(owner, "àb STRASSE")  # not ASCII-only: casefold("ß") is "ss"
    other = db.create_topic(owner, "Other")
    with pytest.raises(TopicExists):
        db.update_topic(owner, other.topic_id, name="àb strasse")
    assert db.update_topic(owner, first.topic_id, name="àb STRASSE").name == "àb STRASSE"
    assert db.update_topic(owner, first.topic_id, name="Renamed").cloth == "rl"  # UNSET keeps it
    assert db.update_topic(owner, first.topic_id, cloth=None).cloth is None  # None clears it
    # Accepting by a new name reuses the topic the same rule finds.
    paper = _paper(db, owner)
    got = db.accept_topic(owner, paper, new_topic_name="RENAMED")
    assert got.topic is not None and got.topic.topic_id == first.topic_id


def test_deleting_a_topic_unshelves_its_papers_and_keeps_their_history(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    shelved, offered, refused, other = (_paper(db, owner, n) for n in range(4))
    doomed = db.create_topic(owner, "Doomed")
    keeper = db.create_topic(owner, "Keeper")
    db.put_reading_state(owner, shelved, 4)
    db.accept_topic(owner, shelved, topic_id=doomed.topic_id)
    db.record_suggestion(
        owner, offered, TopicSuggestion(doomed.topic_id, None, "arxiv_category", "cs.LG")
    )
    db.record_suggestion(
        owner, refused, TopicSuggestion(doomed.topic_id, None, "arxiv_category", "cs.LG")
    )
    db.reject_topic(owner, refused)
    db.accept_topic(owner, other, topic_id=keeper.topic_id)

    db.delete_topic(owner, doomed.topic_id)

    assert db.get_paper_topic(owner, shelved).status == "none"
    assert db.get_paper_topic(owner, offered).status == "none"
    gone = db.get_paper_topic(owner, refused)
    assert (gone.status, gone.topic) == ("rejected", None)  # the person's no survives
    assert db.get_paper_topic(owner, other).status == "accepted"
    reading = db.get_reading_state(owner, shelved)
    assert reading is not None and reading.last_page == 4  # the paper itself is untouched
    assert [t.name for t in db.list_topics(owner)] == ["Keeper"]
    with pytest.raises(TopicNotFound):
        db.delete_topic(owner, doomed.topic_id)


def test_a_paper_deleted_takes_its_topic_row_with_it(db: PaperTreeDb) -> None:
    owner = db.create_user("a@b.test").owner
    paper = _paper(db, owner)
    topic = db.create_topic(owner, "Vision")
    db.accept_topic(owner, paper, topic_id=topic.topic_id)
    db.delete_paper(owner, paper)
    held = db.get_topic(owner, topic.topic_id)
    assert held is not None and held.paper_count == 0


def test_the_deterministic_suggestion_is_none_for_a_paper_without_a_category(
    db: PaperTreeDb,
) -> None:
    owner = db.create_user("a@b.test").owner
    paper = _paper(db, owner)
    assert db.deterministic_suggestion(owner, paper) is None
    with pytest.raises(PaperNotFound):
        db.deterministic_suggestion(db.create_user("b@b.test").owner, paper)
