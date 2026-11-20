/**
 * Shelf: the library's books on walnut planks, a row per group (#195, DESIGN.md §1 and §6). The
 * groups flow left to right and wrap onto the next plank when one is full (`packPlanks`: nine books
 * stand as 6 + 3 on two planks at 1440 px, as the v0.3 prototype draws them). One tab stop (a roving-tabindex toolbar): ←/→ walk along the shelf, Home and End jump to its
 * ends, Enter, Space or a click takes a book off the shelf and opens it (v0.3 #337). A search dims what does not match and lights what
 * does, in place: the order never changes while you type.
 */
'use client';

import { paperCountLabel } from '@papertree/ui';
import { useMemo } from 'react';

import { useElementWidth } from '../hooks/useElementWidth';
import { useRovingShelf, type LiftedFocus } from '../hooks/useRovingShelf';
import { arrangeShelf, packPlanks, type Arrangement, type ShelfPaper } from '../model/shelf';
import { ShelfPlank, PlankHolder } from './ShelfPlank';
import { Spine } from './Spine';

import type { ReactNode } from 'react';

/** Props for `Shelf`. */
export interface ShelfProps {
  readonly papers: readonly ShelfPaper[];
  readonly arrangement: Arrangement;
  /** The ids a search matched, or null when no search is active (`matchPapers`). */
  readonly matches: ReadonlySet<string> | null;
  /** A spine was clicked, Entered or Spaced: take it off the shelf and open it. */
  readonly onActivate: (paperId: string) => void;
  /** The section's tab stop, so it survives a change of layout (#196). */
  readonly focus?: LiftedFocus;
}

/**
 * The shelf. Grouping, widths and states come from `model/shelf.ts`; this file only draws them and
 * moves focus.
 *
 * @example
 * <Shelf papers={papers} arrangement="topic" matches={null} onActivate={open} />
 */
export function Shelf({ papers, arrangement, matches, onActivate, focus }: ShelfProps): ReactNode {
  const groups = useMemo(() => arrangeShelf(papers, arrangement), [papers, arrangement]);
  const order = useMemo(() => groups.flatMap((g) => g.papers.map((p) => p.id)), [groups]);
  const { toolbar, stop, onFocusBook, onKeyDown } = useRovingShelf(order, focus);
  const width = useElementWidth(toolbar);
  // Groups flow along a plank and wrap onto the next when it is full; the arrows walk the whole
  // shelf in order, so ← and → carry on across the wrap.
  const planks = useMemo(() => packPlanks(groups, width), [groups, width]);

  return (
    <div
      ref={toolbar}
      role="toolbar"
      aria-label="Shelf"
      aria-orientation="horizontal"
      className="pt-planks"
      data-searching={matches === null ? undefined : 'true'}
      onKeyDown={onKeyDown}
    >
      {planks.map((plank, at) => (
        <ShelfPlank key={String(at)}>
          <div className="pt-shelf">
            {plank.map((group) => (
              <div
                key={group.key}
                role="group"
                aria-label={`${group.label}, ${paperCountLabel(group.papers.length)}`}
                className="pt-shelf__row"
              >
                <div className="pt-shelf__spines">
                  {group.papers.map((paper) => (
                    <Spine
                      key={paper.id}
                      paper={paper}
                      tabIndex={paper.id === stop ? 0 : -1}
                      {...(matches === null ? {} : { match: matches.has(paper.id) })}
                      onActivate={onActivate}
                      onFocusSpine={onFocusBook}
                    />
                  ))}
                </div>
                <PlankHolder name={group.label} count={group.papers.length} />
              </div>
            ))}
          </div>
        </ShelfPlank>
      ))}
    </div>
  );
}
