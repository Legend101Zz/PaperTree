/**
 * floats: which floats a page offers for one-click selection, from the IR's boxes (#348 item 1),
 * on the real ResNet parse (pages 1-2) and on small hand-made pages for the rules.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  indexDocument,
  type IndexedBlock,
  type IndexedDocument,
  type PaperSource,
} from '@papertree/anchoring';

import { floatAt, floatsOnPage } from './floats';

const REAL = `${process.cwd()}/test/fixtures`;
const real = indexDocument(
  JSON.parse(readFileSync(`${REAL}/real-resnet-p1-2.ir.json`, 'utf8')) as PaperSource,
  'floats-spec',
);

/** A parse reduced to what `floatsOnPage` reads: blocks by page and id, and relations. */
function fake(
  blocks: readonly Partial<IndexedBlock>[],
  relations: readonly { type: string; from: string; to: string }[] = [],
): IndexedDocument {
  const full = blocks.map(
    (b, i) =>
      ({
        parentId: null,
        readingIndex: i,
        text: '',
        pageIndex: 0,
        payload: undefined,
        ...b,
      }) as IndexedBlock,
  );
  const byPage = new Map<number, IndexedBlock[]>();
  for (const b of full) byPage.set(b.pageIndex, [...(byPage.get(b.pageIndex) ?? []), b]);
  return {
    byId: new Map(full.map((b) => [b.id, b])),
    byPage,
    relations,
  } as unknown as IndexedDocument;
}

describe('the real ResNet page 1', () => {
  it('Figure 1 is one float whose box takes in its caption', () => {
    const [figure, ...rest] = floatsOnPage(real, 0);
    expect(rest).toEqual([]);
    expect(figure?.id).toBe('blk_3pzzcn4luvb5qmpc');
    expect(figure?.label).toBe('Figure 1');
    expect(figure?.caption?.startsWith('Figure 1. Training error')).toBe(true);
    // The figure is [309, 224, 545, 302] and its caption [309, 306, 545, 347]: both are inside.
    [309, 224, 545, 347].forEach((n, i) => expect(figure?.box[i]).toBeCloseTo(n, 0));
  });

  it('a click on the figure, and on its caption, picks it; a click on body text does not', () => {
    const floats = floatsOnPage(real, 0);
    expect(floatAt(floats, 400, 260)?.label).toBe('Figure 1');
    expect(floatAt(floats, 400, 330)?.label).toBe('Figure 1');
    expect(floatAt(floats, 100, 400)).toBeNull();
    expect(floatAt(floats, 400, 350)).toBeNull();
  });
});

describe('the rules', () => {
  it('keeps the outermost figure and drops its panels', () => {
    const doc = fake([
      { id: 'whole', type: 'figure', bbox: [50, 100, 450, 300] },
      { id: 'left', type: 'figure', bbox: [55, 105, 240, 295] },
      { id: 'right', type: 'figure', bbox: [260, 105, 445, 295] },
    ]);
    expect(floatsOnPage(doc, 0).map((f) => f.id)).toEqual(['whole']);
  });

  it('takes the caption the parser linked (caption_of), and the nearest one when it linked none', () => {
    const linked = fake(
      [
        { id: 'fig', type: 'figure', bbox: [50, 100, 450, 300] },
        { id: 'cap', type: 'caption', bbox: [50, 310, 450, 340], text: 'Table 9. Elsewhere' },
        { id: 'far', type: 'caption', bbox: [50, 700, 450, 720], text: 'Figure 5. Far away' },
      ],
      [{ type: 'caption_of', from: 'cap', to: 'fig' }],
    );
    expect(floatsOnPage(linked, 0)[0]).toMatchObject({
      caption: 'Table 9. Elsewhere',
      box: [50, 100, 450, 340],
    });
    const near = fake([
      { id: 'fig', type: 'figure', bbox: [50, 100, 450, 300] },
      { id: 'cap', type: 'caption', bbox: [50, 306, 450, 340], text: 'Figure 3. Close' },
      { id: 'far', type: 'caption', bbox: [50, 700, 450, 720], text: 'Figure 5. Far away' },
    ]);
    expect(floatsOnPage(near, 0)[0]).toMatchObject({ label: 'Figure 3', box: [50, 100, 450, 340] });
  });

  it('offers tables, algorithms and display equations too, in reading order, and skips table cells', () => {
    const doc = fake([
      { id: 'eq', type: 'equation', bbox: [60, 500, 300, 530] },
      { id: 'tab', type: 'table', bbox: [60, 100, 500, 250] },
      { id: 'cell', type: 'table_cell', bbox: [60, 100, 120, 130], parentId: 'tab' },
      { id: 'alg', type: 'algorithm', bbox: [60, 300, 500, 450] },
      { id: 'para', type: 'paragraph', bbox: [60, 600, 500, 700] },
    ]);
    expect(floatsOnPage(doc, 0).map((f) => [f.id, f.kind])).toEqual([
      ['tab', 'table'],
      ['alg', 'algorithm'],
      ['eq', 'equation'],
    ]);
  });

  it('where floats overlap, the smaller one under the point wins', () => {
    const doc = fake([
      { id: 'big', type: 'table', bbox: [50, 100, 500, 400] },
      { id: 'small', type: 'equation', bbox: [100, 150, 200, 180] },
    ]);
    const floats = floatsOnPage(doc, 0);
    expect(floatAt(floats, 150, 160)?.id).toBe('small');
    expect(floatAt(floats, 300, 300)?.id).toBe('big');
  });
});
