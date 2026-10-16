/**
 * CatalogueCard: what a book is, in the band above the shelf (#195, frame 01): the title, authors
 * · year · pages, where the person is in it, and what can be done (Read; Retry when we could not
 * read it; Delete, confirmed inline). It never covers a spine: the band is empty space the shelf
 * keeps for it.
 */
'use client';

import { Button } from '@papertree/ui';

import { PaperActions } from '@/components/library/PaperActions';
import { ProgressMeter } from '@/components/library/primitives';
import { PROCESSING_LABEL } from '@/components/library/types';

import { readingPage } from '../model/shelf';

import type { LibraryBook } from '../hooks/useLibrary';
import type { ReactNode } from 'react';

/** Props for `CatalogueCard`. */
export interface CatalogueCardProps {
  /** The element id the open spine points at with `aria-controls`. */
  readonly id: string;
  readonly book: LibraryBook;
  readonly onRead: (paperId: string) => void;
  readonly onRetry: (paperId: string) => Promise<unknown>;
  readonly onDelete: (paperId: string) => Promise<unknown>;
}

/**
 * The state line: "Reading now · p. 4 of 15", "Not started", "Read", or the processing state in
 * words while the paper is not ready ("Reading the PDF - step 1 of 3").
 *
 * @param book - The book.
 * @returns The line.
 */
export function cardStateLine(book: LibraryBook): string {
  if (book.processing === 'parsing' && book.step !== undefined) {
    return `${book.step.name} - step ${String(book.step.n)} of ${String(book.step.of)}`;
  }
  if (book.processing !== 'complete' && book.processing !== 'partial') {
    return PROCESSING_LABEL[book.processing];
  }
  const at = readingPage(book);
  if (at !== null) return `Reading now · p. ${String(at.page)} of ${String(at.of)}`;
  if (book.reading?.state === 'finished') return 'Read';
  return book.processing === 'partial' ? PROCESSING_LABEL.partial : 'Not started';
}

/** "Ashish Vaswani et al. · 2017 · 15 pages": only what the server knows. */
function metaLine(book: LibraryBook): string {
  const [first, second] = book.authors;
  const authors =
    first === undefined
      ? null
      : book.authors.length === 1
        ? first
        : book.authors.length === 2
          ? `${first} and ${second ?? ''}`
          : `${first} et al.`;
  const pages = book.pageCount > 0 ? `${String(book.pageCount)} pages` : null;
  return [authors, book.year === null ? null : String(book.year), pages]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/**
 * The open book's catalogue card.
 *
 * @example
 * <CatalogueCard id="card" book={book} onRead={open} onRetry={retry} onDelete={remove} />
 */
export function CatalogueCard({
  id,
  book,
  onRead,
  onRetry,
  onDelete,
}: CatalogueCardProps): ReactNode {
  const titleId = `${id}-title`;
  return (
    <section
      id={id}
      className="pt-catalogue"
      aria-labelledby={titleId}
      data-card-paper-id={book.id}
      data-processing-state={book.processing}
    >
      <div className="pt-catalogue__head">
        <h2 id={titleId} className="pt-catalogue__title">
          {book.title}
        </h2>
        <p className="pt-catalogue__state" data-card-state="">
          {cardStateLine(book)}
        </p>
      </div>
      {metaLine(book) === '' ? null : <p className="pt-catalogue__meta">{metaLine(book)}</p>}
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
          style={{ minWidth: 44 }}
          onClick={() => onRead(book.id)}
        >
          Read<span className="pt-sr-only">{` ${book.title}`}</span>
        </Button>
        <PaperActions paper={book} onRetry={onRetry} onDelete={onDelete} />
      </div>
    </section>
  );
}
