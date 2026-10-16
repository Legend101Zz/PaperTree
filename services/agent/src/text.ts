/**
 * Text lengths the way the contracts count them (v0.2 S7a review): in Unicode CODE POINTS, the
 * unit of JSON Schema's `minLength`/`maxLength` and of Python's `len`, never JavaScript's UTF-16
 * units (`'𝑄'.length` is 2). A cut never splits a character: it falls on a grapheme boundary, so a
 * surrogate pair, an accent and its letter, or an emoji sequence stay whole.
 */

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The length of `text` in code points.
 *
 * @param text - Any string.
 * @returns What Python's `len(text)` would say.
 */
export function codePoints(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/**
 * `text` cut to at most `max` code points at a character boundary.
 *
 * @param text - The text.
 * @param max - The bound, in code points.
 * @param ellipsis - Spend one of the `max` on "…" when a cut is made (display text only).
 * @returns `text` itself when it fits.
 */
export function clip(text: string, max: number, ellipsis: boolean): string {
  if (codePoints(text) <= max) return text;
  const room = ellipsis ? max - 1 : max;
  let out = '';
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const size = codePoints(segment);
    if (used + size > room) break;
    out += segment;
    used += size;
  }
  return ellipsis ? `${out.trimEnd()}…` : out;
}

/** Whitespace runs as one space, both ends trimmed. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A quote cut to `max` code points so that it stays VERBATIM: never an ellipsis, at the last word
 * boundary when that still leaves `min`, else at the last whole character (a long word: a cut
 * there is still a prefix of what the paper says).
 *
 * @param text - The model's quote.
 * @param min - The shortest quote the contract takes, in code points.
 * @param max - The longest, in code points.
 * @returns The quote, whitespace collapsed and cut; it may still be shorter than `min` when the
 *   model's own quote was (the caller refuses it then).
 */
export function cutQuote(text: string, min: number, max: number): string {
  const flat = collapse(text);
  if (codePoints(flat) <= max) return flat;
  const hard = clip(flat, max, false);
  if (/^\s/.test(flat.slice(hard.length))) return hard.trimEnd();
  const atWord = hard.replace(/\s+\S*$/, '');
  return codePoints(atWord) >= min ? atWord : hard;
}
