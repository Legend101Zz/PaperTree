/**
 * The phone explain sheet's rules (#205, frame 08b, DESIGN.md §10), pure: how much of an answer the
 * sheet shows before "Read the whole answer", and which answer's usage and actions the pinned
 * footer carries. The 44 px marker target is `hitOutset` in `@papertree/ui` (the marker draws it).
 */
import type { AnswerModel, AnswerParagraph } from './answer';

/** What the sheet shows of one answer. */
export interface AnswerClip {
  readonly body: readonly AnswerParagraph[];
  readonly uncited: readonly AnswerParagraph[];
  /** Something is hidden: the slip offers "Read the whole answer". */
  readonly clipped: boolean;
}

/**
 * The paragraphs the sheet draws: the answer's first paragraph only (cited or the AI's own
 * reading) until the reader asks for the rest, so the trace is in reach without a long scroll.
 * An answer of one paragraph is never clipped: there would be nothing to read on. It holds while
 * an answer streams too: the first paragraph grows in view and the rest arrives behind "Read the
 * whole answer", so nothing the reader has seen is ever folded away.
 *
 * @param model The answer's model.
 * @param expanded The reader pressed "Read the whole answer".
 * @returns What to draw, and whether anything is hidden.
 * @example
 * clipAnswer(golden, false) // { body: [¶1], uncited: [], clipped: true }
 */
export function clipAnswer(
  model: Pick<AnswerModel, 'body' | 'uncited'>,
  expanded: boolean,
): AnswerClip {
  const whole = { body: model.body, uncited: model.uncited, clipped: false };
  if (expanded || model.body.length + model.uncited.length <= 1) return whole;
  return model.body.length > 0
    ? { body: model.body.slice(0, 1), uncited: [], clipped: true }
    : { body: [], uncited: model.uncited.slice(0, 1), clipped: true };
}

/**
 * Which neighbours a marker has in a run of markers on one claim (`[b1, b8]` draws 1 and 4 side by
 * side): its 44 px tap area stops halfway to each, so a tap on 1 never flashes 4 (#205).
 *
 * @param index The marker's place in the run, 0-based.
 * @param count How many markers the run has.
 * @returns `"next"`, `"prev"`, `"prev next"`, or null for a marker on its own.
 * @example
 * runSides(0, 2) // "next": marker 1 of "[1, 4]" stops short of 4
 */
export function runSides(index: number, count: number): string | null {
  const sides = [index > 0 ? 'prev' : '', index < count - 1 ? 'next' : ''].filter(Boolean);
  return sides.length === 0 ? null : sides.join(' ');
}

/**
 * The exchange whose usage line and actions the phone's pinned footer carries: the last one, once
 * its answer is complete (a streaming, stopped or failed answer keeps its own note in the slip).
 *
 * @param answers Each exchange's answer status, in thread order (null: no answer yet).
 * @returns The exchange's index, or -1 when the footer carries only the follow-up box.
 */
export function pinnedExchange(answers: readonly (string | null)[]): number {
  const last = answers.length - 1;
  return last >= 0 && answers[last] === 'complete' ? last : -1;
}
