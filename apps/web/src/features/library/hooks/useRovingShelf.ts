/**
 * useRovingShelf: the shelf's one tab stop, shared by the spines (#195, #196) and the phone's flat
 * stacks (#199, ↑/↓ too), so both keep the same keyboard model: ←/→ walk the books (no wrap), Home
 * and End jump to the ends. Enter and Space are the focused button's own click, which takes the
 * book off the shelf and opens it (v0.3 #337); Esc belongs to the open book, not to the shelf.
 * Keys pressed on a row's "+n more" bookend are its own, not the shelf's.
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
}

/**
 * The roving tab stop and key handling for a shelf toolbar.
 *
 * @param order - Every book's id, in the order the keys walk them.
 * @param lifted - The section's tab stop; without it (a shelf on its own) the hook keeps its own.
 * @param step - The arrow-key step: along a shelf (`shelfStep`) or down the phone's stacks.
 * @returns The toolbar ref, the tab stop and the handlers.
 */
export function useRovingShelf(
  order: readonly string[],
  lifted?: LiftedFocus,
  step: typeof shelfStep = shelfStep,
): RovingShelf {
  const toolbar = useRef<HTMLDivElement>(null);
  const [ownId, setOwnId] = useState<string | null>(null);
  const focusedId = lifted === undefined ? ownId : lifted.focusedId;
  const setFocusedId = lifted === undefined ? setOwnId : lifted.onFocusBook;
  // The spine that last had focus, else the first. A deleted paper's id falls through to the
  // next rule, so the shelf never loses its tab stop.
  const stop = focusedId !== null && order.includes(focusedId) ? focusedId : (order[0] ?? null);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target instanceof Element && event.target.closest('[data-row-more]')) return;
      const next = step(stop === null ? 0 : order.indexOf(stop), event.key, order.length);
      const id = next === null ? undefined : order[next];
      if (id === undefined) return;
      event.preventDefault();
      setFocusedId(id);
      toolbar.current?.querySelector<HTMLElement>(`[data-paper-id="${CSS.escape(id)}"]`)?.focus();
    },
    [order, stop, setFocusedId, step],
  );
  return { toolbar, stop, onFocusBook: setFocusedId, onKeyDown };
}
