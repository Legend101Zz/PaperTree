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

import {
  applyPlateEvent,
  EMPTY_PLATE,
  withNote,
  type PlateEvent,
  type PlateView,
} from '@/features/diagram';
import { mergeStored, type ThreadMessage } from '@/features/explain/model/messages';
import { refusedBeforeStream } from '@/features/explain/model/states';
import { originOf } from '@/features/explain/model/threads';
import { summaryApi } from '@/lib/api/summary';
import { threadsApi, type CreateThreadBody } from '@/lib/api/threads';
import {
  ApiError,
  type Message,
  type RunSummary,
  type SseEvent,
  type Summary,
  type Thread,
} from '@/lib/api/types';

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
  /** Shown from the stored derivation, so no tokens were spent on it now (#204's footer). */
  readonly cached: boolean;
  /** The last request skipped the cache ("Summarise again"): its Retry asks for a new run again. */
  readonly regenerate: boolean;
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
  /**
   * The composer's text, held here so it outlives the composer (the summary view and a closed
   * panel unmount it): a question refused before it was sent comes back into it (#204).
   */
  readonly draft: string;
  /** The thread is a diagram's (#217): its only next turn is a Redraw, never a typed question. */
  readonly diagram: boolean;
}

const IDLE_SUMMARY: SummaryView = {
  phase: 'idle',
  label: null,
  runId: null,
  summary: null,
  failure: null,
  usage: null,
  cached: false,
  regenerate: false,
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
  draft: '',
  diagram: false,
};

type Action =
  | {
      type: 'open';
      epoch: number;
      request: ExplainRequest | null;
      view: PanelView;
      diagram?: boolean;
    }
  | { type: 'close' }
  | { type: 'view'; view: PanelView }
  | { type: 'thread'; epoch: number; threadId: string }
  | {
      type: 'select';
      epoch: number;
      threadId: string;
      request: ExplainRequest | null;
      diagram: boolean;
    }
  | { type: 'fresh'; epoch: number }
  | { type: 'hydrate'; threadId: string; messages: readonly Message[] }
  | { type: 'add'; epoch: number; message: ViewMessage }
  | { type: 'patch'; epoch: number; key: string; patch: Partial<ViewMessage> }
  | { type: 'append'; epoch: number; key: string; delta: string }
  /** A diagram answer's plate grows by one event (or one note), #217. */
  | { type: 'plate'; epoch: number; key: string; update: (plate: PlateView) => PlateView }
  | { type: 'summary'; patch: Partial<SummaryView> }
  /** `restore`: a refused question returns only to an empty box, never over words typed since. */
  | { type: 'draft'; text: string; restore?: boolean }
  /** A new ask or retry: earlier refused Retries have been answered by the reader's next action. */
  | { type: 'clearRefusals'; epoch: number };

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
        diagram: action.diagram === true,
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
        diagram: false,
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
        diagram: action.diagram,
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
    case 'plate':
      return action.epoch === state.epoch
        ? {
            ...state,
            messages: state.messages.map((m) =>
              m.key === action.key ? { ...m, diagram: action.update(m.diagram ?? EMPTY_PLATE) } : m,
            ),
          }
        : state;
    case 'draft':
      return action.restore === true && state.draft.trim() !== ''
        ? state
        : { ...state, draft: action.text };
    case 'clearRefusals':
      return action.epoch === state.epoch &&
        state.messages.some((m) => m.refusal !== undefined && m.refusal !== null)
        ? { ...state, messages: state.messages.map((m) => ({ ...m, refusal: null })) }
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
  /** The selection toolbar's "Explain with a diagram" (#217): a new diagram thread on the passage. */
  readonly openDiagram: (input: ExplainRequest) => void;
  /**
   * Redraw a plate (#217): a new plate under a new ask in the same thread (`redraw_of`). On a plate
   * that never arrived (refused or failed before it was written) it asks for that plate again.
   */
  readonly redraw: (key: string) => void;
  /**
   * The selection toolbar's Ask (#203): open the panel on this passage with nothing sent, so the
   * reader's own question (`ask`) starts the thread about it.
   */
  readonly askAbout: (input: ExplainRequest) => void;
  /** Open the panel with no passage: the free-question and summary entry. */
  readonly openPanel: () => void;
  readonly closeExplain: () => void;
  readonly setView: (view: PanelView) => void;
  /**
   * A question typed in the panel: a follow-up when a thread exists, else a free `ask`. Resolves
   * `not-sent` when the server refused it before the stream (the composer then keeps the text).
   */
  readonly ask: (question: string) => Promise<AskOutcome>;
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
  /** The composer's text changed (the composer is controlled by `state.draft`). */
  readonly setDraft: (text: string) => void;
}

/** Whether an ask reached the AI: `not-sent` only for a refusal before the stream (#204). */
export type AskOutcome = 'sent' | 'not-sent';

const DEFAULT_EXPLAIN_QUESTION = 'Explain this passage.';
/** The server's default ask of a diagram thread (`schemas.DIAGRAM_QUESTION`). */
const DIAGRAM_QUESTION = 'Explain with a diagram.';
/** A Redraw's ask: it names the exchange it opens in the thread menu (#217). */
const REDRAW_QUESTION = 'Redraw the diagram.';

let counter = 0;
const nextKey = (): string => `m${String((counter += 1))}`;

function blankAssistant(question: string, diagram = false): ViewMessage {
  return {
    ...(diagram ? { diagram: EMPTY_PLATE } : {}),
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
          awaitingStored: markStopped,
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
      before: ViewMessage | null,
      diagram = false,
    ): Promise<AskOutcome> => {
      const controller = new AbortController();
      threadAbort.current = controller;
      const patch = (p: Partial<ViewMessage>): void =>
        dispatch({ type: 'patch', epoch, key, patch: p });
      let finished = false;
      let accepted = false;
      try {
        for await (const event of open(controller.signal)) {
          if (epochRef.current !== epoch) return 'sent';
          switch (event.event) {
            case 'run':
              accepted = true;
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
              // A diagram's writing-phase labels say what was left out (a skipped line, a dropped
              // arrow): kept under the plate, not flashed past as a working label.
              if (diagram && event.data.phase === 'writing' && event.data.label) {
                const note = event.data.label;
                dispatch({ type: 'plate', epoch, key, update: (p) => withNote(p, note) });
              } else {
                patch({ label: statusLabel(event.data) });
              }
              break;
            case 'plate':
            case 'part':
            case 'link': {
              const plateEvent: PlateEvent = event;
              dispatch({
                type: 'plate',
                epoch,
                key,
                update: (p) => applyPlateEvent(p, plateEvent),
              });
              break;
            }
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
        if (controller.signal.aborted || epochRef.current !== epoch) return 'sent';
        const failure = failureOf(error);
        // A documented refusal before the stream wrote nothing: the AI never saw the question.
        const refused =
          !accepted && error instanceof ApiError && refusedBeforeStream(error.status, error.code);
        if (!refused) {
          patch({ status: 'error', label: null, failure });
          return 'sent';
        }
        // A refused Retry leaves the answer it would have replaced as it was, the refusal beneath
        // it; a refused new ask is the ask that was not sent.
        if (before !== null) patch({ ...before, refusal: failure });
        else patch({ status: 'error', label: null, failure: { ...failure, notSent: true } });
        return 'not-sent';
      } finally {
        if (threadAbort.current === controller) threadAbort.current = null;
      }
      return 'sent';
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
      diagramTurn?: Partial<ViewMessage>,
    ): Promise<AskOutcome> => {
      // A diagram turn (#217) carries its plate from the start, and any live facts it is given.
      const diagram = diagramTurn !== undefined;
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
      dispatch({ type: 'clearRefusals', epoch });
      const before =
        reuse === undefined
          ? null
          : (stateRef.current.messages.find((m) => m.key === reuse) ?? null);
      let key = reuse;
      if (key === undefined) {
        const assistant = { ...blankAssistant(question, diagram), ...diagramTurn };
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
            awaitingStored: false,
            refusal: null,
            ...(diagram ? { diagram: EMPTY_PLATE } : {}),
          },
        });
      }
      return consume(epoch, key, open, userKey, before, diagram);
    },
    [consume],
  );

  const sendCreate = useCallback(
    (
      epoch: number,
      request: ExplainRequest | null,
      question: string | undefined,
      show: boolean,
    ): Promise<AskOutcome> => {
      if (paperId === null) return Promise.resolve('sent');
      const body: CreateThreadBody =
        request === null
          ? { kind: 'ask', question: question ?? '' }
          : {
              kind: 'explain',
              anchor: request.anchor,
              ...(question === undefined ? {} : { question }),
            };
      const shown = question ?? DEFAULT_EXPLAIN_QUESTION;
      return startTurn(epoch, shown, show, (signal) => threadsApi.create(paperId, body, signal));
    },
    [paperId, startTurn],
  );

  const openExplain = useCallback(
    (input: ExplainRequest): void => {
      halt(false);
      const epoch = (epochRef.current += 1);
      dispatch({ type: 'open', epoch, request: input, view: 'thread' });
      stateRef.current = { ...stateRef.current, epoch, messages: [], threadId: null };
      void sendCreate(epoch, input, undefined, false);
    },
    [halt, sendCreate],
  );

  const openDiagram = useCallback(
    (input: ExplainRequest): void => {
      halt(false);
      const epoch = (epochRef.current += 1);
      dispatch({ type: 'open', epoch, request: input, view: 'thread', diagram: true });
      stateRef.current = {
        ...stateRef.current,
        epoch,
        messages: [],
        threadId: null,
        diagram: true,
      };
      if (paperId === null) return;
      const body: CreateThreadBody = { kind: 'diagram', anchor: input.anchor };
      const open = (signal: AbortSignal) => threadsApi.create(paperId, body, signal);
      void startTurn(epoch, DIAGRAM_QUESTION, false, open, undefined, {});
    },
    [halt, paperId, startTurn],
  );

  const redraw = useCallback(
    (key: string): void => {
      const current = stateRef.current;
      const target = current.messages.find((m) => m.key === key);
      if (paperId === null || target === undefined || current.messages.some(isStreaming)) return;
      const { epoch, threadId, request } = current;
      if (threadId === null) {
        // The first plate never reached a thread (refused or failed before its `run`): ask again.
        if (request === null) return;
        const body: CreateThreadBody = { kind: 'diagram', anchor: request.anchor };
        const open = (signal: AbortSignal) => threadsApi.create(paperId, body, signal);
        void startTurn(epoch, target.question, false, open, key, {});
        return;
      }
      // A Redraw that never arrived (refused before the stream) is sent again as the same Redraw,
      // in place; a plate that has an id gets a new plate under a new ask.
      const again = target.messageId === null;
      const of = again ? (target.redrawOf ?? newestPlate(current.messages)) : target.messageId;
      if (of === null) return;
      const body = { question: REDRAW_QUESTION, redraw_of: of };
      const open = (signal: AbortSignal) => threadsApi.followUp(paperId, threadId, body, signal);
      void startTurn(epoch, REDRAW_QUESTION, !again, open, again ? key : undefined, {
        redrawOf: of,
      });
    },
    [paperId, startTurn],
  );

  const askAbout = useCallback(
    (input: ExplainRequest): void => {
      halt(false);
      const epoch = (epochRef.current += 1);
      dispatch({ type: 'open', epoch, request: input, view: 'thread' });
      stateRef.current = { ...stateRef.current, epoch, messages: [], threadId: null };
    },
    [halt],
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

  const send = useCallback(
    (question: string): Promise<AskOutcome> => {
      const current = stateRef.current;
      if (paperId === null || question.length === 0) return Promise.resolve('not-sent');
      if (current.messages.some((m) => m.status === 'streaming')) {
        return Promise.resolve('not-sent');
      }
      const epoch = current.epoch;
      if (current.threadId !== null) {
        const threadId = current.threadId;
        return startTurn(epoch, question, true, (signal) =>
          threadsApi.followUp(paperId, threadId, { question }, signal),
        );
      }
      return sendCreate(
        epoch,
        current.messages.length === 0 ? current.request : null,
        question,
        true,
      );
    },
    [paperId, sendCreate, startTurn],
  );

  const ask = useCallback(
    (raw: string): Promise<AskOutcome> => {
      const question = raw.trim();
      return send(question).then((outcome) => {
        // Not sent: the words go back into the box, unless the reader has typed since.
        if (outcome === 'not-sent' && question.length > 0) {
          dispatch({ type: 'draft', text: question, restore: true });
        }
        return outcome;
      });
    },
    [send],
  );

  const setDraft = useCallback((text: string): void => dispatch({ type: 'draft', text }), []);

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
        void startTurn(
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
        void startTurn(
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
      openDiagram,
      redraw,
      askAbout,
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

function isStreaming(message: ViewMessage): boolean {
  return message.status === 'streaming';
}

/** The newest plate of the thread that has a server id: what a Redraw with nothing else redraws. */
function newestPlate(messages: readonly ViewMessage[]): string | null {
  return messages.findLast((m) => m.diagram != null && m.messageId !== null)?.messageId ?? null;
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
