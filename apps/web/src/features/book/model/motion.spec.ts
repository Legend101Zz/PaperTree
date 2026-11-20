/**
 * The book's motion (v0.3 R4, DESIGN.md §6): one take-out-and-open of 880 ms in five phases (slide
 * out 120, turn 160, travel and grow 220, cover swings 280, settle 100), the put-back in 420 ms,
 * and a 120 ms cross-fade, with no transform at all, for reduced motion.
 */
import { describe, expect, it } from 'vitest';

import {
  PUT_BACK_MS,
  SETTLE_MS,
  SLIDE_MS,
  SWING_MS,
  TAKE_OUT_MS,
  TO_READER,
  TRAVEL_MS,
  TURN_MS,
  putBack,
  takeOut,
} from './motion';

const PAGE = { left: 720, top: 40, width: 546, height: 820 };
const SPINE = { left: 120, top: 480, width: 54, height: 231 };

const offsets = (keyframes: Keyframe[] | undefined): (number | null | undefined)[] =>
  (keyframes ?? []).map((k) => k.offset);

describe('taking the book out and opening it', () => {
  it('is five phases that add up to 880 ms', () => {
    expect([SLIDE_MS, TURN_MS, TRAVEL_MS, SWING_MS, SETTLE_MS]).toEqual([120, 160, 220, 280, 100]);
    expect(TAKE_OUT_MS).toBe(880);
    const { cover, slab, spread, veil } = takeOut(SPINE, PAGE, false);
    expect(cover?.options.duration).toBe(880);
    expect(slab?.options.duration).toBe(880);
    expect(spread.options.duration).toBe(880);
    // The veil is in before the book has turned to face you.
    expect(veil.options.duration).toBe(SLIDE_MS + TURN_MS);
  });

  it('turns the cover at the spine, then flies and grows, then swings it open', () => {
    const cover = takeOut(SPINE, PAGE, false).cover;
    const at = (n: number): string => String(cover?.keyframes[n]?.transform);
    // 120 | 280 | 500 | 780 of 880: the end of slide, turn, travel and swing.
    expect(offsets(cover?.keyframes).map((o) => Math.round((o ?? 0) * 880))).toEqual([
      0, 120, 280, 500, 780, 880,
    ]);
    // Edge-on and small at the spine until the slide is over...
    expect(at(0)).toMatch(/^translate\(-573\.0px, 145\.5px\) scale\(0\.282\)/);
    expect(at(0)).toContain('rotateY(90deg)');
    expect(at(1)).toBe(at(0));
    // ...faces you, still small, after the turn...
    expect(at(2)).toContain('rotateY(0deg)');
    expect(at(2)).toContain('scale(0.282)');
    // ...is page size at the page after the travel...
    expect(at(3)).toContain('translate(0px, 0px) scale(1)');
    // ...and has swung right over by the end of the swing, where it stays through the settle.
    expect(at(4)).toContain('rotateY(-180deg)');
    expect(at(5)).toBe(at(4));
  });

  it('keeps the spread hidden until the cover is across it', () => {
    const { keyframes } = takeOut(SPINE, PAGE, false).spread;
    expect(keyframes[0]?.opacity).toBe(0);
    expect(keyframes[1]).toMatchObject({ opacity: 0 });
    expect(Math.round((keyframes[1]?.offset ?? 0) * 880)).toBe(500);
    expect(keyframes[keyframes.length - 1]?.opacity).toBe(1);
  });

  it('lifts the spine 22 px out of its slot before it turns away', () => {
    const slab = takeOut(SPINE, PAGE, false).slab;
    expect(slab?.keyframes[1]?.transform).toContain('translateY(-22px)');
    expect(slab?.keyframes[1]?.opacity).toBe(1);
    expect(slab?.keyframes[slab.keyframes.length - 1]?.opacity).toBe(0);
  });

  it('is one 120 ms cross-fade under reduced motion, with nothing moving', () => {
    const { cover, slab, spread, veil } = takeOut(SPINE, PAGE, true);
    expect(cover).toBeNull();
    expect(slab).toBeNull();
    for (const part of [spread, veil]) {
      expect(part.options.duration).toBe(120);
      expect(part.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    }
  });

  it('cross-fades too when the spine cannot be measured', () => {
    expect(takeOut(null, PAGE, false).cover).toBeNull();
    expect(takeOut(null, PAGE, false).spread.options.duration).toBe(120);
  });
});

describe('putting the book back and reading it', () => {
  it('runs the reverse in 420 ms: the cover closes, flies to the slot and turns edge-on', () => {
    expect(PUT_BACK_MS).toBe(420);
    const { cover, spread, veil, slab } = putBack(SPINE, PAGE, false);
    for (const part of [cover, spread, veil, slab]) expect(part?.options.duration).toBe(420);
    const at = (n: number): string => String(cover?.keyframes[n]?.transform);
    expect(at(0)).toContain('rotateY(-180deg)');
    expect(at(1)).toContain('translate(0px, 0px) scale(1) ');
    expect(at(1)).toContain('rotateY(0deg)');
    expect(at(2)).toContain('scale(0.282)');
    expect(at(3)).toContain('rotateY(90deg)');
    // The spine is back in its slot only once the book has arrived.
    expect(slab?.keyframes.map((k) => k.opacity)).toEqual([0, 0, 1]);
  });

  it('fades out in 120 ms under reduced motion, with nothing moving', () => {
    const { cover, slab, spread } = putBack(SPINE, PAGE, true);
    expect(cover).toBeNull();
    expect(slab).toBeNull();
    expect(spread.options.duration).toBe(120);
    expect(spread.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
  });

  it('fades the book into the reader in 120 ms', () => {
    expect(TO_READER.options.duration).toBe(120);
  });
});
