/**
 * ShelfSection: the shelf with its band above and its hints below (#195). Owns taking a book
 * down and putting it back: the catalogue card stands in the band, pointing at the open spine,
 * and Esc (on the card or the shelf) returns focus to that spine. It also decides where focus
 * goes when the control that had it disappears: after Retry (to Read), after Delete (to the next
 * spine, else the previous, else Add papers) and after the key hints are dismissed (to the shelf).
 */
'use client';

import { useCallback, useId, useMemo, useRef } from 'react';

import { useCardPlacement } from '../hooks/useCardPlacement';
import { arrangeShelf } from '../model/shelf';
import { CatalogueCard } from './CatalogueCard';
import { Shelf } from './Shelf';
import { ShelfHints } from './ShelfHints';

import type { LibraryBook } from '../hooks/useLibrary';
import type { Arrangement } from '../model/shelf';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

/** Focus a spine by its paper id. */
function focusSpine(paperId: string): void {
  document.querySelector<HTMLElement>(`[data-paper-id="${CSS.escape(paperId)}"]`)?.focus();
}

/** Props for `ShelfSection`. */
export interface ShelfSectionProps {
  /** The books on the shelf (all of them, or those that need a look). */
  readonly books: readonly LibraryBook[];
  readonly arrangement: Arrangement;
  /** What the search typed, and which ids it matched (null: no search). */
  readonly search: string;
  readonly matches: ReadonlySet<string> | null;
  /** The book whose card is open, owned by the page so the search can take one down. */
  readonly openId: string | null;
  readonly setOpenId: Dispatch<SetStateAction<string | null>>;
  readonly onRead: (paperId: string) => void;
  readonly onRetry: (paperId: string) => Promise<unknown>;
  readonly onDelete: (paperId: string) => Promise<unknown>;
}

/**
 * The shelf section.
 *
 * @example
 * <ShelfSection books={books} arrangement="topic" search="" matches={null} openId={id}
 *   setOpenId={setId} onRead={read} onRetry={retry} onDelete={remove} />
 */
export function ShelfSection({
  books,
  arrangement,
  search,
  matches,
  openId,
  setOpenId,
  onRead,
  onRetry,
  onDelete,
}: ShelfSectionProps): ReactNode {
  const band = useRef<HTMLDivElement>(null);
  const cardId = useId();
  const openBook = books.find((book) => book.id === openId) ?? null;
  const shownId = openBook === null ? null : openBook.id;
  const order = useMemo(
    () => arrangeShelf(books, arrangement).flatMap((group) => group.papers.map((p) => p.id)),
    [books, arrangement],
  );
  // Any change that can move a spine: the arrangement or the order of the ids.
  const placement = useCardPlacement(shownId, band, `${arrangement}|${order.join(',')}`);
  // A second activation of the open spine puts the book back.
  const takeDown = useCallback(
    (paperId: string) => setOpenId((current) => (current === paperId ? null : paperId)),
    [setOpenId],
  );
  const putBack = useCallback(() => {
    if (shownId !== null) focusSpine(shownId);
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
  const remove = useCallback(
    async (paperId: string) => {
      const at = order.indexOf(paperId);
      const neighbour = order[at + 1] ?? order[at - 1];
      await onDelete(paperId);
      setOpenId(null);
      if (neighbour !== undefined) focusSpine(neighbour);
      else document.querySelector<HTMLElement>('[data-add-papers] button')?.focus();
    },
    [order, onDelete, setOpenId],
  );
  const toShelf = useCallback(() => {
    document
      .querySelector<HTMLElement>('[role="toolbar"][aria-label="Shelf"] [tabindex="0"]')
      ?.focus();
  }, []);
  return (
    <section className="pt-shelfband" aria-label="Your shelf">
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
          />
        )}
      </div>
      <Shelf
        papers={books}
        arrangement={arrangement}
        matches={matches}
        openId={shownId}
        cardId={cardId}
        onActivate={takeDown}
        onPutBack={putBack}
      />
      <ShelfHints
        query={search}
        matched={matches?.size ?? 0}
        total={books.length}
        onKeysHidden={toShelf}
      />
    </section>
  );
}
