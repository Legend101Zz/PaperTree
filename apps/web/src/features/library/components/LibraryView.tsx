/**
 * LibraryView: the signed-in library (#195). The papers stand on the shelf; a click or Enter on a
 * spine opens its catalogue card in the band above, where Read, Retry and Delete live.
 *
 * The data layer is `useLibrary` (polling only while a row is unfinished, upload with progress and
 * a truthful Cancel, Retry, Delete), unchanged in behaviour from v0.1. Opening a paper goes to
 * `/paper/<id>/read` in every state: Source mode works for a failed paper too. Sample papers (the
 * golden fixtures) are listed only when `NEXT_PUBLIC_PAPERTREE_FIXTURES=on` (#137).
 */
'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useState } from 'react';

import { SessionBanner } from '@/components/auth/SessionBanner';
import { pointerActivate } from '@/components/library/primitives';
import { EmptyLibrary, OfflineState } from '@/components/library/SystemStates';
import { UploadDropzone } from '@/components/library/UploadDropzone';
import { describeError } from '@/components/ui/errors';
import { useAuthStore } from '@/store/authStore';

import { useLibrary, useOnline } from '../hooks/useLibrary';
import './library.css';
import { CatalogueCard } from './CatalogueCard';
import { Shelf } from './Shelf';

import type { ReactNode } from 'react';

/** The library page body: header, upload, and the shelf with its catalogue card. */
export function LibraryView(): ReactNode {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, logout } = useAuthStore();
  const online = useOnline();
  const { books, own, query, upload, afterCancel, retry, remove } = useLibrary(online);
  const [openId, setOpenId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const cardId = useId();
  const openBook = books.find((book) => book.id === openId) ?? null;

  const openPaper = useCallback(
    (paperId: string) => router.push(`/paper/${paperId}/read`),
    [router],
  );
  // A second activation of the open spine puts the book back.
  const takeDown = useCallback(
    (paperId: string) => setOpenId((current) => (current === paperId ? null : paperId)),
    [],
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

  return (
    <div className="pt-s3-page">
      <header className="pt-s3-topbar">
        <div
          className="pt-s3-container flex items-center justify-between gap-3"
          style={{ minHeight: 64 }}
        >
          <span className="pt-s3-brand">PaperTree</span>
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="pt-s3-muted pt-s3-small hidden truncate sm:inline"
              style={{ maxWidth: 240 }}
            >
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
        <h1 className="pt-s3-h1">My papers</h1>
        {online ? (
          <SessionBanner />
        ) : (
          <OfflineState availableSummary="Papers already open on this device still work. Uploading and questions need the network." />
        )}
        <div data-upload-dropzone="">
          <UploadDropzone onUpload={upload} onCancelled={afterCancel} compact={books.length > 0} />
        </div>

        {query.isLoading ? (
          <div role="status" aria-label="Loading your papers" className="pt-s3-skeleton" />
        ) : query.isError && own.length === 0 ? (
          <div role="alert" className="pt-s3-alert pt-s3-alert--error flex flex-col gap-3">
            <p>
              {describeError(query.error, 'Your papers could not be loaded.')} Your uploaded papers
              are safe.
            </p>
            <div>
              <button
                type="button"
                className="pt-s3-btn pt-s3-btn--small"
                {...pointerActivate<HTMLButtonElement>(() => {
                  void query.refetch();
                })}
              >
                Try again
              </button>
            </div>
          </div>
        ) : books.length === 0 ? (
          <EmptyLibrary onAddPaper={focusUpload} />
        ) : (
          <section className="pt-shelfband" aria-label="Your shelf">
            <div className="pt-shelfband__card">
              {openBook === null ? null : (
                // Keyed by paper: a half-armed Delete or a Retry error belongs to one book and must
                // never open on the next one taken down.
                <CatalogueCard
                  key={openBook.id}
                  id={cardId}
                  book={openBook}
                  onRead={openPaper}
                  onRetry={retry}
                  onDelete={remove}
                />
              )}
            </div>
            <Shelf
              papers={books}
              arrangement="topic"
              matches={null}
              openId={openId}
              cardId={cardId}
              onActivate={takeDown}
            />
          </section>
        )}
      </main>
    </div>
  );
}
