'use client';

/**
 * useDiveArrival — the page's half of Dive in (S5e, #210, frame 11). A page opened by a Dive in
 * waits hidden until it is drawn and has stopped changing size, then slides in from the right for the rest of
 * `--pt-dur-open` while each card the panel showed flies from its panel box to its place (FLIP,
 * `model/diveIn`); with reduced motion it fades in over `--pt-dur-quick` and nothing travels. A page
 * opened any other way (a link, a reload) just appears.
 */
import { useEffect, useState } from 'react';

import { cardsIn, diveHandoff, readMotion } from './useDiveIn';
import { flipTransform, pairFlights } from '../model/diveIn';

import type { DiveHandoff } from '../model/diveIn';
import type { RefObject } from 'react';

/** A page that never finishes loading is shown as it is after this long, never kept hidden. */
const GIVE_UP_MS = 4_000;

/**
 * Runs the slide (or the fade) on the screen that just arrived.
 *
 * @param root - The notebook screen; its `[data-dive-page]` is the page that slides.
 * @param hand - The panel's cards.
 * @param scale - The page layer's scale.
 */
function play(root: HTMLElement, hand: DiveHandoff, scale: number): void {
  const motion = readMotion();
  const page = root.querySelector<HTMLElement>('[data-dive-page]');
  if (page === null || typeof page.animate !== 'function') return;
  if (motion.fadeMs > 0) {
    // The desk, which waited unseen; the bar above it was never hidden, so it must not blink.
    const desk = root.querySelector<HTMLElement>('.pt-nb__desk') ?? page;
    desk.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motion.fadeMs, easing: 'linear' });
    return;
  }
  const easing = getComputedStyle(root).getPropertyValue('--pt-ease-lift').trim() || 'ease-out';
  const timing = { duration: motion.slideMs, easing };
  // Measured where they settle, so before the page is moved off to the right.
  const cards = cardsIn(page, '[data-passage]', 'data-passage');
  const flights = pairFlights(hand.cards, cards, window.innerWidth, window.innerHeight);
  const slideX = Math.max(0, window.innerWidth - page.getBoundingClientRect().left);
  page.animate([{ transform: `translateX(${String(slideX)}px)` }, { transform: 'none' }], timing);
  for (const f of flights) {
    cards
      .find((c) => c.key === f.key)
      ?.el.animate([{ transform: flipTransform(f, slideX, scale) }, { transform: 'none' }], timing);
  }
}

/**
 * Plays Dive in's arrival once the page is ready.
 *
 * @param pageId - The page on screen.
 * @param ready - True once the page and its items are drawn.
 * @param scale - The page's scale; a change before the first frame restarts the wait, so the cards
 *   are measured where they settle.
 * @param root - The notebook screen.
 * @returns True while the page waits hidden for its entrance (`data-dive="arriving"`).
 */
export function useDiveArrival(
  pageId: string,
  ready: boolean,
  scale: number,
  root: RefObject<HTMLElement>,
): boolean {
  const [arriving, setArriving] = useState(() => diveHandoff.waiting(pageId, Date.now()));
  useEffect(() => {
    if (!arriving) return undefined;
    const giveUp = window.setTimeout(() => setArriving(false), GIVE_UP_MS);
    return () => window.clearTimeout(giveUp);
  }, [arriving]);
  useEffect(() => {
    const page = root.current?.querySelector('[data-dive-page]') ?? null;
    if (!arriving || !ready || page === null) return undefined;
    let frame = 0;
    const start = (): void => {
      const hand = diveHandoff.take(pageId, Date.now());
      if (hand !== null && root.current !== null) play(root.current, hand, scale);
      setArriving(false);
    };
    // The page settles over a frame or two after it is drawn (the opened answer's measured height
    // moves the cards below it), so it starts two frames after the page last changed size.
    const later = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(start);
      });
    };
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    resized?.observe(page);
    later();
    return () => {
      resized?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [arriving, ready, scale, pageId, root]);
  return arriving;
}
