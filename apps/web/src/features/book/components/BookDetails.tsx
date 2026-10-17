/**
 * BookDetails: the right page of the opened book (#200, frame 02). The topic and where it came
 * from, "2017 · arXiv 1706.03762 · 15 pages", the figures the parser found, the title, the byline,
 * the abstract's first sentences under their "p. 1 · Abstract" tab (a link that flashes it in the
 * reader), where the person is with its rule, their counts, Read (oxblood cloth), Summary, the
 * arXiv link and "Put it back (Esc)". The abstract is the paper's words (`PaperText`).
 */
'use client';

import { Button, PaperText } from '@papertree/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { cardStateLine } from '@/features/library/model/catalogue';
import { readingPage } from '@/features/library/model/shelf';

import { bookReaderHref } from '../hooks/useFromBook';
import {
  abstractExcerpt,
  arxivLink,
  countsLine,
  figuresLine,
  longDate,
  metaLine,
  topicSourceLine,
} from '../model/book';

import type { BookFigure } from '../model/types';
import type { LibraryBook } from '@/features/library';
import type { ReactNode } from 'react';

/** Props for `BookDetails`. */
export interface BookDetailsProps {
  readonly book: LibraryBook;
  readonly cloth: string;
  /** The heading's id: the dialog is labelled by it. */
  readonly titleId: string;
  /** `GET …/figures`, or null while it loads or when it failed. */
  readonly figures: readonly BookFigure[] | null;
  /** `GET …/abstract`'s text and page, or null while it loads. */
  readonly abstract: { readonly text: string | null; readonly pageIndex: number | null } | null;
  readonly onRead: () => void;
  readonly onSummary: () => void;
  readonly onPutBack: () => void;
}

/** Where the person is: the ribbon, the state, the rule; and when it was shelved. */
function ReadingRow({ book }: { readonly book: LibraryBook }): ReactNode {
  const at = readingPage(book);
  const added = longDate(book.addedAt);
  return (
    <>
      <div className="pt-bookdetails__reading">
        <span>
          {at === null ? null : <span className="pt-book__ribbon" aria-hidden="true" />}
          {cardStateLine(book)}
        </span>
        {added === null ? null : <span className="pt-bookdetails__added">{`Added ${added}`}</span>}
      </div>
      {at === null ? null : (
        <div
          className="pt-bookdetails__rule"
          role="progressbar"
          aria-label="Reading progress"
          aria-valuemin={1}
          aria-valuemax={at.of}
          aria-valuenow={at.page}
          style={{ ['--at' as string]: `${String((100 * at.page) / at.of)}%` }}
        />
      )}
    </>
  );
}

/**
 * The right page.
 *
 * @example
 * <BookDetails book={book} cloth="transformers" titleId="t" figures={figs} abstract={abs}
 *   onRead={read} onSummary={summary} onPutBack={back} />
 */
export function BookDetails({
  book,
  cloth,
  titleId,
  figures,
  abstract,
  onRead,
  onSummary,
  onPutBack,
}: BookDetailsProps): ReactNode {
  const meta = metaLine(book);
  const found = figures === null ? null : figuresLine(figures);
  const excerpt = abstract === null ? null : abstractExcerpt(abstract.text);
  const source = topicSourceLine(book.topic);
  const arxiv = arxivLink(book.arxivId);
  return (
    <div className="pt-bookdetails">
      {book.topic === null || book.topic === undefined ? null : (
        <p className="pt-bookdetails__topic">
          <span>
            <span
              className="pt-book__swatch"
              style={{ backgroundColor: `var(--pt-cloth-${cloth})` }}
              aria-hidden="true"
            />
            {book.topic.name}
          </span>
          {source === null ? null : <span className="pt-bookdetails__source">{source}</span>}
        </p>
      )}
      <p className="pt-bookdetails__meta" data-book-meta="">
        {meta}
        {found === null ? null : (
          <>
            <br />
            <span data-book-figures="">{found}</span>
          </>
        )}
      </p>
      <h2 id={titleId} className="pt-bookdetails__title">
        {book.title.trim()}
      </h2>
      {book.authors.length === 0 ? null : (
        <p className="pt-bookdetails__byline">{book.authors.join(', ')}</p>
      )}
      {excerpt === null || abstract === null ? null : (
        <div className="pt-bookdetails__abstract">
          <Link
            className="pt-tab pt-bookdetails__tab"
            href={bookReaderHref(book.id, 'abstract')}
            aria-label={`p. ${String((abstract.pageIndex ?? 0) + 1)}, Abstract: show it in the paper`}
          >
            {`p. ${String((abstract.pageIndex ?? 0) + 1)} · Abstract`}
          </Link>
          <PaperText as="blockquote" className="pt-bookdetails__excerpt">
            {`“${excerpt}”`}
          </PaperText>
        </div>
      )}
      <ReadingRow book={book} />
      <p className="pt-bookdetails__counts">{countsLine(book)}</p>
      <div className="pt-bookdetails__actions">
        <Button
          variant="primary"
          size="touch"
          data-book-read=""
          trailingIcon={<ArrowRight size={18} strokeWidth={1.5} />}
          onClick={onRead}
        >
          Read<span className="pt-sr-only">{` ${book.title}`}</span>
        </Button>
        <Button size="touch" onClick={onSummary}>
          Summary
        </Button>
        <span className="pt-bookdetails__summary">
          {book.hasSummary ? 'Summary ready (cached)' : 'No summary yet'}
        </span>
      </div>
      <div className="pt-bookdetails__foot">
        {arxiv === null ? (
          <span />
        ) : (
          <a className="pt-bookdetails__arxiv" href={arxiv.href} target="_blank" rel="noreferrer">
            {`${arxiv.label} ↗`}
            <span className="pt-sr-only"> (opens arXiv in a new tab)</span>
          </a>
        )}
        <Button variant="ghost" size="touch" onClick={onPutBack}>
          Put it back <kbd className="pt-kbd">Esc</kbd>
        </Button>
      </div>
    </div>
  );
}
