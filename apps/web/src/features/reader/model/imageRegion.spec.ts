/**
 * imageRegion: drawing, moving, resizing and nudging the area rectangle (#348 items 2 and 7). It
 * never leaves its page and never gets thinner than MIN_SIDE, whichever way it is changed.
 */
import { describe, expect, it } from 'vitest';

import {
  BIG_STEP,
  boxBetween,
  isArrow,
  isUsable,
  MIN_SIDE,
  moveBox,
  nudgeBox,
  resizeBox,
  starterBox,
  STEP,
} from './imageRegion';

import type { BBox } from '@papertree/document-ir';

const PAGE = { width: 612, height: 792 };

describe('drawing', () => {
  it('normalises a drag in any direction and keeps it on the page', () => {
    expect(boxBetween([200, 300], [100, 150], PAGE)).toEqual([100, 150, 200, 300]);
    expect(boxBetween([-50, 10], [700, 900], PAGE)).toEqual([0, 10, 612, 792]);
  });

  it('a click, or a sliver, is not usable', () => {
    expect(isUsable(boxBetween([100, 100], [100, 100], PAGE))).toBe(false);
    expect(isUsable([0, 0, MIN_SIDE - 1, 200])).toBe(false);
    expect(isUsable([0, 0, MIN_SIDE, MIN_SIDE])).toBe(true);
  });
});

describe('moving', () => {
  it('keeps the size and stops at the page edges', () => {
    const box: BBox = [100, 100, 300, 200];
    expect(moveBox(box, 20, -10, PAGE)).toEqual([120, 90, 320, 190]);
    expect(moveBox(box, -500, -500, PAGE)).toEqual([0, 0, 200, 100]);
    expect(moveBox(box, 900, 900, PAGE)).toEqual([412, 692, 612, 792]);
  });
});

describe('resizing by a handle', () => {
  const box: BBox = [100, 100, 300, 200];

  it('moves only the edges the handle holds', () => {
    expect(resizeBox(box, 'e', 50, 999, PAGE)).toEqual([100, 100, 350, 200]);
    expect(resizeBox(box, 'nw', -20, -30, PAGE)).toEqual([80, 70, 300, 200]);
    expect(resizeBox(box, 'se', 10, 10, PAGE)).toEqual([100, 100, 310, 210]);
  });

  it('never carries an edge past its opposite, nor off the page', () => {
    expect(resizeBox(box, 'e', -500, 0, PAGE)).toEqual([100, 100, 100 + MIN_SIDE, 200]);
    expect(resizeBox(box, 'n', 0, 500, PAGE)).toEqual([100, 200 - MIN_SIDE, 300, 200]);
    expect(resizeBox(box, 'w', -500, 0, PAGE)).toEqual([0, 100, 300, 200]);
    expect(resizeBox(box, 's', 0, 5000, PAGE)).toEqual([100, 100, 300, 792]);
  });
});

describe('the arrow keys', () => {
  const box: BBox = [100, 100, 300, 200];
  const plain = { shift: false, alt: false };

  it('are the four arrows, and nothing else', () => {
    expect(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].every(isArrow)).toBe(true);
    expect(isArrow('Enter')).toBe(false);
  });

  it('nudge by a step, a bigger one with Shift', () => {
    expect(nudgeBox(box, 'ArrowRight', plain, PAGE)).toEqual([100 + STEP, 100, 300 + STEP, 200]);
    expect(nudgeBox(box, 'ArrowUp', plain, PAGE)).toEqual([100, 100 - STEP, 300, 200 - STEP]);
    expect(nudgeBox(box, 'ArrowDown', { shift: true, alt: false }, PAGE)).toEqual([
      100,
      100 + BIG_STEP,
      300,
      200 + BIG_STEP,
    ]);
  });

  it('with Alt, resize from the bottom-right corner: Right and Down grow, Left and Up shrink', () => {
    expect(nudgeBox(box, 'ArrowRight', { shift: false, alt: true }, PAGE)).toEqual([
      100,
      100,
      300 + STEP,
      200,
    ]);
    expect(nudgeBox(box, 'ArrowUp', { shift: false, alt: true }, PAGE)).toEqual([
      100,
      100,
      300,
      200 - STEP,
    ]);
  });

  it('a starter rectangle, for a keyboard that cannot drag, is in the middle of the page', () => {
    const [x0, y0, x1, y1] = starterBox(PAGE);
    expect(isUsable([x0, y0, x1, y1])).toBe(true);
    expect((x0 + x1) / 2).toBeCloseTo(306);
    expect((y0 + y1) / 2).toBeCloseTo(396);
  });
});
