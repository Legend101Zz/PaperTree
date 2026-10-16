/**
 * board/model/cards — what each index card shows, built from server data only (frame 06).
 *
 * Pure: no React, no fetch. Every number a card prints comes from a field the API returned (an
 * anchor's page, a notebook card's `counts`, a message's `coverage` and `run`); when the field is
 * absent the builder returns null and the card shows nothing in its place, never a made-up figure.
 * An answer's markers come from the explain panel's model (`features/explain`), never a second one.
 */
import { numberPassages, type PassageNumbers } from '@/features/explain/model/passages';
import { PAGE_WIDTH } from '@/features/notebook';

import type { Anchor } from '@papertree/anchoring';
import type { NotebookItemBox } from '../api/notebook';
import type { ExchangeMessage } from '@/features/explain/model/answer';
import type { CanvasNode, Message, MessageCoverage, RunSummary } from '@/lib/api/types';

/**
 * The 0-based page a stored anchor points at: its PageSelector, else its ShapeSelector.
 *
 * The paragraph number of a frame-06 tab ("¶1") is NOT in an anchor: the server derives it from
 * the parse on read for citations only (`PassageLocator`), so a passage card's tab shows the page.
 *
 * @param anchor The card's `source_anchor`, or null.
 * @returns The page index, or null when the anchor names none.
 */
export function anchorPageIndex(anchor: Anchor | null): number | null {
  if (anchor === null) return null;
  let shape: number | null = null;
  for (const selector of anchor.selectors) {
    if (selector.type === 'PageSelector') return selector.index;
    if (selector.type === 'ShapeSelector') shape ??= selector.pageIndex;
  }
  return shape;
}

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * A notebook card's counts line, e.g. "4 quotes · 1 sticky": the non-zero parts, in page order.
 *
 * @param counts The card's `counts` from the board read, or null.
 * @returns The line, "Empty page" when every count is zero, or null when there are no counts.
 */
export function countsLine(counts: CanvasNode['counts']): string | null {
  if (counts === null) return null;
  const parts = [
    [counts.quotes, 'quote', 'quotes'],
    [counts.stickies, 'sticky', 'stickies'],
    [counts.text, 'typed note', 'typed notes'],
    [counts.shapes, 'shape', 'shapes'],
    [counts.strokes, 'ink stroke', 'ink strokes'],
  ] as const;
  const shown = parts.filter(([n]) => n > 0).map(([n, one, many]) => plural(n, one, many));
  return shown.length === 0 ? 'Empty page' : shown.join(' · ');
}

/**
 * An explanation card's footer, "4 passages · 11 citations", from the message's coverage.
 *
 * @param coverage The stored answer's coverage, or null when it was not read.
 * @returns The footer, or null.
 */
export function coverageLine(coverage: MessageCoverage | null): string | null {
  if (coverage === null) return null;
  return `${plural(coverage.passages, 'passage', 'passages')} · ${plural(coverage.citations, 'citation', 'citations')}`;
}

/** What an explanation card needs from its thread. */
export interface ExplanationSource {
  /** The thread the answer is in (the reader's `&cite=` link reads only that one). */
  readonly threadId: string;
  /** The ask that came before the answer, in the person's words; null when there is none. */
  readonly question: string | null;
  /** The stored answer as the explain panel models it (its citations, coverage, generation). */
  readonly answer: ExchangeMessage;
  /** The thread's passage numbering (S4b's), so marker 2 is the same passage as in the panel. */
  readonly numbers: PassageNumbers;
  readonly run: RunSummary | null;
}

/**
 * A stored message in the explain panel's shape (`ExchangeMessage`).
 *
 * @param message The stored message.
 * @param question The ask it answers ("" for a user turn).
 * @returns The panel's message.
 */
function exchangeOf(message: Message, question: string): ExchangeMessage {
  return {
    key: message.message_id,
    role: message.role,
    text: message.content ?? '',
    status: message.status ?? 'complete',
    citations: message.citations ?? [],
    question,
    createdAt: message.created_at ?? null,
    coverage: message.coverage ?? null,
    generation: message.generation ?? null,
  };
}

/**
 * The card's view of one stored answer, numbered by the explain panel's own rule
 * (`numberPassages`: 1..k in the order the thread first cites each passage).
 *
 * @param threadId The thread the messages came from.
 * @param messages The thread's messages.
 * @param messageId The answer on the card.
 * @returns Its source, or null when the thread does not hold it.
 */
export function explanationSource(
  threadId: string,
  messages: readonly Message[],
  messageId: string,
): ExplanationSource | null {
  const ordered = [...messages].sort((a, b) => a.ordinal - b.ordinal);
  const at = ordered.findIndex((m) => m.message_id === messageId);
  const answer = ordered[at];
  if (answer === undefined) return null;
  const asked = ordered.slice(0, at).findLast((m) => m.role === 'user');
  const question = asked === undefined ? '' : asked.content.trim();
  return {
    threadId,
    question: question === '' ? null : question,
    answer: exchangeOf(answer, question),
    numbers: numberPassages(
      ordered.filter((m) => m.role === 'assistant').map((m) => exchangeOf(m, '')),
    ),
    run: answer.run ?? null,
  };
}

/** One item of a notebook page drawn in the card's miniature, in miniature pixels. */
export interface MiniatureBox {
  readonly id: string;
  readonly kind: NotebookItemBox['kind'];
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A notebook page's items scaled into a miniature `width` × `height`: the page is `PAGE_WIDTH`
 * units wide, so one factor maps both axes. Items wholly below the miniature are left out.
 *
 * @param items The page's items.
 * @param width The miniature's width in pixels.
 * @param height The miniature's height in pixels.
 * @returns The boxes, lowest `z` first.
 */
export function miniature(
  items: readonly NotebookItemBox[],
  width: number,
  height: number,
): MiniatureBox[] {
  const k = width / PAGE_WIDTH;
  return [...items]
    .sort((a, b) => a.z - b.z)
    .map((item) => ({
      id: item.item_id,
      kind: item.kind,
      left: item.x * k,
      top: item.y * k,
      width: Math.max(2, item.w * k),
      height: Math.max(2, item.h * k),
    }))
    .filter((box) => box.top < height);
}
