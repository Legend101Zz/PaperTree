/**
 * A REAL parse of a corpus PDF, by the real worker, for the specs that must not trust a fixture.
 *
 * AGENTS.md §4: "Any test for a producer-side field must run against a real parse of a corpus
 * paper, not only against a fixture you authored." The committed fixtures in
 * `packages/document-ir/fixtures/` are a 0.1.0 scaffold parse of 10 pages; what the reader meets
 * in production is `papertree-document-worker`'s parse of the whole PDF. So the S4 real-parse specs
 * (`s4-reanchor-cross-parser`, `s4-overpaint`, `s4-stored-quads`, `s4-table-cell-capture`) call
 * `parse_document` through the workspace's own Python, exactly as the job does, and read the
 * PaperIR it returns.
 *
 * GATED TWICE, LOUDLY. The PDFs are fetched, not committed (`./research/benchmarks/fetch_corpus.sh`)
 * and the interpreter exists only after `uv sync --locked --all-packages`. Either absence makes
 * `liveParseAvailable()` false with a reason, and each spec `describe.skipIf`s on it after printing
 * that reason — a spec that quietly passes without its input is the vacuous green AGENTS.md §2
 * records three times.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PaperSource } from '../../src/document.js';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const CORPUS_DIR = join(REPO_ROOT, 'research', 'benchmarks', 'corpus');
const PYTHON = process.env['PAPERTREE_TEST_PYTHON'] ?? join(REPO_ROOT, '.venv', 'bin', 'python');

export function corpusPdf(slug: string): string {
  return join(CORPUS_DIR, `${slug}.pdf`);
}

/** Why a live parse cannot run here, or `null` when it can. */
export function liveParseUnavailable(slugs: readonly string[]): string | null {
  const missing = slugs.filter((slug) => !existsSync(corpusPdf(slug)));
  if (missing.length > 0) {
    return (
      `corpus PDFs absent (${missing.join(', ')}): run ./research/benchmarks/fetch_corpus.sh, ` +
      'then re-run this spec'
    );
  }
  if (!existsSync(PYTHON)) {
    return `no workspace Python at ${PYTHON}: run \`uv sync --locked --all-packages\``;
  }
  return null;
}

/** Print the skip reason once per spec file, where a reader of the test log will see it. */
export function announceSkip(spec: string, reason: string | null): void {
  if (reason === null) return;
  // eslint-disable-next-line no-console
  console.warn(`\n  ${spec} SKIPPED: ${reason}.\n`);
}

const SCRIPT = `
import json, sys, tempfile
from pathlib import Path
from papertree_document_worker.pipeline import parse_document
path, paper_id = sys.argv[1], sys.argv[2]
with tempfile.TemporaryDirectory() as assets:
    result = parse_document(path, paper_id=paper_id, asset_root=Path(assets),
                            parsed_at="2026-09-26T00:00:00.000Z")
    sys.stdout.write(json.dumps(result.paper.model_dump(mode="json", by_alias=True, exclude_unset=True)))
`;

/** A schema-valid `ppr_` id (26 Crockford characters) for a parse no API owns. */
export const LIVE_PAPER_ID = 'ppr_S4REPARSE00000000000000000';

const memo = new Map<string, PaperSource>();

/**
 * `parse_document` on `research/benchmarks/corpus/<slug>.pdf`, as the worker's job calls it.
 * Memoised per process: a spec that asks twice pays once.
 */
export function liveParse(slug: string, paperId: string = LIVE_PAPER_ID): PaperSource {
  const key = `${slug}|${paperId}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const scratch = mkdtempSync(join(tmpdir(), 'papertree-s4-live-'));
  try {
    const result = spawnSync(PYTHON, ['-c', SCRIPT, corpusPdf(slug), paperId], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', TMPDIR: scratch },
    });
    if (result.status !== 0) {
      throw new Error(
        `parse_document(${slug}) failed (${String(result.status)}): ${result.stderr}`,
      );
    }
    const paper = JSON.parse(result.stdout) as PaperSource;
    memo.set(key, paper);
    return paper;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
