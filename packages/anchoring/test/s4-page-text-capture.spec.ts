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
import {
  captureAnchor,
  capturePageTextAnchor,
  itemPieceQuads,
  pageTextOf,
  pageTextStreamId,
  piecesBetween,
} from '../src/capture.js';
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
    // Baseline at IR y 92; the band's floor is 0.85 * 10 above and 0.2 * 10 below.
    expect(pdfItemRangeToIrQuad(frame, cell, 0, 4)).toEqual([300, 83.5, 320, 94]);
  });

  it('narrows a sub-range by the code-point ratio inside the item', () => {
    // "6.4" of "66.4": characters [1, 4) are 3/4 of 20 pt, starting 5 pt in.
    expect(pdfItemRangeToIrQuad(frame, cell, 1, 4)).toEqual([305, 83.5, 320, 94]);
  });

  it('review F5: narrows by the TEXT LAYER’s font advance when a measure is given, not by code points', () => {
    // "mil" — a wide 'm' and two narrow letters. pdf.js scales the span so the fallback font's
    // measured width equals the item's advance, so a selection's glyphs sit at the MEASURED
    // fraction: "m" is 6 of 8 units, i.e. 15 of the 20 pt, where the code-point ratio says 6.67.
    const mil = {
      str: 'mil',
      transform: [10, 0, 0, 10, 300, 700],
      width: 20,
      height: 10,
      fontFamily: 'serif',
    };
    const widths: Record<string, number> = { m: 6, i: 1, l: 1 };
    const measure = (item: { fontFamily?: string }, text: string) =>
      item.fontFamily === 'serif'
        ? Array.from(text).reduce((sum, c) => sum + (widths[c] ?? 0), 0)
        : null;
    expect(pdfItemRangeToIrQuad(frame, mil, 0, 1, measure)).toEqual([300, 83.5, 315, 94]);
    expect(pdfItemRangeToIrQuad(frame, mil, 1, 3, measure)).toEqual([315, 83.5, 320, 94]);
    // No usable measure (no canvas, no font family): the contract's code-point ratio.
    expect(pdfItemRangeToIrQuad(frame, mil, 0, 1, () => null)?.[2]).toBeCloseTo(306.667, 3);
    const { fontFamily: _family, ...unnamed } = mil;
    expect(pdfItemRangeToIrQuad(frame, unnamed, 0, 1, measure)?.[2]).toBeCloseTo(306.667, 3);
  });

  it('review F5: itemPieceQuads and capturePageTextAnchor pass the measure through', () => {
    const mil = {
      str: 'mil',
      transform: [10, 0, 0, 10, 300, 700],
      width: 20,
      height: 10,
      fontFamily: 'serif',
    };
    const widths: Record<string, number> = { m: 6, i: 1, l: 1 };
    const measure = (_item: unknown, text: string) =>
      Array.from(text).reduce((sum, c) => sum + (widths[c] ?? 0), 0);
    expect(itemPieceQuads(frame, [mil], [{ item: 0, from: 0, to: 1 }], measure)).toEqual([
      [300, 83.5, 315, 94],
    ]);
    const anchor = capturePageTextAnchor({
      doc,
      pageIndex: 0,
      frame,
      items: [mil],
      start: { item: 0, offset: 0 },
      end: { item: 0, offset: 1 },
      textStreamId: pageTextStreamId('5.7.284'),
      id: '6f0e4f8e-0000-4000-8000-0000000000f5',
      at: '2026-09-26T00:00:00.000Z',
      client: 'test',
      measure,
    });
    const shape = anchor?.selectors.find(
      (sel): sel is ShapeSelector => sel.type === 'ShapeSelector',
    );
    expect(shape?.quads).toEqual([[300, 83.5, 315, 94]]);
  });

  it('uses the font metrics when pdf.js reports them', () => {
    const quad = pdfItemRangeToIrQuad(frame, { ...cell, ascent: 0.9, descent: -0.25 }, 0, 4);
    expect(quad).toEqual([300, 83, 320, 94.5]);
  });

  it("never paints a band shorter than the floor (YOLO's Times declares 0.678/-0.216)", () => {
    // Ascent is floored at 0.85, descent keeps the font's -0.216: baseline IR 92, height 10.
    const [x0, y0, x1, y1] = pdfItemRangeToIrQuad(
      frame,
      { ...cell, ascent: 0.678, descent: -0.216 },
      0,
      4,
    ) as number[];
    expect([x0, y0, x1, y1].map((v) => Math.round((v ?? 0) * 1000) / 1000)).toEqual([
      300, 83.5, 320, 94.16,
    ]);
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
    expect(shape.quads).toEqual([[300, 83.5, 320, 94]]);
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

describe('the IR-stamped path measures its ShapeSelector from item geometry', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../document-ir/fixtures/resnet-cvpr-2col.paperir.json', import.meta.url),
      'utf8',
    ),
  ) as PaperSource;
  const ir = indexDocument(fixture, 'api/ppr_x/g1/0.1.0');
  const block = ir.blocks.find((b) => b.type === 'paragraph' && b.textCodePoints.length > 120);

  it('stores the caller-measured quads, and keeps the IR offsets and the quote', () => {
    expect(block).toBeDefined();
    const measured: [number, number, number, number][] = [[100, 200, 180, 210]];
    const anchor = captureAnchor({
      doc: ir,
      blockId: block!.id,
      startOffset: 10,
      endOffset: 40,
      targetKind: 'text',
      id: '00000000-0000-4000-8000-000000000010',
      at: '2026-09-26T00:00:00.000Z',
      client: 'test',
      quads: measured,
    });
    const shape = anchor.selectors.find((s) => s.type === 'ShapeSelector') as ShapeSelector;
    expect(shape.quads).toEqual(measured);
    expect(shape.polygons).toHaveLength(1);
    expect(anchor.selectors.map((s) => s.type)).toContain('BlockSelector');
    expect(anchor.selectors.map((s) => s.type)).toContain('TextPositionSelector');
  });

  it('falls back to quadsForRange when no measured quad is paintable', () => {
    const withoutQuads = captureAnchor({
      doc: ir,
      blockId: block!.id,
      startOffset: 10,
      endOffset: 40,
      targetKind: 'text',
      id: '00000000-0000-4000-8000-000000000011',
      at: '2026-09-26T00:00:00.000Z',
      client: 'test',
    });
    const degenerate = captureAnchor({
      doc: ir,
      blockId: block!.id,
      startOffset: 10,
      endOffset: 40,
      targetKind: 'text',
      id: '00000000-0000-4000-8000-000000000011',
      at: '2026-09-26T00:00:00.000Z',
      client: 'test',
      quads: [[5, 5, 5, 9]],
    });
    expect(degenerate).toEqual(withoutQuads);
  });
});

describe('itemPieceQuads / piecesBetween', () => {
  // Two words on one line with a word space between them, then a cell 60 pt further along.
  const words = [
    { str: 'Residual', transform: [10, 0, 0, 10, 100, 700], width: 40, height: 10 },
    { str: ' ', transform: [10, 0, 0, 10, 140, 700], width: 3, height: 10 },
    { str: 'learning', transform: [10, 0, 0, 10, 143, 700], width: 38, height: 10 },
    { str: '66.4', transform: [10, 0, 0, 10, 241, 700], width: 20, height: 10 },
  ];

  it('cuts the endpoints inside their items and skips whitespace-only pieces', () => {
    expect(piecesBetween(words, { item: 0, offset: 3 }, { item: 2, offset: 5 })).toEqual([
      { item: 0, from: 3, to: 8 },
      { item: 1, from: 0, to: 1 },
      { item: 2, from: 0, to: 5 },
    ]);
  });

  it('joins a phrase into one quad and keeps a far cell separate', () => {
    const quads = itemPieceQuads(frame, words, [
      { item: 0, from: 0, to: 8 },
      { item: 2, from: 0, to: 8 },
      { item: 3, from: 0, to: 4 },
    ]);
    expect(quads).toEqual([
      [100, 83.5, 181, 94],
      [241, 83.5, 261, 94],
    ]);
  });
});

describe('targetKind by geometry', () => {
  it('a cell and its one-cell row with the same box: the cell (the deeper block) wins', () => {
    const tied: PaperSource = {
      ...paper,
      blocks: [
        { block_id: 'blk_row', type: 'table_row', page_index: 0, bbox: [295, 85, 330, 100] },
        {
          block_id: 'blk_cell2',
          type: 'table_cell',
          page_index: 0,
          bbox: [295, 85, 330, 100],
          parent_id: 'blk_row',
        },
      ],
    };
    const anchor = capturePageTextAnchor({
      doc: indexDocument(tied, 'api/ppr_S4REPARSE00000000000000000/g1/1.0.0'),
      pageIndex: 0,
      frame,
      items: [cell],
      start: { item: 0, offset: 0 },
      end: { item: 0, offset: 4 },
      textStreamId: pageTextStreamId('5.7.284'),
      id: '00000000-0000-4000-8000-000000000020',
      at: '2026-09-26T00:00:00.000Z',
      client: 'test',
    });
    expect(anchor?.targetKind).toBe('table_cell');
  });
});
