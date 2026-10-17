/**
 * BookCover: the front of a pulled-out book (#200, frame 02a). By default the typographic cover in
 * the topic's cloth: the title in gilt display type, a short gilt rule, the authors in small caps,
 * and "2017 · arXiv 1706.03762" at the foot. With a plate chosen, the paper's own figure is tipped
 * in on ivory under a smaller title, with its caption's label and page. No generated art: the
 * figure is the paper's own crop, and nothing is drawn when there is none.
 */
'use client';

import { authorLine } from '@/features/library/model/shelf';

import { plateCaption } from '../model/book';

import type { BookPaper } from '../model/types';
import type { ReactNode } from 'react';

/** Props for `BookCover`. */
export interface BookCoverProps {
  readonly book: BookPaper;
  /** The cloth (`--pt-cloth-*` id) the shelf draws this book in. */
  readonly cloth: string;
  /** Ink on a paper label instead of gilt (the Language cloth, where gilt is 2.4:1). */
  readonly labelled: boolean;
}

/** "2017 · arXiv 1706.03762", leaving out what is not known. */
function footLine(book: BookPaper): string {
  return [
    book.year === null ? null : String(book.year),
    (book.arxivId ?? null) === null ? null : `arXiv ${book.arxivId ?? ''}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/**
 * The cover.
 *
 * @example
 * <BookCover book={book} cloth="transformers" labelled={false} />
 */
export function BookCover({ book, cloth, labelled }: BookCoverProps): ReactNode {
  const authors = authorLine(book.authors);
  const foot = footLine(book);
  const plate = book.plate ?? null;
  return (
    <span
      className={`pt-bookcover${labelled ? ' pt-bookcover--label' : ''}${plate === null ? '' : ' pt-bookcover--plate'}`}
      style={{ backgroundColor: `var(--pt-cloth-${cloth})` }}
      data-cover={plate === null ? 'typographic' : 'plate'}
    >
      <span className="pt-bookcover__spine" aria-hidden="true" />
      <span className="pt-bookcover__frame" aria-hidden="true" />
      <span className="pt-bookcover__title">{book.title.trim()}</span>
      {plate === null ? (
        <>
          <span className="pt-bookcover__rule" aria-hidden="true" />
          {authors === null ? null : <span className="pt-bookcover__authors">{authors}</span>}
        </>
      ) : (
        <span className="pt-bookcover__plate">
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed crop URL of the API */}
          <img src={plate.assetUrl} alt={`${plate.label ?? 'The chosen figure'}, from the paper`} />
          <span className="pt-bookcover__caption">{plateCaption(plate)}</span>
        </span>
      )}
      {foot === '' ? null : <span className="pt-bookcover__foot">{foot}</span>}
    </span>
  );
}
