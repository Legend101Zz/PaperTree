'use client';

/**
 * library/LibraryView — the signed-in library: upload, the papers, and what is happening to them.
 *
 * WHAT IT DOES, in the order a reader meets it:
 *
 *   - lists `GET /papers` (`LibraryPaper[]`, contracts §2.2) as cards or rows, titled by the server
 *     (never a `ppr_` id), with the real page count, the processing state in words and, while a
 *     paper is being read, "step n of 3";
 *   - POLLS `GET /papers` every 2 s ONLY while some row is `queued` or `reading`. When every row is
 *     terminal the interval is `false` and the page makes no requests at all (no focus, reconnect or
 *     interval refetch), so a settled library costs the server nothing;
 *   - uploads through `papersApi.uploadWithProgress` (XHR progress, Cancel), and puts the 202's
 *     `paper` into the list at once so the new card appears before the next poll;
 *   - Retry (`POST /papers/{id}/retry`) and Delete (`DELETE /papers/{id}`, confirmed inline);
 *   - opening ANY card goes to `/paper/<id>/read`: the reader owns the "still reading" state, and
 *     Source mode works for a failed paper too.
 *
 * Sample papers (the golden fixtures) are listed only when `NEXT_PUBLIC_PAPERTREE_FIXTURES=on`
 * (#137). There is no audio anywhere: Epic 4 is out of this release.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, List } from 'lucide-react';

import { SessionBanner } from '@/components/auth/SessionBanner';
import { describeError } from '@/components/ui/errors';
import { papersApi } from '@/lib/api/papers';
import type { LibraryPaper as ApiLibraryPaper } from '@/lib/api/types';
import { useAuthStore } from '@/store/authStore';
import { PaperGrid } from './PaperGrid';
import { PaperList } from './PaperList';
import { pointerActivate } from './primitives';
import { EmptyLibrary, OfflineState } from './SystemStates';
import {
  isNonTerminal,
  libraryPaperFromWire,
  visibleSamples,
  type LibraryPaper,
} from './types';
import { UploadDropzone, type CancelOutcome, type UploadContext } from './UploadDropzone';

type LibraryLayout = 'grid' | 'list';

const LAYOUT_KEY = 'papertree/library/layout';

/** How often a library with unfinished papers asks again. */
export const POLL_INTERVAL_MS = 2000;

const PAPERS_KEY = ['papers'] as const;

/** How long a cancelled upload waits before the library is re-read. */
const CANCEL_SETTLE_MS = 700;

function useOnline(): boolean {
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

function readLayout(): LibraryLayout | null {
  try {
    const saved = window.localStorage.getItem(LAYOUT_KEY);
    return saved === 'grid' || saved === 'list' ? saved : null;
  } catch {
    return null;
  }
}

/** The refetch interval: on while any row is unfinished, `false` (off) otherwise. */
export function pollInterval(rows: readonly ApiLibraryPaper[] | undefined): number | false {
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => isNonTerminal(row.processing)) ? POLL_INTERVAL_MS : false;
}

export function LibraryView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, logout } = useAuthStore();
  const online = useOnline();
  const [layout, setLayout] = useState<LibraryLayout>('grid');
  const [signingOut, setSigningOut] = useState(false);
  const knownIdsRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const saved = readLayout();
    if (saved !== null) setLayout(saved);
  }, []);

  const chooseLayout = useCallback((next: LibraryLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // A private window: the choice just does not persist.
    }
  }, []);

  const {
    data: rows,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: PAPERS_KEY,
    queryFn: (): Promise<readonly ApiLibraryPaper[]> => papersApi.list(),
    refetchInterval: (query) => pollInterval(query.state.data),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 0,
    // Offline is a designed state, not a retry storm.
    retry: online ? 1 : false,
  });

  const own = useMemo<readonly LibraryPaper[]>(
    () =>
      (Array.isArray(rows) ? rows : [])
        .map((row) => libraryPaperFromWire(row))
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
    [rows],
  );
  const samples = useMemo(() => visibleSamples(), []);
  const papers = useMemo<readonly LibraryPaper[]>(() => [...samples, ...own], [samples, own]);

  const upsert = useCallback(
    (paper: ApiLibraryPaper) => {
      queryClient.setQueryData<readonly ApiLibraryPaper[]>(PAPERS_KEY, (old) => {
        const rest = (old ?? []).filter((row) => row.paper_id !== paper.paper_id);
        return [paper, ...rest];
      });
    },
    [queryClient],
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
      upsert(response.paper);
      // One refetch so the list is the server's, then `pollInterval` takes over.
      void queryClient.invalidateQueries({ queryKey: PAPERS_KEY });
    },
    [queryClient, upsert],
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
        return fresh.some(
          (row) => !before.has(row.paper_id) && row.original_filename === file.name,
        )
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

  const openPaper = useCallback(
    (paperId: string) => {
      router.push(`/paper/${paperId}/read`);
    },
    [router],
  );

  const focusUpload = useCallback(() => {
    document.querySelector<HTMLElement>('[data-upload-dropzone] input[type="file"]')?.click();
  }, []);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    await logout();
    // Another account must never see this one's cached list.
    queryClient.clear();
    router.replace('/login');
  }, [logout, queryClient, router]);

  const hasPapers = papers.length > 0;

  return (
    <div className="pt-s3-page">
      <header className="pt-s3-topbar">
        <div
          className="pt-s3-container flex items-center justify-between gap-3"
          style={{ minHeight: 64 }}
        >
          <span className="pt-s3-brand">PaperTree</span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="pt-s3-muted pt-s3-small hidden truncate sm:inline" style={{ maxWidth: 240 }}>
              {user?.email}
            </span>
            <button
              type="button"
              className="pt-s3-btn pt-s3-btn--quiet pt-s3-btn--small"
              disabled={signingOut}
              {...pointerActivate<HTMLButtonElement>(() => {
                void signOut();
              })}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="pt-s3-container flex flex-col gap-6" style={{ paddingBlock: 32 }}>
        <div className="flex items-center justify-between gap-4">
          <h1 className="pt-s3-h1">My papers</h1>
          {hasPapers ? (
            <div role="group" aria-label="Layout" className="flex gap-1">
              {(['grid', 'list'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={layout === option}
                  aria-label={option === 'grid' ? 'Cards' : 'List'}
                  className={`pt-s3-btn pt-s3-btn--small ${layout === option ? 'pt-s3-btn--primary' : 'pt-s3-btn--quiet'}`}
                  {...pointerActivate<HTMLButtonElement>(() => chooseLayout(option))}
                >
                  {option === 'grid' ? (
                    <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <List className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {!online ? (
          <OfflineState availableSummary="Papers already open on this device still work. Uploading and questions need the network." />
        ) : null}

        {online ? <SessionBanner /> : null}

        <div data-upload-dropzone="">
          <UploadDropzone onUpload={upload} onCancelled={afterCancel} compact={hasPapers} />
        </div>

        {isLoading ? (
          <div
            role="status"
            aria-label="Loading your papers"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {[0, 1, 2].map((key) => (
              <div key={key} className="pt-s3-skeleton" />
            ))}
          </div>
        ) : isError && own.length === 0 ? (
          <div role="alert" className="pt-s3-alert pt-s3-alert--error flex flex-col gap-3">
            <p>
              {describeError(error, 'Your papers could not be loaded.')} Your uploaded papers are
              safe.
            </p>
            <div>
              <button
                type="button"
                className="pt-s3-btn pt-s3-btn--small"
                {...pointerActivate<HTMLButtonElement>(() => {
                  void refetch();
                })}
              >
                Try again
              </button>
            </div>
          </div>
        ) : !hasPapers ? (
          <EmptyLibrary onAddPaper={focusUpload} />
        ) : layout === 'grid' ? (
          <PaperGrid papers={papers} onOpen={openPaper} onRetry={retry} onDelete={remove} />
        ) : (
          <PaperList papers={papers} onOpen={openPaper} onRetry={retry} onDelete={remove} />
        )}
      </main>
    </div>
  );
}
