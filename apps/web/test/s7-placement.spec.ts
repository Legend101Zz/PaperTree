/**
 * @vitest-environment node
 * S7: a new node never lands on an existing one, and the same board gives the same spot.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SIZE,
  boundsOf,
  freeSpot,
  overlaps,
  type Rect,
} from '@/features/board/model/placement';

describe('freeSpot', () => {
  it('starts at the origin on an empty board', () => {
    expect(freeSpot([], DEFAULT_SIZE.excerpt)).toEqual({ x: 0, y: 0 });
  });

  it('never overlaps, however many nodes are already there, and is deterministic', () => {
    const board: Rect[] = [];
    for (let i = 0; i < 60; i += 1) {
      const size =
        i % 3 === 0
          ? DEFAULT_SIZE.explanation
          : i % 3 === 1
            ? DEFAULT_SIZE.excerpt
            : DEFAULT_SIZE.note;
      const spot = freeSpot(board, size);
      expect(freeSpot(board, size)).toEqual(spot);
      const rect = { ...spot, ...size };
      expect(board.some((r) => overlaps(rect, r, 0))).toBe(false);
      board.push(rect);
    }
  });

  it('avoids a node the reader dragged onto the first cell', () => {
    const dragged: Rect = { x: 10, y: 10, w: 500, h: 500 };
    const spot = freeSpot([dragged], DEFAULT_SIZE.note);
    expect(overlaps({ ...spot, ...DEFAULT_SIZE.note }, dragged, 0)).toBe(false);
  });

  it('uses the asked-for place when it is free and the nearest free one when it is not', () => {
    expect(freeSpot([], DEFAULT_SIZE.note, { x: 300, y: 200 })).toEqual({ x: 300, y: 200 });
    const taken: Rect = { x: 300, y: 200, w: 260, h: 150 };
    const spot = freeSpot([taken], DEFAULT_SIZE.note, { x: 300, y: 200 });
    expect(overlaps({ ...spot, ...DEFAULT_SIZE.note }, taken, 0)).toBe(false);
  });
});

describe('boundsOf', () => {
  it('contains every rect with room for a group title', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 200, y: 100, w: 100, h: 50 },
    ];
    const box = boundsOf(rects);
    for (const r of rects) {
      expect(box.x).toBeLessThanOrEqual(r.x);
      expect(box.y).toBeLessThan(r.y);
      expect(box.x + box.w).toBeGreaterThanOrEqual(r.x + r.w);
      expect(box.y + box.h).toBeGreaterThanOrEqual(r.y + r.h);
    }
  });
});
