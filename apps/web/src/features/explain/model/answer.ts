/**
 * One AI answer, ready to draw (#202, DESIGN.md §4): its paragraphs with their passage markers,
 * the uncited ones ("no citation · the AI's own reading"), the trace of the passages it stands on,
 * and the coverage counts. Pure; `exchange.ts` pairs answers with their asks, `passages.ts` numbers
 * the passages.
 *
 * TWO RULES THE SCREEN DEPENDS ON:
 * - A paragraph is cited only when one of its handles RESOLVES to a citation. A `[b9]` the run never
 *   resolved draws no marker, so its paragraph is the AI's own reading and the readout counts it
 *   (§4.6: every claim on screen carries a marker, or says it has none). The server's
 *   `uncited_paragraphs` counts any handle, so it is not used for this.
 * - Markers and tabs never change under the reader (review 1.3, #252). They appear as soon as a
 *   handle resolves (live, for a passage the thread already cited; else when the answer settles),
 *   with the locator the thread already knows for the passage (else the page alone), and
 *   `mergeStored` keeps the citations they were drawn from when the stored copy lands, so the same
 *   marker stays, same number, same node, same tab. Nothing is hidden once shown.
 */
import { quoteOf, selectorOf } from './anchor';
import { citationUse, handleRuns, passageKeyOf, runNumbers, type PassageNumbers } from './passages';

import type { Coverage, TraceRowData } from '@papertree/ui';
import type { Citation, MessageCoverage, PassageLocator } from '@/lib/api/types';

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
  /** The server's coverage of a stored answer; absent or null while live. */
  readonly coverage?: MessageCoverage | null;
  /** The parse generation of the run, when known (the passage key needs it). */
  readonly generation?: number | null;
  /**
   * Stopped, and its stored copy (with the citations minted for it) has not landed yet: drawn as
   * while streaming (#204).
   */
  readonly awaitingStored?: boolean;
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
  /** Where it is, from its locator (its own or the thread's); null when nothing placed it. */
  readonly locator: PassageLocator | null;
}

/** One paragraph of an answer and the passages it cites (the margin cell, first use first). */
export interface AnswerParagraph {
  /** 0-based index in the answer's paragraph list (the server's `answer_paragraphs`). */
  readonly index: number;
  /** The paragraph's Markdown, `[bN]` handles kept for the renderer. */
  readonly text: string;
  readonly markers: readonly PassageMarker[];
  /** At least one of its handles resolved to a passage. */
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
  /** Handle → passage number in this answer, for the inline markers (live: the resolved ones). */
  readonly handleNumbers: ReadonlyMap<string, number>;
  /** Passage number → its marker (page, ¶, the citation to flash). */
  readonly markers: ReadonlyMap<number, PassageMarker>;
  /** The passages the answer stands on, by number. */
  readonly trace: readonly TraceEntry[];
  readonly coverage: Coverage;
  /** Handles the AI wrote that resolved to no passage (`[b9]`); none of them draws a marker. */
  readonly unresolvedMarkers: number;
  /** Still streaming: no trace and nothing classed uncited yet; only resolved handles draw markers. */
  readonly live: boolean;
}

const BLANK_LINE = /\n[ \t]*\n/;
const HEADING_ONLY = /^#{1,6}\s+\S[^\n]*$/;
/** A handle cut off by the end of a streaming chunk: `[`, `[b`, `[b12`, `[b1, b`. */
const PARTIAL_TAIL = /\s*\[(?:b\d*(?:\s*,\s*b?\d*)*)?\s*$/;

/**
 * An answer's paragraphs, by the server's rule (`exchanges.answer_paragraphs`): split on blank
 * lines, trim, drop empty pieces and pieces that are one Markdown heading line.
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

function markerOf(n: number, citations: readonly Citation[], locator: PassageLocator | null) {
  const first = citations[0] as Citation;
  return {
    n,
    page: (locator?.page_index ?? first.page_index) + 1,
    para: locator?.para_index ?? null,
    notVerified: citations.some((c) => c.supported === false),
    citation: first,
    locator,
  };
}

// Every passage of an answer: its marker, cited count, and handle → number. While it streams (and
// after Stop, until the stored copy lands with its own), a handle the thread already resolved draws its
// marker at once (#204); its verdict is this claim's, not the earlier one's, so none is borrowed
// (`supported: null` until this answer's own citations arrive).
function answerPassages(answer: ExchangeMessage, numbers: PassageNumbers, live: boolean) {
  const use = citationUse(answer);
  const byNumber = new Map<number, { cs: Citation[]; locator: PassageLocator | null }>();
  const counts = new Map<number, number>();
  const handleNumbers = new Map<string, number>();
  const visit = (citation: Citation, occurrence: boolean, known?: string): void => {
    const key = known ?? passageKeyOf(citation, numbers.keyOfHandle, answer.generation);
    const n = numbers.byKey.get(key);
    if (n === undefined) return;
    handleNumbers.set(citation.marker, n);
    const entry = byNumber.get(n);
    const locator = citation.locator ?? numbers.locatorOfKey.get(key) ?? null;
    if (entry === undefined) byNumber.set(n, { cs: [citation], locator });
    else entry.cs.push(citation);
    if (occurrence) counts.set(n, (counts.get(n) ?? 0) + 1);
  };
  use.occurrences.forEach((c) => visit(c, true));
  use.loose.forEach((c) => visit(c, false));
  if (live) {
    const own = new Set(answer.citations.map((c) => c.marker));
    for (const handle of handleRuns(answer.text).flat()) {
      const known = own.has(handle) ? undefined : numbers.handleCitations.get(handle);
      if (known !== undefined) visit({ ...known.citation, supported: null }, true, known.key);
    }
  }
  const markers = new Map(
    [...byNumber.entries()].map(([n, e]) => [n, markerOf(n, e.cs, e.locator)] as const),
  );
  const handles = handleRuns(answer.text).flat().length;
  const occurrences = [...counts.values()].reduce((sum, c) => sum + c, 0);
  return { markers, counts, handleNumbers, occurrences, handles };
}

function whereOf(marker: PassageMarker): string {
  const heading =
    marker.locator?.section_heading ??
    selectorOf(marker.citation.anchor, 'SectionPathSelector')?.headingText;
  return heading !== undefined && heading !== null && heading.length > 0
    ? heading
    : 'Section unknown';
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
      where: whereOf(marker),
      citedCount: counts.get(marker.n) ?? 0,
      quote: quoteOf(marker.citation.anchor),
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
  // Stopped and waiting for the stored copy counts as live: a paragraph whose handle the thread has
  // not seen yet is held as cited, not shown "uncited" and then moved when the copy lands (#204).
  const streaming = answer.status === 'streaming' || answer.awaitingStored === true;
  // A cut-off answer (streaming, stopped, failed) can end inside a handle run (S9-4): drop it.
  const text = answer.status === 'complete' ? answer.text : answer.text.replace(PARTIAL_TAIL, '');
  const passages = answerPassages(answer, numbers, streaming);
  const paragraphs = answerParagraphs(text).map((paragraph, index) => {
    const ns = streaming
      ? handleRuns(paragraph)
          .flat()
          .flatMap((h) => passages.handleNumbers.get(h) ?? [])
      : handleRuns(paragraph).flatMap((run) => runNumbers(run, answer, numbers));
    const markers = [...new Set(ns)].flatMap((n) => passages.markers.get(n) ?? []);
    return { index, text: paragraph, markers, cited: streaming || markers.length > 0 };
  });
  // The trailing uncited run is the AI's own reading; an uncited paragraph between cited ones
  // stays in reading order, flagged, so moving it never breaks the answer's argument.
  let tail = paragraphs.length;
  while (tail > 0 && paragraphs[tail - 1]?.cited === false) tail -= 1;
  const trace = streaming ? [] : traceOf(passages.markers, passages.counts);
  return {
    body: paragraphs.slice(0, tail),
    uncited: paragraphs.slice(tail),
    handleNumbers: passages.handleNumbers,
    markers: passages.markers,
    trace,
    coverage: {
      passages: answer.coverage?.passages ?? passages.markers.size,
      citations: answer.coverage?.citations ?? passages.occurrences,
      uncitedParagraphs: streaming ? 0 : paragraphs.filter((p) => !p.cited).length,
    },
    unresolvedMarkers:
      answer.coverage?.unresolved_markers ?? passages.handles - passages.occurrences,
    live: streaming,
  };
}
