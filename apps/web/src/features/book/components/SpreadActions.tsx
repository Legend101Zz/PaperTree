/**
 * SpreadActions: the buttons under the opened book's facts (v0.3 #337, V3-36). A paper that is
 * read in has **Read** (or **Continue at p. 4** once reading has started, which resumes there),
 * Summary and the ⋯ menu. A paper still being read has a disabled Read (its status is the
 * sentence above), and a queued one a Read that opens the PDF in Source mode. A failed paper has
 * **Retry** and **Remove** instead of Read: Retry through `useBookActions` (busy flag, failure as
 * a sentence), Remove through the same Undo-able delete as the menu's. Once reading has started,
 * "from the start" is a link beside Continue (V3-36: it opens the reader at page 1). Read or Retry carries
 * `data-book-primary`, which is where focus lands when the book has opened, so Enter reads.
 */
'use client';

import { Button } from '@papertree/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { TOUCH_TARGET } from '@/components/library/primitives';
import { useBookActions } from '@/features/library/hooks/useBookActions';
import { readingPage } from '@/features/library/model/shelf';

import { bookReaderHref } from '../hooks/useFromBook';
import { isReadIn, readLabel, summaryLine, type SummaryState } from '../model/book';
import { SpreadMenu } from './SpreadMenu';

import type { LibraryBook } from '@/features/library';
import type { ReactNode } from 'react';

/** Props for `SpreadActions`. */
export interface SpreadActionsProps {
  readonly book: LibraryBook;
  /** `GET …/summary`'s state, or null while it loads (nothing is claimed then). */
  readonly summary: SummaryState | null;
  readonly onRead: () => void;
  readonly onSummary: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly onRetry: () => Promise<unknown>;
}

/**
 * The action row.
 *
 * @example
 * <SpreadActions book={book} summary="ready" onRead={read} onSummary={sum} onRename={rename}
 *   onDelete={del} onRetry={retry} />
 */
export function SpreadActions({
  book,
  summary,
  onRead,
  onSummary,
  onRename,
  onDelete,
  onRetry,
}: SpreadActionsProps): ReactNode {
  // Retry only: Remove is the delete the menu has, so it never asks twice.
  const { busy, error, retry } = useBookActions(book.id, onRetry, () => Promise.resolve());
  const failed = book.processing === 'failed';
  const label = readLabel(book);
  const started = readingPage(book) !== null && isReadIn(book);
  const line = summaryLine(summary);
  return (
    <>
      <div className="pt-bookdetails__actions">
        {failed ? (
          <>
            <Button
              variant="primary"
              size="touch"
              className={TOUCH_TARGET}
              data-book-primary=""
              disabled={busy}
              onClick={retry}
            >
              Retry<span className="pt-sr-only">{` reading ${book.title}`}</span>
            </Button>
            <Button variant="danger" size="touch" className={TOUCH_TARGET} onClick={onDelete}>
              Remove<span className="pt-sr-only">{` ${book.title}`}</span>
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="touch"
            data-book-read=""
            data-book-primary=""
            disabled={book.processing === 'parsing'}
            trailingIcon={<ArrowRight size={18} strokeWidth={1.5} />}
            onClick={onRead}
          >
            {label}
            <span className="pt-sr-only">{` ${book.title}`}</span>
          </Button>
        )}
        {!failed && started ? (
          <Link
            className="pt-bookdetails__fromstart"
            href={bookReaderHref(book.id, { page: 1 })}
            data-book-from-start=""
          >
            from the start
            <span className="pt-sr-only">{` of ${book.title}`}</span>
          </Link>
        ) : null}
        {isReadIn(book) ? (
          <>
            <Button size="touch" onClick={onSummary}>
              {line.button}
            </Button>
            <span className="pt-bookdetails__summary">{line.line}</span>
          </>
        ) : null}
        <SpreadMenu book={book} onRename={onRename} onDelete={onDelete} />
      </div>
      {error === null ? null : (
        <p role="alert" className="pt-spread__error">
          {error}
        </p>
      )}
    </>
  );
}
