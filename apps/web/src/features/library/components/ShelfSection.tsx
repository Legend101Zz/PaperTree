/**
 * ShelfSection: the shelf with its band above and its hints below (#195); spines, face-out covers
 * for a short library, a plank per row at scale (#196), or books lying flat on a phone (#199). Owns
 * taking a book down and putting it back: the catalogue card stands in the band, pointing at the
 * open book (on a phone it is a bottom sheet), and Esc (on the card or the shelf) returns focus.
 * It also decides where focus goes when the control that had it disappears: after Retry (to Read),
 * after Delete (to the next book, else the previous, else Add papers), after the key hints are
 * dismissed (to the shelf), and when the layout changes under it (`useShelfFocus`). Enter on a
 * book that can be opened takes it OUT instead (#200, `features/book`: the pull-out, then the
 * spread); a click keeps the card, whose "Open the book" goes to the spread, so the card stays the
 * mouse's way and Space the keyboard's. On a phone Enter, Space and a tap all open the sheet, and
 * its "Open the book" opens the spread (#199): a book lying flat has no row to be turned out of.
 */
'use client';

import { useCallback, useId, useMemo, useRef } from 'react';

import { useBookOnShelf } from '@/features/book';

import { useCardPlacement } from '../hooks/useCardPlacement';
import { useShelfFocus } from '../hooks/useShelfFocus';
import { libraryPlan } from '../model/phone';
import { arrangeShelf } from '../model/shelf';
import { CatalogueCard } from './CatalogueCard';
import { CoverShelf } from './CoverShelf';
import { FlatShelf } from './FlatShelf';
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
  /** Phone width (`usePhoneLayout`): the books lie flat and the card is a bottom sheet. */
  readonly phone?: boolean;
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
  phone = false,
}: ShelfSectionProps): ReactNode {
  const band = useRef<HTMLDivElement>(null);
  const focus = useShelfFocus();
  const plan = libraryPlan(books.length, phone);
  const faceOut = plan.shelf === 'face-out';
  const OnPlanks = plan.shelf === 'flat' ? FlatShelf : plan.shelf === 'rows' ? ShelfRows : Shelf;
  const sheet = plan.card === 'sheet';
  const book = useBookOnShelf(books, onRead);
  const { pull, open } = book;
  // The pull-out (02a) turns a standing spine out of its row, a desktop moment (DESIGN.md §1, §6);
  // a phone's book lies flat in a stack (08a, §10), so there Enter clicks it into the sheet.
  const lifted = useMemo(
    () => ({
      focusedId: focus.focusedId,
      onFocusBook: focus.setFocusedId,
      ...(sheet ? {} : { onEnterBook: pull }),
    }),
    [focus.focusedId, focus.setFocusedId, pull, sheet],
  );
  const cardId = useId();
  const openBook = books.find((book) => book.id === openId) ?? null;
  const shownId = openBook === null ? null : openBook.id;
  const order = useMemo(
    () => arrangeShelf(books, arrangement).flatMap((group) => group.papers.map((p) => p.id)),
    [books, arrangement],
  );
  // Any change that can move a spine: the arrangement, the order of the ids, the shelf coming
  // back into view (hidden, every spine measures zero), or the flat books giving way to spines
  // across 900 px (review SF1). The sheet is not placed, so it is not measured on every scroll.
  const placement = useCardPlacement(
    sheet ? null : shownId,
    band,
    `${String(shown)}|${plan.shelf}|${arrangement}|${order.join(',')}`,
  );
  // A second activation of the open spine puts the book back.
  const takeDown = useCallback(
    (paperId: string) => setOpenId((current) => (current === paperId ? null : paperId)),
    [setOpenId],
  );
  // A modal sheet keeps the stacks inert until it has gone, so its book takes focus after the commit.
  const { focusAfterCommit } = focus;
  const putBack = useCallback(() => {
    if (shownId !== null) (sheet ? focusAfterCommit : focusBook)(shownId);
    setOpenId(null);
  }, [shownId, setOpenId, sheet, focusAfterCommit]);
  // The sheet goes before the spread comes: one modal at a time, and the spread's put-back can
  // focus the book (the sheet would still hold the stacks inert).
  const openTheBook = useCallback(
    (paperId: string) => {
      if (sheet) setOpenId(null);
      open(paperId);
    },
    [sheet, setOpenId, open],
  );
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
  const remove = useCallback(
    async (paperId: string) => {
      const at = order.indexOf(paperId);
      const neighbour = order[at + 1] ?? order[at - 1];
      await onDelete(paperId);
      setOpenId(null);
      const toAdd = (): void =>
        document.querySelector<HTMLElement>('[data-add-papers] button')?.focus();
      if (neighbour !== undefined) focusAfterCommit(neighbour);
      // The header is inert until the sheet has gone.
      else if (sheet) window.requestAnimationFrame(toAdd);
      else toAdd();
    },
    [order, onDelete, setOpenId, focusAfterCommit, sheet],
  );
  const toShelf = useCallback(() => {
    document
      .querySelector<HTMLElement>('[role="toolbar"][aria-label="Shelf"] [tabindex="0"]')
      ?.focus();
  }, []);
  // The opened book renders beside the section, not in it: its portal's React events would
  // otherwise bubble into the section's focus keeper (`useShelfFocus`, review nit).
  return (
    <>
      <section
        ref={focus.section}
        className={[
          'pt-shelfband',
          faceOut ? 'pt-shelfband--faceout' : '',
          plan.shelf === 'flat' ? 'pt-shelfband--flat' : '',
          sheet && openBook !== null ? 'pt-shelfband--sheet' : '',
        ]
          .filter(Boolean)
          .join(' ')}
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
              placement={sheet ? null : placement}
              sheet={sheet}
              onRead={onRead}
              onRetry={retry}
              onDelete={remove}
              onClose={putBack}
              onOpenBook={openTheBook}
            />
          )}
        </div>
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
          vertical={plan.shelf === 'flat'}
        />
      </section>
      {book.overlay}
    </>
  );
}
