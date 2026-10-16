/**
 * The view model of ask → answer → trace (#202, DESIGN.md §4): a thread's messages become
 * exchanges, each a call slip (the ask), an answer split into paragraphs with their passage
 * markers, a trace of the passages it stands on, and the coverage counts. Pure; the `Exchange`
 * component draws it, `passages.ts` numbers the passages.
 */
import { cleanQuote, selectorOf } from './anchor';
import { buildAnswer, type AnswerModel, type ExchangeMessage } from './answer';
import { numberPassages, type PassageNumbers } from './passages';

import type { Anchor } from '@papertree/anchoring';

export {
  answerParagraphs,
  buildAnswer,
  type AnswerModel,
  type AnswerParagraph,
  type ExchangeMessage,
  type PassageMarker,
  type TraceEntry,
} from './answer';

/** The passage the person selected, as the first call slip quotes it. */
export interface SlipQuote {
  readonly text: string;
  /** 1-based; null when the selection's Anchor names no page (no tab is drawn, never a guess). */
  readonly page: number | null;
  /** 1-based ¶ on the page when a cited passage of the thread is the same block; else null. */
  readonly para: number | null;
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

function slipQuote(origin: ThreadOrigin, answers: readonly ExchangeMessage[]): SlipQuote {
  const pageIndex = selectorOf(origin.anchor, 'PageSelector')?.index;
  const blockId = selectorOf(origin.anchor, 'BlockSelector')?.blockId;
  // The ¶ of the selection is known only when the thread cites that same block (a located
  // citation); a guessed number would be a misattribution (GAP-A2 Risks 1).
  const same = answers
    .flatMap((a) => a.citations)
    .find(
      (c) =>
        c.locator !== undefined &&
        selectorOf(c.anchor, 'BlockSelector')?.blockId === blockId &&
        c.locator.page_index === pageIndex,
    );
  return {
    text: cleanQuote(origin.quote),
    page: pageIndex === undefined ? null : pageIndex + 1,
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
  const exchangeOf = (ask: M | null, answer: M | null): Exchange<M> =>
    exchangeFrom(ask, answer, numbers);
  const out: Exchange<M>[] = [];
  let open: { ask: M } | null = null;
  for (const message of messages) {
    if (message.role === 'user') {
      if (open !== null) out.push(exchangeOf(open.ask, null));
      open = { ask: message };
      continue;
    }
    out.push(exchangeOf(open?.ask ?? null, message));
    open = null;
  }
  if (open !== null) out.push(exchangeOf(open.ask, null));
  const first = out[0];
  if (first !== undefined && origin !== null) {
    out[0] = { ...first, quote: slipQuote(origin, answers) };
  }
  return out;
}

function exchangeFrom<M extends ExchangeMessage>(
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
