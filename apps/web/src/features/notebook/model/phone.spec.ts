/**
 * phone.spec — the phone stack's pure half (S5e, #210, frame 08c): the person's notes in reading
 * order, and the crop of the view-only ink.
 */
import { describe, expect, it } from 'vitest';

import { inkCrop, phoneNotes } from './phone';

import type { Item, QuoteItem } from './page';
import type { Stroke } from './stroke';
import type { Anchor } from '@papertree/anchoring';

const anchor = (id: string): Anchor => ({ id, selectors: [] }) as unknown as Anchor;

const quote = (id: string, anchorId: string, y: number, text: string): QuoteItem => ({
  id,
  kind: 'quote',
  x: 48,
  y,
  w: 272,
  h: 140,
  z: 1,
  anchor: anchor(anchorId),
  text,
});

describe('phoneNotes', () => {
  it('splits the person’s items into stickies and typed notes, each in reading order', () => {
    const note = (id: string, kind: 'text' | 'sticky', y: number): Item =>
      ({ id, kind, x: 0, y, w: 100, h: 40, z: 0, text: id }) as Item;
    const { stickies, notes } = phoneNotes([
      note('t2', 'text', 500),
      note('s1', 'sticky', 100),
      quote('q', 'a1', 50, 'q'),
      note('t1', 'text', 200),
    ]);
    expect(stickies.map((i) => i.id)).toEqual(['s1']);
    expect(notes.map((i) => i.id)).toEqual(['t1', 't2']);
  });
});

describe('inkCrop', () => {
  const stroke = (xy: [number, number][]): Stroke => ({
    id: `sk_${String(xy.length)}`,
    tool: 'pen',
    nib: 'F',
    color: 'pen',
    hasPressure: false,
    points: xy.map(([x, y]) => [x, y, 0.5] as const),
  });

  it('crops to every stroke, nib and margin included', () => {
    const crop = inkCrop([
      stroke([
        [100, 400],
        [200, 420],
      ]),
      stroke([[150, 380]]),
    ])!;
    expect(crop.x).toBeLessThan(100 - 8);
    expect(crop.y).toBeLessThan(380 - 8);
    expect(crop.x + crop.width).toBeGreaterThan(200 + 8);
    expect(crop.y + crop.height).toBeGreaterThan(420 + 8);
    expect(crop.width).toBeLessThan(140);
  });

  it('is null without ink, so the strip is not drawn', () => {
    expect(inkCrop([])).toBeNull();
  });
});
