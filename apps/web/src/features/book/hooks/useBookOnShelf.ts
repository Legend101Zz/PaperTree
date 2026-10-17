/**
 * useBookOnShelf — the shelf's side of the opened book (#200). `pull(id)` takes a book out of the
 * row (Enter on its spine or cover; it says false for a book that cannot be opened yet, which keeps
 * its catalogue card), `open(id)` goes straight to the spread (the card's "Open the book", the
 * mouse path). While the book is out its slot is a shadowed gap (`data-pulled` on the spine); when
 * it is put back the gap closes and focus returns to the spine.
 */
'use client';

import { useRouter } from 'next/navigation';
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { clothFor, clothTakesLabel } from '@/features/library/model/shelf';

import { PulledBook, type BookStage } from '../components/PulledBook';
import { canOpenBook } from '../model/book';
import { bookReaderHref } from './useFromBook';

import type { Box } from '../model/motion';
import type { LibraryBook } from '@/features/library';

/**
 * The book's spine (or face-out cover) on the shelf.
 *
 * @param paperId - The paper.
 * @returns Its button, or null when it is not drawn.
 */
function spineOf(paperId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[aria-label="Your shelf"] [data-paper-id="${CSS.escape(paperId)}"]`,
  );
}

/** What the shelf needs from the opened book. */
export interface BookOnShelf {
  /** The book out of the row, or null. */
  readonly pulledId: string | null;
  /** Takes a book out; false when it cannot be opened yet (queued, being read, failed, sample). */
  readonly pull: (paperId: string) => boolean;
  /** Opens the spread at once (from the catalogue card). */
  readonly open: (paperId: string) => void;
  /** The dialog to render, or null. */
  readonly overlay: ReactNode;
}

/**
 * The opened book's state for one shelf.
 *
 * @param books - The library's books.
 * @param onRead - Opens the reader on a paper.
 * @returns The pulled id, the two ways in, and the dialog.
 */
export function useBookOnShelf(
  books: readonly LibraryBook[],
  onRead: (paperId: string) => void,
): BookOnShelf {
  const router = useRouter();
  const [out, setOut] = useState<{
    readonly id: string;
    readonly stage: BookStage;
    readonly from: Box | null;
  } | null>(null);
  const refocus = useRef<string | null>(null);

  const takeOut = useCallback(
    (paperId: string, stage: BookStage): boolean => {
      const book = books.find((b) => b.id === paperId);
      if (book === undefined || !canOpenBook(book)) return false;
      const spine = spineOf(paperId);
      const box = spine?.getBoundingClientRect();
      spine?.setAttribute('data-pulled', 'true');
      setOut({
        id: paperId,
        stage,
        from:
          box === undefined
            ? null
            : { left: box.left, top: box.top, width: box.width, height: box.height },
      });
      return true;
    },
    [books],
  );
  const pull = useCallback((paperId: string) => takeOut(paperId, 'pulled'), [takeOut]);
  const open = useCallback((paperId: string) => void takeOut(paperId, 'open'), [takeOut]);
  const putBack = useCallback(() => {
    setOut((current) => {
      if (current !== null) {
        spineOf(current.id)?.removeAttribute('data-pulled');
        refocus.current = current.id;
      }
      return null;
    });
  }, []);
  // After the dialog has gone (and the library is no longer inert): back on the spine.
  useEffect(() => {
    if (out !== null || refocus.current === null) return;
    spineOf(refocus.current)?.focus({ preventScroll: true });
    refocus.current = null;
  }, [out]);

  const book = out === null ? undefined : books.find((b) => b.id === out.id);
  // A book deleted (or re-read into another state) while it is out goes back by itself.
  const gone = out !== null && (book === undefined || !canOpenBook(book));
  useEffect(() => {
    if (gone) putBack();
  }, [gone, putBack]);
  const cloth = book === undefined ? 'rl' : clothFor(book);
  const overlay =
    out === null || book === undefined || gone
      ? null
      : createElement(PulledBook, {
          book,
          stage: out.stage,
          cloth,
          labelled: clothTakesLabel(cloth),
          from: out.from,
          behind: document.querySelector<HTMLElement>('.pt-library'),
          onOpen: () => setOut({ ...out, stage: 'open' }),
          onPutBack: putBack,
          onRead: () => onRead(out.id),
          onSummary: () => router.push(bookReaderHref(out.id, 'summary')),
        });
  return { pulledId: out?.id ?? null, pull, open, overlay };
}
