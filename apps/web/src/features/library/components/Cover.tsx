/**
 * Cover: one book standing face-out on a short shelf (#196, frame 01c). A typographic cover in
 * the topic's cloth (or the arXiv fallback cloth) with a gilt frame, the full title, the authors
 * and the year; the ribbon while you read it, kraft while we read it, a torn red label when we
 * could not. The same button as a `Spine`: the same name, data and keyboard role on the shelf.
 */
'use client';

import { memo } from 'react';

import {
  authorLine,
  clothFor,
  clothTakesLabel,
  spineName,
  spineState,
  type ShelfPaper,
  type SpineState,
} from '../model/shelf';

import type { ReactNode } from 'react';

/** Props for `Cover`; the same contract as `SpineProps`. */
export interface CoverProps {
  readonly paper: ShelfPaper;
  /** The roving tab stop: 0 for the one book Tab lands on, -1 for the rest. */
  readonly tabIndex: 0 | -1;
  /** While a search runs: true lights the cover, false dims it. Undefined: no search. */
  readonly match?: boolean;
  /** This book's catalogue card is open. */
  readonly expanded: boolean;
  readonly cardId?: string;
  readonly onActivate: (paperId: string) => void;
  readonly onFocusCover: (paperId: string) => void;
}

/** Gilt on cloth; ink on a paper label where gilt cannot be read (the Language cloth, kraft). */
function faceOf(state: SpineState, paper: ShelfPaper): 'gilt' | 'label' | 'kraft' | 'torn' {
  if (state === 'failed') return 'torn';
  if (state === 'queued' || state === 'parsing') return 'kraft';
  return clothTakesLabel(clothFor(paper)) ? 'label' : 'gilt';
}

/**
 * One face-out cover. Memoised, like the spines: a search keystroke re-renders only the covers
 * whose `match` changed.
 *
 * @example
 * <Cover paper={p} tabIndex={0} expanded={false} onActivate={open} onFocusCover={setActive} />
 */
export const Cover = memo(function Cover({
  paper,
  tabIndex,
  match,
  expanded,
  cardId,
  onActivate,
  onFocusCover,
}: CoverProps): ReactNode {
  const state = spineState(paper);
  const face = faceOf(state, paper);
  const authors = authorLine(paper.authors);
  const note = face === 'torn' ? 'could not read' : face === 'kraft' ? 'being read' : null;
  return (
    <button
      type="button"
      className={`pt-cover pt-cover--${face}`}
      style={
        face === 'kraft' ? undefined : { backgroundColor: `var(--pt-cloth-${clothFor(paper)})` }
      }
      tabIndex={tabIndex}
      aria-label={spineName(paper)}
      aria-expanded={expanded}
      aria-controls={expanded ? cardId : undefined}
      data-paper-id={paper.id}
      data-processing-state={paper.processing}
      data-spine-state={state}
      data-match={match === undefined ? undefined : String(match)}
      onClick={() => onActivate(paper.id)}
      onFocus={() => onFocusCover(paper.id)}
    >
      <span className="pt-cover__inner" aria-hidden="true">
        <span className="pt-cover__frame" />
        <span className="pt-cover__title">{paper.title.trim()}</span>
        <span className="pt-cover__rule" />
        {authors === null ? null : <span className="pt-cover__authors">{authors}</span>}
        {note === null ? null : <span className="pt-cover__note">{note}</span>}
        {typeof paper.year === 'number' ? (
          <span className="pt-cover__year">{paper.year}</span>
        ) : null}
      </span>
      {state === 'reading' ? <span className="pt-cover__ribbon" aria-hidden="true" /> : null}
    </button>
  );
});
