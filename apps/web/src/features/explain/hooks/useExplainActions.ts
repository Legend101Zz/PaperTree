/**
 * explain/useExplainActions — the explain panel's controller and the `openExplain` half of
 * `ReaderActions` (contracts.md §5). Owned by S6.
 *
 * The state is a reducer (`model/state`); the actions live in focused hooks that share its refs:
 * `useRunStream` (one SSE turn), `useThreadTurns` (create, follow-up, level switch, retry),
 * `useOpenActions` (Explain, diagram, Redraw, Ask about) and `useSummaryActions`. This hook wires
 * them, owns the panel's own moves (open, close, select a thread, start fresh, hydrate) and hands
 * the result to `<ExplainPanel controller={…}/>` as ONE opaque prop.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { explainReducer, INITIAL_STATE, type PanelView } from '../model/state';
import { originOf } from '../model/threads';
import { useOpenActions } from './useOpenActions';
import { useRunStream, type ExplainRefs } from './useRunStream';
import { useSummaryActions } from './useSummaryActions';
import { useThreadTurns } from './useThreadTurns';

import type { ExplainController } from '../model/controller';
import type { Message, Thread } from '@/lib/api/types';

/**
 * The explain controller of a paper's reader.
 *
 * @param options The API paper (`null` for a fixture paper, which no server can be asked about).
 * @returns The controller the panel is drawn from.
 */
export function useExplainActions(options: { readonly paperId: string | null }): ExplainController {
  const { paperId } = options;
  const [state, dispatch] = useReducer(explainReducer, INITIAL_STATE);

  // The latest state for async code, which must read it at the time it runs, not when it started.
  const stateRef = useRef(state);
  stateRef.current = state;
  const epochRef = useRef(0);
  const threadAbort = useRef<AbortController | null>(null);
  const refs = useMemo<ExplainRefs>(
    () => ({ dispatch, stateRef, epochRef, threadAbort }),
    [dispatch],
  );

  const run = useRunStream(refs);
  const { halt } = run;
  const turns = useThreadTurns(paperId, refs, run);
  const { ask, relevel, retry } = turns;
  const { openExplain, openDiagram, redraw, askAbout } = useOpenActions(paperId, refs, run, turns);
  const { summarize, stopSummary, abortSummary } = useSummaryActions(paperId, refs);

  const openPanel = useCallback((): void => {
    const current = stateRef.current;
    if (
      current.messages.length > 0 ||
      current.request !== null ||
      current.threadId !== null ||
      current.fresh
    ) {
      dispatch({ type: 'view', view: current.view });
      return;
    }
    const epoch = (epochRef.current += 1);
    dispatch({ type: 'open', epoch, request: null, view: 'thread' });
  }, []);

  const closeExplain = useCallback((): void => {
    halt(true);
    dispatch({ type: 'close' });
  }, [halt]);

  const setDraft = useCallback((text: string): void => dispatch({ type: 'draft', text }), []);

  // The server keeps the partial text it had; `useThreads` reads the thread again once the run
  // has settled (one path for done, Stop and failures), so the stored copy replaces this one.
  const stop = useCallback((): void => halt(true), [halt]);

  const setView = useCallback((view: PanelView): void => dispatch({ type: 'view', view }), []);

  const selectThread = useCallback(
    (thread: Thread): void => {
      halt(true);
      const epoch = (epochRef.current += 1);
      const request = originOf(thread);
      const diagram = thread.kind === 'diagram';
      dispatch({ type: 'select', epoch, threadId: thread.thread_id, request, diagram });
      stateRef.current = {
        ...stateRef.current,
        epoch,
        request,
        threadId: thread.thread_id,
        messages: [],
        diagram,
      };
    },
    [halt],
  );

  const startFresh = useCallback((): void => {
    halt(true);
    const epoch = (epochRef.current += 1);
    dispatch({ type: 'fresh', epoch });
    stateRef.current = {
      ...stateRef.current,
      epoch,
      request: null,
      threadId: null,
      messages: [],
      fresh: true,
    };
  }, [halt]);

  const hydrateThread = useCallback(
    (threadId: string, messages: readonly Message[]): void =>
      dispatch({ type: 'hydrate', threadId, messages }),
    [],
  );

  // Leaving the reader stops what is streaming: nothing is left running for nobody.
  useEffect(
    () => () => {
      threadAbort.current?.abort();
      abortSummary();
    },
    [abortSummary],
  );

  return useMemo(
    () => ({
      paperId,
      state,
      request: state.open ? state.request : null,
      openExplain,
      openDiagram,
      redraw,
      askAbout,
      openPanel,
      closeExplain,
      setView,
      ask,
      relevel,
      stop,
      retry,
      summarize,
      stopSummary,
      selectThread,
      startFresh,
      hydrateThread,
      setDraft,
    }),
    [
      paperId,
      state,
      openExplain,
      openDiagram,
      redraw,
      askAbout,
      openPanel,
      closeExplain,
      setView,
      ask,
      relevel,
      stop,
      retry,
      summarize,
      stopSummary,
      selectThread,
      startFresh,
      hydrateThread,
      setDraft,
    ],
  );
}
