'use client';

/**
 * The phone sheet's pinned footer (#205, frame 08b): the last answer's usage line (it ends
 * "(estimate)") and its actions, above the follow-up box and outside the sheet's scroll, so they
 * never cover the answer and never scroll away. Only what works is drawn: Dive in (S5e, #210:
 * the same one-request `useDiveIn` as the answer's own footer, 44 px) and To board; Diagram joins
 * with the diagram run (#217), never as a dead button.
 */
import { DiveIn, SendToCanvas } from './AnswerParts';
import { UsageLine } from './AnswerStates';

import type { RunSummary } from '@/lib/api/types';
import type { ReactNode } from 'react';

/** Props for `PinnedFooter`. */
export interface PinnedFooterProps {
  /** The answer's stored message: its Send to board state starts afresh for each answer. */
  readonly messageId: string;
  readonly usage: RunSummary | null;
  readonly onSendToBoard: () => Promise<void>;
  /**
   * The answer's number when the thread has several: the button then says which one it sends
   * ("Send answer 2 to board"), since earlier answers keep their own To board in the scroll.
   */
  readonly answer?: number;
  /** Dive in on this answer; absent (a sample paper), no Dive in is drawn. */
  readonly onDiveIn?: () => Promise<void>;
}

/** The board pin of frame 08b's "To board". */
const PIN = (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="pt-icon">
    <circle cx="10" cy="7" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 10.6V17.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/**
 * The usage line and the actions of the answer the sheet ends on.
 *
 * @example
 * <PinnedFooter messageId="msg_1" usage={run} onSendToBoard={() => send('msg_1')} />
 */
export function PinnedFooter({
  messageId,
  usage,
  onSendToBoard,
  answer,
  onDiveIn,
}: PinnedFooterProps): ReactNode {
  return (
    <div className="pt-explain__pinned" data-pinned-footer>
      <UsageLine usage={usage} />
      <div className="pt-exchange__actions">
        {onDiveIn === undefined ? null : (
          <DiveIn
            key={messageId}
            size="touch"
            onDiveIn={onDiveIn}
            {...(answer === undefined ? {} : { label: `Dive in to answer ${String(answer)}` })}
          />
        )}
        <SendToCanvas
          key={messageId}
          short
          icon={PIN}
          onSend={onSendToBoard}
          {...(answer === undefined ? {} : { label: `Send answer ${String(answer)} to board` })}
        />
      </div>
    </div>
  );
}
