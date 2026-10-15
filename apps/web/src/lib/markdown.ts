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
 * (shown as a bold line), and the model's `[bN]` / `[b1, b2]` citation handles.
 */

export type Inline =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'em' | 'strong'; readonly c: readonly Inline[] }
  | { readonly t: 'code'; readonly v: string }
  /** `after` is the punctuation that directly follows the handle, kept with it (no line break between). */
  | { readonly t: 'cite'; readonly markers: readonly string[]; readonly after: string };

export type Block =
  | { readonly k: 'p'; readonly lines: readonly (readonly Inline[])[] }
  | { readonly k: 'h'; readonly c: readonly Inline[] }
  | { readonly k: 'ul'; readonly items: readonly (readonly Inline[])[] }
  | { readonly k: 'ol'; readonly start: number; readonly items: readonly (readonly Inline[])[] };

export interface ParseOptions {
  /** The text is still arriving: an unclosed marker at the end is dropped instead of shown. */
  readonly streaming?: boolean;
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
        if (node.v.length > match[0].length) out.push({ t: 'text', v: node.v.slice(match[0].length) });
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

export function parseInline(source: string, options: ParseOptions = {}, depth = 0): Inline[] {
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
      const opens = !isSpace(source[i + 1]) && (ch === '*' || !WORD.test(source[i - 1] ?? ' '));
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
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: 'ul' | 'ol'; start: number; items: string[] } | null = null;
  const inline = (s: string): Inline[] => parseInline(s, options);
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
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
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

/** The handles a tree mentions, in order (`b3`, `b4`). */
export function handlesInBlocks(blocks: readonly Block[]): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly Inline[]): void => {
    for (const node of nodes) {
      if (node.t === 'cite') out.push(...node.markers);
      else if (node.t === 'em' || node.t === 'strong') walk(node.c);
    }
  };
  for (const block of blocks) {
    if (block.k === 'p') block.lines.forEach(walk);
    else if (block.k === 'h') walk(block.c);
    else block.items.forEach(walk);
  }
  return out;
}

/** A tree as plain text, handles dropped (for tests and for aria text). */
export function plainText(blocks: readonly Block[]): string {
  const flat = (nodes: readonly Inline[]): string =>
    nodes
      .map((n) =>
        n.t === 'text' || n.t === 'code' ? n.v : n.t === 'cite' ? n.after : flat(n.c),
      )
      .join('');
  return blocks
    .map((b) =>
      b.k === 'p' ? b.lines.map(flat).join('\n') : b.k === 'h' ? flat(b.c) : b.items.map(flat).join('\n'),
    )
    .join('\n\n');
}

/** Words that follow a dangling hyphen in a real coordination ("pre- and post-training"). */
const COORDINATORS = new Set(['and', 'or', 'nor', 'to', 'vs', 'versus', 'but']);

/**
 * A passage as a reader should see it: a typesetter's line-end hyphen is removed ("sin- gle" and
 * "sin-\ngle" both read "single"). Only a hyphen that sits at a line break is touched: the PDF
 * selection turns the line break into a space or keeps it as a newline, and a real compound in
 * the middle of a line ("end-to-end") has no whitespace after its hyphen. Display only; the
 * stored quote is never changed.
 */
export function dehyphenate(text: string): string {
  return text
    .replace(/([\p{L}\p{N}-]*[\p{Ll}\p{N}])-[ \t]*\r?\n[ \t]*(\p{Ll})/gu, (_m, head: string, next: string) =>
      head.includes('-') ? `${head}-${next}` : `${head}${next}`,
    )
    .replace(
      /([\p{L}\p{N}-]*[\p{Ll}])- ([\p{Ll}][\p{L}]*)/gu,
      (m, head: string, word: string) =>
        COORDINATORS.has(word) ? m : head.includes('-') ? `${head}-${word}` : `${head}${word}`,
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
