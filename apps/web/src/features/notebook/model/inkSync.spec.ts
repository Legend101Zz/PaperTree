/** inkSync.spec — what the server lacks of a page's ink, and the batching rule (#209). */
import { describe, expect, it } from 'vitest';

import { MAX_BATCH_STROKES, batches, strokeWrites } from './inkSync';
import { decodeStroke } from './stroke';
import { stroke } from './test-helpers';
import { bytesFromBase64, strokeFromWire, strokeToWire } from './wire';

const a = stroke('ns_aaaaaaaa', [
  [10, 10],
  [20, 12],
]);
const b = stroke('ns_bbbbbbbb', [[30, 30]]);
const c = stroke('ns_cccccccc', [[40, 40]]);

describe('strokeWrites', () => {
  it('adds what only the page has, in paint order, and removes what only the server has', () => {
    expect(strokeWrites(new Set(['ns_bbbbbbbb', 'ns_gone0000']), [a, b, c])).toEqual({
      add: [a, c],
      remove: ['ns_gone0000'],
    });
  });

  it('sends nothing when the two agree', () => {
    expect(strokeWrites(new Set([a.id]), [a])).toEqual({ add: [], remove: [] });
  });

  it('never sends a refused stroke again', () => {
    expect(strokeWrites(new Set(), [a, b], new Set([a.id])).add).toEqual([b]);
  });

  it('sends a stroke whose POST may have landed again while it is on the page, else DELETEs it', () => {
    const maybe = new Set([a.id]);
    expect(strokeWrites(new Set(), [a], new Set(), maybe)).toEqual({ add: [a], remove: [] });
    // Undone or erased after a failed POST that may have reached the server: it must not return.
    expect(strokeWrites(new Set(), [b], new Set(), maybe)).toEqual({ add: [b], remove: [a.id] });
  });
});

describe('the batching rule', () => {
  const sized = (n: number, bytes = 10) =>
    Array.from({ length: n }, (_, i) => ({ value: i, bytes }));

  it('keeps one batch while it fits', () => {
    expect(batches(sized(3), 100)).toEqual([[0, 1, 2]]);
  });

  it('starts a new batch at the byte cap, in order', () => {
    expect(batches(sized(5, 40), 100)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it('starts a new batch at the API’s 200 strokes', () => {
    const out = batches(sized(450, 1), 1e9);
    expect(out.map((x) => x.length)).toEqual([MAX_BATCH_STROKES, MAX_BATCH_STROKES, 50]);
  });

  it('sends a stroke over the cap alone, never drops it', () => {
    const items = [
      { value: 'small', bytes: 10 },
      { value: 'huge', bytes: 500 },
      { value: 'next', bytes: 10 },
    ];
    expect(batches(items, 100)).toEqual([['small'], ['huge'], ['next']]);
  });

  it('makes no batch of nothing', () => {
    expect(batches([], 100)).toEqual([]);
  });
});

describe('strokeToWire', () => {
  it('writes the blob decodeStroke reads back, and the stroke strokeFromWire rebuilds', () => {
    const pen = stroke('ns_pressure', [[1.5, 2.25]], { hasPressure: false, color: 'pen-blue' });
    const wire = strokeToWire(pen);
    expect(decodeStroke(bytesFromBase64(wire.points_b64)).points).toEqual([[1.5, 2.25, 0.5]]);
    expect(strokeFromWire({ ...wire, page_id: 'np_1', created_at: '' })).toEqual(pen);
    expect(strokeToWire(pen)).toBe(wire);
  });
});
