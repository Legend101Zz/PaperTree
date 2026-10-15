'use client';

/**
 * explain/AnswerView — one assistant answer (moved from `inspector/`, R12; rewritten for threads).
 *
 * The model's words go through `AiText` and nowhere else, so they carry the reserved ⊙ and the
 * "AI interpretation" label; the paper's words (the quote above the thread) go through `PaperText`.
 * Everything that is not the model's prose — the status label, the stopped note, the error, the
 * usage line, Send to canvas — sits OUTSIDE the AI block, in the interface's own voice.
 */
import { AiText } from '@papertree/ui';
import { useEffect, useState, type ReactNode } from 'react';

import { usageApi } from '@/lib/api/usage';
import type { Citation, RunSummary } from '@/lib/api/types';

import { describeFailure } from './errors';
import { RichText } from './RichText';
import type { ViewMessage } from './useExplainActions';

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

export function UsageLine({ usage }: { readonly usage: RunSummary | null }): ReactNode {
  const text = formatUsage(usage);
  // A run that used nothing (it failed before the model answered) has no usage worth a line.
  const spent = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
  if (text === null || spent === 0) return null;
  return (
    <p className="pt-explain__usage" data-usage-line>
      {text}
    </p>
  );
}

export function StatusLine({ label }: { readonly label: string }): ReactNode {
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

export function FailureNote({
  failure,
  onRetry,
}: {
  readonly failure: NonNullable<ViewMessage['failure']>;
  readonly onRetry?: (() => void) | undefined;
}): ReactNode {
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

export interface AnswerViewProps {
  readonly message: ViewMessage;
  readonly onCite: (citation: Citation) => void;
  readonly onRetry: (key: string) => void;
  readonly onSendToCanvas: (messageId: string) => Promise<void>;
}

type SendState = 'idle' | 'sending' | 'sent' | 'failed';

export function AnswerView({
  message,
  onCite,
  onRetry,
  onSendToCanvas,
}: AnswerViewProps): ReactNode {
  const [send, setSend] = useState<SendState>('idle');
  const streaming = message.status === 'streaming';
  const hasText = message.text.trim().length > 0;
  const finished = message.status === 'complete' || message.status === 'partial';

  const sendToCanvas = (): void => {
    if (message.messageId === null) return;
    setSend('sending');
    onSendToCanvas(message.messageId).then(
      () => setSend('sent'),
      () => setSend('failed'),
    );
  };

  return (
    <article className="pt-explain__answer" data-message-status={message.status}>
      {!hasText && !streaming ? null : (
        <AiText className="pt-explain__ai">
          {hasText ? (
            <RichText
              text={message.text}
              citations={message.citations}
              streaming={streaming}
              onCite={onCite}
            />
          ) : (
            <div className="pt-explain__skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
          {streaming && message.label !== null ? <StatusLine label={message.label} /> : null}
        </AiText>
      )}

      {message.stopped ? (
        <p className="pt-explain__note" data-stopped>
          Stopped. The partial answer is kept above.
        </p>
      ) : null}

      {message.failure !== null && !message.stopped && message.status !== 'streaming' ? (
        <FailureNote
          failure={message.failure}
          onRetry={message.status === 'complete' ? undefined : () => onRetry(message.key)}
        />
      ) : null}
      {message.stopped ? (
        <div className="pt-explain__actions">
          <button
            type="button"
            className="pt-btn pt-btn--outline"
            onClick={() => onRetry(message.key)}
          >
            Retry
          </button>
        </div>
      ) : null}

      {!streaming ? <UsageLine usage={message.usage} /> : null}

      {message.status === 'complete' && finished && message.messageId !== null ? (
        <div className="pt-explain__actions">
          <button
            type="button"
            className="pt-btn pt-btn--outline"
            disabled={send === 'sending' || send === 'sent'}
            onClick={sendToCanvas}
          >
            {send === 'sending'
              ? 'Sending…'
              : send === 'sent'
                ? 'Sent to canvas'
                : 'Send to canvas'}
          </button>
          {send === 'failed' ? (
            <span className="pt-explain__note" role="alert">
              Couldn&apos;t send this to the canvas. Try again.
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
