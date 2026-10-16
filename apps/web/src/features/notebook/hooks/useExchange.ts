'use client';

/**
 * useExchange — the stored thread behind a dived page (S5c, #208). The page's exchange item keeps
 * the words; the thread keeps what the words point at (each handle's citation and S4a locator,
 * the run's usage, when the question was asked), so the block reads the answer back from the
 * thread rather than trusting a copy.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { threadsApi } from '@/lib/api/threads';

import { layoutAnswer } from '../model/exchange';

import type { AnswerLayout } from '../model/exchange';
import type { Message } from '@/lib/api/types';

/** The answer the page was dived from, with the question before it. */
export interface Exchange {
  readonly answer: Message | null;
  readonly question: Message | null;
  readonly layout: AnswerLayout | null;
  /** True while the thread is loading. */
  readonly loading: boolean;
}

/**
 * Reads the thread a page was dived from.
 *
 * @param paperId - The paper.
 * @param threadId - The page's `source_thread_id` (null for a page not dived from an answer).
 * @param messageId - The page's `source_message_id`.
 * @returns The answer, its question and its layout (all null when there is no thread to read).
 */
export function useExchange(
  paperId: string,
  threadId: string | null,
  messageId: string | null,
): Exchange {
  const query = useQuery({
    queryKey: ['threads', paperId, threadId],
    queryFn: () => threadsApi.get(paperId, threadId ?? ''),
    enabled: threadId !== null,
    staleTime: Infinity,
  });
  return useMemo(() => {
    const messages = query.data?.messages ?? [];
    const at = messages.findIndex((m) => m.message_id === messageId);
    const answer = messages[at] ?? null;
    const question =
      at < 0
        ? null
        : (messages
            .slice(0, at)
            .reverse()
            .find((m) => m.role === 'user') ?? null);
    return {
      answer,
      question,
      layout: answer === null ? null : layoutAnswer(answer),
      loading: query.isLoading && threadId !== null,
    };
  }, [query.data, query.isLoading, messageId, threadId]);
}
