/**
 * Spine: one book on the shelf (#195, DESIGN.md §1, frame 00). Cloth in the topic's colour with a
 * gilt title set vertically, or a paper label on a cloth gilt cannot be read on; a ribbon while
 * the person is reading it, a kraft wrap while we read it, a torn red label when we could not.
 * A real button whose name says everything the picture says (`spineName`).
 */
'use client';

import { memo } from 'react';

import {
  authorLine,
  clothFor,
  clothTakesLabel,
  spineHeight,
  spineName,
  spineState,
  spineTitle,
  spineWidth,
  SPINE_MAX_WIDTH,
  type ShelfPaper,
  type SpineState,
} from '../model/shelf';

import type { ReactNode } from 'react';

/** Props for `Spine`. */
export interface SpineProps {
  readonly paper: ShelfPaper;
  /** The roving tab stop: 0 for the one spine Tab lands on, -1 for the rest. */
  readonly tabIndex: 0 | -1;
  /** While a search runs: true lights the spine, false dims it. Undefined: no search. */
  readonly match?: boolean;
  /** This spine's catalogue card is open. */
  readonly expanded: boolean;
  /** The catalogue card's id, for `aria-controls` while it is open. */
  readonly cardId?: string;
  /** Click, Enter or Space. */
  readonly onActivate: (paperId: string) => void;
  /** Keeps the roving tab stop on the spine that last had focus. */
  readonly onFocusSpine: (paperId: string) => void;
  /** The shorter spine of a library at scale (frame 01f). */
  readonly compact?: boolean;
}

/** How the face is drawn: gilt on cloth, a paper label, a kraft wrap or a torn label. */
type Face = 'gilt' | 'label' | 'kraft' | 'torn';

function faceOf(state: SpineState, paper: ShelfPaper): Face {
  if (state === 'failed') return 'torn';
  if (state === 'queued' || state === 'parsing') return 'kraft';
  return clothTakesLabel(clothFor(paper)) ? 'label' : 'gilt';
}

/** Caslon's mean advance is about half an em; enough to choose a size, not to lay out text. */
const MEAN_ADVANCE_EM = 0.5;

/**
 * Frame 01's sizes: 17 px for a word, 14 px for a phrase, 12.5 px when that does not fit the
 * spine, else 12 px on two lines.
 */
function titleSize(
  short: string,
  room: number,
  compact: boolean,
): { readonly size: number; readonly wrap: boolean } {
  if (short.length <= 4) return { size: 17, wrap: false };
  for (const size of [14, 12.5]) {
    if (short.length * size * MEAN_ADVANCE_EM <= room) return { size, wrap: false };
  }
  // A short spine at scale has no room for a second line: the title ends in an ellipsis.
  return { size: 12, wrap: !compact };
}

/** The title (and, on a wide gilt spine, the author line) in the middle of the spine. */
function SpineFace({
  paper,
  face,
  compact,
}: {
  readonly paper: ShelfPaper;
  readonly face: Face;
  readonly compact: boolean;
}): ReactNode {
  const short = spineTitle(paper.title);
  // The vertical title's length is bounded by the spine, less its bands, year and padding.
  const room = spineHeight(paper.id, compact) - 88;
  const { size, wrap } = titleSize(short, room, compact);
  const title = (
    <span
      className={`pt-spine__title${wrap ? ' pt-spine__title--wrap' : ''}`}
      style={{ fontSize: size, maxHeight: room }}
    >
      {short}
    </span>
  );
  if (face !== 'gilt') {
    return (
      <span className={`pt-spine__label pt-spine__label--${face}`}>
        {title}
        {face === 'kraft' ? <span className="pt-spine__note">being read</span> : null}
        {face === 'torn' ? <span className="pt-spine__note">could not read</span> : null}
      </span>
    );
  }
  const authors = authorLine(paper.authors);
  // Frame 01 sets an author line beside the title only on a spine near the 48 px cap.
  const roomy = spineWidth(paper.pageCount) >= SPINE_MAX_WIDTH - 4;
  return (
    <span className="pt-spine__face">
      {title}
      {authors !== null && roomy && !wrap ? (
        <span className="pt-spine__authors">{authors}</span>
      ) : null}
    </span>
  );
}

/**
 * One spine. Memoised: a search keystroke re-renders only the spines whose `match` changed.
 *
 * @example
 * <Spine paper={p} tabIndex={0} expanded={false} onActivate={open} onFocusSpine={setActive} />
 */
export const Spine = memo(function Spine({
  paper,
  tabIndex,
  match,
  expanded,
  cardId,
  onActivate,
  onFocusSpine,
  compact = false,
}: SpineProps): ReactNode {
  const state = spineState(paper);
  const face = faceOf(state, paper);
  // No year on the torn label, nor on the Language cloth, where neither gilt nor ink reaches 4.5:1.
  const year =
    typeof paper.year === 'number' && (face === 'gilt' || face === 'kraft') ? paper.year : null;
  return (
    <button
      type="button"
      className={`pt-spine pt-spine--${face}`}
      style={{
        width: spineWidth(paper.pageCount),
        height: spineHeight(paper.id, compact),
        ...(face === 'kraft' ? {} : { backgroundColor: `var(--pt-cloth-${clothFor(paper)})` }),
      }}
      tabIndex={tabIndex}
      aria-label={spineName(paper)}
      aria-expanded={expanded}
      aria-controls={expanded ? cardId : undefined}
      data-paper-id={paper.id}
      data-processing-state={paper.processing}
      data-spine-state={state}
      data-match={match === undefined ? undefined : String(match)}
      onClick={() => onActivate(paper.id)}
      onFocus={() => onFocusSpine(paper.id)}
    >
      <span className="pt-spine__inner" aria-hidden="true">
        <span className={face === 'gilt' ? 'pt-spine__band' : 'pt-spine__gap'} />
        <span className="pt-spine__middle">
          <SpineFace paper={paper} face={face} compact={compact} />
        </span>
        {year === null ? null : <span className="pt-spine__year">{year}</span>}
        <span className={face === 'gilt' ? 'pt-spine__band' : 'pt-spine__gap'} />
        {state === 'reading' ? <span className="pt-spine__ribbon" /> : null}
      </span>
    </button>
  );
});
