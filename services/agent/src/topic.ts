/**
 * The `topic` run's input and answer (v0.2 S2b2, #242; GAP-A1 D2). One short Flash call per
 * upload: the paper's title, abstract excerpt and arXiv category, plus the names of the person's
 * topics, in; ONE JSON object `{topic_name, is_new, reason}` out. There are no tools and no retry
 * of a bad answer: an answer that does not fit is "no suggestion", decided here by zod and again
 * by the API, which holds the person's real topics.
 *
 * The request carries the category and the topic names in `question` (so the existing 2,000
 * character bound holds) and the abstract excerpt in `seed.quote`, where it is datamarked like any
 * other paper text (prompts.ts `untrustedQuote`).
 */
import { z } from 'zod';

import { clip, codePoints, collapse } from './text.ts';

/** A topic name is at most this many characters (the API's `TOPIC_NAME_MAX`, topics.py). */
export const TOPIC_NAME_MAX = 60;
/** The reason is one short sentence. */
export const TOPIC_REASON_MAX = 200;

/** What the request's `question` says, parsed back (see `topicQuestion` on the API side). */
export interface TopicInput {
  readonly category: string | null;
  readonly topics: readonly string[];
}

const CATEGORY_LINE = /^Category: (.*)$/m;
const TOPICS_LINE = /^Existing topics: (\[.*\])$/m;

/**
 * Reads the category and the existing topic names out of a topic run's `question`.
 *
 * @param question - `Category: <x or none>\nExisting topics: <JSON array of names>`.
 * @returns The input, or null when the question is not in that shape.
 * @example
 * parseTopicInput('Category: cs.LG\nExisting topics: ["Vision"]'); // { category: 'cs.LG', topics: ['Vision'] }
 */
export function parseTopicInput(question: string): TopicInput | null {
  const category = CATEGORY_LINE.exec(question)?.[1]?.trim();
  const topicsJson = TOPICS_LINE.exec(question)?.[1];
  if (category === undefined || topicsJson === undefined) return null;
  let topics: unknown;
  try {
    topics = JSON.parse(topicsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(topics) || !topics.every((name) => typeof name === 'string')) return null;
  return { category: category === '' || category === 'none' ? null : category, topics };
}

/** `{topic_name, is_new, reason}`, nothing else (zod strict: an extra key is a bad answer). */
const Answer = z
  .object({
    topic_name: z
      .string()
      .transform((value) => collapse(value))
      .refine(
        (value) => value !== '' && codePoints(value) <= TOPIC_NAME_MAX,
        `a topic name of 1 to ${String(TOPIC_NAME_MAX)} characters`,
      ),
    is_new: z.boolean(),
    // A long reason is clipped, not refused: the name is what the person acts on.
    reason: z
      .string()
      .transform((value) => clip(collapse(value), TOPIC_REASON_MAX, true))
      .refine((value) => value !== '', 'a reason'),
  })
  .strict();

/** A valid topic answer. For an existing topic `topic_name` is the person's own spelling. */
export interface TopicAnswer {
  readonly topic_name: string;
  readonly is_new: boolean;
  readonly reason: string;
}

export type TopicVerdict =
  | { readonly ok: true; readonly answer: TopicAnswer }
  | { readonly ok: false; readonly why: string };

/** The answer's JSON with an optional Markdown fence removed (models add one unasked). */
function unfence(text: string): string {
  const fenced = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(text.trim());
  return (fenced?.[1] ?? text).trim();
}

/**
 * Checks a topic run's final text against the contract and the person's topics.
 *
 * @param text - The model's whole answer.
 * @param existing - The names of the person's topics, as the request gave them.
 * @returns `ok` with the answer (an existing topic's name in the person's own spelling), or why
 *   not. Not valid: not one JSON object; a key missing or extra; a name over the bound; `is_new`
 *   false with a name that is not an existing topic; `is_new` true with a name that is one.
 * @example
 * parseTopicAnswer('{"topic_name":"Vision","is_new":false,"reason":"Image models."}', ['Vision']);
 */
export function parseTopicAnswer(text: string, existing: readonly string[]): TopicVerdict {
  let json: unknown;
  try {
    json = JSON.parse(unfence(text));
  } catch {
    return { ok: false, why: 'the answer is not JSON' };
  }
  const parsed = Answer.safeParse(json);
  if (!parsed.success)
    return { ok: false, why: 'the answer does not fit {topic_name, is_new, reason}' };
  const answer = parsed.data;
  const match = existing.find(
    (name) => name.trim().toLowerCase() === answer.topic_name.toLowerCase(),
  );
  if (!answer.is_new && match === undefined)
    return { ok: false, why: 'is_new is false but the name is not one of the existing topics' };
  if (answer.is_new && match !== undefined)
    return { ok: false, why: 'is_new is true but the name is an existing topic' };
  return { ok: true, answer: { ...answer, topic_name: match ?? answer.topic_name } };
}
