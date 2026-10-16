'use client';

/**
 * explain/SummaryView — the paper summary (contracts.md §2.5): 5 to 8 bullets, each with its own
 * chips. The cached summary renders straight from `GET /summary`; a new run shows its progress
 * label first. A `partial` summary says so in a plain sentence: some points have no passage.
 */
import { AiText } from '@papertree/ui';
import type { ReactNode } from 'react';

import type { Citation } from '@/lib/api/types';

import { FailureNote, StatusLine, UsageLine } from '@/features/explain/components/AnswerStates';
import { RichText } from './RichText';
import type { SummaryView as SummaryState } from './useExplainActions';

export interface SummaryViewProps {
  readonly state: SummaryState;
  readonly onCite: (citation: Citation) => void;
  readonly onRetry: () => void;
  readonly onRegenerate: () => void;
  readonly onStop: () => void;
}

export function SummaryView({
  state,
  onCite,
  onRetry,
  onRegenerate,
  onStop,
}: SummaryViewProps): ReactNode {
  const { phase, summary } = state;

  if (phase === 'idle' || phase === 'loading' || phase === 'streaming') {
    return (
      <div className="pt-explain__summary" data-summary-phase={phase}>
        <AiText className="pt-explain__ai">
          <div className="pt-explain__skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <StatusLine label={state.label ?? 'Looking for a saved summary'} />
        </AiText>
        {phase === 'streaming' ? (
          <div className="pt-explain__actions">
            <button type="button" className="pt-btn pt-btn--outline" onClick={onStop}>
              Stop
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (phase === 'failed' || summary === null) {
    return (
      <div className="pt-explain__summary" data-summary-phase="failed">
        <FailureNote
          failure={state.failure ?? { code: 'internal', retryable: true }}
          onRetry={onRetry}
        />
      </div>
    );
  }

  return (
    <div className="pt-explain__summary" data-summary-phase={phase}>
      {phase === 'partial' || summary.status === 'partial' ? (
        <p className="pt-explain__warn" role="note" data-summary-warning>
          Some points could not be linked to a passage.
        </p>
      ) : null}
      <AiText className="pt-explain__ai">
        <ul className="pt-explain__bullets">
          {summary.bullets.map((bullet, index) => (
            <li key={index} data-summary-bullet data-supported={String(bullet.supported)}>
              <RichText text={bullet.text} citations={bullet.citations} onCite={onCite} />
              {bullet.citations.length === 0 ? (
                <span className="pt-explain__note">No linked passage</span>
              ) : null}
            </li>
          ))}
        </ul>
      </AiText>
      <UsageLine usage={state.usage} />
      {phase === 'partial' || summary.status === 'partial' ? (
        <div className="pt-explain__actions">
          <button
            type="button"
            className="pt-btn pt-btn--outline"
            data-summary-regenerate
            onClick={onRegenerate}
          >
            Regenerate summary
          </button>
        </div>
      ) : null}
    </div>
  );
}
