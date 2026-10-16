/**
 * The interface's own words around an answer that did not simply finish (#204, frames 04b/04c):
 * the note after Stop, whether a question was refused before it was sent, the daily-cap figures
 * and today's usage by kind, and when an earlier exchange opens folded. Pure: no React, no fetch;
 * `AnswerSlip`, `BudgetCard` and `Exchange` draw them.
 */
import { formatCoverage, type Coverage } from '@papertree/ui';

import type { ThreadMessage } from './messages';
import type { UsageTotals } from '@/lib/api/usage';

/**
 * Whether the reader stopped this answer: Stop in this session, or a stored answer the server ended
 * `aborted` (only a cancel ends a run so; an agent that went away is `agent_unavailable`).
 *
 * @param answer The answer.
 * @returns True when it was stopped.
 */
export function wasStopped(answer: Pick<ThreadMessage, 'stopped' | 'status' | 'failure'>): boolean {
  return (
    answer.stopped ||
    (answer.status === 'aborted' && (answer.failure === null || answer.failure.code === 'aborted'))
  );
}

/**
 * The note after Stop. It never says "kept" when nothing arrived (#179, the v0.1 "kept above"
 * with nothing above).
 *
 * @param text The answer's text so far.
 * @returns The sentence.
 */
export function stoppedNote(text: string): string {
  return text.trim().length > 0
    ? 'Stopped. The part that arrived is kept.'
    : 'Stopped before any text arrived.';
}

/**
 * Whether the question never reached the AI: the server refused it with a JSON answer before the
 * stream, which writes no row (`routers/threads.py`, PRE-STREAM ERRORS). A transport failure is
 * not this: the request may have arrived.
 *
 * @param answer The answer the ask was waiting for.
 * @returns True when the ask was not sent.
 */
export function wasNotSent(answer: Pick<ThreadMessage, 'failure'> | null): boolean {
  return answer?.failure?.notSent === true;
}

/**
 * The daily cap's figures: "≈ $0.97 of $1.00 used in the last 24 hours (estimate)."
 *
 * @param usage `GET /usage`.
 * @returns The sentence.
 */
export function budgetFigures(usage: Pick<UsageTotals, 'cost_usd_est' | 'budget_usd'>): string {
  return `≈ $${usage.cost_usd_est.toFixed(2)} of $${usage.budget_usd.toFixed(2)} used in the last 24 hours (estimate).`;
}

/** One kind of AI work in today's usage. */
export interface UsageRow {
  readonly kind: string;
  readonly line: string;
}

const KINDS: readonly (readonly [keyof UsageTotals['by_kind'], string])[] = [
  ['explain', 'Explain'],
  ['ask', 'Questions'],
  ['summary', 'Summaries'],
];

/**
 * Today's usage by kind ("Explain · 3 runs · 12,345 tokens · ≈ $0.31 (estimate)"), kinds with no
 * run left out.
 *
 * @param usage `GET /usage`.
 * @returns One row per kind that ran.
 */
export function usageRows(usage: Pick<UsageTotals, 'by_kind'>): UsageRow[] {
  return KINDS.flatMap(([key, kind]) => {
    const bucket = usage.by_kind[key] as UsageTotals['by_kind'][typeof key] | undefined;
    if (bucket === undefined || bucket.runs === 0) return [];
    const tokens = (bucket.input_tokens + bucket.output_tokens).toLocaleString('en-US');
    const runs = bucket.runs === 1 ? '1 run' : `${String(bucket.runs)} runs`;
    return [
      {
        kind,
        line: `${runs} · ${tokens} tokens · ≈ $${bucket.cost_usd_est.toFixed(2)} (estimate)`,
      },
    ];
  });
}

/**
 * Whether an exchange opens folded: a long thread (three exchanges or more) opens with its last two
 * whole and the earlier answers folded to two lines and their counts. Decided once, when the
 * exchange first appears, so nothing folds under the reader while they read (owner may change).
 *
 * @param index The exchange's place, 0-based.
 * @param count How many exchanges the thread shows.
 * @returns True when it opens folded.
 */
export function opensFolded(index: number, count: number): boolean {
  return index < count - 2;
}

/**
 * A folded answer's counts, without the readout's "Stands on": "4 passages · 11 citations · 1
 * paragraph uncited (the AI's own reading)".
 *
 * @param coverage The answer's coverage.
 * @returns The line.
 */
export function foldedCounts(coverage: Coverage): string {
  return formatCoverage(coverage).replace(/^Stands on /, '');
}

const HANDLES = /\s*\[b\d+(?:\s*,\s*b\d+)*\]/g;

/**
 * A folded answer's preview: its first paragraph as plain words (no handles, no Markdown marks).
 *
 * @param paragraphs The answer's paragraphs.
 * @returns The preview text.
 */
export function foldedPreview(paragraphs: readonly { readonly text: string }[]): string {
  return (paragraphs[0]?.text ?? '')
    .replace(HANDLES, '')
    .replace(/[*_`#]/g, '')
    .trim();
}
