/**
 * The library's states (#196): who is "reading now" (and that the stats line counts the same set),
 * the face-out threshold, how many covers stand on a plank, and the place Continue writes for the
 * reader.
 */
import { describe, expect, it } from 'vitest';

import { libraryStats, type ShelfPaper } from './shelf';
import {
  FACE_OUT_MAX,
  READING_NOW_MAX,
  coverRows,
  coversPerRow,
  placeForContinue,
  readingNow,
  shelfLayout,
} from './states';

import type { ReadingProgress } from '@/lib/api/types';

function reading(lastPage: number, openedAt: string, extra: Partial<ReadingProgress> = {}) {
  return {
    last_page: lastPage,
    furthest_page: lastPage,
    page_count: 15,
    opened_at: openedAt,
    finished_at: null,
    state: 'reading' as const,
    ...extra,
  };
}

function paper(id: string, overrides: Partial<ShelfPaper> = {}): ShelfPaper {
  return {
    id,
    title: `Paper ${id}`,
    authors: [],
    pageCount: 15,
    processing: 'complete',
    addedAt: `2026-10-0${id.length}T00:00:00Z`,
    ...overrides,
  };
}

describe('reading now', () => {
  const papers = [
    paper('old', { reading: reading(3, '2026-10-01T00:00:00Z') }),
    paper('new', { reading: reading(8, '2026-10-12T00:00:00Z') }),
    paper('mid', { reading: reading(0, '2026-10-05T00:00:00Z') }),
    paper('late', { reading: reading(2, '2026-10-09T00:00:00Z') }),
    paper('done', {
      reading: reading(14, '2026-10-14T00:00:00Z', {
        state: 'finished',
        finished_at: '2026-10-14T00:00:00Z',
      }),
    }),
    paper('kraft', { processing: 'parsing', reading: reading(1, '2026-10-15T00:00:00Z') }),
    paper('never'),
  ];

  it('is the unfinished papers with a place, most recently opened first, at most three', () => {
    expect(READING_NOW_MAX).toBe(3);
    expect(readingNow(papers).map((p) => p.id)).toEqual(['new', 'late', 'mid']);
    expect(readingNow(papers, 10).map((p) => p.id)).toEqual(['new', 'late', 'mid', 'old']);
  });

  it('is the set the stats line counts', () => {
    expect(libraryStats(papers).readingNow).toBe(readingNow(papers, 99).length);
  });

  it('leaves out a paper whose page count is unknown, so no row reads "p. 4 of 0"', () => {
    const unknown = paper('x', {
      pageCount: 0,
      reading: reading(3, '2026-10-01T00:00:00Z', { page_count: null }),
    });
    expect(readingNow([unknown])).toEqual([]);
    expect(libraryStats([unknown]).readingNow).toBe(0);
  });
});

describe('the shelf layout', () => {
  it(`stands up to ${String(FACE_OUT_MAX)} papers face-out, and spines past that`, () => {
    expect(shelfLayout(1)).toBe('face-out');
    expect(shelfLayout(FACE_OUT_MAX)).toBe('face-out');
    expect(shelfLayout(FACE_OUT_MAX + 1)).toBe('spines');
  });

  it('puts four covers on a plank at 1440 px, one on a phone, one before measuring', () => {
    expect(coversPerRow(1280)).toBe(4);
    expect(coversPerRow(358)).toBe(1);
    expect(coversPerRow(0)).toBe(1);
  });

  it('cuts the arranged order into planks', () => {
    const papers = ['e', 'a', 'd', 'c', 'b'].map((id, i) =>
      paper(id, { title: id, addedAt: `2026-10-0${String(i + 1)}T00:00:00Z` }),
    );
    const ids = (rows: ShelfPaper[][]) => rows.map((row) => row.map((p) => p.id));
    expect(ids(coverRows(papers, 'topic', 2))).toEqual([['e', 'a'], ['d', 'c'], ['b']]);
    expect(ids(coverRows(papers, 'title', 4))).toEqual([['a', 'b', 'c', 'd'], ['e']]);
    expect(coverRows([], 'topic', 4)).toEqual([]);
  });
});

describe("Continue's reader place", () => {
  const saved = {
    v: 1,
    mode: 'guided',
    zoomMode: { kind: 'fit-page' },
    page: 3,
    yPt: 412,
    blockId: 'b1',
  };

  it('keeps a saved place already on the page, to the line', () => {
    expect(placeForContinue(saved, 3, false)).toBeNull();
  });

  it("moves a saved place to the server's page, keeping its mode and zoom", () => {
    expect(placeForContinue(saved, 7, false)).toEqual({
      v: 1,
      mode: 'guided',
      zoomMode: { kind: 'fit-page' },
      page: 7,
      yPt: 0,
    });
  });

  it("writes the reader's defaults when nothing (or nothing valid) is saved", () => {
    expect(placeForContinue(null, 2, false)).toEqual({
      v: 1,
      mode: 'source',
      zoomMode: { kind: 'scale', scale: 1.25 },
      page: 2,
      yPt: 0,
    });
    expect(placeForContinue({ v: 2, page: 2 }, 2, true)).toEqual({
      v: 1,
      mode: 'source',
      zoomMode: { kind: 'fit-width' },
      page: 2,
      yPt: 0,
    });
    expect(placeForContinue('garbage', 0, false)?.['page']).toBe(0);
  });
});
