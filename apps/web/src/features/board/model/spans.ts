/**
 * board/model/spans — words in an answer, in two vocabularies (v03-BOARD-SPEC rule 4).
 *
 * The reader selects RENDERED words; the server stores a span as UTF-16 offsets into the answer's
 * MARKDOWN (`**bold**`, `[b3]` handles, `$maths$`, `## headings`), so it survives re-rendering. This
 * module turns one into the other and back without a DOM: it reads the source as plain text (marks
 * and handles dropped, with a map back to the source) and finds the n-th occurrence of the words.
 *
 * The stored span is `{start, end, quote}` with `quote` EXACTLY `source.slice(start, end)`, markup
 * and all: that is what the server checks (a span over `**bold**`, a `[b1]` handle, `$maths$` or a
 * paragraph break is stored as the source spells it). The words a reader sees are derived from it
 * with `spanWords`, for display only (the ask box, the outline, the note a Keep makes).
 *
 * A selection that crosses a formula or a figure has words the source does not spell the same way;
 * `locateQuote` then answers null and the board says so, rather than storing a span that points at
 * the wrong text.
 */

/** The source read as plain text. `map[i]` is the source offset of `plain[i]`. */
export interface PlainText {
  readonly plain: string;
  readonly map: readonly number[];
}

const HANDLE = /\[b\d+(?:\s*,\s*b\d+)*\]/y;
const FENCE_OPEN = /^[ \t]*```/;

/**
 * The source as the words a reader sees: handles, `**`/`__`/`*`/`_`/backtick marks, heading hashes,
 * the figure and check fences and `$…$` maths are left out; every other character keeps its place.
 * Runs of whitespace become one space (the browser does the same to a selection).
 *
 * @param source The stored answer, Markdown.
 * @returns The plain text and where each of its characters came from.
 */
export function plainOf(source: string): PlainText {
  const out: string[] = [];
  const map: number[] = [];
  let i = 0;
  let lineStart = true;
  let fenced = false;
  const push = (ch: string, at: number): void => {
    if (/\s/.test(ch)) {
      if (out.length === 0 || out[out.length - 1] === ' ') return;
      out.push(' ');
    } else {
      out.push(ch);
    }
    map.push(at);
  };
  while (i < source.length) {
    if (lineStart) {
      const lineEnd = source.indexOf('\n', i);
      const line = source.slice(i, lineEnd === -1 ? source.length : lineEnd);
      if (FENCE_OPEN.test(line)) {
        fenced = !fenced;
        i = lineEnd === -1 ? source.length : lineEnd + 1;
        continue;
      }
      if (fenced) {
        i = lineEnd === -1 ? source.length : lineEnd + 1;
        continue;
      }
      const hashes = /^[ \t]{0,3}#{1,6}[ \t]+/.exec(line);
      if (hashes !== null) i += hashes[0].length;
      lineStart = false;
    }
    const ch = source.charAt(i);
    if (ch === '\n') {
      push(' ', i);
      lineStart = true;
      i += 1;
      continue;
    }
    if (ch === '[') {
      HANDLE.lastIndex = i;
      const handle = HANDLE.exec(source);
      if (handle !== null) {
        i += handle[0].length;
        continue;
      }
    }
    if (ch === '$') {
      const close = source.indexOf('$', i + 1);
      if (close !== -1 && !source.slice(i + 1, close).includes('\n')) {
        i = close + 1;
        continue;
      }
    }
    if (ch === '*' || ch === '_' || ch === '`') {
      i += 1;
      continue;
    }
    push(ch, i);
    i += 1;
  }
  return { plain: out.join(''), map };
}

/**
 * Words as a selection reports them: whitespace collapsed, ends trimmed.
 *
 * @param text Selected text.
 * @returns The same words on one line.
 */
export function normaliseWords(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The words a reader sees in a stored span's `quote` (the source slice): marks, handles and maths
 * left out, runs of whitespace one space. Display only; never send it as a `quote`.
 *
 * @param quote A stored span's quote, Markdown source.
 * @returns The same words as the card shows them.
 */
export function spanWords(quote: string): string {
  return normaliseWords(plainOf(quote).plain);
}

/**
 * How many times `words` starts in `text` before `before`. Overlapping runs count ("aa" in "aaa").
 *
 * @param text The text searched.
 * @param words The words.
 * @param before An offset into `text`: only starts before it count.
 * @returns The count.
 */
export function occurrencesBefore(text: string, words: string, before: number): number {
  if (words === '') return 0;
  let n = 0;
  let at = text.indexOf(words);
  while (at !== -1 && at < before) {
    n += 1;
    at = text.indexOf(words, at + 1);
  }
  return n;
}

/**
 * Where the n-th occurrence of `words` starts in `text`, or -1.
 *
 * @param text The text searched.
 * @param words The words.
 * @param nth 0-based.
 * @returns The offset.
 */
export function nthIndexOf(text: string, words: string, nth: number): number {
  if (words === '') return -1;
  let at = text.indexOf(words);
  for (let n = 0; n < nth && at !== -1; n += 1) at = text.indexOf(words, at + 1);
  return at;
}

/** A selection placed in the stored answer. */
export interface LocatedSpan {
  readonly start: number;
  readonly end: number;
  /** `source.slice(start, end)`, exactly: what the server stores and checks as `quote`. */
  readonly quote: string;
  /** The words as the card shows them (display only). */
  readonly words: string;
  /** Which occurrence of the words this is: the key a later draw of the underline uses. */
  readonly nth: number;
}

/**
 * Finds the selected words in the stored answer.
 *
 * @param source The stored answer, Markdown.
 * @param selected The words the reader selected.
 * @param nth Which occurrence of the words in the rendered answer the selection is (0 = the first).
 * @returns The span in `source`'s offsets, or null when the source does not spell these words
 *   (they cross a formula, a figure or a label).
 */
export function locateQuote(source: string, selected: string, nth: number): LocatedSpan | null {
  const quote = normaliseWords(selected);
  if (quote === '') return null;
  const { plain, map } = plainOf(source);
  const at = nthIndexOf(plain, quote, nth);
  if (at === -1) return null;
  const first = map[at];
  const last = map[at + quote.length - 1];
  if (first === undefined || last === undefined) return null;
  const end = last + 1;
  return { start: first, end, quote: source.slice(first, end), words: quote, nth };
}

/**
 * The occurrence number of a stored span's words, so the underline is drawn on the right one when
 * the same words appear twice in an answer.
 *
 * @param source The stored answer.
 * @param span The stored span.
 * @returns 0-based occurrence among the plain text's matches.
 */
export function spanNth(source: string, span: { start: number; quote: string }): number {
  const { plain, map } = plainOf(source);
  const quote = spanWords(span.quote);
  let nth = 0;
  let at = plain.indexOf(quote);
  while (at !== -1) {
    const here = map[at];
    if (here !== undefined && here >= span.start) return nth;
    nth += 1;
    at = plain.indexOf(quote, at + 1);
  }
  return Math.max(0, nth - 1);
}
