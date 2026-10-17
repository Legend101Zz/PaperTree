/**
 * useRovingShelf: the shelf's one tab stop, shared by the spines (#195) and the face-out covers
 * (#196), and by the phone's flat stacks (#199, ↑/↓ too), so all keep the same keyboard model: ←/→
 * walk the books (no wrap), Home and End jump to the ends, Esc puts an open book back, and Enter
 * takes a book OUT when the section can open it (#200; Space and a click still take it down into
 * the catalogue card). Keys pressed on a cover's caption controls (Continue, Open) or a row's
 * "+n more" bookend are theirs, not the shelf's.
 */
'use client';

import { useCallback, useRef, useState } from 'react';

import { shelfStep } from '../model/shelf';

import type { KeyboardEvent, RefObject } from 'react';

/** What `useRovingShelf` gives the toolbar. */
export interface RovingShelf {
  readonly toolbar: RefObject<HTMLDivElement>;
  /** The id with `tabIndex` 0, or null on an empty shelf. */
  readonly stop: string | null;
  /** Keeps the tab stop on the book that last had focus. */
  readonly onFocusBook: (paperId: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** The tab stop held by the shelf section, so it survives a change of layout (`useShelfFocus`). */
export interface LiftedFocus {
  readonly focusedId: string | null;
  readonly onFocusBook: (paperId: string) => void;
  /** Enter on a book: true when it was taken out (#200), false to let Enter click it as before. */
  readonly onEnterBook?: (paperId: string) => boolean;
}

/**
 * The roving tab stop and key handling for a shelf toolbar.
 *
 * @param order - Every book's id, in the order the keys walk them.
 * @param openId - The book whose catalogue card is open.
 * @param onPutBack - Esc while a card is open.
 * @param lifted - The section's tab stop; without it (a shelf on its own) the hook keeps its own.
 * @param step - The arrow-key step: along a shelf (`shelfStep`) or down the phone's stacks.
 * @returns The toolbar ref, the tab stop and the handlers.
 */
export function useRovingShelf(
  order: readonly string[],
  openId: string | null,
  onPutBack?: () => void,
  lifted?: LiftedFocus,
  step: typeof shelfStep = shelfStep,
): RovingShelf {
  const toolbar = useRef<HTMLDivElement>(null);
  const [ownId, setOwnId] = useState<string | null>(null);
  const focusedId = lifted === undefined ? ownId : lifted.focusedId;
  const setFocusedId = lifted === undefined ? setOwnId : lifted.onFocusBook;
  // The spine that last had focus, else the open one, else the first. A deleted paper's id falls
  // through to the next rule, so the shelf never loses its tab stop.
  const stop =
    [focusedId, openId].find((id): id is string => id !== null && order.includes(id)) ??
    order[0] ??
    null;

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && openId !== null && onPutBack !== undefined) {
        event.preventDefault();
        onPutBack();
        return;
      }
      const own = '[data-cover-caption], [data-row-more]';
      if (event.target instanceof Element && event.target.closest(own)) return;
      const book = event.target instanceof Element ? event.target.closest('[data-paper-id]') : null;
      const bookId = book?.getAttribute('data-paper-id');
      // Enter's own click is cancelled only when the book did come out (#200).
      if (event.key === 'Enter' && bookId && lifted?.onEnterBook?.(bookId) === true) {
        event.preventDefault();
        return;
      }
      const next = step(stop === null ? 0 : order.indexOf(stop), event.key, order.length);
      const id = next === null ? undefined : order[next];
      if (id === undefined) return;
      event.preventDefault();
      setFocusedId(id);
      toolbar.current?.querySelector<HTMLElement>(`[data-paper-id="${CSS.escape(id)}"]`)?.focus();
    },
    [order, stop, openId, onPutBack, setFocusedId, lifted, step],
  );
  return { toolbar, stop, onFocusBook: setFocusedId, onKeyDown };
}
