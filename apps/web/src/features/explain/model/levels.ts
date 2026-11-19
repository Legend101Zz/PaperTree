/**
 * The level of an answer and the "go deeper" chips (v0.3 answer format §2, §3; #349). Pure: what
 * each level is called, which level an answer is at, and the fixed question each chip asks.
 *
 * Changing level is not a new question: it asks the same one again at another depth
 * (`relevel_of`), the server stores the result as a sibling of the answer (they share a `sibling_group`), and the
 * panel keeps
 * every level it has fetched, so switching back costs no request (`variantAt`).
 */
import type { AnswerLevel } from '@/lib/api/types';

export type { AnswerLevel };

/** The level an answer is at when nothing says otherwise: the default, and every older answer. */
export const DEFAULT_LEVEL: AnswerLevel = 'familiar';

/** The three levels in the order the switch shows them, with the words the reader sees. */
export const LEVELS: readonly { readonly level: AnswerLevel; readonly label: string }[] = [
  { level: 'new', label: 'New to this' },
  { level: 'familiar', label: 'Familiar' },
  { level: 'expert', label: 'Expert' },
];

/** What a go-deeper chip does: re-level the answer, or ask a fixed follow-up. */
export type DeeperChip =
  | { readonly id: 'simpler'; readonly label: 'Simpler'; readonly relevel: 'new' }
  | {
      readonly id: 'example' | 'maths' | 'matters' | 'elsewhere';
      readonly label: string;
      readonly question: string;
    };

/**
 * The go-deeper chips, in the prototype's order. Simpler is a re-level to New to this; each other
 * chip is a normal follow-up with a fixed question and no new API.
 */
export const DEEPER_CHIPS: readonly DeeperChip[] = [
  { id: 'simpler', label: 'Simpler', relevel: 'new' },
  { id: 'example', label: 'An example', question: 'Give me a concrete example of this.' },
  { id: 'maths', label: 'Show the math', question: 'Show the maths step by step.' },
  {
    id: 'matters',
    label: 'Why it matters',
    question: "Why does this matter for the paper's results?",
  },
  {
    id: 'elsewhere',
    label: 'Where else in the paper',
    question: 'Where else in the paper does this idea come up?',
  },
];

/**
 * What an answer is at, for a message that may predate levels.
 *
 * @param message Any message with an optional level.
 * @returns Its level, Familiar when it has none.
 */
export function levelOf(message: { readonly level?: AnswerLevel | null }): AnswerLevel {
  return message.level ?? DEFAULT_LEVEL;
}

/** One level of one question's answer. */
export interface Variant<M, A> {
  readonly level: AnswerLevel;
  readonly answer: M;
  readonly model: A | null;
}

/**
 * The answer already fetched at a level, if any. Switching to a level that returns one costs no
 * request; one that returns undefined needs a `relevel_of` ask.
 *
 * @param variants The question's answers, the first being the one the user turn started.
 * @param level The level the reader chose.
 * @returns The variant, or undefined when that level has not been asked for.
 */
export function variantAt<M, A>(
  variants: readonly Variant<M, A>[],
  level: AnswerLevel,
): Variant<M, A> | undefined {
  return variants.find((v) => v.level === level);
}
