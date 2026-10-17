/**
 * CatalogueCard: what a book is, in the band above the shelf, pointing at its spine (#195,
 * frame 01): the title, authors · year · pages, where the person is in it, and what can be done:
 * Read, Retry when we could not read it, Delete (danger, confirmed inline). It opens with focus on
 * Read, so Enter again opens the reader; Esc puts the book back and returns focus to the spine.
 * It sits above the spines, so it never covers a neighbour. A book whose parse is in also offers
 * "Open the book" (#200): the opened spread, for the mouse (the keyboard's Enter on the spine).
 * On a phone (#199) it is a bottom sheet over the stacks, with a Put it back button, since a
 * finger has no Esc.
 */
'use client';

import { Button } from '@papertree/ui';
import { useEffect, useRef, type RefObject } from 'react';

import { ProgressMeter, TOUCH_TARGET } from '@/components/library/primitives';
import { canOpenBook } from '@/features/book/model/book';

import { useBookActions } from '../hooks/useBookActions';
import { cardStateLine, metaLine } from '../model/catalogue';
import { RemoveConfirm } from './RemoveConfirm';

import type { LibraryBook } from '../hooks/useLibrary';
import type { ReactNode } from 'react';

/** Props for `CatalogueCard`. */
export interface CatalogueCardProps {
  /** The element id the open spine points at with `aria-controls`. */
  readonly id: string;
  readonly book: LibraryBook;
  /** From `placeCard`: the card's left edge and its pointer, in px; null before measuring. */
  readonly placement?: { readonly left: number; readonly pointer: number } | null;
  readonly onRead: (paperId: string) => void;
  readonly onRetry: (paperId: string) => Promise<unknown>;
  readonly onDelete: (paperId: string) => Promise<unknown>;
  /** Esc: put the book back. */
  readonly onClose?: () => void;
  /** "Open the book": the opened spread (#200); shown only for a book that can be opened. */
  readonly onOpenBook?: (paperId: string) => void;
  /** Drawn as the phone's bottom sheet (no pointer; Put it back as a button). */
  readonly sheet?: boolean;
}

type ActionsProps = Pick<CatalogueCardProps, 'book' | 'onRetry' | 'onDelete'> & {
  /** The card, to find Delete again after Keep it. */
  readonly card: RefObject<HTMLElement>;
};

/** Retry (failed papers only) and Delete with its inline confirmation; failures as sentences. */
function CardActions({ book, onRetry, onDelete, card }: ActionsProps): ReactNode {
  const { confirming, setConfirming, busy, error, retry, remove } = useBookActions(
    book.id,
    onRetry,
    onDelete,
  );
  // Keep it takes the confirmation (and the focused button) away: focus goes back to Delete, the
  // button that opened it, once Delete is drawn again. `Button` does not forward refs.
  const kept = useRef(false);
  useEffect(() => {
    if (confirming || !kept.current) return;
    kept.current = false;
    card.current?.querySelector<HTMLElement>('[data-card-delete]')?.focus({ preventScroll: true });
  }, [confirming, card]);
  return (
    <>
      {book.processing === 'failed' ? (
        <Button size="touch" className={TOUCH_TARGET} disabled={busy} onClick={retry}>
          Retry<span className="pt-sr-only">{` reading ${book.title}`}</span>
        </Button>
      ) : null}
      {book.isSample === true ? null : confirming ? (
        <RemoveConfirm
          title={book.title}
          busy={busy}
          onConfirm={remove}
          onKeep={() => {
            kept.current = true;
            setConfirming(false);
          }}
        />
      ) : (
        <Button
          variant="danger"
          size="touch"
          className={TOUCH_TARGET}
          aria-label={`Delete ${book.title}`}
          data-card-delete=""
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      )}
      {error === null ? null : (
        <p role="alert" className="pt-catalogue__error">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * The open book's catalogue card.
 *
 * @example
 * <CatalogueCard id="card" book={book} placement={{ left: 81, pointer: 42 }} onRead={open}
 *   onRetry={retry} onDelete={remove} onClose={putBack} />
 */
export function CatalogueCard({
  id,
  book,
  placement = null,
  onRead,
  onRetry,
  onDelete,
  onClose,
  onOpenBook,
  sheet = false,
}: CatalogueCardProps): ReactNode {
  const titleId = `${id}-title`;
  const card = useRef<HTMLElement>(null);
  // Taking a book down puts you on its Read, so Enter again opens it.
  useEffect(() => {
    card.current?.querySelector<HTMLElement>('[data-card-read]')?.focus({ preventScroll: true });
  }, [book.id]);
  // Esc anywhere in the card puts the book back. A listener rather than an onKeyDown prop: the card
  // is a labelled region, not a control, and only its buttons take focus.
  useEffect(() => {
    const node = card.current;
    if (node === null || onClose === undefined) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [onClose]);
  const meta = metaLine(book);
  return (
    <section
      ref={card}
      id={id}
      className={sheet ? 'pt-catalogue pt-catalogue--sheet' : 'pt-catalogue'}
      aria-labelledby={titleId}
      data-card-paper-id={book.id}
      data-processing-state={book.processing}
      style={placement === null ? undefined : { marginInlineStart: placement.left }}
    >
      {sheet ? <span className="pt-catalogue__grip" aria-hidden="true" /> : null}
      <div className="pt-catalogue__head">
        <h2 id={titleId} className="pt-catalogue__title">
          {book.title}
        </h2>
        <p className="pt-catalogue__state" data-card-state="">
          {cardStateLine(book)}
        </p>
      </div>
      {meta === '' ? null : <p className="pt-catalogue__meta">{meta}</p>}
      {book.processing === 'parsing' && book.step !== undefined ? (
        <ProgressMeter
          value={(book.step.n - 1) / book.step.of}
          label={`Reading progress, ${book.title}`}
        />
      ) : null}
      {book.processing === 'failed' && book.failureReason !== undefined ? (
        <p className="pt-catalogue__reason" data-failure-reason="">
          {book.failureReason}
        </p>
      ) : null}
      {book.processing === 'partial' && book.partialReason !== undefined ? (
        <p className="pt-catalogue__reason">{book.partialReason}</p>
      ) : null}
      <div className="pt-catalogue__actions">
        <Button
          variant="primary"
          size="touch"
          className={TOUCH_TARGET}
          data-card-read=""
          onClick={() => onRead(book.id)}
        >
          Read<span className="pt-sr-only">{` ${book.title}`}</span>
        </Button>
        {onOpenBook === undefined || !canOpenBook(book) ? null : (
          <Button
            variant="outline"
            size="touch"
            className={TOUCH_TARGET}
            onClick={() => onOpenBook(book.id)}
          >
            Open the book<span className="pt-sr-only">{` ${book.title}`}</span>
          </Button>
        )}
        <CardActions book={book} onRetry={onRetry} onDelete={onDelete} card={card} />
        {sheet && onClose !== undefined ? (
          <Button size="touch" variant="ghost" className={TOUCH_TARGET} onClick={onClose}>
            Put it back
          </Button>
        ) : null}
      </div>
      {placement === null ? null : (
        <span
          className="pt-catalogue__pointer"
          style={{ left: placement.pointer }}
          aria-hidden="true"
        />
      )}
    </section>
  );
}
