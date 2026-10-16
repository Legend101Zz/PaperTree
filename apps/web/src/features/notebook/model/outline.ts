/**
 * Stroke -> SVG path (S5b, #207). Wraps `perfect-freehand` (pinned 1.2.3, ADR-004 s3) with explicit
 * per-nib options: its README and its code disagree on the defaults for `size` (8 vs 16) and
 * `last` (true vs false), so we set both ourselves (RESEARCH-R2 section 2). Paths are derived
 * data: render once, cache the `d` string, never store it.
 */

import { getStroke, type StrokeOptions } from 'perfect-freehand';

import { NIB_DIAMETER, type Stroke } from './stroke';

/**
 * perfect-freehand options for a stroke.
 *
 * @param stroke - The stroke being drawn.
 * @param live - True while the pen is still down: `last: false` lets the tail lag the pen, which
 *   is smoother; a committed stroke uses `last: true` so it reaches the final point.
 * @returns Options with `size` and `last` always set.
 */
export function strokeOptions(stroke: Stroke, live = false): StrokeOptions {
  const size = NIB_DIAMETER[stroke.tool][stroke.nib];
  const base = { size, last: !live, simulatePressure: !stroke.hasPressure };
  if (stroke.tool === 'highlighter') {
    // Constant width, never simulated: a marker does not taper.
    return { ...base, simulatePressure: false, thinning: 0, smoothing: 0.5, streamline: 0.4 };
  }
  return { ...base, thinning: 0.5, smoothing: 0.5, streamline: live ? 0.4 : 0.3 };
}

/**
 * The outline polygon of a stroke.
 *
 * @param stroke - The stroke.
 * @param live - See `strokeOptions`.
 * @returns Outline vertices in page units; never empty for a stroke with at least one point.
 */
export function strokeOutline(stroke: Stroke, live = false): number[][] {
  if (stroke.points.length === 0) return [];
  const outline = getStroke(
    stroke.points.map((p) => [p[0], p[1], p[2]]),
    strokeOptions(stroke, live),
  );
  return outline.length >= 3 ? outline : dotOutline(stroke);
}

/**
 * A diamond the size of the nib at the stroke's first point: what we draw if the library ever
 * returns fewer than 3 vertices, so a stroke is never invisible. Not reached today (every probe
 * gives 40+ vertices), so it is exported to be tested directly.
 *
 * @param stroke - A stroke with at least one point.
 * @returns Four vertices.
 */
export function dotOutline(stroke: Stroke): number[][] {
  const [x, y] = stroke.points[0]!;
  const r = NIB_DIAMETER[stroke.tool][stroke.nib] / 2;
  return [
    [x - r, y],
    [x, y - r],
    [x + r, y],
    [x, y + r],
  ];
}

/**
 * Turns an outline polygon into a closed SVG path of smoothed quadratic curves through the
 * midpoints of consecutive vertices.
 *
 * Adapted from the `getSvgPathFromStroke` example in the perfect-freehand README.
 *
 * MIT License
 *
 * Copyright (c) 2021 Stephen Ruiz Ltd
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 *
 * @param outline - Polygon vertices.
 * @returns A path `d` string ending in `Z`, or `''` for fewer than 3 vertices.
 */
export function outlineToPath(outline: readonly (readonly number[])[]): string {
  const len = outline.length;
  if (len < 3) return '';
  const f = (n: number): string => n.toFixed(2);
  const first = outline[0]!;
  // `M` the first vertex, then one `Q` whose repeated (control, midpoint) pairs run round the polygon.
  let d = `M${f(first[0]!)},${f(first[1]!)} Q`;
  for (let i = 0; i < len; i++) {
    const [x0, y0] = [outline[i]![0]!, outline[i]![1]!];
    const [x1, y1] = [outline[(i + 1) % len]![0]!, outline[(i + 1) % len]![1]!];
    d += `${f(x0)},${f(y0)} ${f((x0 + x1) / 2)},${f((y0 + y1) / 2)} `;
  }
  return `${d.trimEnd()} Z`;
}

/**
 * Convenience: stroke straight to a closed, filled SVG path (`fill` it, do not `stroke` it).
 *
 * @param stroke - The stroke.
 * @param live - See `strokeOptions`.
 * @returns The path `d` string; `''` only for a stroke with no points.
 */
export function strokeToPath(stroke: Stroke, live = false): string {
  return outlineToPath(strokeOutline(stroke, live));
}
