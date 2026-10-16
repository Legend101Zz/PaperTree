/**
 * useCardPlacement: measures where the open spine stands so the catalogue card can point at it
 * from the band above the shelf (#195). The arithmetic is `placeCard` (pure, tested); this hook
 * reads the two rectangles when the card opens, whenever the shelf's layout changes (Arrange by,
 * the filter, a paper arriving or leaving), and on resize and any scroll (the shelf scrolls
 * sideways).
 */
'use client';

import { useLayoutEffect, useState } from 'react';

import { placeCard } from '../model/shelf';

import type { RefObject } from 'react';

/** The card's widest; `library.css` gives `.pt-catalogue` the same `min(480px, 100%)`. */
const CARD_MAX_WIDTH = 480;

/**
 * The open card's placement.
 *
 * @param openId - The paper whose card is open, or null.
 * @param band - The band above the shelf the card is placed in.
 * @param layoutKey - Changes whenever the spines may have moved (their order and the arrangement).
 * @returns The card's left edge and pointer offset, or null when nothing is open.
 */
export function useCardPlacement(
  openId: string | null,
  band: RefObject<HTMLElement>,
  layoutKey: string,
): { readonly left: number; readonly pointer: number } | null {
  const [placement, setPlacement] = useState<{ left: number; pointer: number } | null>(null);
  useLayoutEffect(() => {
    if (openId === null) {
      setPlacement(null);
      return undefined;
    }
    const measure = (): void => {
      const host = band.current;
      const spine = document.querySelector(`[data-paper-id="${CSS.escape(openId)}"]`);
      if (host === null || spine === null) return;
      const box = host.getBoundingClientRect();
      const at = spine.getBoundingClientRect();
      setPlacement(placeCard(at.left + at.width / 2 - box.left, box.width, CARD_MAX_WIDTH));
    };
    // When the shelf re-lays itself out, bring the open book back into view in its sideways row
    // (only here: doing it on every scroll would fight the person scrolling away).
    document
      .querySelector(`[data-paper-id="${CSS.escape(openId)}"]`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [openId, band, layoutKey]);
  return placement;
}
