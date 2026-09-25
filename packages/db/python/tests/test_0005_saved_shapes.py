"""0005 on the two saved data-root shapes — ``judge-evidence/migrate_probe.py``, ported.

contracts.md §1 lists what the judge measured on backup copies of ``~/.papertree-demo`` and
``PaperTree-evidence/runtime/baseline-data``. Each item is asserted here, on databases built from
fixtures in the same shapes (``saved_shapes.py`` says how each shape was re-derived):

  * counts identical, except baseline ``paper_owners`` 1 -> 2 (the dead-lettered DDPM);
  * ``foreign_key_check`` is ``[]`` and ``integrity_check`` is ``ok``;
  * a re-run is a no-op;
  * the legacy highlight is carried as a full Anchor (block geometry, not the placeholder);
  * gen 2 promoted + gen 1 deleted keeps the highlight (only its gen-1 cache row dies);
  * a real ``captureAnchor`` record is stored verbatim;
  * a wrong-paper anchor and an excerpt without an anchor are both rejected by the schema;
  * deleting a group ungroups its members; deleting a node cascades to its edges.

The owner-FK audit over the 9 new tables is ``test_ownership.py``'s. The by-hand run on real
backup copies is in the S0 db report, as the slice plan asks.

Also here: the ``<db>.pre-0005.bak`` backup ``migrate`` writes before 0005 touches a saved
database (contracts.md §6.1 / ADR-002 §6.1), and 0005's all-or-nothing guard.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

import pytest
import sqlite_vec  # type: ignore[import-untyped]
from papertree_db import (
    AnchorIn,
    HighlightRejected,
    PaperId,
    ResolutionIn,
    generation,
    migrate,
    open_database,
)

from .saved_shapes import (
    BUILDERS,
    LEGACY_ANCHOR,
    LEGACY_BLOCK,
    LEGACY_HIGHLIGHT,
    LEGACY_RESOLVED_AT,
    MIGRATIONS_DIR,
    PLACEHOLDER_POLYGON,
    Shape,
    build_demo_shape,
    counts,
    load_capture_anchor,
    load_fixture_paper,
    migrations_through,
    raw_connect,
)

SHAPES = sorted(BUILDERS)


def _fk_and_integrity(conn: sqlite3.Connection) -> tuple[list[Any], str]:
    return (
        [tuple(r) for r in conn.execute("PRAGMA foreign_key_check").fetchall()],
        str(conn.execute("PRAGMA integrity_check").fetchone()[0]),
    )


def _expected_legacy_anchor(shape: Shape) -> dict[str, Any]:
    """What 0005 must build for the legacy row, derived from the fixture's OWN block and page."""
    assert shape.legacy is not None
    document = load_fixture_paper()
    block = next(b for b in document["blocks"] if b["block_id"] == LEGACY_BLOCK)
    page = next(p for p in document["pages"] if p["index"] == block["page_index"])
    return {
        "anchorVersion": 1,
        "offsetUnit": "unicode",
        "id": LEGACY_ANCHOR,
        "doc": {
            "paperId": shape.legacy[1],
            "pdfSha256": shape.source_hash,
            "parserVersion": document["parser"]["version"],
            "textStreamId": "legacy-0001",
        },
        "targetKind": "text",
        "provenanceClass": "source",
        "selectors": [
            {
                "type": "BlockSelector",
                "blockId": LEGACY_BLOCK,
                "blockTextHash": block["content_hash"],
            },
            {"type": "PageSelector", "index": block["page_index"]},
            {
                "type": "ShapeSelector",
                "pageIndex": block["page_index"],
                "quads": [block["bbox"]],
                "polygons": [block["polygon"]],
                "pageWidth": page["width"],
                "pageHeight": page["height"],
                "rotation": page["rotation"],
                "userUnit": page["user_unit"],
                "cropBox": page["crop_box"],
            },
        ],
        "created": {"mode": "source", "at": LEGACY_RESOLVED_AT, "client": "legacy-0001"},
    }


@pytest.mark.parametrize("shape_name", SHAPES)
def test_0005_on_saved_shapes(
    shape_name: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The judge's probe, in its order, on one fixture-built shape."""
    shape = BUILDERS[shape_name](tmp_path)
    conn = raw_connect(shape.file)
    try:
        before = counts(conn)
        started = time.perf_counter()
        result = migrate(conn, MIGRATIONS_DIR)
        elapsed_ms = (time.perf_counter() - started) * 1000
        assert result.applied == (5,)
        assert result.head == (1, 2, 3, 4, 5)

        # ── counts ───────────────────────────────────────────────────────────────────────
        after = counts(conn)
        expected = dict(before)
        if shape.ghost is not None:
            expected["paper_owners"] += 1  # the dead-lettered upload gains its library row
        assert after == expected

        # ── foreign_key_check / integrity_check ──────────────────────────────────────────
        assert _fk_and_integrity(conn) == ([], "ok")

        # ── paper_owners: the four new columns, filled from what the database already knew ──
        owners = {
            (r["owner_id"], r["paper_id"]): dict(r)
            for r in conn.execute(
                "SELECT owner_id, paper_id, source_hash, created_at, original_filename, "
                "byte_size, page_count, latest_job_id FROM paper_owners"
            )
        }
        pages_in_fixture = len(load_fixture_paper()["pages"])
        for key in shape.promoted:
            row = owners[key]
            assert row["page_count"] == pages_in_fixture, key
            # Scoped to the job's OWNER: in the demo shape two users hold the same bytes.
            assert row["latest_job_id"] == shape.jobs[key], key
            assert row["original_filename"] is None and row["byte_size"] is None
        if shape.ghost is not None:
            user_id, ghost_paper, ghost_job, ghost_hash, ghost_created = shape.ghost
            ghost = owners[(user_id, ghost_paper)]
            assert ghost["source_hash"] == f"sha256:{ghost_hash}"  # prefix added, once
            assert ghost["created_at"] == ghost_created
            assert ghost["page_count"] is None  # never parsed
            assert ghost["latest_job_id"] == ghost_job
            state = conn.execute(
                "SELECT state FROM jobs WHERE job_id = ?", (ghost["latest_job_id"],)
            ).fetchone()[0]
            assert state == "dead_letter"

        # ── the legacy highlight, carried as a full Anchor ────────────────────────────────
        if shape.legacy is not None:
            legacy_owner, legacy_paper = shape.legacy
            hl = dict(conn.execute("SELECT * FROM highlights").fetchone())
            assert hl == {
                "highlight_id": LEGACY_HIGHLIGHT,
                "owner_id": legacy_owner,
                "paper_id": legacy_paper,
                "color": "amber",
                "note": "walk-proof",
                "created_generation": 1,
                "created_at": LEGACY_RESOLVED_AT,
                "updated_at": LEGACY_RESOLVED_AT,
            }
            anchor = dict(conn.execute("SELECT * FROM anchors").fetchone())
            stored = json.loads(anchor.pop("anchor_json"))
            assert stored == _expected_legacy_anchor(shape)
            shape_selector = stored["selectors"][2]
            assert shape_selector["quads"] != [[0, 0, 1, 1]], "the placeholder bbox leaked through"
            assert json.dumps(shape_selector["polygons"][0]) != PLACEHOLDER_POLYGON
            block_text = next(
                b["text"] for b in load_fixture_paper()["blocks"] if b["block_id"] == LEGACY_BLOCK
            )
            assert anchor == {
                "anchor_id": LEGACY_ANCHOR,
                "owner_id": legacy_owner,
                "highlight_id": LEGACY_HIGHLIGHT,
                "paper_id": legacy_paper,
                "ordinal": 0,
                "target_kind": "text",
                "provenance_class": "source",
                "quote_exact": block_text,
                "page_index": 0,
                "created_generation": 1,
                "created_at": LEGACY_RESOLVED_AT,
            }
            resolution = dict(conn.execute("SELECT * FROM anchor_resolutions").fetchone())
            assert resolution == {
                "owner_id": legacy_owner,
                "anchor_id": LEGACY_ANCHOR,
                "paper_id": legacy_paper,
                "generation": 1,
                "tier": 1,
                "state": "anchored",
                "score": None,
                "block_ids": json.dumps([LEGACY_BLOCK]),
                "reason": None,
                "resolver_version": "legacy-0001",
                "resolved_at": LEGACY_RESOLVED_AT,
            }
            # …and the ★ read path lists it, with its gen-1 cache entry.
            with open_database(shape.file) as db:
                owner = db.owner_for(legacy_owner)
                listed = db.list_highlights(owner, PaperId(legacy_paper), 1)
                assert [h.highlight_id for h in listed] == [LEGACY_HIGHLIGHT]
                assert listed[0].anchors[0].anchor == stored
                resolved = listed[0].anchors[0].resolution
                assert resolved is not None and resolved.block_ids == (LEGACY_BLOCK,)

        # ── re-parse: gen 2 promoted, gen 1 deleted ───────────────────────────────────────
        _simulate_reparse(shape, conn)
        if shape.legacy is not None:
            assert conn.execute("SELECT COUNT(*) FROM highlights").fetchone()[0] == 1
            assert conn.execute("SELECT COUNT(*) FROM anchors").fetchone()[0] == 1
            # The cache row was keyed to gen 1 and died with it; nothing else did.
            assert conn.execute("SELECT COUNT(*) FROM anchor_resolutions").fetchone()[0] == 0

        # ── a real captureAnchor record, stored through the ★ write path ──────────────────
        stored_bytes = _store_real_capture_anchor(shape)

        # ── the schema's own rejections, and the canvas rules ─────────────────────────────
        _assert_schema_rejections_and_canvas_rules(shape, conn)
        assert _fk_and_integrity(conn) == ([], "ok")

        # ── a re-run is a no-op ───────────────────────────────────────────────────────────
        again = migrate(conn, MIGRATIONS_DIR)
        assert again.applied == ()
        assert again.backups == ()
    finally:
        conn.close()

    with capsys.disabled():
        print(
            f"\n[db/0005::{shape_name}] applied (5,) in {elapsed_ms:.1f} ms; counts "
            f"{'identical' if shape.ghost is None else 'identical except paper_owners +1'}; "
            f"fk_check [] integrity ok; real captureAnchor stored {stored_bytes} B; re-run no-op"
        )


def _simulate_reparse(shape: Shape, conn: sqlite3.Connection) -> None:
    """A real gen 2 through ``put_paper``, promoted, then gen 1 deleted (the judge's simulation,
    with the full document rather than a copied ``papers`` row)."""
    for user_id, paper_id in shape.promoted:
        document = load_fixture_paper()
        document["paper_id"] = paper_id
        document["generation"] = 2
        with open_database(shape.file) as db:
            owner = db.owner_for(user_id)
            db.put_paper(owner, document)
            db.promote_generation(owner, PaperId(paper_id), generation(2))
        conn.execute(
            "DELETE FROM papers WHERE owner_id = ? AND paper_id = ? AND generation = 1",
            (user_id, paper_id),
        )
        assert [
            r[0]
            for r in conn.execute(
                "SELECT generation FROM papers WHERE owner_id = ? AND paper_id = ?",
                (user_id, paper_id),
            )
        ] == [2]
    if shape.legacy is not None:
        with open_database(shape.file) as db:
            owner = db.owner_for(shape.legacy[0])
            listed = db.list_highlights(owner, PaperId(shape.legacy[1]), 2)
            assert [h.highlight_id for h in listed] == [LEGACY_HIGHLIGHT]
            # Still listed, still carrying its Anchor; no cache entry for gen 2 yet.
            assert listed[0].anchors[0].resolution is None


def _store_real_capture_anchor(shape: Shape) -> int:
    user_id, paper_id = shape.capture_paper
    record = load_capture_anchor()
    assert record["doc"]["paperId"] == paper_id  # the fixture's own id: stored VERBATIM
    block_id = record["selectors"][0]["blockId"]
    with open_database(shape.file) as db:
        owner = db.owner_for(user_id)
        created = db.create_highlight(
            owner,
            PaperId(paper_id),
            highlight_id="hl_01K0CAPTUREDANCHORTEST0001",
            color="green",
            note=None,
            created_generation=2,
            anchors=[AnchorIn(record)],
            resolutions=[
                ResolutionIn(
                    anchor_id=record["id"],
                    generation=2,
                    tier=1,
                    state="anchored",
                    block_ids=[block_id],
                    score=1.0,
                    resolver_version="test",
                )
            ],
        )
        assert created.created
        listed = db.get_highlight(owner, PaperId(paper_id), created.highlight_id, 2)
        assert listed is not None and listed.anchors[0].anchor == record
        # The schema is also what rejects a record for another paper — through the ★ path the
        # message is the contract's code, one layer up.
        foreign = json.loads(json.dumps(record))
        foreign["id"] = "0f0f0f0f-0000-4000-8000-000000000002"
        foreign["doc"]["paperId"] = "ppr_OTHER"
        with pytest.raises(HighlightRejected) as rejected:
            db.create_highlight(
                owner,
                PaperId(paper_id),
                highlight_id="hl_01K0CAPTUREDANCHORTEST0002",
                color="green",
                note=None,
                created_generation=2,
                anchors=[AnchorIn(foreign)],
                resolutions=[],
            )
        assert rejected.value.code == "anchor_mismatch"
    conn = raw_connect(shape.file)
    try:
        size = int(
            conn.execute(
                "SELECT length(anchor_json) FROM anchors WHERE anchor_id = ?", (record["id"],)
            ).fetchone()[0]
        )
    finally:
        conn.close()
    assert size > 1000  # the whole record, not a projection of it
    return size


def _assert_schema_rejections_and_canvas_rules(shape: Shape, conn: sqlite3.Connection) -> None:
    user_id, paper_id = shape.capture_paper
    record = load_capture_anchor()

    # A wrong-paper anchor, by raw INSERT: the CHECK on anchor_json.doc.paperId refuses it.
    bad = json.loads(json.dumps(record))
    bad["id"] = "0f0f0f0f-0000-4000-8000-000000000003"
    bad["doc"]["paperId"] = "ppr_OTHER"
    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
        conn.execute(
            "INSERT INTO anchors (anchor_id, owner_id, highlight_id, paper_id, ordinal, "
            "anchor_json, target_kind, provenance_class, created_generation, created_at) "
            "VALUES (?, ?, 'hl_01K0CAPTUREDANCHORTEST0001', ?, 1, ?, 'text', 'source', 2, 'x')",
            (bad["id"], user_id, paper_id, json.dumps(bad)),
        )

    conn.execute(
        "INSERT INTO canvas_boards (board_id, owner_id, paper_id, title, created_at, updated_at) "
        "VALUES ('brd_1', ?, ?, 'Board', 'x', 'x')",
        (user_id, paper_id),
    )
    # An excerpt without its source anchor.
    with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint failed"):
        conn.execute(
            "INSERT INTO canvas_nodes (node_id, owner_id, board_id, kind, x, y, w, h, "
            "created_at, updated_at) VALUES ('cn_excerpt0', ?, 'brd_1', 'excerpt', 0, 0, 10, 10, "
            "'x', 'x')",
            (user_id,),
        )
    conn.execute(
        "INSERT INTO canvas_nodes (node_id, owner_id, board_id, kind, x, y, w, h, created_at, "
        "updated_at) VALUES ('cn_group01', ?, 'brd_1', 'group', 0, 0, 100, 100, 'x', 'x')",
        (user_id,),
    )
    conn.execute(
        "INSERT INTO canvas_nodes (node_id, owner_id, board_id, kind, group_id, x, y, w, h, "
        "source_anchor_json, created_at, updated_at) "
        "VALUES ('cn_member1', ?, 'brd_1', 'excerpt', 'cn_group01', 1, 1, 10, 10, ?, 'x', 'x')",
        (user_id, json.dumps(record)),
    )
    conn.execute(
        "INSERT INTO canvas_nodes (node_id, owner_id, board_id, kind, x, y, w, h, body, "
        "created_at, updated_at) VALUES ('cn_note001', ?, 'brd_1', 'note', 5, 5, 10, 10, "
        "'my note', 'x', 'x')",
        (user_id,),
    )
    conn.execute(
        "INSERT INTO canvas_edges (edge_id, owner_id, board_id, from_node_id, to_node_id, kind, "
        "label, created_at, updated_at) "
        "VALUES ('ce_edge0001', ?, 'brd_1', 'cn_member1', 'cn_note001', 'supports', 'because', "
        "'x', 'x')",
        (user_id,),
    )

    # Group delete ungroups (the trigger), and keeps the member's owner — a composite
    # ON DELETE SET NULL would have nulled owner_id too and failed NOT NULL.
    conn.execute("DELETE FROM canvas_nodes WHERE node_id = 'cn_group01'")
    member = conn.execute(
        "SELECT group_id, owner_id FROM canvas_nodes WHERE node_id = 'cn_member1'"
    ).fetchone()
    assert member["group_id"] is None
    assert member["owner_id"] == user_id

    # Node delete cascades to its edges.
    assert conn.execute("SELECT COUNT(*) FROM canvas_edges").fetchone()[0] == 1
    conn.execute("DELETE FROM canvas_nodes WHERE node_id = 'cn_note001'")
    assert conn.execute("SELECT COUNT(*) FROM canvas_edges").fetchone()[0] == 0


# ── contracts.md §9: test_reparse_keeps_highlights ────────────────────────────────────────────


def test_reparse_keeps_highlights(tmp_path: Path) -> None:
    """A highlight made on gen 1 survives gen 2's promotion and gen 1's deletion.

    Under 0001 this was impossible by construction: ``highlights`` had an FK onto
    ``papers (owner_id, paper_id, generation)`` ON DELETE CASCADE, so deleting the generation a
    highlight was made on deleted the highlight. Now the highlight hangs off ``paper_owners`` and
    only its per-generation cache entry is keyed to the generation.
    """
    shape = build_demo_shape(tmp_path)
    with open_database(shape.file) as db:
        db.migrate()
        user_id, paper_id = shape.capture_paper
        owner = db.owner_for(user_id)
        record = load_capture_anchor()
        db.create_highlight(
            owner,
            PaperId(paper_id),
            highlight_id="hl_01K0REPARSEKEEPSHIGHLIGHT",
            color="blue",
            note="made on gen 1",
            created_generation=1,
            anchors=[AnchorIn(record)],
            resolutions=[
                ResolutionIn(
                    anchor_id=record["id"],
                    generation=1,
                    tier=1,
                    state="anchored",
                    block_ids=[record["selectors"][0]["blockId"]],
                    score=None,
                    resolver_version="test",
                )
            ],
        )
        before = {h.highlight_id for h in db.list_highlights(owner, PaperId(paper_id), 1)}
        assert before == {LEGACY_HIGHLIGHT, "hl_01K0REPARSEKEEPSHIGHLIGHT"}

        document = load_fixture_paper()
        document["generation"] = 2
        db.put_paper(owner, document)
        db.promote_generation(owner, PaperId(paper_id), generation(2))
    conn = raw_connect(shape.file)
    try:
        conn.execute(
            "DELETE FROM papers WHERE owner_id = ? AND paper_id = ? AND generation = 1",
            (user_id, paper_id),
        )
        assert conn.execute("SELECT COUNT(*) FROM anchor_resolutions").fetchone()[0] == 0
    finally:
        conn.close()
    with open_database(shape.file) as db:
        owner = db.owner_for(user_id)
        after = db.list_highlights(owner, PaperId(paper_id), 2)
        assert {h.highlight_id for h in after} == before
        mine = next(h for h in after if h.highlight_id == "hl_01K0REPARSEKEEPSHIGHLIGHT")
        assert mine.note == "made on gen 1" and mine.created_generation == 1
        assert mine.anchors[0].anchor == record  # paint data untouched by the re-parse
        assert mine.anchors[0].resolution is None  # the gen-1 cache died with gen 1


# ── the all-or-nothing guard ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("foreign_keys", "fires"),
    [
        # With FKs ON (every PaperTreeDb connection), the FIRST thing to refuse is the
        # anchor_resolutions INSERT: it copies a cache row for the anchor that did not carry, and
        # its FK onto the rebuilt anchors table fails. Measured, not assumed — the test was first
        # written expecting the guard and saw "FOREIGN KEY constraint failed".
        ("ON", "FOREIGN KEY constraint failed"),
        # With FKs OFF (a bare sqlite3 connection that never set the pragma) that FK is inert, and
        # `_0005_guard` is what refuses. So the guard is the second line, not dead code.
        ("OFF", "CHECK constraint failed"),
    ],
)
def test_0005_is_all_or_nothing_when_a_legacy_anchor_cannot_carry(
    tmp_path: Path, foreign_keys: str, fires: str
) -> None:
    """0005 converts legacy anchors with an INNER join onto their block's page. A row that cannot
    be converted must abort the WHOLE migration, never be dropped silently.

    Built by pointing a legacy anchor at a block on a page the generation does not have (blocks
    carry no FK onto pages, so this is storable under 0001). The migration must raise, and the
    database must be exactly the 0004 database it was: 0005 unrecorded, the old ``highlights``
    shape (with ``generation``), no new tables, no new ``paper_owners`` columns, counts unchanged.
    """
    shape = build_demo_shape(tmp_path)
    assert shape.legacy is not None
    user_id, paper_id = shape.legacy
    conn = raw_connect(shape.file)
    try:
        conn.execute(
            "INSERT INTO blocks (owner_id, paper_id, generation, block_id, page_index, type, flow, "
            '"order", polygon, bbox_x0, bbox_y0, bbox_x1, bbox_y1, source, confidence, provenance) '
            "VALUES (?, ?, 1, 'blk_nopagexxxxxxxxxx', 99, 'paragraph', 'body', 0, "
            "'[[0,0],[1,0],[1,1]]', 0, 0, 1, 1, 'pdf_text_layer', 0.5, '{}')",
            (user_id, paper_id),
        )
        conn.execute(
            "INSERT INTO anchors (anchor_id, owner_id, highlight_id, paper_id, generation, "
            "block_id, tier, polygon, bbox_x0, bbox_y0, bbox_x1, bbox_y1, resolved_at) "
            "VALUES ('anc_nopage', ?, ?, ?, 1, 'blk_nopagexxxxxxxxxx', 1, '[]', 0, 0, 1, 1, 'x')",
            (user_id, LEGACY_HIGHLIGHT, paper_id),
        )
        conn.execute(f"PRAGMA foreign_keys = {foreign_keys}")
        before = counts(conn)
        with pytest.raises(sqlite3.IntegrityError, match=fires):
            migrate(conn, MIGRATIONS_DIR)
        assert not conn.in_transaction
        assert [r[0] for r in conn.execute("SELECT version FROM schema_migrations")] == [1, 2, 3, 4]
        assert "generation" in {r[1] for r in conn.execute("PRAGMA table_info(highlights)")}
        assert "page_count" not in {r[1] for r in conn.execute("PRAGMA table_info(paper_owners)")}
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert not {"anchor_resolutions", "ai_threads", "canvas_boards", "highlights_new"} & tables
        assert counts(conn) == before
    finally:
        conn.close()


# ── the pre-0005 backup (contracts.md §6.1) ───────────────────────────────────────────────────


def test_pre_0005_backup_is_written_before_0005_touches_a_saved_database(tmp_path: Path) -> None:
    shape = build_demo_shape(tmp_path)
    conn = raw_connect(shape.file)
    try:
        before = counts(conn)
    finally:
        conn.close()

    # The API-start path: PaperTreeDb.migrate() on the data root's file.
    with open_database(shape.file) as db:
        result = db.migrate()
    backup = shape.file.with_name(shape.file.name + ".pre-0005.bak")
    assert result.applied == (5,)
    assert result.backups == (backup,)
    assert backup.is_file()
    assert not backup.with_name(backup.name + ".tmp").exists()

    # The backup is the database as it was BEFORE 0005: head 4, the 0001 highlight shape, the
    # legacy row with its placeholder polygon, every count unchanged, and a sound file.
    copy = sqlite3.connect(f"file:{backup}?mode=ro", uri=True)
    try:
        assert [r[0] for r in copy.execute("SELECT version FROM schema_migrations")] == [1, 2, 3, 4]
        assert "generation" in {r[1] for r in copy.execute("PRAGMA table_info(highlights)")}
        polygon = copy.execute(
            "SELECT polygon FROM anchors WHERE anchor_id = ?", (LEGACY_ANCHOR,)
        ).fetchone()[0]
        assert polygon == PLACEHOLDER_POLYGON
        assert {
            t: int(copy.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]) for t in before
        } == before
        assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        copy.close()

    # Rollback is a file copy: restoring the backup gives a database 0005 applies to again.
    restored = tmp_path / "restored.sqlite"
    restored.write_bytes(backup.read_bytes())
    conn = raw_connect(restored)
    try:
        assert migrate(conn, MIGRATIONS_DIR).applied == (5,)
    finally:
        conn.close()


def test_no_backup_for_a_fresh_database(tmp_path: Path) -> None:
    """Nothing to lose, so nothing to back up: a new data root migrates 1..5 in one go."""
    file = tmp_path / "fresh.sqlite"
    with open_database(file) as db:
        result = db.migrate()
    assert result.applied == (1, 2, 3, 4, 5)
    assert result.backups == ()
    assert not file.with_name(file.name + ".pre-0005.bak").exists()


def test_no_backup_once_0005_is_applied(tmp_path: Path) -> None:
    """The backup is the ROLLBACK, so it must never be overwritten by a post-0005 database."""
    shape = build_demo_shape(tmp_path)
    with open_database(shape.file) as db:
        db.migrate()
    backup = shape.file.with_name(shape.file.name + ".pre-0005.bak")
    first = backup.read_bytes()
    stamp = backup.stat().st_mtime_ns
    with open_database(shape.file) as db:
        assert db.migrate().backups == ()
    assert backup.read_bytes() == first
    assert backup.stat().st_mtime_ns == stamp


def test_an_in_memory_database_migrates_without_a_backup(tmp_path: Path) -> None:
    """``:memory:`` has no file to copy beside; 0005 must still apply."""
    conn = sqlite3.connect(":memory:", isolation_level=None)
    try:
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)  # 0001 creates the vec0 table
        conn.execute("PRAGMA foreign_keys = ON")
        migrate(conn, migrations_through(4, tmp_path / "m4"))
        result = migrate(conn, MIGRATIONS_DIR)
        assert result.applied == (5,)
        assert result.backups == ()
    finally:
        conn.close()
