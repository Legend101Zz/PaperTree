/**
 * The phone explain sheet's rules (#205, frame 08b, DESIGN.md §10), pure: how much of an answer the
 * sheet shows before "Read the whole answer", and which answer's usage and actions the pinned
 * footer carries.
 */
import { endsInsideMath } from '@/lib/markdown';

import type { AnswerBlock, AnswerModel, AnswerParagraph } from './answer';

/** What the sheet shows of one answer. */
export interface AnswerClip {
  readonly paragraphs: readonly AnswerParagraph[];
  /** Something is hidden: the slip offers "Read the whole answer". */
  readonly clipped: boolean;
}

/**
 * The paragraphs the sheet draws: the answer's first paragraph only until the reader asks for the
 * rest. An answer of one paragraph is never clipped: there would be nothing to read on. It holds
 * while an answer streams too: the first paragraph grows in view and the rest arrives behind "Read
 * the whole answer", so nothing the reader has seen is ever folded away.
 *
 * @param model The answer's model.
 * @param expanded The reader pressed "Read the whole answer".
 * @returns What to draw, and whether anything is hidden.
 * @example
 * clipAnswer(golden, false) // { paragraphs: [¶1], clipped: true }
 */
export function clipAnswer(model: Pick<AnswerModel, 'paragraphs'>, expanded: boolean): AnswerClip {
  const all = model.paragraphs;
  if (expanded || all.length <= 1) return { paragraphs: all, clipped: false };
  // The fold never lands inside an equation: a paragraph that ends in maths still open (a `$$`
  // display split by a blank line) takes the paragraphs up to the one that closes it.
  const shown = firstWhole(all);
  return { paragraphs: all.slice(0, shown), clipped: shown < all.length };
}

/**
 * The blocks up to and including the `n`th paragraph (the fold's first paragraph): the labels and
 * figures before it stay, everything after it waits behind "Read the whole answer".
 *
 * @param blocks The answer's blocks.
 * @param n How many paragraphs to keep.
 * @returns The leading blocks (all of them when there are no more than `n` paragraphs).
 */
export function blocksUpTo(blocks: readonly AnswerBlock[], n: number): readonly AnswerBlock[] {
  let seen = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i]?.k === 'p') seen += 1;
    if (seen === n) return blocks.slice(0, i + 1);
  }
  return blocks;
}

/**
 * How many leading paragraphs make one whole first paragraph (more than one only to close maths).
 *
 * @param paragraphs The answer's paragraphs.
 * @returns A count from 1 up.
 */
function firstWhole(paragraphs: readonly AnswerParagraph[]): number {
  let open = '';
  for (let n = 1; n <= paragraphs.length; n += 1) {
    open = `${open}${open === '' ? '' : '\n\n'}${paragraphs[n - 1]?.text ?? ''}`;
    if (!endsInsideMath(open)) return n;
  }
  return paragraphs.length;
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
