/**
 * How big a Mermaid figure is drawn in the room it has (v0.3 W6). Scaling a wide diagram down to
 * the panel made its text unreadable (28 of 91 round-1 figures were wider than 2.2x the 520 px
 * panel; a 3,290 px timeline became ~16% size), so the figure fits the room only down to
 * `MIN_SCALE`; wider than that it keeps that scale and scrolls sideways inside its own box, with
 * a fade at the edge it scrolls toward and the "larger" button for the natural size. Pure.
 */

/** The smallest scale a figure is shown at (1 = the size Mermaid drew it). */
export const MIN_SCALE = 0.7;

/**
 * A room narrower than this (a board card's ~290 px body) shows the whole drawing as a preview
 * instead of holding `MIN_SCALE` and scrolling sideways.
 */
export const NARROW_ROOM = 380;

/** What a figure's box needs to know. */
export interface Fit {
  /** The scale applied to the natural size, `MIN_SCALE`..1. */
  readonly scale: number;
  /** The drawn width in px. */
  readonly width: number;
  /** True when the drawn width is wider than the room: the figure scrolls sideways. */
  readonly scrolls: boolean;
}

/**
 * The drawn size of a figure in its room.
 *
 * @param natural The drawing's natural width in px (its viewBox).
 * @param room The width the figure has, in px; 0 or less means not measured yet (drawn at natural size).
 * @param large The reader asked for the natural size.
 * @param narrow A narrow room (a board card): the whole drawing fits the width, with no minimum
 *   scale and no sideways scroll (a preview; "larger" shows the natural size).
 * @returns The scale, the drawn width and whether it scrolls.
 */
export function fitFigure(natural: number, room: number, large: boolean, narrow = false): Fit {
  if (!(natural > 0)) return { scale: 1, width: 0, scrolls: false };
  if (large) return { scale: 1, width: natural, scrolls: room > 0 && natural > room + 0.5 };
  const wanted = room > 0 ? room / natural : 1;
  const scale = narrow ? Math.min(1, wanted) : Math.min(1, Math.max(MIN_SCALE, wanted));
  const width = Math.round(natural * scale);
  return { scale, width, scrolls: room > 0 && width > room + 0.5 };
}
