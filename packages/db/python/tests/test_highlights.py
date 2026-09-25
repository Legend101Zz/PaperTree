"""``papertree_db.highlights`` on 0005: the ★ accessors and the rest S0 implemented beside them.

Owned by S4 after S0 (slice-plan.md §3). The records are REAL: ``capture_anchor_resnet.json`` is a
``captureAnchor()`` output over the committed ``resnet-cvpr-2col`` fixture, and the paper is that
fixture written through ``put_paper``.
"""

from __future__ import annotations

import copy
import json
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from papertree_db import (
    AnchorIn,
    GenerationNotFound,
    HighlightConflict,
    HighlightRejected,
    OwnerId,
    PaperId,
    PaperNotFound,
    PaperTreeDb,
    ResolutionIn,
    generation,
    open_database,
)

from .saved_shapes import (
    LEGACY_ANCHOR,
    LEGACY_HIGHLIGHT,
    build_demo_shape,
    load_capture_anchor,
    load_fixture_paper,
    raw_connect,
)

HID = "hl_01K0DBHIGHLIGHTTEST000001"


@dataclass(frozen=True, slots=True)
class Env:
    db: PaperTreeDb
    owner: OwnerId
    paper_id: PaperId
    file: Path
    record: dict[str, Any]


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    file = tmp_path / "highlights.sqlite"
    db = open_database(file)
    db.migrate()
    owner = db.create_user("reader@papertree.test").owner
    document = load_fixture_paper()
    db.put_paper(owner, document)
    paper_id = PaperId(document["paper_id"])
    db.promote_generation(owner, paper_id, generation(1))
    yield Env(db, owner, paper_id, file, load_capture_anchor())
    db.close()


def _resolution(record: dict[str, Any], **fields: Any) -> ResolutionIn:
    values: dict[str, Any] = {
        "anchor_id": record["id"],
        "generation": 1,
        "tier": 1,
        "state": "anchored",
        "block_ids": [record["selectors"][0]["blockId"]],
        "score": 1.0,
        "resolver_version": "test",
    }
    values.update(fields)
    return ResolutionIn(**values)


def _create(env: Env, **overrides: Any) -> Any:
    kwargs: dict[str, Any] = {
        "highlight_id": HID,
        "color": "amber",
        "note": "a note",
        "created_generation": 1,
        "anchors": [AnchorIn(env.record)],
        "resolutions": [_resolution(env.record)],
    }
    kwargs.update(overrides)
    return env.db.create_highlight(env.owner, env.paper_id, **kwargs)


def _rows(file: Path) -> dict[str, int]:
    conn = sqlite3.connect(file)
    try:
        return {
            t: int(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
            for t in ("highlights", "anchors", "anchor_resolutions")
        }
    finally:
        conn.close()


NO_ROWS = {"highlights": 0, "anchors": 0, "anchor_resolutions": 0}


def test_create_then_list_round_trips_the_record(env: Env) -> None:
    created = _create(env)
    assert created.created and created.highlight_id == HID and created.created_generation == 1
    [listed] = env.db.list_highlights(env.owner, env.paper_id, 1)
    assert (listed.highlight_id, listed.color, listed.note) == (HID, "amber", "a note")
    [anchor] = listed.anchors
    assert anchor.anchor == env.record and anchor.ordinal == 0
    assert anchor.resolution is not None and anchor.resolution.tier == 1
    # The denormalised columns come from the record, not from the caller.
    conn = sqlite3.connect(env.file)
    try:
        row = conn.execute(
            "SELECT target_kind, provenance_class, quote_exact, page_index FROM anchors"
        ).fetchone()
    finally:
        conn.close()
    quote = next(s for s in env.record["selectors"] if s["type"] == "TextQuoteSelector")
    assert row == ("text", "source", quote["exact"], 1)
    # No generation asked about: listed, with no cache entry.
    assert env.db.list_highlights(env.owner, env.paper_id, None)[0].anchors[0].resolution is None


def test_highlight_write_is_atomic(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    """A fault AFTER the highlight row and its anchors are written must leave NO rows.

    The fault is real SQLite behaviour, not a mock: an authorizer on the connection refuses the
    ``anchor_resolutions`` INSERT, which ``create_highlight`` issues last — by then the
    ``highlights`` row and the ``anchors`` rows exist inside the transaction. (Installed on the
    connection as ``sqlite3.connect`` creates it, like ``test_migrations``' statement counter,
    because ``._conn`` is a forbidden token outside the package.)

    WATCHED FAILING: with ``with self.transaction():`` in ``create_highlight`` replaced by a
    no-op context manager, this reports ``{'highlights': 1, 'anchors': 1, ...} != NO_ROWS``.
    """
    armed = {"on": False}
    real_connect = sqlite3.connect

    def deny_resolutions(action: int, arg1: str | None, *_: object) -> int:
        if armed["on"] and action == sqlite3.SQLITE_INSERT and arg1 == "anchor_resolutions":
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    def connect(*args: Any, **kwargs: Any) -> sqlite3.Connection:
        conn: sqlite3.Connection = real_connect(*args, **kwargs)
        conn.set_authorizer(deny_resolutions)
        return conn

    monkeypatch.setattr(sqlite3, "connect", connect)
    with open_database(env.file) as faulty:
        owner = faulty.owner_for(_user_id(env))
        armed["on"] = True
        with pytest.raises(sqlite3.DatabaseError, match="not authorized"):
            faulty.create_highlight(
                owner,
                env.paper_id,
                highlight_id=HID,
                color="amber",
                note=None,
                created_generation=1,
                anchors=[AnchorIn(env.record)],
                resolutions=[_resolution(env.record)],
            )
        armed["on"] = False
        # The connection is usable afterwards: the transaction was rolled back, not left open.
        assert faulty.list_highlights(owner, env.paper_id, 1) == []
    assert _rows(env.file) == NO_ROWS


def _user_id(env: Env) -> str:
    conn = sqlite3.connect(env.file)
    try:
        return str(conn.execute("SELECT user_id FROM users").fetchone()[0])
    finally:
        conn.close()


def test_empty_anchors_is_rejected(env: Env) -> None:
    with pytest.raises(HighlightRejected) as rejected:
        _create(env, anchors=[], resolutions=[])
    assert rejected.value.code == "validation_failed"
    assert _rows(env.file) == NO_ROWS


def test_anchor_mismatch_is_rejected(env: Env) -> None:
    for field, value in (("paperId", "ppr_0000000000000000000000OTHR"), ("pdfSha256", "sha256:0")):
        record = copy.deepcopy(env.record)
        record["doc"][field] = value
        with pytest.raises(HighlightRejected) as rejected:
            _create(env, anchors=[AnchorIn(record)], resolutions=[])
        assert rejected.value.code == "anchor_mismatch", field
    assert _rows(env.file) == NO_ROWS


def test_anchor_incomplete_is_rejected(env: Env) -> None:
    no_quote = copy.deepcopy(env.record)
    no_quote["selectors"] = [s for s in no_quote["selectors"] if s["type"] != "TextQuoteSelector"]
    no_shape = copy.deepcopy(env.record)
    no_shape["selectors"] = [s for s in no_shape["selectors"] if s["type"] != "ShapeSelector"]
    for record in (no_quote, no_shape):
        with pytest.raises(HighlightRejected) as rejected:
            _create(env, anchors=[AnchorIn(record)], resolutions=[])
        assert rejected.value.code == "anchor_incomplete"
    assert _rows(env.file) == NO_ROWS


def test_a_paper_the_owner_does_not_hold_is_not_found(env: Env) -> None:
    other = env.db.create_user("other@papertree.test").owner
    with pytest.raises(PaperNotFound):
        env.db.create_highlight(
            other,
            env.paper_id,
            highlight_id=HID,
            color="amber",
            note=None,
            created_generation=1,
            anchors=[AnchorIn(env.record)],
            resolutions=[],
        )
    assert env.db.list_highlights(other, env.paper_id, 1) == []
    assert _rows(env.file) == NO_ROWS


def test_a_replay_returns_the_stored_row_and_a_changed_body_conflicts(env: Env) -> None:
    first = _create(env)
    replay = _create(env, resolutions=[_resolution(env.record, tier=3, state="approximate")])
    assert replay.created is False
    assert (replay.highlight_id, replay.created_at) == (first.highlight_id, first.created_at)
    # The replay's different CACHE entry is not part of the body and was not written.
    [listed] = env.db.list_highlights(env.owner, env.paper_id, 1)
    assert listed.anchors[0].resolution is not None and listed.anchors[0].resolution.tier == 1

    for change in ({"color": "pink"}, {"note": "other"}):
        with pytest.raises(HighlightConflict):
            _create(env, **change)
    moved = copy.deepcopy(env.record)
    moved["selectors"][0]["endOffset"] = 91
    with pytest.raises(HighlightConflict):
        _create(env, anchors=[AnchorIn(moved)])
    assert _rows(env.file) == {"highlights": 1, "anchors": 1, "anchor_resolutions": 1}


def test_an_id_held_by_another_owner_is_a_conflict_not_a_crash(env: Env) -> None:
    """Ids are client-minted and globally unique, so a second owner replaying one gets a clean
    refusal — never another owner's row, and never a bare ``IntegrityError``."""
    _create(env)
    other = env.db.create_user("other@papertree.test")
    document = load_fixture_paper()
    document["paper_id"] = "ppr_" + "0" * 22 + "OTHR"
    env.db.put_paper(other.owner, document)
    record = copy.deepcopy(env.record)
    record["doc"]["paperId"] = document["paper_id"]
    with pytest.raises(HighlightConflict):
        env.db.create_highlight(
            other.owner,
            PaperId(document["paper_id"]),
            highlight_id=HID,
            color="amber",
            note="a note",
            created_generation=1,
            anchors=[AnchorIn(record)],
            resolutions=[],
        )
    assert env.db.list_highlights(other.owner, PaperId(document["paper_id"]), 1) == []


def test_anchorless_and_orphaned_highlights_are_still_listed(env: Env) -> None:
    """N2: the 0001 read was an inner join and dropped both. WATCHED FAILING with the two LEFT
    JOINs in ``_select_highlights`` turned into inner joins: the anchorless row disappears."""
    _create(env, resolutions=[_resolution(env.record, state="orphan", tier=6, block_ids=[])])
    conn = raw_connect(env.file)
    try:
        user_id = conn.execute("SELECT user_id FROM users").fetchone()[0]
        conn.execute(
            "INSERT INTO highlights (highlight_id, owner_id, paper_id, color, note, "
            "created_generation, created_at, updated_at) "
            "VALUES ('hl_01K0ANCHORLESS00000000001', ?, ?, 'blue', NULL, 1, 'z', 'z')",
            (user_id, env.paper_id),
        )
    finally:
        conn.close()
    listed = {h.highlight_id: h for h in env.db.list_highlights(env.owner, env.paper_id, 1)}
    assert set(listed) == {HID, "hl_01K0ANCHORLESS00000000001"}
    assert listed["hl_01K0ANCHORLESS00000000001"].anchors == ()
    orphan = listed[HID].anchors[0].resolution
    assert orphan is not None and orphan.state == "orphan" and orphan.block_ids == ()


def test_update_and_delete_are_scoped_to_owner_and_paper(env: Env) -> None:
    _create(env)
    other_paper = PaperId("ppr_" + "0" * 22 + "OTHR")
    assert env.db.update_highlight(env.owner, other_paper, HID, color="green", note="x") is None
    assert env.db.delete_highlight(env.owner, other_paper, HID) == 0
    # …and nothing was written through the wrong path (a None answer alone would not show that).
    [untouched] = env.db.list_highlights(env.owner, env.paper_id, 1)
    assert (untouched.color, untouched.note) == ("amber", "a note")

    updated = env.db.update_highlight(env.owner, env.paper_id, HID, color="green")
    assert updated is not None and updated.color == "green" and updated.note == "a note"
    cleared = env.db.update_highlight(env.owner, env.paper_id, HID, note="")
    assert cleared is not None and cleared.note is None and cleared.color == "green"
    unchanged = env.db.update_highlight(env.owner, env.paper_id, HID)
    assert unchanged is not None and unchanged.updated_at == cleared.updated_at

    assert env.db.delete_highlight(env.owner, env.paper_id, HID) == 1
    assert _rows(env.file) == NO_ROWS  # anchors and their cache entries cascade


def test_put_resolutions_upserts_one_generation(env: Env) -> None:
    _create(env, resolutions=[])
    item = _resolution(env.record, tier=4, state="approximate", score=0.5)
    assert env.db.put_resolutions(env.owner, env.paper_id, 1, [item]) == 1
    assert env.db.put_resolutions(env.owner, env.paper_id, 1, [_resolution(env.record)]) == 1
    [listed] = env.db.list_highlights(env.owner, env.paper_id, 1)
    assert listed.anchors[0].resolution is not None and listed.anchors[0].resolution.tier == 1
    assert _rows(env.file)["anchor_resolutions"] == 1

    with pytest.raises(GenerationNotFound):
        env.db.put_resolutions(env.owner, env.paper_id, 2, [_resolution(env.record, generation=2)])
    with pytest.raises(HighlightRejected):
        env.db.put_resolutions(env.owner, env.paper_id, 1, [_resolution(env.record, generation=2)])
    with pytest.raises(HighlightRejected):
        env.db.put_resolutions(
            env.owner, env.paper_id, 1, [_resolution(env.record, anchor_id="not-on-this-paper")]
        )


def test_upgrade_legacy_anchor_only_replaces_a_legacy_row(tmp_path: Path) -> None:
    shape = build_demo_shape(tmp_path)
    assert shape.legacy is not None
    user_id, paper_id = shape.legacy
    with open_database(shape.file) as db:
        db.migrate()
        owner = db.owner_for(user_id)
        full = copy.deepcopy(load_capture_anchor())
        full["id"] = LEGACY_ANCHOR
        # An upgrade is a bad body like any other: an index past SQLite's INTEGER range is refused
        # before the UPDATE binds it (it raised OverflowError), and the legacy record stays.
        oversized = copy.deepcopy(full)
        next(s for s in oversized["selectors"] if s["type"] == "PageSelector")["index"] = 2**63
        with pytest.raises(HighlightRejected):
            db.upgrade_legacy_anchor(owner, PaperId(paper_id), LEGACY_ANCHOR, oversized)
        [still] = db.list_highlights(owner, PaperId(paper_id), 1)
        assert still.anchors[0].anchor["doc"]["textStreamId"] == "legacy-0001"
        db.upgrade_legacy_anchor(owner, PaperId(paper_id), LEGACY_ANCHOR, full)
        [listed] = db.list_highlights(owner, PaperId(paper_id), 1)
        assert listed.highlight_id == LEGACY_HIGHLIGHT
        assert listed.anchors[0].anchor == full
        # It is no longer a legacy row, so a second upgrade is refused.
        with pytest.raises(HighlightRejected, match="not a legacy-0001 row"):
            db.upgrade_legacy_anchor(owner, PaperId(paper_id), LEGACY_ANCHOR, full)
        # The replacement keeps its id.
        other = copy.deepcopy(full)
        other["id"] = "0f0f0f0f-0000-4000-8000-00000000000a"
        with pytest.raises(HighlightRejected):
            db.upgrade_legacy_anchor(owner, PaperId(paper_id), LEGACY_ANCHOR, other)


def test_transaction_nests_through_savepoints(env: Env) -> None:
    """``transaction()`` inside ``transaction()`` is a SAVEPOINT: the inner block rolls back on its
    own, and the outer block still commits (or rolls back everything)."""
    with env.db.transaction():
        _create(env)  # itself a nested transaction()
        with pytest.raises(RuntimeError), env.db.transaction():
            env.db.update_highlight(env.owner, env.paper_id, HID, color="green")
            raise RuntimeError("inner")
    [listed] = env.db.list_highlights(env.owner, env.paper_id, 1)
    assert listed.color == "amber"

    with pytest.raises(RuntimeError), env.db.transaction():
        env.db.delete_highlight(env.owner, env.paper_id, HID)
        raise RuntimeError("outer")
    assert len(env.db.list_highlights(env.owner, env.paper_id, 1)) == 1
    assert _rows(env.file)["highlights"] == 1


#: The largest value SQLite's INTEGER holds.
SQLITE_INTEGER_MAX = 2**63 - 1


def _with_selector(record: dict[str, Any], kind: str, **fields: Any) -> dict[str, Any]:
    changed = copy.deepcopy(record)
    next(s for s in changed["selectors"] if s["type"] == kind).update(fields)
    return changed


def test_integers_past_sqlite_range_are_rejected_before_any_sql(env: Env) -> None:
    """JSON integers are unbounded and SQLite's INTEGER is 64-bit. Every integer this module binds
    is bounded first, so an oversized one is a :class:`HighlightRejected` (the route's 422), never
    an ``OverflowError`` out of the driver (the route's 500).

    WATCHED FAILING before the bounds: every call below raised ``OverflowError: Python int too
    large to convert to SQLite INTEGER``, except the quad (``int too large to convert to float``).
    """
    big = SQLITE_INTEGER_MAX + 1
    shape_only = copy.deepcopy(env.record)
    shape_only["selectors"] = [s for s in shape_only["selectors"] if s["type"] != "PageSelector"]
    shape_only = _with_selector(shape_only, "ShapeSelector", pageIndex=big)
    huge_quad = _with_selector(env.record, "ShapeSelector", quads=[[10**400, 170.0, 343.0, 180.0]])
    cases: dict[str, Any] = {
        "created_generation": lambda: _create(env, created_generation=big),
        "a resolution's generation": lambda: _create(
            env, resolutions=[_resolution(env.record, generation=big)]
        ),
        "PageSelector.index": lambda: _create(
            env,
            anchors=[AnchorIn(_with_selector(env.record, "PageSelector", index=big))],
            resolutions=[],
        ),
        "ShapeSelector.pageIndex": lambda: _create(
            env, anchors=[AnchorIn(shape_only)], resolutions=[]
        ),
        "a quad coordinate past float range": lambda: _create(
            env, anchors=[AnchorIn(huge_quad)], resolutions=[]
        ),
        "put_resolutions' generation": lambda: env.db.put_resolutions(
            env.owner, env.paper_id, big, []
        ),
        "list_highlights' generation": lambda: env.db.list_highlights(env.owner, env.paper_id, big),
        "get_highlight's generation": lambda: env.db.get_highlight(
            env.owner, env.paper_id, HID, big
        ),
    }
    for label, call in cases.items():
        try:
            call()
        except HighlightRejected as rejected:
            assert rejected.code in {"validation_failed", "anchor_incomplete"}, label
        except Exception as exc:  # the defect IS an unexpected exception type
            pytest.fail(f"{label}: {type(exc).__name__}: {exc}")
        else:
            pytest.fail(f"{label}: accepted")
    assert _rows(env.file) == NO_ROWS

    # Non-vacuous, and the bound is SQLite's own: 2**63-1 is stored and read like any value.
    at_edge = _with_selector(env.record, "PageSelector", index=SQLITE_INTEGER_MAX)
    assert _create(env, anchors=[AnchorIn(at_edge)], resolutions=[]).created
    [listed] = env.db.list_highlights(env.owner, env.paper_id, SQLITE_INTEGER_MAX)
    assert listed.anchors[0].resolution is None
    conn = sqlite3.connect(env.file)
    try:
        assert conn.execute("SELECT page_index FROM anchors").fetchone()[0] == SQLITE_INTEGER_MAX
    finally:
        conn.close()


def test_an_empty_note_means_no_note_on_create_as_on_update(env: Env) -> None:
    """``note=""`` is "no note" everywhere. ``update_highlight`` already stored NULL for it;
    ``create_highlight`` stored ``''``, so one input had two meanings depending on the call.

    WATCHED FAILING before the fix: ``assert '' is None``.
    """
    created = _create(env, note="")
    assert created.note is None
    [listed] = env.db.list_highlights(env.owner, env.paper_id, 1)
    assert listed.note is None
    conn = sqlite3.connect(env.file)
    try:
        assert conn.execute("SELECT note FROM highlights").fetchone()[0] is None
    finally:
        conn.close()
    # Both spellings of "no note" replay as the same body, not as a conflict.
    assert _create(env, note="").created is False
    assert _create(env, note=None).created is False
    with pytest.raises(HighlightConflict):
        _create(env, note="a note")


def test_the_stored_record_never_carries_a_resolution(env: Env) -> None:
    with_resolution = {**env.record, "resolution": {"tier": 0}}
    _create(env, anchors=[AnchorIn(with_resolution)])
    conn = sqlite3.connect(env.file)
    try:
        stored = json.loads(conn.execute("SELECT anchor_json FROM anchors").fetchone()[0])
    finally:
        conn.close()
    assert "resolution" not in stored and stored == env.record
