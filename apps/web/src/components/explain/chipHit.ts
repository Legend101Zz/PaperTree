/**
 * explain/chipHit — which citation chip a tap meant, when two chips on neighbouring text lines
 * have hit areas (the pill plus 6 px above and below, 4 px at the sides) that overlap.
 *
 * The browser gives a tap in the overlap to whichever chip is later in the document, which can be
 * the farther one. The right answer is the chip whose own pill is nearest the finger; ties go to
 * the chip whose centre is nearest.
 */

export interface ChipRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The padding the stylesheet adds around a pill to make its tap target (`.pt-chip::after`). */
export const CHIP_SLACK = { x: 4, y: 6 } as const;

function gap(rect: ChipRect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

function centreDistance(rect: ChipRect, x: number, y: number): number {
  return Math.hypot((rect.left + rect.right) / 2 - x, (rect.top + rect.bottom) / 2 - y);
}

/** Index of the chip the point at (x, y) belongs to, or -1 when it is outside every hit area. */
export function nearestChip(rects: readonly ChipRect[], x: number, y: number): number {
  let best = -1;
  let bestGap = Infinity;
  let bestCentre = Infinity;
  rects.forEach((rect, index) => {
    const inside =
      x >= rect.left - CHIP_SLACK.x &&
      x <= rect.right + CHIP_SLACK.x &&
      y >= rect.top - CHIP_SLACK.y &&
      y <= rect.bottom + CHIP_SLACK.y;
    if (!inside) return;
    const g = gap(rect, x, y);
    const c = centreDistance(rect, x, y);
    if (g < bestGap || (g === bestGap && c < bestCentre)) {
      best = index;
      bestGap = g;
      bestCentre = c;
    }
  });
  return best;
}
