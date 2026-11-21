/**
 * An answer's text as the tutor format lays it out (v0.3 answer format §1): section headings, the
 * paragraphs under them, and the two optional fences. Pure; `answer.ts` turns the paragraphs into
 * sources and `AnswerBody` draws the items.
 *
 *   ## TL;DR | In plain words | The trade-off | How it works | In the paper   -> a label
 *   ```mermaid ... ```   -> one inline figure drawn with Mermaid (`features/diagram` MermaidDiagram)
 *   ```diagram ... ```   -> an older stored answer's figure (plate lines, `features/diagram/model/fence`)
 *   ```check ... ```     -> one "Check yourself" blank (read by `./check`)
 *
 * It is a tolerant reader, never a validator. A heading that is not one of the five names stays
 * in the text as it always did (a heading-only line is dropped, a heading glued to text stays a
 * bold line), so an older stored answer, or a model that wrote its own headings, still renders.
 * While the answer streams, whatever is still arriving is held back rather than shown and then
 * taken back: a half-typed heading (`## In pl`), a half-typed fence marker, an open ```check
 * fence, and an open ```mermaid or ```diagram fence, which stands as a placeholder until it closes.
 */

/** The five sections the format names, in the order the model writes them. */
export type SectionKey = 'tldr' | 'plain' | 'tradeoff' | 'how' | 'paper';

/** The small lower-case label each section is drawn under (the prototype's words). */
export const SECTION_LABEL: Readonly<Record<SectionKey, string>> = {
  tldr: 'tl;dr',
  plain: 'in plain words',
  tradeoff: 'the trade-off',
  how: 'how it works',
  paper: 'in the paper',
};

const HEADINGS: ReadonlyMap<string, SectionKey> = new Map([
  ['tl;dr', 'tldr'],
  ['tldr', 'tldr'],
  ['tl dr', 'tldr'],
  ['in plain words', 'plain'],
  ['the trade-off', 'tradeoff'],
  ['the tradeoff', 'tradeoff'],
  ['the trade off', 'tradeoff'],
  ['trade-off', 'tradeoff'],
  ['how it works', 'how'],
  ['in the paper', 'paper'],
]);

/** One thing an answer holds, in reading order. */
export type AnswerItem =
  | { readonly k: 'label'; readonly section: SectionKey }
  /** A blank-line separated piece of Markdown, handles kept; `section` is the one it sits in. */
  | { readonly k: 'p'; readonly text: string; readonly section: SectionKey | null }
  /** The body of a ```diagram fence; `closed` is false while its closing fence has not arrived. */
  | { readonly k: 'diagram'; readonly body: string; readonly closed: boolean }
  /** The body of a ```mermaid fence; `closed` is false while its closing fence has not arrived. */
  | { readonly k: 'mermaid'; readonly body: string; readonly closed: boolean }
  /** The body of a ```check fence; only a closed one is drawn. */
  | { readonly k: 'check'; readonly body: string };

const BLANK_LINE = /\n[ \t]*\n/;
const HEADING_ONLY = /^#{1,6}\s+\S[^\n]*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*```\s*([A-Za-z]*)\s*$/;

/**
 * The section a heading line names, or null for any other heading.
 *
 * @param line One line of the answer.
 * @returns The section key.
 * @example
 * sectionOf('## The trade-off'); // 'tradeoff'
 */
export function sectionOf(line: string): SectionKey | null {
  const match = HEADING.exec(line);
  if (match === null) return null;
  // "**TL;DR**", "TL;DR:" and "In the Paper" all name the section.
  const name = (match[1] ?? '')
    .replace(/[*_`]/g, '')
    .replace(/[:.\s]+$/, '')
    .trim()
    .toLowerCase();
  return HEADINGS.get(name) ?? null;
}

/**
 * Which fence an opening line names.
 *
 * @param info What follows the opening backticks.
 * @param partial The line is the end of a streaming text and may be cut short.
 * @returns The fence we draw, or `other`.
 */
function fenceKind(info: string, partial: boolean): 'diagram' | 'mermaid' | 'check' | 'other' {
  const lower = info.toLowerCase();
  if (lower === 'diagram') return 'diagram';
  if (lower === 'mermaid') return 'mermaid';
  if (lower === 'check') return 'check';
  // The last line of a streaming answer is cut anywhere: "```diag" is the start of a diagram.
  if (partial && lower !== '' && 'diagram'.startsWith(lower)) return 'diagram';
  if (partial && lower !== '' && 'mermaid'.startsWith(lower)) return 'mermaid';
  if (partial && lower !== '' && 'check'.startsWith(lower)) return 'check';
  return 'other';
}

/**
 * The text a streaming answer shows: its last line, when still being typed, is held back if it
 * could turn into a heading or a fence marker (`#`, `## In pl`, `` ` ``, ``` `` ```), so no stray
 * mark ever flashes and goes. A complete line (one a newline follows) is never touched, and a
 * heading that is already one of the five names is a label at once.
 *
 * @param text The answer so far.
 * @returns The text without a trailing half-typed marker.
 */
function holdBack(text: string): string {
  const cut = text.lastIndexOf('\n') + 1;
  const tail = text.slice(cut);
  if (/^\s*`{1,2}\s*$/.test(tail)) return text.slice(0, cut);
  const heading = /^\s{0,3}#{1,6}\s*(.*)$/.exec(tail);
  if (heading === null) return text;
  const typed = (heading[1] ?? '').replace(/[*_`]/g, '').trim().toLowerCase();
  const growing = typed === '' || [...HEADINGS.keys()].some((name) => name.startsWith(typed));
  return growing && !HEADINGS.has(typed) ? text.slice(0, cut) : text;
}

/**
 * The buffered lines as `p` items, one per blank-line separated piece; the buffer is emptied.
 *
 * @param buffer The lines since the last label or fence.
 * @param section The section they sit in.
 * @param out Where the items go.
 */
function flushPieces(buffer: string[], section: SectionKey | null, out: AnswerItem[]): void {
  if (buffer.length === 0) return;
  const text = buffer.join('\n');
  buffer.length = 0;
  for (const piece of text.split(BLANK_LINE)) {
    const trimmed = piece.trim();
    // As before: a piece that is one unknown heading line is not a paragraph.
    if (trimmed === '' || HEADING_ONLY.test(trimmed)) continue;
    out.push({ k: 'p', text: trimmed, section });
  }
}

/**
 * An answer as its items: labels, paragraphs, and the two fences.
 *
 * @param text The answer (`[bN]` handles and all).
 * @param streaming The text is still arriving: half-typed marks are held back and an open
 *   diagram fence is returned as an unclosed item.
 * @returns The items in reading order. Text with no known heading is all `p` items with no section.
 */
export function parseAnswerItems(text: string, streaming = false): AnswerItem[] {
  const source = text.replace(/\r\n?/g, '\n');
  const lines = (streaming ? holdBack(source) : source).split('\n');
  const out: AnswerItem[] = [];
  const buffer: string[] = [];
  let section: SectionKey | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const fence = FENCE.exec(line);
    // Only the line the text ends on can be cut short; every earlier one ended with a newline.
    const kind =
      fence === null ? null : fenceKind(fence[1] ?? '', streaming && i === lines.length - 1);
    if (fence !== null && kind !== null) {
      // An unknown fence is just text: its lines join the paragraph around it.
      if (kind !== 'other') flushPieces(buffer, section, out);
      const body: string[] = [];
      let closed = false;
      for (i += 1; i < lines.length; i += 1) {
        if ((lines[i] as string).trim() === '```') {
          closed = true;
          break;
        }
        body.push(lines[i] as string);
      }
      const joined = body.join('\n');
      if (kind === 'diagram') out.push({ k: 'diagram', body: joined, closed });
      else if (kind === 'mermaid') out.push({ k: 'mermaid', body: joined, closed });
      else if (kind === 'check') {
        // A check is drawn only whole: an open one waits, and is never shown half-written.
        if (closed) out.push({ k: 'check', body: joined });
      } else buffer.push(joined);
      continue;
    }
    const named = sectionOf(line);
    if (named !== null) {
      flushPieces(buffer, section, out);
      section = named;
      out.push({ k: 'label', section: named });
      continue;
    }
    buffer.push(line);
  }
  flushPieces(buffer, section, out);
  return out;
}
