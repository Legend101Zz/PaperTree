'use client';

/**
 * The interface's own lines around an AI answer (moved from `components/explain/AnswerView` with
 * #202): the status label while it works, a designed failure with its next step, and the usage
 * line, which always says "(estimate)". None of them is the AI's voice, so none sits in its words.
 */
import { describeFailure, type Failure } from '@/components/explain/errors';

import { formatUsd, refusalSentence, type RefusalKind } from '../model/states';
import { BudgetCard } from './BudgetCard';

import type { RunSummary } from '@/lib/api/types';
import type { ReactNode } from 'react';

/**
 * A run's usage in words: `6,776 tokens · ≈ $0.0027 (estimate)`.
 *
 * @param usage The run summary, or null.
 * @returns The line, or null when there is nothing to say.
 */
export function formatUsage(usage: RunSummary | null): string | null {
  if (usage === null) return null;
  const parts: string[] = [];
  if (usage.input_tokens !== null || usage.output_tokens !== null) {
    const total = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
    parts.push(`${total.toLocaleString('en-US')} tokens`);
  }
  if (usage.cost_usd_est !== null) parts.push(`≈ ${formatUsd(usage.cost_usd_est)} (estimate)`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** Props for `UsageLine`. */
export interface UsageLineProps {
  readonly usage: RunSummary | null;
}

/** The usage line under AI work; nothing for a run that used nothing (it failed before the model). */
export function UsageLine({ usage }: UsageLineProps): ReactNode {
  const text = formatUsage(usage);
  const spent = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
  if (text === null || spent === 0) return null;
  return (
    <p className="pt-explain__usage" data-usage-line>
      {text}
    </p>
  );
}

/** Props for `StatusLine`. */
export interface StatusLineProps {
  /** What the AI is doing, e.g. "Reading the paper". Never a tool name or an id. */
  readonly label: string;
}

/** The working label with its dotted pulse, announced politely. */
export function StatusLine({ label }: StatusLineProps): ReactNode {
  return (
    <p className="pt-explain__status" role="status" data-status-label>
      <span className="pt-explain__pulse" aria-hidden="true" />
      {label}…
    </p>
  );
}

/** Props for `WorkingLabel`. */
export interface WorkingLabelProps {
  /** What the AI is doing ("Reading the paper"); never a tool name or an id. */
  readonly label: string;
}

/**
 * The working label on the AI tab row while an answer streams (frame 04b): three dots that pulse
 * (still under reduced motion) and the label, announced politely. Inline: it sits in the slip's
 * source line.
 */
export function WorkingLabel({ label }: WorkingLabelProps): ReactNode {
  return (
    <span className="pt-working" role="status" data-status-label>
      <span className="pt-working__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {label}…
    </span>
  );
}

/** Props for `FailureNote`. */
export interface FailureNoteProps {
  readonly failure: Failure;
  /** Omitted when a retry cannot help. */
  readonly onRetry?: (() => void) | undefined;
  /**
   * For a refusal before the stream: what was not sent and what was kept, true now (#204). The
   * daily-cap card says it; another refused Retry says it above its next step.
   */
  readonly refusal?: RefusalKind;
}

/** A failure as a sentence and a next step, with Retry when a retry can help. */
export function FailureNote({
  failure,
  onRetry,
  refusal = 'nothing',
}: FailureNoteProps): ReactNode {
  if (failure.code === 'budget_exhausted') return <BudgetCard lead={refusalSentence(refusal)} />;
  const copy = describeFailure(failure);
  return (
    <div className="pt-explain__error" role="alert" data-error-code={failure.code}>
      <p className="pt-explain__error-title">{copy.sentence}</p>
      {refusal === 'retry' ? <p>{refusalSentence(refusal)}</p> : null}
      <p>{copy.next}</p>
      {copy.canRetry && onRetry !== undefined ? (
        <button type="button" className="pt-btn pt-btn--outline" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
