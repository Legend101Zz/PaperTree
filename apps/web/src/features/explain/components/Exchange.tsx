'use client';

/**
 * One exchange of ask → answer → trace (#202, DESIGN.md §4; frame 13 option 1, the owner's
 * default, owner may change): the `CallSlip` (your ask), the `AnswerSlip` (markers inline and in
 * the margin), the `CoverageReadout` and the `TraceList`. It is the ONE layout component behind
 * `ExchangeProps`, so frame 13's sidenote or claim → evidence options could replace it later
 * without touching the panel. A marker and its trace row light each other; either one flashes.
 */
import { CallSlip, CoverageReadout, TraceList } from '@papertree/ui';
import { useCallback, useState, type ReactNode } from 'react';

import { formatAskTime } from '../model/exchange';
import { AnswerSlip } from './AnswerSlip';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { Exchange as ExchangeModel, PassageMarker } from '../model/exchange';

/** Props for `Exchange`: the small interface any ask → answer → trace layout implements. */
export interface ExchangeProps {
  readonly exchange: ExchangeModel<ViewMessage>;
  /** The account's initial, stamped on the call slip. */
  readonly initial: string;
  /** The citation flash for a passage: scroll to it in the paper and flash it. */
  readonly onShow: (marker: PassageMarker) => void;
  readonly onRetry: (key: string) => void;
  readonly onSendToCanvas: (messageId: string) => Promise<void>;
}

/**
 * An exchange, named by its ask (never "Turn 1").
 *
 * @example
 * <Exchange exchange={exchanges[0]} initial="M" onShow={flash} onRetry={retry} onSendToCanvas={send} />
 */
export function Exchange({
  exchange,
  initial,
  onShow,
  onRetry,
  onSendToCanvas,
}: ExchangeProps): ReactNode {
  const [lit, setLit] = useState<number | null>(null);
  const model = exchange.model;
  const answer = exchange.answer;
  const settled = answer !== null && answer.status !== 'streaming';
  const showRow = useCallback(
    (n: number) => {
      const marker = model?.markers.get(n);
      if (marker !== undefined) onShow(marker);
    },
    [model, onShow],
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
    // Groups, not regions: a thread repeats them, and a landmark per exchange would flood the
    // landmark list with duplicates.
    <div
      className="pt-exchange"
      role="group"
      aria-label={exchange.ask}
      data-exchange={exchange.key}
    >
      {exchange.quote === null ? slip : <div data-explain-quote>{slip}</div>}
      {answer === null ? null : (
        <AnswerSlip
          answer={answer}
          model={model}
          lit={lit}
          onLight={setLit}
          onShow={onShow}
          onRetry={onRetry}
          onSendToCanvas={onSendToCanvas}
        />
      )}
      {settled && model !== null && model.trace.length > 0 ? (
        <div className="pt-exchange__trace">
          <CoverageReadout {...model.coverage} />
          <TraceList rows={model.trace} lit={lit} onLight={setLit} onShowInPaper={showRow} />
        </div>
      ) : null}
    </div>
  );
}
