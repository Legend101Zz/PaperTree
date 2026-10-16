/**
 * The view model of ask → answer → trace (#202, DESIGN.md §4): a thread's messages become
 * exchanges, each a call slip (the ask), an answer split into paragraphs with their passage
 * markers, a trace of the passages it stands on, and the coverage counts. Pure; the `Exchange`
 * component draws it, `passages.ts` numbers the passages.
 */
import { dehyphenate } from '@/lib/markdown';

import {
  citationUse,
  handleRuns,
  numberPassages,
  passageKeyOf,
  runNumbers,
  type CitedAnswer,
  type PassageNumbers,
} from './passages';

import type { Anchor } from '@papertree/anchoring';
import type { Coverage, TraceRowData } from '@papertree/ui';
import type { Citation, MessageCoverage } from '@/lib/api/types';

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
  /** The server's coverage of a stored answer; absent while live. */
  readonly coverage?: MessageCoverage | null;
}

/** The passage the person selected, as the first call slip quotes it. */
export interface SlipQuote {
  readonly text: string;
  /** 1-based. */
  readonly page: number;
  /** 1-based ¶ on the page when a cited passage of the thread is the same block; else null. */
  readonly para: number | null;
}

/** One numbered marker: a passage of this answer, where it is, and the citation it flashes. */
export interface PassageMarker {
  readonly n: number;
  /** 1-based page. */
  readonly page: number;
  readonly para: number | null;
  /** A citation of this passage in this answer said the claim was not matched (dashed tab). */
  readonly notVerified: boolean;
  /** The first citation of the passage in this answer: its Anchor is what Show in paper flashes. */
  readonly citation: Citation;
}

/** One paragraph of an answer and the passages it cites (the margin cell, first use first). */
export interface AnswerParagraph {
  /** 0-based index in the answer's paragraph list (the server's `answer_paragraphs`). */
  readonly index: number;
  /** The paragraph's Markdown, `[bN]` handles kept for the renderer. */
  readonly text: string;
  readonly markers: readonly PassageMarker[];
  readonly cited: boolean;
}

/** One trace row: the `TraceRow` data plus the citation whose Anchor Show in paper flashes. */
export interface TraceEntry extends TraceRowData {
  readonly citation: Citation;
}

/** An answer, ready to draw. */
export interface AnswerModel {
  /** Paragraphs up to the last cited one, in order (an uncited one among them has `cited: false`). */
  readonly body: readonly AnswerParagraph[];
  /** The trailing uncited paragraphs: "no citation · the AI's own reading". Empty while streaming. */
  readonly uncited: readonly AnswerParagraph[];
  /** Handle → passage number in this answer, for the inline markers. */
  readonly handleNumbers: ReadonlyMap<string, number>;
  /** Passage number → its marker. */
  readonly markers: ReadonlyMap<number, PassageMarker>;
  /** The passages the answer stands on, by number. */
  readonly trace: readonly TraceEntry[];
  readonly coverage: Coverage;
}

/** One exchange: an ask and its answer. Named by its ask, never "Turn 1" (DESIGN.md §4.5). */
export interface Exchange<M extends ExchangeMessage = ExchangeMessage> {
  /** The answer's key when there is one (it outlives the stored user turn arriving), else the ask's. */
  readonly key: string;
  readonly ask: string;
  readonly askedAt: string | null;
  /** The selected passage: the first exchange of a thread opened from a selection only. */
  readonly quote: SlipQuote | null;
  readonly answer: M | null;
  /** Null until the answer has any text. */
  readonly model: AnswerModel | null;
}

/** What the thread was opened on: the selection's Anchor and its exact words. */
export interface ThreadOrigin {
  readonly anchor: Anchor;
  readonly quote: string;
}

const BLANK_LINE = /\n[ \t]*\n/;
const HEADING_ONLY = /^#{1,6}\s+\S[^\n]*$/;
/** A handle cut off by the end of a streaming chunk: `[`, `[b`, `[b12`, `[b1, b`. */
const PARTIAL_TAIL = /\s*\[(?:b\d*(?:\s*,\s*b?\d*)*)?\s*$/;

/**
 * An answer's paragraphs, by the server's rule (`exchanges.answer_paragraphs`, which
 * `MessageCoverage.uncited_paragraphs` indexes): split on blank lines, trim, drop empty pieces and
 * pieces that are one Markdown heading line.
 *
 * @param text The answer.
 * @returns Its paragraphs.
 */
export function answerParagraphs(text: string): string[] {
  return text
    .split(BLANK_LINE)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !HEADING_ONLY.test(part));
}

type Selector = { readonly type?: string } & Record<string, unknown>;

function selectorsOf(anchor: Anchor): readonly Selector[] {
  return (anchor as unknown as { selectors?: readonly Selector[] }).selectors ?? [];
}

function selector(anchor: Anchor, type: string): Selector | undefined {
  return selectorsOf(anchor).find((s) => s.type === type);
}

// The paper's words as a reader should see them: line-end hyphens joined, whitespace collapsed.
function cleanQuote(text: string): string {
  return dehyphenate(text).replace(/\s+/g, ' ').trim();
}

function quoteOf(citation: Citation): string {
  const exact = selector(citation.anchor, 'TextQuoteSelector')?.exact;
  return typeof exact === 'string' ? cleanQuote(exact) : '';
}

function whereOf(citation: Citation): string {
  const heading =
    citation.locator?.section_heading ??
    selector(citation.anchor, 'SectionPathSelector')?.headingText;
  return typeof heading === 'string' && heading.length > 0 ? heading : 'Section unknown';
}

function markerOf(n: number, citations: readonly Citation[]): PassageMarker {
  const first = citations[0] as Citation;
  return {
    n,
    page: (first.locator?.page_index ?? first.page_index) + 1,
    para: first.locator?.para_index ?? null,
    notVerified: citations.some((c) => c.supported === false),
    citation: first,
  };
}

// Every passage of an answer: its marker, cited count, and handle → number.
function answerPassages(answer: CitedAnswer, numbers: PassageNumbers) {
  const use = citationUse(answer);
  const byNumber = new Map<number, Citation[]>();
  const counts = new Map<number, number>();
  const handleNumbers = new Map<string, number>();
  const visit = (citation: Citation, occurrence: boolean): void => {
    const n = numbers.byKey.get(passageKeyOf(citation, numbers.keyOfHandle));
    if (n === undefined) return;
    handleNumbers.set(citation.marker, n);
    byNumber.set(n, [...(byNumber.get(n) ?? []), citation]);
    if (occurrence) counts.set(n, (counts.get(n) ?? 0) + 1);
  };
  use.occurrences.forEach((c) => visit(c, true));
  use.loose.forEach((c) => visit(c, false));
  const markers = new Map([...byNumber.entries()].map(([n, cs]) => [n, markerOf(n, cs)] as const));
  return { markers, counts, handleNumbers, occurrences: use.occurrences.length };
}

function traceOf(
  markers: ReadonlyMap<number, PassageMarker>,
  counts: ReadonlyMap<number, number>,
): TraceEntry[] {
  return [...markers.values()]
    .sort((a, b) => a.n - b.n)
    .map((marker) => ({
      n: marker.n,
      page: marker.page,
      para: marker.para,
      where: whereOf(marker.citation),
      citedCount: counts.get(marker.n) ?? 0,
      quote: quoteOf(marker.citation),
      status: marker.notVerified ? 'not-verified' : 'cited',
      citation: marker.citation,
    }));
}

/**
 * Build the drawable model of one answer.
 *
 * @param answer The answer message.
 * @param numbers The thread's passage numbering.
 * @returns The paragraphs, markers, trace and coverage.
 */
export function buildAnswer(answer: ExchangeMessage, numbers: PassageNumbers): AnswerModel {
  const streaming = answer.status === 'streaming';
  const text = streaming ? answer.text.replace(PARTIAL_TAIL, '') : answer.text;
  const passages = answerPassages(answer, numbers);
  const uncitedIndexes = new Set(
    answer.coverage?.uncited_paragraphs ??
      answerParagraphs(text).flatMap((p, i) => (handleRuns(p).length === 0 ? [i] : [])),
  );
  const paragraphs = answerParagraphs(text).map((paragraph, index) => {
    const ns = handleRuns(paragraph).flatMap((run) => runNumbers(run, answer, numbers));
    const markers = [...new Set(ns)].flatMap((n) => {
      const marker = passages.markers.get(n);
      return marker === undefined ? [] : [marker];
    });
    return { index, text: paragraph, markers, cited: streaming || !uncitedIndexes.has(index) };
  });
  // The trailing uncited run is the AI's own reading; an uncited paragraph between cited ones
  // stays in reading order, flagged, so moving it never breaks the answer's argument.
  let tail = paragraphs.length;
  while (tail > 0 && paragraphs[tail - 1]?.cited === false) tail -= 1;
  const trace = traceOf(passages.markers, passages.counts);
  return {
    body: paragraphs.slice(0, tail),
    uncited: paragraphs.slice(tail),
    handleNumbers: passages.handleNumbers,
    markers: passages.markers,
    trace,
    coverage: {
      passages: answer.coverage?.passages ?? trace.length,
      citations: answer.coverage?.citations ?? passages.occurrences,
      uncitedParagraphs: streaming ? 0 : paragraphs.filter((p) => !p.cited).length,
    },
  };
}

function slipQuote(origin: ThreadOrigin, answers: readonly ExchangeMessage[]): SlipQuote {
  const pageIndex = selector(origin.anchor, 'PageSelector')?.index;
  const blockId = selector(origin.anchor, 'BlockSelector')?.blockId;
  // The ¶ of the selection is known only when the thread cites that same block (a located
  // citation); a guessed number would be a misattribution (GAP-A2 Risks 1).
  const same = answers
    .flatMap((a) => a.citations)
    .find(
      (c) =>
        c.locator !== undefined &&
        selector(c.anchor, 'BlockSelector')?.blockId === blockId &&
        c.locator.page_index === pageIndex,
    );
  return {
    text: cleanQuote(origin.quote),
    page: (typeof pageIndex === 'number' ? pageIndex : 0) + 1,
    para: same?.locator?.para_index ?? null,
  };
}

/**
 * Pair a thread's messages into exchanges and build each answer's model.
 *
 * A user turn opens an exchange; the next answer closes it. An answer with no user turn before it
 * (a live first answer, whose ask the server has not echoed yet) opens its own exchange named by
 * the question it answers.
 *
 * @param messages The thread's messages, oldest first (live ones already merged in).
 * @param origin The selection the thread was opened on, or null for a free question.
 * @returns The exchanges, oldest first.
 */
export function buildExchanges<M extends ExchangeMessage>(
  messages: readonly M[],
  origin: ThreadOrigin | null,
): Exchange<M>[] {
  const answers = messages.filter((m) => m.role === 'assistant');
  const numbers = numberPassages(answers);
  const out: Exchange<M>[] = [];
  let open: { ask: M } | null = null;
  for (const message of messages) {
    if (message.role === 'user') {
      if (open !== null) out.push(exchangeOf(open.ask, null, numbers));
      open = { ask: message };
      continue;
    }
    out.push(exchangeOf(open?.ask ?? null, message, numbers));
    open = null;
  }
  if (open !== null) out.push(exchangeOf(open.ask, null, numbers));
  const first = out[0];
  if (first !== undefined && origin !== null) {
    out[0] = { ...first, quote: slipQuote(origin, answers) };
  }
  return out;
}

function exchangeOf<M extends ExchangeMessage>(
  ask: M | null,
  answer: M | null,
  numbers: PassageNumbers,
): Exchange<M> {
  const hasText = answer !== null && answer.text.trim().length > 0;
  return {
    key: answer?.key ?? ask?.key ?? '',
    ask: ask?.text ?? answer?.question ?? '',
    askedAt: ask?.createdAt ?? answer?.createdAt ?? null,
    quote: null,
    answer,
    model: hasText ? buildAnswer(answer, numbers) : null,
  };
}

/**
 * The call slip's time, `21:14` (24-hour, the reader's clock), or "" when unknown.
 *
 * @param iso An ISO timestamp, or null.
 * @param timeZone Optional IANA zone (tests pin it); the browser's own by default.
 * @returns The time of day.
 */
export function formatAskTime(iso: string | null, timeZone?: string): string {
  if (iso === null) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(date);
}
