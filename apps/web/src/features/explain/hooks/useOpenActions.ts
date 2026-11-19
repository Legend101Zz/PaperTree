/**
 * explain/useOpenActions — how the panel's thread starts: Explain a selection, Explain with a
 * diagram, Redraw a plate, Ask about a passage.
 *
 * ONE CONVERSATION PER ASK. Each of these always starts over: it stops whatever was streaming (the
 * run is cancelled, not abandoned), clears the thread and bumps the epoch, so a second Ask or a new
 * selection never lands in the previous answer's thread.
 */
import { useCallback } from 'react';

import { threadsApi, type CreateThreadBody } from '@/lib/api/threads';

import { DIAGRAM_QUESTION, isStreaming, newestPlate, REDRAW_QUESTION } from '../model/turns';

import type { ExplainRequest } from '../model/state';
import type { ThreadTurns } from './useThreadTurns';
import type { ExplainRefs, RunStream } from './useRunStream';

/** The actions of `useOpenActions`. */
export interface OpenActions {
  /** Start an `explain` thread on the selected passage. */
  readonly openExplain: (input: ExplainRequest) => void;
  /** Start a `diagram` thread on the selected passage (#217). */
  readonly openDiagram: (input: ExplainRequest) => void;
  /** Redraw a plate: a new plate under a new ask in the same thread (`redraw_of`). */
  readonly redraw: (key: string) => void;
  /** Open the panel on a passage with nothing sent: the reader's own question starts the thread. */
  readonly askAbout: (input: ExplainRequest) => void;
}

/**
 * The open actions of the explain controller.
 *
 * @param paperId The API paper, or null for a fixture paper.
 * @param refs The controller's dispatch and refs.
 * @param run The turn runner.
 * @param turns The thread-turn actions (the first question).
 * @returns The actions.
 */
export function useOpenActions(
  paperId: string | null,
  refs: ExplainRefs,
  run: RunStream,
  turns: Pick<ThreadTurns, 'sendCreate'>,
): OpenActions {
  const { dispatch, stateRef, epochRef } = refs;
  const { halt, startTurn } = run;
  const { sendCreate } = turns;

  const openExplain = useCallback(
    (input: ExplainRequest): void => {
      halt(false);
      const epoch = (epochRef.current += 1);
      dispatch({ type: 'open', epoch, request: input, view: 'thread' });
      stateRef.current = { ...stateRef.current, epoch, messages: [], threadId: null };
      void sendCreate(epoch, input, undefined, false);
    },
    [halt, sendCreate, dispatch, stateRef, epochRef],
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
    [halt, paperId, startTurn, dispatch, stateRef, epochRef],
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
    [paperId, startTurn, stateRef],
  );

  const askAbout = useCallback(
    (input: ExplainRequest): void => {
      halt(false);
      const epoch = (epochRef.current += 1);
      dispatch({ type: 'open', epoch, request: input, view: 'thread' });
      stateRef.current = { ...stateRef.current, epoch, messages: [], threadId: null };
    },
    [halt, dispatch, stateRef, epochRef],
  );

  return { openExplain, openDiagram, redraw, askAbout };
}
