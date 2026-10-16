/**
 * Shelf: the library's books on one walnut plank, a row per group (#195, DESIGN.md §1 and §6).
 * One tab stop (a roving-tabindex toolbar): ←/→ walk along the shelf, Home and End jump to its
 * ends, Enter or a click takes a book down. A search dims what does not match and lights what
 * does, in place: the order never changes while you type.
 */
'use client';

import { paperCountLabel } from '@papertree/ui';
import { useCallback, useMemo, useRef, useState } from 'react';

import { arrangeShelf, shelfStep, type Arrangement, type ShelfPaper } from '../model/shelf';
import { ShelfPlank, PlankHolder } from './ShelfPlank';
import { Spine } from './Spine';

import type { KeyboardEvent, ReactNode } from 'react';

/** Props for `Shelf`. */
export interface ShelfProps {
  readonly papers: readonly ShelfPaper[];
  readonly arrangement: Arrangement;
  /** The ids a search matched, or null when no search is active (`matchPapers`). */
  readonly matches: ReadonlySet<string> | null;
  /** The paper whose catalogue card is open. */
  readonly openId: string | null;
  /** The catalogue card's element id. */
  readonly cardId: string;
  /** A spine was clicked or Entered. */
  readonly onActivate: (paperId: string) => void;
}

/**
 * The shelf. Grouping, widths and states come from `model/shelf.ts`; this file only draws them and
 * moves focus.
 *
 * @example
 * <Shelf papers={papers} arrangement="topic" matches={null} openId={null} cardId="card" onActivate={open} />
 */
export function Shelf({
  papers,
  arrangement,
  matches,
  openId,
  cardId,
  onActivate,
}: ShelfProps): ReactNode {
  const toolbar = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const groups = useMemo(() => arrangeShelf(papers, arrangement), [papers, arrangement]);
  const order = useMemo(() => groups.flatMap((g) => g.papers.map((p) => p.id)), [groups]);
  // The tab stop: the spine that last had focus, else the open one, else the first. A deleted
  // paper's id falls through to the next rule, so the shelf never loses its tab stop.
  const stop =
    [focusedId, openId].find((id): id is string => id !== null && order.includes(id)) ??
    order[0] ??
    null;

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const next = shelfStep(stop === null ? 0 : order.indexOf(stop), event.key, order.length);
      const id = next === null ? undefined : order[next];
      if (id === undefined) return;
      event.preventDefault();
      setFocusedId(id);
      toolbar.current?.querySelector<HTMLElement>(`[data-paper-id="${CSS.escape(id)}"]`)?.focus();
    },
    [order, stop],
  );

  return (
    <ShelfPlank>
      <div
        ref={toolbar}
        role="toolbar"
        aria-label="Shelf"
        aria-orientation="horizontal"
        className="pt-shelf"
        data-searching={matches === null ? undefined : 'true'}
        onKeyDown={onKeyDown}
      >
        {groups.map((group) => (
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
                  expanded={paper.id === openId}
                  cardId={cardId}
                  onActivate={onActivate}
                  onFocusSpine={setFocusedId}
                />
              ))}
            </div>
            <PlankHolder name={group.label} count={group.papers.length} />
          </div>
        ))}
      </div>
    </ShelfPlank>
  );
}
