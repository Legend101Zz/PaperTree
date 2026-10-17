/** Test-only builders shared by the notebook model specs. Not exported from the feature. */

import type { Item } from './page';
import type { Stroke } from './stroke';

/**
 * Builds a pen stroke from `[x, y]` pairs with pressure 0.5.
 *
 * @param id - Stroke id.
 * @param pts - Points in page units.
 * @param over - Fields to override.
 * @returns The stroke.
 */
export function stroke(id: string, pts: [number, number][], over: Partial<Stroke> = {}): Stroke {
  return {
    id,
    tool: 'pen',
    nib: 'F',
    color: 'pen',
    hasPressure: true,
    points: pts.map(([x, y]) => [x, y, 0.5] as const),
    ...over,
  };
}

/**
 * Builds a sticky item at a rectangle.
 *
 * @param id - Item id.
 * @param x - Left.
 * @param y - Top.
 * @param w - Width.
 * @param h - Height.
 * @returns The item.
 */
export function sticky(id: string, x: number, y: number, w = 20, h = 20): Item {
  return { kind: 'sticky', id, x, y, w, h, z: 0, text: id, color: 'sticky-amber' };
}
