/**
 * ShelfSection: the shelf with its hints below (#195, #196, #199; v0.3 #336, #337): spines on
 * planks (a plank per row at scale) on a desktop, books lying flat on a phone. A click, Enter or
 * Space on ANY book takes it off its plank and opens it (`features/book`, one motion); there is
 * no card in between, so the book that opens is always the one that was clicked, on any plank.
 * A book that cannot be opened yet (queued, being read, failed) is read instead, as Read always
 * was. It also decides where focus goes when the control that had it disappears: after the key
 * hints are dismissed (to the shelf) and when the layout changes under it (`useShelfFocus`).
 */
'use client';

import { useCallback, useMemo } from 'react';

import { useShelfFocus } from '../hooks/useShelfFocus';
import { libraryShelf } from '../model/phone';
import { FlatShelf } from './FlatShelf';
import { Shelf } from './Shelf';
import { ShelfHints } from './ShelfHints';
import { ShelfRows } from './ShelfRows';
import { useSpineTag } from './SpineTag';

import type { LibraryBook } from '../hooks/useLibrary';
import type { Arrangement } from '../model/shelf';
import type { ReactNode } from 'react';

/** Props for `ShelfSection`. */
export interface ShelfSectionProps {
  /** The books on the shelf. */
  readonly books: readonly LibraryBook[];
  readonly arrangement: Arrangement;
  /** What the search typed, and which ids it matched (null: no search). */
  readonly search: string;
  readonly matches: ReadonlySet<string> | null;
  /** A book was clicked, Entered or Spaced: take it off the shelf and open it. */
  readonly onOpen: (paperId: string) => void;
  /** Phone width (`usePhoneLayout`): the books lie flat. */
  readonly phone?: boolean;
}

/** Focus the shelf's tab stop. */
function toShelf(): void {
  document
    .querySelector<HTMLElement>('[role="toolbar"][aria-label="Shelf"] [tabindex="0"]')
    ?.focus();
}

/**
 * The shelf section.
 *
 * @example
 * <ShelfSection books={books} arrangement="topic" search="" matches={null} onOpen={open} />
 */
export function ShelfSection({
  books,
  arrangement,
  search,
  matches,
  onOpen,
  phone = false,
}: ShelfSectionProps): ReactNode {
  const focus = useShelfFocus();
  const shelf = libraryShelf(books.length, phone);
  const OnPlanks = shelf === 'flat' ? FlatShelf : shelf === 'rows' ? ShelfRows : Shelf;
  const lifted = useMemo(
    () => ({ focusedId: focus.focusedId, onFocusBook: focus.setFocusedId }),
    [focus.focusedId, focus.setFocusedId],
  );
  const { tag, onMouseOver, onMouseOut, hide } = useSpineTag(books);
  const open = useCallback(
    (paperId: string) => {
      hide();
      onOpen(paperId);
    },
    [hide, onOpen],
  );
  return (
    <section
      ref={focus.section}
      aria-label="Your shelf"
      onFocus={focus.onFocus}
      onMouseOver={shelf === 'flat' ? undefined : onMouseOver}
      onMouseOut={shelf === 'flat' ? undefined : onMouseOut}
      onBlur={shelf === 'flat' ? undefined : hide}
    >
      <OnPlanks
        papers={books}
        arrangement={arrangement}
        matches={matches}
        onActivate={open}
        focus={lifted}
      />
      {tag}
      <ShelfHints
        query={search}
        matched={matches?.size ?? 0}
        total={books.length}
        onKeysHidden={toShelf}
        vertical={shelf === 'flat'}
      />
    </section>
  );
}
