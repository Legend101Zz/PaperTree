/**
 * PulledBook: the opened book's modal, over the veiled shelf (#200, frames 02a and 02, DESIGN.md §1
 * and §6). Stage `pulled`: the book lifted out of the row and turned face-out, its cover a button
 * (Enter or a click opens it), and under it the slip "Enter open · Esc put it back". Stage `open`:
 * the two-page spread. Esc (or "Put it back") puts the book back from either stage; the shelf then
 * focuses its spine again. Focus is trapped in the dialog and the library behind it is inert.
 * Motion is CSS 3D driven by WAAPI (`model/motion.ts`); reduced motion swaps with a short fade.
 */
'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cardStateLine } from '@/features/library/model/catalogue';

import { useFocusTrap } from '../hooks/useFocusTrap';
import { cancelAll, play, useReducedMotion } from '../hooks/useBookMotion';
import { openBook, pullOut, putBack as putBackMotion, TO_READER, type Box } from '../model/motion';
import './book.css';
import { BookCover } from './BookCover';
import { BookSpread } from './BookSpread';

import type { LibraryBook } from '@/features/library';

/** Where the book is: out of the row, or open. */
export type BookStage = 'pulled' | 'open';

/** Props for `PulledBook`. */
export interface PulledBookProps {
  readonly book: LibraryBook;
  readonly stage: BookStage;
  readonly cloth: string;
  /** Ink on a paper label instead of gilt (the Language cloth). */
  readonly labelled: boolean;
  /** The spine's box on the shelf when it was taken out (the pull-out starts there), or null. */
  readonly from: Box | null;
  /** The library behind the veil: inert while the book is out. */
  readonly behind: HTMLElement | null;
  readonly onOpen: () => void;
  /** After the put-back motion: the shelf unmounts this and focuses the spine. */
  readonly onPutBack: () => void;
  readonly onRead: () => void;
  readonly onSummary: () => void;
}

/**
 * The pulled-out (and opened) book.
 *
 * @example
 * <PulledBook book={book} stage="pulled" cloth="transformers" labelled={false} from={box}
 *   behind={library} onOpen={open} onPutBack={back} onRead={read} onSummary={summary} />
 */
export function PulledBook({
  book,
  stage,
  cloth,
  labelled,
  from,
  behind,
  onOpen,
  onPutBack,
  onRead,
  onSummary,
}: PulledBookProps): ReactNode {
  const titleId = useId();
  const hintId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLButtonElement>(null);
  const spread = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  // Where the book is going, kept in a ref because every animation-end handler must read the
  // CURRENT moment, not the one it closed over (#200 review B1): an opening swing that Esc
  // cancelled must not open the book it was putting back.
  const moving = useRef<'idle' | 'opening' | 'leaving'>('idle');
  const running = useRef(new Set<Animation>());
  useFocusTrap(dialog, behind);
  // Read once per stage: a later re-measure or a change of preference must not replay a motion.
  const start = useRef({ from, reduced });
  start.current = { from, reduced };

  // The pull-out plays once, from the spine; the spread arrives when the stage turns to open.
  useLayoutEffect(() => {
    const node = stage === 'pulled' ? cover.current : spread.current;
    if (node === null) return;
    const { from: spine, reduced: less } = start.current;
    if (moving.current === 'opening') moving.current = 'idle';
    if (stage === 'pulled') {
      void play(node, pullOut(spine, node.getBoundingClientRect(), less), running.current);
      node.focus({ preventScroll: true });
    } else {
      void play(node, openBook(less).spread, running.current);
      node.querySelector<HTMLElement>('[data-book-read]')?.focus({ preventScroll: true });
    }
  }, [stage]);
  // Unmounted (put back, read, or the book left the library): nothing may act any more.
  useEffect(() => {
    const animations = running.current;
    moving.current = 'idle'; // a remount (StrictMode's double effect) starts afresh
    return () => {
      moving.current = 'leaving';
      cancelAll(animations);
    };
  }, []);

  const leave = useCallback(
    (then: () => void, motion = putBackMotion(reduced)) => {
      if (moving.current === 'leaving') return;
      moving.current = 'leaving';
      cancelAll(running.current);
      const node = stage === 'pulled' ? cover.current : spread.current;
      void play(node, motion, running.current).then(then);
    },
    [reduced, stage],
  );
  const back = useCallback(() => leave(onPutBack), [leave, onPutBack]);
  const read = useCallback(() => leave(onRead, TO_READER), [leave, onRead]);
  const open = useCallback(() => {
    if (moving.current !== 'idle') return; // a second Enter, or Esc already on its way
    moving.current = 'opening';
    void play(cover.current, openBook(reduced).cover, running.current).then(() => {
      if (moving.current === 'opening') onOpen();
    });
  }, [onOpen, reduced]);

  // On the document, not the dialog: the dialog is modal, so every Esc is its own, even when the
  // control that had focus has just been replaced (the plate's choice) and focus fell to the body.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [back]);

  const body = (
    <div
      ref={dialog}
      className="pt-book"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-book-stage={stage}
      data-motion={reduced ? 'reduced' : 'full'}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Esc and "Put it back" are the keyboard path */}
      <div className="pt-book__veil" aria-hidden="true" onClick={back} />
      {stage === 'pulled' ? (
        <div className="pt-book__pulled">
          <button
            ref={cover}
            type="button"
            className="pt-book__coverbutton"
            aria-label={`Open ${book.title}`}
            aria-describedby={hintId}
            onClick={open}
          >
            <BookCover book={book} cloth={cloth} labelled={labelled} />
          </button>
          <div className="pt-book__slip" id={hintId}>
            <p className="pt-book__sliptitle">
              <b id={titleId}>{book.title}</b>
              <span>{cardStateLine(book)}</span>
            </p>
            <button type="button" className="pt-book__key" onClick={open}>
              <kbd className="pt-kbd">Enter</kbd> open
            </button>
            <button type="button" className="pt-book__key" onClick={back}>
              <kbd className="pt-kbd">Esc</kbd> put it back
            </button>
          </div>
        </div>
      ) : (
        <BookSpread
          ref={spread}
          book={book}
          cloth={cloth}
          titleId={titleId}
          onRead={read}
          onSummary={onSummary}
          onPutBack={back}
        />
      )}
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(body, document.body);
}
