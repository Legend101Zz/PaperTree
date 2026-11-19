/**
 * board/model/answerText — reading a stored tutor answer (v03-ANSWER-FORMAT section 1) as plain
 * text, for the outline, the Markdown export and the "what the AI will read" list.
 *
 * The answer is the Markdown the model wrote: `## TL;DR` and friends, `$…$` maths, an optional
 * ```diagram fence, an optional ```check fence, and `[b3]` handles on sentences that rest on the
 * paper. An older or odd answer without those sections degrades to plain paragraphs.
 */

/** One block of an answer. */
export type AnswerBlock =
  | { readonly kind: 'heading'; readonly label: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'diagram' }
  | { readonly kind: 'check' };

/** The only words that stand for a diagram in the exports: the picture itself stays on the card. */
export const DIAGRAM_PLACEHOLDER = '*[diagram: see the card]*';

const HANDLES = /\s*\[b\d+(?:\s*,\s*b\d+)*\]/g;
const MATH = /\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g;

/**
 * Drops the `[b3]` handles: they point at passages inside PaperTree and mean nothing outside it.
 *
 * @param text Answer text.
 * @returns The text without handles.
 */
export function stripHandles(text: string): string {
  return text.replace(HANDLES, '');
}

/**
 * Keeps the maths as `$…$` for a Markdown reader, with the typographic minus a model sometimes
 * writes turned back into the ASCII one TeX expects.
 *
 * @param text Answer text.
 * @returns The text with every maths span normalised.
 */
export function normaliseMath(text: string): string {
  return text.replace(MATH, (span) => span.replace(/−/g, '-'));
}

/**
 * Splits an answer into blocks: headings, paragraphs (blank-line separated), and the two fences.
 *
 * @param text The stored answer.
 * @returns Its blocks in order.
 */
export function answerBlocks(text: string): AnswerBlock[] {
  const out: AnswerBlock[] = [];
  let paragraph: string[] = [];
  let fence: { lang: string; lines: string[] } | null = null;
  const flush = (): void => {
    if (paragraph.length > 0) out.push({ kind: 'paragraph', text: paragraph.join('\n').trim() });
    paragraph = [];
  };
  for (const line of text.split('\n')) {
    if (fence !== null) {
      if (line.trimStart().startsWith('```')) {
        if (fence.lang === 'diagram') out.push({ kind: 'diagram' });
        else if (fence.lang === 'check') out.push({ kind: 'check' });
        else out.push({ kind: 'paragraph', text: fence.lines.join('\n') });
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const open = /^\s*```(\w*)/.exec(line);
    if (open !== null) {
      flush();
      fence = { lang: open[1] ?? '', lines: [] };
      continue;
    }
    const heading = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (heading !== null) {
      flush();
      out.push({ kind: 'heading', label: heading[1] ?? '' });
      continue;
    }
    if (line.trim() === '') flush();
    else paragraph.push(line);
  }
  // A fence the stream never closed is a diagram or check still being written: not part of the text.
  flush();
  return out;
}

/**
 * The first line of an answer: the TL;DR sentence or two (the first paragraph under the first
 * heading, or the first paragraph at all). It is what the outline shows for a folded answer and
 * what an old ancestor is sent as.
 *
 * @param text The stored answer.
 * @returns The first paragraph, handles removed and its lines joined; '' for an empty answer.
 */
export function firstLine(text: string): string {
  const first = answerBlocks(text).find((b) => b.kind === 'paragraph');
  return first === undefined
    ? ''
    : stripHandles(first.text)
        .replace(/\s*\n\s*/g, ' ')
        .trim();
}

/**
 * The first sentence of a text: what an old ancestor is sent as when it has no TL;DR line.
 *
 * @param text Any text.
 * @returns Up to and including the first sentence end, or all of it.
 */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = /[.!?](?=\s|$)/.exec(flat);
  return end === null ? flat : flat.slice(0, end.index + 1);
}

/**
 * The paragraphs of an answer as the Markdown export writes them: the TL;DR paragraph in bold (it
 * is the lead), other paragraphs as written, the diagram as a one-line note, section headings and
 * the Check-yourself block left out.
 *
 * @param text The stored answer.
 * @returns The export paragraphs, maths as `$…$`.
 */
export function exportParagraphs(text: string): string[] {
  const out: string[] = [];
  let lead = false;
  for (const block of answerBlocks(text)) {
    if (block.kind === 'heading') {
      lead = /^tl;?dr$/i.test(block.label.trim());
    } else if (block.kind === 'diagram') {
      out.push(DIAGRAM_PLACEHOLDER);
      lead = false;
    } else if (block.kind === 'paragraph') {
      const body = normaliseMath(stripHandles(block.text));
      out.push(lead ? `**${body}**` : body);
      lead = false;
    }
  }
  return out;
}

/**
 * About how many lines the rest of an answer takes, for the outline's "4 more lines".
 *
 * @param text The stored answer.
 * @param perLine How many characters a line holds.
 * @returns At least 1.
 */
export function moreLineCount(text: string, perLine = 42): number {
  const prose = answerBlocks(text)
    .filter((b): b is Extract<AnswerBlock, { kind: 'paragraph' }> => b.kind === 'paragraph')
    .map((b) => stripHandles(b.text).length)
    .reduce((a, b) => a + b, 0);
  return Math.max(1, Math.round(prose / perLine) - 1);
}
