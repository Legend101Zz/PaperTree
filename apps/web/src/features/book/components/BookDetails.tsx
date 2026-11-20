/**
 * BookDetails: the right page of the opened book (#200, frame 02). The topic and where it came
 * from, "2017 · arXiv 1706.03762 · 15 pages", the figures the parser found, the title, the byline,
 * the abstract's first sentences under their "p. 1 · Abstract" tab (a link that flashes it in the
 * reader), where the person is with its rule, their counts, Read or Continue (oxblood cloth),
 * Summary, the ⋯ menu (`SpreadActions`), the arXiv link and "Put it back (Esc)". The title is a
 * field while it is being renamed (`SpreadTitle`). A paper that is queued, being read, failed or
 * partial shows its status sentence (`statusSentence`) in place of the abstract: the facts are not
 * in yet, or not all of them. The abstract is the paper's words (`PaperText`). On a phone
 * (reached through the library's sheet, #199) the tab and the arXiv link answer 44 px taps and
 * "Put it back" shows no key.
 */
'use client';

import { Button, PaperText } from '@papertree/ui';
import Link from 'next/link';
import { useState } from 'react';

import { cardStateLine } from '@/features/library/model/catalogue';
import { useTouchTargets } from '@/features/library/hooks/useTouchTargets';
import { topicSource } from '@/features/library/model/table';
import { readingPage } from '@/features/library/model/shelf';

import { bookReaderHref } from '../hooks/useFromBook';
import {
  abstractExcerpt,
  arxivLink,
  countsLine,
  figuresLine,
  isReadIn,
  longDate,
  metaLine,
  statusSentence,
} from '../model/book';
import { SpreadActions } from './SpreadActions';
import { SpreadTitle } from './SpreadTitle';

import type { SummaryState } from '../model/book';
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
  /** `GET …/summary`'s state, or null while it loads (nothing is claimed then). */
  readonly summary: SummaryState | null;
  readonly onRead: () => void;
  readonly onSummary: () => void;
  readonly onPutBack: () => void;
  /** Delete this paper (the ⋯ menu), or Remove on a failed one. */
  readonly onDelete: () => void;
  /** Retry on a failed paper. */
  readonly onRetry: () => Promise<unknown>;
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
 *   onRead={read} onSummary={summary} onPutBack={back} onDelete={del} onRetry={retry} />
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
  onDelete,
  onRetry,
  summary,
}: BookDetailsProps): ReactNode {
  const meta = metaLine(book);
  const found = figures === null ? null : figuresLine(figures);
  const excerpt = abstract === null ? null : abstractExcerpt(abstract.text);
  const source = topicSource(book.topic, 'book');
  const arxiv = arxivLink(book.arxivId);
  const touch = useTouchTargets();
  const [renaming, setRenaming] = useState(false);
  const status = statusSentence(book);
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
      <SpreadTitle
        paperId={book.id}
        title={book.title}
        titleId={titleId}
        editing={renaming}
        onDone={() => {
          setRenaming(false);
          // Back on the menu's button, where Rename began (focus never falls out of the dialog).
          document
            .querySelector<HTMLElement>('.pt-book .pt-spreadmenu__button')
            ?.focus({ preventScroll: true });
        }}
      />
      {book.authors.length === 0 ? null : (
        <p className="pt-bookdetails__byline">{book.authors.join(', ')}</p>
      )}
      {status === null ? null : (
        <p className="pt-bookdetails__status" data-book-status="">
          {status}
        </p>
      )}
      {!isReadIn(book) || excerpt === null || abstract === null ? null : (
        <div className="pt-bookdetails__abstract">
          {/* The link holds the tab's clipped face: the tab's swallowtail would clip a hit area
              drawn on itself, and the link's own is free to reach 44 px on a phone (book.css). */}
          <Link
            className="pt-bookdetails__tablink"
            href={bookReaderHref(book.id, 'abstract')}
            aria-label={`p. ${String((abstract.pageIndex ?? 0) + 1)}, Abstract: show it in the paper`}
          >
            <span className="pt-tab pt-bookdetails__tab">
              {`p. ${String((abstract.pageIndex ?? 0) + 1)} · Abstract`}
            </span>
          </Link>
          <PaperText as="blockquote" className="pt-bookdetails__excerpt">
            {`“${excerpt}”`}
          </PaperText>
        </div>
      )}
      <ReadingRow book={book} />
      {isReadIn(book) ? <p className="pt-bookdetails__counts">{countsLine(book)}</p> : null}
      <SpreadActions
        book={book}
        summary={summary}
        onRead={onRead}
        onSummary={onSummary}
        onRename={() => setRenaming(true)}
        onDelete={onDelete}
        onRetry={onRetry}
      />
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
          {/* A finger has no Esc (#199): the key is drawn only for a fine pointer on a wide screen. */}
          Put it back {touch ? null : <kbd className="pt-kbd">Esc</kbd>}
        </Button>
      </div>
    </div>
  );
}
