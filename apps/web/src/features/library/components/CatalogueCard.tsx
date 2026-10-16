/**
 * CatalogueCard: what a book is, in the band above the shelf, pointing at its spine (#195,
 * frame 01): the title, authors · year · pages, where the person is in it, and what can be done:
 * Read, Retry when we could not read it, Delete (danger, confirmed inline). It opens with focus on
 * Read, so Enter again opens the reader; Esc puts the book back and returns focus to the spine.
 * It sits above the spines, so it never covers a neighbour.
 */
'use client';

import { Button } from '@papertree/ui';
import { useEffect, useRef, useState } from 'react';

import { ProgressMeter, TOUCH_TARGET } from '@/components/library/primitives';
import { describeError } from '@/components/ui/errors';

import { cardStateLine, metaLine } from '../model/catalogue';

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
}

type ActionsProps = Pick<CatalogueCardProps, 'book' | 'onRetry' | 'onDelete'>;

/** Retry (failed papers only) and Delete with its inline confirmation; failures as sentences. */
function CardActions({ book, onRetry, onDelete }: ActionsProps): ReactNode {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>, fallback: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirming(false);
    } catch (caught) {
      setError(describeError(caught, fallback));
    } finally {
      setBusy(false);
    }
  };
  const retry = (): void =>
    void run(
      () => onRetry(book.id),
      'Could not start reading again. Check your connection and retry.',
    );
  const remove = (): void =>
    void run(
      () => onDelete(book.id),
      'Could not delete this paper. Check your connection and try again.',
    );
  return (
    <>
      {book.processing === 'failed' ? (
        <Button size="touch" className={TOUCH_TARGET} disabled={busy} onClick={retry}>
          Retry<span className="pt-sr-only">{` reading ${book.title}`}</span>
        </Button>
      ) : null}
      {book.isSample === true ? null : confirming ? (
        <div
          role="group"
          aria-label={`Confirm deleting ${book.title}`}
          className="pt-catalogue__confirm"
          data-delete-confirm=""
        >
          <p>Delete this paper and its highlights? This cannot be undone.</p>
          <Button
            variant="danger"
            size="touch"
            className={TOUCH_TARGET}
            disabled={busy}
            onClick={remove}
          >
            {busy ? 'Deleting' : 'Delete paper'}
          </Button>
          <Button
            size="touch"
            className={TOUCH_TARGET}
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Keep it
          </Button>
        </div>
      ) : (
        <Button
          variant="danger"
          size="touch"
          className={TOUCH_TARGET}
          aria-label={`Delete ${book.title}`}
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
      className="pt-catalogue"
      aria-labelledby={titleId}
      data-card-paper-id={book.id}
      data-processing-state={book.processing}
      style={placement === null ? undefined : { marginInlineStart: placement.left }}
    >
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
        <CardActions book={book} onRetry={onRetry} onDelete={onDelete} />
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
