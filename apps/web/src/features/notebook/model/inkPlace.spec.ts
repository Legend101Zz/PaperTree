/** inkPlace.spec — one rule for where ink sits while the open answer pushes the page down (#209). */
import { describe, expect, it } from 'vitest';

import { inFold, inkLayers, startY, storedPoints, strokesAsShown } from './inkPlace';
import { stroke } from './test-helpers';

// The exchange's box ends at 300; open, the answer is 200 taller, so the band is [300, 500).
const OPEN = { boundary: 300, extra: 200 };
const CLOSED = { boundary: 300, extra: 0 };
const ys = (pts: readonly (readonly number[])[]) => pts.map((p) => p[1]);

describe('the layer a stroke belongs to', () => {
  // Starts above the box and runs down past it: it stays put, by where it STARTS.
  const margin = stroke('margin', [
    [700, 280],
    [700, 420],
  ]);
  // Starts beside a card below the box, and reaches up above the box's bottom.
  const card = stroke('card', [
    [700, 320],
    [700, 250],
  ]);

  it('goes by its first point, not its top', () => {
    expect(startY(card)).toBe(320);
    const { above, below } = inkLayers([margin, card], OPEN.boundary);
    expect(above.map((s) => s.id)).toEqual(['margin']);
    expect(below.map((s) => s.id)).toEqual(['card']);
  });

  it('puts everything above on a page without an exchange', () => {
    expect(inkLayers([margin, card], null).below).toEqual([]);
  });

  it('shows a stroke below the box lower by extra while the answer is open, and only then', () => {
    const shown = strokesAsShown([margin, card], OPEN);
    expect(ys(shown[0]!.points)).toEqual([280, 420]);
    expect(ys(shown[1]!.points)).toEqual([520, 450]);
    expect(shown[1]!.id).toBe('card');
    expect(strokesAsShown([margin, card], CLOSED)).toEqual([margin, card]);
  });
});

describe('storing a stroke drawn as shown', () => {
  const drawn = (y0: number, y1: number) =>
    [
      [10, y0, 0.5],
      [20, y1, 0.5],
    ] as const;

  it('keeps a stroke begun above the box where it was drawn, even through the band', () => {
    expect(storedPoints(drawn(250, 450), OPEN)).toEqual(drawn(250, 450));
  });

  it('moves a stroke begun below the band up by extra, so it is drawn back where it was', () => {
    const stored = storedPoints(drawn(600, 450), OPEN)!;
    expect(ys(stored)).toEqual([400, 250]);
    // Round trip: stored, then shown by the same rule, lands where the pen went.
    const back = strokesAsShown([{ ...stroke('s', []), points: stored }], OPEN);
    expect(ys(back[0]!.points)).toEqual([600, 450]);
  });

  it('refuses a stroke begun in the band, which has no stored place', () => {
    expect(inFold(300, OPEN)).toBe(true);
    expect(inFold(499, OPEN)).toBe(true);
    expect(inFold(500, OPEN)).toBe(false);
    expect(inFold(299, OPEN)).toBe(false);
    expect(storedPoints(drawn(350, 600), OPEN)).toBeNull();
  });

  it('stores anything as drawn while the answer is closed', () => {
    expect(inFold(350, CLOSED)).toBe(false);
    expect(storedPoints(drawn(350, 600), CLOSED)).toEqual(drawn(350, 600));
  });
});
