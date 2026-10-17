/**
 * Where ink sits while the open answer pushes the page down (S5d, #209). The open answer is taller
 * than its stored box by `extra` (`exchangeShift`), and everything below the box is SHOWN that much
 * lower. A stroke belongs to the layer it STARTS in: begun above the box's bottom (`boundary`) it
 * stays where it is, begun below it moves with the cards. That leaves one band with no stored place,
 * the `extra` the answer opened, [boundary, boundary + extra) as shown: a stroke cannot start there
 * (`inFold`), though it may pass through it. Pure: `NotebookPage` draws by it, the eraser and the
 * lasso hit-test by it, and `useInkInput` stores by it, so all four agree.
 */
import type { ExchangeShift } from './layout';
import type { Stroke, StrokePoint } from './stroke';

/**
 * A stroke's first point's y: what decides the layer it belongs to.
 *
 * @param stroke - The stroke.
 * @returns Its start's y in page units (0 for an empty stroke).
 */
export function startY(stroke: Stroke): number {
  return stroke.points[0]?.[1] ?? 0;
}

/**
 * Splits the strokes into the two layers `NotebookPage` draws: those that stay put and those the
 * open answer pushes down.
 *
 * @param strokes - The page's strokes, as stored.
 * @param boundary - The exchange box's bottom (`ExchangeShift.boundary`); null without an exchange.
 * @returns The strokes above the box's bottom and those below it, each in paint order.
 */
export function inkLayers(
  strokes: readonly Stroke[],
  boundary: number | null,
): { above: Stroke[]; below: Stroke[] } {
  const line = boundary ?? Infinity;
  return {
    above: strokes.filter((s) => startY(s) < line),
    below: strokes.filter((s) => startY(s) >= line),
  };
}

/**
 * The strokes where they are SHOWN, for anything that hit-tests what the person sees (the eraser,
 * the lasso). Ids are unchanged, so a hit maps back to the stored stroke.
 *
 * @param strokes - The page's strokes, as stored.
 * @param shift - The exchange's push.
 * @returns The strokes as shown (the same array when nothing moves).
 */
export function strokesAsShown(
  strokes: readonly Stroke[],
  shift: ExchangeShift | null,
): readonly Stroke[] {
  if (shift === null || shift.extra <= 0) return strokes;
  const { boundary, extra } = shift;
  return strokes.map((s) =>
    startY(s) >= boundary
      ? { ...s, points: s.points.map(([x, y, p]) => [x, y + extra, p] as const) }
      : s,
  );
}

/**
 * Whether a point as shown lies in the band the open answer opened, where no stroke can start.
 *
 * @param y - A shown y, in page units.
 * @param shift - The exchange's push.
 * @returns True inside [boundary, boundary + extra) while the answer is open.
 */
export function inFold(y: number, shift: ExchangeShift | null): boolean {
  return (
    shift !== null && shift.extra > 0 && y >= shift.boundary && y < shift.boundary + shift.extra
  );
}

/**
 * The points to store for a stroke drawn as shown: one begun below the band moves up by `extra`,
 * so it sits beside its card once the answer closes and is drawn back where it was while open.
 *
 * @param points - The points as drawn, in page units as shown.
 * @param shift - The exchange's push.
 * @returns The points to store, or null for a stroke that starts in the band (`inFold`).
 * @example
 * // boundary 300, extra 200: drawn starting at y 600 → stored from y 400; at y 350 → null.
 */
export function storedPoints(
  points: readonly StrokePoint[],
  shift: ExchangeShift | null,
): readonly StrokePoint[] | null {
  const start = points[0]?.[1];
  if (start === undefined) return points;
  if (inFold(start, shift)) return null;
  const dy = shift !== null && shift.extra > 0 && start >= shift.boundary ? shift.extra : 0;
  return dy === 0 ? points : points.map(([x, y, p]) => [x, y - dy, p] as const);
}
