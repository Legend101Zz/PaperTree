import { describe, expect, it } from 'vitest';

import {
  ARRIVAL_MIN_ZOOM,
  MENU_MARGIN,
  footprintHeight,
  placeMenu,
  REVEAL_MARGIN,
  shiftInto,
  viewToReveal,
  viewToCentre,
} from './panes';

const MENU = { w: 200, h: 180 };
const PANE = { w: 700, h: 500 };

describe('placeMenu: the span menu stays inside its pane (#349)', () => {
  it('opens below the last line of the words, its right edge level with theirs', () => {
    const place = placeMenu({ x: 300, y: 100, w: 80, h: 18 }, MENU, PANE);
    expect(place).toEqual({ left: 300 + 80 - 200, top: 100 + 18 + MENU_MARGIN, flipped: false });
  });

  it('flips above the words when there is no room below', () => {
    const place = placeMenu({ x: 300, y: 400, w: 80, h: 18 }, MENU, PANE);
    expect(place.flipped).toBe(true);
    expect(place.top).toBe(400 - MENU_MARGIN - 180);
  });

  it('shifts sideways rather than leave the pane at either edge', () => {
    expect(placeMenu({ x: 0, y: 100, w: 20, h: 18 }, MENU, PANE).left).toBe(MENU_MARGIN);
    expect(placeMenu({ x: 690, y: 100, w: 40, h: 18 }, MENU, PANE).left).toBe(
      700 - 200 - MENU_MARGIN,
    );
  });

  it('never leaves the pane vertically even in a pane too short to flip in', () => {
    const place = placeMenu({ x: 100, y: 90, w: 40, h: 18 }, MENU, { w: 700, h: 200 });
    expect(place.top).toBeGreaterThanOrEqual(MENU_MARGIN);
    expect(place.top + 180).toBeLessThanOrEqual(200 - MENU_MARGIN + 180);
  });
});

describe('viewToCentre: the arrival (#342)', () => {
  it('puts a card and its ask box, as a pair, in the middle of the pane', () => {
    const card = { x: 100, y: 100, w: 300, h: 200 };
    const box = { x: 100, y: 320, w: 300, h: 100 };
    const view = viewToCentre([card, box], PANE, 1);
    // The pair spans y 100..420 and x 100..400: its middle (250, 260) lands at the pane's (350, 250).
    expect(view).toEqual({ x: 100, y: -10, zoom: 1 });
  });

  it('keeps the zoom between the arrival minimum and 1', () => {
    expect(viewToCentre([{ x: 0, y: 0, w: 10, h: 10 }], PANE, 3).zoom).toBe(1);
    expect(viewToCentre([{ x: 0, y: 0, w: 10, h: 10 }], PANE, 0.1).zoom).toBe(ARRIVAL_MIN_ZOOM);
  });

  it('lines the top up under a margin when the pair is taller than the pane', () => {
    const view = viewToCentre([{ x: 0, y: 50, w: 300, h: 900 }], PANE, 1);
    expect(view.y).toBe(MENU_MARGIN * 3 - 50);
  });
});

describe('viewToReveal: an ask box that opened out of view', () => {
  const view = { x: 0, y: 0, zoom: 1 };

  it('is null for a box wholly in view', () => {
    expect(viewToReveal({ x: 100, y: 100, w: 300, h: 100 }, view, PANE)).toBeNull();
  });

  it('pans up, by the least, for a box below the fold, and keeps the zoom', () => {
    const next = viewToReveal({ x: 100, y: 450, w: 300, h: 120 }, view, PANE);
    expect(next).toEqual({ x: 0, y: -(450 + 120 - (500 - REVEAL_MARGIN)), zoom: 1 });
  });

  it('pans sideways for a box beside the card that lies off to the right', () => {
    const next = viewToReveal({ x: 600, y: 100, w: 300, h: 100 }, view, PANE);
    expect(next).toEqual({ x: -(900 - (700 - REVEAL_MARGIN)), y: 0, zoom: 1 });
  });

  it('reads the box through the zoom and the pan', () => {
    // at 50% and panned 200 px left, a box at board x 800..1100 is at 200..350 px: in view
    expect(
      viewToReveal({ x: 800, y: 100, w: 300, h: 100 }, { x: -200, y: 0, zoom: 0.5 }, PANE),
    ).toBeNull();
  });
});

describe('the drop footprint', () => {
  it('is as tall as the card will be for its words, capped at 60% of the pane', () => {
    expect(footprintHeight(0, 500)).toBe(68);
    expect(footprintHeight(180, 500)).toBeGreaterThan(footprintHeight(45, 500));
    expect(footprintHeight(5000, 300)).toBe(300);
  });
});

describe('shiftInto: a picker stays inside the pane (#349)', () => {
  const pane = { w: 700, h: 500 };
  it('leaves a box that fits alone', () => {
    expect(shiftInto({ x: 100, y: 100, w: 300, h: 200 }, pane)).toEqual({ dx: 0, dy: 0 });
  });
  it('shifts a box cut off at the right or the bottom back inside, with the margin', () => {
    expect(shiftInto({ x: 500, y: 400, w: 300, h: 200 }, pane)).toEqual({
      dx: 700 - MENU_MARGIN - 800,
      dy: 500 - MENU_MARGIN - 600,
    });
  });
  it('shifts a box cut off at the left or the top back inside', () => {
    expect(shiftInto({ x: -40, y: -10, w: 300, h: 200 }, pane)).toEqual({
      dx: MENU_MARGIN + 40,
      dy: MENU_MARGIN + 10,
    });
  });
  it('lines a box bigger than the pane up under the margin', () => {
    expect(shiftInto({ x: 300, y: 50, w: 900, h: 700 }, pane)).toEqual({
      dx: MENU_MARGIN - 300,
      dy: MENU_MARGIN - 50,
    });
  });
});
