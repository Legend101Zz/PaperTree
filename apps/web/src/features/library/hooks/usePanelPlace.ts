/**
 * usePanelPlace: where a Table row's authors popover or "…" menu sits (#197). Fixed to the
 * viewport from its button's rect, so the table's own sideways-scrolling region (on a phone)
 * cannot clip it: under the button, or over it when the viewport has no room below, and never
 * past the viewport's sides. It follows the button while the page or the table scrolls.
 */
'use client';

import { useLayoutEffect, useState } from 'react';

import type { CSSProperties, RefObject } from 'react';

/** A rect's edges, in viewport px (a `DOMRect` satisfies it). */
export interface Edges {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** A width and a height, in px. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

// Between the button and the panel, and between the panel and the viewport's edge.
const GAP = 8;
const MARGIN = 8;

/**
 * Where a panel goes beside its button.
 *
 * @param button - The button's rect.
 * @param panel - The panel's size.
 * @param viewport - The viewport's size.
 * @param align - `start`: the panel's left edge on the button's; `end`: right edge on right edge.
 * @returns The panel's top and left, in viewport px.
 * @example
 * placePanel({ top: 800, bottom: 844, left: 300, right: 344 }, { width: 180, height: 190 },
 *   { width: 390, height: 844 }, 'end'); // { top: 602, left: 164 }: over the button
 */
export function placePanel(
  button: Edges,
  panel: Size,
  viewport: Size,
  align: 'start' | 'end',
): { readonly top: number; readonly left: number } {
  const below = button.bottom + GAP;
  const above = button.top - GAP - panel.height;
  const fitsBelow = below + panel.height <= viewport.height - MARGIN;
  const top = fitsBelow || above < MARGIN ? below : above;
  const wanted = align === 'end' ? button.right - panel.width : button.left;
  const left = Math.max(MARGIN, Math.min(wanted, viewport.width - MARGIN - panel.width));
  return { top: Math.round(top), left: Math.round(left) };
}

/**
 * The panel's inline style while it is open.
 *
 * @param open - Whether the panel shows.
 * @param button - Its button.
 * @param panel - The panel.
 * @param align - Which edges line up (see `placePanel`).
 * @returns `position: fixed` with its top and left once measured, else undefined.
 */
export function usePanelPlace(
  open: boolean,
  button: RefObject<HTMLElement>,
  panel: RefObject<HTMLElement>,
  align: 'start' | 'end',
): CSSProperties | undefined {
  const [place, setPlace] = useState<{ readonly top: number; readonly left: number } | null>(null);
  // Before paint, so the panel is never drawn where the region would clip it.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = (): void => {
      const from = button.current;
      const node = panel.current;
      if (from === null || node === null) return;
      const next = placePanel(
        from.getBoundingClientRect(),
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: document.documentElement.clientWidth, height: window.innerHeight },
        align,
      );
      setPlace((was) => (was?.top === next.top && was.left === next.left ? was : next));
    };
    measure();
    // Capture: the table's own region scrolls too, and its scroll does not bubble.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, button, panel, align]);
  if (!open || place === null) return undefined;
  return { position: 'fixed', top: place.top, left: place.left, right: 'auto' };
}
