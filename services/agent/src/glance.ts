/**
 * The `glance` run's answer (v0.3 #337, design V3-AI-NOTES §5 "At a glance v2"). One short Flash call
 * per paper, made when the paper is added and cached by the API: the paper's digest (the one a
 * summary reads) in; ONE JSON object out, the sheet on the spread's right page. There are no tools
 * and no retry of a bad answer: an answer that does not fit is "no glance", decided here by zod and
 * again by the API (`papertree_api/glance.py`: change the rules in both).
 *
 * The caps are the design's: the gist is at most 20 words; Problem, Idea, How it works and Limits at
 * most 30 words each; Results has at most two large numbers (a value and what it measures); Read
 * first names sections; five Words to know (a term and a short gloss). A long TEXT is trimmed to its
 * cap on a word boundary (with "…"), never refused, and never inside a `$…$` maths span (a span is
 * ONE word: half a formula is not typeset). A list over its cap is trimmed to it; a value or a term
 * over its bound, a missing key, an extra key or a wrong type is a bad answer.
 *
 * Each block carries the handle (`b3`) of the digest passage it comes from, or null: the API turns
 * it into the page of the quiet `p. 3 ›` link. It is the only provenance the sheet shows.
 */
import { z } from 'zod';

import { codePoints, collapse } from './text.ts';

/** The gist: one sentence a reader can repeat. */
export const GIST_WORDS = 20;
/** Problem, Idea, How it works, Limits, and the note under Results. */
export const BLOCK_WORDS = 30;
/** Read first: the sections to read, in order, and how long it takes. */
export const READ_FIRST_WORDS = 30;
/** What a large number measures ("test error, MNIST"). */
export const MEASURES_WORDS = 8;
/** A large number's value ("0.42%", "28.4"): it is set in big type, so it is short. */
export const VALUE_CHARS = 12;
/** At most this many large numbers under Results. */
export const MAX_NUMBERS = 2;
/** A term to know, in characters. */
export const TERM_CHARS = 40;
/** Its gloss, in words. */
export const GLOSS_WORDS = 14;
/** Exactly this many terms. */
export const WORDS_COUNT = 5;

/** The question a glance run carries (its request's `question`). */
export const GLANCE_QUESTION = "Write this paper's at-a-glance sheet.";

/** A word: a run of non-space characters, with a `$…$` maths span kept whole whatever is in it. */
const WORD = /(?:\$[^$\n]+\$|[^\s$]|\$)+/gu;

/**
 * How many words `text` has, counting a `$…$` span as part of one word.
 *
 * @param text - Any string.
 * @returns The count.
 * @example
 * wordCount('Let $h(t)$ evolve as $dh/dt = f$.'); // 5
 */
export function wordCount(text: string): number {
  return [...text.matchAll(WORD)].length;
}

/**
 * `text` with whitespace collapsed and, past `max` words, cut after the `max`th word and given a
 * "…" (a trailing comma, semicolon or colon goes first).
 *
 * @param text - The model's text.
 * @param max - The cap, in words.
 * @returns The text; the same string when it fits.
 * @example
 * trimWords('one two three', 2); // 'one two…'
 */
export function trimWords(text: string, max: number): string {
  const flat = collapse(text);
  const words = [...flat.matchAll(WORD)];
  if (words.length <= max) return flat;
  const last = words[max - 1];
  if (last === undefined) return '';
  const end = (last.index ?? 0) + last[0].length;
  const cut = flat.slice(0, end).replace(/[,;:\s]+$/u, '');
  return /[.!?]$/u.test(cut) ? cut : `${cut}…`;
}

const handle = z.string().regex(/^b\d+$/u, 'a handle like b3');

/** A text field: required, non-empty once collapsed, trimmed to its word cap. */
const words = (max: number) =>
  z
    .string()
    .transform((value) => trimWords(value, max))
    .refine((value) => value !== '', 'some words');

const block = z.object({ text: words(BLOCK_WORDS), cite: handle.nullable() }).strict();

const number = z
  .object({
    value: z
      .string()
      .transform((value) => collapse(value))
      .refine(
        (value) => value !== '' && codePoints(value) <= VALUE_CHARS,
        `a value of 1 to ${String(VALUE_CHARS)} characters`,
      ),
    measures: words(MEASURES_WORDS),
  })
  .strict();

const term = z
  .object({
    term: z
      .string()
      .transform((value) => collapse(value))
      .refine(
        (value) => value !== '' && codePoints(value) <= TERM_CHARS,
        `a term of 1 to ${String(TERM_CHARS)} characters`,
      ),
    gloss: words(GLOSS_WORDS),
  })
  .strict();

const Answer = z
  .object({
    gist: words(GIST_WORDS),
    problem: block,
    idea: block,
    how: block,
    results: z
      .object({
        // Over the cap is trimmed to the first two: the model orders them by importance.
        numbers: z.array(number).transform((list) => list.slice(0, MAX_NUMBERS)),
        note: words(BLOCK_WORDS).nullable(),
        cite: handle.nullable(),
      })
      .strict()
      .refine((r) => r.numbers.length > 0 || r.note !== null, 'a number or a note'),
    limits: block,
    read_first: words(READ_FIRST_WORDS),
    words: z
      .array(term)
      .min(WORDS_COUNT, `${String(WORDS_COUNT)} terms`)
      .transform((list) => list.slice(0, WORDS_COUNT)),
  })
  .strict();

/** A valid glance, every cap applied. */
export type GlanceAnswer = z.infer<typeof Answer>;

export type GlanceVerdict =
  | { readonly ok: true; readonly answer: GlanceAnswer }
  | { readonly ok: false; readonly why: string };

/** The answer's JSON with an optional Markdown fence removed (models add one unasked). */
function unfence(text: string): string {
  const fenced = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/u.exec(text.trim());
  return (fenced?.[1] ?? text).trim();
}

/**
 * Checks a glance run's final text against the contract.
 *
 * @param text - The model's whole answer.
 * @returns `ok` with the answer, every cap applied, or why not. Not valid: not one JSON object; a
 *   key missing or extra; a text empty; a value or a term over its bound; fewer than five terms;
 *   Results with neither a number nor a note; a `cite` that is not a handle or null.
 * @example
 * parseGlanceAnswer(JSON.stringify(sheet)); // { ok: true, answer: { gist: '…', … } }
 */
export function parseGlanceAnswer(text: string): GlanceVerdict {
  let json: unknown;
  try {
    json = JSON.parse(unfence(text));
  } catch {
    return { ok: false, why: 'the answer is not JSON' };
  }
  const parsed = Answer.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join('.') ?? '';
    return {
      ok: false,
      why: `the answer does not fit the glance shape${where ? ` (${where})` : ''}`,
    };
  }
  return { ok: true, answer: parsed.data };
}
