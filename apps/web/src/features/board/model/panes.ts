/**
 * board/model/panes — geometry that depends on the PANE the board sits in, never the page (the split
 * view embeds the same board in half the window): where the span menu goes so it stays inside, and
 * the view that centres a card and its open ask box (#342, #349). Pure.
 */

/** A box in px. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where a floating menu sits, and which way it went. */
export interface MenuPlace {
  readonly left: number;
  readonly top: number;
  /** True when it opened above the words because there was no room below. */
  readonly flipped: boolean;
}

/** The air kept between a menu and the pane's edge, and between a menu and its words. */
export const MENU_MARGIN = 8;

/**
 * Places a menu beside some selected words, inside the pane: below the last line by default, above
 * when that does not fit, and shifted sideways rather than cut off at either edge.
 *
 * @param anchor The last line of the selected words, in the pane's coordinates.
 * @param menu The menu's size.
 * @param menu.w Its width.
 * @param menu.h Its height.
 * @param pane The pane's size (its own origin is 0, 0).
 * @param pane.w Its width.
 * @param pane.h Its height.
 * @returns The menu's top-left corner in the pane's coordinates.
 */
export function placeMenu(
  anchor: Box,
  menu: { readonly w: number; readonly h: number },
  pane: { readonly w: number; readonly h: number },
): MenuPlace {
  const below = anchor.y + anchor.h + MENU_MARGIN;
  const above = anchor.y - MENU_MARGIN - menu.h;
  const fitsBelow = below + menu.h <= pane.h - MENU_MARGIN;
  const flipped = !fitsBelow && above >= MENU_MARGIN;
  const rawTop = flipped ? above : below;
  const top = Math.max(MENU_MARGIN, Math.min(rawTop, pane.h - menu.h - MENU_MARGIN));
  const rawLeft = anchor.x + anchor.w - menu.w;
  const left = Math.max(MENU_MARGIN, Math.min(rawLeft, pane.w - menu.w - MENU_MARGIN));
  return { left, top, flipped };
}

/** The part of the board in view: a pan and a zoom. */
export interface View {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** The smallest the arrival zooms to, so a card is readable when the board arrives on it. */
export const ARRIVAL_MIN_ZOOM = 0.6;

/**
 * The view that puts a set of boxes (a card and its open ask box, as a pair) in the middle of the
 * pane. A pair taller than the pane lines its top up under a margin instead, so a card never opens
 * with its first words above the fold.
 *
 * @param boxes The boxes to centre, in board coordinates.
 * @param pane The pane's size in px.
 * @param pane.w Its width.
 * @param pane.h Its height.
 * @param zoom The zoom the board is at now.
 * @returns The view.
 */
export function viewToCentre(
  boxes: readonly Box[],
  pane: { readonly w: number; readonly h: number },
  zoom: number,
): View {
  const z = Math.min(1, Math.max(ARRIVAL_MIN_ZOOM, zoom));
  if (boxes.length === 0) return { x: 0, y: 0, zoom: z };
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const centreX = (left + right) / 2;
  const centreY = (top + bottom) / 2;
  const tooTall = (bottom - top) * z > pane.h - 2 * MENU_MARGIN * 2;
  return {
    x: Math.round(pane.w / 2 - centreX * z),
    y: Math.round(tooTall ? MENU_MARGIN * 3 - top * z : pane.h / 2 - centreY * z),
    zoom: z,
  };
}

/** A dropped passage's footprint is drawn this wide: a passage card's width. */
export const FOOTPRINT_WIDTH = 304;
/** A dropped picture's footprint: an image card is a picture and a caption, about this tall. */
export const IMAGE_FOOTPRINT_HEIGHT = 200;
/** About how many characters fit on a line of a passage card, and how tall a line and the strip are. */
const CHARS_PER_LINE = 45;
const LINE_HEIGHT = 18;
const CARD_CHROME = 50;

/**
 * How tall the card of a dropped passage will be, for the dashed footprint (an estimate: the card
 * is measured once it lands, so it can be a line off).
 *
 * @param characters The passage's length.
 * @param cap The tallest a card grows (60% of the pane).
 * @returns The footprint's height in px.
 */
export function footprintHeight(characters: number, cap: number): number {
  const lines = Math.ceil((characters + 2) / CHARS_PER_LINE);
  return Math.min(cap, CARD_CHROME + lines * LINE_HEIGHT);
}

/**
 * How far a floating box (a picker, a menu) must move to sit wholly inside the pane: shifted
 * sideways and up or down rather than cut off at an edge (#349). A box larger than the pane lines
 * its top-left up under the margin.
 *
 * @param box The box, in the pane's coordinates.
 * @param pane The pane's size (its own origin is 0, 0).
 * @param pane.w Its width.
 * @param pane.h Its height.
 * @param margin The air kept between the box and the pane's edge.
 * @returns The move in px, `{ dx: 0, dy: 0 }` when it already fits.
 */
export function shiftInto(
  box: Box,
  pane: { readonly w: number; readonly h: number },
  margin: number = MENU_MARGIN,
): { readonly dx: number; readonly dy: number } {
  const along = (start: number, size: number, room: number): number => {
    if (size > room - 2 * margin || start < margin) return margin - start;
    const end = start + size;
    return end > room - margin ? room - margin - end : 0;
  };
  return { dx: along(box.x, box.w, pane.w), dy: along(box.y, box.h, pane.h) };
}
