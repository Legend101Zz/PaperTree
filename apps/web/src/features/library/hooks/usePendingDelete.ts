/**
 * usePendingDelete: the opened book's Delete, which asks nothing and forgives for 10 seconds
 * (v0.3 #337, the owner-approved prototype). `stage(book)` takes the book off the shelf at once and
 * starts the clock; Undo within it puts the spine back exactly where it was (the shelf is drawn
 * from the list, so a book that returns to the list returns to its slot); when the clock runs out
 * the real `DELETE /papers/{id}` goes.
 *
 * WHY THE REQUEST WAITS. Nothing is deleted while Undo is on offer, so Undo restores EVERYTHING
 * (highlights, threads, the board) and cannot fail. The price is a paper that is shown as gone
 * while it is still on the server, so the wait must never be lost:
 *  - the page being hidden (a tab switch, a close, a reload) or this view unmounting (a click on
 *    Read in the toast's wake, a sign-out) sends the delete NOW with `keepalive`, which a closing
 *    page may finish. That gives up the rest of the 10 s, which is the honest simple option: the
 *    alternative, a deleted paper that comes back on the next load, would be a lie.
 *  - one Undo is on offer at a time, as the highlight toast has: staging a second book sends the
 *    first one's delete at once.
 *  - a delete the server refuses puts the book back with a sentence saying so.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { LibraryBook } from './useLibrary';

/** How long Undo is on offer. */
export const UNDO_MS = 10_000;

/** What `usePendingDelete` gives the library page. */
export interface PendingDelete {
  /** The books still on the shelf: everything but the ones staged or being deleted. */
  readonly visible: readonly LibraryBook[];
  /** The book whose Undo is on offer, or null. */
  readonly undoable: LibraryBook | null;
  /** A sentence for a delete the server refused, or null. */
  readonly failure: string | null;
  /** Takes a book off the shelf and starts the 10 s. */
  readonly stage: (book: LibraryBook) => void;
  /** Puts the staged book back in its place and focuses its spine. */
  readonly undo: () => void;
  /** Sends the staged delete now ("Dismiss"). */
  readonly dismiss: () => void;
  readonly clearFailure: () => void;
}

/**
 * The spine of a book on the shelf.
 *
 * @param paperId - The paper.
 * @returns Its button, or null when it is not drawn.
 */
function spineOf(paperId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[aria-label="Your shelf"] [data-paper-id="${CSS.escape(paperId)}"]`,
  );
}

/**
 * The deferred delete of one library.
 *
 * @param books - Every book the library has.
 * @param remove - `useLibrary().remove`: the real request and the cache update.
 * @returns The visible books and the staged delete's controls.
 */
export function usePendingDelete(
  books: readonly LibraryBook[],
  remove: (paperId: string, options?: { readonly keepalive?: boolean }) => Promise<unknown>,
): PendingDelete {
  // Hidden: staged (Undo on offer) and in flight (request sent, answer not back yet), so a book
  // never flashes back between the clock and the cache catching up.
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [undoable, setUndoable] = useState<LibraryBook | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const held = useRef<LibraryBook | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeRef = useRef(remove);
  removeRef.current = remove;
  // A spine to focus once it is back on the shelf (after Undo).
  const refocus = useRef<string | null>(null);

  const commit = useCallback((keepalive: boolean) => {
    const book = held.current;
    if (book === null) return;
    held.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setUndoable(null);
    const settle = (): void => setHidden((ids) => ids.filter((id) => id !== book.id));
    const sent = keepalive
      ? removeRef.current(book.id, { keepalive: true })
      : removeRef.current(book.id);
    sent.then(settle, () => {
      settle();
      setFailure(`Could not delete “${book.title}”. It is back on your shelf.`);
    });
  }, []);

  const stage = useCallback(
    (book: LibraryBook) => {
      commit(false); // one Undo at a time
      held.current = book;
      setHidden((ids) => [...ids, book.id]);
      setUndoable(book);
      setFailure(null);
      timer.current = setTimeout(() => commit(false), UNDO_MS);
    },
    [commit],
  );

  const undo = useCallback(() => {
    const book = held.current;
    if (book === null) return;
    held.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    refocus.current = book.id;
    setHidden((ids) => ids.filter((id) => id !== book.id));
    setUndoable(null);
  }, []);

  useEffect(() => {
    if (refocus.current === null || hidden.includes(refocus.current)) return;
    spineOf(refocus.current)?.focus({ preventScroll: true });
    refocus.current = null;
  });

  // The wait must not outlive the page: hidden, closed or left, the delete goes now.
  useEffect(() => {
    const flush = (): void => commit(true);
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [commit]);

  const visible = useMemo(
    () => (hidden.length === 0 ? books : books.filter((book) => !hidden.includes(book.id))),
    [books, hidden],
  );
  const dismiss = useCallback(() => commit(false), [commit]);
  const clearFailure = useCallback(() => setFailure(null), []);
  return { visible, undoable, failure, stage, undo, dismiss, clearFailure };
}
