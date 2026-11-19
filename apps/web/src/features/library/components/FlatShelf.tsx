/**
 * FlatShelf: the phone's shelf (#199, frame 08a, DESIGN.md §10): the books lying flat, a stack per
 * row of the arrangement under its brass holder, on a strip of walnut. One toolbar and one tab stop,
 * as with the spines: ↓/↑ (and →/←) walk every book in order, down a stack and into the next, Home
 * and End jump to the ends, Enter or a tap takes a book off the stack and opens it.
 */
'use client';

import { LabelHolder, paperCountLabel } from '@papertree/ui';
import { useMemo } from 'react';

import { useRovingShelf } from '../hooks/useRovingShelf';
import { flatStep } from '../model/phone';
import { arrangeShelf } from '../model/shelf';
import { FlatBook } from './FlatBook';

import type { ShelfProps } from './Shelf';
import type { ReactNode } from 'react';

/**
 * The flat stacks; they take the `Shelf`'s props.
 *
 * @example
 * <FlatShelf papers={books} arrangement="topic" matches={null} onActivate={open} />
 */
export function FlatShelf({
  papers,
  arrangement,
  matches,
  onActivate,
  focus,
}: ShelfProps): ReactNode {
  const groups = useMemo(() => arrangeShelf(papers, arrangement), [papers, arrangement]);
  const order = useMemo(() => groups.flatMap((g) => g.papers.map((p) => p.id)), [groups]);
  const { toolbar, stop, onFocusBook, onKeyDown } = useRovingShelf(order, focus, flatStep);
  return (
    <div
      ref={toolbar}
      role="toolbar"
      aria-label="Shelf"
      aria-orientation="vertical"
      className="pt-flatshelf"
      data-searching={matches === null ? undefined : 'true'}
      onKeyDown={onKeyDown}
    >
      {groups.map((group) => (
        <div
          key={group.key}
          role="group"
          aria-label={`${group.label}, ${paperCountLabel(group.papers.length)}`}
          className="pt-flatshelf__stack"
        >
          {/* The group's name already reaches assistive technology; the holder is the picture. */}
          <span className="pt-flatshelf__holder" aria-hidden="true">
            <LabelHolder name={group.label} count={group.papers.length} />
          </span>
          <div className="pt-flatshelf__books">
            {group.papers.map((paper) => (
              <FlatBook
                key={paper.id}
                paper={paper}
                tabIndex={paper.id === stop ? 0 : -1}
                {...(matches === null ? {} : { match: matches.has(paper.id) })}
                onActivate={onActivate}
                onFocusBook={onFocusBook}
              />
            ))}
          </div>
          <span className="pt-flatshelf__wood" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
