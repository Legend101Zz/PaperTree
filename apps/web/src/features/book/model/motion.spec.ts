/**
 * The book's motion (#200, DESIGN.md §6): the pull-out is lift 120 → turn 200 → settle 80 on the
 * lift curve, starting at the spine; the opening swings 480; reduced motion is a 120 ms
 * cross-fade with no transform at all.
 */
import { describe, expect, it } from 'vitest';

import { EASE_LIFT, openBook, pullOut, putBack, REST, TO_READER } from './motion';

const COVER = { left: 570, top: 200, width: 300, height: 420 };
const SPINE = { left: 120, top: 480, width: 40, height: 300 };

describe('the pull-out', () => {
  it('lifts, turns and settles in 400 ms, from the spine to the resting pose', () => {
    const { keyframes, options } = pullOut(SPINE, COVER, false);
    expect(options.duration).toBe(400);
    expect(options.easing).toBe(EASE_LIFT);
    expect(keyframes.map((k) => k.offset)).toEqual([0, 0.3, 0.8, 1]);
    expect(String(keyframes[0]?.transform)).toMatch(
      /^translate\(-580\.0px, 220\.0px\) scale\(0\.714\)/,
    );
    expect(String(keyframes[0]?.transform)).toContain('rotateY(80deg)');
    expect(keyframes[3]?.transform).toBe(REST);
  });

  it('lifts in place when the spine cannot be measured', () => {
    expect(String(pullOut(null, COVER, false).keyframes[0]?.transform)).toContain(
      'translateY(24px)',
    );
  });

  it('is one 120 ms cross-fade under reduced motion, with nothing moving', () => {
    const { keyframes, options } = pullOut(SPINE, COVER, true);
    expect(options.duration).toBe(120);
    expect(keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });
});

describe('opening, putting back and reading', () => {
  it('swings the cover open over 480 ms while the spread comes up', () => {
    const { cover, spread } = openBook(false);
    expect(cover?.options.duration).toBe(480);
    expect(String(cover?.keyframes[1]?.transform)).toContain('rotateY(-150deg)');
    expect(spread.options.duration).toBe(480);
  });

  it('opens with one 120 ms cross-fade under reduced motion, and no swing', () => {
    const { cover, spread } = openBook(true);
    expect(cover).toBeNull();
    expect(spread.options.duration).toBe(120);
    expect(spread.keyframes.every((k) => k.transform === undefined)).toBe(true);
  });

  it('puts back in 200 ms (a 120 ms fade when reduced) and fades to the reader in 120', () => {
    expect(putBack(false).options.duration).toBe(200);
    expect(putBack(true).options.duration).toBe(120);
    expect(putBack(true).keyframes.every((k) => k.transform === undefined)).toBe(true);
    expect(TO_READER.options.duration).toBe(120);
  });
});
