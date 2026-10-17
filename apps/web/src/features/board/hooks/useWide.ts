'use client';

/**
 * board/hooks/useWide — whether the screen is wider than a phone (the 640 px breakpoint), following
 * it as it turns. The legend folds and the minimap and the zoom tuck away below it (#212, #214).
 */
import { useEffect, useState } from 'react';

/** A screen wide enough for the board's strips and zoom to stay out: the phone breakpoint. */
const WIDE = '(min-width: 640px)';

/** True when the screen is wide (and on the server, where there is no screen to fold for). */
function wide(): boolean {
  return typeof window === 'undefined' || window.matchMedia(WIDE).matches;
}

/**
 * Whether the screen is wider than a phone, kept current.
 *
 * @returns True at 640 px and up.
 */
export function useWide(): boolean {
  const [isWide, setWide] = useState(wide);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const follow = (): void => setWide(query.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  return isWide;
}
