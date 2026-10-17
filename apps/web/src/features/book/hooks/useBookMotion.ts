/**
 * useBookMotion — runs the book's motion (`model/motion.ts`) with the Web Animations API, and says
 * whether the reader asked for less motion. Where `element.animate` is missing (a test DOM, an old
 * engine) every step resolves at once: the book still opens and closes, only without the motion.
 */
'use client';

import { useEffect, useState } from 'react';

import { prefersReducedMotion } from '@/components/reader/flash';

import type { Motion } from '../model/motion';

/**
 * Plays one motion on an element.
 *
 * It settles when the animation finishes OR is cancelled, so a caller that acts afterwards must
 * check that its moment is still current (#200 review B1: an opening swing cancelled by Esc).
 *
 * @param element - The element, or null (nothing to animate).
 * @param motion - Its keyframes and timing.
 * @param running - Where the running animation is kept while it plays, so it can be cancelled.
 * @returns A promise that settles when it has finished (or was cancelled).
 */
export function play(
  element: Element | null,
  motion: Motion | null,
  running?: Set<Animation>,
): Promise<void> {
  if (element === null || motion === null || typeof element.animate !== 'function') {
    return Promise.resolve();
  }
  const animation = element.animate(motion.keyframes, motion.options);
  running?.add(animation);
  const settle = (): void => {
    running?.delete(animation);
  };
  return animation.finished.then(settle, settle);
}

/**
 * Cancels every animation in `running` (each one's `finished` then settles) and forgets them.
 *
 * @param running - The animations `play` is tracking.
 */
export function cancelAll(running: Set<Animation>): void {
  for (const animation of [...running]) animation.cancel();
  running.clear();
}

/**
 * `prefers-reduced-motion: reduce`, kept current.
 *
 * @returns True while the reader asks for less motion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}
