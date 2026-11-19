/**
 * lib/markdown — the SAFE minimal Markdown subset a model answer uses, as plain data.
 *
 * It produces a small tree (blocks of inline nodes); a React component turns the tree into
 * elements. There is no HTML path at all: every string ends up as a React text child, so `<` is
 * just a character, and a link `[text](url)` keeps only its text (the url is thrown away, so
 * `javascript:` can never reach the DOM). Unbalanced or nested-wrong markers stay literal text.
 *
 * SUPPORTED: paragraphs (blank-line separated), line breaks inside a paragraph, `*em*` / `_em_`,
 * `**strong**`, `` `code` ``, `-`/`*`/`•` bullet lists, `1.`/`1)` numbered lists, `#` headings
 * (shown as a bold line), the model's `[bN]` / `[b1, b2]` citation handles, and MATHS (#338).
 *
 * MATHS. `$$…$$` and `\[…\]` are display; `$…$` and `\(…\)` are inline. A single `$` opens maths
 * only when a non-space follows it, and closes only on a `$` that a non-space precedes and a digit
 * does not follow, so "costs $5 and $10" stays text. `\$` is a literal dollar. Maths is found
 * BEFORE any other parsing and lifted out whole (`scanMath`), so what is inside it is opaque:
 * `_` and `*` there never become emphasis, `[b1]` is not a handle, and a line break or
 * `dehyphenate` never touches it. The tree carries only the TeX source (`math` / `dm` nodes);
 * typesetting it is `lib/math` (KaTeX), shared by every renderer.
 */

import { texToPlain } from './texPlain';

export type Inline =
  | { readonly t: 'text'; readonly v: string }
  /** Maths as TeX source; `display` is a `$$…$$` that sat inside a line of other text. */
  | { readonly t: 'math'; readonly tex: string; readonly display: boolean }
  | { readonly t: 'em' | 'strong'; readonly c: readonly Inline[] }
  | { readonly t: 'code'; readonly v: string }
  /** `after` is the punctuation that directly follows the handle, kept with it (no line break between). */
  | { readonly t: 'cite'; readonly markers: readonly string[]; readonly after: string };

export type Block =
  /** A display equation on a line of its own (`$$…$$`). */
  | { readonly k: 'dm'; readonly tex: string }
  | { readonly k: 'p'; readonly lines: readonly (readonly Inline[])[] }
  | { readonly k: 'h'; readonly c: readonly Inline[] }
  | { readonly k: 'ul'; readonly items: readonly (readonly Inline[])[] }
  | { readonly k: 'ol'; readonly start: number; readonly items: readonly (readonly Inline[])[] };

interface ParseOptions {
  /** The text is still arriving: an unclosed marker at the end is dropped instead of shown. */
  readonly streaming?: boolean;
}

/** One maths run lifted out of the text: its TeX, whether it is display, and its source text. */
interface MathRun {
  readonly tex: string;
  readonly display: boolean;
  /** The text exactly as written, delimiters included (to put it back after a text pass). */
  readonly raw: string;
}

interface InlineContext extends ParseOptions {
  readonly runs: readonly MathRun[];
}

/** A lifted maths run stands in the text as this private-use pair around its index. */
const PLACEHOLDER = /(\d+)/y;
const PLACEHOLDER_ALL = /(\d+)/g;
const ONLY_PLACEHOLDER = /^(\d+)$/;
const STRAY_PRIVATE = /[]/g;

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';

/** The first unescaped `$` (or `$$`, with `pair`) at or after `from` and before `limit`. */
function findDollar(text: string, from: number, limit: number, pair: boolean): number {
  for (let j = from; j < limit; j += 1) {
    const ch = text[j];
    if (ch === '\\') j += 1;
    else if (ch === '$' && (!pair || text[j + 1] === '$')) return j;
  }
  return -1;
}

const tidyTex = (tex: string): string => tex.replace(/\s*\n\s*/g, ' ').trim();

/**
 * Lift every maths run out of `text` and leave a placeholder where it stood.
 *
 * Opening and closing rules are in the file comment. Not maths, and so literal: a `$` with a
 * space after it, `$5 and $10`, an unmatched `$`. Skipped whole: `` `code` `` and `\$`. An
 * UNCLOSED run at the end: while `streaming` it is held back (dropped) until it closes; once the
 * text is final, a tail that is plainly TeX (`$$…`, `$\frac{`, `\(…`) is shown as plain text
 * WITHOUT its delimiter, and any other lone `$` stays a dollar sign.
 */
function scanMath(
  text: string,
  streaming: boolean,
  keepDelimiters = false,
): { text: string; runs: MathRun[] } {
  const runs: MathRun[] = [];
  let out = '';
  let i = 0;
  const put = (tex: string, display: boolean, end: number): void => {
    runs.push({ tex: tidyTex(tex), display, raw: text.slice(i, end) });
    out += `${String(runs.length - 1)}`;
    i = end;
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === '(' || next === '[') {
        const end = text.indexOf(next === '(' ? '\\)' : '\\]', i + 2);
        if (end > i + 2 && text.slice(i + 2, end).trim() !== '') {
          put(text.slice(i + 2, end), next === '[', end + 2);
          continue;
        }
        if (end === -1 && streaming) break;
        // Unclosed: plain text without its delimiter. Closed but empty (`\(\)`): the bracket.
        if (keepDelimiters) out += `\\${next}`;
        else if (end !== -1) out += next;
        i += 2;
        continue;
      }
      out += ch + (next ?? '');
      i += 2;
      continue;
    }
    if (ch === '`') {
      const lineEnd = text.indexOf('\n', i + 1);
      const end = text.indexOf('`', i + 1);
      if (end > i + 1 && (lineEnd === -1 || end < lineEnd)) {
        out += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (ch !== '$') {
      out += ch;
      i += 1;
      continue;
    }
    if (text[i + 1] === '$') {
      const end = findDollar(text, i + 2, text.length, true);
      if (end > i + 2 && text.slice(i + 2, end).trim() !== '') {
        put(text.slice(i + 2, end), true, end + 2);
        continue;
      }
      if (end === -1) {
        if (streaming) break;
        if (keepDelimiters) out += '$$';
        i += 2;
        continue;
      }
      out += '$$';
      i += 2;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) {
      if (streaming) break;
      out += ch;
      i += 1;
      continue;
    }
    if (isSpace(next)) {
      out += ch;
      i += 1;
      continue;
    }
    const paragraphEnd = text.indexOf('\n\n', i + 1);
    const end = findDollar(text, i + 1, paragraphEnd === -1 ? text.length : paragraphEnd, false);
    if (end === -1) {
      // "$5 and" is a price in the making; "$2\pi" and "$x" are maths in the making.
      const holdable = !isDigit(next) || !/\s/.test(text.slice(i + 1));
      if (streaming && paragraphEnd === -1 && holdable) break;
      if (keepDelimiters || next !== '\\') out += ch;
      i += 1;
      continue;
    }
    if (!isSpace(text[end - 1]) && !isDigit(text[end + 1])) {
      put(text.slice(i + 1, end), false, end + 1);
      continue;
    }
    out += ch;
    i += 1;
  }
  return { text: out, runs };
}

function restoreMath(text: string, runs: readonly MathRun[]): string {
  return text.replace(PLACEHOLDER_ALL, (_m, n: string) => runs[Number(n)]?.raw ?? '');
}

/**
 * Whether `text` ends in maths that has not closed yet (`$$ y = F(`, `$\frac{`). A paragraph that
 * does is not complete: whatever shows or clips it (the phone's first-paragraph fold) reads on to
 * the paragraph that closes it.
 */
export function endsInsideMath(text: string): boolean {
  const held = scanMath(text, true);
  const final = scanMath(text, false);
  return restoreMath(held.text, held.runs).length < restoreMath(final.text, final.runs).length;
}

const HANDLE = /\s*\[(b\d+(?:\s*,\s*b\d+)*)\]/y;
const LINK = /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/y;
const TRAILING = /^[.,;:!?)\]}”’"'%]+/;
const WORD = /[\p{L}\p{N}]/u;
const MAX_DEPTH = 6;

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

function closingStar(s: string, from: number): number {
  for (let j = from; j < s.length; j += 1) {
    if (s[j] !== '*') continue;
    if (s[j + 1] === '*' || s[j - 1] === '*') {
      j += 1;
      continue;
    }
    if (!isSpace(s[j - 1])) return j;
  }
  return -1;
}

function closingUnderscore(s: string, from: number): number {
  for (let j = from; j < s.length; j += 1) {
    if (s[j] === '_' && !isSpace(s[j - 1]) && !WORD.test(s[j + 1] ?? ' ')) return j;
  }
  return -1;
}

function glueTrailing(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.t === 'text' && last?.t === 'cite') {
      const match = TRAILING.exec(node.v);
      if (match !== null) {
        out[out.length - 1] = { ...last, after: last.after + match[0] };
        if (node.v.length > match[0].length)
          out.push({ t: 'text', v: node.v.slice(match[0].length) });
        continue;
      }
    }
    if (node.t === 'text' && last?.t === 'text') {
      out[out.length - 1] = { t: 'text', v: last.v + node.v };
      continue;
    }
    out.push(node);
  }
  return out;
}

function parseInline(source: string, options: InlineContext, depth = 0): Inline[] {
  const streaming = options.streaming === true;
  const out: Inline[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer !== '') out.push({ t: 'text', v: buffer });
    buffer = '';
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;

    if (ch === '\uE000') {
      PLACEHOLDER.lastIndex = i;
      const lifted = PLACEHOLDER.exec(source);
      const run = lifted === null ? undefined : options.runs[Number(lifted[1])];
      if (lifted !== null && run !== undefined) {
        flush();
        out.push({ t: 'math', tex: run.tex, display: run.display });
        i += lifted[0].length;
        continue;
      }
    }
    if (ch === '\\' && source[i + 1] === '$') {
      buffer += '$';
      i += 2;
      continue;
    }
    if (ch === '[' || /\s/.test(ch)) {
      HANDLE.lastIndex = i;
      const handle = HANDLE.exec(source);
      if (handle !== null) {
        flush();
        out.push({
          t: 'cite',
          markers: (handle[1] ?? '').split(',').map((m) => m.trim()),
          after: '',
        });
        i += handle[0].length;
        continue;
      }
    }
    if (ch === '[') {
      LINK.lastIndex = i;
      const link = LINK.exec(source);
      if (link !== null) {
        buffer += link[1] ?? '';
        i += link[0].length;
        continue;
      }
    }
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      if (end === -1 && streaming) {
        i += 1;
        continue;
      }
    }
    if (ch === '*' && source[i + 1] === '*' && depth < MAX_DEPTH) {
      const end = source.indexOf('**', i + 2);
      if (end > i + 2 && !isSpace(source[i + 2]) && !isSpace(source[end - 1])) {
        flush();
        out.push({ t: 'strong', c: parseInline(source.slice(i + 2, end), options, depth + 1) });
        i = end + 2;
        continue;
      }
      if (end === -1 && streaming && !isSpace(source[i + 2])) {
        i += 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && depth < MAX_DEPTH && source[i + 1] !== ch) {
      const opens =
        !isSpace(source[i + 1]) &&
        (ch === '*' || (!WORD.test(source[i - 1] ?? ' ') && source[i - 1] !== '_'));
      if (opens) {
        const end = ch === '*' ? closingStar(source, i + 1) : closingUnderscore(source, i + 1);
        if (end > i + 1) {
          flush();
          out.push({ t: 'em', c: parseInline(source.slice(i + 1, end), options, depth + 1) });
          i = end + 1;
          continue;
        }
        if (end === -1 && streaming && ch === '*') {
          i += 1;
          continue;
        }
      }
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return glueTrailing(out);
}

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseMarkdown(text: string, options: ParseOptions = {}): Block[] {
  const lifted = scanMath(
    text.replace(/\r\n?/g, '\n').replace(STRAY_PRIVATE, ''),
    options.streaming === true,
  );
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: 'ul' | 'ol'; start: number; items: string[] } | null = null;
  const inline = (s: string): Inline[] => parseInline(s, { ...options, runs: lifted.runs });
  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ k: 'p', lines: paragraph.map(inline) });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list === null) return;
    const items = list.items.map(inline);
    blocks.push(list.kind === 'ul' ? { k: 'ul', items } : { k: 'ol', start: list.start, items });
    list = null;
  };
  for (const line of lifted.text.split('\n')) {
    const only = ONLY_PLACEHOLDER.exec(line.trim());
    const display = only === null ? undefined : lifted.runs[Number(only[1])];
    if (display?.display === true && (list === null || !/^\s/.test(line))) {
      flushParagraph();
      flushList();
      blocks.push({ k: 'dm', tex: display.tex });
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    if (heading !== null) {
      flushParagraph();
      flushList();
      blocks.push({ k: 'h', c: inline((heading[1] ?? '').trim()) });
    } else if (bullet !== null || numbered !== null) {
      flushParagraph();
      const kind = bullet !== null ? 'ul' : 'ol';
      if (list === null || list.kind !== kind) {
        flushList();
        list = { kind, start: numbered === null ? 1 : Number(numbered[1]), items: [] };
      }
      list.items.push((bullet?.[1] ?? numbered?.[2] ?? '').trim());
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (list !== null && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** A plain string cut into text and maths, for the strings that are not Markdown (notes, labels). */
type MathSegment =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'math'; readonly tex: string; readonly display: boolean };

/**
 * A plain string as text and maths segments, by the same rules as `parseMarkdown`. Nothing else
 * is interpreted (no emphasis, no handles); `\$` becomes a `$`.
 *
 * @param text - A string that may hold `$…$` / `$$…$$`.
 * @returns Segments in order; a string without maths is one text segment.
 */
export function splitMath(text: string): MathSegment[] {
  const lifted = scanMath(text.replace(STRAY_PRIVATE, ''), false);
  const out: MathSegment[] = [];
  let at = 0;
  const text_ = (v: string): void => {
    if (v !== '') out.push({ t: 'text', v: v.replace(/\\\$/g, '$') });
  };
  for (const match of lifted.text.matchAll(PLACEHOLDER_ALL)) {
    const run = lifted.runs[Number(match[1])];
    text_(lifted.text.slice(at, match.index));
    if (run !== undefined) out.push({ t: 'math', tex: run.tex, display: run.display });
    at = (match.index ?? 0) + match[0].length;
  }
  text_(lifted.text.slice(at));
  return out;
}

/**
 * A plain string with its maths as readable text and its `$` delimiters gone, for places that
 * cannot typeset (an SVG label, a title attribute). A literal dollar sign stays.
 *
 * @param text - A string that may hold `$…$` / `$$…$$`.
 * @returns The string, maths as plain text.
 */
export function mathToPlain(text: string): string {
  return splitMath(text)
    .map((seg) => (seg.t === 'text' ? seg.v : texToPlain(seg.tex)))
    .join('');
}

/** A tree as plain text, handles dropped (for tests and for aria text). */
export function plainText(blocks: readonly Block[]): string {
  return blocks
    .map((b) =>
      b.k === 'dm'
        ? texToPlain(b.tex)
        : b.k === 'p'
          ? b.lines.map(inlinePlain).join('\n')
          : b.k === 'h'
            ? inlinePlain(b.c)
            : b.items.map(inlinePlain).join('\n'),
    )
    .join('\n\n');
}

/** Inline nodes as plain words: handles dropped, maths as readable TeX-free text (never a `$`). */
export function inlinePlain(nodes: readonly Inline[]): string {
  return nodes
    .map((n) =>
      n.t === 'text' || n.t === 'code'
        ? n.v
        : n.t === 'math'
          ? texToPlain(n.tex)
          : n.t === 'cite'
            ? n.after
            : inlinePlain(n.c),
    )
    .join('');
}

/** Words that follow a dangling hyphen in a real coordination ("pre- and post-training"). */
const COORDINATORS = new Set(['and', 'or', 'nor', 'to', 'vs', 'versus', 'but']);

/**
 * Word starts that are almost always the first half of a real compound ("data- driven",
 * "non- linear"): a break after one of them keeps its hyphen.
 */
const COMPOUND_HEADS = new Set([
  'data',
  'non',
  'well',
  'self',
  'end',
  'cross',
  'semi',
  'anti',
  'state',
  'fine',
  'ill',
]);

function keepsHyphen(head: string): boolean {
  const last = head.split('-').pop() ?? head;
  return COMPOUND_HEADS.has(last.toLowerCase());
}

/**
 * A passage as a reader should see it: a typesetter's line-end hyphen is removed ("sin- gle" and
 * "sin-\ngle" both read "single"). Only a hyphen that sits at a line break is touched: the PDF
 * selection turns the line break into a space or keeps it as a newline, and a real compound in
 * the middle of a line ("end-to-end") has no whitespace after its hyphen. Display only; the
 * stored quote is never changed.
 */
export function dehyphenate(text: string): string {
  // Maths is lifted out first, so a "x- y" inside it is never joined.
  const lifted = scanMath(text.replace(STRAY_PRIVATE, ''), false, true);
  return restoreMath(dehyphenateText(lifted.text), lifted.runs);
}

function dehyphenateText(text: string): string {
  return text
    .replace(
      /([\p{L}\p{N}-]*[\p{Ll}\p{N}])-[ \t]*\r?\n[ \t]*(\p{Ll})/gu,
      (_m, head: string, next: string) =>
        head.includes('-') || keepsHyphen(head) ? `${head}-${next}` : `${head}${next}`,
    )
    .replace(/([\p{L}\p{N}-]*[\p{Ll}])- ([\p{Ll}][\p{L}]*)/gu, (m, head: string, word: string) =>
      COORDINATORS.has(word)
        ? m
        : head.includes('-') || keepsHyphen(head)
          ? `${head}-${word}`
          : `${head}${word}`,
    );
}

/**
 * The first `max` characters, cut back to a word boundary, with an ellipsis. Text that already
 * fits is returned as it is.
 */
export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  if (!/\s/.test(text[max] ?? '')) {
    const space = cut.search(/\s\S*$/);
    if (space > max * 0.5) cut = cut.slice(0, space);
  }
  return `${cut.trimEnd().replace(/[,;:\s-]+$/, '')}…`;
}
