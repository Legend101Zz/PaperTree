/**
 * LibraryView: the signed-in library (#195, frame 01). The compact header (search, Add papers,
 * Aa, account), "Your library" with its stats and "N need a look", the view row with Arrange by,
 * then the shelf with its catalogue card in the band above and the hint row under the plank.
 * PDFs drop anywhere on the page.
 *
 * The data layer is `useLibrary` (polling only while a row is unfinished, Retry, Delete) and the
 * uploads are `useUploadQueue`, both unchanged in behaviour from v0.1. Read goes to
 * `/paper/<id>/read` in every state: Source mode works for a failed paper too. Sample papers (the
 * golden fixtures) are listed only when `NEXT_PUBLIC_PAPERTREE_FIXTURES=on` (#137).
 */
'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SessionBanner } from '@/components/auth/SessionBanner';
import { EmptyLibrary, OfflineState } from '@/components/library/SystemStates';
import { describeError } from '@/components/ui/errors';
import { useAuthStore } from '@/store/authStore';

import { useLibrary, useOnline } from '../hooks/useLibrary';
import { useUploadQueue } from '../hooks/useUploadQueue';
import {
  arrangeShelf,
  libraryStats,
  matchPapers,
  needsALook,
  type Arrangement,
} from '../model/shelf';
import './library.css';
import { DropAnywhere } from './AddPapers';
import { LibraryHeader } from './LibraryHeader';
import { LibraryTitle } from './LibraryTitle';
import { ShelfSection } from './ShelfSection';
import { UploadRow } from './UploadRow';

import type { ReactNode } from 'react';

/** "/" anywhere focuses the search, unless the person is already typing in a field. */
function useSlashToSearch(search: { readonly current: HTMLInputElement | null }): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      // Ctrl, Cmd or Alt with "/" belongs to the browser or the system, never to the search.
      const chord = event.ctrlKey || event.metaKey || event.altKey;
      if (event.key !== '/' || typing || chord) return;
      event.preventDefault();
      search.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [search]);
}

/** The library page. */
export function LibraryView(): ReactNode {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, logout } = useAuthStore();
  const online = useOnline();
  const { books, own, query, upload, afterCancel, retry, remove } = useLibrary(online);
  const queue = useUploadQueue({ onUpload: upload, onCancelled: afterCancel });
  const [search, setSearch] = useState('');
  const [arrangement, setArrangement] = useState<Arrangement>('topic');
  const [needALookOnly, setNeedALookOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashToSearch(searchRef);

  // No count until the server has answered: "0 papers" while loading or after a failed load would
  // be a fact the page does not have.
  const loaded = Array.isArray(query.data);
  const stats = useMemo(() => (loaded ? libraryStats(books) : null), [loaded, books]);
  const filtered = needALookOnly && stats !== null && stats.needALook > 0;
  const shelved = useMemo(() => (filtered ? books.filter(needsALook) : books), [books, filtered]);
  const matches = useMemo(() => matchPapers(shelved, search), [shelved, search]);

  // The filter ends when nothing needs a look any more, so a later upload cannot switch it back
  // on by itself; and a card whose book has left the shelf closes rather than waiting to return.
  useEffect(() => {
    if (needALookOnly && stats !== null && stats.needALook === 0) setNeedALookOnly(false);
  }, [needALookOnly, stats]);
  useEffect(() => {
    if (openId !== null && !shelved.some((book) => book.id === openId)) setOpenId(null);
  }, [openId, shelved]);

  const read = useCallback((paperId: string) => router.push(`/paper/${paperId}/read`), [router]);
  const takeFirstMatch = useCallback(() => {
    const first = arrangeShelf(shelved, arrangement)
      .flatMap((group) => group.papers)
      .find((book) => matches?.has(book.id) === true);
    if (first === undefined) return;
    // Already down: Enter goes to its Read, as taking it down would have.
    if (first.id === openId) document.querySelector<HTMLElement>('[data-card-read]')?.focus();
    else setOpenId(first.id);
  }, [shelved, arrangement, matches, openId]);
  const chooseFiles = useCallback(() => {
    document.querySelector<HTMLElement>('[data-add-papers] input[type="file"]')?.click();
  }, []);
  const signOut = useCallback(async () => {
    setSigningOut(true);
    await logout();
    // Another account must never see this one's cached list.
    queryClient.clear();
    router.replace('/login');
  }, [logout, queryClient, router]);

  return (
    <div className="pt-library pt-laid">
      <LibraryHeader
        search={{
          value: search,
          onChange: setSearch,
          matched: matches === null ? null : matches.size,
          total: shelved.length,
          onSubmit: takeFirstMatch,
        }}
        searchRef={searchRef}
        onFiles={queue.enqueue}
        email={user?.email ?? null}
        signingOut={signingOut}
        onSignOut={() => void signOut()}
      />
      <UploadRow queue={queue} />
      <DropAnywhere onFiles={queue.enqueue} />
      <main className="pt-library__main">
        {online ? (
          <SessionBanner />
        ) : (
          <OfflineState availableSummary="Papers already open on this device still work. Uploading and questions need the network." />
        )}
        <LibraryTitle
          stats={stats}
          needALookOnly={filtered}
          onNeedALook={setNeedALookOnly}
          arrangement={arrangement}
          onArrange={setArrangement}
        />
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
                onClick={() => void query.refetch()}
              >
                Try again
              </button>
            </div>
          </div>
        ) : books.length === 0 ? (
          <>
            <EmptyLibrary onAddPaper={chooseFiles} />
            <p className="pt-hints pt-hints--empty">Drop PDFs anywhere to add them</p>
          </>
        ) : (
          <ShelfSection
            books={shelved}
            arrangement={arrangement}
            search={search}
            matches={matches}
            openId={openId}
            setOpenId={setOpenId}
            onRead={read}
            onRetry={retry}
            onDelete={remove}
          />
        )}
      </main>
    </div>
  );
}
