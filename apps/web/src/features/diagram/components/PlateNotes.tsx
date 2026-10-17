'use client';

/**
 * The interface's lines under a plate (#217), in its own voice: what the run left out while
 * drawing, the usage line (an estimate), the note after Stop (true about what arrived: "Stopped
 * before any part arrived." when nothing did) with Retry, the cut-short note, and a designed failure
 * or refusal (S4d's: a refused Retry says why, the daily cap is its card). Focus comes to Retry from
 * Stop, so a keyboard reader never falls back to `<body>`.
 */
import { useId, type ReactNode } from 'react';

import { useTakeFocus, type FocusHandoff } from '@/features/explain/components/AnswerParts';
import { FailureNote, UsageLine } from '@/features/explain/components/AnswerStates';

import { EMPTY_PLATE, platePhase, stoppedPlateNote } from '../model/plate';

import type { ViewMessage } from '@/components/explain/useExplainActions';

/** Props for `PlateNotes`. */
export interface PlateNotesProps {
  readonly answer: ViewMessage;
  /** Stop → Retry: the exchange's focus hand-off. */
  readonly handoff: FocusHandoff;
  /** Draw this plate again (Retry). */
  readonly onRedraw: () => void;
}

/** "Stopped …", announced, with Retry beside it (focus lands there after a keyboard Stop). */
function StoppedPlate({
  parts,
  handoff,
  onRedraw,
}: { parts: number } & Omit<PlateNotesProps, 'answer'>) {
  const ref = useTakeFocus(handoff, 'retry');
  const id = useId();
  return (
    <div className="pt-exchange__stopped">
      <p className="pt-exchange__stopped-note" id={id} role="status" data-stopped>
        {stoppedPlateNote(parts)}
      </p>
      <button
        ref={ref}
        type="button"
        className="pt-btn pt-btn--outline"
        aria-describedby={id}
        onClick={onRedraw}
      >
        Retry
      </button>
    </div>
  );
}

/** The lines under one plate. */
export function PlateNotes({ answer, handoff, onRedraw }: PlateNotesProps): ReactNode {
  const plate = answer.diagram ?? EMPTY_PLATE;
  const phase = platePhase(answer, plate);
  // A refused Retry's reason replaces the plate's own (S4d): it says why nothing new came.
  const refused = answer.refusal ?? null;
  const failure = refused ?? answer.failure;
  return (
    <>
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
        <StoppedPlate parts={plate.parts.length} handoff={handoff} onRedraw={onRedraw} />
      ) : null}
      {phase === 'cut' ? (
        <p className="pt-explain__note" data-cut>
          The plate ended before it was finished. The parts that arrived are kept.
        </p>
      ) : null}
      {failure !== null && (refused !== null || phase === 'failed') ? (
        // Nothing of a plate was ever sent when it is refused, so "Nothing was sent" is true here.
        <FailureNote failure={failure} refusal="nothing" onRetry={onRedraw} />
      ) : null}
      {phase === 'failed' && failure === null ? (
        <FailureNote failure={{ code: 'internal', retryable: true }} onRetry={onRedraw} />
      ) : null}
    </>
  );
}
