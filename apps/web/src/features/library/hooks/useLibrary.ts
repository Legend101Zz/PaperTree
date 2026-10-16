/**
 * useLibrary: the library's data layer, moved unchanged in behaviour out of v0.1's LibraryView
 * (#195): `GET /papers` with polling only while a row is unfinished, upload with progress and the
 * truthful Cancel, Retry and Delete. The shelf, the catalogue card and (later) the table all read
 * the same rows from here. UI → this hook → `papersApi` → services/api → SQLite.
 */
'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isNonTerminal, libraryPaperFromWire, visibleSamples } from '@/components/library/types';
import { papersApi } from '@/lib/api/papers';

import type { ShelfTopic } from '../model/shelf';
import type { CancelOutcome, UploadContext } from './useUploadQueue';
import type { LibraryPaper } from '@/components/library/types';
import type { LibraryPaper as ApiLibraryPaper } from '@/lib/api/types';

/** How often a library with unfinished papers asks again. */
export const POLL_INTERVAL_MS = 2000;

const PAPERS_KEY = ['papers'] as const;

/** How long a cancelled upload waits before the library is re-read. */
const CANCEL_SETTLE_MS = 700;

/** A library row as the shelf reads it: the v0.1 view model, S2a's facts (#192), S2b's topic. */
export type LibraryBook = LibraryPaper & {
  readonly year: number | null;
  readonly reading: ApiLibraryPaper['reading'];
  readonly arxivCategory: string | null;
  /** The accepted topic (#193), or null: the shelf's Topic rows and the cloth come from it. */
  readonly topic?: ShelfTopic | null;
};

/**
 * Bridge one `GET /papers` row to a `LibraryBook`. Tolerates a row from a server without S2a's
 * fields (they read as absent, never as invented values).
 *
 * @param row - The wire row.
 * @returns The book.
 */
export function libraryBookFromWire(row: ApiLibraryPaper): LibraryBook {
  return {
    ...libraryPaperFromWire(row),
    year: row.year ?? null,
    reading: row.reading ?? null,
    arxivCategory: row.arxiv_category ?? null,
    topic:
      row.topic === null || row.topic === undefined
        ? null
        : { id: row.topic.topic_id, name: row.topic.name, cloth: row.topic.cloth },
  };
}

/**
 * The refetch interval: on while any row is unfinished, `false` (off) otherwise.
 *
 * @param rows - The last `GET /papers` answer.
 * @returns Milliseconds, or false for no polling.
 */
export function pollInterval(rows: readonly ApiLibraryPaper[] | undefined): number | false {
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => isNonTerminal(row.processing)) ? POLL_INTERVAL_MS : false;
}

/**
 * Whether the browser says it is online, kept current.
 *
 * @returns True while online.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(window.navigator.onLine);
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}

/**
 * The library's rows and actions.
 *
 * @param online - From `useOnline`; offline is a designed state, not a retry storm.
 * @returns The books (samples first when fixtures are on), the query state and the actions.
 */
export function useLibrary(online: boolean) {
  const queryClient = useQueryClient();
  const knownIdsRef = useRef<ReadonlySet<string>>(new Set());
  const query = useQuery({
    queryKey: PAPERS_KEY,
    queryFn: (): Promise<readonly ApiLibraryPaper[]> => papersApi.list(),
    refetchInterval: (q) => pollInterval(q.state.data),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
    retry: online ? 1 : false,
  });
  const rows = query.data;

  const own = useMemo<readonly LibraryBook[]>(
    () => (Array.isArray(rows) ? rows : []).map((row) => libraryBookFromWire(row)),
    [rows],
  );
  const books = useMemo<readonly LibraryBook[]>(
    () => [
      ...visibleSamples().map((s) => ({
        ...s,
        year: null,
        reading: null,
        arxivCategory: null,
        topic: null,
      })),
      ...own,
    ],
    [own],
  );

  const upload = useCallback(
    async (file: File, context: UploadContext) => {
      // Remembered so a Cancel can tell a paper that arrived during the upload from one that was
      // already here.
      knownIdsRef.current = new Set(
        (queryClient.getQueryData<readonly ApiLibraryPaper[]>(PAPERS_KEY) ?? []).map(
          (row) => row.paper_id,
        ),
      );
      const response = await papersApi.uploadWithProgress(file, {
        signal: context.signal,
        onProgress: ({ loaded, total }) => {
          if (total !== null && total > 0) context.onProgress(loaded / total);
        },
      });
      // The 202's row goes in at once, so the new spine appears before the next poll.
      queryClient.setQueryData<readonly ApiLibraryPaper[]>(PAPERS_KEY, (old) => [
        response.paper,
        ...(old ?? []).filter((row) => row.paper_id !== response.paper.paper_id),
      ]);
      void queryClient.invalidateQueries({ queryKey: PAPERS_KEY });
    },
    [queryClient],
  );

  const afterCancel = useCallback(
    async (file: File): Promise<CancelOutcome> => {
      const before = knownIdsRef.current;
      // The abort can land after the server had the whole body; give it a beat to finish, then
      // read the library again instead of assuming.
      await new Promise((resolve) => setTimeout(resolve, CANCEL_SETTLE_MS));
      try {
        const fresh = await queryClient.fetchQuery({
          queryKey: PAPERS_KEY,
          queryFn: (): Promise<readonly ApiLibraryPaper[]> => papersApi.list(),
          staleTime: 0,
        });
        return fresh.some((row) => !before.has(row.paper_id) && row.original_filename === file.name)
          ? 'in-library'
          : 'not-added';
      } catch {
        return 'unknown';
      }
    },
    [queryClient],
  );

  const retry = useCallback(
    async (paperId: string) => {
      await papersApi.retry(paperId);
      await queryClient.invalidateQueries({ queryKey: PAPERS_KEY });
    },
    [queryClient],
  );

  const remove = useCallback(
    async (paperId: string) => {
      await papersApi.remove(paperId);
      queryClient.setQueryData<readonly ApiLibraryPaper[]>(PAPERS_KEY, (old) =>
        (old ?? []).filter((row) => row.paper_id !== paperId),
      );
    },
    [queryClient],
  );

  return { books, own, query, upload, afterCancel, retry, remove };
}
