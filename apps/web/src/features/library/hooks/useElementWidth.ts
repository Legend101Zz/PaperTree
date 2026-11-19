/**
 * useElementWidth: an element's content width, kept current (#196). A sideways row at scale reads
 * how much room it has to say how many spines are in view (`rowWindow`), which CSS cannot say.
 */
'use client';

import { useLayoutEffect, useState } from 'react';

import type { RefObject } from 'react';

/**
 * The element's width in px; 0 before it is measured, or where `ResizeObserver` is missing.
 *
 * @param ref - The element to measure.
 * @returns Its content-box width.
 */
export function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
