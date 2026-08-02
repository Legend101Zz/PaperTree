/**
 * Generate `test/fixtures/citation-nav.paperir.json` — the citation test data F0.7 does not have.
 *
 * THE GAP. `references[]` is EMPTY in all three golden fixtures. There is no `reference_entry`
 * block and no `cites` relation anywhere in the set, because every bibliography lies outside every
 * fixture's page range; inline citations are ordinary characters inside a paragraph's `text`. But
 * `anchoring/targets.spec` names `citation` as one of the ten target kinds that must resolve, so
 * there is nothing to test it against. The epic brief anticipates this and says to add a fixture
 * rather than block.
 *
 * WHY THIS FILE IS HERE AND NOT IN `packages/document-ir/fixtures/`.
 *
 * The brief sanctions adding DATA to the golden fixtures. Doing so would nevertheless break two
 * things that belong to Epic 0:
 *
 *   • `.github/scripts/validate-fixtures.mjs` asserts "expected exactly N *.json fixtures in
 *     packages/document-ir/fixtures/" and fails CI on a fourth file;
 *   • `test/schema.spec.ts`'s "all three fixtures are present" asserts the same count.
 *
 * Editing one of the three in place avoids the count problem but costs more: `fixtures/README.md`
 * attests that all 10 pages were hand-verified against rendered PDF pages by two passes, and
 * `confidence.overall` is the MEAN over all blocks, so adding blocks silently changes a documented
 * number and invalidates an attestation this epic is not in a position to re-earn.
 *
 * Deriving into this package costs nothing and tests the same thing. Recorded in EPIC-02-RESULT.md
 * as a deviation with its reason.
 *
 * WHAT IS ADDED, and it is deliberately modest — this is scaffolding for a resolver test, not a
 * claim about how Epic 1 should segment citations:
 *
 *   • a `citation` block over the "[22, 21]" callout that really is printed on resnet page 0, with
 *     the real glyphs' geometry taken from the containing paragraph's first span;
 *   • a `reference_entry` block for the work it points at, on the same page (the real one is on a
 *     page outside the range, so its position is synthetic and is marked as such);
 *   • a `cites` relation between them, and a `references[]` entry.
 *
 * Every `block_id` and `content_hash` is minted with the REAL formula from `@papertree/document-ir`,
 * so the file is identity-consistent with the golden set rather than merely plausible.
 *
 * Run: pnpm --filter @papertree/anchoring exec tsx test/make-citation-fixture.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalJson, normaliseText } from '@papertree/document-ir';
// `blockId`/`contentHash` hash, so they are behind the Node-only `/identity` subpath (#33). This
// is a Node script that mints a fixture, so reaching for it is exactly what that subpath is for.
import { blockId, contentHash } from '@papertree/document-ir/identity';

const FIXTURE_DIR = fileURLToPath(new URL('../../document-ir/fixtures/', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

interface AnyRecord {
  [key: string]: unknown;
}

const paper = JSON.parse(
  readFileSync(`${FIXTURE_DIR}resnet-cvpr-2col.paperir.json`, 'utf8'),
) as AnyRecord & {
  source_hash: string;
  pages: (AnyRecord & { index: number; block_ids: string[]; flows: Record<string, string[]> })[];
  blocks: (AnyRecord & {
    block_id: string;
    type: string;
    page_index: number;
    bbox?: number[];
    text?: string;
    spans?: { start: number; end: number; bbox: number[] }[];
  })[];
  relations: AnyRecord[];
  references: unknown[];
};

const bareHash = paper.source_hash.replace(/^sha256:/, '');

function mint(
  type: string,
  pageIndex: number,
  bbox: [number, number, number, number],
  text: string,
): AnyRecord {
  const id = blockId({
    source_hash: bareHash,
    page_index: pageIndex,
    x0: bbox[0],
    y0: bbox[1],
    block_type: type,
    text,
  });
  return {
    block_id: id,
    type,
    page_index: pageIndex,
    polygon: [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[1]],
      [bbox[2], bbox[3]],
      [bbox[0], bbox[3]],
    ],
    bbox,
    flow: 'body',
    text,
    text_normalised: normaliseText(text),
    content_hash: contentHash(text),
    spans: [{ start: 0, end: text.length, bbox, font: 'NimbusRomNo9L-Regu', size: 9.96 }],
    source: 'pdf_text_layer',
    confidence: 0.98,
    provenance: { parser: 'papertree-epic2-citation-scaffold', stage: 'layout+text' },
  };
}

// The paragraph whose first printed line really is
// "Deep convolutional neural networks [22, 21] have led" — resnet page 0, x0 62.07, y0 556.2.
const host = paper.blocks.find(
  (b) => b.type === 'paragraph' && (b.text ?? '').startsWith('Deep convolutional neural networks'),
);
if (host === undefined) throw new Error('host paragraph not found — fixture changed');
const hostSpan = host.spans?.[0];
if (hostSpan === undefined) throw new Error('host paragraph has no spans');

// "[22, 21]" sits at code-point offset 35..43 of that line. The callout's x range is interpolated
// across the span's width by character position: the IR carries no per-glyph geometry, and an
// interpolated box is wrong by less than a character width, which is well inside a highlight's
// visual tolerance. Stated here rather than presented as measured.
const lineText = host.text!.slice(hostSpan.start, hostSpan.end);
const at = lineText.indexOf('[22, 21]');
if (at < 0) throw new Error('callout not found in host line');
const [sx0, sy0, sx1, sy1] = hostSpan.bbox as [number, number, number, number];
const perChar = (sx1 - sx0) / lineText.length;
const citationBbox: [number, number, number, number] = [
  +(sx0 + perChar * at).toFixed(2),
  sy0,
  +(sx0 + perChar * (at + '[22, 21]'.length)).toFixed(2),
  sy1,
];

const citation = mint('citation', 0, citationBbox, '[22, 21]');
citation.parent_id = host.block_id;

// The real bibliography is on page 11, outside the 0-2 range this fixture covers. Its geometry is
// therefore SYNTHETIC — placed in the footnote band of page 2 — and that is recorded on the block
// rather than hidden, because a later reader must not mistake it for a hand-checked region.
const referenceEntry = mint(
  'reference_entry',
  2,
  [50.11, 700.0, 286.37, 720.0],
  '[22] A. Krizhevsky, I. Sutskever, and G. E. Hinton. ImageNet classification with deep convolutional neural networks. In NIPS, 2012.',
);
referenceEntry.confidence = 0.3;
referenceEntry.provenance = {
  parser: 'papertree-epic2-citation-scaffold',
  stage: 'synthetic-geometry',
};

const out = {
  ...paper,
  paper_id: paper.paper_id,
  status: 'partial',
  partial_reason:
    'Epic 2 citation scaffold, derived from resnet-cvpr-2col. Adds one citation block, one ' +
    'reference_entry with SYNTHETIC geometry, one cites relation and one references[] entry, ' +
    'because F0.7 covers none of them. Not hand-verified against the rendered page.',
  blocks: [...paper.blocks, citation, referenceEntry],
  relations: [
    ...paper.relations,
    {
      type: 'cites',
      from_block_id: citation.block_id,
      to_block_id: referenceEntry.block_id,
      confidence: 0.98,
      provenance: 'epic2-citation-scaffold',
    },
    {
      type: 'parent_of',
      from_block_id: host.block_id,
      to_block_id: citation.block_id,
      confidence: 1,
      provenance: 'epic2-citation-scaffold',
    },
  ],
  references: [
    {
      reference_id: 'ref_epic2_krizhevsky_2012',
      raw: '[22] A. Krizhevsky, I. Sutskever, and G. E. Hinton. ImageNet classification with deep convolutional neural networks. In NIPS, 2012.',
      block_id: referenceEntry.block_id,
    },
  ],
  pages: paper.pages.map((page) => {
    if (page.index === 0) {
      return {
        ...page,
        block_ids: [...page.block_ids, citation.block_id as string],
        flows: { ...page.flows },
      };
    }
    if (page.index === 2) {
      return {
        ...page,
        block_ids: [...page.block_ids, referenceEntry.block_id as string],
        flows: { ...page.flows, body: [...(page.flows.body ?? []), referenceEntry.block_id as string] },
      };
    }
    return page;
  }),
};

mkdirSync(OUT_DIR, { recursive: true });
// `canonicalJson` types its parameter as `JsonValue`; `out` is assembled from `unknown`-valued
// records, so the cast is at the boundary where the value provably IS JSON (it came from
// `JSON.parse` plus literals). Writing through `canonicalJson` rather than `JSON.stringify` is the
// point: the fixture is byte-stable across regenerations, so re-running this produces no diff.
writeFileSync(
  `${OUT_DIR}citation-nav.paperir.json`,
  `${canonicalJson(out as Parameters<typeof canonicalJson>[0])}\n`,
  'utf8',
);

// eslint-disable-next-line no-console
console.log(
  `wrote citation-nav.paperir.json\n` +
    `  citation      ${String(citation.block_id)}  bbox ${JSON.stringify(citationBbox)}\n` +
    `  reference     ${String(referenceEntry.block_id)}  (synthetic geometry)\n` +
    `  blocks ${String(paper.blocks.length)} -> ${String((out.blocks as unknown[]).length)}`,
);
