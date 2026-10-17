'use client';

/**
 * usePageScale — screen px per page unit for the desk the page sits on (S5c, #208). The page is
 * 960 units wide whatever the window (`page.ts`); only this one factor changes, so a resize never
 * moves ink against the notes beside it. At 1440 px with the side panel it is about 1.08, the
 * frame's 1080 px page.
 */
import { useEffect, useState } from 'react';

import { BINDING } from '../model/layout';
import { PAGE_WIDTH } from '../model/page';

import type { RefObject } from 'react';

/** The desk's gutter on each side of the page, in screen px. */
const GUTTER = 24;
const MIN_SCALE = 0.5;
const MAX_SCALE = 1.125;

/**
 * The scale for a desk width.
 *
 * @param deskWidth - The desk's inner width in screen px.
 * @returns Screen px per page unit, clamped to [0.5, 1.125].
 */
export function scaleFor(deskWidth: number): number {
  const s = (deskWidth - 2 * GUTTER - BINDING) / PAGE_WIDTH;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * Tracks the desk's width and returns the page scale.
 *
 * @param desk - The element the page is centred in.
 * @returns The current scale (1 until the desk has been measured).
 */
export function usePageScale(desk: RefObject<HTMLElement>): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = desk.current;
    if (el === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setScale(scaleFor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [desk]);
  return scale;
}
