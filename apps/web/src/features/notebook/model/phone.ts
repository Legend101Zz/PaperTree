/**
 * The phone notebook's pure half (S5e, #210, frame 08c): the trace as the stack lists it (one
 * 44 px row per numbered quote card, "where · cited n×"), what of the page the stack shows below
 * the trace (your ink, stickies, typed notes, in reading order), and the box the view-only ink is
 * cropped to. The stack reads the page; it never moves anything on it.
 */
import { dehyphenate } from '@/lib/markdown';

import { strokeBounds } from './hitTest';
import { readingOrder } from './layout';
import { passageOfQuote } from './exchange';

import type { AnswerLayout } from './exchange';
import type { Item, QuoteItem, StickyItem, TextItem } from './page';
import type { Stroke } from './stroke';
import type { Citation } from '@/lib/api/types';
import type { TraceRowData } from '@papertree/ui';

/** One row of the phone's trace, and the quote card it opens in the paper. */
export interface PhoneTraceRow {
  readonly row: TraceRowData;
  readonly item: QuoteItem;
}

/**
 * The trace the phone lists: each numbered quote card as a row, in passage order, saying where it
 * sits (its citation's section, else its page) and how often the answer cites it.
 *
 * @param items - The page's items.
 * @param layout - The answer's layout (null while the thread is unread: no numbers, no rows).
 * @param citations - The answer's citations, for each passage's section.
 * @returns The rows, by passage number.
 */
export function phoneTrace(
  items: readonly Item[],
  layout: AnswerLayout | null,
  citations: readonly Citation[],
): PhoneTraceRow[] {
  if (layout === null) return [];
  const rows = items.flatMap((item) => {
    if (item.kind !== 'quote') return [];
    const p = passageOfQuote(layout, item.anchor);
    if (p === null) return [];
    const section = citations.find((c) => p.anchorIds.includes(c.anchor.id))?.locator
      ?.section_heading;
    const row: TraceRowData = {
      n: p.n,
      page: p.page,
      para: p.para,
      where: section ?? `p. ${String(p.page)}`,
      citedCount: p.cited,
      quote: dehyphenate(item.text).replace(/\s+/g, ' ').trim(),
      status: p.supported === false ? 'not-verified' : 'cited',
    };
    return [{ row, item }];
  });
  return rows.sort((a, b) => a.row.n - b.row.n);
}

/**
 * The person's own items the stack lists under the trace: stickies, then typed notes, each in the
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
