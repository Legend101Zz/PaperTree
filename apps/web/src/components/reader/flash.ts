/**
 * reader/flash — the citation flash's clock (DESIGN.md §6, #202): scroll 240 ms if needed → in
 * 180 → hold 900 → out 600, then a faint outline that stays until the next action. The CSS reads
 * the same values from `--pt-dur-flash-*`; these are for the timers and the scroll tween, which
 * cannot read a custom property. Reduced motion: the scroll jumps and the ring and wash simply
 * appear, then clear on the next action.
 */
import { useEffect } from 'react';

/** in + hold + out: when the flash has settled into its faint outline. */
export const FLASH_MS = 180 + 900 + 600;

/** The scroll that brings an off-screen passage into view before the flash starts. */
export const FLASH_SCROLL_MS = 240;

/** The reader asked for less motion: no tween, no fade. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Scroll an element to `top`/`left` over `ms` with an ease-out, on requestAnimationFrame (a CSS
 * `smooth` scroll has no duration, and the flash must start when the passage arrives). Instant
 * under reduced motion or for `ms <= 0`.
 */
export function tweenScroll(el: HTMLElement, top: number, left: number, ms: number): void {
  const fromTop = el.scrollTop;
  const fromLeft = el.scrollLeft;
  if (ms <= 0 || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    el.scrollTo({ top, left, behavior: 'auto' });
    return;
  }
  const start = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3;
    el.scrollTo({
      top: fromTop + (top - fromTop) * eased,
      left: fromLeft + (left - fromLeft) * eased,
      behavior: 'auto',
    });
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Run `clear` on the reader's next action (a pointer press or a key, anywhere) while `active`:
 * the flash's faint outline and margin tab stay until then (DESIGN.md §6). Capture phase, so a
 * press on another marker clears this flash before it starts the next one.
 */
export function useClearOnNextAction(active: boolean, clear: () => void): void {
  useEffect(() => {
    if (!active) return undefined;
    document.addEventListener('pointerdown', clear, true);
    document.addEventListener('keydown', clear, true);
    return () => {
      document.removeEventListener('pointerdown', clear, true);
      document.removeEventListener('keydown', clear, true);
    };
  }, [active, clear]);
}
