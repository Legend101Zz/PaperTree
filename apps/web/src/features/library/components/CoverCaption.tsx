/**
 * CoverCaption: what stands under a face-out cover (#196, frame 01c): the title, "Ashish Vaswani
 * et al. · 2017 · 15 pages", the topic with its cloth swatch, then by state: a progress rule with
 * "p. 4 of 15" and Continue while you read it, or the state ("Read", "Not started", "Queued"…)
 * and Open. Its controls are ordinary tab stops, not part of the shelf's arrow keys.
 */
'use client';

import { Button, readingFraction } from '@papertree/ui';
import { ArrowRight } from 'lucide-react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import { useTouchTargets } from '../hooks/useTouchTargets';
import { clothFor, readingPage, type ShelfPaper } from '../model/shelf';
import { cardStateLine, metaLine } from './CatalogueCard';

import type { LibraryBook } from '../hooks/useLibrary';
import type { CSSProperties, ReactNode } from 'react';

/** Props for `CoverCaption`. */
export interface CoverCaptionProps {
  readonly book: LibraryBook;
  /** Open: the reader, in every state (Source mode works for a paper we could not read). */
  readonly onOpen: (paperId: string) => void;
  /** Continue: the reader at your page. */
  readonly onContinue: (book: LibraryBook) => void;
}

/**
 * The caption under one cover.
 *
 * @example
 * <CoverCaption book={book} onOpen={read} onContinue={resume} />
 */
export function CoverCaption({ book, onOpen, onContinue }: CoverCaptionProps): ReactNode {
  const touch = useTouchTargets();
  const size = touch ? 'touch' : 'md';
  const target = touch ? TOUCH_TARGET : undefined;
  const at = readingPage(book);
  const title = book.title.trim();
  // A topic arrives with S2b (#193); until then a book has none and the line is left out.
  const { topic } = book as ShelfPaper;
  // The Reading now row's rule and page (ui `.pt-readnow__*`), so both progress readouts match.
  const fill = {
    '--pt-readnow-fill': `${at === null ? 0 : readingFraction(at.page, at.of) * 100}%`,
  };
  return (
    <div className="pt-covercap" data-cover-caption="">
      <p className="pt-covercap__title">{title}</p>
      <p className="pt-covercap__meta">{metaLine(book)}</p>
      {topic ? (
        <p className="pt-covercap__meta">
          <span
            className="pt-covercap__swatch"
            style={{ backgroundColor: `var(--pt-cloth-${clothFor(book)})` }}
            aria-hidden="true"
          />
          {topic.name}
        </p>
      ) : null}
      {at === null ? (
        <>
          <p className="pt-covercap__state">{cardStateLine(book)}</p>
          <Button
            size={size}
            className={target}
            onClick={() => onOpen(book.id)}
            aria-label={`Open ${title}`}
          >
            Open
          </Button>
        </>
      ) : (
        <>
          <div className="pt-covercap__progress">
            <span className="pt-readnow__rule" style={fill as CSSProperties} aria-hidden="true">
              <span className="pt-readnow__tick" />
            </span>
            <span className="pt-readnow__page">
              p. {at.page} of {at.of}
            </span>
          </div>
          <Button
            variant="outline"
            size={size}
            className={target}
            trailingIcon={<ArrowRight size={18} strokeWidth={1.5} />}
            onClick={() => onContinue(book)}
            aria-label={`Continue reading ${title}`}
          >
            Continue
          </Button>
        </>
      )}
    </div>
  );
}
