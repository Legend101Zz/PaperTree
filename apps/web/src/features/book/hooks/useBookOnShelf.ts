/**
 * useBookOnShelf — the shelf's side of the opened book (#200, v0.3 #337). `open(id)` takes a book
 * off its plank and opens it: a click, Enter or Space on any spine, or Enter in the search. It
 * says false for a book that cannot be opened (a sample), which the caller reads instead; every
 * other state opens the spread (queued, being read and failed show their status there). While the
 * book is out its slot is a shadowed gap (`data-pulled` on the spine); when it is put back the gap
 * closes and focus returns to the spine. Delete (the spread's ⋯ menu, or Remove on a failed
 * paper) hands the book to the caller (`onDelete`) once the reverse has played: the slot is not
 * refocused, because the spine is leaving the shelf.
 */
'use client';

import { useRouter } from 'next/navigation';
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { clothFor, clothTakesLabel } from '@/features/library/model/shelf';

import { PulledBook } from '../components/PulledBook';
import { canOpenBook } from '../model/book';
import { bookReaderHref } from './useFromBook';

import type { Box } from '../model/motion';
import type { LibraryBook } from '@/features/library';

/**
 * The book's spine on the shelf.
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
 * An element's box in the form the motion reads.
 *
 * @param element - The spine, or null.
 * @returns Its box, or null when it is not drawn.
 */
function boxOf(element: HTMLElement | null): Box | null {
  if (element === null) return null;
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

/** What the shelf needs from the opened book. */
export interface BookOnShelf {
  /** The book out of the shelf, or null. */
  readonly openId: string | null;
  /** Takes a book off the shelf and opens it; false when it cannot be opened yet. */
  readonly open: (paperId: string) => boolean;
  /** The dialog to render, or null. */
  readonly overlay: ReactNode;
}

/** What the opened book hands back to the library page. */
export interface BookHandlers {
  /** Opens the reader on a paper (at its place once reading has started). */
  readonly onRead: (paperId: string) => void;
  /** The book was deleted from its spread: stage the delete (`usePendingDelete`). */
  readonly onDelete: (paperId: string) => void;
  /** Retry on a failed paper's spread; resolves when the request has been answered. */
  readonly onRetry: (paperId: string) => Promise<unknown>;
}

/**
 * The opened book's state for one shelf.
 *
 * @param books - The library's books.
 * @param handlers - Read, Delete and Retry, which belong to the library page.
 * @returns The open id, the way in, and the dialog.
 */
export function useBookOnShelf(
  books: readonly LibraryBook[],
  { onRead, onDelete, onRetry }: BookHandlers,
): BookOnShelf {
  const router = useRouter();
  const [out, setOut] = useState<{ readonly id: string; readonly from: Box | null } | null>(null);
  const refocus = useRef<string | null>(null);

  const open = useCallback(
    (paperId: string): boolean => {
      const book = books.find((b) => b.id === paperId);
      if (book === undefined || !canOpenBook(book)) return false;
      const spine = spineOf(paperId);
      spine?.setAttribute('data-pulled', 'true');
      setOut({ id: paperId, from: boxOf(spine) });
      return true;
    },
    [books],
  );
  const putBack = useCallback(() => {
    setOut((current) => {
      if (current !== null) {
        spineOf(current.id)?.removeAttribute('data-pulled');
        refocus.current = current.id;
      }
      return null;
    });
  }, []);
  // The gap belongs to the slot, not to one element: when the shelf swaps its layout under an open
  // book (flat books and spines at 900 px), the new spine for the same paper is the gap.
  useEffect(() => {
    if (out !== null) spineOf(out.id)?.setAttribute('data-pulled', 'true');
  });
  // After the dialog has gone (and the library is no longer inert): back on the spine.
  useEffect(() => {
    if (out !== null || refocus.current === null) return;
    spineOf(refocus.current)?.focus({ preventScroll: true });
    refocus.current = null;
  }, [out]);

  const book = out === null ? undefined : books.find((b) => b.id === out.id);
  // A book that left the library while it is out (deleted in another tab) goes back by itself. A
  // change of state does not: a queued paper that finishes being read just fills its spread.
  const gone = out !== null && (book === undefined || !canOpenBook(book));
  useEffect(() => {
    if (gone) putBack();
  }, [gone, putBack]);
  const deleteBook = useCallback(
    (paperId: string) => {
      spineOf(paperId)?.removeAttribute('data-pulled');
      setOut(null);
      onDelete(paperId);
    },
    [onDelete],
  );
  const cloth = book === undefined ? 'rl' : clothFor(book);
  const overlay =
    out === null || book === undefined || gone
      ? null
      : createElement(PulledBook, {
          // Keyed by paper: one book's half-played motion must never carry onto the next.
          key: out.id,
          book,
          cloth,
          labelled: clothTakesLabel(cloth),
          from: out.from,
          behind: document.querySelector<HTMLElement>('.pt-library'),
          // Where the spine is NOW: a topic chosen on the spread moves it to another group.
          where: () => boxOf(spineOf(out.id)),
          onPutBack: putBack,
          onDelete: () => deleteBook(out.id),
          onRetry: () => onRetry(out.id),
          onRead: () => onRead(out.id),
          onSummary: () => router.push(bookReaderHref(out.id, 'summary')),
        });
  return { openId: out?.id ?? null, open, overlay };
}
