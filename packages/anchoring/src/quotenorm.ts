/**
 * anchoring/quotenorm — the normalisation T3 matches against, and the map back to raw offsets.
 *
 * THIS IS NOT `document-ir`'s `normaliseText`, AND THE DIFFERENCE IS DELIBERATE.
 *
 * `normaliseText` defines block IDENTITY. It is a one-way digest input: it collapses whitespace and
 * case-folds, and it deliberately does NOT de-hyphenate, because a repair is a declared,
 * reproducible edit (D4 / rule 30b) and a hash must not invent one. It also throws away the
 * position mapping, which identity does not need.
 *
 * T3 needs the opposite properties. It needs to match a quote a human selected on screen against a
 * text stream a different parser version produced, and then RENDER the match — so it needs
 *
 *   1. the same folding, so `The` matches `the` and `ﬁ` matches `fi`;
 *   2. **de-hyphenation**, because `Block.text` is never de-hyphenated (`transduc-\ntion`; 61
 *      line-break hyphens in `resnet` alone) while the human selected the word `transduction`;
 *   3. a **forward and reverse offset map**, so a match in normalised space becomes a highlight in
 *      raw space. Hypothesis's `normalize.ts` does exactly this, and it is the right pattern.
 *
 * So this module reuses `normaliseText` for the parts that must agree with identity — it is called
 * per code point, and its per-code-point output IS the fold, because full case folding is
 * context-independent — and adds hyphen joining and the position map on top.
 *
 * THE HYPHEN RULE, stated precisely because over-eager joining corrupts real hyphens.
 * A `-` (or U+2010 HYPHEN) is dropped ONLY when it is immediately followed by a newline AND the
 * character before it and the first character after the newline are both alphabetic. That keeps
 * `state-\nof-the-art` joining to `stateof-the-art`? No — it keeps `of-the-art` intact because the
 * hyphens there are not before a newline, and it joins `transduc-\ntion` to `transduction`, which
 * is the case that actually occurs. A hyphen at a line end followed by a digit or a capital is left
 * alone: `2015-\n2016` and `Kaiming-\nHe` are ranges and names, not broken words.
 */

import { normaliseText } from '@papertree/document-ir';

/** Code points that count as a line-break hyphen. U+00AD SOFT HYPHEN is included: it means this. */
const HYPHENS = new Set([0x2d, 0x2010, 0x00ad]);

const NEWLINES = new Set([0x0a, 0x0d, 0x0b, 0x0c, 0x2028, 0x2029]);

function isAlphabetic(codePoint: number | undefined): boolean {
  if (codePoint === undefined) return false;
  // Deliberately a property test and not a range: `Ré-\nsumé` and Greek in maths both occur.
  return /\p{Alphabetic}/u.test(String.fromCodePoint(codePoint));
}

function isLowerAlphabetic(codePoint: number | undefined): boolean {
  if (codePoint === undefined) return false;
  const char = String.fromCodePoint(codePoint);
  return /\p{Alphabetic}/u.test(char) && !/\p{Uppercase}/u.test(char);
}

export interface NormalisedQuote {
  /** The folded, de-hyphenated, whitespace-collapsed text. Match against this. */
  readonly text: string;
  /**
   * `rawOffsetAt[i]` is the RAW code-point offset that produced normalised code point `i`.
   * Length is `text`'s code-point length + 1; the last entry is the raw length, so a normalised
   * range `[a, b)` maps to the raw range `[rawOffsetAt[a], rawOffsetAt[b])` with no special case
   * at the end.
   */
  readonly rawOffsetAt: readonly number[];
}

function toCodePoints(text: string): number[] {
  const points: number[] = [];
  for (const char of text) {
    const point = char.codePointAt(0);
    if (point !== undefined) points.push(point);
  }
  return points;
}

/**
 * Normalise for matching, keeping every normalised code point traceable to the raw offset it came
 * from.
 *
 * Runs in three passes rather than one so that each is separately testable and the hyphen rule can
 * see the raw newline it depends on (pass 2 would have collapsed it to a space):
 *
 *   1. drop line-break hyphens and the newline after them;
 *   2. collapse whitespace runs to one U+0020 and strip the ends;
 *   3. fold each code point through `document-ir`'s `normaliseText`, which is the SAME fold block
 *      identity uses, so a T3 match and a T1 hit cannot disagree about what two strings are equal.
 */
export function normaliseForMatch(raw: string): NormalisedQuote {
  const points = toCodePoints(raw);

  // ── 1. de-hyphenate ──
  const dehyphenated: number[] = [];
  const afterHyphen: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i] as number;
    if (HYPHENS.has(point)) {
      // Look past the hyphen for a newline, tolerating a CR before the LF.
      let j = i + 1;
      while (j < points.length && NEWLINES.has(points[j] as number)) j += 1;
      const joinsAWord =
        j > i + 1 && isLowerAlphabetic(points[j]) && isAlphabetic(points[i - 1]);
      if (joinsAWord) {
        i = j - 1; // skip the hyphen AND the newline run; the loop's i += 1 lands on `points[j]`
        continue;
      }
    }
    dehyphenated.push(point);
    afterHyphen.push(i);
  }

  // ── 2. collapse whitespace ──
  // Uses `normaliseText` on a single space to learn nothing; the whitespace SET is what matters and
  // it is the enumerated 26 code points, not `\s` — JS's, Python's and Rust's `\s` are three
  // different sets and the identity module refuses to use any of them. Testing membership by
  // round-tripping the code point through `normaliseText` is exact and needs no second table:
  // `normaliseText` maps every one of the 26 to U+0020 and strips it at the ends.
  const collapsed: number[] = [];
  const afterCollapse: number[] = [];
  let inRun = false;
  for (let i = 0; i < dehyphenated.length; i += 1) {
    const point = dehyphenated[i] as number;
    if (isWhitespaceCodePoint(point)) {
      if (!inRun) {
        collapsed.push(0x20);
        afterCollapse.push(afterHyphen[i] as number);
      }
      inRun = true;
    } else {
      collapsed.push(point);
      afterCollapse.push(afterHyphen[i] as number);
      inRun = false;
    }
  }
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === 0x20) start += 1;
  while (end > start && collapsed[end - 1] === 0x20) end -= 1;

  // ── 3. fold, per code point, through the identity normaliser ──
  // A fold can expand one code point into several (`ß` → `ss`, `ﬃ` → `ffi`), so every produced
  // code point records the RAW offset of the code point it came from. That is what keeps a match
  // that lands mid-expansion mappable back to a real character.
  let text = '';
  const rawOffsetAt: number[] = [];
  for (let i = start; i < end; i += 1) {
    const point = collapsed[i] as number;
    const rawOffset = afterCollapse[i] as number;
    const folded = normaliseText(String.fromCodePoint(point));
    for (const char of folded) {
      text += char;
      rawOffsetAt.push(rawOffset);
    }
  }
  rawOffsetAt.push(points.length);
  return { text, rawOffsetAt };
}

/**
 * Whitespace by the identity module's definition, discovered rather than duplicated.
 *
 * `normaliseText` collapses every whitespace code point to U+0020 and strips it at the ends, so a
 * single code point whose normalised form is empty is whitespace, and nothing else is. Keeping one
 * definition matters: a second hand-written table is a second contract and it will drift — the
 * identity module's own header records an editor having flattened all 16 exotic spaces to U+0020 in
 * exactly such a table.
 */
const WHITESPACE_CACHE = new Map<number, boolean>();
function isWhitespaceCodePoint(point: number): boolean {
  const cached = WHITESPACE_CACHE.get(point);
  if (cached !== undefined) return cached;
  const result = normaliseText(String.fromCodePoint(point)) === '';
  WHITESPACE_CACHE.set(point, result);
  return result;
}

/** Snap an offset outward to the nearest word boundary, so context is words and not fragments. */
export function snapToWordBoundary(points: readonly number[], offset: number, direction: -1 | 1): number {
  let index = Math.max(0, Math.min(points.length, offset));
  const isWord = (p: number | undefined): boolean =>
    p !== undefined && !isWhitespaceCodePoint(p);
  while (index > 0 && index < points.length && isWord(points[index - 1]) && isWord(points[index])) {
    index += direction;
    if (index <= 0 || index >= points.length) break;
  }
  return Math.max(0, Math.min(points.length, index));
}

export { toCodePoints };
