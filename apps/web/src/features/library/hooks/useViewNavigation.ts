/**
 * useViewNavigation: the library's moves between and within its views (#197, #198): "Show on the
 * shelf" (the Shelf tab, that spine focused once it is shown), Enter on a topic card (the shelf by
 * Topic at the topic's first book), and Enter in the search, which acts on the view that is
 * showing and never changes a hidden view's state unseen (the shelf stays mounted under the others).
 */
'use client';

import { useCallback, useLayoutEffect, useState } from 'react';

import { arrangeShelf, type Arrangement } from '../model/shelf';

import type { LibraryViewName } from '../components/LibraryTitle';
import type { LibraryBook } from './useLibrary';
import type { Dispatch, SetStateAction } from 'react';

/** What `useViewNavigation` needs from the page. */
export interface ViewNavigationInput {
  readonly view: LibraryViewName;
  readonly setView: (view: LibraryViewName) => void;
  readonly setArrangement: (arrangement: Arrangement) => void;
  readonly books: readonly LibraryBook[];
  readonly arrangement: Arrangement;
  readonly matches: ReadonlySet<string> | null;
  /** The shelf's open catalogue card. */
  readonly openId: string | null;
  readonly setOpenId: Dispatch<SetStateAction<string | null>>;
}

// Focus the first element any of `selectors` finds, in order; true when one was found.
function focusFirst(...selectors: readonly string[]): boolean {
  for (const selector of selectors) {
    const found = document.querySelector<HTMLElement>(selector);
    if (found !== null) {
      found.focus();
      return true;
    }
  }
  return false;
}

/**
 * The page's view moves.
 *
 * @param input - The page's view, arrangement, books, search matches and open card.
 * @returns `showOnShelf`, `showTopicOnShelf` and the search's `takeFirstMatch`.
 */
export function useViewNavigation({
  view,
  setView,
  setArrangement,
  books,
  arrangement,
  matches,
  openId,
  setOpenId,
}: ViewNavigationInput) {
  const [shelfFocus, setShelfFocus] = useState<string | null>(null);
  const showOnShelf = useCallback(
    (paperId: string) => {
      setView('shelf');
      setShelfFocus(paperId);
    },
    [setView],
  );
  useLayoutEffect(() => {
    if (shelfFocus === null || view !== 'shelf') return;
    focusFirst(`[aria-label="Your shelf"] [data-paper-id="${CSS.escape(shelfFocus)}"]`);
    setShelfFocus(null);
  }, [shelfFocus, view]);
  const showTopicOnShelf = useCallback(
    (paperId: string) => {
      setArrangement('topic');
      showOnShelf(paperId);
    },
    [setArrangement, showOnShelf],
  );
  const takeFirstMatch = useCallback(() => {
    // The Table's rows, and the Topics view's lit cards (else a lit Unshelved row), are the matches.
    if (view === 'table') {
      focusFirst('.pt-libtable [data-row-title]');
      return;
    }
    if (view === 'topics') {
      const row = '.pt-unshelved__row[data-match="true"]';
      focusFirst(
        '.pt-topiccard[data-match="true"] [data-topic-open]',
        `${row} button`,
        `${row} select`,
      );
      return;
    }
    // On the Map, its list is the keyboard's way in: open it at the first matching paper.
    if (view === 'map') {
      const list = document.querySelector<HTMLDetailsElement>('details.pt-map__list');
      const row = [...(list?.querySelectorAll<HTMLElement>('li[data-paper-id]') ?? [])].find(
        (li) => matches?.has(li.dataset['paperId'] ?? '') === true,
      );
      if (list === null || row === undefined) return;
      list.open = true;
      row.querySelector<HTMLElement>('a')?.focus();
      return;
    }
    const first = arrangeShelf(books, arrangement)
      .flatMap((group) => group.papers)
      .find((book) => matches?.has(book.id) === true);
    if (first === undefined) return;
    // Already down: Enter goes to its Read, as taking it down would have.
    if (first.id === openId) focusFirst('[data-card-read]');
    else setOpenId(first.id);
  }, [view, books, arrangement, matches, openId, setOpenId]);
  return { showOnShelf, showTopicOnShelf, takeFirstMatch };
}
