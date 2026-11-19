'use client';

/**
 * One exchange of ask → answer (#202, #340, DESIGN.md §4): the `CallSlip` (your ask) and the
 * `AnswerSlip` (each paragraph with its one quiet source line). It is the ONE layout component
 * behind `ExchangeProps`. An ask the server refused before the stream is stamped "not sent"
 * (#204, frame 04c).
 */
import { CallSlip } from '@papertree/ui';
import { useCallback, useState, type ReactNode } from 'react';

import { formatAskTime } from '../model/exchange';
import { wasNotSent, type RefusalKind } from '../model/states';
import { AnswerSlip } from './AnswerSlip';

import type { ViewMessage } from '@/components/explain/useExplainActions';
import type { Exchange as ExchangeModel, PaperSource } from '../model/exchange';

/** Props for `Exchange`: the small interface any ask → answer → trace layout implements. */
export interface ExchangeProps {
  readonly exchange: ExchangeModel<ViewMessage>;
  /** The account's initial, stamped on the call slip. */
  readonly initial: string;
  /** The citation flash for a page's passage: scroll to it in the paper and flash it. */
  readonly onShow: (source: PaperSource) => void;
  readonly onRetry: (key: string) => void;
  /** Stop the answer that is streaming (Stop on its tab row). */
  readonly onStop: () => void;
  readonly onSendToCanvas: (messageId: string) => Promise<void>;
  /** Dive in: open the answer as a notebook page (S5e, #210); without it there is no Dive in. */
  readonly onDiveIn?: (messageId: string, exchange: HTMLElement | null) => Promise<void>;
  /** Open folded: two lines, with Show (an earlier exchange of a reopened thread). */
  readonly startsFolded?: boolean;
  /** The composer holds this exchange's ask now, so a refusal may say "your text is kept". */
  readonly askInBox?: boolean;
  /**
   * The phone sheet (#205, frame 08b): 44 px page links, and the answer shows its first
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
 * <Exchange exchange={exchanges[0]} initial="M" onShow={flash} onRetry={retry} onSendToCanvas={send} onDiveIn={dive} />
 */
export function Exchange({
  exchange,
  initial,
  onShow,
  onRetry,
  onStop,
  onSendToCanvas,
  onDiveIn,
  startsFolded = false,
  askInBox = false,
  phone = false,
  pinned = false,
}: ExchangeProps): ReactNode {
  // Read once, at mount: an exchange never gains or loses its fold as the thread grows.
  const [foldable] = useState(startsFolded);
  const [folded, setFolded] = useState(startsFolded);
  const model = exchange.model;
  const answer = exchange.answer;
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
          onShow={onShow}
          onRetry={retry}
          onStop={onStop}
          onSendToCanvas={onSendToCanvas}
          {...(onDiveIn === undefined ? {} : { onDiveIn })}
          notSent={kept}
          fold={foldable ? { folded, toggle: () => setFolded((was) => !was) } : undefined}
          clip={
            phone && !foldable ? { expanded, toggle: () => setExpanded((was) => !was) } : undefined
          }
          touch={phone}
          pinned={pinned}
        />
      )}
    </div>
  );
}
