/**
 * LibraryView: the signed-in library (#195–#198; frames 01, 01b, 01c, 01d, 01f, 03). The compact
 * header (search, Add papers, Aa, account), "Your library" with its stats and "N need a look"
 * (which opens the Table filtered to those papers), the view row with Arrange by, Reading now with
 * Continue, then the shelf (face-out covers for a short library, a plank per row at scale) with
 * its catalogue card in the band above and the hint row under the plank, or Topics, or the Table; an empty
 * library shows the accession slip. PDFs drop anywhere on the page. The shelf stays mounted
 * (hidden) under the Table, so its focus, open card and scroll survive a switch of view.
 *
 * The data layer is `useLibrary` (polling only while a row is unfinished, Retry, Delete) and the
 * uploads are `useUploadQueue`, both unchanged in behaviour from v0.1. Read goes to
 * `/paper/<id>/read` in every state: Source mode works for a failed paper too. Sample papers (the
 * golden fixtures) are listed only when `NEXT_PUBLIC_PAPERTREE_FIXTURES=on` (#137).
 */
'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { SessionBanner } from '@/components/auth/SessionBanner';
import { OfflineState } from '@/components/library/SystemStates';
import { describeError } from '@/components/ui/errors';
import { useAuthStore } from '@/store/authStore';

import { useContinue } from '../hooks/useContinue';
import { useLibrary, useOnline } from '../hooks/useLibrary';
import { useTableView } from '../hooks/useTableView';
import { useTouchTargets } from '../hooks/useTouchTargets';
import { useUploadQueue } from '../hooks/useUploadQueue';
import { arrangeShelf, libraryStats, matchPapers, type Arrangement } from '../model/shelf';
import { readingNow, shelfLayout } from '../model/states';
import { readerHref } from '../model/table';
import './library.css';
import { AccessionSlip } from './AccessionSlip';
import { DropAnywhere } from './AddPapers';
import { LibraryHeader } from './LibraryHeader';
import { LibraryTitle, type LibraryViewName } from './LibraryTitle';
import { NewTopic } from './NewTopic';
import { ReadingNow } from './ReadingNow';
import { ShelfSection } from './ShelfSection';
import { ColumnsMenu } from './TableMenus';
import { TableView } from './TableView';
import { TopicsView } from './TopicsView';
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
  const [view, setView] = useState<LibraryViewName>('shelf');
  const table = useTableView();
  const touch = useTouchTargets();
  const [openId, setOpenId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashToSearch(searchRef);

  // No count until the server has answered: "0 papers" while loading or after a failed load would
  // be a fact the page does not have.
  const loaded = Array.isArray(query.data);
  const stats = useMemo(() => (loaded ? libraryStats(books) : null), [loaded, books]);
  const matches = useMemo(() => matchPapers(books, search), [books, search]);
  // A short library stands face-out and carries Continue under each cover (frame 01c draws no
  // strip), so the strip stands above a library of spines only.
  const faceOut = shelfLayout(books.length) === 'face-out';
  const reading = useMemo(() => (faceOut ? [] : readingNow(books)), [faceOut, books]);

  // "Need a look" ends when nothing needs one any more, so a later upload cannot switch it back
  // on by itself; and a card whose book has left the shelf closes rather than waiting to return.
  const { chip, setChip } = table;
  useEffect(() => {
    if (chip === 'look' && stats !== null && stats.needALook === 0) setChip('all');
  }, [chip, setChip, stats]);
  useEffect(() => {
    if (openId !== null && !books.some((book) => book.id === openId)) setOpenId(null);
  }, [openId, books]);
  // "Show on the shelf": the Shelf tab, with that book's spine focused once it is shown.
  const [shelfFocus, setShelfFocus] = useState<string | null>(null);
  const showOnShelf = useCallback((paperId: string) => {
    setView('shelf');
    setShelfFocus(paperId);
  }, []);
  useLayoutEffect(() => {
    if (shelfFocus === null || view !== 'shelf') return;
    document
      .querySelector<HTMLElement>(
        `[aria-label="Your shelf"] [data-paper-id="${CSS.escape(shelfFocus)}"]`,
      )
      ?.focus();
    setShelfFocus(null);
  }, [shelfFocus, view]);
  // Enter on a topic card: the shelf by topic, at that topic's first book (#198).
  const showTopicOnShelf = useCallback(
    (paperId: string) => {
      setArrangement('topic');
      showOnShelf(paperId);
    },
    [showOnShelf],
  );
  const needALook = useCallback(
    (on: boolean) => {
      setChip(on ? 'look' : 'all');
      if (on) setView('table');
    },
    [setChip],
  );

  const read = useCallback((paperId: string) => router.push(readerHref(paperId)), [router]);
  const resume = useContinue(read);
  const takeFirstMatch = useCallback(() => {
    // In the Table the rows are already the matches: Enter goes to the first one.
    if (view === 'table') {
      document.querySelector<HTMLElement>('.pt-libtable [data-row-title]')?.focus();
      return;
    }
    const first = arrangeShelf(books, arrangement)
      .flatMap((group) => group.papers)
      .find((book) => matches?.has(book.id) === true);
    if (first === undefined) return;
    // Already down: Enter goes to its Read, as taking it down would have.
    if (first.id === openId) document.querySelector<HTMLElement>('[data-card-read]')?.focus();
    else setOpenId(first.id);
  }, [view, books, arrangement, matches, openId]);
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
          total: books.length,
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
          atScale={shelfLayout(books.length) === 'rows'}
          needALookOnly={view === 'table' && chip === 'look'}
          onNeedALook={needALook}
          view={view}
          onView={setView}
          tools={
            view === 'table' ? (
              <ColumnsMenu
                hidden={table.hidden}
                onShown={table.setShown}
                size={touch ? 'touch' : 'md'}
              />
            ) : (
              <NewTopic />
            )
          }
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
          <AccessionSlip onChooseFiles={chooseFiles} />
        ) : (
          <>
            <div className="pt-library__shelf" hidden={view !== 'shelf'}>
              <ReadingNow papers={reading} onContinue={resume} />
              <ShelfSection
                shown={view === 'shelf'}
                books={books}
                arrangement={arrangement}
                search={search}
                matches={matches}
                openId={openId}
                setOpenId={setOpenId}
                onRead={read}
                onContinue={resume}
                onRetry={retry}
                onDelete={remove}
              />
            </div>
            {view === 'table' ? (
              <TableView
                books={books}
                matches={matches}
                table={table}
                touch={touch}
                onRetry={retry}
                onDelete={remove}
                onShowOnShelf={showOnShelf}
                onRead={read}
              />
            ) : null}
            {view === 'topics' ? (
              <TopicsView books={books} matches={matches} onShowOnShelf={showTopicOnShelf} />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
