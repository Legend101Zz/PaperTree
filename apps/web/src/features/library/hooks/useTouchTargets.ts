/**
 * useTouchTargets: whether the library's chrome should use 44 px targets (#195 review). DESIGN.md
 * §2 and §10: touch targets are 44 px; the header, title row and hints draw at their desktop sizes
 * (36–40 px, frame 01) only on a wide screen with a fine pointer, and grow on a phone or a tablet.
 */
'use client';

import { useEffect, useState } from 'react';

/** Phone widths, and any coarse pointer (a tablet held in landscape is wide but a finger). */
export const TOUCH_QUERY = '(max-width: 900px), (pointer: coarse)';

/**
 * True on a phone or touch screen, kept current; false on the server and before mount.
 *
 * @returns Whether to size controls for touch.
 */
export function useTouchTargets(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(TOUCH_QUERY);
    const apply = (): void => setTouch(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return touch;
}
