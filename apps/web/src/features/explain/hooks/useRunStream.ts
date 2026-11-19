/**
 * explain/useRunStream — one AI turn on the wire: start it, read its SSE into the message, stop it.
 *
 * WHAT THE WIRE GIVES AND WHAT THIS DOES WITH IT (contracts.md §2.5, §2.6):
 *   run        the run, thread and message ids (kept for cancel, retry and Send to canvas)
 *   status     the label shown while the assistant reads; never a tool name or an id
 *   text       appended; the `[bN]` handles stay in the text and are resolved at render time
 *   citations  keyed by `citation_id`; they arrive once, just before `done`
 *   usage      the run's tokens and estimated cost
 *   done       the final status; an error keeps whatever text had arrived
 *
 * Every async continuation carries the epoch it started in; the reducer drops events of any other.
 */
import { useCallback, type Dispatch, type MutableRefObject } from 'react';

import { failureOf } from '@/components/explain/errors';
import { applyPlateEvent, EMPTY_PLATE, withNote, type PlateEvent } from '@/features/diagram';
import { threadsApi } from '@/lib/api/threads';
import { ApiError, type SseEvent } from '@/lib/api/types';

import { refusedBeforeStream } from '../model/states';
import { blankAssistant, nextKey, statusLabel } from '../model/turns';

import type { AskOutcome } from '../model/controller';
import type { ThreadMessage } from '../model/messages';
import type { ExplainAction, ExplainState } from '../model/state';

/** The controller's mutable pieces every action reads at the time it runs, not when it started. */
export interface ExplainRefs {
  readonly dispatch: Dispatch<ExplainAction>;
  /** The latest state, for async code. */
  readonly stateRef: MutableRefObject<ExplainState>;
  /** Bumped by every open; a continuation of an older epoch is ignored. */
  readonly epochRef: MutableRefObject<number>;
  /** The thread's running stream, if any. */
  readonly threadAbort: MutableRefObject<AbortController | null>;
}

/** What `useRunStream` gives the actions that start turns. */
export interface RunStream {
  /** Stop the thread's stream and tell the server (a run nobody reads must not keep spending). */
  readonly halt: (markStopped: boolean) => void;
  /**
   * Start a turn: add the ask and a blank answer (or reuse `reuse`) and read the stream into it.
   * Resolves `not-sent` only when the server refused it before the stream.
   */
  readonly startTurn: (
    epoch: number,
    question: string,
    show: boolean,
    open: (signal: AbortSignal) => AsyncGenerator<SseEvent>,
    reuse?: string,
    diagramTurn?: Partial<ThreadMessage>,
    /** What the new answer carries from the start: its level, its sibling group, `quick`. */
    extra?: Partial<ThreadMessage>,
  ) => Promise<AskOutcome>;
}

/**
 * The turn runner of the explain controller.
 *
 * @param refs The controller's dispatch and refs.
 * @returns `halt` and `startTurn`.
 */
export function useRunStream(refs: ExplainRefs): RunStream {
  const { dispatch, stateRef, epochRef, threadAbort } = refs;

  /** Stop the thread's stream and tell the server (a run nobody reads must not keep spending). */
  const halt = useCallback(
    (markStopped: boolean): void => {
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
    },
    [dispatch, stateRef, threadAbort],
  );

  /** Read one SSE answer into the message `key`. Resolves when the stream ends. */
  const consume = useCallback(
    async (
      epoch: number,
      key: string,
      open: (signal: AbortSignal) => AsyncGenerator<SseEvent>,
      userKey: string | null,
      before: ThreadMessage | null,
      diagram = false,
    ): Promise<AskOutcome> => {
      const controller = new AbortController();
      threadAbort.current = controller;
      const patch = (p: Partial<ThreadMessage>): void =>
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
    [dispatch, stateRef, epochRef, threadAbort],
  );

  const startTurn = useCallback(
    (
      epoch: number,
      question: string,
      show: boolean,
      open: (signal: AbortSignal) => AsyncGenerator<SseEvent>,
      reuse?: string,
      diagramTurn?: Partial<ThreadMessage>,
      /** What the new answer carries from the start: its level, the answer it re-levels, `quick`. */
      extra?: Partial<ThreadMessage>,
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
        const assistant = { ...blankAssistant(question, diagram, extra), ...diagramTurn };
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
    [consume, dispatch, stateRef],
  );

  return { halt, startTurn };
}
