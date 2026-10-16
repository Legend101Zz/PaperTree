/**
 * The selection toolbar's placement (#203): the nearer margin when it is wide enough, else docked at
 * the top (or the bottom when the selection is under the top band), and never over a selected line.
 * Numbers are frame 04's: a 765 px page (612 pt at 125 %) in an 800 px column, type area 135-630.
 */
import { describe, expect, it } from 'vitest';

import {
  overlaps,
  placeToolbar,
  selectionLines,
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

describe('the measured bar (review B1)', () => {
  // The reviewer's case: drawer open, Split, Fit width: a narrow column where no margin fits and the
  // docked bar wraps to 84 px. The selected line sits 62-68 px under the column top.
  const narrow: PlacementInput = {
    ...BASE,
    typeArea: rect(20, 0, 380, 900),
    selection: [rect(87, 62, 309, 68)],
    viewport: rect(0, 0, 400, 800),
  };

  it('a one-row guess (52 px) would clear the line, so the bar stays at the top', () => {
    expect(placeToolbar({ ...narrow, dockHeight: 52 })).toMatchObject({ edge: 'top' });
  });

  it('the measured 84 px bar would cover it, so the bar goes to the bottom', () => {
    const placed = placeToolbar({ ...narrow, dockHeight: 84 });
    expect(placed).toMatchObject({ kind: 'docked', edge: 'bottom' });
    expect(overlaps(placed.rect, narrow.selection[0]!)).toBe(false);
  });

  it('a margin bar is clamped by its measured height', () => {
    const tall = placeToolbar({
      ...BASE,
      selection: lines(135, 630, 800, 2),
      toolbar: { width: 126, height: 400 },
    });
    expect(tall.rect.bottom).toBe(836);
  });
});

describe('a selection across a page break (review B2)', () => {
  const geometry = {
    pageBox: (page: number) => ({ left: 0, top: page * 1000 }),
    irScale: () => 1,
  };
  const across = {
    pageIndex: 0,
    irQuads: [[135, 978, 576, 992]],
    irExtent: [135, 978, 576, 992],
    endPageIndex: 1,
    endQuads: [
      [135, 80, 630, 94],
      [135, 96, 630, 110],
    ],
    endExtent: [135, 80, 630, 110],
  };

  it("brings the first page's lines too, and goes by the last page", () => {
    const got = selectionLines(across, geometry, () => [100, 50, 650, 950]);
    expect(got?.lines).toHaveLength(3);
    expect(got?.lines[0]).toEqual(rect(135, 978, 576, 992));
    expect(got?.page).toBe(1);
    expect(got?.levelWith).toBe(1080);
    expect(got?.typeArea).toEqual(rect(100, 1050, 650, 1950));
  });

  it("the docked bar clears the first page's line under the column top", () => {
    const got = selectionLines(across, geometry);
    if (got === null) throw new Error('no lines');
    const placed = placeToolbar({
      typeArea: rect(20, 0, 380, 3000),
      selection: got.lines,
      levelWith: got.levelWith,
      toolbar: { width: 130, height: 250 },
      dockHeight: 52,
      viewport: rect(0, 954, 400, 1754),
    });
    expect(placed.kind).toBe('docked');
    for (const line of got.lines) expect(overlaps(placed.rect, line)).toBe(false);
  });

  it('one page: the first page alone, level with its first line', () => {
    const one = {
      ...across,
      endPageIndex: 0,
      endQuads: across.irQuads,
      endExtent: across.irExtent,
    };
    const got = selectionLines(one, geometry);
    expect(got?.lines).toHaveLength(1);
    expect(got?.levelWith).toBe(978);
  });
});
