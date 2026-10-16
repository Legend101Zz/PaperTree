/**
 * ShelfRow: one group's own plank in a library at scale (#196, frame 01f). Its spines scroll
 * sideways between the bookends; when some are past the right edge the plank says "28 of 36
 * shown · scroll sideways" and a "+8 more" bookend (or, while a search runs, "3 matches here")
 * brings the next of them into view and focus. No virtualisation (ADR-004): every spine is drawn.
 */
'use client';

import { paperCountLabel } from '@papertree/ui';
import { ChevronRight } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';

import { useElementWidth } from '../hooks/useElementWidth';
import { spineWidth, type ShelfGroup, type ShelfPaper } from '../model/shelf';
import { ROW_BOOKEND, ROW_GAP, rowWindow } from '../model/states';
import { PlankHolder, ShelfPlank } from './ShelfPlank';
import { Spine } from './Spine';

import type { FocusEvent, ReactNode } from 'react';

/** Props for `ShelfRow`. */
export interface ShelfRowProps {
  readonly group: ShelfGroup;
  readonly matches: ReadonlySet<string> | null;
  /** The shelf's one tab stop, wherever it is. */
  readonly stop: string | null;
  readonly openId: string | null;
  readonly cardId: string;
  readonly onActivate: (paperId: string) => void;
  readonly onFocusBook: (paperId: string) => void;
}

/** "3 matches here" (a search counts inside the overflow, #196). */
const matchesWords = (n: number): string => `${String(n)} ${n === 1 ? 'match' : 'matches'} here`;

/** The bookend's name: "8 more in Vision, 3 matches here, scroll sideways". */
function moreName(group: ShelfGroup, after: number, matchesHere: number | null): string {
  const found = matchesHere === null ? '' : `, ${matchesWords(matchesHere)}`;
  return `${String(after)} more in ${group.label}${found}, scroll sideways`;
}

/**
 * A focused spine scrolls clear of the sticky bookend (WCAG 2.4.11, review S3). Focus scrolls a
 * spine only when it is outside the row, and one under the bookend is inside it; `nearest` here
 * honours the row's `scroll-padding-inline-end`, which is the bookend's width and a gap.
 *
 * @param event - The focus event bubbling from a spine or the bookend.
 */
function keepClearOfBookend(event: FocusEvent<HTMLDivElement>): void {
  const target = event.target;
  if (target instanceof HTMLElement && target.dataset['paperId'] !== undefined) {
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
}

/**
 * One row at scale. Memoised: a search keystroke re-renders the rows, whose spines re-render only
 * when their own `match` changed.
 *
 * @example
 * <ShelfRow group={group} matches={null} stop={id} openId={null} cardId="card"
 *   onActivate={takeDown} onFocusBook={setStop} />
 */
export const ShelfRow = memo(function ShelfRow({
  group,
  matches,
  stop,
  openId,
  cardId,
  onActivate,
  onFocusBook,
}: ShelfRowProps): ReactNode {
  const scroller = useRef<HTMLDivElement>(null);
  const room = useElementWidth(scroller);
  const [scrollLeft, setScrollLeft] = useState(0);
  const widths = useMemo(() => group.papers.map((p) => spineWidth(p.pageCount)), [group.papers]);
  const { shown, after } = rowWindow(widths, ROW_GAP, scrollLeft, room, ROW_BOOKEND);
  const hidden: readonly ShelfPaper[] = after > 0 ? group.papers.slice(-after) : [];
  const matchesHere = matches === null ? null : hidden.filter((p) => matches.has(p.id)).length;

  // The first spine past the edge comes to the left of the row and takes focus (and with it the
  // shelf's tab stop), so the keyboard lands where the eye does.
  const showMore = (): void => {
    const row = scroller.current;
    const first = hidden[0];
    if (row === null || first === undefined) return;
    const spine = row.querySelector<HTMLElement>(`[data-paper-id="${CSS.escape(first.id)}"]`);
    if (spine === null) return;
    spine.focus({ preventScroll: true });
    row.scrollTo({ left: spine.offsetLeft - row.offsetLeft - ROW_GAP });
  };

  return (
    <div
      role="group"
      aria-label={`${group.label}, ${paperCountLabel(group.papers.length)}`}
      className="pt-rows__row"
    >
      <ShelfPlank>
        <div
          ref={scroller}
          className="pt-rows__spines"
          onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
          onFocus={keepClearOfBookend}
        >
          {group.papers.map((paper) => (
            <Spine
              key={paper.id}
              paper={paper}
              compact
              tabIndex={paper.id === stop ? 0 : -1}
              {...(matches === null ? {} : { match: matches.has(paper.id) })}
              expanded={paper.id === openId}
              cardId={cardId}
              onActivate={onActivate}
              onFocusSpine={onFocusBook}
            />
          ))}
          {/* Inside the row, sticky at its right edge: the scrolling region keeps a control
              Tab reaches (axe: scrollable-region-focusable) and the bookend stays in view. */}
          {after > 0 ? (
            <button
              type="button"
              className="pt-rows__more"
              data-row-more=""
              aria-label={moreName(group, after, matchesHere)}
              onClick={showMore}
            >
              <span className="pt-rows__card" aria-hidden="true">
                <span className="pt-rows__count">+{after}</span>
                {matchesHere === null ? 'more' : matchesWords(matchesHere)}
                <ChevronRight size={18} strokeWidth={1.5} />
              </span>
            </button>
          ) : null}
        </div>
        <span className="pt-rows__holder">
          <PlankHolder name={group.label} count={group.papers.length} />
        </span>
        {after > 0 ? (
          <span className="pt-rows__shown">
            {shown} of {group.papers.length} shown · scroll sideways
          </span>
        ) : null}
      </ShelfPlank>
    </div>
  );
});
