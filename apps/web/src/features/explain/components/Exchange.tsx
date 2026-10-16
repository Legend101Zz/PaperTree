'use client';

/**
 * One exchange of ask → answer → trace (#202, DESIGN.md §4; frame 13 option 1, the owner's
 * default, owner may change): the `CallSlip` (your ask), the `AnswerSlip` (markers inline and in
 * the margin), the `CoverageReadout` and the `TraceList`. It is the ONE layout component behind
 * `ExchangeProps`, so frame 13's sidenote or claim → evidence options could replace it later
 * without touching the panel. A marker and its trace row light each other; either one flashes.
 * An ask the server refused before the stream is stamped "not sent" (#204, frame 04c).
 */
import { CallSlip, CoverageReadout, TraceList } from '@papertree/ui';
import { useCallback, useState, type ReactNode } from 'react';

import { formatAskTime } from '../model/exchange';
import { wasNotSent, type RefusalKind } from '../model/states';
import { AnswerSlip } from './AnswerSlip';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { Exchange as ExchangeModel, PassageMarker } from '../model/exchange';

/** A citation the AI wrote that matched no passage is said, not hidden (DESIGN §4.6). */
function unresolvedNote(count: number): string {
  return count === 1
    ? '1 citation the AI wrote matches no passage; its claim is shown as the AI’s own reading.'
    : `${String(count)} citations the AI wrote match no passage; their claims are shown as the AI’s own reading.`;
}

/** Props for `Exchange`: the small interface any ask → answer → trace layout implements. */
export interface ExchangeProps {
  readonly exchange: ExchangeModel<ViewMessage>;
  /** The account's initial, stamped on the call slip. */
  readonly initial: string;
  /** The citation flash for a passage: scroll to it in the paper and flash it. */
  readonly onShow: (marker: PassageMarker) => void;
  readonly onRetry: (key: string) => void;
  /** Stop the answer that is streaming (Stop on its tab row). */
  readonly onStop: () => void;
  readonly onSendToCanvas: (messageId: string) => Promise<void>;
  /** Open folded: two lines and the counts, with Show (an earlier exchange of a reopened thread). */
  readonly startsFolded?: boolean;
  /** The composer holds this exchange's ask now, so a refusal may say "your text is kept". */
  readonly askInBox?: boolean;
  /**
   * The phone sheet (#205, frame 08b): 44 px markers and trace rows, and the answer shows its first
   * paragraph with "Read the whole answer".
   */
  readonly phone?: boolean;
  /** Its usage line and Send to board are in the sheet's pinned footer (the last exchange). */
  readonly pinned?: boolean;
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
  onStop,
  onSendToCanvas,
  startsFolded = false,
  askInBox = false,
  phone = false,
  pinned = false,
}: ExchangeProps): ReactNode {
  const [lit, setLit] = useState<number | null>(null);
  // Read once, at mount: an exchange never gains or loses its fold as the thread grows.
  const [foldable] = useState(startsFolded);
  const [folded, setFolded] = useState(startsFolded);
  const model = exchange.model;
  const answer = exchange.answer;
  const settled = answer !== null && answer.status !== 'streaming';
  // The phone's "Read the whole answer" (`clipAnswer`); only an answer's reader opens it.
  const [expanded, setExpanded] = useState(false);
  const notSent = wasNotSent(answer);
  const kept: RefusalKind = exchange.typed ? (askInBox ? 'kept' : 'question') : 'nothing';
  // A Retry streams in the open, never inside the folded two-line preview.
  const retry = useCallback(
    (key: string) => {
      setFolded(false);
      setExpanded(true);
      onRetry(key);
    },
    [onRetry],
  );
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
      <div
        className="pt-exchange__ask"
        {...(exchange.quote === null ? {} : { 'data-explain-quote': '' })}
      >
        {slip}
        {notSent ? <span className="pt-exchange__not-sent">not sent</span> : null}
      </div>
      {answer === null ? null : (
        <AnswerSlip
          answer={answer}
          model={model}
          lit={lit}
          onLight={setLit}
          onShow={onShow}
          onRetry={retry}
          onStop={onStop}
          onSendToCanvas={onSendToCanvas}
          notSent={kept}
          fold={foldable ? { folded, toggle: () => setFolded((was) => !was) } : undefined}
          clip={
            phone && !foldable ? { expanded, toggle: () => setExpanded((was) => !was) } : undefined
          }
          touch={phone}
          pinned={pinned}
        />
      )}
      {settled && model !== null && !model.live && !folded ? (
        <div className="pt-exchange__trace">
          <CoverageReadout {...model.coverage} />
          {model.unresolvedMarkers > 0 ? (
            <p className="pt-exchange__unresolved" data-unresolved={model.unresolvedMarkers}>
              {unresolvedNote(model.unresolvedMarkers)}
            </p>
          ) : null}
          {model.trace.length === 0 ? null : (
            <TraceList
              rows={model.trace}
              lit={lit}
              onLight={setLit}
              onShowInPaper={showRow}
              layout={phone ? 'touch' : 'desktop'}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
