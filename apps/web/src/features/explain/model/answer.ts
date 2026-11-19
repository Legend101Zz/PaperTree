/**
 * One AI answer, ready to draw (#202, #340, DESIGN.md §4): its paragraphs, each with the pages of
 * the paper it draws on. Pure; `exchange.ts` pairs answers with their asks.
 *
 * THE AI IS A TUTOR, NOT AN AUDITOR. A paragraph's sources are the pages its `[bN]` handles point
 * at, de-duplicated and in page order ("From the paper: p. 1 · p. 4"); a paragraph none of whose
 * handles resolved has none, and the screen says "General knowledge" under it once the answer has
 * settled. There is no verdict, no count and no readout. The handles stay in the model's text (the
 * agent still emits them); the renderer never draws them, it gathers them here.
 *
 * While an answer streams, a handle resolves as soon as the thread has seen its citation (a
 * follow-up of a passage the thread already cites) and otherwise when the answer's own citations
 * arrive just before it settles; nothing is ever shown and then taken back.
 */
import { quoteOf } from './anchor';
import { parseCheck, type CheckSpec } from './check';
import { handleRuns, type ThreadHandles } from './passages';
import { parseAnswerItems, type SectionKey } from './sections';

import type { AnswerLevel, Citation, DiagramPart } from '@/lib/api/types';

/** The message fields an exchange is built from; the controller's `ViewMessage` has them all. */
export interface ExchangeMessage {
  /** Stable for the message's whole life on screen (live or stored). */
  readonly key: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly status: 'streaming' | 'complete' | 'partial' | 'error' | 'aborted';
  readonly citations: readonly Citation[];
  /** For an answer: the ask it answers (the ask of an exchange whose user turn is not loaded). */
  readonly question: string;
  /** ISO time it was asked or written; null when unknown. */
  readonly createdAt: string | null;
  /** The parse generation of the run, when known. */
  readonly generation?: number | null;
  /**
   * Stopped, and its stored copy (with the citations minted for it) has not landed yet: drawn as
   * while streaming (#204).
   */
  readonly awaitingStored?: boolean;
  /** The level the answer was written at; absent or null on an older one (= familiar). */
  readonly level?: AnswerLevel | null;
  /** For a sibling at another level: the id of the answer it re-levels (`relevel_of`). */
  readonly relevelOf?: string | null;
  /** The server's id once known (a sibling joins the exchange of the answer that has this id). */
  readonly messageId?: string | null;
  /** A diagram answer's parts (#217): their located Anchors place the call slip's ¶. */
  readonly diagram?: { readonly parts: readonly Pick<DiagramPart, 'cite'>[] } | null;
}

/** One page a paragraph draws on, and the citation whose Anchor Show in paper flashes. */
export interface PaperSource {
  /** 1-based page. */
  readonly page: number;
  /** The passage's words (the peek shows its first few); "" when its Anchor quotes nothing. */
  readonly passage: string;
  /** The first citation of this page in the paragraph. */
  readonly citation: Citation;
}

/** One paragraph of an answer and the pages it draws on (page order, each page once). */
export interface AnswerParagraph {
  /** 0-based index in the answer's paragraph list (the server's `answer_paragraphs`). */
  readonly index: number;
  /** The paragraph's Markdown, `[bN]` handles kept (the renderer drops them). */
  readonly text: string;
  readonly sources: readonly PaperSource[];
  /** The tutor format's section it sits in (the TL;DR one is the lead); null in an older answer. */
  readonly section?: SectionKey | null;
}

/** One thing to draw, in reading order: a section label, a paragraph, the figure or the check. */
export type AnswerBlock =
  | { readonly k: 'label'; readonly section: SectionKey }
  | { readonly k: 'p'; readonly paragraph: AnswerParagraph }
  | { readonly k: 'diagram'; readonly body: string; readonly closed: boolean }
  | { readonly k: 'check'; readonly spec: CheckSpec };

/** An answer, ready to draw. */
export interface AnswerModel {
  /** The paragraphs alone (what the phone clips, the fold previews and the card counts). */
  readonly paragraphs: readonly AnswerParagraph[];
  /** Everything in reading order: labels, paragraphs, the inline figure and the check. */
  readonly blocks: readonly AnswerBlock[];
  /** Still streaming (or stopped and waiting for its stored copy): no "General knowledge" yet. */
  readonly live: boolean;
}

/** A handle cut off by the end of a streaming chunk: `[`, `[b`, `[b12`, `[b1, b`. */
const PARTIAL_TAIL = /\s*\[(?:b\d*(?:\s*,\s*b?\d*)*)?\s*$/;

/**
 * What a streaming OR stopped (cancelled, partial) answer shows as text: a handle run cut off by
 * the end of the text is dropped, so `[b1, b` never reaches the screen.
 *
 * @param text The answer so far.
 * @returns The text without a trailing unfinished handle.
 */
export function stripPartialTail(text: string): string {
  return text.replace(PARTIAL_TAIL, '');
}

/**
 * The 1-based page of a citation: its locator's, else its own.
 *
 * @param citation The citation.
 * @returns The page.
 */
export function pageOf(citation: Citation): number {
  return (citation.locator?.page_index ?? citation.page_index) + 1;
}

/**
 * The pages a set of citations draws on: one source per page (the first citation seen on it),
 * in page order.
 *
 * @param citations The citations a paragraph (or bullet) cites, in reading order.
 * @returns The sources, ascending by page.
 * @example
 * sourcesOf([citationOnPage3, citationOnPage1]).map((s) => s.page); // [1, 3]
 */
export function sourcesOf(citations: readonly Citation[]): PaperSource[] {
  const byPage = new Map<number, PaperSource>();
  for (const citation of citations) {
    const page = pageOf(citation);
    if (!byPage.has(page)) byPage.set(page, { page, passage: quoteOf(citation.anchor), citation });
  }
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

/**
 * The drawable model of an answer's text: its blocks and paragraphs, each paragraph with the pages
 * its handles point at. Shared by the panel, the board card and the notebook page, so the same
 * answer reads the same everywhere.
 *
 * @param text The answer, cut-off handles already removed.
 * @param resolve The citation a handle names, or undefined when it names nothing yet.
 * @param live The text is still arriving: a half-written figure is a placeholder, not dropped.
 * @returns The model.
 */
export function answerModel(
  text: string,
  resolve: (handle: string) => Citation | undefined,
  live: boolean,
): AnswerModel {
  const paragraphs: AnswerParagraph[] = [];
  const blocks: AnswerBlock[] = [];
  for (const item of parseAnswerItems(text, live)) {
    if (item.k === 'label') blocks.push(item);
    else if (item.k === 'diagram') {
      // A cut-off answer's open fence is no figure: never show raw lines, never a placeholder
      // that waits for nothing.
      if (item.closed || live) blocks.push(item);
    } else if (item.k === 'check') {
      const spec = parseCheck(item.body);
      if (spec !== null) blocks.push({ k: 'check', spec });
    } else {
      const paragraph: AnswerParagraph = {
        index: paragraphs.length,
        text: item.text,
        section: item.section,
        sources: sourcesOf(
          handleRuns(item.text)
            .flat()
            .flatMap((h) => resolve(h) ?? []),
        ),
      };
      paragraphs.push(paragraph);
      blocks.push({ k: 'p', paragraph });
    }
  }
  return { paragraphs, blocks, live };
}

/**
 * Build the drawable model of one answer.
 *
 * @param answer The answer message.
 * @param numbers The thread's handles (resolve a handle of a passage the thread already cites,
 *   before this answer's own citations arrive).
 * @returns The paragraphs, each with its sources, and the blocks in reading order.
 */
export function buildAnswer(answer: ExchangeMessage, numbers: ThreadHandles): AnswerModel {
  // Stopped and waiting for the stored copy counts as live (#204).
  const live = answer.status === 'streaming' || answer.awaitingStored === true;
  // A cut-off answer (streaming, stopped, failed) can end inside a handle run (S9-4): drop it.
  const text = answer.status === 'complete' ? answer.text : stripPartialTail(answer.text);
  const own = new Map(answer.citations.map((c) => [c.marker, c] as const));
  const resolve = (handle: string): Citation | undefined =>
    own.get(handle) ?? (live ? numbers.handleCitations.get(handle)?.citation : undefined);
  return answerModel(text, resolve, live);
}
