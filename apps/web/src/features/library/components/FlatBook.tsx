/**
 * FlatBook: one book lying flat in the phone's stack (#199, frame 08a, DESIGN.md §10). Its spine
 * faces you: the cloth with a gilt band and the short title across it, the year at the fore-edge
 * end, the ribbon out of that end while you read it; a paper label on Language cloth, kraft while
 * we read it, a torn red label when we could not. The same button as a `Spine` (name, data, keys).
 */
'use client';

import { memo } from 'react';

import { flatBook } from '../model/phone';
import { clothFor, spineName, spineState, type ShelfPaper } from '../model/shelf';

import type { CSSProperties, ReactNode } from 'react';

/** Props for `FlatBook`; the same contract as `SpineProps`. */
export interface FlatBookProps {
  readonly paper: ShelfPaper;
  /** The roving tab stop: 0 for the one book Tab lands on, -1 for the rest. */
  readonly tabIndex: 0 | -1;
  /** While a search runs: true lights the book, false dims it. Undefined: no search. */
  readonly match?: boolean;
  /** This book's catalogue card is open. */
  readonly expanded: boolean;
  readonly cardId?: string;
  readonly onActivate: (paperId: string) => void;
  readonly onFocusBook: (paperId: string) => void;
}

/**
 * One flat book. Memoised, like the spines: a search keystroke re-renders only the books whose
 * `match` changed.
 *
 * @example
 * <FlatBook paper={p} tabIndex={0} expanded={false} onActivate={open} onFocusBook={setActive} />
 */
export const FlatBook = memo(function FlatBook({
  paper,
  tabIndex,
  match,
  expanded,
  cardId,
  onActivate,
  onFocusBook,
}: FlatBookProps): ReactNode {
  const book = flatBook(paper);
  const onPaper = book.face !== 'gilt';
  // Frame 08a writes "being read" on the kraft beside the label; red needs the paper under it.
  const note = book.note === null ? null : <span className="pt-flatbook__note">{book.note}</span>;
  const style = {
    '--pt-flat-short': `${String(book.short)}px`,
    '--pt-flat-offset': `${String(book.offset)}px`,
    ...(book.face === 'kraft' ? {} : { backgroundColor: `var(--pt-cloth-${clothFor(paper)})` }),
  } as CSSProperties;
  return (
    <button
      type="button"
      className={`pt-flatbook pt-flatbook--${book.face}`}
      style={style}
      tabIndex={tabIndex}
      aria-label={spineName(paper)}
      aria-expanded={expanded}
      aria-controls={expanded ? cardId : undefined}
      data-paper-id={paper.id}
      data-processing-state={paper.processing}
      data-spine-state={spineState(paper)}
      data-match={match === undefined ? undefined : String(match)}
      onClick={() => onActivate(paper.id)}
      onFocus={() => onFocusBook(paper.id)}
    >
      <span className="pt-flatbook__inner" aria-hidden="true">
        {onPaper ? null : <span className="pt-flatbook__band" />}
        <span className={onPaper ? 'pt-flatbook__label' : 'pt-flatbook__face'}>
          <span className="pt-flatbook__title">{book.title}</span>
          {book.face === 'torn' ? note : null}
        </span>
        {book.face === 'kraft' ? note : null}
        {book.year === null ? null : <span className="pt-flatbook__year">{book.year}</span>}
        {book.ribbon ? <span className="pt-flatbook__ribbon" /> : null}
      </span>
    </button>
  );
});
