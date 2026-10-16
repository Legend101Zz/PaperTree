/**
 * useRovingShelf: the shelf's one tab stop, shared by the spines (#195) and the face-out covers
 * (#196) so both keep the same keyboard model: ←/→ walk the books (no wrap), Home and End jump to
 * the ends, Esc puts an open book back. Keys pressed on a cover's caption controls (Continue,
 * Open) are theirs, not the shelf's.
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

/**
 * The roving tab stop and key handling for a shelf toolbar.
 *
 * @param order - Every book's id, in the order the keys walk them.
 * @param openId - The book whose catalogue card is open.
 * @param onPutBack - Esc while a card is open.
 * @returns The toolbar ref, the tab stop and the handlers.
 */
export function useRovingShelf(
  order: readonly string[],
  openId: string | null,
  onPutBack?: () => void,
): RovingShelf {
  const toolbar = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
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
      if (event.target instanceof Element && event.target.closest('[data-cover-caption]')) return;
      const next = shelfStep(stop === null ? 0 : order.indexOf(stop), event.key, order.length);
      const id = next === null ? undefined : order[next];
      if (id === undefined) return;
      event.preventDefault();
      setFocusedId(id);
      toolbar.current?.querySelector<HTMLElement>(`[data-paper-id="${CSS.escape(id)}"]`)?.focus();
    },
    [order, stop, openId, onPutBack],
  );
  return { toolbar, stop, onFocusBook: setFocusedId, onKeyDown };
}
