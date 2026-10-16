/**
 * ShelfSection: the shelf with its band above and its hints below (#195). Owns taking a book
 * down and putting it back: the catalogue card stands in the band, pointing at the open spine,
 * and Esc (on the card or the shelf) returns focus to that spine.
 */
'use client';

import { useCallback, useId, useRef } from 'react';

import { useCardPlacement } from '../hooks/useCardPlacement';
import { CatalogueCard } from './CatalogueCard';
import { Shelf } from './Shelf';
import { ShelfHints } from './ShelfHints';

import type { LibraryBook } from '../hooks/useLibrary';
import type { Arrangement } from '../model/shelf';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

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
  const placement = useCardPlacement(shownId, band);
  // A second activation of the open spine puts the book back.
  const takeDown = useCallback(
    (paperId: string) => setOpenId((current) => (current === paperId ? null : paperId)),
    [setOpenId],
  );
  const putBack = useCallback(() => {
    if (shownId !== null) {
      document.querySelector<HTMLElement>(`[data-paper-id="${CSS.escape(shownId)}"]`)?.focus();
    }
    setOpenId(null);
  }, [shownId, setOpenId]);
  return (
    <section className="pt-shelfband" aria-label="Your shelf">
      <div className="pt-shelfband__band" ref={band}>
        {openBook === null ? null : (
          <CatalogueCard
            id={cardId}
            book={openBook}
            placement={placement}
            onRead={onRead}
            onRetry={onRetry}
            onDelete={onDelete}
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
      <ShelfHints query={search} matched={matches?.size ?? 0} total={books.length} />
    </section>
  );
}
