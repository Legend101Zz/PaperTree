/**
 * The selection toolbar's placement (#203): the nearer margin when it is wide enough, else docked at
 * the top (or the bottom when the selection is under the top band), and never over a selected line.
 * Numbers are frame 04's: a 765 px page (612 pt at 125 %) in an 800 px column, type area 135-630.
 */
import { describe, expect, it } from 'vitest';

import {
  overlaps,
  placeToolbar,
  typeAreaOf,
  type PlacementInput,
  type Rect,
} from './toolbarPlacement';

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
});

/** Lines 14 px tall from `top`, `count` of them, across `left`-`right`. */
function lines(left: number, right: number, top: number, count: number): Rect[] {
  return Array.from({ length: count }, (_, i) =>
    rect(left, top + i * 16, right, top + i * 16 + 14),
  );
}

const BASE: PlacementInput = {
  typeArea: rect(135, 90, 630, 900),
  selection: lines(135, 630, 400, 2),
  toolbar: { width: 128, height: 250 },
  dockHeight: 48,
  viewport: rect(-17, 0, 783, 844),
};

describe('placeToolbar', () => {
  it('puts the toolbar in the right margin beside a full-width selection (frame 04)', () => {
    const placed = placeToolbar(BASE);
    expect(placed.kind).toBe('margin');
    if (placed.kind !== 'margin') return;
    expect(placed.side).toBe('right');
    expect(placed.rect.left).toBe(640); // the text's right edge + 10
    expect(placed.rect.top).toBe(400); // level with the first selected line
  });

  it('a full-width selection a few px off-centre still goes right (frame 04, measured live)', () => {
    const placed = placeToolbar({ ...BASE, selection: [rect(135, 400, 627, 414)] });
    expect(placed).toMatchObject({ kind: 'margin', side: 'right' });
  });

  it('chooses the nearer margin: a selection in the left column goes left when it fits', () => {
    const placed = placeToolbar({
      ...BASE,
      typeArea: rect(200, 90, 1000, 900),
      selection: lines(200, 560, 300, 3),
      viewport: rect(0, 0, 1200, 844),
    });
    expect(placed).toMatchObject({ kind: 'margin', side: 'left' });
    if (placed.kind === 'margin') expect(placed.rect.right).toBe(190);
  });

  it('docks at the top of the column when the nearer margin is narrower than the toolbar', () => {
    const placed = placeToolbar({ ...BASE, typeArea: rect(40, 90, 730, 900) });
    expect(placed).toMatchObject({ kind: 'docked', edge: 'top' });
    expect(placed.rect).toEqual(rect(7, 8, 759, 56));
  });

  it('never tries the far margin: a cramped near side docks even if the far side is wide', () => {
    const placed = placeToolbar({
      ...BASE,
      typeArea: rect(60, 90, 500, 900),
      selection: lines(60, 200, 300, 2),
    });
    expect(placed.kind).toBe('docked');
  });

  it('docks at the bottom when a selected line sits under the top band', () => {
    const placed = placeToolbar({
      ...BASE,
      typeArea: rect(40, 0, 730, 900),
      selection: lines(40, 730, 20, 2),
    });
    expect(placed).toMatchObject({ kind: 'docked', edge: 'bottom' });
  });

  it('keeps a margin toolbar on screen when the selection runs off the top or bottom', () => {
    const high = placeToolbar({ ...BASE, selection: lines(135, 630, -200, 3) });
    expect(high.rect.top).toBe(8);
    const low = placeToolbar({ ...BASE, selection: lines(135, 630, 800, 2) });
    expect(low.rect.bottom).toBe(836);
  });

  it('a selection reaching past the parsed type area moves the margin out with it', () => {
    const placed = placeToolbar({
      ...BASE,
      selection: lines(150, 640, 300, 1),
      viewport: rect(-17, 0, 800, 844),
    });
    expect(placed).toMatchObject({ kind: 'margin', side: 'right' });
    if (placed.kind === 'margin') expect(placed.rect.left).toBe(650);
  });

  it('without a parse the selection itself is the text', () => {
    const placed = placeToolbar({ ...BASE, typeArea: null, selection: lines(135, 600, 300, 2) });
    expect(placed).toMatchObject({ kind: 'margin', side: 'right' });
    if (placed.kind === 'margin') expect(placed.rect.left).toBe(610);
  });

  it('never overlaps any selected line (randomised, whenever a band is free)', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    let checked = 0;
    let margins = 0;
    for (let run = 0; run < 2000; run += 1) {
      const width = 400 + random() * 1100;
      const viewport = rect(0, 0, width, 500 + random() * 500);
      const left = random() * width * 0.4;
      const right = left + 100 + random() * (width - left - 100);
      const typeArea = rect(left, 0, right, 2000);
      const count = 1 + Math.floor(random() * 30);
      const top = -100 + random() * (viewport.bottom + 100);
      const x0 = left + random() * (right - left) * 0.5;
      const selection = lines(x0, x0 + random() * (right - x0), top, count);
      const input: PlacementInput = { ...BASE, typeArea, selection, viewport };
      const placed = placeToolbar(input);
      const bandsCovered =
        selection.some((l) => l.top < 56 && l.bottom > 8) &&
        selection.some((l) => l.bottom > viewport.bottom - 56 && l.top < viewport.bottom - 8);
      if (bandsCovered) continue;
      checked += 1;
      if (placed.kind === 'margin') margins += 1;
      for (const line of selection) expect(overlaps(placed.rect, line)).toBe(false);
    }
    // Not vacuous: most cases are checked, and both forms are exercised.
    expect(checked).toBeGreaterThan(1500);
    expect(margins).toBeGreaterThan(200);
    expect(checked - margins).toBeGreaterThan(200);
  });
});

describe('typeAreaOf', () => {
  it('is the union of the running text, without the margin stamp or the page number', () => {
    const area = typeAreaOf([
      { type: 'paragraph', bbox: [124, 73, 488, 113] },
      { type: 'abstract', bbox: [144, 413, 470, 576] },
      { type: 'footer', bbox: [108, 733, 460, 742] },
      { type: 'margin_note', bbox: [11, 214, 38, 555] },
      { type: 'page_number', bbox: [300, 750, 310, 760] },
    ]);
    expect(area).toEqual([124, 73, 488, 576]);
  });

  it('is null for a page with no text blocks', () => {
    expect(typeAreaOf([{ type: 'margin_note', bbox: [11, 214, 38, 555] }])).toBeNull();
  });
});
