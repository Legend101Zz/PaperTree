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
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from papertree_db import (
    MigrationError,
    OwnerId,
    PaperTreeDb,
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
#:
#: #99 CLOSED THAT GAP WITHOUT TOUCHING THIS NUMBER. `test_put_paper_executes_one_statement_per_row`
#: below counts statements instead of timing them and catches all three mutations in the table
#: above, on every machine including CI. This bound stays at 2.0 because the healthy range that
#: set it has not changed; the coverage was added beside it rather than squeezed out of it.
MAX_SCALING_RATIO = 2.0

# ── the statement-count guard (#99 option 2, which is also #82's answer) ──────────────────
#
# WHY THIS EXISTS AT ALL. The ratio above is a TIME ratio, and #82 measured the mechanism that
# makes it stable — machine speed inflates the calibration and the measurement equally and
# cancels — cancelling the regressions it most needs to see for exactly the same reason. A
# per-row constant factor is invisible to it BY CONSTRUCTION, not by bad luck: 20 extra
# statements on every row scored 1.041 against a bound of 2.0, and a lost transaction — a real
# 2.4x here — scored 1.013, BELOW the healthy reading it replaced. Tightening the bound was
# measured and
# rejected in #99 — the healthy range tops out at 1.197, so a bound at 1.5 is a flake generator
# and that is the defect #80 exists to prevent, arriving from the other direction.
#
# A STATEMENT COUNT HAS NO SPREAD TO TUNE AGAINST. It is a function of the code path and the
# document and of nothing else, so no amount of disk queue, CPU contention or first-touch cost
# can move it — the thing that makes every number above need a tolerance cannot reach this one.
# So the bound is not "a number with slack in it", it is the answer, and any deviation at all is
# a defect. That turns the question from "is it fast" into "does it do the right amount of work",
# which is what #82 and #99 are both really about.
#
# MEASURED RATHER THAN ASSUMED, on the machine this was written on: the 30,000-block document
# costs 30,537 statements with the minimal payload and 30,537 with the realistic one, and the
# TypeScript twin executes 30,537 for the same document. The CI figure is not yet in hand — the
# count is PRINTED on every run precisely so the first CI run of this test records it, in the
# same way #82's comment thread collected the ratio's runner spread after the fact.
#
# THE DERIVATION. `put_paper` executes, for a document with P pages, B blocks and R relations:
#
#     BEGIN                                                          1
#     INSERT OR IGNORE INTO paper_owners                             1
#     SELECT owner_id FROM paper_owners   (the cross-owner check)    1
#     INSERT INTO papers                                             1
#     INSERT INTO pages       via executemany                        P
#     INSERT INTO blocks      via executemany                        B
#     INSERT INTO relations   via executemany                        R
#     COMMIT                                                         1
#                                                                    ─────────────
#                                                                    P + B + R + 5
#
# `executemany` prepares once and steps once per row, and SQLite's statement trace fires on each
# step — so a batched insert costs exactly ONE statement per row and the loop that replaces it
# costs the same. What is NOT one per row is anything ADDED per row, which is the whole point.
#
# WHAT THE TWO CONSTANTS BELOW ASSERT IS A SHAPE, NOT A MAGIC NUMBER. The test measures the
# count at two sizes and fits `statements = rows * STATEMENTS_PER_ROW + FIXED_STATEMENTS_PER_PUT`
# to both. The SLOPE catches per-row work; the INTERCEPT must be the SAME INTEGER at both sizes,
# and that is what rules out a superlinear term: an O(n^2) path contributes c*n^2 to the
# intercept, which grows NINEFOLD between 10k and 30k. With integer counts and zero tolerance the
# smallest detectable c is 1/(8*10^8) — i.e. one single extra statement anywhere in the run.
#
# MEASURED, ON THIS SPEC, BY APPLYING #99'S THREE MUTATIONS TO `put_paper`, RUNNING THIS TEST AND
# WATCHING IT GO RED. The `time ratio` column is #99's measurement of the guard above, on the
# same mutation, for comparison — it is what a time-based guard saw and did not act on.
#
#     mutation to put_paper                        10k        30k   per row  time ratio  here
#     (healthy)                                 10,204     30,537    1.000   0.944-1.197 green
#     scan `blocks` every 10th insert O(n^2/10) 11,204     33,537    1.098   1.425       RED
#     scan `blocks` every insert      O(n^2)    20,204     60,537    1.983   1.998       RED
#     20 no-op statements per row     constant 210,204    630,537   20.652   1.041       RED
#     no transaction wrapper (#82's M1)         10,202     30,535    1.000   1.013       RED
#
# `per row` is `(statements - fixed) / rows` at 30k. Every count above is IDENTICAL in the
# TypeScript twin — measured by applying the same four mutations to `putPaper`, not assumed.
#
# THE LAST ROW IS #82'S HEADLINE DEFECT and the first thing in this repo that has ever seen it on
# CI. A lost transaction adds no per-row work, so the slope is untouched at exactly 1.000; what
# moves is the INTERCEPT, from 5 to 3, because the BEGIN and the COMMIT are gone. That is why the
# test asserts both and not just the slope. The three middle rows are #99's table verbatim, and
# the time ratio passes all three.
#
# ITS RATIO WAS MEASURED HERE RATHER THAN BORROWED, AND IT IS WORSE THAN #82 REPORTED. #82's
# 1.192 is the TYPESCRIPT half; the Python half had never been measured. On this box — load
# average ~40 on 10 cores, so a slow one — the healthy 30k minimal insert took 3,858 ms at ratio
# 1.167 and the same insert with the transaction wrapper deleted took 9,306 ms at ratio 1.013.
# A 2.4x regression moved the ratio DOWN, TOWARDS the middle of healthy and AWAY from the bound.
# The realistic payload behaved the same way (1.059 healthy, 1.033 mutated) and that test carries
# no wall-clock assertion at all, so it stayed green end to end. The ratio is not merely blind to
# a lost transaction; the reading it produces is actively reassuring.
#
# WHAT THIS STILL DOES NOT CATCH, because a guard's blind spot is not a detail: a constant factor
# that executes no extra SQL. Serialising every block twice, or an O(n^2) pure-Python loop over
# `paper["blocks"]`, costs time and costs no statements. `LOCAL_BOUND_MS` and the ratio above
# remain the guards for that, off CI and on. The two guards are complementary and neither
# replaces the other — this one sees work, those two see time.

#: Statements `put_paper` may execute per row of the document. One INSERT, and nothing else.
STATEMENTS_PER_ROW = 1

#: Statements `put_paper` executes regardless of size: BEGIN, the ownership INSERT and SELECT,
#: the `papers` INSERT, COMMIT. See the derivation table above. If you add a fixed statement
#: deliberately, change this number and say why; if you did not, this guard has found something.
FIXED_STATEMENTS_PER_PUT = 5


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


class _StatementCounter:
    """Counts SQL statements via ``sqlite3.Connection.set_trace_callback``.

    INSTALLED BY MONKEYPATCHING ``sqlite3.connect``, NOT BY REACHING FOR ``db._conn``. That
    attribute is a forbidden token outside ``papertree_db`` and
    ``test_ownership.py::test_conn_is_a_forbidden_token_outside_papertree_db`` PARSES this file
    to prove it — gate 1 of the ownership model is language-enforced in TypeScript and only a
    convention in Python, and a test that quietly exempted itself would be the first crack in
    it. So the callback is attached to the connection as it is created and this file never holds
    a ``sqlite3.Connection`` at all. `packages/db/test/migrations.spec.ts` instruments its own
    driver from the outside for the same reason, and neither half needed a production hook.

    The callback fires for EVERY statement on the connection, including `migrate()` and
    `create_user()`, so counting is gated on `counting()` and covers exactly one call.
    """

    def __init__(self) -> None:
        self.total = 0
        self._armed = False

    def _trace(self, _statement: str) -> None:
        if self._armed:
            self.total += 1

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Arms every connection opened from now until the test ends."""
        real_connect = sqlite3.connect

        def connect(*args: Any, **kwargs: Any) -> sqlite3.Connection:
            conn: sqlite3.Connection = real_connect(*args, **kwargs)
            conn.set_trace_callback(self._trace)
            return conn

        monkeypatch.setattr(sqlite3, "connect", connect)

    @contextmanager
    def counting(self) -> Iterator[None]:
        self.total = 0
        self._armed = True
        try:
            yield
        finally:
            self._armed = False


def _put_and_count(
    db: PaperTreeDb,
    owner: OwnerId,
    counter: _StatementCounter,
    *,
    paper_id: str,
    source_hash: str,
    block_count: int,
) -> tuple[int, int]:
    """``(rows in the document, SQL statements `put_paper` executed)``.

    The row count is taken from the DOCUMENT rather than recomputed from the fixture's rules,
    so the expectation cannot drift away from what was actually inserted.
    """
    paper = make_paper(
        paper_id=paper_id,
        source_hash=source_hash,
        generation=1,
        block_count=block_count,
        # Proportional to block_count, matching `_timed_put`, so this guard and the timing
        # guards above are measuring the same shaped document.
        page_count=max(1, round(block_count / 60)),
    )
    rows = len(paper["pages"]) + len(paper["blocks"]) + len(paper["relations"])

    with counter.counting():
        db.put_paper(owner, paper)
    statements = counter.total

    # Correctness is unconditional here too. A `put_paper` that silently inserted nothing would
    # execute five statements, satisfy no shape at all, and — if this assertion were missing —
    # be indistinguishable from a document that happened to have no rows.
    assert db.count_blocks(owner, PaperId(paper_id), generation(1)) == block_count
    return rows, statements


def test_put_paper_executes_one_statement_per_row(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """#99 / #82: count the SQL statements a 30k insert executes instead of timing it.

    See the block comment above `STATEMENTS_PER_ROW` for the derivation, for the measured
    counts under #99's three mutations, and for what this still does not catch.
    """
    counter = _StatementCounter()
    counter.install(monkeypatch)

    with open_database(tmp_path / "papertree.sqlite") as db:
        db.migrate()
        owner = db.create_user("statements@papertree.test").owner
        small_rows, small_statements = _put_and_count(
            db,
            owner,
            counter,
            paper_id="ppr_00000000000000000000000301",
            source_hash="sha256:" + "7" * 64,
            block_count=BASELINE_BLOCKS,
        )
        big_rows, big_statements = _put_and_count(
            db,
            owner,
            counter,
            paper_id="ppr_00000000000000000000000302",
            source_hash="sha256:" + "8" * 64,
            block_count=TARGET_BLOCKS,
        )

    with capsys.disabled():
        print(
            f"\n[db/migrations.spec::py] {TARGET_BLOCKS:,} blocks cost {big_statements:,} SQL "
            f"statements ({big_rows:,} rows + {big_statements - big_rows} fixed); the "
            f"{BASELINE_BLOCKS:,}-block insert cost {small_statements:,} ({small_rows:,} rows + "
            f"{small_statements - small_rows} fixed). Slope "
            f"{(big_statements - small_statements) / (big_rows - small_rows):.3f} statements per "
            f"row, bound exactly {STATEMENTS_PER_ROW}. Deterministic — no timing in it."
        )

    # THE SLOPE. One INSERT per row and nothing else. A scan every Nth insert, an extra
    # per-row SELECT, an `executemany` unrolled into a loop that also reads — every one of
    # them lands here, and none of them moves the time ratio far enough to be seen (#99).
    assert big_statements - small_statements == (big_rows - small_rows) * STATEMENTS_PER_ROW, (
        f"{TARGET_BLOCKS - BASELINE_BLOCKS:,} more blocks cost "
        f"{big_statements - small_statements:,} more statements, not "
        f"{(big_rows - small_rows) * STATEMENTS_PER_ROW:,}. `put_paper` is doing per-row SQL "
        f"work it did not do before."
    )

    # THE INTERCEPT, at BOTH sizes, and it is the same integer or the path is not linear.
    # A c*n^2 term contributes 9x more here at 30k than at 10k; a c*n term contributes 3x more.
    # Only a genuine constant survives both equalities.
    for label, rows, statements in (
        (f"{BASELINE_BLOCKS:,}", small_rows, small_statements),
        (f"{TARGET_BLOCKS:,}", big_rows, big_statements),
    ):
        assert statements - rows * STATEMENTS_PER_ROW == FIXED_STATEMENTS_PER_PUT, (
            f"the {label}-block insert executed {statements:,} statements for {rows:,} rows, so "
            f"{statements - rows * STATEMENTS_PER_ROW} of them were fixed overhead rather than "
            f"{FIXED_STATEMENTS_PER_PUT}. Fewer means a lost BEGIN/COMMIT (#82); more that is "
            f"not the same integer at both sizes means a superlinear path (#99)."
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
