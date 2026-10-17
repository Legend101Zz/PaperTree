'use client';

/**
 * The explain panel's body (#202): the thread as exchanges (ask → answer → trace), or the paper
 * summary as an exchange of its own (#204, numbered with the thread's passages), above the composer. It follows a growing answer only after the reader has asked
 * something of their own, so a new thread opens at its call slip, not at the end.
 */
import { PaperText } from '@papertree/ui';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { SummaryView } from '@/components/explain/SummaryView';
import { useReaderActions } from '@/components/reader/actions';
import { DiagramExchange, numberPlatePassages } from '@/features/diagram';
import { useDiveIn } from '@/features/notebook/hooks/useDiveIn';

import { cleanQuote, selectorOf } from '../model/anchor';
import { buildExchanges } from '../model/exchange';
import { isStored } from '../model/messages';
import { numberPassages } from '../model/passages';
import { pinnedExchange } from '../model/phone';
import { opensFolded, wasStopped } from '../model/states';
import { Composer } from './Composer';
import { Exchange } from './Exchange';
import { PinnedFooter } from './PinnedFooter';
import { SummaryExchange } from './SummaryExchange';
import { ThreadReadFailure } from './ThreadReadFailure';

import type { ExplainController, ExplainRequest } from '@/components/explain/useExplainActions';
import type { FlashSource } from '@/components/reader/actions';
import type { ThreadsState } from '../hooks/useThreads';
import type { PassageMarker } from '../model/exchange';
import type { Anchor } from '@papertree/anchoring';

/** Props for `ThreadView`. */
export interface ThreadViewProps {
  readonly controller: ExplainController;
  /** The stored threads' state (`useThreads`): a read that failed, and its retry. */
  readonly threads: Pick<ThreadsState, 'failure' | 'retry'>;
  /** The account's initial for the call slips. */
  readonly initial: string;
  /** Flash a passage (an exchange's or the summary's markers and trace rows). */
  readonly onShow: (marker: PassageMarker) => void;
  /** Flash a diagram part's passage (#217). */
  readonly onFlash: (anchor: Anchor, from: FlashSource) => void;
  /** The phone sheet (#205): 44 px targets, clipped answers and the pinned footer. */
  readonly phone?: boolean;
}

/** The passage alone, for a sample paper that has no server to ask. */
function SelectedPassage({ request }: { request: ExplainRequest }): ReactNode {
  const page = selectorOf(request.anchor, 'PageSelector')?.index;
  return (
    <section className="pt-explain__quote" aria-label="Selected passage" data-explain-quote>
      <PaperText as="blockquote" {...(page === undefined ? {} : { pageLabel: `p. ${page + 1}` })}>
        {cleanQuote(request.quote)}
      </PaperText>
    </section>
  );
}

/** The thread (or summary) and the composer. */
export function ThreadView({
  controller,
  threads,
  initial,
  onShow,
  onFlash,
  phone = false,
}: ThreadViewProps): ReactNode {
  const actions = useReaderActions();
  const { state, paperId } = controller;
  const scroller = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const busy = state.messages.some((m) => m.status === 'streaming');
  const draft = state.draft.trim();
  const exchanges = useMemo(
    () => buildExchanges(state.messages, state.request),
    [state.messages, state.request],
  );
  const numbers = useMemo(
    () => numberPassages(state.messages.filter((m) => m.role === 'assistant')),
    [state.messages],
  );
  // A diagram thread's plates (#217): numbered 1, 2… among the plates drawn or drawing (one that
  // ended with no part is never "Plate 1", review N4), one set of passage numbers for the thread.
  const plates = useMemo(() => {
    let n = 0;
    const plateNo = new Map<string, number | null>();
    exchanges.forEach((e) => {
      const answer = e.answer;
      if (answer?.diagram == null) return;
      const drawn = answer.status === 'streaming' || answer.diagram.parts.length > 0;
      plateNo.set(e.key, drawn ? (n += 1) : null);
    });
    const parts = exchanges.flatMap((e) =>
      e.answer?.diagram == null ? [] : [e.answer.diagram.parts],
    );
    return { plateNo, numbers: numberPlatePassages(parts) };
  }, [exchanges]);
  const summary = state.summary.summary;
  const summaryShown =
    summary !== null && (state.summary.phase === 'ready' || state.summary.phase === 'partial');

  const last = state.messages[state.messages.length - 1];
  // A plate grows by parts, not text (#217 review N5): its part count follows it down too.
  const growth = `${String(state.messages.length)}:${String(last?.text.length ?? 0)}:${last?.status ?? ''}:${String(last?.stopped ?? false)}:${String(last?.citations.length ?? 0)}:${String(last?.diagram?.parts.length ?? 0)}`;
  useEffect(() => {
    stick.current = false;
    if (scroller.current !== null) scroller.current.scrollTop = 0;
  }, [state.view, state.epoch]);
  // Only a question asked here sticks the view to the end; opening a stored thread starts at the top.
  const questions = state.messages.filter((m) => m.role === 'user' && !isStored(m));
  useEffect(() => {
    if (questions.length > 0) stick.current = true;
  }, [questions.length]);
  useEffect(() => {
    const el = scroller.current;
    if (el !== null && stick.current) el.scrollTop = el.scrollHeight;
  }, [growth, state.view]);

  const sendToCanvas = useCallback(
    (messageId: string) => actions.sendToCanvas({ kind: 'explanation', messageId }),
    [actions],
  );
  const sendPlate = useCallback(
    (messageId: string, title: string) =>
      actions.sendToCanvas({ kind: 'diagram', messageId, title }),
    [actions],
  );
  const { diveIn } = useDiveIn(paperId);
  const offline = paperId === null;
  // The phone pins the last complete answer's usage and actions above the follow-up box.
  const pinAt = phone
    ? pinnedExchange(
        // A plate keeps its own actions (#217): only an answer is pinned.
        exchanges.map((e) =>
          e.answer === null || wasStopped(e.answer) || plates.plateNo.has(e.key)
            ? null
            : e.answer.status,
        ),
      )
    : -1;
  // Only a stored answer can be sent; until its id lands its footer stays in the slip.
  const pinnedId = exchanges[pinAt]?.answer?.messageId ?? null;
  const pin = pinnedId === null ? -1 : pinAt;
  const pinnedUsage = exchanges[pin]?.answer?.usage ?? null;

  return (
    <div className="pt-explain__body" data-explain-view={state.view}>
      <div
        className="pt-explain__scroll"
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {state.view === 'summary' && summaryShown ? (
          <SummaryExchange
            summary={summary}
            state={state.summary}
            numbers={state.messages.length === 0 ? null : numbers}
            initial={initial}
            onShow={onShow}
            onRegenerate={() => controller.summarize({ regenerate: true })}
          />
        ) : state.view === 'summary' ? (
          <SummaryView
            state={state.summary}
            // A failed "Summarise again" retries the new run, never the cached copy (review 2.2).
            onRetry={() => controller.summarize({ regenerate: state.summary.regenerate })}
            onStop={controller.stopSummary}
          />
        ) : (
          <>
            {offline && state.request !== null ? <SelectedPassage request={state.request} /> : null}
            {offline ? (
              <p className="pt-explain__empty" role="note">
                This is a sample paper, and a sample has no server to ask. Upload a PDF to ask
                questions about it.
              </p>
            ) : threads.failure !== null && exchanges.length === 0 ? (
              <ThreadReadFailure
                kind={threads.failure.kind}
                of={threads.failure.of}
                onRetry={threads.retry}
                {...(threads.failure.of === 'thread'
                  ? { onStartFresh: controller.startFresh }
                  : {})}
              />
            ) : exchanges.length === 0 && state.threadId === null ? (
              state.request !== null && state.messages.length === 0 ? (
                // The toolbar's Ask (#203): the passage waits for the reader's own question.
                <>
                  <SelectedPassage request={state.request} />
                  <p className="pt-explain__empty">Type your question about this passage below.</p>
                </>
              ) : (
                <p className="pt-explain__empty">
                  Select a passage in the paper and press Ask, or type a question about the whole
                  paper below.
                </p>
              )
            ) : null}
            {exchanges.map((exchange, index) => {
              const plateNo = plates.plateNo.get(exchange.key);
              return plateNo === undefined ? (
                <Exchange
                  key={exchange.key}
                  exchange={exchange}
                  initial={initial}
                  onShow={onShow}
                  onRetry={controller.retry}
                  onStop={controller.stop}
                  onSendToCanvas={sendToCanvas}
                  {...(diveIn === null ? {} : { onDiveIn: diveIn })}
                  // Read once, at mount (`useState`): an exchange never folds under the reader.
                  startsFolded={opensFolded(index, exchanges.length)}
                  askInBox={draft !== '' && draft === exchange.ask.trim()}
                  phone={phone}
                  pinned={index === pin}
                />
              ) : (
                <DiagramExchange
                  key={exchange.key}
                  exchange={exchange}
                  initial={initial}
                  plateNo={plateNo}
                  numbers={plates.numbers}
                  onFlash={onFlash}
                  onStop={controller.stop}
                  onRedraw={controller.redraw}
                  onSendToBoard={sendPlate}
                  busy={busy}
                />
              );
            })}
          </>
        )}
      </div>
      {state.view === 'summary' || state.diagram || pinnedId === null ? null : (
        <PinnedFooter
          messageId={pinnedId}
          usage={pinnedUsage}
          onSendToBoard={() => sendToCanvas(pinnedId)}
          {...(exchanges.length > 1 ? { answer: pin + 1 } : {})}
        />
      )}
      {/* A diagram thread is redrawn, never continued with a typed question (the API's 422). */}
      {state.view === 'summary' || state.diagram ? null : (
        <Composer
          {...(phone ? { placeholder: 'Ask a follow-up' } : {})}
          busy={busy}
          disabled={offline}
          value={state.draft}
          onChange={controller.setDraft}
          onSend={controller.ask}
          focusKey={
            // Only the toolbar's Ask leaves a passage with no thread and nothing sent (#203); a
            // stored thread being opened has its id already, and Explain sends at once.
            state.request !== null && state.threadId === null && state.messages.length === 0
              ? state.epoch
              : null
          }
        />
      )}
    </div>
  );
}
