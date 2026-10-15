/**
 * reader/scrollHold — an action in the selection toolbar must not move the page.
 *
 * RFIX2 R2. In a real Chrome, pressing Highlight scrolled the reader by 100-300 px (DDPM, 25 pages,
 * scale 1.25, devicePixelRatio 2: scrollTop 3908 -> 4108, then 4108 -> 4443) while the scroller
 * element, its saved position and the reading state were all unchanged. Nothing in the reader
 * scrolls programmatically at that moment (`e2e/rfix/no-scroll-on-highlight.spec.ts` wraps every
 * scroll and focus API and sees none, in a headless Chrome 153 at the same size, scale and device
 * pixel ratio), so the cause lives in the browser's own handling of a press inside a focusable
 * scroller (which the drag that made the selection has already focused) and it could not be reproduced
 * under Playwright (headless and headed Chrome 153). This is the guard that does not depend on knowing it: for a short
 * window after the action, a scroll the READER did not ask for is put straight back, before the
 * next paint.
 *
 * Used by Highlight, Send to canvas and Copy. Not by Ask: the explain panel opens beside the paper,
 * and the page list repositions the paper for the new width on purpose.
 *
 * "The reader asked for it" is any wheel, touch, key or press after the action; the first of those
 * ends the hold. So does a scroll the page list itself makes (`releaseScrollHold`), a change in the
 * scroller's size, and the clock. Scroll events are delivered before the frame is painted, so
 * the correction is never seen.
 */

/** Long enough for the create to land and the page to re-render; short enough never to be felt. */
export const HOLD_SCROLL_MS = 1500;

const USER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

const active = new WeakMap<HTMLElement, () => void>();

/**
 * End the hold on `scroller`, if any. The page list calls it before every scroll of its OWN making
 * (restoring a position after a zoom or a resize, a jump to a block or a page): a reader's
 * "go there" is never the stray move the hold is for.
 */
export function releaseScrollHold(scroller: HTMLElement | null): void {
  if (scroller !== null) active.get(scroller)?.();
}

/**
 * Keep `scroller` where it is now until the reader moves it, the page list repositions it, its box
 * changes size, or `ms` pass. Returns a release.
 */
export function holdScroll(scroller: HTMLElement | null, ms: number = HOLD_SCROLL_MS): () => void {
  if (scroller === null) return () => undefined;
  releaseScrollHold(scroller);
  const top = scroller.scrollTop;
  const left = scroller.scrollLeft;
  let released = false;
  let observer: ResizeObserver | null = null;
  const onScroll = (): void => {
    if (scroller.scrollTop !== top) scroller.scrollTop = top;
    if (scroller.scrollLeft !== left) scroller.scrollLeft = left;
  };
  const release = (): void => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    active.delete(scroller);
    observer?.disconnect();
    scroller.removeEventListener('scroll', onScroll);
    for (const type of USER_INPUT) window.removeEventListener(type, release, true);
  };
  const timer = setTimeout(release, ms);
  active.set(scroller, release);
  scroller.addEventListener('scroll', onScroll);
  for (const type of USER_INPUT) window.addEventListener(type, release, { capture: true, passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    // A change of the scroller's own size (a panel opening, a window resize) repositions the paper
    // on purpose; the first callback is the observation itself, not a change.
    let first = true;
    observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      release();
    });
    observer.observe(scroller);
  }
  return release;
}
