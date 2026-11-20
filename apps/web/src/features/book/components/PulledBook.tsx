/**
 * PulledBook: the book taken off the shelf and opened, as a modal over the veiled library (v0.3
 * R4, DESIGN.md §1 and §6). One motion of 880 ms (`model/motion.ts`): the spine slides out, turns,
 * flies to the middle growing into a cover, the cover swings open and you land on the two-page
 * spread. A click or any key while it plays skips to the end; Esc, a click outside or "Put it
 * back" run it backwards in 420 ms and the shelf focuses the spine again. Reduced motion is a
 * cross-fade. Focus lands on Read once the spread is open. Focus is trapped in the dialog and the
 * library behind it is inert.
 */
'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { useFocusTrap } from '../hooks/useFocusTrap';
import { cancelAll, finishAll, play, useReducedMotion } from '../hooks/useBookMotion';
import { putBack as putBackMotion, takeOut, TO_READER, type Box } from '../model/motion';
import './book.css';
import { BookCover } from './BookCover';
import { BookSpread } from './BookSpread';

import type { LibraryBook } from '@/features/library';

/** Where the book is: coming out, open, or going back. */
type Phase = 'opening' | 'open' | 'closing';

/** Props for `PulledBook`. */
export interface PulledBookProps {
  readonly book: LibraryBook;
  readonly cloth: string;
  /** Ink on a paper label instead of gilt (the Language cloth). */
  readonly labelled: boolean;
  /** The spine's box on the shelf when it was taken out (the flight starts there), or null. */
  readonly from: Box | null;
  /** The library behind the veil: inert while the book is out. */
  readonly behind: HTMLElement | null;
  /** After the put-back motion: the shelf unmounts this and focuses the spine. */
  readonly onPutBack: () => void;
  readonly onRead: () => void;
  readonly onSummary: () => void;
}

/**
 * The opened book.
 *
 * @example
 * <PulledBook book={book} cloth="transformers" labelled={false} from={box} behind={library}
 *   onPutBack={back} onRead={read} onSummary={summary} />
 */
export function PulledBook({
  book,
  cloth,
  labelled,
  from,
  behind,
  onPutBack,
  onRead,
  onSummary,
}: PulledBookProps): ReactNode {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const spread = useRef<HTMLDivElement>(null);
  const flyer = useRef<HTMLDivElement>(null);
  const slab = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('opening');
  // Where the book is going, kept in a ref because every animation-end handler and key listener
  // must read the CURRENT moment, not the one it closed over (#200 review B1): an opening that
  // was skipped must not be finished twice, and a put-back must not open the book again.
  const moment = useRef<Phase | 'reading' | 'gone'>('opening');
  const running = useRef(new Set<Animation>());
  // Read once: a later re-measure or a change of preference must not replay a motion. `page` is
  // the cover's resting box, measured while nothing is transformed and kept for the way back.
  const start = useRef({ from, reduced });
  const page = useRef<Box | null>(null);
  // Nothing flies for a book without a measured spine or a reader who asked for less motion.
  const flies = !reduced && from !== null;
  useFocusTrap(dialog, behind);

  const go = useCallback((next: Phase) => {
    moment.current = next;
    setPhase(next);
  }, []);

  // Each time the book starts to move (out, then back), play its parts together. They all end
  // together, so the first promise to settle for the CURRENT moment says it is over.
  useLayoutEffect(() => {
    if (phase === 'open') {
      spread.current
        ?.querySelector<HTMLElement>('[data-book-read]')
        ?.focus({ preventScroll: true });
      return;
    }
    const { from: spine, reduced: less } = start.current;
    const box = flyer.current?.getBoundingClientRect();
    if (page.current === null && box !== undefined) {
      page.current = { left: box.left, top: box.top, width: box.width, height: box.height };
    }
    const resting = page.current ?? { left: 0, top: 0, width: 0, height: 0 };
    const motion = (phase === 'opening' ? takeOut : putBackMotion)(spine, resting, less);
    const parts = [
      play(slab.current, motion.slab, running.current),
      play(flyer.current, motion.cover, running.current),
      play(spread.current, motion.spread, running.current),
      play(veil.current, motion.veil, running.current),
    ];
    void Promise.all(parts).then(() => {
      if (moment.current !== phase) return;
      if (phase === 'opening') go('open');
      else onPutBack();
    });
  }, [phase, go, onPutBack]);
  // Unmounted (put back, read, or the book left the library): nothing may act any more.
  useEffect(() => {
    const animations = running.current;
    moment.current = 'opening'; // a remount (StrictMode's double effect) starts afresh
    return () => {
      moment.current = 'gone';
      cancelAll(animations);
    };
  }, []);
  // The spine that had focus is inert behind the veil; the dialog holds it until Read takes over.
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true });
  }, []);

  const back = useCallback(() => {
    if (moment.current !== 'open') return;
    cancelAll(running.current);
    go('closing');
  }, [go]);
  const read = useCallback(() => {
    if (moment.current !== 'open') return;
    moment.current = 'reading';
    void play(spread.current, TO_READER, running.current).then(onRead);
  }, [onRead]);
  // To the end: the animations finish where they would have, and the promise above opens the book.
  const skip = useCallback(() => finishAll(running.current), []);

  // On the document, not the dialog: the dialog is modal, so every key is its own, even when the
  // control that had focus has just been replaced (the plate's choice) and focus fell to the body.
  // While the book is coming out ANY key skips to the end, Esc included (it needs a second press
  // to put the book back: one key never does both).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (moment.current === 'opening') {
        skip();
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      back();
    };
    const onPointer = (): void => {
      if (moment.current === 'opening') skip();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [back, skip]);
  // A click that skipped the motion is not also a click outside: it began while the book was
  // still coming out.
  const armed = useRef(false);

  const flightStyle = (box: Box | null): CSSProperties | undefined =>
    box === null
      ? undefined
      : { left: box.left, top: box.top, width: box.width, height: box.height };
  const body = (
    <div
      ref={dialog}
      className="pt-book"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-book-stage={phase === 'open' ? 'open' : 'moving'}
      data-motion={reduced ? 'reduced' : 'full'}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Esc and "Put it back" are the keyboard path */}
      <div
        ref={veil}
        className="pt-book__veil"
        aria-hidden="true"
        onPointerDown={() => {
          armed.current = moment.current === 'open';
        }}
        onClick={() => {
          if (armed.current) back();
          armed.current = false;
        }}
      />
      <div className="pt-book__stage">
        <BookSpread
          ref={spread}
          book={book}
          cloth={cloth}
          titleId={titleId}
          onRead={read}
          onSummary={onSummary}
          onPutBack={back}
        />
        {flies && phase !== 'open' ? (
          // The right page's size, hinged at the gutter: the cover that flies in and swings open.
          // Decoration only: the title it repeats is the spread's heading.
          <div ref={flyer} className="pt-book__flyer" aria-hidden="true">
            <BookCover book={book} cloth={cloth} labelled={labelled} />
          </div>
        ) : null}
      </div>
      {flies && phase !== 'open' ? (
        <span
          ref={slab}
          className="pt-book__slab"
          aria-hidden="true"
          style={{
            ...flightStyle(from),
            backgroundColor: `var(--pt-cloth-${cloth})`,
          }}
        />
      ) : null}
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(body, document.body);
}
