/**
 * reader/imageRegion — the rectangle the area tool draws, moves and resizes (v0.3 #348, items 2, 7).
 * Pure: every number is PDF points, origin top-left, the space of an IR bbox, so nothing here knows
 * the zoom or the DOM.
 *
 * A rectangle never leaves its page and never gets thinner than `MIN_SIDE`, whichever way it is
 * changed (a drag, a handle, an arrow key), so what the menu acts on is always something the API's
 * crop can render.
 */
import type { BBox } from '@papertree/document-ir';

/** The page's size, which bounds the rectangle. */
export interface PageSize {
  readonly width: number;
  readonly height: number;
}

/** The smallest side a rectangle may have, in points. A drag shorter than this was a click. */
export const MIN_SIDE = 12;
/** One arrow press moves or resizes by this many points; with Shift, by `BIG_STEP`. */
export const STEP = 4;
export const BIG_STEP = 24;

/** The eight handles, named by the compass point of the edge or corner they hold. */
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export const HANDLES: readonly Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** The arrow keys the rectangle answers to. */
export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/**
 * Is this key one the rectangle answers to?
 *
 * @param key A `KeyboardEvent.key`.
 * @returns True for the four arrows.
 */
export function isArrow(key: string): key is ArrowKey {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * The rectangle between two points, on the page.
 *
 * @param a One corner.
 * @param b The opposite corner.
 * @param page The page's size.
 * @returns A normalised box, clamped to the page.
 */
export function boxBetween(
  a: readonly [number, number],
  b: readonly [number, number],
  page: PageSize,
): BBox {
  const x0 = clamp(Math.min(a[0], b[0]), 0, page.width);
  const x1 = clamp(Math.max(a[0], b[0]), 0, page.width);
  const y0 = clamp(Math.min(a[1], b[1]), 0, page.height);
  const y1 = clamp(Math.max(a[1], b[1]), 0, page.height);
  return [x0, y0, x1, y1];
}

/**
 * Can this box be acted on: both sides at least `MIN_SIDE`?
 *
 * @param box The box.
 * @returns False for a click, or a sliver.
 */
export function isUsable(box: BBox): boolean {
  return box[2] - box[0] >= MIN_SIDE && box[3] - box[1] >= MIN_SIDE;
}

/**
 * Moves a box, keeping its size and keeping it on the page.
 *
 * @param box The box.
 * @param dx Points right.
 * @param dy Points down.
 * @param page The page's size.
 * @returns The moved box.
 */
export function moveBox(box: BBox, dx: number, dy: number, page: PageSize): BBox {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  const x = clamp(box[0] + dx, 0, Math.max(0, page.width - w));
  const y = clamp(box[1] + dy, 0, Math.max(0, page.height - h));
  return [x, y, x + w, y + h];
}

/**
 * Drags one handle: the edges it holds follow the pointer, the others stay.
 *
 * @param box The box.
 * @param handle Which handle.
 * @param dx Points right (negative: left).
 * @param dy Points down (negative: up).
 * @param page The page's size.
 * @returns The resized box; a handle never carries an edge past its opposite within `MIN_SIDE`.
 */
export function resizeBox(box: BBox, handle: Handle, dx: number, dy: number, page: PageSize): BBox {
  let [x0, y0, x1, y1] = box;
  if (handle.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN_SIDE);
  if (handle.includes('e')) x1 = clamp(x1 + dx, x0 + MIN_SIDE, page.width);
  if (handle.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN_SIDE);
  if (handle.includes('s')) y1 = clamp(y1 + dy, y0 + MIN_SIDE, page.height);
  return [x0, y0, x1, y1];
}

/**
 * What an arrow key does to the rectangle. Arrow: move. Alt+Arrow: resize from the bottom-right
 * corner (Right and Down grow it, Left and Up shrink it). Shift makes the step `BIG_STEP`.
 *
 * @param box The box.
 * @param key The arrow.
 * @param mods Shift and Alt as held.
 * @param mods.shift Whether Shift is held.
 * @param mods.alt Whether Alt (Option) is held.
 * @param page The page's size.
 * @returns The changed box.
 */
export function nudgeBox(
  box: BBox,
  key: ArrowKey,
  mods: { readonly shift: boolean; readonly alt: boolean },
  page: PageSize,
): BBox {
  const step = mods.shift ? BIG_STEP : STEP;
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
  return mods.alt ? resizeBox(box, 'se', dx, dy, page) : moveBox(box, dx, dy, page);
}

/**
 * A rectangle to start from when the tool is armed by keyboard, which has no drag: the middle of
 * the page, a third of its width and a fifth of its height.
 *
 * @param page The page's size.
 * @returns The box.
 */
export function starterBox(page: PageSize): BBox {
  const w = page.width / 3;
  const h = page.height / 5;
  const x = (page.width - w) / 2;
  const y = (page.height - h) / 2;
  return [x, y, x + w, y + h];
}
