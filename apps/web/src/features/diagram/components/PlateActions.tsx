'use client';

/**
 * What a settled plate offers (frame 07c): Send to board (a `diagram` card that keeps the plate's
 * message id and draws its stored parts) and Redraw (a new plate under a new ask in the same thread,
 * `redraw_of`). "Add to notebook" is left out: a notebook page holds no diagram item yet (#276),
 * and a button that does nothing is never drawn. While another plate of the thread draws, Redraw
 * is disabled and says why (review S7). After a keyboard Stop, focus comes to Redraw.
 */
import { Button } from '@papertree/ui';
import { Pin, RotateCw } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { useTakeFocus, type FocusHandoff } from '@/features/explain/components/AnswerParts';

/** Props for `PlateActions`. */
export interface PlateActionsProps {
  /** Send the plate to the board; rejects when the board refused it. */
  readonly onSendToBoard: () => Promise<void>;
  readonly onRedraw: () => void;
  /** Another plate of the thread is being drawn: Redraw waits for it. */
  readonly busy: boolean;
  /** Stop → Redraw: the exchange's focus hand-off. */
  readonly handoff: FocusHandoff;
}

/** Why Redraw (and Retry) wait while another plate of the thread is drawn. */
export const WAITING = 'Redraw waits for the plate being drawn.';

type SendState = 'idle' | 'sending' | 'sent' | 'failed';

const SEND_LABEL: Record<SendState, string> = {
  idle: 'Send to board',
  sending: 'Sending…',
  sent: 'On your board',
  failed: 'Send to board',
};

/** Send to board and Redraw, under the plate. */
export function PlateActions({
  onSendToBoard,
  onRedraw,
  busy,
  handoff,
}: PlateActionsProps): ReactNode {
  const [send, setSend] = useState<SendState>('idle');
  const redraw = useTakeFocus(handoff, 'retry');
  const why = useId();
  return (
    <>
      <div className="pt-plate-answer__actions">
        <Button
          leadingIcon={<Pin size={18} strokeWidth={1.5} />}
          disabled={send === 'sending' || send === 'sent'}
          onClick={() => {
            setSend('sending');
            onSendToBoard().then(
              () => setSend('sent'),
              () => setSend('failed'),
            );
          }}
        >
          {SEND_LABEL[send]}
        </Button>
        {/* The design system's secondary button, by hand: focus must be able to land on it. */}
        <button
          ref={redraw}
          type="button"
          className="pt-button pt-button--secondary pt-button--md"
          style={{ minHeight: 40 }}
          aria-disabled={busy ? true : undefined}
          {...(busy ? { 'aria-describedby': why } : {})}
          onClick={() => {
            if (!busy) onRedraw();
          }}
        >
          <span className="pt-button__icon" aria-hidden="true">
            <RotateCw size={18} strokeWidth={1.5} />
          </span>
          <span className="pt-button__label">Redraw</span>
        </button>
        {busy ? (
          <span className="pt-explain__note" id={why}>
            {WAITING}
          </span>
        ) : null}
      </div>
      {send === 'failed' ? (
        <p className="pt-explain__note" role="alert">
          Couldn&apos;t send this plate to the board. Check your connection and try again.
        </p>
      ) : null}
    </>
  );
}
