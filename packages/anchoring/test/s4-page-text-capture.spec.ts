/**
 * s4-page-text-capture — the pdf.js capture path, on synthetic items (no corpus needed).
 *
 * `apps/web/test/s4-table-cell-capture.spec.ts` runs the same functions against real pdf.js output
 * for a real PDF; this file pins their arithmetic where every number can be checked by hand.
 */
import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import { normalisePageFrame } from '@papertree/document-ir';
import { describe, expect, it } from 'vitest';

import { pdfItemRangeToIrQuad } from '../src/bridge.js';
import { capturePageTextAnchor, pageTextOf, pageTextStreamId } from '../src/capture.js';
import { indexDocument, type PaperSource } from '../src/document.js';
import type { ShapeSelector, TextQuoteSelector } from '../src/types.js';

// A US-letter page, no rotation: raw PDF y = 792 - IR y.
const frame = normalisePageFrame({
  mediaBox: [0, 0, 612, 792],
  cropBox: [0, 0, 612, 792],
  rotate: 0,
  userUnit: 1,
});

// "66.4" set at baseline y=700 (IR 92), x=300, 10 pt, 20 pt of advance.
const cell = { str: '66.4', transform: [10, 0, 0, 10, 300, 700], width: 20, height: 10 };
const label = { str: 'person', transform: [8, 0, 0, 8, 120, 400], width: 24, height: 8 };

const SHA = `sha256:${'a'.repeat(64)}`;
const paper: PaperSource = {
  paper_id: 'ppr_S4REPARSE00000000000000000',
  source_hash: SHA,
  parser: { name: 'test', version: '1.0.0' },
  pages: [
    { index: 0, width: 612, height: 792, rotation: 0, user_unit: 1, crop_box: [0, 0, 612, 792] },
  ],
  blocks: [
    { block_id: 'blk_table', type: 'table', page_index: 0, bbox: [250, 60, 400, 120] },
    {
      block_id: 'blk_cell',
      type: 'table_cell',
      page_index: 0,
      bbox: [295, 85, 330, 100],
      parent_id: 'blk_table',
    },
    { block_id: 'blk_fig', type: 'figure', page_index: 0, bbox: [100, 350, 300, 450] },
  ],
};
const doc = indexDocument(paper, 'api/ppr_S4REPARSE00000000000000000/g1/1.0.0');

describe('pdfItemRangeToIrQuad', () => {
  it('covers descent..ascent about the baseline and the whole advance for the whole item', () => {
    // Baseline at IR y 92; ascent 0.8 * 10 above, descent 0.2 * 10 below.
    expect(pdfItemRangeToIrQuad(frame, cell, 0, 4)).toEqual([300, 84, 320, 94]);
  });

  it('narrows a sub-range by the code-point ratio inside the item', () => {
    // "6.4" of "66.4": characters [1, 4) are 3/4 of 20 pt, starting 5 pt in.
    expect(pdfItemRangeToIrQuad(frame, cell, 1, 4)).toEqual([305, 84, 320, 94]);
  });

  it('uses the font metrics when pdf.js reports them', () => {
    const quad = pdfItemRangeToIrQuad(frame, { ...cell, ascent: 0.9, descent: -0.25 }, 0, 4);
    expect(quad).toEqual([300, 83, 320, 94.5]);
  });

  it('refuses an empty range and an empty item', () => {
    expect(pdfItemRangeToIrQuad(frame, cell, 2, 2)).toBeNull();
    expect(pdfItemRangeToIrQuad(frame, { ...cell, str: '' }, 0, 1)).toBeNull();
  });
});

describe('capturePageTextAnchor', () => {
  const items = [label, { str: ' ', transform: [8, 0, 0, 8, 144, 400], width: 2, height: 8 }, cell];

  it('builds Page + TextQuote + Shape selectors, no Block or Position selector', () => {
    const anchor = capturePageTextAnchor({
      doc,
      pageIndex: 0,
      frame,
      items,
      start: { item: 2, offset: 0 },
      end: { item: 2, offset: 4 },
      textStreamId: pageTextStreamId('5.7.284'),
      id: '00000000-0000-4000-8000-000000000001',
      at: '2026-09-26T00:00:00.000Z',
      client: 'test',
    });
    expect(anchor).not.toBeNull();
    const types = anchor?.selectors.map((s) => s.type);
    expect(types).toEqual(['PageSelector', 'TextQuoteSelector', 'ShapeSelector']);
    expect(anchor?.doc.textStreamId).toBe('pdfjs@5.7.284/page-text');
    expect(anchor?.doc.pdfSha256).toBe(SHA);
    const quote = anchor?.selectors.find(
      (s) => s.type === 'TextQuoteSelector',
    ) as TextQuoteSelector;
    expect(quote.exact).toBe('66.4');
    expect(quote.prefix).toBe('person ');
    const shape = anchor?.selectors.find((s) => s.type === 'ShapeSelector') as ShapeSelector;
    expect(shape.quads).toEqual([[300, 84, 320, 94]]);
    // Inside the table-cell block by geometry.
    expect(anchor?.targetKind).toBe('table_cell');
  });

  it('classifies a label inside a figure block as figure_region', () => {
    const anchor = capturePageTextAnchor({
      doc,
      pageIndex: 0,
      frame,
      items,
      start: { item: 0, offset: 0 },
      end: { item: 0, offset: 6 },
      textStreamId: pageTextStreamId('5.7.284'),
      id: '00000000-0000-4000-8000-000000000002',
      at: '2026-09-26T00:00:00.000Z',
      client: 'test',
    });
    expect(anchor?.targetKind).toBe('figure_region');
  });

  it('writes a record anchor-v1.schema.json accepts', () => {
    const schema = JSON.parse(
      readFileSync(
        new URL('../../../contracts/anchor/anchor-v1.schema.json', import.meta.url),
        'utf8',
      ),
    ) as object;
    // The same cast `anchor-schema.spec.ts` uses: ajv's CJS default export under NodeNext.
    const AjvCtor = Ajv2020 as unknown as new (opts: Record<string, unknown>) => {
      compile(schema: object): ((data: unknown) => boolean) & { errors?: unknown };
    };
    const validate = new AjvCtor({ strict: true, allErrors: true }).compile(schema);
    const anchor = capturePageTextAnchor({
      doc,
      pageIndex: 0,
      frame,
      items,
      start: { item: 0, offset: 2 },
      end: { item: 2, offset: 2 },
      textStreamId: pageTextStreamId('5.7.284'),
      id: '00000000-0000-4000-8000-000000000003',
      at: '2026-09-26T00:00:00.000Z',
      client: 'test',
    });
    expect(validate(anchor), JSON.stringify(validate.errors)).toBe(true);
  });

  it('keeps separate quads across a gap wider than a word space', () => {
    const anchor = capturePageTextAnchor({
      doc,
      pageIndex: 0,
      frame,
      // Two cells on one line, 60 pt apart: a table row, not a phrase.
      items: [cell, { ...cell, str: '71.2', transform: [10, 0, 0, 10, 380, 700] }],
      start: { item: 0, offset: 0 },
      end: { item: 1, offset: 4 },
      textStreamId: pageTextStreamId('5.7.284'),
      id: '00000000-0000-4000-8000-000000000004',
      at: '2026-09-26T00:00:00.000Z',
      client: 'test',
    });
    const shape = anchor?.selectors.find((s) => s.type === 'ShapeSelector') as ShapeSelector;
    expect(shape.quads).toHaveLength(2);
  });

  it('returns null when only whitespace is selected', () => {
    const anchor = capturePageTextAnchor({
      doc,
      pageIndex: 0,
      frame,
      items,
      start: { item: 1, offset: 0 },
      end: { item: 1, offset: 1 },
      textStreamId: pageTextStreamId('5.7.284'),
      id: '00000000-0000-4000-8000-000000000005',
      at: '2026-09-26T00:00:00.000Z',
      client: 'test',
    });
    expect(anchor).toBeNull();
  });

  it('page text joins items and breaks lines at hasEOL', () => {
    expect(pageTextOf([{ ...label, hasEOL: true }, cell])).toEqual({
      text: 'person\n66.4',
      itemStarts: [0, 7],
    });
  });
});
