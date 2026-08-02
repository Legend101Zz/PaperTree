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
import os
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

# EPIC-00's acceptance criterion, and the SHAPE of the regression guard beside it.
#
# #83 — WHY THERE IS NO LONGER A WALL-CLOCK CONSTANT ON CI. This file used to assert
# `elapsed_ms < BOUND_MS` with `BOUND_MS = 8000 if CI else 2000`, and the realistic test
# asserted a bare `8000`. That is #80's defect in the other language: a wall-clock constant on
# a shared runner measures GitHub's disk queue, and the gap between "tight enough to fire on
# noise" and "loose enough that a real 2x regression passes" is not a gap you can tune your way
# into. 8000 against a measured ~1.2 s was the second shape `AGENTS.md` §2 warns about — the
# insert path could regress SIXFOLD and stay green, which is a smoke test that the code still
# terminates.
#
# The TypeScript twin shed this in #80. Both halves are back in step.
#
# WHAT REPLACES IT IS A RATIO. Each test times a small insert first, in the same process,
# through the same code path, then the 30k insert. If `put_paper` is linear in block count the
# second should take `SCALE` times the first, so `elapsed / (baseline * SCALE)` sits near 1.0 on
# any machine at any speed — a slow runner slows both halves equally and cancels.
#
# THE PYTHON NUMBERS ARE RE-DERIVED, NOT CARRIED ACROSS FROM THE TYPESCRIPT TWIN, which is what
# #83 asks for: the two halves measure different absolute times and their spreads are not
# interchangeable. Six runs on an M-series Mac, three near-idle and three under ~2.7x CPU
# overload (20 busy loops on 10 cores):
#
#                        idle             loaded
#     minimal payload    1.087-1.120      1.024-1.197
#     realistic payload  1.035-1.067      0.944-1.072
#
# FULL OBSERVED RANGE 0.944-1.197 against a bound of 2.0. The property that matters is the
# second column: the overload moved the underlying measurement 2.6-2.7x (30k minimal 523 ->
# 1456 ms; realistic 1192 -> 3031 ms) and moved the RATIO by at most 0.08.
#
# WHAT THE RATIO GIVES UP, STATED PLAINLY BECAUSE A GUARD'S BLIND SPOT IS NOT A DETAIL. It
# catches SUPERLINEAR regressions. It does NOT catch a per-row CONSTANT factor, because a
# constant inflates the calibration and the measurement equally and cancels exactly the way
# machine speed does. #82 carries that, and `LOCAL_BOUND_MS` below is what still sees it —
# off CI only, exactly as the TypeScript side keeps its own.
#
# Keep both halves of the twin (this file and `test/migrations.spec.ts`) in step.
LOCAL_BOUND_MS = 2000

#: Blocks in the calibration insert each timing test runs before the real one.
#:
#: 10,000 rather than something smaller, for the reason the TypeScript twin measured and
#: recorded: a calibration must be long enough to experience the same machine the measurement
#: does. At 10,000 blocks it is ~160 ms minimal / ~370 ms realistic here, and the 2.7x overload
#: above moves it proportionally rather than letting it slip through a quiet slice.
BASELINE_BLOCKS = 10_000
TARGET_BLOCKS = 30_000
SCALE = TARGET_BLOCKS / BASELINE_BLOCKS

#: Blocks in the UNTIMED warm-up insert that precedes both timed ones.
#:
#: Without it the calibration pays one-time costs the measurement does not — first `put_paper`
#: call, first prepared-statement compile, first WAL growth — and the ratio stops being a
#: linearity measure. The TypeScript side observed this as a ratio of 0.290 on a real CI runner
#: and identified it as V8 tier-up; CPython has no tier-up but it has the same first-touch
#: costs, and a ratio that is wrong in the SAFE direction is still wrong: 0.290 means the guard
#: needs a 6.9x regression to trip instead of 2x.
WARMUP_BLOCKS = 10_000

#: How far above perfectly-linear the 30k insert may land. 2.0 is 1.67x the slowest ratio
#: observed in the six runs above, across both payloads and a 2.7x machine-speed swing.
#:
#: WHAT IT CATCHES AND WHAT IT DOES NOT, MEASURED AGAINST THIS SPEC RATHER THAN GUESSED — AND
#: THE ANSWER IS WORSE THAN THE TYPESCRIPT TWIN'S. Three mutations applied to `put_paper`:
#:
#:     mutation                                   minimal    realistic   caught by
#:     scan `blocks` every 10th insert  O(n^2/10)   1.425        1.255    NOTHING
#:     scan `blocks` every insert       O(n^2)      1.998        1.966    LOCAL_BOUND_MS only
#:     20 no-op statements per row      constant    1.041        1.055    NOTHING
#:
#: The TypeScript twin records the FIRST of those at 2.196 (red) and 1.984 (green, only just).
#: In Python the same regression is 1.425 — comfortably green. The cause is that Python's
#: per-row overhead (sqlite3 parameter marshalling and the JSON serialisation in
#: `_block_params`) dominates the insert, so an added SQL cost is a smaller SHARE of the total
#: and therefore a smaller ratio. THE TWO HALVES OF THE TWIN HAVE DIFFERENT RESOLUTIONS, and
#: this half's is roughly 2x coarser.
#:
#: The bound is NOT tightened to make those mutations red. The healthy range measured above is
#: 0.944-1.197; a bound at 1.5 would sit 1.25x above the slowest healthy observation and would
#: be a flake generator, which is the defect #80 was filed for. A bound is set where the data
#: puts it, and its resolution is then reported rather than wished away.
#:
#: THE CONSEQUENCE, STATED SO NOBODY HAS TO REDISCOVER IT: on CI, where `LOCAL_BOUND_MS` is not
#: asserted, this guard would not have caught an O(n^2) insert path. It is still strictly better
#: than the `8000` ms constant it replaces — that could not fire on a 6x regression and DID fire
#: on a docs-only PR — but "better than a broken guard" is not "a good guard". Filed, with this
#: table, as the Python counterpart to #82.
MAX_SCALING_RATIO = 2.0


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
    # SYMMETRIC WITH THE TYPESCRIPT TWIN. migrations.spec.ts fails rather than skips when `uv`
    # is missing, because a skip reports as a pass and CI then certifies a check it never ran.
    # This side skipped silently instead, and CI's Python job installs no Node — so the
    # Python->TS direction was disabled there permanently while the TS->Python direction ran.
    # Caught by watching the first real CI run: "717 passed, 1 skipped" against 718 locally.
    opted_out = os.environ.get("PT_SKIP_CROSS_LANGUAGE_DRIFT") == "1"
    node = shutil.which("node")
    if node is None or not (package_root / "node_modules").exists():
        if opted_out:
            pytest.skip("cross-language drift check explicitly opted out")
        raise AssertionError(
            "db/migrations.spec cannot run the Python->TypeScript drift check because node or "
            "packages/db/node_modules is missing. Run `pnpm install`, or set "
            "PT_SKIP_CROSS_LANGUAGE_DRIFT=1 to acknowledge that you are running without it."
        )

    file = tmp_path / "cross.sqlite"
    completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
        [node, "--import", "tsx", "test/support/migrate-cli.ts", str(file)],
        cwd=package_root,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        if opted_out:
            pytest.skip(f"TypeScript runner unavailable, opted out: {completed.stderr[-200:]}")
        raise AssertionError(
            f"the TypeScript migration runner failed, so the drift check did not run: "
            f"{completed.stderr[-400:]}"
        )

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


def _timed_put(
    db: object,
    owner: object,
    *,
    paper_id: str,
    source_hash: str,
    block_count: int,
    payload: str | None = None,
) -> float:
    """Insert `block_count` blocks through `put_paper` and return the elapsed milliseconds.

    CORRECTNESS IS UNCONDITIONAL AND APPLIES TO THE CALIBRATION INSERT TOO. A baseline that
    silently inserted nothing would be fast, would make every ratio pass, and would look exactly
    like a healthy run — which is the shape of every defect `AGENTS.md` §2 lists.
    """
    # Page count is PROPORTIONAL to block_count so the calibration does the same work per block
    # as the target: a fixed page count would make the small insert cheaper per row and inflate
    # the ratio for a reason that has nothing to do with linearity.
    pages = max(1, round(block_count / 60))
    paper = (
        make_paper(
            paper_id=paper_id,
            source_hash=source_hash,
            generation=1,
            block_count=block_count,
            page_count=pages,
        )
        if payload is None
        else make_paper(
            paper_id=paper_id,
            source_hash=source_hash,
            generation=1,
            block_count=block_count,
            page_count=pages,
            payload=payload,
        )
    )
    started = time.perf_counter()
    db.put_paper(owner, paper)  # type: ignore[attr-defined]
    elapsed_ms = (time.perf_counter() - started) * 1000
    assert db.count_blocks(owner, PaperId(paper_id), generation(1)) == block_count  # type: ignore[attr-defined]
    return elapsed_ms


def _scaling_ratio(payload: str | None, file: Path) -> tuple[float, float, float]:
    """`(baseline_ms, elapsed_ms, ratio)` for one payload shape, all in one process."""
    with open_database(file) as db:
        db.migrate()
        owner = db.create_user(f"perf-{payload or 'minimal'}@papertree.test").owner
        # Untimed and discarded. See WARMUP_BLOCKS.
        _timed_put(
            db,
            owner,
            paper_id="ppr_00000000000000000000000201",
            source_hash="sha256:" + "1" * 64,
            block_count=WARMUP_BLOCKS,
            payload=payload,
        )
        baseline_ms = _timed_put(
            db,
            owner,
            paper_id="ppr_00000000000000000000000101",
            source_hash="sha256:" + "e" * 64,
            block_count=BASELINE_BLOCKS,
            payload=payload,
        )
        elapsed_ms = _timed_put(
            db,
            owner,
            paper_id="ppr_00000000000000000000000001",
            source_hash="sha256:" + "a" * 64,
            block_count=TARGET_BLOCKS,
            payload=payload,
        )
    return baseline_ms, elapsed_ms, elapsed_ms / (baseline_ms * SCALE)


def test_30k_blocks_insert_scales_linearly(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """EPIC-00's `30k blocks in <2s`, guarded by a RATIO rather than a wall-clock constant.

    See the block comment above `LOCAL_BOUND_MS` for why the constant is gone rather than
    larger, and for the six runs that set the bound.
    """
    baseline_ms, elapsed_ms, ratio = _scaling_ratio(None, tmp_path / "papertree.sqlite")

    # Printed, not merely asserted: the number is the deliverable, the ratio is the gate.
    # `capsys.disabled()` and not a bare print, because the root pyproject sets `addopts = "-q"`
    # and pytest captures stdout from PASSING tests — so `uv run pytest`, the documented gate
    # command, showed neither figure.
    with capsys.disabled():
        print(
            f"\n[db/migrations.spec::py] {TARGET_BLOCKS:,} blocks inserted in "
            f"{elapsed_ms:.0f} ms (one transaction, executemany, WAL, synchronous=NORMAL, "
            f"on-disk file); {BASELINE_BLOCKS:,}-block calibration in the same process took "
            f"{baseline_ms:.0f} ms, so linear would be {baseline_ms * SCALE:.0f} ms — scaling "
            f"ratio {ratio:.3f} (bound {MAX_SCALING_RATIO}). EPIC-00's {LOCAL_BOUND_MS} ms "
            f"acceptance criterion: {'MET' if elapsed_ms < LOCAL_BOUND_MS else 'NOT MET'}"
            f"{' — not asserted under CI' if os.environ.get('CI') else ''}"
        )

    # THE GATE, on every machine.
    assert ratio < MAX_SCALING_RATIO, (
        f"30k blocks took {ratio:.3f}x what a linear scale-up of the {BASELINE_BLOCKS:,}-block "
        f"calibration predicts. A superlinear insert path lands at {SCALE} or beyond."
    )

    if os.environ.get("CI"):
        with capsys.disabled():
            print(
                f"[db/migrations.spec::py] EPIC-00's {LOCAL_BOUND_MS} ms bound is NOT asserted "
                f"under CI by design (#80/#83) — it measured GitHub's disk queue, not this code. "
                f"The scaling ratio above is asserted everywhere. Run the suite locally to gate "
                f"on {LOCAL_BOUND_MS} ms."
            )
    else:
        # EPIC-00's acceptance criterion, verbatim, asserted where its premise holds: a machine
        # whose speed is ours. Off CI this is also the ONLY assertion here that can see a per-row
        # constant-factor regression — the ratio cancels it exactly (#82).
        assert elapsed_ms < LOCAL_BOUND_MS


def test_30k_realistic_blocks_are_measured_not_assumed(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """WHAT THE TEST ABOVE ACTUALLY MEASURES.

    Its fixture is ``minimal``: a 38-character text, one span, a four-point polygon — about a
    quarter of the bytes a real parser emits for a body paragraph. An adversarial review re-ran
    the acceptance test with a parser-shaped payload and measured, on the machine this was
    built on::

        minimal    TS ~0.71 s      Python ~0.97-1.07 s   (32 MB database)
        realistic  TS ~1.50 s      Python ~2.29 s        (135 MB database)

    No index was omitted to make the number and the ``json_valid()`` CHECKs cost ~7%; the gap
    is data volume. The acceptance figure is TRUE and it is FIXTURE-DEPENDENT, and both halves
    are recorded here rather than one being implied.

    RE-MEASURED 2026-08-02 FOR #83 and the absolute figures above do not reproduce on this box:
    the realistic 30k insert is **1130-1192 ms**, not ~2.29 s, with the warm-up in front of it.
    Kept above as recorded history, corrected here. It is the RATIO that is asserted either way,
    and the ratio is what survives the disagreement.

    No wall-clock constant here at all, matching the TypeScript twin: `LOCAL_BOUND_MS` is
    EPIC-00's criterion and EPIC-00 stated it for the minimal fixture. A second constant
    invented for this payload would be a second acceptance criterion nobody agreed to.
    """
    baseline_ms, elapsed_ms, ratio = _scaling_ratio("realistic", tmp_path / "papertree.sqlite")

    with capsys.disabled():
        print(
            f"\n[db/migrations.spec::py] {TARGET_BLOCKS:,} REALISTIC blocks (60 words, 12 "
            f"spans, 8-point polygon) inserted in {elapsed_ms:.0f} ms; {BASELINE_BLOCKS:,}-block "
            f"calibration {baseline_ms:.0f} ms, so linear would be {baseline_ms * SCALE:.0f} ms "
            f"— scaling ratio {ratio:.3f} (bound {MAX_SCALING_RATIO}). Parser-shaped, measured."
        )

    assert ratio < MAX_SCALING_RATIO, (
        f"the realistic payload scaled at {ratio:.3f}x linear. The minimal fixture is the more "
        f"sensitive of the two, so a regression visible only here is a payload-size effect."
    )


def test_generations_share_block_ids(tmp_path: Path) -> None:
    """DESIGN.md D13: content-derived ids are IDENTICAL across generations, by design."""
    file = tmp_path / "papertree.sqlite"
    with open_database(file) as db:
        db.migrate()
        owner = db.create_user("gen@papertree.test").owner
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
        owner = db.create_user("gen2@papertree.test").owner
        paper_id = PaperId("ppr_00000000000000000000000003")
        db.put_paper(owner, make_paper(paper_id, "sha256:" + "c" * 64, 1, 3))
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            db.promote_generation(owner, paper_id, generation(9))
