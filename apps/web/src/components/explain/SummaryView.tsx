'use client';

/**
 * explain/SummaryView — the paper summary while it is looked for or written, and when it fails
 * (contracts.md §2.5). Once there is one to show, the panel draws it as an exchange
 * (`features/explain/components/SummaryExchange`, #204). A new run shows its progress label and Stop.
 */
import { AiText } from '@papertree/ui';
import type { ReactNode } from 'react';

import { FailureNote, StatusLine } from '@/features/explain/components/AnswerStates';
import type { SummaryView as SummaryState } from './useExplainActions';

export interface SummaryViewProps {
  readonly state: SummaryState;
  readonly onRetry: () => void;
  readonly onStop: () => void;
}

export function SummaryView({ state, onRetry, onStop }: SummaryViewProps): ReactNode {
  const { phase } = state;

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

  return (
    <div className="pt-explain__summary" data-summary-phase="failed">
      <FailureNote
        failure={state.failure ?? { code: 'internal', retryable: true }}
        onRetry={onRetry}
      />
    </div>
  );
}
