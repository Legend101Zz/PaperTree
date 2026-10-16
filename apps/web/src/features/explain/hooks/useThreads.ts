/**
 * The explain panel's stored threads (#202): loads the list and the current thread with
 * react-query, opens an empty panel on the newest thread (v0.1 never loaded them, GAP-A2), merges
 * the stored read into the controller's live state, and re-reads once an answer settles so its
 * locators and coverage replace the live copy. The controller (`useExplainActions`) stays the one
 * owner of what is on screen.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  fetchThread,
  fetchThreads,
  threadDetailKey,
  threadListKey,
  threadsKey,
} from '../api/threads';
import { opensOnNewest, sortThreads, threadPosition } from '../model/threads';

import type { ExplainController } from '@/components/explain/useExplainActions';
import type { Thread } from '@/lib/api/types';

/** What the thread menu needs. */
export interface ThreadsState {
  /** The paper's threads in menu order (oldest first). */
  readonly threads: readonly Thread[];
  /** The current thread's 1-based place in `threads`; 0 while a new thread is not listed yet. */
  readonly position: number;
  readonly total: number;
  /** Show another stored thread. */
  readonly select: (threadId: string) => void;
}

/**
 * Wire the panel to the paper's stored threads. Call it where the open panel is mounted; it reads
 * nothing while the panel is closed or the paper is a fixture.
 *
 * @param controller The explain controller.
 * @returns The sorted threads, the current position and `select`.
 */
export function useThreads(controller: ExplainController): ThreadsState {
  const { paperId, state, selectThread, hydrateThread } = controller;
  const client = useQueryClient();
  const active = paperId !== null && state.open;
  const threadId = state.threadId;

  const list = useQuery({
    queryKey: threadListKey(paperId ?? ''),
    queryFn: () => fetchThreads(paperId as string),
    enabled: active,
  });
  const threads = useMemo(() => sortThreads(list.data ?? []), [list.data]);

  const detail = useQuery({
    queryKey: threadDetailKey(paperId ?? '', threadId ?? ''),
    queryFn: () => fetchThread(paperId as string, threadId as string),
    enabled: active && threadId !== null,
  });

  const newest = opensOnNewest(
    {
      open: state.open,
      view: state.view,
      threadId,
      hasRequest: state.request !== null,
      messageCount: state.messages.length,
    },
    threads,
  );
  // `newest` keeps its identity across refetches (react-query shares unchanged data), and is null
  // again as soon as a thread is selected, so this selects once.
  useEffect(() => {
    if (newest !== null) selectThread(newest);
  }, [newest, selectThread]);

  // `epoch` is a dependency so that reselecting a thread whose read is cached merges it again.
  const epoch = state.epoch;
  useEffect(() => {
    const data = detail.data;
    if (data !== undefined && threadId !== null && data.thread.thread_id === threadId) {
      hydrateThread(threadId, data.messages);
    }
  }, [detail.data, threadId, epoch, hydrateThread]);

  // An answer just settled (done, stopped or failed): read the thread again, so the stored copy
  // with its locators and coverage replaces the live one, and the list learns of a new thread.
  const busy = state.messages.some((m) => m.status === 'streaming');
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy && paperId !== null) {
      void client.invalidateQueries({ queryKey: threadsKey(paperId) });
    }
    wasBusy.current = busy;
  }, [busy, client, paperId]);

  const select = useCallback(
    (id: string) => {
      const thread = threads.find((t) => t.thread_id === id);
      if (thread !== undefined) selectThread(thread);
    },
    [threads, selectThread],
  );

  const { position, total } = threadPosition(threads, threadId);
  return { threads, position, total, select };
}
