'use client';

/**
 * The library — F2.8, on a route at last.
 *
 * WHAT THIS REPLACES. `components/library/` — `PaperGrid`, `PaperList`, `UploadDropzone` and the
 * six designed `SystemStates` — was written, audited by `a11y.spec` at zero WCAG 2.2 AA violations
 * and by `touch.spec` at 44×44 on every target, and rendered by NOTHING but those two test files.
 * This route mounted v1's `components/dashboard/PaperList` and `UploadModal` instead. So the epic's
 * "designed states: parsing, partial, uncertainty, failure, offline, empty" all existed and no user
 * could reach one of them. Issue #59; `components/dashboard/` is deleted in the same commit.
 *
 * THE UPLOAD DECISION, because it is the one thing here that could be dishonest.
 *
 * `papersApi.upload` posts to `apps/api`, which is the **v1** application: MongoDB, its own JWT, its
 * own extractor. It does not produce PaperIR, and `services/document-worker` — which does — has no
 * HTTP surface for the web app to call. A paper uploaded here therefore cannot open in the v2
 * reader, and the honest thing is to say so when it lands rather than when the user clicks it.
 *
 * `libraryPaperFromApi` already defaults `processing` to `'pending'` for exactly this reason. Its
 * own comment: "a row that has never been told about a job is a paper nobody has parsed yet, and
 * defaulting to `complete` would light up Guided mode over an IR that does not exist." So an
 * uploaded paper appears as PENDING, its Guided and audio affordances stay gated by
 * `derivedFeaturesReady`, and opening it lands on the reader's designed "not parsed yet" state.
 * That is the truth, rendered — instead of a card that looks ready and opens onto nothing.
 *
 * Hiding upload until Epic 1 exposes an ingest endpoint was the alternative, and it is worse:
 * §19.8 makes the upload states part of the deliverable, and a dropzone reporting "uploaded —
 * queued for reading" about a queue that does exist is not a lie about anything.
 *
 * SAMPLES ARE FIRST-CLASS. §19.8 requires the product to be evaluable before committing a PDF, and
 * `SAMPLE_PAPERS` is the repo's own three golden fixtures — the documents every anchoring test runs
 * against, so a sample cannot drift away from something we parse correctly.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { PaperGrid } from '@/components/library/PaperGrid';
import { PaperList } from '@/components/library/PaperList';
import { pointerActivate, TOUCH_TARGET } from '@/components/library/primitives';
import { EmptyLibrary, OfflineState } from '@/components/library/SystemStates';
import {
  libraryPaperFromApi,
  SAMPLE_PAPERS,
  type ApiPaperRow,
  type LibraryPaper,
} from '@/components/library/types';
import { UploadDropzone } from '@/components/library/UploadDropzone';
import { papersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

type LibraryLayout = 'grid' | 'list';

const LAYOUT_KEY = 'papertree/library/layout';

/**
 * Online/offline as state.
 *
 * `navigator.onLine` read at render time is a per-render measurement that never updates; the two
 * window events are the only signal that actually fires. Initialised optimistically so the server
 * render and the first client render agree — the same shape, and the same hydration reason, as
 * `useDevicePixelRatio` in `PdfPage`.
 */
function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
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

export default function LibraryPage() {
  return (
    <AuthGuard>
      <Library />
    </AuthGuard>
  );
}

function Library() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, logout } = useAuthStore();
  const online = useOnline();
  const [layout, setLayout] = useState<LibraryLayout>('grid');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(LAYOUT_KEY);
    if (saved === 'grid' || saved === 'list') setLayout(saved);
  }, []);

  const chooseLayout = useCallback((next: LibraryLayout) => {
    setLayout(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(LAYOUT_KEY, next);
  }, []);

  const {
    data: rows = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['papers'],
    queryFn: papersApi.list as () => Promise<ApiPaperRow[]>,
    // Offline is a designed state, not a retry storm.
    retry: online ? 1 : false,
  });

  const uploadMutation = useMutation({
    mutationFn: papersApi.upload,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['papers'] });
    },
  });

  /**
   * Samples first, then the user's own papers, newest first.
   *
   * `Array.isArray` because `papersApi.list` is a v1 endpoint with no schema, so a 200 carrying an
   * object rather than a list would otherwise crash the page on `.map`. That is not hypothetical:
   * it is exactly how the v1 dashboard failed when it met a response it did not expect.
   */
  const papers = useMemo<readonly LibraryPaper[]>(() => {
    const own = (Array.isArray(rows) ? rows : [])
      .map((row) => libraryPaperFromApi(row))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return [...SAMPLE_PAPERS, ...own];
  }, [rows]);

  const openPaper = useCallback(
    (paperId: string) => {
      router.push(`/paper/${paperId}/read`);
    },
    [router],
  );

  const openFirstSample = useCallback(() => {
    const first = SAMPLE_PAPERS[0];
    if (first !== undefined) openPaper(first.id);
  }, [openPaper]);

  const focusUpload = useCallback(() => {
    document.querySelector<HTMLElement>('[data-upload-dropzone] input[type="file"]')?.click();
  }, []);

  const upload = useCallback(
    async (file: File) => {
      await uploadMutation.mutateAsync(file);
    },
    [uploadMutation],
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">PaperTree</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-300">{user?.email}</span>
            <button
              type="button"
              className={`${TOUCH_TARGET} rounded px-3 text-sm text-gray-700 dark:text-gray-200`}
              {...pointerActivate<HTMLButtonElement>(logout)}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">My papers</h2>
          <div role="group" aria-label="Layout" className="flex gap-1">
            {(['grid', 'list'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={layout === option}
                className={`${TOUCH_TARGET} rounded px-3 text-sm capitalize ${
                  layout === option
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'text-gray-700 dark:text-gray-200'
                }`}
                {...pointerActivate<HTMLButtonElement>(() => chooseLayout(option))}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {!online ? (
          <div className="mb-6">
            {/* The samples live in `public/fixtures/`, so they really are what still opens with no
                network. Naming anything else here would be an offer we cannot keep. */}
            <OfflineState availableSummary="The three sample papers are on this device and still open. Your uploaded papers need the network." />
          </div>
        ) : null}

        <div className="mb-8" data-upload-dropzone="">
          <UploadDropzone onUpload={upload} />
        </div>

        {isLoading ? (
          <p role="status" className="py-12 text-center text-sm text-gray-600 dark:text-gray-300">
            Loading your papers…
          </p>
        ) : papers.length === 0 ? (
          <EmptyLibrary onAddPaper={focusUpload} onOpenSample={openPaper} />
        ) : layout === 'grid' ? (
          <PaperGrid papers={papers} onOpen={openPaper} />
        ) : (
          <PaperList papers={papers} onOpen={openPaper} />
        )}

        {isError && online ? (
          <p role="status" className="mt-6 text-sm text-gray-600 dark:text-gray-300">
            Your own papers could not be loaded.{' '}
            <button
              type="button"
              className="underline"
              {...pointerActivate<HTMLButtonElement>(openFirstSample)}
            >
              The sample papers still open.
            </button>
          </p>
        ) : null}
      </main>
    </div>
  );
}
