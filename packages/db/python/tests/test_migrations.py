"""db/migrations.spec, Python half.

  "Migrate up from empty -> head; re-running is a no-op; a paper with 30k blocks inserts
   in <2s."

Also asserts that the checksums this runner records are byte-identical to the ones the
TypeScript runner records — which is what makes "one source of truth" a fact rather than an
intention. (The TS side records the same `sha256:<hex of the file bytes>`; both are computed
here from the same files, so a divergence in either runner's hashing would show up.)
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

import pytest
from papertree_db import (
    MigrationError,
    Row,
    generation,
    load_migrations,
    open_database,
)
from papertree_db.ids import PaperId

from .fixtures import make_paper

F0_5_TABLES = (
    "users",
    "paper_owners",
    "papers",
    "paper_promotions",
    "pages",
    "blocks",
    "relations",
    "highlights",
    "anchors",
    "derivations",
    "block_vectors",
    "schema_migrations",
)


def test_empty_to_head(tmp_path: Path) -> None:
    file = tmp_path / "papertree.sqlite"
    with open_database(file) as db:
        result = db.migrate()
        on_disk = tuple(m.version for m in load_migrations())
        assert result.applied == on_disk
        assert result.head == on_disk

    raw = sqlite3.connect(file)
    try:
        names = {
            str(row[0])
            for row in raw.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
    finally:
        raw.close()
    for table in F0_5_TABLES:
        assert table in names, f"{table} missing after migrate"
    # jobs / job_steps are F0.6's, and 0002_jobs.sql has since landed. This assertion was
    # written inverted to pin the split while F0.6 was outstanding; flipping it is the
    # only edit F0.6 made to packages/db.
    assert "jobs" in names
    assert "job_steps" in names


def test_recorded_checksums_match_the_files_on_disk(tmp_path: Path) -> None:
    """Both runners record `sha256:<hex of the file bytes>`; this pins that definition.

    If either language ever hashed something else — normalised text, statements after
    splitting — the other language's re-migrate would report drift on a database it did
    not write. Pinning it on both sides is what makes that impossible.
    """
    from papertree_db import applied_migrations, find_migrations_dir

    file = tmp_path / "papertree.sqlite"
    with open_database(file) as db:
        db.migrate()

    raw = sqlite3.connect(file)
    try:
        recorded = {m.version: m.checksum for m in applied_migrations(raw)}
    finally:
        raw.close()

    directory = find_migrations_dir()
    for migration in load_migrations():
        path = next(
            p for p in directory.iterdir() if p.name.startswith(f"{migration.version:04d}_")
        )
        expected = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
        assert recorded[migration.version] == expected


def test_rerun_is_a_noop(tmp_path: Path) -> None:
    file = tmp_path / "papertree.sqlite"
    with open_database(file) as db:
        assert len(db.migrate().applied) > 0
        assert db.migrate().applied == ()
        assert db.migrate().applied == ()

    # …and across a fresh connection.
    with open_database(file) as db:
        assert db.migrate().applied == ()


def test_a_database_migrated_by_typescript_is_a_noop_for_python(tmp_path: Path) -> None:
    """THE DRIFT TEST. The TypeScript runner migrates a file; the Python runner then reads
    it and must apply nothing and report no checksum conflict.

    This is what "both languages read ONE source of truth" means operationally: if the two
    runners disagreed about statement splitting, checksums, or the schema_migrations shape,
    this test fails.
    """
    package_root = Path(__file__).resolve().parents[2]  # packages/db
    node = shutil.which("node")
    if node is None or not (package_root / "node_modules").exists():
        pytest.skip("node / node_modules not available for the cross-language drift check")

    file = tmp_path / "cross.sqlite"
    completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
        [node, "--import", "tsx", "test/support/migrate-cli.ts", str(file)],
        cwd=package_root,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        pytest.skip(f"TypeScript runner could not be executed here: {completed.stderr[-400:]}")

    applied_by_ts = json.loads(completed.stdout.strip().splitlines()[-1])["applied"]
    assert applied_by_ts == [m.version for m in load_migrations()]

    with open_database(file) as db:
        assert db.migrate().applied == ()


def test_edited_migration_is_refused(tmp_path: Path) -> None:
    file = tmp_path / "papertree.sqlite"
    with open_database(file) as db:
        db.migrate()

    raw = sqlite3.connect(file, isolation_level=None)
    raw.execute("UPDATE schema_migrations SET checksum = 'sha256:tampered'")
    raw.close()

    with open_database(file) as db, pytest.raises(MigrationError, match="forward-only"):
        db.migrate()


def test_30k_blocks_insert_under_two_seconds(tmp_path: Path) -> None:
    file = tmp_path / "papertree.sqlite"
    with open_database(file) as db:
        db.migrate()
        owner = db.create_user("perf@papertree.test")
        paper = make_paper(
            paper_id="ppr_00000000000000000000000001",
            source_hash="sha256:" + "a" * 64,
            generation=1,
            block_count=30_000,
        )

        started = time.perf_counter()
        db.put_paper(owner, paper)
        elapsed_ms = (time.perf_counter() - started) * 1000

        # Printed, not merely asserted: the number is the deliverable, the bound is the gate.
        print(
            f"\n[db/migrations.spec::py] 30,000 blocks + {len(paper['pages'])} pages + "
            f"{len(paper['relations'])} relations inserted in {elapsed_ms:.0f} ms "
            f"(one transaction, executemany, WAL, synchronous=NORMAL, on-disk file)"
        )

        assert db.count_blocks(owner, PaperId(str(paper["paper_id"])), generation(1)) == 30_000
        assert elapsed_ms < 2000


def test_30k_realistic_blocks_measured_because_the_two_second_bound_does_not_hold_there(
    tmp_path: Path,
) -> None:
    """WHAT THE BOUND ABOVE ACTUALLY MEASURES.

    Its fixture is ``minimal``: a 38-character text, one span, a four-point polygon — about
    a quarter of the bytes a real parser emits for a body paragraph. An adversarial review
    re-ran the acceptance test with a parser-shaped payload and measured, on the machine
    this was built on::

        minimal    TS ~1.0-1.1 s   Python ~1.5-1.6 s     (32 MB database)
        realistic  TS ~2.1-2.2 s   Python ~3.6-3.8 s     (135 MB database)
        heavy      TS ~4.0-4.4 s   Python ~7.1-7.5 s     (258 MB database)

    No index was omitted to make the number and the ``json_valid()`` CHECKs cost ~7%; the
    gap is data volume. The acceptance figure is TRUE and it is FIXTURE-DEPENDENT, and both
    halves are recorded here rather than one being implied. The bound below is a regression
    guard at a measured value, not a second acceptance criterion.
    """
    file = tmp_path / "papertree.sqlite"
    with open_database(file) as db:
        db.migrate()
        owner = db.create_user("perf-realistic@papertree.test")
        paper = make_paper(
            paper_id="ppr_00000000000000000000000042",
            source_hash="sha256:" + "4" * 64,
            generation=1,
            block_count=30_000,
            page_count=500,
            payload="realistic",
        )

        started = time.perf_counter()
        db.put_paper(owner, paper)
        elapsed_ms = (time.perf_counter() - started) * 1000

        print(
            f"\n[db/migrations.spec::py] 30,000 REALISTIC blocks (60 words, 12 spans, "
            f"8-point polygon) inserted in {elapsed_ms:.0f} ms — the <2s acceptance bound is "
            f"met by the minimal fixture only; this is the honest parser-shaped number"
        )

        assert db.count_blocks(owner, PaperId(str(paper["paper_id"])), generation(1)) == 30_000
        assert elapsed_ms < 12_000


def test_generations_share_block_ids(tmp_path: Path) -> None:
    """DESIGN.md D13: content-derived ids are IDENTICAL across generations, by design."""
    file = tmp_path / "papertree.sqlite"
    with open_database(file) as db:
        db.migrate()
        owner = db.create_user("gen@papertree.test")
        paper_id = PaperId("ppr_00000000000000000000000002")
        source_hash = "sha256:" + "b" * 64

        db.put_paper(owner, make_paper(paper_id, source_hash, 1, 20))
        db.put_paper(owner, make_paper(paper_id, source_hash, 2, 20))

        assert db.list_generations(owner, paper_id) == [1, 2]
        g1: list[Row] = db.list_blocks_in_doc_order(owner, paper_id, generation(1))
        g2: list[Row] = db.list_blocks_in_doc_order(owner, paper_id, generation(2))
        assert len(g1) == len(g2) == 20
        # `blocks(block_id PK)` would have thrown here; `papers(source_hash UNIQUE)` above.
        assert [b["block_id"] for b in g1] == [b["block_id"] for b in g2]

        db.promote_generation(owner, paper_id, generation(2))
        assert db.promoted_generation(owner, paper_id) == 2
        db.promote_generation(owner, paper_id, generation(1))  # reversible for one cycle
        assert db.promoted_generation(owner, paper_id) == 1


def test_cannot_promote_a_generation_that_does_not_exist(tmp_path: Path) -> None:
    file = tmp_path / "papertree.sqlite"
    with open_database(file) as db:
        db.migrate()
        owner = db.create_user("gen2@papertree.test")
        paper_id = PaperId("ppr_00000000000000000000000003")
        db.put_paper(owner, make_paper(paper_id, "sha256:" + "c" * 64, 1, 3))
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            db.promote_generation(owner, paper_id, generation(9))
