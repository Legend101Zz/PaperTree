'use client';

/**
 * Opening a painted highlight's card by mouse (#176), out of `SourcePane`. The highlight layer is
 * not a pointer target (a drag that starts on highlighted words must still select them), so the
 * page listens for clicks and decides here: `isHighlightClick` says whether the press was a click,
 * and `hitsItem` whether it landed on a highlight's stored quads (IR space).
 */
import { useEffect, useRef } from 'react';

import { hitsItem, type PaintItem } from '@/components/reader/HighlightOverlay';

import { isHighlightClick } from '../model/highlightClick';

/** Where the card opens: the click, and the passage's top and bottom on screen. */
export interface CardAt {
  readonly clientX: number;
  readonly clientY: number;
  readonly top: number;
  readonly bottom: number;
}

/** What `useHighlightClick` needs. */
export interface UseHighlightClickArgs {
  /** The scroller that holds the pages, or null before it mounts. */
  readonly root: HTMLElement | null;
  readonly items: readonly PaintItem[];
  readonly zoom: number;
  /** A page's `/UserUnit`, which scales IR points with the zoom. */
  readonly userUnitOf: (pageIndex: number) => number;
  readonly onActivate: (highlightId: string, at: CardAt) => void;
}

/**
 * Listen on the pages for clicks on painted highlights.
 *
 * @param args - The scroller, the painted items, the zoom and what to do with a hit.
 */
export function useHighlightClick(args: UseHighlightClickArgs): void {
  const latest = useRef(args);
  latest.current = args;
  const { root } = args;

  useEffect(() => {
    if (root === null) return undefined;
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent): void => {
      down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    };
    const onClick = (event: MouseEvent): void => {
      const press = { down, up: { x: event.clientX, y: event.clientY } };
      down = null;
      if (!isHighlightClick({ ...press, detail: event.detail, shiftKey: event.shiftKey })) return;
      const target = event.target instanceof Element ? event.target : null;
      const page = target?.closest('.papertree-page[data-page-index]');
      if (!(page instanceof HTMLElement)) return;
      const { items, zoom, userUnitOf, onActivate } = latest.current;
      const pageIndex = Number(page.getAttribute('data-page-index'));
      const scale = zoom * userUnitOf(pageIndex);
      if (!(scale > 0)) return;
      const rect = page.getBoundingClientRect();
      const x = (event.clientX - rect.left) / scale;
      const y = (event.clientY - rect.top) / scale;
      const hit = [...items]
        .reverse()
        .find((item) => item.pageIndex === pageIndex && hitsItem(item, x, y));
      if (hit === undefined) return;
      // The characters a hand's jitter selected on the way are not a selection (#176).
      window.getSelection()?.removeAllRanges();
      // The passage's own top and bottom on screen, so its card opens beside it, not over it.
      const quads = items
        .filter((item) => item.highlightId === hit.highlightId && item.pageIndex === pageIndex)
        .flatMap((item) => item.quads);
      onActivate(hit.highlightId, {
        clientX: event.clientX,
        clientY: event.clientY,
        top: rect.top + Math.min(...quads.map((q) => q[1])) * scale,
        bottom: rect.top + Math.max(...quads.map((q) => q[3])) * scale,
      });
    };
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('click', onClick);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('click', onClick);
    };
  }, [root]);
}
