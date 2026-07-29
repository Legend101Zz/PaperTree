// Synthetic PaperIR documents for the db tests.
//
// These are NOT the golden fixtures (F0.7 owns those, in packages/document-ir/fixtures).
// They exist only to exercise storage: shape-correct, cheap to generate at 30k blocks, and
// deliberately not hand-checked against any real PDF.

import type { Block, Page, Paper, Relation } from '@papertree/document-ir';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** A `blk_`-shaped id derived from an index. Content-derived ids repeat across generations
 *  by design (D13), so the SAME index yields the SAME id in every generation — which is
 *  precisely the collision the composite key exists to absorb. */
export function blockIdFor(index: number): string {
  let n = index;
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    out = `${BASE32[n % 32] ?? 'a'}${out}`;
    n = Math.floor(n / 32);
  }
  return `blk_${out}`;
}

export function pageIdFor(index: number): string {
  return `pg_${blockIdFor(index).slice(4)}`;
}

/**
 * How heavy each block's payload is.
 *
 *   minimal   — a 38-character text, ONE span, a 4-point polygon. Cheap to generate.
 *   realistic — what a parser actually emits for a body paragraph: ~60 words of text plus
 *               its normalised twin, 12 spans carrying font/size/weight, an 8-point
 *               polygon, and a 4-field provenance object. Roughly 4x the bytes per block.
 *
 * This distinction is load-bearing, not cosmetic: `db/migrations.spec`'s "<2s for 30k
 * blocks" is met at `minimal` and NOT met at `realistic` on the machine this was built on.
 * Both numbers are measured and printed by the suite so the bound is never read as a claim
 * about parser-shaped data. See the second case in the "30k blocks" describe block.
 */
export type BlockPayload = 'minimal' | 'realistic';

export interface PaperOptions {
  readonly paperId: string;
  readonly sourceHash: string;
  readonly generation: number;
  readonly blockCount: number;
  readonly pageCount?: number;
  readonly relationCount?: number;
  /** Defaults to `minimal`, which is what every correctness test uses. */
  readonly payload?: BlockPayload;
}

const WORDS = 60;
const SPANS = 12;
const POLYGON_POINTS = 8;

function realisticText(index: number): string {
  let out = '';
  for (let w = 0; w < WORDS; w += 1) out += `${w === 0 ? '' : ' '}token${(index + w) % 9973}`;
  return out;
}

export function makePaper(options: PaperOptions): Paper {
  const pageCount = options.pageCount ?? Math.max(1, Math.ceil(options.blockCount / 60));
  const pages: Page[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    pages.push({
      page_id: pageIdFor(i),
      index: i,
      width: 612,
      height: 792,
      rotation: 0,
      user_unit: 1,
      crop_box: [0, 0, 612, 792],
      media_box: [0, 0, 612, 792],
      image: null,
      has_text_layer: true,
      is_scanned: false,
      block_ids: [],
      flows: { body: [], caption: [], footnote: [], header: [], footer: [], margin: [] },
      confidence: 0.97,
    });
  }

  const heavy = options.payload === 'realistic';
  const blocks: Block[] = [];
  for (let i = 0; i < options.blockCount; i += 1) {
    const pageIndex = i % pageCount;
    const y = 40 + ((i * 11) % 700);
    const text = heavy ? realisticText(i) : `Paragraph ${i} of the synthetic corpus.`;
    const polygon: [number, number][] = heavy
      ? Array.from({ length: POLYGON_POINTS }, (_, p) => [72 + p * 58.5, y + (p % 2) * 10.5])
      : [
          [72, y],
          [540, y],
          [540, y + 10],
          [72, y + 10],
        ];
    const spans = heavy
      ? Array.from({ length: SPANS }, (_, s) => ({
          start: s * 7,
          end: s * 7 + 6,
          bbox: [72 + s, y, 102 + s, y + 10] as [number, number, number, number],
          font: 'NimbusRomNo9L-Regu',
          size: 9.9626,
          weight: 400,
          italic: false,
        }))
      : [{ start: 0, end: 9, bbox: [72, y, 130, y + 10] as [number, number, number, number] }];
    blocks.push({
      block_id: blockIdFor(i),
      page_index: pageIndex,
      type: 'paragraph',
      flow: 'body',
      order: i,
      doc_order: i,
      polygon,
      bbox: [72, y, 540, y + 10],
      text,
      text_normalised: text.toLowerCase(),
      content_hash: `sha256:${i.toString(16).padStart(64, '0')}`,
      spans,
      source: 'pdf_text_layer',
      confidence: 0.96,
      provenance: heavy
        ? { parser: 'pymupdf', stage: 'layout+text', page_pass: 2, rule: 'block-merge-v3' }
        : { parser: 'synthetic', stage: 'layout+text' },
    } as Block);
  }

  const relations: Relation[] = [];
  const relationCount = options.relationCount ?? Math.max(0, Math.min(options.blockCount - 1, 32));
  for (let i = 0; i < relationCount; i += 1) {
    relations.push({
      type: 'continues_on_next_page',
      from: blockIdFor(i),
      to: blockIdFor(i + 1),
      confidence: 0.9,
      provenance: 'geometric+numbering',
    });
  }

  return {
    ir_version: '1.0.0',
    paper_id: options.paperId,
    source_hash: options.sourceHash,
    generation: options.generation,
    coordinate_space: 'pdf_user_space_topleft',
    parser: {
      name: 'synthetic',
      version: '0.0.0',
      config_hash: 'sha256:0000000000000000',
      parsed_at: '2026-07-30T00:00:00Z',
    },
    status: 'complete',
    partial_reason: null,
    metadata: {
      title: null,
      authors: [],
      abstract: null,
      doi: null,
      arxiv_id: null,
      venue: null,
      year: null,
    },
    pages,
    blocks,
    relations,
    sections: [],
    references: [],
    confidence: {
      overall: 0.95,
      by_page: pages.map(() => 0.95),
      weakest_pages: [],
      needs_review: false,
    },
  };
}
