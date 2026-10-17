/**
 * useShelfFocus: keyboard focus survives the shelf re-laying itself out under it (#196, review B2).
 * The shelf swaps components at its thresholds (covers ↔ spines at 12/13, spines ↔ rows at
 * 40/41), so a Delete, an upload or a poll can unmount the very book that has focus. This hook
 * holds the roving tab stop above those components (keyed by paper id) and, after every commit,
 * puts focus back on the same paper's book (or Delete's neighbour) when the focused element was
 * removed and focus fell to the page. It never takes focus from somewhere the person moved it.
 */
'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { FocusEvent, RefObject } from 'react';

/** What `useShelfFocus` gives the shelf section. */
export interface ShelfFocus {
  /** The section that holds the band, the shelf and its hints. */
  readonly section: RefObject<HTMLElement>;
  /** The book that last had focus: the shelf's roving tab stop, whichever layout draws it. */
  readonly focusedId: string | null;
  readonly setFocusedId: (paperId: string) => void;
  /** Focus this paper's book once the next render has committed (Delete's neighbour). */
  readonly focusAfterCommit: (paperId: string) => void;
  /** The section's `onFocus` (React's bubbling focusin). */
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * The paper a focused element belongs to: a book, a cover's caption or the catalogue card.
 *
 * @param element - The focused element.
 * @returns Its paper's id, or null outside any book.
 */
function paperOf(element: Element): string | null {
  const owner = element.closest('[data-paper-id], [data-caption-paper-id], [data-card-paper-id]');
  if (owner === null) return null;
  return (
    owner.getAttribute('data-paper-id') ??
    owner.getAttribute('data-caption-paper-id') ??
    owner.getAttribute('data-card-paper-id')
  );
}

/**
 * The shelf's focus keeper.
 *
 * @returns The section ref, the lifted tab stop and the handlers.
 * @example
 * const focus = useShelfFocus();
 * <section ref={focus.section} onFocus={focus.onFocus}>…</section>
 */
export function useShelfFocus(): ShelfFocus {
  const section = useRef<HTMLElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const last = useRef<{ readonly element: Element; readonly paperId: string | null } | null>(null);
  const pending = useRef<string | null>(null);

  const onFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    last.current = { element: event.target, paperId: paperOf(event.target) };
  }, []);
  const focusAfterCommit = useCallback((paperId: string) => {
    pending.current = paperId;
    setFocusedId(paperId);
  }, []);

  // Every commit: a layout swap or a removal is only visible after the DOM has changed. Chromium
  // fires no blur when the focused node is removed, so "focus fell" is read from the DOM itself.
  useLayoutEffect(() => {
    const host = section.current;
    if (host === null) return;
    const active = document.activeElement;
    const fell = active === null || active === document.body;
    const lost = last.current !== null && !last.current.element.isConnected && fell;
    const want = pending.current ?? (lost ? (last.current?.paperId ?? null) : null);
    if (want === null && !lost) return;
    pending.current = null;
    const book =
      (want === null
        ? null
        : host.querySelector<HTMLElement>(`[data-paper-id="${CSS.escape(want)}"]`)) ??
      host.querySelector<HTMLElement>('[role="toolbar"][aria-label="Shelf"] [tabindex="0"]');
    book?.focus();
  });

  return { section, focusedId, setFocusedId, focusAfterCommit, onFocus };
}
