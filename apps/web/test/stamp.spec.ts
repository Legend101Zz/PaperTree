/**
 * reader/stamp.spec — the text layer actually carries the IR, and the offsets it carries are right.
 *
 * WHAT WENT WRONG WITHOUT THIS FILE. `useSelectionCapture` documents a contract in its header —
 * every text-layer item carries `data-block-id` and `data-cp-start`, and `PdfPage` writes them —
 * and `PdfPage` did not write them. Measured in Chrome before the fix: 415 rendered spans, 0 with
 * either attribute. Nothing failed. The hook's unit tests construct their own stamped DOM, so they
 * passed against a contract the app never honoured, and the reader silently ran on `locateByText`,
 * the fallback the hook's own header calls "a LIMITATION, not a design" (issue #58).
 *
 * So this file asserts the thing no unit test can: that the mapping is correct against the REAL
 * pdf.js output for the REAL PDFs, not against a fixture of what we hoped pdf.js would emit.
 *
 * THE ASSERTION THAT MATTERS is not "attributes are present" — that would be satisfied by stamping
 * every div with the same block and offset 0. It is:
 *
 *     block.text, sliced at [cpStart, cpStart + len), IS the text the div renders.
 *
 * Checked for every stamped div on every page of all three fixtures. An off-by-one in the
 * collapsed→raw index map, a cursor that fails to advance, a UTF-16/code-point confusion — each of
 * them breaks that equality on the first line it affects.
 *
 * REQUIRES THE CORPUS, AND SAYS SO WHEN IT IS ABSENT. The three PDFs are fetched, not committed
 * (`./research/benchmarks/fetch_corpus.sh`; AGENTS.md §4), so on a clean CI checkout
 * `public/fixtures/` has the IR and no PDFs. This file then SKIPS, loudly, naming the script — it
 * does not quietly pass, which would be the "green test that asserts nothing" failure this repo has
 * already had three times.
 *
 * What that costs is worth stating exactly: in CI the real-pdf.js COVERAGE NUMBERS are unverified.
 * The wire itself is not — `test/capture-wire.spec.tsx` fakes pdf.js, needs only the committed IR,
 * and runs everywhere. So CI proves a selection still becomes an anchor; this file proves the
 * mapping is accurate against real files, and it runs wherever the corpus does.
 *
 * NODE, NOT happy-dom. pdf.js's page rendering needs `requestAnimationFrame`, and its text LAYOUT
 * needs a canvas to measure fonts — neither exists here. Neither is required: `getTextContent()` is
 * pure parsing, and `stampTextLayer` takes divs as plain objects with `setAttribute`. What is
 * exercised is the arithmetic, which is the part that can be wrong in a way a human would not spot.
 *
 * @vitest-environment node
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { indexDocument, type PaperSource } from '@papertree/anchoring';
import { beforeAll, describe, expect, it } from 'vitest';

import { stampTextLayer, alignedItems, type TextItemLike } from '@/components/reader/stampTextLayer';

/**
 * The `legacy` build, because the default one is an ES module targeting browsers and reaches for
 * `DOMMatrix` at import time. `legacy` is the build pdf.js ships for exactly this.
 */
const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

interface PdfjsLike {
  getDocument(args: { data: Uint8Array }): { promise: Promise<PdfDocLike> };
}
interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}
interface PdfPageLike {
  view: number[];
  rotate: number;
  getViewport(args: { scale: number }): { convertToPdfPoint(x: number, y: number): number[] };
  getTextContent(): Promise<{ items: { str?: string }[] }>;
}

let pdfjs: PdfjsLike;

beforeAll(async () => {
  pdfjs = (await import(
    require.resolve('pdfjs-dist/legacy/build/pdf.mjs', { paths: [repoRoot] })
  )) as unknown as PdfjsLike;
});

/**
 * A div that records what was stamped on it. Not a DOM node: this spec runs in Node, and the only
 * surface `stampTextLayer` uses is `setAttribute`/`removeAttribute`.
 */
function fakeDiv(): HTMLElement {
  const attrs = new Map<string, string>();
  return {
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
    getAttribute(name: string) {
      return attrs.get(name) ?? null;
    },
    hasAttribute(name: string) {
      return attrs.has(name);
    },
  } as unknown as HTMLElement;
}

function collapse(value: string): string {
  return value.replace(/\s+/gu, ' ');
}

const FIXTURES = [
  'attention-is-all-you-need',
  'resnet-cvpr-2col',
  'neural-odes-mathheavy',
] as const;

/** The staged PDFs, absent on a clean checkout until `fetch_corpus.sh` + `prepare:assets` run. */
const CORPUS_PRESENT = FIXTURES.every((slug) =>
  existsSync(`${repoRoot}public/fixtures/${slug}.pdf`),
);

if (!CORPUS_PRESENT) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n  reader/stamp.spec SKIPPED: apps/web/public/fixtures/*.pdf are absent.\n' +
      '  These PDFs are fetched, not committed. To run this file:\n' +
      '      ./research/benchmarks/fetch_corpus.sh\n' +
      '      pnpm --filter papertree-web prepare:assets\n' +
      '  The capture wire itself is covered without them, by test/capture-wire.spec.tsx.\n',
  );
}

/**
 * Coverage floors, set BELOW the measured values so this file fails on a regression rather than on
 * a pdf.js patch release that shifts one item. The measured numbers are in `stampTextLayer`'s
 * header; the gap between them and these floors is the tolerance, and it is deliberate.
 *
 * They are per-fixture because the shortfall is a property of the PAPER: resnet and neural-odes are
 * two-column and equation-dense, and a display equation's glyphs are emitted by pdf.js while the
 * IR holds a reconstructed Unicode string that does not contain them.
 */
const FLOORS: Record<(typeof FIXTURES)[number], { matched: number; offset: number }> = {
  'attention-is-all-you-need': { matched: 0.95, offset: 0.95 },
  'resnet-cvpr-2col': { matched: 0.85, offset: 0.8 },
  'neural-odes-mathheavy': { matched: 0.85, offset: 0.8 },
};

interface PageRun {
  readonly slug: string;
  readonly pageIndex: number;
  readonly divs: HTMLElement[];
  readonly items: TextItemLike[];
  readonly blocksById: Map<string, { text: string }>;
  readonly stamped: { items: number; textual: number; matched: number; offset: number };
}

async function runFixture(slug: string): Promise<PageRun[]> {
  const paper = JSON.parse(
    readFileSync(`${repoRoot}../../packages/document-ir/fixtures/${slug}.paperir.json`, 'utf8'),
  ) as PaperSource;
  const bytes = new Uint8Array(readFileSync(`${repoRoot}public/fixtures/${slug}.pdf`));
  const doc = indexDocument(paper, 'stamp.spec');
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;

  const runs: PageRun[] = [];
  for (const irPage of doc.pages) {
    if (irPage.index >= pdf.numPages) continue;
    const page = await pdf.getPage(irPage.index + 1);
    const content = await page.getTextContent();
    const items = alignedItems(content.items);
    const divs = items.map(() => fakeDiv());
    const blocks = doc.byPage.get(irPage.index) ?? [];

    const stamped = stampTextLayer({
      divs,
      items,
      page: { view: page.view as [number, number, number, number], rotate: page.rotate, userUnit: irPage.user_unit },
      blocks,
    });

    runs.push({
      slug,
      pageIndex: irPage.index,
      divs,
      items,
      blocksById: new Map(blocks.map((b) => [b.id, { text: b.text }])),
      stamped,
    });
  }
  return runs;
}

describe.skipIf(!CORPUS_PRESENT)('reader/stamp.spec — pdf.js text items carry the IR block and offset', () => {
  for (const slug of FIXTURES) {
    describe(slug, () => {
      let runs: PageRun[];

      beforeAll(async () => {
        runs = await runFixture(slug);
      }, 120_000);

      it('every stamped offset names the text the div actually renders', () => {
        // THE assertion. Everything else in this file is a coverage number; this is correctness.
        let checked = 0;
        const wrong: string[] = [];

        for (const run of runs) {
          for (let i = 0; i < run.divs.length; i += 1) {
            const div = run.divs[i] as HTMLElement;
            const blockId = div.getAttribute('data-block-id');
            const cpStart = div.getAttribute('data-cp-start');
            if (blockId === null || cpStart === null) continue;

            const block = run.blocksById.get(blockId);
            expect(block, `${run.slug} p${String(run.pageIndex)}: unknown block ${blockId}`).toBeDefined();
            if (block === undefined) continue;

            const needle = collapse((run.items[i] as TextItemLike).str).trim();
            const chars = Array.from(block.text);
            const at = Number(cpStart);

            // Slice by CODE POINTS from the stamped offset, collapse, and compare. The stored
            // offset indexes `block.text`, so this is the exact read a resolver performs.
            const slice = collapse(chars.slice(at, at + Array.from(needle).length + 4).join(''));
            checked += 1;
            if (!slice.startsWith(needle)) {
              wrong.push(
                `${run.slug} p${String(run.pageIndex)} ${blockId}@${cpStart}: ` +
                  `expected ${JSON.stringify(needle)}, text has ${JSON.stringify(slice.slice(0, 40))}`,
              );
            }
          }
        }

        expect(checked).toBeGreaterThan(100);
        expect(wrong.slice(0, 5)).toEqual([]);
      });

      it('coverage stays above the floor, and the floor is not zero', () => {
        const total = runs.reduce((n, r) => n + r.stamped.items, 0);
        const textual = runs.reduce((n, r) => n + r.stamped.textual, 0);
        const matched = runs.reduce((n, r) => n + r.stamped.matched, 0);
        const offset = runs.reduce((n, r) => n + r.stamped.offset, 0);
        const floor = FLOORS[slug];

        // eslint-disable-next-line no-console
        console.log(
          `\n  ${slug}: ${String(total)} items (${String(textual)} textual), ` +
            `${String(matched)} matched (${((matched / total) * 100).toFixed(1)}%), ` +
            `${String(offset)} with an offset (${((offset / textual) * 100).toFixed(1)}% of textual)`,
        );

        expect(total).toBeGreaterThan(100);
        expect(matched / total).toBeGreaterThanOrEqual(floor.matched);
        // Denominator is TEXTUAL, not total. See `StampResult.textual`.
        expect(offset / textual).toBeGreaterThanOrEqual(floor.offset);
      });

      it('a stamped item is stamped with a block that is really on its page', () => {
        // Catches the class of bug where the page loop and the block lookup drift apart — every
        // offset would still be self-consistent and every highlight would land on the wrong page.
        for (const run of runs) {
          for (const div of run.divs) {
            const blockId = div.getAttribute('data-block-id');
            if (blockId === null) continue;
            expect(
              run.blocksById.has(blockId),
              `${run.slug} p${String(run.pageIndex)}: ${blockId} is not on this page`,
            ).toBe(true);
          }
        }
      });
    });
  }

  it('re-stamping is idempotent — a zoom change rebuilds the layer and must not drift', async () => {
    const runs = await runFixture('attention-is-all-you-need');
    const first = runs.map((r) =>
      r.divs.map((d) => `${d.getAttribute('data-block-id') ?? '-'}@${d.getAttribute('data-cp-start') ?? '-'}`),
    );

    const again = await runFixture('attention-is-all-you-need');
    const second = again.map((r) =>
      r.divs.map((d) => `${d.getAttribute('data-block-id') ?? '-'}@${d.getAttribute('data-cp-start') ?? '-'}`),
    );

    expect(second).toEqual(first);
  }, 120_000);
});
