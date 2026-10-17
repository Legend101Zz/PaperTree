'use client';

/**
 * useMeasuredHeight — an element's rendered height in layout units, kept current by a
 * ResizeObserver (S5c, #208: the open exchange pushes what is below it down; moved out of
 * `NotebookPage` by S5d). A scale transform on an ancestor does not change it.
 */
import { useCallback, useRef, useState } from 'react';

/**
 * Measures the element the returned ref is given.
 *
 * @returns A callback ref and the element's height (null until measured).
 */
export function useMeasuredHeight(): [(el: HTMLElement | null) => void, number | null] {
  const [height, setHeight] = useState<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    if (el === null || typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.current.observe(el);
  }, []);
  return [ref, height];
}
