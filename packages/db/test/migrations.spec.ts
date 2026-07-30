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

describe('30k blocks in under 2s', () => {
  it('inserts a 30,000-block paper within the bound, and reports the measured time', () => {
    const db: PaperTreeDb = openDatabase({ filename: file });
    try {
      db.migrate();
      const { owner } = db.createUser('perf@papertree.test');
      const paper = makePaper({
        paperId: 'ppr_00000000000000000000000001',
        sourceHash: `sha256:${'a'.repeat(64)}`,
        generation: 1,
        blockCount: 30_000,
      });

      const started = performance.now();
      db.putPaper(owner, paper);
      const elapsedMs = performance.now() - started;

      // Printed, not merely asserted: the number is the deliverable, the bound is the gate.
      console.log(
        `[db/migrations.spec] 30,000 blocks + ${paper.pages.length} pages + ` +
          `${paper.relations.length} relations inserted in ${elapsedMs.toFixed(0)} ms ` +
          `(one transaction, prepared statements, WAL, synchronous=NORMAL, on-disk file)`,
      );

      expect(db.countBlocks(owner, asPaperId(paper.paper_id), generation(1))).toBe(30_000);
      // THE ACCEPTANCE CRITERION. This bound cannot move; it is EPIC-00's, not this file's.
      // The margin is thin by construction — TS ~1.0-1.6 s, Python ~1.7-2.5 s against 2000 —
      // so a failure HERE is more likely a loaded runner than a regression. First response:
      // re-run and compare the PRINTED number above with the table in the next test, not
      // assume the criterion broke. (Measured on a box with load average 72 caused by 23
      // runaway processes: TS 1560 ms, Python 2505 ms. Same code at HEAD measured the same,
      // so the shortfall was the machine.)
      expect(elapsedMs).toBeLessThan(2000);
    } finally {
      db.close();
    }
  }, 30_000);

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
      const paper = makePaper({
        paperId: 'ppr_00000000000000000000000042',
        sourceHash: `sha256:${'4'.repeat(64)}`,
        generation: 1,
        blockCount: 30_000,
        pageCount: 500,
        payload: 'realistic',
      });

      const started = performance.now();
      db.putPaper(owner, paper);
      const elapsedMs = performance.now() - started;

      console.log(
        `[db/migrations.spec] 30,000 REALISTIC blocks (60 words, 12 spans, 8-point polygon) ` +
          `inserted in ${elapsedMs.toFixed(0)} ms — TypeScript clears <2s on this payload ` +
          `too; Python does not (~2.29 s). Parser-shaped, measured.`,
      );

      expect(db.countBlocks(owner, asPaperId(paper.paper_id), generation(1))).toBe(30_000);
      // 8000 was 3.5x the then-measured 2284 ms (since corrected to ~1382 ms, so ~5.8x) — the insert path could regress THREEFOLD and stay
      // green, which is a smoke test that the code still terminates, not "a regression guard at
      // a measured bound" as the comment above claimed. 5000 is ~2.2x, which is deliberate slack
      // for slower CI hardware rather than an engineering target: this same insert measured
      // 3171-3965 ms on a box under load average 72-103, so the slack is doing real work.
      expect(elapsedMs).toBeLessThan(5000);
    } finally {
      db.close();
    }
  }, 60_000);
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
