/**
 * useElementWidth: an element's content width, kept current (#196). The face-out shelf cuts its
 * covers into planks by how many fit (`coversPerRow`), which CSS wrapping cannot do: each plank is
 * its own piece of furniture with its captions under it.
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
