/**
 * When a press on painted highlight text opens its card (#176). The highlight layer is not a pointer
 * target (a drag that starts on highlighted words must still select them), so `SourcePane` decides
 * from the press itself whether it was a click or a drag. Pure, so the rule is tested on its own.
 */

/**
 * How far a press may travel and still be a click, in CSS px. A hand click moves a pixel or more
 * between down and up; over a glyph boundary, 4 px was enough to select "o" (measured on Attention
 * p. 4 in Chromium), which used to swallow the click. Platform drag thresholds are 3-5 px.
 */
export const CLICK_SLOP_PX = 5;

/** A press as the reader's click listener saw it. */
export interface Press {
  readonly down: { readonly x: number; readonly y: number } | null;
  readonly up: { readonly x: number; readonly y: number };
  /** `MouseEvent.detail`: 2 and 3 are double and triple clicks, which select a word or a line. */
  readonly detail: number;
  /** Shift extends the selection. */
  readonly shiftKey: boolean;
}

/**
 * THE HIT-TESTING RULE: a press opens the highlight under it when it is a single, unshifted click
 * that travelled at most `CLICK_SLOP_PX` (any characters the browser selected on the way are the
 * hand's jitter, not a selection, and are cleared). Anything that moved further is a drag and
 * selects text as usual; a double or triple click selects a word or a line; Shift extends.
 * Whether the point is ON a highlight is the stored-quad test (`hitsItem`), run after this one.
 *
 * @param press - The press, from pointerdown to click.
 * @returns True when the press should open the highlight under it.
 * @example
 * isHighlightClick({ down: { x: 10, y: 10 }, up: { x: 13, y: 11 }, detail: 1, shiftKey: false }) // true
 */
export function isHighlightClick(press: Press): boolean {
  if (press.detail > 1 || press.shiftKey) return false;
  // A click with no recorded press (keyboard-synthesised, or the press began outside the pages)
  // travelled nowhere.
  if (press.down === null) return true;
  const moved = Math.hypot(press.up.x - press.down.x, press.up.y - press.down.y);
  return moved <= CLICK_SLOP_PX;
}
