/**
 * ShelfSection: the shelf with its band above and its hints below (#195); spines, face-out covers
 * for a short library, or a plank per row at scale (#196). Owns taking a book down and putting
 * it back: the catalogue card stands in the band, pointing at the open book, and Esc (on the card
 * or the shelf) returns focus to it. It also decides where focus goes when the control that had
 * it disappears: after Retry (to Read), after Delete (to the next book, else the previous, else
 * Add papers), after the key hints are dismissed (to the shelf), and when the layout changes
 * under it (`useShelfFocus`). Enter on a book that can be opened takes it OUT instead (#200,
 * `features/book`: the pull-out, then the spread); a click keeps the card, whose "Open the book"
 * goes to the spread, so the card stays the mouse's way and Space the keyboard's.
 */
'use client';

import { useCallback, useId, useMemo, useRef } from 'react';

import { useBookOnShelf } from '@/features/book';

import { useCardPlacement } from '../hooks/useCardPlacement';
import { useShelfFocus } from '../hooks/useShelfFocus';
import { arrangeShelf } from '../model/shelf';
import { shelfLayout } from '../model/states';
import { CatalogueCard } from './CatalogueCard';
import { CoverShelf } from './CoverShelf';
import { Shelf } from './Shelf';
import { ShelfRows } from './ShelfRows';
import { ShelfHints } from './ShelfHints';

import type { LibraryBook } from '../hooks/useLibrary';
import type { Arrangement } from '../model/shelf';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

/** Focus a book by its paper id. */
function focusBook(paperId: string): void {
  document.querySelector<HTMLElement>(`[data-paper-id="${CSS.escape(paperId)}"]`)?.focus();
}

/** Props for `ShelfSection`. */
export interface ShelfSectionProps {
  /** The books on the shelf. */
  readonly books: readonly LibraryBook[];
  /** False while another view is showing (the shelf stays mounted, hidden, to keep its state). */
  readonly shown?: boolean;
  readonly arrangement: Arrangement;
  /** What the search typed, and which ids it matched (null: no search). */
  readonly search: string;
  readonly matches: ReadonlySet<string> | null;
  /** The book whose card is open, owned by the page so the search can take one down. */
  readonly openId: string | null;
  readonly setOpenId: Dispatch<SetStateAction<string | null>>;
  readonly onRead: (paperId: string) => void;
  /** Continue on a face-out cover's caption: the reader at your page. */
  readonly onContinue: (book: LibraryBook) => void;
  readonly onRetry: (paperId: string) => Promise<unknown>;
  readonly onDelete: (paperId: string) => Promise<unknown>;
}

/**
 * The shelf section.
 *
 * @example
 * <ShelfSection books={books} arrangement="topic" search="" matches={null} openId={id}
 *   setOpenId={setId} onRead={read} onContinue={resume} onRetry={retry} onDelete={remove} />
 */
export function ShelfSection({
  books,
  shown = true,
  arrangement,
  search,
  matches,
  openId,
  setOpenId,
  onRead,
  onContinue,
  onRetry,
  onDelete,
}: ShelfSectionProps): ReactNode {
  const band = useRef<HTMLDivElement>(null);
  const focus = useShelfFocus();
  const book = useBookOnShelf(books, onRead);
  const { pull } = book;
  const lifted = useMemo(
    () => ({ focusedId: focus.focusedId, onFocusBook: focus.setFocusedId, onEnterBook: pull }),
    [focus.focusedId, focus.setFocusedId, pull],
  );
  const layout = shelfLayout(books.length);
  const faceOut = layout === 'face-out';
  const OnPlanks = layout === 'rows' ? ShelfRows : Shelf;
  const cardId = useId();
  const openBook = books.find((book) => book.id === openId) ?? null;
  const shownId = openBook === null ? null : openBook.id;
  const order = useMemo(
    () => arrangeShelf(books, arrangement).flatMap((group) => group.papers.map((p) => p.id)),
    [books, arrangement],
  );
  // Any change that can move a spine: the arrangement, the order of the ids, or the shelf coming
  // back into view (hidden, every spine measures zero).
  const placement = useCardPlacement(
    shownId,
    band,
    `${String(shown)}|${arrangement}|${order.join(',')}`,
  );
  // A second activation of the open spine puts the book back.
  const takeDown = useCallback(
    (paperId: string) => setOpenId((current) => (current === paperId ? null : paperId)),
    [setOpenId],
  );
  const putBack = useCallback(() => {
    if (shownId !== null) focusBook(shownId);
    setOpenId(null);
  }, [shownId, setOpenId]);
  // The Retry button leaves with the failed state, so focus goes to Read, which stays.
  const retry = useCallback(
    async (paperId: string) => {
      await onRetry(paperId);
      document.getElementById(cardId)?.querySelector<HTMLElement>('[data-card-read]')?.focus();
    },
    [onRetry, cardId],
  );
  // The deleted book's card and spine leave; focus stays on the shelf, next to where it stood.
  // After the commit, not now: losing a book can re-lay the shelf out (13 → 12 is face-out), and
  // a neighbour focused in the old layout would be unmounted with it (review B2).
  const { focusAfterCommit } = focus;
  const remove = useCallback(
    async (paperId: string) => {
      const at = order.indexOf(paperId);
      const neighbour = order[at + 1] ?? order[at - 1];
      await onDelete(paperId);
      setOpenId(null);
      if (neighbour !== undefined) focusAfterCommit(neighbour);
      else document.querySelector<HTMLElement>('[data-add-papers] button')?.focus();
    },
    [order, onDelete, setOpenId, focusAfterCommit],
  );
  const toShelf = useCallback(() => {
    document
      .querySelector<HTMLElement>('[role="toolbar"][aria-label="Shelf"] [tabindex="0"]')
      ?.focus();
  }, []);
  return (
    <section
      ref={focus.section}
      className={`pt-shelfband${faceOut ? ' pt-shelfband--faceout' : ''}`}
      aria-label="Your shelf"
      onFocus={focus.onFocus}
    >
      <div className="pt-shelfband__band" ref={band}>
        {openBook === null ? null : (
          // Keyed by paper: a half-armed Delete or a Retry error belongs to one book and must
          // never open on the next one taken down.
          <CatalogueCard
            key={openBook.id}
            id={cardId}
            book={openBook}
            placement={placement}
            onRead={onRead}
            onRetry={retry}
            onDelete={remove}
            onClose={putBack}
            onOpenBook={book.open}
          />
        )}
      </div>
      {book.overlay}
      {/* Face-out below about 12 papers (DESIGN.md §9); the count is the shelf's, so a search,
          which dims in place, never re-lays it out. */}
      {faceOut ? (
        <CoverShelf
          papers={books}
          arrangement={arrangement}
          matches={matches}
          openId={shownId}
          cardId={cardId}
          onActivate={takeDown}
          onPutBack={putBack}
          focus={lifted}
          onOpen={onRead}
          onContinue={onContinue}
        />
      ) : (
        <OnPlanks
          papers={books}
          arrangement={arrangement}
          matches={matches}
          openId={shownId}
          cardId={cardId}
          onActivate={takeDown}
          onPutBack={putBack}
          focus={lifted}
        />
      )}
      <ShelfHints
        query={search}
        matched={matches?.size ?? 0}
        total={books.length}
        onKeysHidden={toShelf}
      />
    </section>
  );
}
