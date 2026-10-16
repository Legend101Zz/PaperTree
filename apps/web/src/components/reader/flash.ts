/**
 * reader/flash — the citation flash's clock (DESIGN.md §6, #202). Three phases, one mechanism:
 * `scroll` (240 ms, only when the passage is off screen: nothing is painted yet) → `flash` (the
 * ring and wash: in 180 → hold 900 → out 600, the `--pt-dur-flash-*` keyframes, which start when
 * this phase does) → `linger` (a faint outline, `data-flash="linger"`) until the next action. The
 * margin tab "from marker n" shows in `flash` and `linger`. Reduced motion: the scroll jumps, and
 * the ring and wash stay in `flash` until the next action. The TS durations mirror the tokens for
 * the timers and the scroll tween, which cannot read a custom property.
 */
import { useEffect } from 'react';

/** in + hold + out: when the flash settles into its faint outline. */
export const FLASH_MS = 180 + 900 + 600;

/** The scroll that brings an off-screen passage into view before the flash starts. */
export const FLASH_SCROLL_MS = 240;

/** Where a flash is in its timeline. */
export type FlashPhase = 'scroll' | 'flash' | 'linger';

/** The reader asked for less motion: no tween, no fade. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * The phase that follows `phase`, and after how many ms; null when it stays until the next action
 * (`linger`, or `flash` under reduced motion).
 */
export function nextFlashPhase(
  phase: FlashPhase,
  scrollMs: number,
  reduced: boolean,
): { readonly phase: FlashPhase; readonly afterMs: number } | null {
  if (phase === 'scroll') return { phase: 'flash', afterMs: scrollMs };
  if (phase === 'flash' && !reduced) return { phase: 'linger', afterMs: FLASH_MS };
  return null;
}

const tweens = new WeakMap<HTMLElement, () => void>();

/**
 * Scroll an element to `top`/`left` over `ms` with an ease-out, on requestAnimationFrame (a CSS
 * `smooth` scroll has no duration, and the flash must start when the passage arrives). A new
 * tween on the same element cancels the one running, so two quick flashes never fight over the
 * scroll. Instant under reduced motion or for `ms <= 0`.
 */
export function tweenScroll(el: HTMLElement, top: number, left: number, ms: number): void {
  tweens.get(el)?.();
  tweens.delete(el);
  if (ms <= 0 || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    el.scrollTo({ top, left, behavior: 'auto' });
    return;
  }
  const fromTop = el.scrollTop;
  const fromLeft = el.scrollLeft;
  const start = performance.now();
  let frame = 0;
  const step = (now: number): void => {
    const t = Math.min(1, Math.max(0, (now - start) / ms));
    const eased = 1 - (1 - t) ** 3;
    el.scrollTo({
      top: fromTop + (top - fromTop) * eased,
      left: fromLeft + (left - fromLeft) * eased,
      behavior: 'auto',
    });
    if (t < 1) frame = requestAnimationFrame(step);
    else tweens.delete(el);
  };
  frame = requestAnimationFrame(step);
  tweens.set(el, () => cancelAnimationFrame(frame));
}

/**
 * Run `clear` on the reader's next action (a pointer press or a key, anywhere) while `active`:
 * the flash's faint outline and margin tab stay until then (DESIGN.md §6). CAPTURE phase: a key
 * or click on another marker clears this flash before that marker's own handler starts the next
 * one; in the bubble phase the document would hear it last and clear the new flash.
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
