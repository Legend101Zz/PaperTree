/**
 * Stage the golden fixtures — IR, rendered assets and the real PDFs — into `public/` so the reader
 * can be run and tested against them in a browser.
 *
 * "You build entirely against `packages/document-ir/fixtures/` and you never wait for the parser."
 * That is only actually true if the browser can fetch them, and a Next `public/` file is the
 * simplest way to be sure the reader is reading the same bytes the specs are.
 *
 * THREE SOURCES, and the third is the interesting one:
 *
 *   1. `packages/document-ir/fixtures/*.paperir.json`  — the IR. Epic 0's, read-only.
 *   2. `packages/document-ir/fixtures/assets/<slug>/…` — the 29 rendered PNGs, addressed by the
 *      custom `fixture://<slug>/<rest>` scheme, which `@papertree/ui`'s `resolveFixtureUri` maps to
 *      `/fixtures/<slug>/<rest>`.
 *   3. `research/benchmarks/corpus/<slug>.pdf`         — **the actual PDFs**.
 *
 * The fixtures directory contains NO PDF. The three papers it describes do exist as real files, but
 * they live in `research/benchmarks/corpus/`, which belongs to EPIC 1. This script only READS from
 * there — it never writes — but the dependency is worth stating plainly, because if Epic 1 moves
 * that directory the reader loses its documents and the failure will look like a 404 rather than a
 * moved file. `--strict` makes that a build failure instead.
 *
 * Everything written here is gitignored: it is a copy of files that already exist in the repo, and
 * a second committed copy is a second thing to keep in sync.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const fixturesSrc = join(repoRoot, 'packages', 'document-ir', 'fixtures');
const corpusSrc = join(repoRoot, 'research', 'benchmarks', 'corpus');
const publicFixtures = join(here, '..', 'public', 'fixtures');

const strict = process.argv.includes('--strict');

function warn(message) {
  if (strict) {
    console.error(`[copy-fixtures] ${message}`);
    process.exit(1);
  }
  console.warn(`[copy-fixtures] WARNING: ${message}`);
}

if (!existsSync(fixturesSrc)) {
  console.error(`[copy-fixtures] no fixtures at ${fixturesSrc}`);
  process.exit(1);
}

rmSync(publicFixtures, { recursive: true, force: true });
mkdirSync(publicFixtures, { recursive: true });

// 1. The IR documents.
const irFiles = readdirSync(fixturesSrc).filter((f) => f.endsWith('.paperir.json'));
for (const file of irFiles) {
  copyFileSync(join(fixturesSrc, file), join(publicFixtures, file));
}

// 2. The rendered assets, preserving the `<slug>/<kind>/<file>` layout the URI scheme assumes.
const assetsSrc = join(fixturesSrc, 'assets');
let assetCount = 0;
if (existsSync(assetsSrc)) {
  for (const slug of readdirSync(assetsSrc)) {
    cpSync(join(assetsSrc, slug), join(publicFixtures, slug), { recursive: true });
  }
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).reduce(
      (n, e) => n + (e.isDirectory() ? walk(join(dir, e.name)) : 1),
      0,
    );
  assetCount = walk(assetsSrc);
}

// 3. The PDFs, from Epic 1's corpus.
const slugs = irFiles.map((f) => f.replace('.paperir.json', ''));
let pdfCount = 0;
for (const slug of slugs) {
  const pdf = join(corpusSrc, `${slug}.pdf`);
  if (existsSync(pdf)) {
    copyFileSync(pdf, join(publicFixtures, `${slug}.pdf`));
    pdfCount += 1;
  } else {
    warn(
      `no PDF for "${slug}" at ${pdf}. The fixtures directory contains no PDFs; the real files ` +
        `live in research/benchmarks/corpus/, which belongs to Epic 1. The reader will render ` +
        `nothing for this paper.`,
    );
  }
}

console.log(
  `[copy-fixtures] ${String(irFiles.length)} IR documents, ${String(assetCount)} assets, ` +
    `${String(pdfCount)}/${String(slugs.length)} PDFs -> public/fixtures/`,
);
