/**
 * board/model/cards — what each index card shows, built from server data only (frame 06).
 *
 * Pure: no React, no fetch. Every number a card prints comes from a field the API returned (an
 * anchor's page, a notebook card's `counts`, a message's `run`); when the field is
 * absent the builder returns null and the card shows nothing in its place, never a made-up figure.
 * An answer's citations come with the board read (`CanvasNode.citations`), never a thread scan.
 */
import { PAGE_WIDTH } from '@/features/notebook';

import type { Anchor } from '@papertree/anchoring';
import type { NotebookItemBox } from '../api/notebook';
import type { CanvasNode } from '@/lib/api/types';

/**
 * The 0-based page a stored anchor points at: its PageSelector, else its ShapeSelector.
 *
 * The paragraph number of a frame-06 tab ("¶1") is NOT in an anchor: the server derives it from
 * the parse on read for citations only (`PassageLocator`), so a passage card's tab shows the page.
 *
 * @param anchor The card's `source_anchor`, or null.
 * @returns The page index, or null when the anchor names none.
 */
export function anchorPageIndex(anchor: Anchor | null): number | null {
  if (anchor === null) return null;
  let shape: number | null = null;
  for (const selector of anchor.selectors) {
    if (selector.type === 'PageSelector') return selector.index;
    if (selector.type === 'ShapeSelector') shape ??= selector.pageIndex;
  }
  return shape;
}

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * A notebook card's counts line, e.g. "4 quotes · 1 sticky": the non-zero parts, in page order.
 *
 * @param counts The card's `counts` from the board read, or null.
 * @returns The line, "Empty page" when every count is zero, or null when there are no counts.
 */
export function countsLine(counts: CanvasNode['counts']): string | null {
  if (counts === null) return null;
  const parts = [
    [counts.quotes, 'quote', 'quotes'],
    [counts.stickies, 'sticky', 'stickies'],
    [counts.text, 'typed note', 'typed notes'],
    [counts.shapes, 'shape', 'shapes'],
    [counts.strokes, 'ink stroke', 'ink strokes'],
  ] as const;
  const shown = parts.filter(([n]) => n > 0).map(([n, one, many]) => plural(n, one, many));
  return shown.length === 0 ? 'Empty page' : shown.join(' · ');
}

/** One item of a notebook page drawn in the card's miniature, in miniature pixels. */
export interface MiniatureBox {
  readonly id: string;
  readonly kind: NotebookItemBox['kind'];
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A notebook page's items scaled into a miniature `width` × `height`: the page is `PAGE_WIDTH`
 * units wide, so one factor maps both axes. Items wholly below the miniature are left out.
 *
 * @param items The page's items.
 * @param width The miniature's width in pixels.
 * @param height The miniature's height in pixels.
 * @returns The boxes, lowest `z` first.
 */
export function miniature(
  items: readonly NotebookItemBox[],
  width: number,
  height: number,
): MiniatureBox[] {
  const k = width / PAGE_WIDTH;
  return [...items]
    .sort((a, b) => a.z - b.z)
    .map((item) => ({
      id: item.item_id,
      kind: item.kind,
      left: item.x * k,
      top: item.y * k,
      width: Math.max(2, item.w * k),
      height: Math.max(2, item.h * k),
    }))
    .filter((box) => box.top < height);
}
