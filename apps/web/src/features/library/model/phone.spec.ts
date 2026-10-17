/**
 * The phone library's rule (#199): the breakpoint and what changes under it (flat books at any
 * count, Reading now always, the card as a sheet), and the flat-book row model: frame 08a's lengths
 * and offsets, the faces, the ribbon and the year, and the stack's arrow keys.
 */
import { describe, expect, it } from 'vitest';

import {
  FLAT_SHORT_MAX,
  PHONE_MAX_WIDTH,
  PHONE_QUERY,
  flatBook,
  flatStep,
  libraryPlan,
} from './phone';
import { AT_SCALE_MIN, FACE_OUT_MAX } from './states';

import type { ShelfPaper } from './shelf';

function paper(overrides: Partial<ShelfPaper> = {}): ShelfPaper {
  return {
    id: 'ppr_att',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani'],
    pageCount: 15,
    processing: 'complete',
    addedAt: '2026-10-01T00:00:00Z',
    year: 2017,
    arxivCategory: 'cs.CL',
    ...overrides,
  };
}

const READING = {
  last_page: 3,
  furthest_page: 3,
  page_count: 15,
  opened_at: '2026-10-10T00:00:00Z',
  finished_at: null,
  state: 'reading' as const,
};

describe('the phone layout rule', () => {
  it('is the 900 px breakpoint the header and the Table already use', () => {
    expect(PHONE_MAX_WIDTH).toBe(900);
    expect(PHONE_QUERY).toBe('(max-width: 900px)');
  });

  it('lays the books flat at every count on a phone, with Reading now and the sheet', () => {
    for (const count of [1, FACE_OUT_MAX, FACE_OUT_MAX + 1, AT_SCALE_MIN + 1, 400]) {
      expect(libraryPlan(count, true)).toEqual({ shelf: 'flat', readingNow: true, card: 'sheet' });
    }
  });

  it('keeps the desktop layouts unchanged off the phone', () => {
    expect(libraryPlan(FACE_OUT_MAX, false)).toEqual({
      shelf: 'face-out',
      readingNow: false,
      card: 'band',
    });
    expect(libraryPlan(24, false)).toEqual({ shelf: 'spines', readingNow: true, card: 'band' });
    expect(libraryPlan(AT_SCALE_MIN + 1, false).shelf).toBe('rows');
  });
});

describe('a flat book', () => {
  it('is as long as frame 08a draws it on a 358 px stack (274 + 1.12 × pages)', () => {
    const length = (pages: number) => 358 - flatBook(paper({ pageCount: pages })).short;
    // U-Net, YOLO, Attention, BERT, ViT, LoRA, FlashAttention, CLIP, GPT-3 as the frame draws them.
    const frame: [number, number][] = [
      [8, 282],
      [10, 285],
      [15, 291],
      [16, 292],
      [22, 299],
      [26, 303],
      [34, 313],
      [48, 330],
      [75, 358],
    ];
    for (const [pages, drawn] of frame) expect(Math.abs(length(pages) - drawn)).toBeLessThan(2.5);
  });

  it('is never longer than the stack, and an uncounted book is drawn as 16 pages', () => {
    expect(flatBook(paper({ pageCount: 400 })).short).toBe(0);
    expect(flatBook(paper({ pageCount: 1 })).short).toBeLessThanOrEqual(FLAT_SHORT_MAX);
    expect(flatBook(paper({ pageCount: 0 })).short).toBe(flatBook(paper({ pageCount: 16 })).short);
  });

  it('sits 0–12 px in from the stack edge, the same every time for the same paper', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `ppr_${String(i)}`);
    const offsets = ids.map((id) => flatBook(paper({ id })).offset);
    expect(new Set(offsets).size).toBeGreaterThan(2);
    for (const offset of offsets) expect([0, 4, 6, 10, 12]).toContain(offset);
    expect(flatBook(paper({ id: 'ppr_7' })).offset).toBe(offsets[7]);
  });

  it('prints the short title and the year in gilt, and ties a ribbon on while you read it', () => {
    const bert = flatBook(
      paper({
        title: 'BERT: Pre-training of Deep Bidirectional Transformers',
        year: 2018,
        reading: READING,
      }),
    );
    expect(bert).toMatchObject({
      face: 'gilt',
      title: 'BERT',
      year: 2018,
      ribbon: true,
      note: null,
    });
    expect(flatBook(paper({ year: null })).year).toBeNull();
    expect(flatBook(paper()).ribbon).toBe(false);
  });

  it('wears kraft while we read it, a torn label when we could not, a label on Language cloth', () => {
    const lora = flatBook(paper({ processing: 'parsing', reading: READING }));
    // Processing wins over reading, as on the spines: no ribbon on kraft, no year on paper.
    expect(lora).toMatchObject({ face: 'kraft', note: 'being read', ribbon: false, year: null });
    expect(flatBook(paper({ processing: 'pending' })).face).toBe('kraft');
    expect(flatBook(paper({ processing: 'failed' }))).toMatchObject({
      face: 'torn',
      note: 'could not read',
      year: null,
    });
    expect(flatBook(paper({ arxivCategory: 'cs.IR' }))).toMatchObject({
      face: 'label',
      year: null,
    });
  });
});

describe('the stack keys', () => {
  it('walks down and up the stacks (and along, for ← →), Home and End, without wrapping', () => {
    expect(flatStep(0, 'ArrowDown', 5)).toBe(1);
    expect(flatStep(4, 'ArrowDown', 5)).toBe(4);
    expect(flatStep(2, 'ArrowUp', 5)).toBe(1);
    expect(flatStep(0, 'ArrowUp', 5)).toBe(0);
    expect(flatStep(1, 'ArrowRight', 5)).toBe(2);
    expect(flatStep(1, 'ArrowLeft', 5)).toBe(0);
    expect(flatStep(3, 'Home', 5)).toBe(0);
    expect(flatStep(0, 'End', 5)).toBe(4);
    expect(flatStep(0, 'Enter', 5)).toBeNull();
    expect(flatStep(0, 'ArrowDown', 0)).toBeNull();
  });
});
