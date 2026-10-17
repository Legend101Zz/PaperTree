'use client';

/**
 * useLayoutMode — which of the notebook's three layouts the window is in (S5e, #210), following it
 * as it turns or is resized. The rule and the breakpoints are `model/layoutMode`'s.
 */
import { useEffect, useState } from 'react';

import { LAYOUT_QUERIES, type LayoutMode } from '../model/layoutMode';

/** The layout now; the desktop on the server and wherever media queries cannot be asked. */
function current(): LayoutMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  if (window.matchMedia(LAYOUT_QUERIES.desktop).matches) return 'desktop';
  return window.matchMedia(LAYOUT_QUERIES.tablet).matches ? 'tablet' : 'phone';
}

/**
 * The notebook's layout for this window, kept current.
 *
 * @returns `phone`, `tablet` or `desktop`.
 */
export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(current);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const lists = [LAYOUT_QUERIES.desktop, LAYOUT_QUERIES.tablet].map((q) => window.matchMedia(q));
    const follow = (): void => setMode(current());
    follow();
    for (const l of lists) l.addEventListener('change', follow);
    return () => {
      for (const l of lists) l.removeEventListener('change', follow);
    };
  }, []);
  return mode;
}
