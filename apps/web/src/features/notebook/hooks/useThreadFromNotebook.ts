'use client';

/**
 * useThreadFromNotebook — the reader's half of the notebook's "Back to the paper" (S5e, #210):
 * a dived page links back with `?thread=<id>`, and the reader opens its explain panel on that
 * thread, as the thread menu would, so the person returns to the exchange they dived from. It reads
 * through the panel's own thread-list cache; a thread that is gone leaves the panel closed.
 */
import { QueryClientContext } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useContext, useEffect, useRef } from 'react';

import { fetchThreads, threadListKey } from '@/features/explain/api/threads';

import { THREAD_PARAM } from '../model/links';

import type { Thread } from '@/lib/api/types';

/**
 * Opens the explain panel on the thread a notebook link names, once per link.
 *
 * @param paperId - The paper open in the reader (null for a sample paper).
 * @param selectThread - The explain controller's `selectThread`.
 */
export function useThreadFromNotebook(
  paperId: string | null,
  selectThread: (thread: Thread) => void,
): void {
  const params = useSearchParams();
  const threadId = params?.get(THREAD_PARAM) ?? null;
  // Optional: the reader mounts without a query client in some tests and fixtures.
  const client = useContext(QueryClientContext);
  const done = useRef<string | null>(null);
  const select = useRef(selectThread);
  select.current = selectThread;

  // No cancel on cleanup: with `done` guarding the link, a development remount would otherwise
  // cancel the only read. A selection after the reader has gone is dropped by React.
  useEffect(() => {
    if (paperId === null || threadId === null || done.current === threadId) return;
    done.current = threadId;
    const read =
      client === undefined
        ? fetchThreads(paperId)
        : client.fetchQuery({
            queryKey: threadListKey(paperId),
            queryFn: () => fetchThreads(paperId),
          });
    read.then(
      (threads) => {
        const thread = threads.find((t) => t.thread_id === threadId);
        if (thread !== undefined) select.current(thread);
      },
      () => undefined,
    );
  }, [paperId, threadId, client]);
}
