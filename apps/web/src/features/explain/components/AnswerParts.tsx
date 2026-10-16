'use client';

/**
 * The small interface pieces around one AI answer (#204), split out of `AnswerSlip`: Stop on the
 * tab row (sticky, so a long answer never scrolls it away), the note after Stop with Retry, the fold
 * row, Send to board and the skeleton. Focus hands over Stop → Retry → Stop through `FocusHandoff`,
 * so a keyboard reader never falls back to `<body>`.
 */
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';

import { foldedCounts, stoppedNote } from '../model/states';
import { UsageLine } from './AnswerStates';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { Coverage } from '@papertree/ui';

/** Which control takes focus when it next appears: set when the control before it had focus. */
export type FocusHandoff = MutableRefObject<'stop' | 'retry' | null>;

/**
 * A control that takes focus when it mounts, if the control before it had it (shared with the
 * diagram plate's Retry and Redraw, #217).
 *
 * @param handoff The exchange's hand-off.
 * @param mine Which control this is.
 * @returns The ref to put on the control.
 */
export function useTakeFocus(handoff: FocusHandoff, mine: 'stop' | 'retry') {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (handoff.current !== mine) return;
    handoff.current = null;
    ref.current?.focus({ preventScroll: true });
  }, [handoff, mine]);
  return ref;
}

/** Props for `StopButton`. */
export interface StopButtonProps {
  readonly handoff: FocusHandoff;
  readonly onStop: () => void;
}

/**
 * Stop on the AI tab row (frame 04b). Its row is sticky in the panel's scroll, so the button stays
 * in view however long the answer grows, and it never takes layout space.
 */
export function StopButton({ handoff, onStop }: StopButtonProps): ReactNode {
  const ref = useTakeFocus(handoff, 'stop');
  return (
    <div className="pt-exchange__stop-row">
      <button
        ref={ref}
        type="button"
        className="pt-btn pt-btn--outline pt-exchange__stop"
        onClick={(event) => {
          if (document.activeElement === event.currentTarget) handoff.current = 'retry';
          onStop();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" className="pt-icon">
          <rect x="5.5" y="5.5" width="9" height="9" rx="1" fill="currentColor" />
        </svg>
        Stop
      </button>
    </div>
  );
}

/** Props for `StoppedNote`. */
export interface StoppedNoteProps {
  readonly answer: ViewMessage;
  readonly handoff: FocusHandoff;
  readonly onRetry: () => void;
}

/** The note after Stop, Retry beside it (focus comes here from Stop), and the run's usage. */
export function StoppedNote({ answer, handoff, onRetry }: StoppedNoteProps): ReactNode {
  const ref = useTakeFocus(handoff, 'retry');
  return (
    <>
      <div className="pt-exchange__stopped">
        <p className="pt-exchange__stopped-note" data-stopped>
          {stoppedNote(answer.text)}
        </p>
        <button ref={ref} type="button" className="pt-btn pt-btn--outline" onClick={onRetry}>
          <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" className="pt-icon">
            <path
              d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9M14 3.5v3h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          Retry
        </button>
      </div>
      <UsageLine usage={answer.usage} />
    </>
  );
}

/** Props for `FoldRow`. */
export interface FoldRowProps {
  readonly folded: boolean;
  readonly coverage: Coverage;
  readonly onToggle: () => void;
}

/** "4 passages · 11 citations … Show": one button that stays put, so focus stays on it. */
export function FoldRow({ folded, coverage, onToggle }: FoldRowProps): ReactNode {
  return (
    <div className="pt-exchange__fold">
      {folded ? <span>{foldedCounts(coverage)}</span> : null}
      <button
        type="button"
        className="pt-exchange__fold-toggle"
        aria-expanded={!folded}
        onClick={onToggle}
      >
        {folded ? 'Show' : 'Fold'}
      </button>
    </div>
  );
}

type SendState = 'idle' | 'sending' | 'sent' | 'failed';

/** Props for `SendToCanvas`. */
export interface SendToCanvasProps {
  readonly onSend: () => Promise<void>;
  /** The phone footer's shorter words (frame 08b): "To board". */
  readonly short?: boolean;
  /** Drawn before the words (the phone footer's pin). */
  readonly icon?: ReactNode;
  /** The button's words before it is pressed, when the default would not say which answer. */
  readonly label?: string;
}

/** Send to board, saying when it is sending, sent, or failed. */
export function SendToCanvas({
  onSend,
  short = false,
  icon,
  label: idleLabel,
}: SendToCanvasProps): ReactNode {
  const [send, setSend] = useState<SendState>('idle');
  const idle = idleLabel ?? (short ? 'To board' : 'Send to board');
  const label = send === 'sending' ? 'Sending…' : send === 'sent' ? 'Sent to board' : idle;
  return (
    <div className="pt-explain__actions">
      <button
        type="button"
        className="pt-btn pt-btn--outline"
        disabled={send === 'sending' || send === 'sent'}
        onClick={() => {
          setSend('sending');
          onSend().then(
            () => setSend('sent'),
            () => setSend('failed'),
          );
        }}
      >
        {icon}
        {label}
      </button>
      {send === 'failed' ? (
        <span className="pt-explain__note" role="alert">
          Couldn&apos;t send this to the board. Try again.
        </span>
      ) : null}
    </div>
  );
}

/** Grey lines while an answer has no text yet. */
export function Skeleton(): ReactNode {
  return (
    <div className="pt-explain__skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}
