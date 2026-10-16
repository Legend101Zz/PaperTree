'use client';

/**
 * One exchange of a diagram thread (frames 07a–07c): the call slip (the passage and "Explain with a
 * diagram", stamped "not sent" when the server refused it before the stream), the plate, and the
 * lines under it (`PlateNotes`). Tapping a part flashes its passage in the paper; a part with no
 * passage says so instead of flashing nothing.
 */
import { CallSlip } from '@papertree/ui';
import { useCallback, useRef, useState, type ReactNode } from 'react';

import { formatAskTime, type Exchange as ExchangeModel } from '@/features/explain/model/exchange';
import { wasNotSent } from '@/features/explain/model/states';

import { tabOf, verdictOf } from '../model/plate';
import { DiagramPlate } from './DiagramPlate';
import { PlateNotes } from './PlateNotes';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { FlashSource } from '@/components/reader/actions';
import type { FocusHandoff } from '@/features/explain/components/AnswerParts';
import type { DiagramPart } from '@/lib/api/types';
import type { Anchor } from '@papertree/anchoring';

/** Props for `DiagramExchange`. */
export interface DiagramExchangeProps {
  readonly exchange: ExchangeModel<ViewMessage>;
  /** The account's initial, stamped on the call slip. */
  readonly initial: string;
  /** 1-based among the plates the thread has drawn (or is drawing); null for one never drawn. */
  readonly plateNo: number | null;
  readonly numbers: ReadonlyMap<string, number>;
  /** The reader's citation flash, with the part it came from for the margin tab. */
  readonly onFlash: (anchor: Anchor, from: FlashSource) => void;
  readonly onStop: () => void;
  /** Draw the plate again: Retry after a failure or a Stop (and Redraw). */
  readonly onRedraw: (key: string) => void;
  /** Put the plate on the board as a diagram card. */
  readonly onSendToBoard: (messageId: string, title: string) => Promise<void>;
  /** Another plate of the thread is being drawn: Redraw and Retry wait for it (review S7). */
  readonly busy: boolean;
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

/** A diagram exchange, named by its ask. */
export function DiagramExchange({
  exchange,
  initial,
  plateNo,
  numbers,
  onFlash,
  onStop,
  onRedraw,
  onSendToBoard,
  busy,
}: DiagramExchangeProps): ReactNode {
  const [said, setSaid] = useState<string | null>(null);
  const handoff: FocusHandoff = useRef(null);
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
      <div
        className="pt-exchange__ask"
        {...(exchange.quote === null ? {} : { 'data-explain-quote': '' })}
      >
        {slip}
        {wasNotSent(answer) ? <span className="pt-exchange__not-sent">not sent</span> : null}
      </div>
      {answer === null ? null : (
        <>
          <DiagramPlate
            answer={answer}
            plateNo={plateNo}
            numbers={numbers}
            handoff={handoff}
            onStop={onStop}
            onPart={onPart}
          />
          <p className="pt-plate-answer__said" aria-live="polite" data-plate-said>
            {said}
          </p>
          <PlateNotes
            answer={answer}
            plateNo={plateNo}
            handoff={handoff}
            busy={busy}
            onRedraw={() => onRedraw(answer.key)}
            onSendToBoard={onSendToBoard}
          />
        </>
      )}
    </div>
  );
}
