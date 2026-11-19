/**
 * explain/useSummaryActions — the paper summary: show the cached one, or start a run and read it,
 * and stop that run.
 */
import { useCallback, useRef } from 'react';

import { failureOf } from '@/components/explain/errors';
import { summaryApi } from '@/lib/api/summary';
import { threadsApi } from '@/lib/api/threads';

import { statusLabel } from '../model/turns';

import type { SseEvent } from '@/lib/api/types';
import type { SummaryView } from '../model/state';
import type { ExplainRefs } from './useRunStream';

/** The actions of `useSummaryActions`. */
export interface SummaryActions {
  /**
   * Show the paper summary: the cached one, or a new run when there is none. `regenerate` skips the
   * cache and asks for a new run (the "Regenerate" action on a partial summary).
   */
  readonly summarize: (options?: { readonly regenerate?: boolean }) => void;
  /** Stop the summary run that is loading or streaming. */
  readonly stopSummary: () => void;
  /** Cancel the summary's request without a state change (the reader is leaving). */
  readonly abortSummary: () => void;
}

/**
 * The summary actions of the explain controller.
 *
 * @param paperId The API paper, or null for a fixture paper.
 * @param refs The controller's dispatch and refs.
 * @returns The actions.
 */
export function useSummaryActions(paperId: string | null, refs: ExplainRefs): SummaryActions {
  const { dispatch, stateRef } = refs;
  const summaryAbort = useRef<AbortController | null>(null);
  const summaryRun = useRef(0);

  const summarize = useCallback(
    (options?: { readonly regenerate?: boolean }): void => {
      const regenerate = options?.regenerate === true;
      dispatch({ type: 'view', view: 'summary' });
      const phase = stateRef.current.summary.phase;
      if (paperId === null || phase === 'loading' || phase === 'streaming') return;
      // A shown summary is kept, unless the reader asked for a new one.
      if (phase === 'ready' && !regenerate) return;
      const run = (summaryRun.current += 1);
      const set = (patch: Partial<SummaryView>): void => {
        if (summaryRun.current === run) dispatch({ type: 'summary', patch });
      };
      const controller = new AbortController();
      summaryAbort.current = controller;
      set({ phase: 'loading', failure: null, label: null, usage: null, cached: false, regenerate });

      const finish = async (): Promise<void> => {
        const status = await summaryApi.get(paperId);
        if (status.summary !== null && (status.state === 'ready' || status.state === 'partial')) {
          set({ phase: status.state, summary: status.summary, label: null, failure: null });
        } else {
          set({
            phase: 'failed',
            label: null,
            failure: { code: 'internal', retryable: true },
          });
        }
      };

      void (async () => {
        try {
          // The cached summary first: a reload costs no run. Not when a new one was asked for.
          if (!regenerate) {
            const cached = await summaryApi.get(paperId);
            if (
              cached.summary !== null &&
              (cached.state === 'ready' || cached.state === 'partial')
            ) {
              set({ phase: cached.state, summary: cached.summary, cached: true });
              return;
            }
          }
          const start = await summaryApi.generate(
            paperId,
            regenerate ? { regenerate: true } : {},
            controller.signal,
          );
          if (start.kind === 'cached') {
            const s = start.status;
            if (s.summary !== null)
              set({
                phase: s.state === 'partial' ? 'partial' : 'ready',
                summary: s.summary,
                cached: true,
              });
            return;
          }
          set({ phase: 'streaming', label: 'Starting' });
          let ended: Extract<SseEvent, { event: 'done' }>['data'] | null = null;
          for await (const event of start.events) {
            if (summaryRun.current !== run) return;
            if (event.event === 'run') set({ runId: event.data.run_id });
            else if (event.event === 'status') set({ label: statusLabel(event.data) });
            else if (event.event === 'usage') set({ usage: event.data });
            else if (event.event === 'done') ended = event.data;
          }
          if (summaryRun.current !== run) return;
          if (ended === null) {
            set({ phase: 'failed', label: null, failure: { code: 'network', retryable: true } });
          } else if (ended.status === 'complete' || ended.status === 'partial') {
            await finish();
          } else {
            set({
              phase: 'failed',
              label: null,
              failure:
                ended.error === null
                  ? { code: 'aborted', retryable: true }
                  : { code: ended.error.code, retryable: ended.error.retryable },
            });
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          set({ phase: 'failed', label: null, failure: failureOf(error) });
        }
      })();
    },
    [paperId, dispatch, stateRef],
  );

  const stopSummary = useCallback((): void => {
    const { runId, phase } = stateRef.current.summary;
    if (phase !== 'streaming' && phase !== 'loading') return;
    summaryRun.current += 1;
    if (runId !== null) threadsApi.cancelRun(runId).catch(() => undefined);
    summaryAbort.current?.abort();
    dispatch({
      type: 'summary',
      patch: { phase: 'failed', label: null, failure: { code: 'aborted', retryable: true } },
    });
  }, [dispatch, stateRef]);

  const abortSummary = useCallback((): void => summaryAbort.current?.abort(), []);

  return { summarize, stopSummary, abortSummary };
}
