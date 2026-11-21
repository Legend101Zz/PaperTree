/**
 * The paper summary as an exchange (#204, #340): its bullets, each with the pages of the paper it
 * draws on, and the footer's facts. Pure; `SummaryExchange` draws it.
 *
 * A summary citation carries no locator (#257): its page is the citation's own. The summary's
 * `[bN]` are its own run's handles, so the open thread's handles are never used.
 */
import { handleRuns } from './passages';
import { sourcesOf, type AnswerParagraph } from './answer';

import type { Citation, Summary } from '@/lib/api/types';

/** The summary, ready to draw: one paragraph (text and sources) per bullet. */
export interface SummaryModel {
  readonly bullets: readonly AnswerParagraph[];
}

// A bullet's citations in the order its text cites them (uncited ones last, as stored).
function inTextOrder(bullet: Summary['bullets'][number]): Citation[] {
  const order = handleRuns(bullet.text).flat();
  const at = (c: Citation): number => {
    const i = order.indexOf(c.marker);
    return i === -1 ? order.length : i;
  };
  return [...bullet.citations].sort((a, b) => at(a) - at(b));
}

/**
 * Build the summary's view model.
 *
 * @param summary The stored summary (`GET /papers/{id}/summary`).
 * @returns The bullets, each with its sources.
 */
export function buildSummary(summary: Summary): SummaryModel {
  return {
    bullets: summary.bullets.map((bullet, index) => ({
      index,
      text: bullet.text,
      sources: sourcesOf(inTextOrder(bullet)),
    })),
  };
}

/**
 * The day a summary was made, as the frame writes it: `15 Oct`.
 *
 * @param iso Its `created_at`.
 * @param timeZone Optional IANA zone (tests pin it).
 * @returns The day and month, or "" when the time is not readable.
 */
export function summaryDay(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(date);
}

/**
 * `MiniMax-M3.1-Flash` → `M3.1 Flash`: the design's short model name; the vendor is implied.
 *
 * @param model The stored model id.
 * @returns The short name, or "AI model" when unknown.
 */
export function shortModelName(model: string | undefined): string {
  if (model === undefined || model === '') return 'AI model';
  return model
    .replace(/^MiniMax-/i, '')
    .replace(/-Preview$/i, '')
    .replace(/-/g, ' ');
}
