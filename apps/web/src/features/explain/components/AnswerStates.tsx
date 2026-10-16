'use client';

/**
 * The interface's own lines around an AI answer (moved from `components/explain/AnswerView` with
 * #202): the status label while it works, a designed failure with its next step, and the usage
 * line, which always says "(estimate)". None of them is the AI's voice, so none sits in its words.
 */
import { useEffect, useState, type ReactNode } from 'react';

import { describeFailure, type Failure } from '@/components/explain/errors';
import { usageApi } from '@/lib/api/usage';

import type { RunSummary } from '@/lib/api/types';

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
  if (usage.cost_usd_est !== null) parts.push(`≈ $${usage.cost_usd_est.toFixed(4)} (estimate)`);
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

/** "≈ $0.97 of $1.00 used in the last 24 hours (estimate)": the numbers behind a budget refusal. */
function BudgetDetail(): ReactNode {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    usageApi.get().then(
      (usage) => {
        if (live) {
          setLine(
            `≈ $${usage.cost_usd_est.toFixed(2)} of $${usage.budget_usd.toFixed(2)} used in the last 24 hours (estimate).`,
          );
        }
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return line === null ? null : <p data-budget-detail>{line}</p>;
}

/** Props for `FailureNote`. */
export interface FailureNoteProps {
  readonly failure: Failure;
  /** Omitted when a retry cannot help. */
  readonly onRetry?: (() => void) | undefined;
}

/** A failure as a sentence and a next step, with Retry when a retry can help. */
export function FailureNote({ failure, onRetry }: FailureNoteProps): ReactNode {
  const copy = describeFailure(failure);
  return (
    <div className="pt-explain__error" role="alert" data-error-code={failure.code}>
      <p className="pt-explain__error-title">{copy.sentence}</p>
      <p>{copy.next}</p>
      {failure.code === 'budget_exhausted' ? <BudgetDetail /> : null}
      {copy.canRetry && onRetry !== undefined ? (
        <button type="button" className="pt-btn pt-btn--outline" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
