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

import { cleanQuote, selectorOf } from '../model/anchor';
import { buildExchanges } from '../model/exchange';
import { isStored } from '../model/messages';
import { numberPassages } from '../model/passages';
import { opensFolded } from '../model/states';
import { Composer } from './Composer';
import { Exchange } from './Exchange';
import { SummaryExchange } from './SummaryExchange';
import { ThreadReadFailure } from './ThreadReadFailure';

import type { ExplainController, ExplainRequest } from '@/components/explain/useExplainActions';
import type { ThreadsState } from '../hooks/useThreads';
import type { PassageMarker } from '../model/exchange';

/** Props for `ThreadView`. */
export interface ThreadViewProps {
  readonly controller: ExplainController;
  /** The stored threads' state (`useThreads`): a read that failed, and its retry. */
  readonly threads: Pick<ThreadsState, 'failure' | 'retry'>;
  /** The account's initial for the call slips. */
  readonly initial: string;
  /** Flash a passage (an exchange's or the summary's markers and trace rows). */
  readonly onShow: (marker: PassageMarker) => void;
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
export function ThreadView({ controller, threads, initial, onShow }: ThreadViewProps): ReactNode {
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
  const summary = state.summary.summary;
  const summaryShown =
    summary !== null && (state.summary.phase === 'ready' || state.summary.phase === 'partial');

  const last = state.messages[state.messages.length - 1];
  const growth = `${String(state.messages.length)}:${String(last?.text.length ?? 0)}:${last?.status ?? ''}:${String(last?.stopped ?? false)}:${String(last?.citations.length ?? 0)}`;
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
  const offline = paperId === null;

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
            {exchanges.map((exchange, index) => (
              <Exchange
                key={exchange.key}
                exchange={exchange}
                initial={initial}
                onShow={onShow}
                onRetry={controller.retry}
                onStop={controller.stop}
                onSendToCanvas={sendToCanvas}
                // Read once, at mount (`useState`): an exchange never folds under the reader.
                startsFolded={opensFolded(index, exchanges.length)}
                askInBox={draft !== '' && draft === exchange.ask.trim()}
              />
            ))}
          </>
        )}
      </div>
      {state.view === 'summary' ? null : (
        <Composer
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
