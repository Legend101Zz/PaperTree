'use client';

/**
 * The answer's foot (prototype): the model, then `· writing…` and Stop while it streams, or
 * `· stopped` after Stop (the partial text stays; its note and Retry sit under the slip). The
 * model is the run's own, known once its usage lands; before that the thread's last known model
 * stands in, and a first answer says only that it is writing. The interface's words, never the
 * AI's, so it is outside the answer's text.
 */
import { useTakeFocus, type FocusHandoff } from './AnswerParts';
import { WorkingLabel } from './AnswerStates';

import './answer.css';

import type { ReactNode } from 'react';

/** Props for `AnswerFoot`. */
export interface AnswerFootProps {
  /** The short model name ("M3.1 Flash"), or null when none is known yet. */
  readonly model: string | null;
  readonly streaming: boolean;
  readonly stopped: boolean;
  /** What the AI is doing ("Reading the paper"); null says "writing". A quick ask never has one. */
  readonly label: string | null;
  readonly handoff: FocusHandoff;
  readonly onStop: () => void;
}

/** Stop, mounted only while the answer streams so it can take the focus a Retry hands it. */
function FootStop({ handoff, onStop }: Pick<AnswerFootProps, 'handoff' | 'onStop'>): ReactNode {
  const ref = useTakeFocus(handoff, 'stop');
  return (
    <button
      ref={ref}
      type="button"
      className="pt-answer-foot__stop"
      onClick={(event) => {
        if (document.activeElement === event.currentTarget) handoff.current = 'retry';
        onStop();
      }}
    >
      <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" className="pt-icon">
        <rect x="5.5" y="5.5" width="9" height="9" rx="1" fill="currentColor" />
      </svg>
      Stop
    </button>
  );
}

/** Model · writing… · Stop. */
export function AnswerFoot({
  model,
  streaming,
  stopped,
  label,
  handoff,
  onStop,
}: AnswerFootProps): ReactNode {
  if (!streaming && !stopped && model === null) return null;
  return (
    <div className="pt-answer-foot" data-answer-foot>
      {model === null ? null : <span>{model}</span>}
      {streaming ? (
        <>
          {model === null ? null : <span aria-hidden="true">·</span>}
          <WorkingLabel label={label ?? 'writing'} />
          <FootStop handoff={handoff} onStop={onStop} />
        </>
      ) : stopped ? (
        <>
          {model === null ? null : <span aria-hidden="true">·</span>}
          <span>stopped</span>
        </>
      ) : null}
    </div>
  );
}
