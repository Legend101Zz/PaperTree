/**
 * Where the selection toolbar goes (#203, DESIGN.md §1 "Reader": "opens in the page margin or docks
 * at the top of the reader column, never over the lines being read"). Pure: every rectangle is in
 * one coordinate space (the scroller's content px), measured by the caller from the IR, not the DOM.
 */

/** An axis-aligned box. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * What `placeToolbar` needs; all rectangles in the same space. The page's margins are what lies
 * between its type area and the visible column's edge (the desk beside a narrow page counts).
 */
export interface PlacementInput {
  /** The page's type area (its running text, without margin stamps), or null without a parse. */
  readonly typeArea: Rect | null;
  /** The selected lines on that page. */
  readonly selection: readonly Rect[];
  /** The toolbar's size as it stands in a margin (a column of buttons). */
  readonly toolbar: { readonly width: number; readonly height: number };
  /** The docked bar's height. */
  readonly dockHeight: number;
  /** The visible part of the reader column. */
  readonly viewport: Rect;
}

/** The answer: beside the selection in a margin, or docked across the column. */
export type Placement =
  | { readonly kind: 'margin'; readonly side: 'left' | 'right'; readonly rect: Rect }
  | { readonly kind: 'docked'; readonly edge: 'top' | 'bottom'; readonly rect: Rect };

/** Space kept between the toolbar and the text, and between the toolbar and the column's edge. */
export const TOOLBAR_GAP = 10;
export const TOOLBAR_EDGE = 8;
/** The docked bar's inset from the column's sides (frame 07a: 24 px). */
export const DOCK_INSET = 24;

/** Block types outside the running text: they set no margin (the arXiv stamp sits in one). */
const NOT_TYPE_AREA = new Set(['margin_note', 'page_number', 'header', 'footer']);

/**
 * Do two boxes share any area?
 *
 * @param a - One box.
 * @param b - The other.
 * @returns True when they overlap (touching edges do not count).
 */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * The smallest box holding all the given boxes.
 *
 * @param rects - Boxes in one space.
 * @returns Their union, or null for none.
 */
export function unionOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
}

/**
 * A page's type area from its parsed blocks, in IR points: the union of every block that is part
 * of the running text. Margin notes, running heads and page numbers are left out.
 *
 * @param blocks - The page's blocks (`IndexedDocument.byPage`), each with its type and IR bbox.
 * @returns `[x0, y0, x1, y1]`, or null when the page has no text blocks.
 */
export function typeAreaOf(
  blocks: readonly { readonly type: string; readonly bbox: readonly number[] }[],
): readonly [number, number, number, number] | null {
  const boxes = blocks
    .filter((b) => !NOT_TYPE_AREA.has(b.type) && b.bbox.length === 4)
    .map((b) => ({
      left: b.bbox[0] ?? 0,
      top: b.bbox[1] ?? 0,
      right: b.bbox[2] ?? 0,
      bottom: b.bbox[3] ?? 0,
    }));
  const area = unionOf(boxes);
  return area === null ? null : [area.left, area.top, area.right, area.bottom];
}

function marginRect(input: PlacementInput, side: 'left' | 'right', text: Rect): Rect | null {
  const { toolbar, viewport, selection } = input;
  const from = side === 'right' ? text.right + TOOLBAR_GAP : viewport.left + TOOLBAR_EDGE;
  const to = side === 'right' ? viewport.right - TOOLBAR_EDGE : text.left - TOOLBAR_GAP;
  if (to - from < toolbar.width) return null;
  const left = side === 'right' ? from : to - toolbar.width;
  const first = unionOf(selection);
  // Level with the selection's first line, kept on screen.
  const lowest = viewport.bottom - TOOLBAR_EDGE - toolbar.height;
  const top = Math.max(viewport.top + TOOLBAR_EDGE, Math.min(first?.top ?? 0, lowest));
  return { left, top, right: left + toolbar.width, bottom: top + toolbar.height };
}

function dockRect(input: PlacementInput, edge: 'top' | 'bottom'): Rect {
  const { viewport, dockHeight } = input;
  const top =
    edge === 'top' ? viewport.top + TOOLBAR_EDGE : viewport.bottom - TOOLBAR_EDGE - dockHeight;
  return {
    left: viewport.left + DOCK_INSET,
    top,
    right: viewport.right - DOCK_INSET,
    bottom: top + dockHeight,
  };
}

/**
 * Place the selection toolbar.
 *
 * 1. In the NEARER margin of the type area: the left one only when the selection sits clearly in
 *    the left part of the text (a left column; its centre left of the text's middle by a tenth of
 *    its width), else the right, as frame 04 draws it for a full-width selection. Only when the
 *    space between the text and the column's visible edge is at least the toolbar's width. Level
 *    with the selection's first line, clamped to the visible column.
 * 2. Otherwise docked across the top of the column; at the bottom instead when a selected line is
 *    under the top band.
 *
 * Whatever it returns never overlaps a selected line, unless the selection covers both bands of the
 * visible column (a selection taller than the screen), when the top band is the answer.
 *
 * @param input - The type area, the selected lines, the toolbar and the visible column.
 * @returns Where the toolbar goes, with its box in the same space.
 * @example
 * placeToolbar({ typeArea, selection, toolbar: { width: 128, height: 260 }, dockHeight: 48, viewport })
 */
export function placeToolbar(input: PlacementInput): Placement {
  const selected = unionOf(input.selection);
  const free = (rect: Rect): boolean => !input.selection.some((line) => overlaps(rect, line));
  if (selected !== null) {
    const text = unionOf(input.typeArea === null ? [selected] : [input.typeArea, selected]);
    if (text !== null) {
      const centre = (selected.left + selected.right) / 2;
      const middle = (text.left + text.right) / 2;
      const nearer = centre < middle - (text.right - text.left) / 10 ? 'left' : 'right';
      const rect = marginRect(input, nearer, text);
      if (rect !== null && free(rect)) return { kind: 'margin', side: nearer, rect };
    }
  }
  const top = dockRect(input, 'top');
  if (free(top)) return { kind: 'docked', edge: 'top', rect: top };
  const bottom = dockRect(input, 'bottom');
  if (free(bottom)) return { kind: 'docked', edge: 'bottom', rect: bottom };
  return { kind: 'docked', edge: 'top', rect: top };
}
