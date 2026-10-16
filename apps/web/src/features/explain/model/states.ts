/**
 * The interface's own words around an answer that did not simply finish (#204, frames 04b/04c):
 * the note after Stop, whether a question was refused before it was sent, the daily-cap figures
 * and today's usage by kind, and when an earlier exchange opens folded. Pure: no React, no fetch;
 * `AnswerSlip`, `BudgetCard` and `Exchange` draw them.
 */
import { formatCoverage, type Coverage } from '@papertree/ui';

import { parseMarkdown, type Inline } from '@/lib/markdown';

import type { ThreadMessage } from './messages';
import type { ErrorCode } from '@/lib/api/types';
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

/** The documented pre-stream refusals of `routers/threads.py` (PRE-STREAM ERRORS): none wrote a row. */
const PRE_STREAM: ReadonlySet<string> = new Set<ErrorCode>([
  'not_found',
  'not_configured',
  'not_parsed',
  'validation_failed',
  'anchor_mismatch',
  'anchor_incomplete',
  'busy',
  'budget_exhausted',
  'agent_unavailable',
]);

/**
 * Whether an error before the first event means the server refused the question unsent: a 4xx or
 * 5xx carrying one of the documented pre-stream codes. A 200 that streamed nothing, or a proxy's
 * own 502 page, is not this: the rows may have been written.
 *
 * @param status The HTTP status.
 * @param code The error's code.
 * @returns True when nothing was sent to the AI.
 */
export function refusedBeforeStream(status: number, code: string): boolean {
  return status >= 400 && PRE_STREAM.has(code);
}

/**
 * Whether a new ask never reached the AI (`refusedBeforeStream`). A refused Retry is not this: its
 * question was sent once already, and the refusal sits on the answer (`refusal`).
 *
 * @param answer The answer the ask was waiting for.
 * @returns True when the ask was not sent.
 */
export function wasNotSent(answer: Pick<ThreadMessage, 'failure'> | null): boolean {
  return answer?.failure?.notSent === true;
}

/**
 * What a refusal says was kept, true at this moment: `kept` only while the box still holds the
 * refused question, `question` once it does not, `retry` for a refused Retry, `nothing` when nothing
 * was typed (an Explain from a selection).
 */
export type RefusalKind = 'kept' | 'question' | 'retry' | 'nothing';

/**
 * The refusal's sentence about what was not sent and what was kept.
 *
 * @param kind What was refused, and whether the box holds it.
 * @returns The sentence.
 */
export function refusalSentence(kind: RefusalKind): string {
  switch (kind) {
    case 'kept':
      return 'Your question was not sent; your text is kept in the box below.';
    case 'question':
      return 'Your question was not sent.';
    case 'retry':
      return 'Your retry was not sent; the answer above is as it was.';
    case 'nothing':
      return 'Nothing was sent to the AI.';
  }
}

/**
 * Dollars as the panel writes them: cents, or four decimals below a cent so real spend never reads
 * "$0.00" (run usage lines, the cap and today's rows all use it).
 *
 * @param usd An amount in US dollars.
 * @returns E.g. `$0.97`, `$0.0027`, `$0.00`.
 */
export function formatUsd(usd: number): string {
  return `$${usd > 0 && usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/**
 * The daily cap's figures: "≈ $0.97 of $1.00 used in the last 24 hours (estimate)."
 *
 * @param usage `GET /usage`.
 * @returns The sentence.
 */
export function budgetFigures(usage: Pick<UsageTotals, 'cost_usd_est' | 'budget_usd'>): string {
  const used = formatUsd(usage.cost_usd_est);
  return `≈ ${used} of ${formatUsd(usage.budget_usd)} used in the last 24 hours (estimate).`;
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
        line: `${runs} · ${tokens} tokens · ≈ ${formatUsd(bucket.cost_usd_est)} (estimate)`,
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

function plain(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'cite' ? n.after : plain(n.c)))
    .join('');
}

/**
 * A folded answer's preview: its first paragraph as plain words, read by the answer's own Markdown
 * parser (no handles, no marks; `d_model` keeps its underscore).
 *
 * @param paragraphs The answer's paragraphs.
 * @returns The preview text.
 */
export function foldedPreview(paragraphs: readonly { readonly text: string }[]): string {
  const lines = parseMarkdown(paragraphs[0]?.text ?? '').flatMap((b) =>
    b.k === 'p' ? b.lines.map(plain) : b.k === 'h' ? [plain(b.c)] : b.items.map(plain),
  );
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}
