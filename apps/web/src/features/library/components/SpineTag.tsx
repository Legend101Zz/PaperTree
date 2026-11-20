/**
 * SpineTag: the paper tag a spine shows when you hover it (v0.3 R4, frame V3-34): the full title
 * over "He et al. · 2015 · 12 pages · not started". A title set sideways on a spine is hard to
 * read, and the spine's name already tells a screen reader all of this, so the tag is for the
 * eyes only. One tag for the whole shelf, drawn over the page (fixed), so a plank that scrolls
 * sideways never clips it.
 */
'use client';

import { useCallback, useState } from 'react';

import { spineTag, type ShelfPaper } from '../model/shelf';

import type { MouseEvent, ReactNode } from 'react';

/** The tag's width at most, and half of it: how close to a window edge its middle may sit. */
const TAG_MAX_WIDTH = 330;
const EDGE = TAG_MAX_WIDTH / 2 + 8;
/** A hovered spine lifts 14 px (`library.css`); the tag stands 4 px above that. */
const ABOVE_LIFTED_SPINE = 18;

/** Where the tag stands: above the middle of the spine it names. */
interface Placed {
  readonly paper: ShelfPaper;
  readonly x: number;
  readonly y: number;
}

/** What `useSpineTag` gives the shelf. */
export interface SpineTagControl {
  /** The tag to draw, or null. */
  readonly tag: ReactNode;
  /** Hand these to the shelf's container. */
  readonly onMouseOver: (event: MouseEvent<HTMLElement>) => void;
  readonly onMouseOut: (event: MouseEvent<HTMLElement>) => void;
  /** Focus leaving the shelf takes the tag away too; so does opening a book (it would linger
   *  under the veil, and come back with the spine). */
  readonly hide: () => void;
}

/**
 * The tag for whichever spine the pointer is over.
 *
 * @param papers - The books on the shelf.
 * @returns The tag element and the handlers to put on the shelf.
 */
export function useSpineTag(papers: readonly ShelfPaper[]): SpineTagControl {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const onMouseOver = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const spine =
        event.target instanceof Element ? event.target.closest('[data-paper-id]') : null;
      const paper = papers.find((p) => p.id === spine?.getAttribute('data-paper-id'));
      if (spine === null || paper === undefined) return;
      const box = spine.getBoundingClientRect();
      const middle = box.left + box.width / 2;
      const x = Math.max(EDGE, Math.min(middle, window.innerWidth - EDGE));
      setPlaced({ paper, x, y: box.top - ABOVE_LIFTED_SPINE });
    },
    [papers],
  );
  const onMouseOut = useCallback((event: MouseEvent<HTMLElement>) => {
    // Moving between two spines is an out and an over: the next over replaces the tag.
    if (
      !(event.relatedTarget instanceof Element) ||
      !event.relatedTarget.closest('[data-paper-id]')
    ) {
      setPlaced(null);
    }
  }, []);
  const tag = placed === null ? null : <SpineTag paper={placed.paper} x={placed.x} y={placed.y} />;
  const hide = useCallback(() => setPlaced(null), []);
  return { tag, onMouseOver, onMouseOut, hide };
}

/** The tag itself. */
function SpineTag({
  paper,
  x,
  y,
}: {
  readonly paper: ShelfPaper;
  readonly x: number;
  readonly y: number;
}): ReactNode {
  const { title, line } = spineTag(paper);
  return (
    <div className="pt-spinetag" aria-hidden="true" data-spine-tag="" style={{ left: x, top: y }}>
      <b className="pt-spinetag__title">{title}</b>
      <span className="pt-spinetag__line">{line}</span>
    </div>
  );
}
