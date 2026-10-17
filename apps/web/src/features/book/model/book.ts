/**
 * book/model/book — the words the pulled-out and opened book is made of (#200, frames 02a, 02):
 * the bookplate's lines, the meta line, the figures line and the Figure 1 offer, the counts, the
 * topic's source, the abstract excerpt. Pure: no React, no fetch; every rule is in `book.spec.ts`.
 * Nothing here invents a fact: a missing year, id, name or count is left out, never guessed.
 */
import { dehyphenate } from '@/lib/markdown';

import type { BookFigure, BookPaper, BookPlate } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "15 Oct 2026", in the viewer's time zone.
 *
 * @param iso - An ISO-8601 time.
 * @returns The date, or null when the time is not readable.
 */
export function longDate(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''} ${String(at.getFullYear())}`;
}

/**
 * The bookplate's foot: "PaperTree · shelved 15 Oct 2026".
 *
 * @param addedAt - When the paper was added (`created_at`).
 * @returns The line; just "PaperTree" when the date is not readable.
 */
export function shelvedLine(addedAt: string): string {
  const date = longDate(addedAt);
  return date === null ? 'PaperTree' : `PaperTree · shelved ${date}`;
}

/**
 * Whose library the bookplate names. Only the name the person chose: never the email's local part
 * (GAP-A1 D5, #192), so an unnamed library asks once, and after "Not now" the line is left out.
 *
 * @param displayName - `GET /auth/me`'s `display_name`.
 * @param declined - The person already said "Not now" to the question.
 * @returns `name` to print, `ask` for the question, or `none` to leave the line out.
 */
export function bookplateOwner(
  displayName: string | null | undefined,
  declined: boolean,
): { readonly kind: 'name'; readonly name: string } | { readonly kind: 'ask' | 'none' } {
  const name = (displayName ?? '').trim();
  if (name !== '') return { kind: 'name', name };
  return { kind: declined ? 'none' : 'ask' };
}

/**
 * "2017 · arXiv 1706.03762 · 15 pages": what the server knows, nothing guessed.
 *
 * @param paper - The book.
 * @returns The line, or '' when nothing is known.
 */
export function metaLine(paper: BookPaper): string {
  return [
    paper.year === null ? null : String(paper.year),
    paper.arxivId === null || paper.arxivId === undefined ? null : `arXiv ${paper.arxivId}`,
    paper.pageCount > 0 ? `${String(paper.pageCount)} pages` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/**
 * "Figure 1 (p. 3)".
 *
 * @param figure - A labelled figure.
 * @returns Its label and page.
 */
function figureAt(figure: BookFigure): string {
  return `${figure.label ?? 'A figure'} (p. ${String(figure.pageIndex + 1)})`;
}

/**
 * The figures line: "5 figures found · Figure 1 (p. 3), Figure 2 (p. 4)". The number is what the
 * parser FOUND, the distinct captioned figures (Figure 2 drawn as two regions is one), never the
 * paper's figure count: float detection misses some (#103; ResNet has 7 figures and 3 are found,
 * YOLO 6 and 5), so "found" sits on the number (#200 review S2).
 *
 * @param figures - `GET /papers/{id}/figures`, in reading order.
 * @returns The line; null when the parser found no figure at all.
 */
export function figuresLine(figures: readonly BookFigure[]): string | null {
  if (figures.length === 0) return null;
  const labelled = new Map<string, BookFigure>();
  for (const figure of figures) {
    if (figure.label !== null && !labelled.has(figure.label)) labelled.set(figure.label, figure);
  }
  if (labelled.size === 0) {
    const n = figures.length;
    return `${String(n)} figure${n === 1 ? '' : 's'} found, none with a caption`;
  }
  const n = labelled.size;
  const first = [...labelled.values()].slice(0, 2).map(figureAt).join(', ');
  return `${String(n)} figure${n === 1 ? '' : 's'} found · ${first}`;
}

/**
 * The figure "Use Figure 1 (p. 3) as the plate" offers: the region whose caption starts
 * "Figure 1" and that has both a crop and an Anchor. Null hides the offer (a3c's "Figure 1."
 * caption is attached to no figure; GPT-3 numbers its figures 1.1, 1.2). The typographic cover
 * stays the default either way.
 *
 * @param figures - The figures the parser found.
 * @returns The figure to offer, or null.
 */
export function figureOneOffer(figures: readonly BookFigure[]): BookFigure | null {
  return (
    figures.find((f) => f.label === 'Figure 1' && f.assetUrl !== null && f.anchor !== null) ?? null
  );
}

/**
 * "3 highlights", "1 explanation thread"; null for none.
 *
 * @param n - How many.
 * @param one - The noun for one.
 * @param many - The noun for more.
 * @returns The phrase, or null.
 */
function count(n: number, one: string, many: string): string | null {
  if (n <= 0) return null;
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * "3 highlights · 2 explanation threads · 1 notebook page": the person's work in the paper, from
 * the library row. A zero is left out; nothing at all says so.
 *
 * @param paper - The book.
 * @returns The line.
 */
export function countsLine(paper: BookPaper): string {
  const parts = [
    count(paper.highlightCount, 'highlight', 'highlights'),
    count(paper.threadCount ?? 0, 'explanation thread', 'explanation threads'),
    count(paper.notebookCount ?? 0, 'notebook page', 'notebook pages'),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'No highlights, threads or notebook pages yet' : parts.join(' · ');
}

/** The excerpt stops after the sentence that reaches this many characters. */
export const EXCERPT_CHARS = 360;

/**
 * The abstract's first sentences, as a reader should see them: a typesetter's line-end hyphen
 * joined, whitespace collapsed, whole sentences up to about `EXCERPT_CHARS` (always at least one).
 *
 * @param text - `GET /papers/{id}/abstract`'s text (the paper's words, line breaks kept).
 * @returns The excerpt, or null when there is no abstract.
 */
export function abstractExcerpt(text: string | null): string | null {
  if (text === null) return null;
  const flat = dehyphenate(text).replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  // A sentence ends at a stop followed by a space and a capital (or an opening quote or bracket):
  // "e.g. the", "Fig. 3" and "28.4 BLEU" do not end one (#200 review).
  const sentences = flat.split(/(?<=[.!?]["”’)]*)\s+(?=[A-Z“"(])/);
  let out = '';
  for (const sentence of sentences) {
    out = out === '' ? sentence : `${out} ${sentence}`;
    if (out.length >= EXCERPT_CHARS) break;
  }
  return out.trim();
}

/**
 * The arXiv abstract page, written out as the frame prints it.
 *
 * @param arxivId - The paper's arXiv id.
 * @returns `{href, label}`, or null without an id.
 */
export function arxivLink(
  arxivId: string | null | undefined,
): { href: string; label: string } | null {
  if (arxivId === null || arxivId === undefined) return null;
  const path = `arxiv.org/abs/${arxivId}`;
  return { href: `https://${path}`, label: path };
}

/**
 * Whether a book can be taken out and opened: the parse is in (complete or partial) and the paper
 * is the person's (a sample has no server to ask). A queued, reading or failed paper keeps the
 * catalogue card, where Retry and Delete are.
 *
 * @param paper - The book's processing state and sample flag.
 * @returns True when Enter should pull it out.
 */
export function canOpenBook(paper: Pick<BookPaper, 'processing' | 'isSample'>): boolean {
  return (
    paper.isSample !== true && (paper.processing === 'complete' || paper.processing === 'partial')
  );
}

/**
 * The plate's caption as frame 02a prints it: "Figure 1 (p. 3) · The Transformer - model
 * architecture." The words after the label are the paper's caption, line breaks joined.
 *
 * @param plate - The chosen plate.
 * @returns The caption line.
 */
export function plateCaption(
  plate: Pick<BookPlate, 'label' | 'pageIndex' | 'captionText'>,
): string {
  const where = `${plate.label ?? 'A figure'} (p. ${String(plate.pageIndex + 1)})`;
  const words = dehyphenate(plate.captionText ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:figure|fig\.?)\s*\d+(?:\.\d+)*\s*[:.]?\s*/i, '')
    .trim();
  return words === '' ? where : `${where} · ${words}`;
}

/** `GET /papers/{id}/summary`'s states. */
export type SummaryState = 'none' | 'running' | 'ready' | 'partial' | 'failed';

/**
 * What the Summary button and the words beside it say, from the summary route itself (the current
 * prompt version; #200 review S4). "(cached)" only for a complete summary that is there to read;
 * a partial one says so; with none the button offers to make one.
 *
 * @param state - The route's state, or null while it loads or when it could not be read.
 * @returns The button's label and the line beside it ('' says nothing).
 */
export function summaryLine(state: SummaryState | null): { button: string; line: string } {
  switch (state) {
    case 'ready':
      return { button: 'Summary', line: 'Summary ready (cached)' };
    case 'partial':
      return { button: 'Summary', line: 'Summary cached (partial: some points have no passage)' };
    case 'running':
      return { button: 'Summary', line: 'A summary is being written' };
    case 'failed':
      return { button: 'Summarize', line: 'The last summary did not finish' };
    case 'none':
      return { button: 'Summarize', line: 'No summary yet' };
    default:
      return { button: 'Summary', line: '' };
  }
}
