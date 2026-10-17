/** layout.spec — page height, where a new note lands, and the five templates (#208). */
import { describe, expect, it } from 'vitest';

import {
  PAGE_MARGIN,
  PAGE_MIN_HEIGHT,
  exchangeShift,
  neighbourOf,
  pageHeight,
  placeNewItem,
  templatePaint,
} from './layout';
import { PAGE_WIDTH } from './page';

import type { Item, PageTemplate } from './page';

function box(id: string, x: number, y: number, w: number, h: number): Item {
  return { kind: 'text', id, x, y, w, h, z: 0, text: '' };
}

describe('pageHeight', () => {
  it('is at least A4 and always leaves paper under the lowest item', () => {
    expect(pageHeight([])).toBe(PAGE_MIN_HEIGHT);
    expect(pageHeight([box('a', 0, 2000, 10, 100)])).toBeGreaterThanOrEqual(2100 + 240);
  });
});

describe('placeNewItem', () => {
  it('takes the top-left corner of an empty page', () => {
    expect(placeNewItem([], 288, 72)).toEqual({ x: PAGE_MARGIN, y: PAGE_MARGIN });
  });

  it('never covers what is on the page and stays inside it', () => {
    const items = [
      box('ex', 48, 48, 864, 320),
      box('q1', 48, 392, 272, 140),
      box('q2', 344, 392, 272, 140),
    ];
    const at = placeNewItem(items, 288, 72);
    const placed = box('new', at.x, at.y, 288, 72);
    for (const i of items) {
      const apart =
        placed.x >= i.x + i.w ||
        placed.x + placed.w <= i.x ||
        placed.y >= i.y + i.h ||
        placed.y + placed.h <= i.y;
      expect(apart).toBe(true);
    }
    expect(at.x + 288).toBeLessThanOrEqual(PAGE_WIDTH - PAGE_MARGIN);
  });
});

describe('templatePaint', () => {
  const all: PageTemplate[] = ['blank', 'dot', 'lined', 'cornell', 'derivation'];

  it('draws five different pages, and a blank one with no layers', () => {
    const images = all.map((t) => templatePaint(t).backgroundImage);
    expect(new Set(images).size).toBe(5);
    expect(templatePaint('blank').backgroundImage).toBe('none');
  });

  it('uses the 24-unit dot grid of frame 05 and the notebook colour tokens', () => {
    expect(templatePaint('dot').backgroundSize).toBe('24px 24px');
    expect(templatePaint('cornell').backgroundImage).toContain('240px');
    for (const t of all.slice(1)) expect(templatePaint(t).backgroundImage).toMatch(/var\(--pt-nb-/);
  });
});

describe('exchangeShift (an open answer pushes the cards down)', () => {
  const exchange: Item = {
    kind: 'exchange',
    id: 'ex',
    x: 48,
    y: 48,
    w: 864,
    h: 320,
    z: 0,
    exchangeId: 'ex',
  };

  it('moves what sits below the exchange box by the height the answer outgrew it', () => {
    expect(exchangeShift([exchange], 930)).toEqual({ boundary: 368, extra: 610 });
    expect(exchangeShift([exchange], 300)).toEqual({ boundary: 368, extra: 0 });
    expect(exchangeShift([exchange], null)).toEqual({ boundary: 368, extra: 0 });
    expect(exchangeShift([box('a', 0, 0, 10, 10)], 930)).toBeNull();
  });
});

describe('neighbourOf (where the keyboard goes after a delete)', () => {
  const items = [box('b', 300, 100, 10, 10), box('a', 48, 100, 10, 10), box('c', 48, 400, 10, 10)];

  it('is the next item in reading order, else the previous, else none', () => {
    expect(neighbourOf(items, 'a')).toBe('b');
    expect(neighbourOf(items, 'c')).toBe('b');
    expect(neighbourOf([items[0] as Item], 'b')).toBeNull();
  });
});
