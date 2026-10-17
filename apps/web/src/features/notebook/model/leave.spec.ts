/** leave.spec — the keepalive plan for a closing page (#208): sizes, chunks, the warning, versions. */
import { describe, expect, it } from 'vitest';

import {
  KEEPALIVE_CAP,
  chunkWrites,
  needsLeaveWarning,
  opBytes,
  predictedAfter,
  predictedSaved,
} from './leave';

import type { Write } from './leave';
import type { SaveOp, SavedItem } from './save';

const patch = (body: string, version = 1): SaveOp => ({ kind: 'patch', body: { version, body } });
const write = (id: string, kb: number): Write => ({
  id,
  op: patch('x'),
  bytes: kb * 1024,
});

describe('opBytes', () => {
  it('counts the JSON body in UTF-8, as the browser counts the keepalive budget', () => {
    expect(opBytes(patch('abc'))).toBe(JSON.stringify({ version: 1, body: 'abc' }).length);
    // Three bytes for each CJK character: a 21,000-character note is 63 KB, over the cap.
    expect(opBytes(patch('注'.repeat(21_000)))).toBeGreaterThan(KEEPALIVE_CAP);
    expect(opBytes({ kind: 'delete', version: 3 })).toBe(0);
  });
});

describe('chunkWrites', () => {
  it('fills chunks in order under the cap, one request per write, and sets aside the too-big', () => {
    const [a, b, c, d] = [write('a', 40), write('b', 40), write('c', 10), write('d', 70)];
    const { chunks, oversize } = chunkWrites([a!, b!, c!, d!], 60 * 1024);
    expect(chunks.map((ch) => ch.map((w) => w.id))).toEqual([['a'], ['b', 'c']]);
    expect(oversize.map((w) => w.id)).toEqual(['d']);
    for (const ch of chunks) {
      expect(ch.reduce((sum, w) => sum + w.bytes, 0)).toBeLessThanOrEqual(60 * 1024);
    }
  });

  it('keeps small writes together and returns nothing for nothing', () => {
    expect(chunkWrites([write('a', 1), write('b', 1)]).chunks).toHaveLength(1);
    expect(chunkWrites([])).toEqual({ chunks: [], oversize: [] });
  });
});

describe('needsLeaveWarning', () => {
  it('warns only while some unsaved write is bigger than the cap on its own', () => {
    expect(needsLeaveWarning([])).toBe(false);
    expect(needsLeaveWarning([40 * 1024, 40 * 1024])).toBe(false);
    expect(needsLeaveWarning([KEEPALIVE_CAP])).toBe(false);
    expect(needsLeaveWarning([10, KEEPALIVE_CAP + 1])).toBe(true);
  });
});

describe('predictedSaved and predictedAfter', () => {
  const saved: SavedItem = { version: 4, x: 10, y: 20, w: 100, h: 50, z: 1, body: 'old' };

  it('predicts the version a queued write will meet once the one in flight lands', () => {
    const move: SaveOp = { kind: 'patch', body: { version: 4, x: 2 } };
    expect(predictedSaved(saved, move)).toEqual({ ...saved, x: 2, version: 5 });
    expect(predictedSaved(saved, undefined)).toBe(saved);
    expect(predictedSaved(saved, { kind: 'delete', version: 4 })).toBeUndefined();
    const create: SaveOp = {
      kind: 'create',
      body: { item_id: 'ni_1', kind: 'text', x: 1, y: 2, w: 3, h: 4, body: 'new' },
    };
    expect(predictedSaved(undefined, create)).toEqual({
      version: 1,
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      z: 0,
      body: 'new',
    });
  });

  it('chains through every write in flight, oldest first', () => {
    const ops: SaveOp[] = [
      { kind: 'patch', body: { version: 4, x: 2 } },
      { kind: 'patch', body: { version: 5, body: 'typed' } },
    ];
    expect(predictedAfter(saved, ops)).toEqual({ ...saved, x: 2, body: 'typed', version: 6 });
  });
});
