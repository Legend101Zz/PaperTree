/**
 * board/model/clip — when a card's body is cut off, and what the reader is offered (GAP-A3 §7).
 *
 * v0.1 cards scrolled their body inside a fixed box with no cue, so an AI card ended mid-sentence
 * and nothing said there was more. Now a body that does not fit shows a fade and a "more" control
 * that expands it in place, and an expanded body offers "less". Pure, so the rule is tested without
 * a layout engine.
 */

/** What the card shows at its foot. */
export interface ClipState {
  /** True while text is hidden below the fold: draw the fade. */
  readonly clipped: boolean;
  /** The control to offer: expand, collapse, or none when everything fits. */
  readonly control: 'more' | 'less' | null;
}

/** Sub-pixel rounding between `scrollHeight` and `clientHeight` is not "more text". */
const SLACK_PX = 2;

/**
 * The clip state of a card body.
 *
 * @param contentHeight The body's full height (`scrollHeight`).
 * @param boxHeight The height the card gives it (`clientHeight`).
 * @param expanded Whether the reader has expanded it.
 * @returns Whether to fade, and which control to show.
 * @example
 * clipState(480, 200, false); // { clipped: true, control: 'more' }
 */
export function clipState(contentHeight: number, boxHeight: number, expanded: boolean): ClipState {
  if (expanded) return { clipped: false, control: 'less' };
  const overflows = contentHeight - boxHeight > SLACK_PX;
  return { clipped: overflows, control: overflows ? 'more' : null };
}
