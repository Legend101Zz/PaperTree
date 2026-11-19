/**
 * The phone notebook's pure half (S5e, #210, frame 08c): what of the page the stack shows below
 * the answer (your ink, stickies, typed notes, in reading order), and the box the view-only ink is
 * cropped to. The stack reads the page; it never moves anything on it.
 */
import { strokeBounds } from './hitTest';
import { readingOrder } from './layout';

import type { Item, StickyItem, TextItem } from './page';
import type { Stroke } from './stroke';

/**
 * The person's own items the stack lists under the answer: stickies, then typed notes, each in the
 * page's reading order (frame 08c: the stickies sit beside the ink, the notes run full width).
 *
 * @param items - The page's items.
 * @returns The stickies and the typed notes.
 */
export function phoneNotes(items: readonly Item[]): {
  stickies: (StickyItem | TextItem)[];
  notes: (StickyItem | TextItem)[];
} {
  const own = [...items]
    .sort(readingOrder)
    .filter((i): i is StickyItem | TextItem => i.kind === 'sticky' || i.kind === 'text');
  return {
    stickies: own.filter((i) => i.kind === 'sticky'),
    notes: own.filter((i) => i.kind === 'text'),
  };
}

/** A box in page units. */
export interface InkCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The box the phone's view-only ink is cropped to: every stroke, nib included, with a margin.
 *
 * @param strokes - The page's strokes.
 * @param margin - Page units around the ink.
 * @returns The box, or null when there is no ink.
 */
export function inkCrop(strokes: readonly Stroke[], margin = 8): InkCrop | null {
  if (strokes.length === 0) return null;
  const bs = strokes.map(strokeBounds);
  const x0 = Math.min(...bs.map((b) => b.x0)) - margin;
  const y0 = Math.min(...bs.map((b) => b.y0)) - margin;
  const x1 = Math.max(...bs.map((b) => b.x1)) + margin;
  const y1 = Math.max(...bs.map((b) => b.y1)) + margin;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
