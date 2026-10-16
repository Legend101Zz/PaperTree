/**
 * The explain panel's stored threads (#202): loads the list and the current thread with
 * react-query, opens an empty panel on the newest thread (v0.1 never loaded them, GAP-A2), merges
 * the stored read into the controller's live state, and re-reads once an answer settles so its
 * locators and coverage replace the live copy. A read that fails is reported, never a blank panel.
 * The controller (`useExplainActions`) stays the one owner of what is on screen.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '@/lib/api/types';

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

/** Why the panel could not show its thread: the thread is gone, or the read failed. */
export type ThreadReadFailureKind = 'not_found' | 'failed';

/** What the thread menu and the panel need. */
export interface ThreadsState {
  /** The paper's threads in menu order (oldest first). */
  readonly threads: readonly Thread[];
  /** The current thread's 1-based place in `threads`; 0 while a new thread is not listed yet. */
  readonly position: number;
  readonly total: number;
  /** Show another stored thread. */
  readonly select: (threadId: string) => void;
  /**
   * A settled answer's stored read is on the way: a passage not placed yet is held, so its tab
   * appears once, in its final form (`buildExchanges`' `settling`).
   */
  readonly settling: boolean;
  /** The current thread (or the thread list) could not be read; null when all is well. */
  readonly failure: { readonly kind: ThreadReadFailureKind; readonly of: 'thread' | 'list' } | null;
  /** Read the failed thread or list again. */
  readonly retry: () => void;
}

/** After Stop the server writes the partial answer a moment later: read once more then. */
const STOPPED_REREAD_MS = 900;

// Retry a failed read twice, but never a 404: the thread is gone and saying so is the answer.
function retryRead(count: number, error: unknown): boolean {
  return !(error instanceof ApiError && error.status === 404) && count < 2;
}

function failureKind(error: unknown): ThreadReadFailureKind {
  return error instanceof ApiError && error.status === 404 ? 'not_found' : 'failed';
}

/**
 * Wire the panel to the paper's stored threads. Call it where the open panel is mounted; it reads
 * nothing while the panel is closed or the paper is a fixture.
 *
 * @param controller The explain controller.
 * @returns The sorted threads, the current position, `select`, the settling flag and any failure.
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
    retry: retryRead,
  });
  const threads = useMemo(() => sortThreads(list.data ?? []), [list.data]);

  const detail = useQuery({
    queryKey: threadDetailKey(paperId ?? '', threadId ?? ''),
    queryFn: () => fetchThread(paperId as string, threadId as string),
    enabled: active && threadId !== null,
    retry: retryRead,
  });

  const newest = opensOnNewest(
    {
      open: state.open,
      view: state.view,
      threadId,
      hasRequest: state.request !== null,
      messageCount: state.messages.length,
      fresh: state.fresh,
    },
    threads,
  );
  // `newest` keeps its identity across refetches (react-query shares unchanged data), and is null
  // again as soon as a thread is selected, so this selects once.
  useEffect(() => {
    if (newest !== null) selectThread(newest);
  }, [newest, selectThread]);

  const [settling, setSettling] = useState(false);
  const epoch = state.epoch;
  useEffect(() => setSettling(false), [epoch]);

  // Keyed by `dataUpdatedAt`, not the data: a re-read that returns the same rows must still end
  // the settling; `epoch` so that reselecting a thread whose read is cached merges it again.
  const data = detail.data;
  useEffect(() => {
    if (data !== undefined && threadId !== null && data.thread.thread_id === threadId) {
      hydrateThread(threadId, data.messages);
      setSettling(false);
    }
  }, [detail.dataUpdatedAt, data, threadId, epoch, hydrateThread]);

  const detailFailed = detail.isError && !detail.isFetching;
  useEffect(() => {
    if (!detailFailed) return;
    setSettling(false);
    // A thread that is gone should leave the menu too.
    if (failureKind(detail.error) === 'not_found' && paperId !== null) {
      void client.invalidateQueries({ queryKey: threadListKey(paperId) });
    }
  }, [detailFailed, detail.error, client, paperId]);

  // An answer just settled (done, stopped or failed): read the thread again, so the stored copy
  // with its locators and coverage replaces the live one, and the list learns of a new thread.
  const busy = state.messages.some((m) => m.status === 'streaming');
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy && paperId !== null) {
      if (threadId !== null) setSettling(true);
      void client.invalidateQueries({ queryKey: threadsKey(paperId) });
    }
    wasBusy.current = busy;
  }, [busy, client, paperId, threadId]);

  // After Stop the server writes the partial answer only once the cancel lands: read once more.
  const stoppedKey = state.messages.findLast((m) => m.stopped)?.key ?? null;
  const rereadFor = useRef<string | null>(null);
  useEffect(() => {
    if (stoppedKey === null || stoppedKey === rereadFor.current) return undefined;
    if (paperId === null || threadId === null) return undefined;
    rereadFor.current = stoppedKey;
    const timer = window.setTimeout(() => {
      void client.invalidateQueries({ queryKey: threadDetailKey(paperId, threadId) });
    }, STOPPED_REREAD_MS);
    return () => window.clearTimeout(timer);
  }, [stoppedKey, client, paperId, threadId]);

  const select = useCallback(
    (id: string) => {
      const thread = threads.find((t) => t.thread_id === id);
      if (thread !== undefined) selectThread(thread);
    },
    [threads, selectThread],
  );

  const failure = detailFailed
    ? { kind: failureKind(detail.error), of: 'thread' as const }
    : list.isError && !list.isFetching
      ? { kind: failureKind(list.error), of: 'list' as const }
      : null;
  const { refetch: refetchDetail } = detail;
  const { refetch: refetchList } = list;
  const retry = useCallback(() => {
    void refetchList();
    if (threadId !== null) void refetchDetail();
  }, [refetchDetail, refetchList, threadId]);

  const { position, total } = threadPosition(threads, threadId);
  return { threads, position, total, select, settling, failure, retry };
}
