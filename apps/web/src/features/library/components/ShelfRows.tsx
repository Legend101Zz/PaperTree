/**
 * ShelfRows: a library at scale (#196, frame 01f, DESIGN.md §9: past about 40 spines). Each group
 * (topic, or the arrangement's row) stands on its own plank and scrolls sideways (`ShelfRow`). One
 * toolbar and one tab stop for the whole shelf, as with the spines and the covers: ←/→ walk every
 * book in order, into the overflow too; a row's "+n more" bookend is an ordinary tab stop.
 */
'use client';

import { useMemo } from 'react';

import { useRovingShelf } from '../hooks/useRovingShelf';
import { arrangeShelf } from '../model/shelf';
import { ShelfRow } from './ShelfRow';

import type { ShelfProps } from './Shelf';
import type { ReactNode } from 'react';

/**
 * The shelf at scale; it takes the `Shelf`'s props.
 *
 * @example
 * <ShelfRows papers={books} arrangement="topic" matches={null} openId={null} cardId="card"
 *   onActivate={takeDown} />
 */
export function ShelfRows({
  papers,
  arrangement,
  matches,
  openId,
  cardId,
  onActivate,
  onPutBack,
}: ShelfProps): ReactNode {
  const groups = useMemo(() => arrangeShelf(papers, arrangement), [papers, arrangement]);
  const order = useMemo(() => groups.flatMap((g) => g.papers.map((p) => p.id)), [groups]);
  const { toolbar, stop, onFocusBook, onKeyDown } = useRovingShelf(order, openId, onPutBack);
  return (
    <div
      ref={toolbar}
      role="toolbar"
      aria-label="Shelf"
      aria-orientation="horizontal"
      className="pt-rows"
      data-searching={matches === null ? undefined : 'true'}
      onKeyDown={onKeyDown}
    >
      {groups.map((group) => (
        <ShelfRow
          key={group.key}
          group={group}
          matches={matches}
          stop={stop}
          openId={openId}
          cardId={cardId}
          onActivate={onActivate}
          onFocusBook={onFocusBook}
        />
      ))}
    </div>
  );
}
