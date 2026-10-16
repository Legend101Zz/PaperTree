'use client';

/**
 * The interface's lines under a plate (#217), in its own voice: what a settled plate offers (Send
 * to board, Redraw), what the run left out while drawing, the usage line (an estimate), the note
 * after Stop (true about what arrived: "Stopped before any part arrived." when nothing did), the
 * cut-short note, a designed failure or refusal (S4d's: a refused Retry says why, the daily cap is
 * its card), and the 07d offer. Focus comes from Stop to Redraw (or Retry), so a keyboard reader
 * never falls back to `<body>`. While another plate of the thread draws, Redraw and Retry wait,
 * and say so: never an enabled button that does nothing.
 */
import { useId, type ReactNode } from 'react';

import { useTakeFocus, type FocusHandoff } from '@/features/explain/components/AnswerParts';
import { FailureNote, UsageLine } from '@/features/explain/components/AnswerStates';

import { EMPTY_PLATE, platePhase, stoppedPlateNote } from '../model/plate';
import { CraftedOffer } from './CraftedOffer';
import { PlateActions, WAITING } from './PlateActions';

import type { ViewMessage } from '@/components/explain/useExplainActions';

/** Props for `PlateNotes`. */
export interface PlateNotesProps {
  readonly answer: ViewMessage;
  /** 1-based among the plates drawn; the 07d offer shows under the first only. */
  readonly plateNo: number | null;
  /** Stop → Redraw (or Retry): the exchange's focus hand-off. */
  readonly handoff: FocusHandoff;
  /** Another plate of the thread is being drawn. */
  readonly busy: boolean;
  /** Draw this plate again (Redraw, Retry). */
  readonly onRedraw: () => void;
  /** Send the plate to the board. */
  readonly onSendToBoard: (messageId: string, title: string) => Promise<void>;
}

interface StoppedPlateProps {
  readonly parts: number;
  readonly handoff: FocusHandoff;
  /** Absent when the plate has its own Redraw (it has parts), or while another plate draws. */
  readonly onRetry?: (() => void) | undefined;
}

/** Retry beside the stopped note; it takes focus when Stop had it. */
function StoppedRetry({
  id,
  handoff,
  onRetry,
}: {
  id: string;
  handoff: FocusHandoff;
  onRetry: () => void;
}) {
  const ref = useTakeFocus(handoff, 'retry');
  return (
    <button
      ref={ref}
      type="button"
      className="pt-btn pt-btn--outline"
      aria-describedby={id}
      onClick={onRetry}
    >
      Retry
    </button>
  );
}

/** "Stopped …", announced; Retry beside it for an empty plate. */
function StoppedPlate({ parts, handoff, onRetry }: StoppedPlateProps) {
  const id = useId();
  return (
    <div className="pt-exchange__stopped">
      <p className="pt-exchange__stopped-note" id={id} role="status" data-stopped>
        {stoppedPlateNote(parts)}
      </p>
      {onRetry === undefined ? null : <StoppedRetry id={id} handoff={handoff} onRetry={onRetry} />}
    </div>
  );
}

/** The lines under one plate. */
export function PlateNotes({
  answer,
  plateNo,
  handoff,
  busy,
  onRedraw,
  onSendToBoard,
}: PlateNotesProps): ReactNode {
  const plate = answer.diagram ?? EMPTY_PLATE;
  const phase = platePhase(answer, plate);
  // A refused Retry's reason replaces the plate's own (S4d): it says why nothing new came.
  const refused = answer.refusal ?? null;
  const failure = refused ?? answer.failure;
  const messageId = answer.messageId;
  const drawn =
    plate.parts.length > 0 && (phase === 'complete' || phase === 'stopped' || phase === 'cut');
  const retry = busy ? undefined : onRedraw;
  return (
    <>
      {drawn && messageId !== null ? (
        <PlateActions
          busy={busy}
          handoff={handoff}
          onSendToBoard={() => onSendToBoard(messageId, plate.title ?? 'Untitled diagram')}
          onRedraw={onRedraw}
        />
      ) : null}
      {busy && !drawn && (phase === 'stopped' || phase === 'failed') ? (
        <p className="pt-explain__note">{WAITING}</p>
      ) : null}
      {plate.notes.length === 0 ? null : (
        <div className="pt-plate-answer__notes" data-plate-notes>
          <p>While drawing, the AI&apos;s lines were checked and some were left out:</p>
          <ul>
            {plate.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {phase === 'thinking' || phase === 'drawing' ? null : <UsageLine usage={answer.usage} />}
      {phase === 'stopped' && refused === null ? (
        <StoppedPlate
          parts={plate.parts.length}
          handoff={handoff}
          onRetry={drawn ? undefined : retry}
        />
      ) : null}
      {phase === 'cut' ? (
        <p className="pt-explain__note" data-cut>
          The plate ended before it was finished. The parts that arrived are kept.
        </p>
      ) : null}
      {failure !== null && (refused !== null || phase === 'failed') ? (
        // Nothing of a plate was ever sent when it is refused, so "Nothing was sent" is true here.
        <FailureNote failure={failure} refusal="nothing" onRetry={retry} />
      ) : null}
      {phase === 'failed' && failure === null ? (
        <FailureNote failure={{ code: 'internal', retryable: true }} onRetry={retry} />
      ) : null}
      {phase === 'complete' && plateNo === 1 ? (
        <CraftedOffer title={plate.title ?? 'this diagram'} />
      ) : null}
    </>
  );
}
