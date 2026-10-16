'use client';

/**
 * One exchange of a diagram thread (frames 07a–07c): the call slip (the passage and "Explain with a
 * diagram"), the plate, and the interface's lines under it: what the run left out while drawing,
 * the usage line (an estimate), the stopped or cut-short note, a designed failure. Tapping a part
 * flashes its passage in the paper; a part with no passage says so instead of flashing nothing.
 */
import { CallSlip } from '@papertree/ui';
import { useCallback, useState, type ReactNode } from 'react';

import { FailureNote, UsageLine } from '@/features/explain/components/AnswerStates';
import { formatAskTime, type Exchange as ExchangeModel } from '@/features/explain/model/exchange';

import { EMPTY_PLATE, platePhase, tabOf, verdictOf } from '../model/plate';
import { DiagramPlate } from './DiagramPlate';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { FlashSource } from '@/components/reader/actions';
import type { DiagramPart } from '@/lib/api/types';
import type { Anchor } from '@papertree/anchoring';

/** Props for `DiagramExchange`. */
export interface DiagramExchangeProps {
  readonly exchange: ExchangeModel<ViewMessage>;
  /** The account's initial, stamped on the call slip. */
  readonly initial: string;
  /** 1-based among the thread's plates. */
  readonly plateNo: number;
  readonly numbers: ReadonlyMap<string, number>;
  /** The reader's citation flash, with the part it came from for the margin tab. */
  readonly onFlash: (anchor: Anchor, from: FlashSource) => void;
  readonly onStop: () => void;
  /** Draw the plate again: Try again after a failure (and Redraw). */
  readonly onRedraw: (key: string) => void;
}

/**
 * What the reader is told when a tapped part has nothing in the paper to flash.
 *
 * @param part The part.
 * @returns The sentence.
 */
export function nothingToShow(part: DiagramPart): string {
  return part.cite === null
    ? `Part ${part.letter} is inferred: no passage says it, so there is nothing to show in the paper.`
    : `Part ${part.letter}'s quote was not found in the paper, so there is nothing to show.`;
}

/** The lines under a plate, in the interface's voice. */
function PlateNotes({
  answer,
  onRedraw,
}: {
  answer: ViewMessage;
  onRedraw: () => void;
}): ReactNode {
  const plate = answer.diagram ?? EMPTY_PLATE;
  const phase = platePhase(answer, plate);
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
      {phase === 'stopped' ? (
        <p className="pt-explain__note" data-stopped>
          Stopped. The parts that arrived are kept.
        </p>
      ) : null}
      {phase === 'cut' ? (
        <p className="pt-explain__note" data-cut>
          The plate ended before it was finished. The parts that arrived are kept.
        </p>
      ) : null}
      {phase === 'failed' ? (
        <FailureNote
          failure={answer.failure ?? { code: 'internal', retryable: true }}
          onRetry={onRedraw}
        />
      ) : null}
    </>
  );
}

/** A diagram exchange, named by its ask. */
export function DiagramExchange({
  exchange,
  initial,
  plateNo,
  numbers,
  onFlash,
  onStop,
  onRedraw,
}: DiagramExchangeProps): ReactNode {
  const [said, setSaid] = useState<string | null>(null);
  const answer = exchange.answer;
  const onPart = useCallback(
    (part: DiagramPart, n: number | null) => {
      const tab = tabOf(part.cite);
      const anchor = part.cite?.anchor ?? null;
      if (anchor === null || tab === null || n === null) {
        setSaid(nothingToShow(part));
        return;
      }
      setSaid(null);
      onFlash(anchor, {
        n,
        page: tab.page,
        para: tab.para,
        notVerified: verdictOf(part) !== 'cited',
        part: { letter: part.letter, label: part.label },
      });
    },
    [onFlash],
  );
  const slip = (
    <CallSlip
      initial={initial}
      ask={exchange.ask}
      time={formatAskTime(exchange.askedAt)}
      {...(exchange.askedAt === null ? {} : { dateTime: exchange.askedAt })}
      {...(exchange.quote === null ? {} : { quote: exchange.quote })}
    />
  );
  return (
    <div
      className="pt-exchange pt-exchange--diagram"
      role="group"
      aria-label={exchange.ask}
      data-exchange={exchange.key}
    >
      {exchange.quote === null ? slip : <div data-explain-quote>{slip}</div>}
      {answer === null ? null : (
        <>
          <DiagramPlate
            answer={answer}
            plateNo={plateNo}
            numbers={numbers}
            onStop={onStop}
            onPart={onPart}
          />
          <p className="pt-plate-answer__said" aria-live="polite" data-plate-said>
            {said}
          </p>
          <PlateNotes answer={answer} onRedraw={() => onRedraw(answer.key)} />
        </>
      )}
    </div>
  );
}
