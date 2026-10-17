/**
 * Continue trusts exactly the reader places the reader restores (#196, review N2): the library's
 * `readerPlace` and the reader's own `readSavedReaderState` must agree on every entry, so the two
 * checks cannot drift apart. The library does not import the reader (that would put pdf.js in the
 * library's bundle); this test holds them together instead.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { readSavedReaderState } from '@/app/paper/[id]/read/ReaderWorkspace';
import { readerPlace } from '@/features/library/model/states';

const KEY = 'papertree/reader/ppr_drift';
const GOOD = { v: 1, mode: 'source', zoomMode: { kind: 'scale', scale: 1.25 }, page: 3, yPt: 40 };

const ENTRIES: readonly unknown[] = [
  GOOD,
  { ...GOOD, mode: 'guided', zoomMode: { kind: 'fit-width' }, blockId: 'blk_x' },
  { ...GOOD, mode: 'split', zoomMode: { kind: 'fit-page' }, yPt: 0, page: 0 },
  { ...GOOD, v: 2 },
  { ...GOOD, mode: 'notes' },
  { ...GOOD, zoomMode: { kind: 'scale' } },
  { ...GOOD, zoomMode: { kind: 'scale', scale: -1 } },
  { ...GOOD, zoomMode: { kind: 'scale', scale: Number.POSITIVE_INFINITY } },
  { ...GOOD, zoomMode: { kind: 'zoom' } },
  { ...GOOD, page: -1 },
  { ...GOOD, page: 2.5 },
  { ...GOOD, page: '3' },
  { ...GOOD, yPt: -4 },
  { ...GOOD, yPt: Number.NaN },
  { mode: 'source' },
  'a string',
  null,
];

afterEach(() => window.localStorage.clear());

describe("Continue's reader place matches the reader's", () => {
  it('accepts and rejects the same entries as readSavedReaderState', () => {
    for (const entry of ENTRIES) {
      window.localStorage.setItem(KEY, JSON.stringify(entry));
      // JSON drops NaN and Infinity to null, so compare what the reader would actually read.
      const stored: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
      const reader = readSavedReaderState(KEY) !== null;
      expect(readerPlace(stored) !== null, JSON.stringify(entry)).toBe(reader);
    }
  });
});
