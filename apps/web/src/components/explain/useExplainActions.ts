'use client';

/**
 * explain/useExplainActions — the explain panel's controller and the `openExplain` half of
 * `ReaderActions` (contracts.md §5). Owned by S6.
 *
 * ONE CONVERSATION PER ASK. `openExplain` always starts over: it stops whatever was streaming
 * (the run is cancelled, not abandoned), clears the thread, and sends the new passage as a fresh
 * `explain` thread. A second Ask or a new selection therefore never lands in the previous
 * answer's thread (the old Inspector's "one ask per mount" machine is gone with R12). Every
 * async continuation carries the epoch it started in, and the reducer drops events from any other
 * epoch, so a slow stream from the previous ask cannot write into the new one.
 *
 * WHAT THE WIRE GIVES AND WHAT THIS DOES WITH IT (contracts.md §2.5, §2.6):
 *   run        the run, thread and message ids (kept for cancel, retry and Send to canvas)
 *   status     the label shown while the assistant reads; never a tool name or an id
 *   text       appended; the `[bN]` handles stay in the text and are resolved at render time
 *   citations  keyed by `citation_id`; they arrive once, just before `done`
 *   usage      the run's tokens and estimated cost
 *   done       the final status; an error keeps whatever text had arrived
 *
 * The controller is handed to `<ExplainPanel controller={…}/>` as ONE opaque prop, so the panel
 * can grow without touching the workspace's mount lines.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { Anchor } from '@papertree/anchoring';

import { mergeStored, type ThreadMessage } from '@/features/explain/model/messages';
import { originOf } from '@/features/explain/model/threads';
import { summaryApi } from '@/lib/api/summary';
import { threadsApi, type CreateThreadBody } from '@/lib/api/threads';
import type { Message, RunSummary, SseEvent, Summary, Thread } from '@/lib/api/types';

import { failureOf, type Failure } from './errors';

export interface ExplainRequest {
  readonly anchor: Anchor;
  /** The exact selected text, verbatim — the paper's words, rendered in the paper's register. */
  readonly quote: string;
}

export type { MessageStatus } from '@/features/explain/model/messages';

/** One line of the conversation as the panel shows it (defined beside the merge that builds it). */
export type ViewMessage = ThreadMessage;

export type SummaryPhase = 'idle' | 'loading' | 'streaming' | 'ready' | 'partial' | 'failed';

export interface SummaryView {
  readonly phase: SummaryPhase;
  readonly label: string | null;
  readonly runId: string | null;
  readonly summary: Summary | null;
  readonly failure: Failure | null;
  readonly usage: RunSummary | null;
}

export type PanelView = 'thread' | 'summary';

export interface ExplainState {
  /** Bumped by every `openExplain`; async continuations of an older epoch are ignored. */
  readonly epoch: number;
  readonly open: boolean;
  readonly view: PanelView;
  readonly request: ExplainRequest | null;
  readonly threadId: string | null;
  readonly messages: readonly ViewMessage[];
  readonly summary: SummaryView;
  /**
   * The person chose "New thread" (#202): the panel stays empty for a fresh question instead of
   * opening on the newest stored thread, and that question starts a new thread.
   */
  readonly fresh: boolean;
}

const IDLE_SUMMARY: SummaryView = {
  phase: 'idle',
  label: null,
  runId: null,
  summary: null,
  failure: null,
  usage: null,
};

const INITIAL: ExplainState = {
  epoch: 0,
  open: false,
  view: 'thread',
  request: null,
  threadId: null,
  messages: [],
  summary: IDLE_SUMMARY,
  fresh: false,
};

type Action =
  | { type: 'open'; epoch: number; request: ExplainRequest | null; view: PanelView }
  | { type: 'close' }
  | { type: 'view'; view: PanelView }
  | { type: 'thread'; epoch: number; threadId: string }
  | { type: 'select'; epoch: number; threadId: string; request: ExplainRequest | null }
  | { type: 'fresh'; epoch: number }
  | { type: 'hydrate'; threadId: string; messages: readonly Message[] }
  | { type: 'add'; epoch: number; message: ViewMessage }
  | { type: 'patch'; epoch: number; key: string; patch: Partial<ViewMessage> }
  | { type: 'append'; epoch: number; key: string; delta: string }
  | { type: 'summary'; patch: Partial<SummaryView> };

export function explainReducer(state: ExplainState, action: Action): ExplainState {
  switch (action.type) {
    case 'open':
      return {
        ...state,
        epoch: action.epoch,
        open: true,
        view: action.view,
        request: action.request,
        threadId: null,
        messages: [],
        fresh: false,
      };
    case 'fresh':
      return {
        ...state,
        epoch: action.epoch,
        open: true,
        view: 'thread',
        request: null,
        threadId: null,
        messages: [],
        fresh: true,
      };
    case 'close':
      return { ...state, open: false };
    case 'view':
      return { ...state, view: action.view, open: true };
    case 'thread':
      return action.epoch === state.epoch ? { ...state, threadId: action.threadId } : state;
    case 'select':
      return {
        ...state,
        epoch: action.epoch,
        open: true,
        view: 'thread',
        request: action.request,
        threadId: action.threadId,
        messages: [],
        fresh: false,
      };
    case 'hydrate':
      // A detail read for a thread the panel has left (the menu moved on) is dropped.
      return action.threadId === state.threadId
        ? { ...state, messages: mergeStored(state.messages, action.messages) }
        : state;
    case 'add':
      return action.epoch === state.epoch
        ? { ...state, messages: [...state.messages, action.message] }
        : state;
    case 'patch':
      return action.epoch === state.epoch
        ? {
            ...state,
            messages: state.messages.map((m) =>
              m.key === action.key ? { ...m, ...action.patch } : m,
            ),
          }
        : state;
    case 'append':
      return action.epoch === state.epoch
        ? {
            ...state,
            messages: state.messages.map((m) =>
              m.key === action.key ? { ...m, text: m.text + action.delta } : m,
            ),
          }
        : state;
    case 'summary':
      return { ...state, summary: { ...state.summary, ...action.patch } };
  }
}

export interface ExplainController {
  /** The API paper, or `null` for a fixture paper, which no server can be asked about. */
  readonly paperId: string | null;
  readonly state: ExplainState;
  /** What the panel is open on; `null` when it was opened without a selection (or is closed). */
  readonly request: ExplainRequest | null;
  readonly openExplain: (input: ExplainRequest) => void;
  /** Open the panel with no passage: the free-question and summary entry. */
  readonly openPanel: () => void;
  readonly closeExplain: () => void;
  readonly setView: (view: PanelView) => void;
  /** A question typed in the panel: a follow-up when a thread exists, else a free `ask`. */
  readonly ask: (question: string) => void;
  /** Stop the answer that is streaming; its partial text stays. */
  readonly stop: () => void;
  /** Re-run a failed, stopped or partial answer. */
  readonly retry: (key: string) => void;
  /**
   * Show the paper summary: the cached one, or a new run when there is none. `regenerate` skips
   * the cache and asks for a new run (the "Regenerate" action on a partial summary).
   */
  readonly summarize: (options?: { readonly regenerate?: boolean }) => void;
  readonly stopSummary: () => void;
  /** Show a stored thread (the thread menu, or the newest one when the panel opens empty). */
  readonly selectThread: (thread: Thread) => void;
  /** "New thread": an empty panel whose next question starts a new thread (owner may change). */
  readonly startFresh: () => void;
  /**
   * Merge a stored read of the current thread into the panel (#202): live while streaming, the
   * stored copy (locators, coverage) once settled, under the same keys. Other threads are ignored.
   */
  readonly hydrateThread: (threadId: string, messages: readonly Message[]) => void;
}

const DEFAULT_EXPLAIN_QUESTION = 'Explain this passage.';

let counter = 0;
const nextKey = (): string => `m${String((counter += 1))}`;

function blankAssistant(question: string): ViewMessage {
  return {
    key: nextKey(),
    role: 'assistant',
    text: '',
    messageId: null,
    runId: null,
    status: 'streaming',
    stopped: false,
    label: null,
    failure: null,
    citations: [],
    usage: null,
    question,
    createdAt: new Date().toISOString(),
    coverage: null,
    generation: null,
  };
}

export function useExplainActions(options: { readonly paperId: string | null }): ExplainController {
  const { paperId } = options;
  const [state, dispatch] = useReducer(explainReducer, INITIAL);

  // The latest state for async code, which must read it at the time it runs, not when it started.
  const stateRef = useRef(state);
  stateRef.current = state;
  const epochRef = useRef(0);
  const threadAbort = useRef<AbortController | null>(null);
  const summaryAbort = useRef<AbortController | null>(null);

  /** Stop the thread's stream and tell the server (a run nobody reads must not keep spending). */
  const halt = useCallback((markStopped: boolean): void => {
    const live = stateRef.current.messages.find(
      (m) => m.role === 'assistant' && m.status === 'streaming',
    );
    const controller = threadAbort.current;
    threadAbort.current = null;
    if (live !== undefined) {
      if (live.runId !== null) threadsApi.cancelRun(live.runId).catch(() => undefined);
      dispatch({
        type: 'patch',
        epoch: stateRef.current.epoch,
        key: live.key,
        patch: {
          status: 'aborted',
          stopped: markStopped,
          label: null,
          failure: markStopped ? null : { code: 'aborted', retryable: true },
        },
      });
    }
    controller?.abort();
  }, []);

  /** Read one SSE answer into the message `key`. Resolves when the stream ends. */
  const consume = useCallback(
    async (
      epoch: number,
      key: string,
      open: (signal: AbortSignal) => AsyncGenerator<SseEvent>,
      userKey: string | null,
    ): Promise<void> => {
      const controller = new AbortController();
      threadAbort.current = controller;
      const patch = (p: Partial<ViewMessage>): void =>
        dispatch({ type: 'patch', epoch, key, patch: p });
      let finished = false;
      try {
        for await (const event of open(controller.signal)) {
          if (epochRef.current !== epoch) return;
          switch (event.event) {
            case 'run':
              patch({
                runId: event.data.run_id,
                messageId: event.data.message_id,
                generation: event.data.generation,
              });
              // The ask's server id lets a stored read of the thread recognise it (no duplicate).
              if (userKey !== null && event.data.user_message_id !== null) {
                dispatch({
                  type: 'patch',
                  epoch,
                  key: userKey,
                  patch: { messageId: event.data.user_message_id },
                });
              }
              if (event.data.thread_id !== null) {
                dispatch({ type: 'thread', epoch, threadId: event.data.thread_id });
              }
              break;
            case 'status':
              patch({ label: statusLabel(event.data) });
              break;
            case 'text':
              dispatch({ type: 'append', epoch, key, delta: event.data.delta });
              patch({ label: null });
              break;
            case 'citations':
              patch({ citations: event.data.items });
              break;
            case 'usage':
              patch({ usage: event.data });
              break;
            case 'done': {
              finished = true;
              const { status, error } = event.data;
              patch({
                status,
                label: null,
                messageId: event.data.message_id,
                failure:
                  status === 'complete'
                    ? null
                    : error !== null
                      ? { code: error.code, retryable: error.retryable }
                      : status === 'aborted'
                        ? { code: 'aborted', retryable: true }
                        : null,
              });
              break;
            }
          }
        }
        if (!finished && !controller.signal.aborted && epochRef.current === epoch) {
          // The stream closed without a `done`: whatever text arrived is kept, and said to be cut.
          const m = stateRef.current.messages.find((x) => x.key === key);
          patch({
            status: m !== undefined && m.text.length > 0 ? 'partial' : 'error',
            label: null,
            failure: { code: 'network', retryable: true },
          });
        }
      } catch (error) {
        if (controller.signal.aborted || epochRef.current !== epoch) return;
        patch({ status: 'error', label: null, failure: failureOf(error) });
      } finally {
        if (threadAbort.current === controller) threadAbort.current = null;
      }
    },
    [],
  );

  const startTurn = useCallback(
    (
      epoch: number,
      question: string,
      show: boolean,
      open: (signal: AbortSignal) => AsyncGenerator<SseEvent>,
      reuse?: string,
    ): void => {
      const userKey = show ? nextKey() : null;
      if (userKey !== null) {
        dispatch({
          type: 'add',
          epoch,
          message: {
            ...blankAssistant(question),
            key: userKey,
            role: 'user',
            text: question,
            status: 'complete',
          },
        });
      }
      let key = reuse;
      if (key === undefined) {
        const assistant = blankAssistant(question);
        key = assistant.key;
        dispatch({ type: 'add', epoch, message: assistant });
      } else {
        dispatch({
          type: 'patch',
          epoch,
          key,
          patch: {
            text: '',
            status: 'streaming',
            stopped: false,
            failure: null,
            label: null,
            citations: [],
            usage: null,
          },
        });
      }
      void consume(epoch, key, open, userKey);
    },
    [consume],
  );

  const sendCreate = useCallback(
    (
      epoch: number,
      request: ExplainRequest | null,
      question: string | undefined,
      show: boolean,
    ) => {
      if (paperId === null) return;
      const body: CreateThreadBody =
        request === null
          ? { kind: 'ask', question: question ?? '' }
          : {
              kind: 'explain',
              anchor: request.anchor,
              ...(question === undefined ? {} : { question }),
            };
      const shown = question ?? DEFAULT_EXPLAIN_QUESTION;
      startTurn(epoch, shown, show, (signal) => threadsApi.create(paperId, body, signal));
    },
    [paperId, startTurn],
  );

  const openExplain = useCallback(
    (input: ExplainRequest): void => {
      halt(false);
      const epoch = (epochRef.current += 1);
      dispatch({ type: 'open', epoch, request: input, view: 'thread' });
      stateRef.current = { ...stateRef.current, epoch, messages: [], threadId: null };
      sendCreate(epoch, input, undefined, false);
    },
    [halt, sendCreate],
  );

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

  const ask = useCallback(
    (raw: string): void => {
      const question = raw.trim();
      const current = stateRef.current;
      if (paperId === null || question.length === 0) return;
      if (current.messages.some((m) => m.status === 'streaming')) return;
      const epoch = current.epoch;
      if (current.threadId !== null) {
        const threadId = current.threadId;
        startTurn(epoch, question, true, (signal) =>
          threadsApi.followUp(paperId, threadId, { question }, signal),
        );
      } else {
        sendCreate(epoch, current.messages.length === 0 ? current.request : null, question, true);
      }
    },
    [paperId, sendCreate, startTurn],
  );

  // The server keeps the partial text it had; `useThreads` reads the thread again once the run
  // has settled (one path for done, Stop and failures), so the stored copy replaces this one.
  const stop = useCallback((): void => halt(true), [halt]);

  const retry = useCallback(
    (key: string): void => {
      const current = stateRef.current;
      const message = current.messages.find((m) => m.key === key);
      if (paperId === null || message === undefined || message.status === 'streaming') return;
      const epoch = current.epoch;
      const question = message.question;
      if (current.threadId !== null) {
        const threadId = current.threadId;
        const retryOf = message.messageId;
        startTurn(
          epoch,
          question,
          false,
          (signal) =>
            threadsApi.followUp(
              paperId,
              threadId,
              retryOf === null ? { question } : { question, retry_of: retryOf },
              signal,
            ),
          key,
        );
      } else {
        // The first turn never reached a thread (it failed before the stream): send it again.
        const first = current.messages[0];
        const asExplain = current.request !== null && first === message;
        startTurn(
          epoch,
          question,
          false,
          (signal) =>
            threadsApi.create(
              paperId,
              asExplain && current.request !== null
                ? {
                    kind: 'explain',
                    anchor: current.request.anchor,
                    ...(question === DEFAULT_EXPLAIN_QUESTION ? {} : { question }),
                  }
                : { kind: 'ask', question },
              signal,
            ),
          key,
        );
      }
    },
    [paperId, startTurn],
  );

  // ── the paper summary ────────────────────────────────────────────────────────────────────

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
      set({ phase: 'loading', failure: null, label: null, usage: null });

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
              set({ phase: cached.state, summary: cached.summary });
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
              set({ phase: s.state === 'partial' ? 'partial' : 'ready', summary: s.summary });
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
    [paperId],
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
  }, []);

  const setView = useCallback((view: PanelView): void => dispatch({ type: 'view', view }), []);

  const selectThread = useCallback(
    (thread: Thread): void => {
      halt(true);
      const epoch = (epochRef.current += 1);
      const request = originOf(thread);
      dispatch({ type: 'select', epoch, threadId: thread.thread_id, request });
      stateRef.current = {
        ...stateRef.current,
        epoch,
        request,
        threadId: thread.thread_id,
        messages: [],
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
      summaryAbort.current?.abort();
    },
    [],
  );

  return useMemo(
    () => ({
      paperId,
      state,
      request: state.open ? state.request : null,
      openExplain,
      openPanel,
      closeExplain,
      setView,
      ask,
      stop,
      retry,
      summarize,
      stopSummary,
      selectThread,
      startFresh,
      hydrateThread,
    }),
    [
      paperId,
      state,
      openExplain,
      openPanel,
      closeExplain,
      setView,
      ask,
      stop,
      retry,
      summarize,
      stopSummary,
      selectThread,
      startFresh,
      hydrateThread,
    ],
  );
}

function statusLabel(status: {
  readonly phase: 'thinking' | 'tool' | 'retrying' | 'writing';
  readonly label?: string;
  readonly attempt?: number;
}): string | null {
  if (status.phase === 'writing') return null;
  if (status.label !== undefined && status.label.length > 0) return status.label;
  if (status.phase === 'thinking') return 'Thinking';
  if (status.phase === 'tool') return 'Reading the paper';
  return status.attempt !== undefined
    ? `The AI service hiccuped. Trying again (attempt ${String(status.attempt)})`
    : 'The AI service hiccuped. Trying again';
}
