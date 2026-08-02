// db/migrations.spec — EPIC-00 acceptance test.
//
//   "Migrate up from empty -> head; re-running is a no-op; a paper with 30k blocks inserts
//    in <2s."

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appliedMigrations,
  asPaperId,
  findMigrationsDir,
  generation,
  loadMigrations,
  openDatabase,
  type OwnerId,
  type PaperTreeDb,
} from '../src/index.js';
import { makePaper } from './fixtures.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'papertree-db-'));
  file = join(dir, 'papertree.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('empty -> head', () => {
  it('applies every migration on disk to an empty database', () => {
    const db = openDatabase({ filename: file });
    try {
      const result = db.migrate();
      const onDisk = loadMigrations().map((m) => m.version);
      expect(result.applied).toEqual(onDisk);
      expect(result.head).toEqual(onDisk);
    } finally {
      db.close();
    }

    const raw = new Database(file, { readonly: true });
    try {
      const tables = raw
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name",
        )
        .all()
        .map((r) => r.name);
      // Every table F0.5 owns. jobs/job_steps are F0.6's (0002_jobs.sql) by design.
      for (const expected of [
        'users',
        'paper_owners',
        'papers',
        'paper_promotions',
        'pages',
        'blocks',
        'relations',
        'highlights',
        'anchors',
        'derivations',
        'block_vectors',
        'schema_migrations',
      ]) {
        expect(tables).toContain(expected);
      }
      // jobs / job_steps are F0.6's, and 0002_jobs.sql has since landed. These two
      // assertions were written inverted to pin the split while F0.6 was outstanding;
      // flipping them is the only edit F0.6 made to packages/db.
      expect(tables).toContain('jobs');
      expect(tables).toContain('job_steps');
    } finally {
      raw.close();
    }
  });

  it('records a checksum for each applied migration', () => {
    const db = openDatabase({ filename: file });
    try {
      db.migrate();
      const raw = new Database(file, { readonly: true });
      const applied = appliedMigrations(raw);
      raw.close();
      expect(applied.map((m) => m.checksum)).toEqual(loadMigrations().map((m) => m.checksum));
    } finally {
      db.close();
    }
  });
});

describe('re-run is a no-op', () => {
  it('applies nothing on the second call, in the same process', () => {
    const db = openDatabase({ filename: file });
    try {
      expect(db.migrate().applied.length).toBeGreaterThan(0);
      expect(db.migrate().applied).toEqual([]);
      expect(db.migrate().applied).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('applies nothing when a fresh connection re-migrates the same file', () => {
    const first = openDatabase({ filename: file });
    first.migrate();
    first.close();

    const second = openDatabase({ filename: file });
    try {
      expect(second.migrate().applied).toEqual([]);
    } finally {
      second.close();
    }
  });

  it('applies nothing to a database the PYTHON runner migrated', () => {
    // THE DRIFT TEST, mirror direction. infrastructure/migrations is one source of truth
    // only if either runner can finish what the other started; if the two disagreed about
    // statement splitting, checksums or the schema_migrations shape, this fails.
    // packages/db/python/tests/test_migrations.py covers TypeScript -> Python.
    const repoRoot = join(findMigrationsDir(), '..', '..');
    const result = spawnSync(
      'uv',
      [
        'run',
        'python',
        '-c',
        'import sys, json; from papertree_db import open_database\n' +
          'db = open_database(sys.argv[1])\n' +
          'print(json.dumps(list(db.migrate().applied)))\n' +
          'db.close()',
        file,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      // THIS USED TO `return`, AND THAT WAS A SILENT PASS. An adversarial review ran the
      // suite with uv off PATH — which is exactly the state of CI's `typescript` job, since
      // it installs only pnpm and Node — and got "9 passed" with the cross-language drift
      // assertion having checked nothing. A skip that reports as a pass is worse than no
      // test: it is coverage that is not there.
      //
      // So absence of uv is now FATAL unless a developer opts out explicitly. CI installs
      // uv in the typescript job (.github/workflows/ci.yml) so the check really runs there.
      const detail = `${result.error?.message ?? ''} ${result.stderr ?? ''}`.slice(-400);
      if (process.env['PT_SKIP_CROSS_LANGUAGE_DRIFT'] === '1') {
        console.warn(`[db/migrations.spec] drift check skipped by request: ${detail}`);
        return;
      }
      throw new Error(
        `db/migrations.spec cannot run the Python->TS drift check because \`uv\` failed. ` +
          `uv is part of the documented toolchain and this assertion is the only thing ` +
          `proving the two runners agree on one schema. Install uv, or set ` +
          `PT_SKIP_CROSS_LANGUAGE_DRIFT=1 to acknowledge that you are running without it. ` +
          `Underlying failure: ${detail}`,
      );
    }
    expect(JSON.parse(result.stdout.trim().split('\n').at(-1) as string)).toEqual(
      loadMigrations().map((m) => m.version),
    );

    const db = openDatabase({ filename: file });
    try {
      expect(db.migrate().applied).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('refuses to run when an applied migration has been edited', () => {
    const db = openDatabase({ filename: file });
    db.migrate();
    db.close();

    // Simulate an edit by rewriting the recorded checksum: forward-only means the file is
    // immutable once shipped, and the runner must notice rather than silently skip.
    const raw = new Database(file);
    raw.prepare("UPDATE schema_migrations SET checksum = 'sha256:tampered'").run();
    raw.close();

    const again = openDatabase({ filename: file });
    try {
      expect(() => again.migrate()).toThrow(/forward-only/);
    } finally {
      again.close();
    }
  });
});

/**
 * EPIC-00's acceptance criterion, and the SHAPE of the regression guard that sits beside it.
 *
 * #80 — WHY THERE IS NO LONGER A WALL-CLOCK CONSTANT ON CI. Both tests below used to assert
 * elapsed milliseconds against a constant on a GitHub-hosted runner. That failed on #79 — a
 * DOCS-ONLY PR touching no code file — with `expected 6207.094795999999 to be less than 5000`,
 * and then passed on re-run at the same commit. A constant tuned to fire on a 1.24x overshoot
 * cannot survive hardware whose own spread is wider than that, and the previous comment had
 * already recorded the spread that proves it: 3171-3965 ms for one insert on a loaded box.
 *
 * That left the test in the worst available position — tight enough to fire on noise, loose
 * enough that a real 2x regression passed. Raising the bound again was the one option ruled
 * out: it is how `perf.spec` came to assert `peak_mb < 2000` against a 500 MB bar and pass
 * for months measuring nothing (AGENTS.md §2). So the constant is gone rather than larger.
 *
 * WHAT REPLACES IT IS A RATIO. Each test times a SMALL insert first, in the same process,
 * through the same code path, then the 30k insert. If `putPaper` is linear in block count
 * the second should take `SCALE` times the first, and `elapsed / (baseline * SCALE)` should
 * sit near 1.0 on any machine at any speed — a slow runner slows both halves equally and
 * cancels. Measured over 14 runs of this exact spec on two machine classes: an M-series Mac
 * (5 idle, 5 at 3.5x CPU overload — 20 busy loops on 10 cores) and 4 runs on GitHub-hosted
 * `ubuntu-latest`, the hardware that actually flaked.
 *
 *                        Mac idle      Mac loaded     GitHub runner
 *     minimal payload    0.967-1.070   0.972-1.035    0.719-0.970
 *     realistic payload  0.938-1.142   0.926-1.047    0.809-1.090
 *
 * FULL OBSERVED RANGE 0.719-1.142 against a bound of 2.0. The property that matters is in the
 * middle column: 3.5x CPU overload moved the underlying measurement 2.2x (30k minimal, 660 ms
 * idle -> 1438 ms loaded) and moved the RATIO by 0.06. That swing is what the 6207 ms on #79
 * was, and it no longer reaches the assertion.
 *
 * DO NOT SUBSTITUTE LOCAL NUMBERS FOR THESE. An earlier revision was measured only on the Mac
 * and would have shipped a spread of 0.861-1.253; the runner then produced 0.290 on the first
 * real CI run. Both numbers were honest and only one described the machine the guard protects.
 *
 * WHAT THE RATIO GIVES UP, STATED PLAINLY BECAUSE A GUARD'S BLIND SPOT IS NOT A DETAIL.
 * It catches SUPERLINEAR regressions. It does NOT catch a per-row CONSTANT factor, because
 * a constant factor inflates the calibration and the measurement equally and cancels exactly
 * the way machine speed does. Measured against this spec, not assumed: deleting `putPaper`'s
 * `this.#db.transaction(...)` wrapper so every row auto-commits costs 4.6x (660 -> 3052 ms)
 * and moves the ratio to 1.192 — dead centre of the healthy range, i.e. invisible. The thing
 * that went red on it was `LOCAL_BOUND_MS` (`expected 3051.690625 to be less than 2000`).
 *
 * So "an unbatched insert or a lost transaction", which the old comment named as the thing
 * being guarded, is caught here only OFF CI. That is a real reduction in CI coverage, it was
 * measured rather than discovered later, and #82 carries it — including the machine-normalised
 * probe that was tried here first and rejected with numbers. Do not re-add that probe without
 * reading #82.
 *
 * `LOCAL_BOUND_MS` is EPIC-00's acceptance criterion verbatim and does not move. It is
 * asserted only where the machine's speed is ours, which is what the criterion always meant
 * — the CI-widened twin of it is deleted, because a constant that has to be re-tuned every
 * time the runner changes was never measuring this code.
 *
 * THE PYTHON TWIN IS CURRENTLY OUT OF STEP. `python/tests/test_migrations.py` still asserts
 * wall-clock constants (`BOUND_MS`, and `8000` for the realistic payload) and has the same
 * exposure this file just shed — #83. Fix them together next time; do not assume the halves
 * still match because they used to.
 */
const LOCAL_BOUND_MS = 2000;

/**
 * Blocks in the calibration insert each timing test runs before the real one.
 *
 * 10,000 RATHER THAN 3,000, AND THE REASON IS MEASURED. At 3,000 the minimal-payload
 * calibration takes ~52 ms, which is short enough that scheduler jitter dominates it: under
 * 3.5x CPU overload the calibration slipped through a quiet slice at near-idle speed (61 ms)
 * while the 30k insert absorbed the contention (1508 ms), and the ratio reached 2.461 — a
 * fresh flake in the guard written to remove one. A calibration must be long enough to
 * experience the same machine the measurement does. At 10,000 blocks it is ~200 ms and the
 * same overload produces 0.972-1.035.
 */
const BASELINE_BLOCKS = 10_000;
const TARGET_BLOCKS = 30_000;
const SCALE = TARGET_BLOCKS / BASELINE_BLOCKS;

/**
 * How far above perfectly-linear the 30k insert may land.
 *
 * 2.0 is 1.75x the slowest ratio observed in 14 runs (1.142), across both payloads, a 2.2x
 * machine-speed swing and two machine classes including the GitHub runner — see the block
 * comment above. A truly superlinear insert path lands at SCALE (3.0) or beyond, so this sits
 * between the two with room on both sides.
 *
 * WHAT IT CATCHES AND WHAT IT DOES NOT, MEASURED AGAINST THIS SPEC RATHER THAN GUESSED. A
 * scan of `blocks` every 10th insert — genuinely superlinear, O(n^2/10) — gives minimal 2.196
 * (RED) and realistic 1.984 (green, and only just). The same scan every 50th insert gives
 * 1.475 and passes on both. So weak superlinearity is below this guard's resolution, the
 * minimal payload is the more sensitive of the two, and every per-row constant factor is
 * invisible to both (see above). This bound is set where the data puts it, not where it would
 * have to be to make a stronger claim true.
 */
const MAX_SCALING_RATIO = 2.0;

/**
 * Blocks in the UNTIMED warm-up insert that precedes both timed ones.
 *
 * WITHOUT THIS THE CALIBRATION PAYS ONE-TIME COSTS THE MEASUREMENT DOES NOT, and the ratio
 * stops being a linearity measure. Observed on real GitHub runners, not reasoned about: with
 * no warm-up the realistic calibration took 1776 ms and the 30k insert that followed it took
 * 1857 ms — three times the data in the same time, ratio 0.348 (run 30737048653), reproduced
 * at 0.290 on the next run. Nothing was wrong with `putPaper`; the calibration was simply
 * paying for everything the measurement then got for free.
 *
 * IT IS V8 TIER-UP, and the size below is what identified it. A 2,000-block warm-up did not
 * fix it (0.290). Raising the warm-up to 10,000 — enough iterations of `putPaper`'s block loop
 * to reach optimised code before anything is timed — dropped that same calibration from
 * 2348 ms to 479 ms and moved the ratio to 1.062. So the warm-up must be the SAME ORDER as the
 * calibration; a token warm-up buys nothing. It costs one extra insert per test, ~0.5-1.6 s.
 *
 * A ratio that is wrong in the SAFE direction is still wrong. 0.290 means the guard needed a
 * 6.9x regression to trip instead of 2x, and the variance that produced it can equally produce
 * a fast calibration and a slow measurement, which goes red on nothing at all.
 */
const WARMUP_BLOCKS = 10_000;

/** Inserts `blockCount` blocks and returns the elapsed milliseconds. */
function timedPut(
  db: PaperTreeDb,
  owner: OwnerId,
  options: { paperId: string; sourceHash: string; blockCount: number; payload?: 'realistic' },
): number {
  const paper = makePaper({
    paperId: options.paperId,
    sourceHash: options.sourceHash,
    generation: 1,
    blockCount: options.blockCount,
    // Proportional to blockCount so the baseline does the same work per block as the target.
    pageCount: Math.max(1, Math.round(options.blockCount / 60)),
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
  const started = performance.now();
  db.putPaper(owner, paper);
  const elapsedMs = performance.now() - started;
  // Correctness is UNCONDITIONAL and applies to the calibration insert too: a baseline that
  // silently inserted nothing would be fast, would make every ratio pass, and would look
  // exactly like a healthy run.
  expect(db.countBlocks(owner, asPaperId(options.paperId), generation(1))).toBe(
    options.blockCount,
  );
  return elapsedMs;
}

describe('30k blocks in under 2s', () => {
  it('inserts a 30,000-block paper, and reports the measured time and the scaling ratio', () => {
    const db: PaperTreeDb = openDatabase({ filename: file });
    try {
      db.migrate();
      const { owner } = db.createUser('perf@papertree.test');

      // Untimed, and discarded. See WARMUP_BLOCKS: it exists so the calibration below is not
      // the insert that pays this database's and this code path's first-touch costs.
      timedPut(db, owner, {
        paperId: 'ppr_00000000000000000000000201',
        sourceHash: `sha256:${'1'.repeat(64)}`,
        blockCount: WARMUP_BLOCKS,
      });

      // Calibration next, through the same code path, in the same process. This is what
      // makes the assertion below independent of how fast this machine happens to be today.
      const baselineMs = timedPut(db, owner, {
        paperId: 'ppr_00000000000000000000000101',
        sourceHash: `sha256:${'e'.repeat(64)}`,
        blockCount: BASELINE_BLOCKS,
      });
      const elapsedMs = timedPut(db, owner, {
        paperId: 'ppr_00000000000000000000000001',
        sourceHash: `sha256:${'a'.repeat(64)}`,
        blockCount: TARGET_BLOCKS,
      });
      const scalingRatio = elapsedMs / (baselineMs * SCALE);

      // Printed, not merely asserted: the number is the deliverable, the ratio is the gate.
      // A guard that reports its measurement lets the next person see drift before it fails.
      console.log(
        `[db/migrations.spec] ${TARGET_BLOCKS.toLocaleString()} blocks inserted in ` +
          `${elapsedMs.toFixed(0)} ms (one transaction, prepared statements, WAL, ` +
          `synchronous=NORMAL, on-disk file); ${BASELINE_BLOCKS.toLocaleString()}-block ` +
          `calibration in the same process took ${baselineMs.toFixed(0)} ms, so linear would ` +
          `be ${(baselineMs * SCALE).toFixed(0)} ms — scaling ratio ${scalingRatio.toFixed(3)} ` +
          `(bound ${MAX_SCALING_RATIO}). EPIC-00's ${LOCAL_BOUND_MS} ms acceptance criterion: ` +
          `${elapsedMs < LOCAL_BOUND_MS ? 'MET' : 'NOT MET'}${process.env.CI ? ' — not asserted under CI' : ''}`,
      );

      // THE GATE, on every machine. See the block comment above SCALE for the measured spread
      // this bound is set against, and for what it deliberately does not catch.
      expect(scalingRatio).toBeLessThan(MAX_SCALING_RATIO);

      // EPIC-00's acceptance criterion, unchanged, asserted where its premise holds. A shared
      // CI runner is not a machine whose speed we control: the same untouched `packages/db`
      // measured 483 ms on a developer Mac, 1477 ms on one hosted runner and 3561 ms on
      // another — a 7x spread with no code change between them, which is why the CI-widened
      // twin of this constant existed and why it kept needing to be re-tuned. It is deleted
      // rather than re-tuned. Off CI this is also the only assertion here that can see a
      // per-row constant-factor regression (#82).
      if (process.env.CI) {
        console.log(
          `[db/migrations.spec] EPIC-00's ${LOCAL_BOUND_MS} ms bound is NOT asserted under CI ` +
            `by design (#80) — it measured GitHub's disk queue, not this code. The scaling ` +
            `ratio above is asserted everywhere. Run the suite locally to gate on ${LOCAL_BOUND_MS} ms.`,
        );
      } else {
        expect(elapsedMs).toBeLessThan(LOCAL_BOUND_MS);
      }
    } finally {
      db.close();
    }
  }, 60_000);

  it('measures the SAME insert with a parser-shaped payload, because the fixture is lighter than one', () => {
    // WHAT THE BOUND ABOVE ACTUALLY MEASURES. Its fixture is `minimal`: a 38-character
    // text, one span, a four-point polygon — about a quarter of the bytes a real parser
    // emits for a body paragraph. An adversarial review re-ran the acceptance test with a
    // parser-shaped payload (60 words + normalised twin, 12 spans with font metadata, an
    // 8-point polygon, a 4-field provenance object) and measured, on the machine this was
    // built on:
    //
    //     minimal    TS ~0.71 s      Python ~0.97-1.07 s   (32 MB database)
    //     realistic  TS ~1.50 s      Python ~2.29 s        (135 MB database)
    //
    // CORRECTED 2026-07-30. Every earlier figure in this file was inflated ~1.85x: the
    // machine was carrying 22 orphaned `yes` processes at ~900% CPU, predating this work
    // by 1d16h. Re-measured with them killed, TypeScript clears <2s on the parser-shaped
    // payload as well; only Python does not, and only by ~0.29 s.
    //
    // Attributed on the same machine, for the realistic payload: ~0.4 s JSON.stringify,
    // ~0.9 s raw insert of 123 MB, ~0.35 s the four `blocks` indexes real queries need,
    // ~0.15 s the `json_valid()` CHECKs. No index was omitted to make the number, and
    // dropping the CHECKs buys 7%. The gap is data volume; there is no 2x to find.
    //
    // So the acceptance figure is TRUE and it is FIXTURE-DEPENDENT, and both halves are
    // now recorded rather than one being implied. The assertion here is a regression guard
    // at a measured bound, not a second acceptance criterion — do not confuse the two.
    //
    // THE SAME CAVEAT IS ALSO IN research/build/EPIC-00-spine.md's acceptance table and in
    // research/build/EPIC-00-RESULT.md. It used to live only here, 240 lines inside a spec
    // file, which is not where a Wave-1 agent sizing an ingest pipeline will look.
    const db: PaperTreeDb = openDatabase({ filename: file });
    try {
      db.migrate();
      const { owner } = db.createUser('perf-realistic@papertree.test');

      // Untimed, and discarded — see WARMUP_BLOCKS. This test is where the runner charged
      // 1776 ms for a 10k calibration and 1857 ms for the 30k insert that followed it.
      timedPut(db, owner, {
        paperId: 'ppr_00000000000000000000000242',
        sourceHash: `sha256:${'2'.repeat(64)}`,
        blockCount: WARMUP_BLOCKS,
        payload: 'realistic',
      });

      const baselineMs = timedPut(db, owner, {
        paperId: 'ppr_00000000000000000000000142',
        sourceHash: `sha256:${'f'.repeat(64)}`,
        blockCount: BASELINE_BLOCKS,
        payload: 'realistic',
      });
      const elapsedMs = timedPut(db, owner, {
        paperId: 'ppr_00000000000000000000000042',
        sourceHash: `sha256:${'4'.repeat(64)}`,
        blockCount: TARGET_BLOCKS,
        payload: 'realistic',
      });
      const scalingRatio = elapsedMs / (baselineMs * SCALE);

      console.log(
        `[db/migrations.spec] ${TARGET_BLOCKS.toLocaleString()} REALISTIC blocks (60 words, ` +
          `12 spans, 8-point polygon) inserted in ${elapsedMs.toFixed(0)} ms; ` +
          `${BASELINE_BLOCKS.toLocaleString()}-block calibration ${baselineMs.toFixed(0)} ms, ` +
          `linear would be ${(baselineMs * SCALE).toFixed(0)} ms — scaling ratio ` +
          `${scalingRatio.toFixed(3)} (bound ${MAX_SCALING_RATIO}). TypeScript clears <2s on ` +
          `this payload on an idle developer machine; Python does not (~2.29 s). Parser-shaped, measured.`,
      );

      // THIS TEST HAS NO WALL-CLOCK CONSTANT, on CI or off it. The 5000 ms that used to be
      // here is what #80 is about: it fired on #79, a docs-only PR touching no code file, at
      // 6207 ms — 1.24x the bound and well inside the 3171-3965 ms spread the comment beside
      // it already recorded — and then passed on re-run at the same commit.
      //
      // Unlike the sibling above, this assertion was never an acceptance criterion. Its own
      // comment called it "a regression guard at a measured bound, not a second acceptance
      // criterion", so there is nothing chartered to preserve at a constant here: the ratio
      // IS the regression guard, and it is the same guard on every machine.
      expect(scalingRatio).toBeLessThan(MAX_SCALING_RATIO);
    } finally {
      db.close();
    }
  }, 120_000);
});

describe('generations (DESIGN.md D13)', () => {
  it('stores two generations of one PDF whose block ids are identical', () => {
    const db = openDatabase({ filename: file });
    try {
      db.migrate();
      const { owner } = db.createUser('gen@papertree.test');
      const paperId = 'ppr_00000000000000000000000002';
      const sourceHash = `sha256:${'b'.repeat(64)}`;

      db.putPaper(owner, makePaper({ paperId, sourceHash, generation: 1, blockCount: 20 }));
      db.putPaper(owner, makePaper({ paperId, sourceHash, generation: 2, blockCount: 20 }));

      expect(db.listGenerations(owner, asPaperId(paperId))).toEqual([1, 2]);

      const g1 = db.listBlocksInDocOrder(owner, asPaperId(paperId), generation(1));
      const g2 = db.listBlocksInDocOrder(owner, asPaperId(paperId), generation(2));
      expect(g1).toHaveLength(20);
      expect(g2).toHaveLength(20);
      // The whole point: the ids are the SAME across generations. `blocks(block_id PK)`
      // would have thrown here, and `papers(source_hash UNIQUE)` would have thrown above.
      expect(g1.map((b) => b.block_id)).toEqual(g2.map((b) => b.block_id));

      db.promoteGeneration(owner, asPaperId(paperId), generation(2));
      expect(db.promotedGeneration(owner, asPaperId(paperId))).toBe(2);
      // Promotion is reversible for one cycle — that is the rollback plan.
      db.promoteGeneration(owner, asPaperId(paperId), generation(1));
      expect(db.promotedGeneration(owner, asPaperId(paperId))).toBe(1);
    } finally {
      db.close();
    }
  });

  it('cannot promote a generation that does not exist', () => {
    const db = openDatabase({ filename: file });
    try {
      db.migrate();
      const { owner } = db.createUser('gen2@papertree.test');
      const paperId = 'ppr_00000000000000000000000003';
      db.putPaper(
        owner,
        makePaper({
          paperId,
          sourceHash: `sha256:${'c'.repeat(64)}`,
          generation: 1,
          blockCount: 3,
        }),
      );
      expect(() => db.promoteGeneration(owner, asPaperId(paperId), generation(9))).toThrow(
        /FOREIGN KEY/,
      );
    } finally {
      db.close();
    }
  });
});
