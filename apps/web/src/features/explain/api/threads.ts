/**
 * Stored-thread reads for the explain panel (#202): the react-query keys and fetchers over
 * `lib/api/threads` (`GET /papers/{id}/threads`, `GET …/threads/{tid}`), so the thread menu, the
 * panel and the merge after an answer settles share one cache.
 */
import { threadsApi } from '@/lib/api/threads';

import type { Message, Thread } from '@/lib/api/types';

/** A stored thread with its messages, citations (with locators) and coverage. */
export interface ThreadDetail {
  readonly thread: Thread;
  readonly messages: readonly Message[];
}

/**
 * The key prefix of every thread read of one paper; invalidating it refreshes the list and details.
 *
 * @param paperId The paper.
 * @returns The query key prefix.
 */
export function threadsKey(paperId: string): readonly ['threads', string] {
  return ['threads', paperId];
}

/**
 * The thread list's query key.
 *
 * @param paperId The paper.
 * @returns The key.
 */
export function threadListKey(paperId: string): readonly ['threads', string, 'list'] {
  return ['threads', paperId, 'list'];
}

/**
 * One thread's query key.
 *
 * @param paperId The paper.
 * @param threadId The thread.
 * @returns The key.
 */
export function threadDetailKey(
  paperId: string,
  threadId: string,
): readonly ['threads', string, 'detail', string] {
  return ['threads', paperId, 'detail', threadId];
}

/**
 * The paper's threads, as the API orders them (newest first; `sortThreads` makes menu order).
 *
 * @param paperId The paper.
 * @returns The threads, each with its ask.
 */
export function fetchThreads(paperId: string): Promise<Thread[]> {
  return threadsApi.list(paperId);
}

/**
 * One thread with its messages.
 *
 * @param paperId The paper.
 * @param threadId The thread.
 * @returns The thread and its messages, oldest first.
 */
export function fetchThread(paperId: string, threadId: string): Promise<ThreadDetail> {
  return threadsApi.get(paperId, threadId);
}
