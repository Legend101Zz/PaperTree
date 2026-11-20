/**
 * explain/useThreadTurns — the turns a reader sends into a thread: the first question (create), a
 * follow-up, a level switch (`relevel_of`, a sibling answer), and Retry.
 */
import { useCallback } from 'react';

import { threadsApi, type FollowUpBody } from '@/lib/api/threads';

import { createBodyFor } from '../model/createBody';
import { levelOf } from '../model/levels';
import { DEFAULT_EXPLAIN_QUESTION, DEFAULT_IMAGE_QUESTION, isStreaming } from '../model/turns';

import type { AskOptions, AskOutcome } from '../model/controller';
import type { ExplainRequest } from '../model/state';
import type { AnswerLevel } from '@/lib/api/types';
import type { ExplainRefs, RunStream } from './useRunStream';

/** The actions of `useThreadTurns`. */
export interface ThreadTurns {
  /** Send the first question of a new thread: an explain on `request`, else a free ask. */
  readonly sendCreate: (
    epoch: number,
    request: ExplainRequest | null,
    question: string | undefined,
    show: boolean,
  ) => Promise<AskOutcome>;
  /** A question typed in the panel (or a chip's fixed one): a follow-up, else a free ask. */
  readonly ask: (question: string, options?: AskOptions) => Promise<AskOutcome>;
  /** Switch an answer to another level: shown from what is held, else asked again (`relevel_of`). */
  readonly relevel: (messageId: string, level: AnswerLevel) => void;
  /** Re-run a failed, stopped or partial answer. */
  readonly retry: (key: string) => void;
}

/**
 * The thread-turn actions of the explain controller.
 *
 * @param paperId The API paper, or null for a fixture paper.
 * @param refs The controller's dispatch and refs.
 * @param run The turn runner.
 * @returns The actions.
 */
export function useThreadTurns(
  paperId: string | null,
  refs: ExplainRefs,
  run: Pick<RunStream, 'startTurn'>,
): ThreadTurns {
  const { dispatch, stateRef } = refs;
  const { startTurn } = run;

  const sendCreate = useCallback(
    (
      epoch: number,
      request: ExplainRequest | null,
      question: string | undefined,
      show: boolean,
    ): Promise<AskOutcome> => {
      if (paperId === null) return Promise.resolve('sent');
      const level = stateRef.current.level;
      const body = createBodyFor(request, question, level);
      const shown =
        question ??
        (request?.image === undefined ? DEFAULT_EXPLAIN_QUESTION : DEFAULT_IMAGE_QUESTION);
      return startTurn(
        epoch,
        shown,
        show,
        (signal) => threadsApi.create(paperId, body, signal),
        undefined,
        undefined,
        { level },
      );
    },
    [paperId, startTurn, stateRef],
  );

  const send = useCallback(
    (question: string, options?: AskOptions): Promise<AskOutcome> => {
      const current = stateRef.current;
      if (paperId === null || question.length === 0) return Promise.resolve('not-sent');
      if (current.messages.some((m) => m.status === 'streaming')) {
        return Promise.resolve('not-sent');
      }
      const epoch = current.epoch;
      if (current.threadId !== null) {
        const threadId = current.threadId;
        const level = current.level;
        return startTurn(
          epoch,
          question,
          true,
          (signal) => threadsApi.followUp(paperId, threadId, { question, level }, signal),
          undefined,
          undefined,
          { level, ...(options?.quick === true ? { quick: true } : {}) },
        );
      }
      return sendCreate(
        epoch,
        current.messages.length === 0 ? current.request : null,
        question,
        true,
      );
    },
    [paperId, sendCreate, startTurn, stateRef],
  );

  const ask = useCallback(
    (raw: string, options?: AskOptions): Promise<AskOutcome> => {
      const question = raw.trim();
      return send(question, options).then((outcome) => {
        // Not sent: the words go back into the box, unless the reader has typed since. A chip's
        // fixed question was never in the box.
        if (outcome === 'not-sent' && question.length > 0 && options?.quick !== true) {
          dispatch({ type: 'draft', text: question, restore: true });
        }
        return outcome;
      });
    },
    [send, dispatch],
  );

  const relevel = useCallback(
    (messageId: string, level: AnswerLevel): void => {
      const current = stateRef.current;
      dispatch({ type: 'level', level });
      // The answer the user turn started and its siblings (they share its `sibling_group`).
      const group = current.messages.filter(
        (m) =>
          m.role === 'assistant' && (m.messageId === messageId || m.siblingGroup === messageId),
      );
      const root = group.find((m) => m.messageId === messageId);
      // A level the answer already has is shown from what is held: no request, nothing re-streamed.
      if (paperId === null || root === undefined || group.some((m) => levelOf(m) === level)) return;
      if (current.threadId === null || current.messages.some(isStreaming)) return;
      const threadId = current.threadId;
      // No `question`: the server re-asks the stored one.
      const body: FollowUpBody = { level, relevel_of: messageId };
      void startTurn(
        current.epoch,
        root.question,
        false,
        (signal) => threadsApi.followUp(paperId, threadId, body, signal),
        undefined,
        undefined,
        { level, siblingGroup: messageId, quick: true },
      );
    },
    [paperId, startTurn, stateRef, dispatch],
  );

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
        const group = message.siblingGroup;
        // A sibling at another level has no user turn of its own to retry (`retry_of` answers the
        // user turn before it): it is asked again as the same question at its level (`relevel_of`).
        const asSibling = group != null && group !== message.messageId;
        const body: FollowUpBody = asSibling
          ? { level: levelOf(message), relevel_of: group }
          : {
              question,
              ...(message.level == null ? {} : { level: message.level }),
              ...(retryOf === null ? {} : { retry_of: retryOf }),
            };
        void startTurn(
          epoch,
          question,
          false,
          (signal) => threadsApi.followUp(paperId, threadId, body, signal),
          key,
        );
      } else {
        // The first turn never reached a thread (it failed before the stream): send it again.
        const first = current.messages[0];
        const asExplain = current.request !== null && first === message;
        const request = current.request;
        const body = createBodyFor(
          asExplain ? request : null,
          // The default question is left to the server, which asks it of the kind's own wording.
          asExplain &&
            (question === DEFAULT_EXPLAIN_QUESTION || question === DEFAULT_IMAGE_QUESTION)
            ? undefined
            : question,
          levelOf(message),
        );
        void startTurn(
          epoch,
          question,
          false,
          (signal) => threadsApi.create(paperId, body, signal),
          key,
        );
      }
    },
    [paperId, startTurn, stateRef],
  );

  return { sendCreate, ask, relevel, retry };
}
