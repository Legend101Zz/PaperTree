/**
 * LibraryView: the signed-in library (#195–#198; frames 01, 01b, 01c, 01d, 01f, 03). The compact
 * header (search, Add papers, Aa, account), "Your library" with its stats and "N need a look"
 * (which opens the Table filtered to those papers), the view row with Arrange by, Reading now with
 * Continue, then the shelf (face-out covers when short, a plank per row at scale) with its card in
 * the band above and the hint row under the plank, or Topics, or the Table; an empty library shows
 * the accession slip. PDFs drop anywhere. The shelf stays mounted (hidden) under the other views,
 * so its focus, open card and scroll survive a switch; `useViewNavigation` moves between them.
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
import { OfflineState } from '@/components/library/SystemStates';
import { describeError } from '@/components/ui/errors';
import { useAuthStore } from '@/store/authStore';

import { useContinue } from '../hooks/useContinue';
import { useLibrary, useOnline } from '../hooks/useLibrary';
import { useTableView } from '../hooks/useTableView';
import { useTopics } from '../hooks/useTopics';
import { useTouchTargets } from '../hooks/useTouchTargets';
import { useUploadQueue } from '../hooks/useUploadQueue';
import { useViewNavigation } from '../hooks/useViewNavigation';
import { libraryStats, matchPapers, type Arrangement } from '../model/shelf';
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

  // No count until the server has answered ("0 papers" would be a fact the page does not have);
  // "N topics" counts every topic the person has, an empty one too (#198), once they are read.
  const loaded = Array.isArray(query.data);
  const topicCount = useTopics().query.data?.length;
  const stats = useMemo(() => {
    const counted = loaded ? libraryStats(books) : null;
    return counted === null || topicCount === undefined
      ? counted
      : { ...counted, topics: topicCount };
  }, [loaded, books, topicCount]);
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
  const navigation = {
    view,
    setView,
    setArrangement,
    books,
    arrangement,
    matches,
    openId,
    setOpenId,
  };
  const { showOnShelf, showTopicOnShelf, takeFirstMatch } = useViewNavigation(navigation);
  const needALook = useCallback(
    (on: boolean) => {
      setChip(on ? 'look' : 'all');
      if (on) setView('table');
    },
    [setChip],
  );

  const read = useCallback((paperId: string) => router.push(readerHref(paperId)), [router]);
  const resume = useContinue(read);
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
