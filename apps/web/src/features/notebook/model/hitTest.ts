/**
 * Lasso and eraser geometry for the notebook (S5b, #207), all in page units and all pure.
 * Ported from the tested R2 prototype (RESEARCH-R2 section 7): non-zero-winding polygon test,
 * Ramer-Douglas-Peucker thinning, bbox pre-filters. Strokes are selected when at least half their
 * points are inside the lasso; items when their centre is. v0.2 has a whole-stroke eraser only.
 */

import { NIB_DIAMETER, type Stroke } from './stroke';

import type { Item, Vec2 } from './page';

/** An axis-aligned box. */
export interface Bounds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** What a lasso picked up. */
export interface LassoSelection {
  readonly strokeIds: readonly string[];
  readonly itemIds: readonly string[];
}

/** Largest lasso thinning tolerance, in page units (about 2 px on a desktop page). */
export const MAX_LASSO_EPSILON = 2;

/** Segments shorter than this (page units) with both ends on one side of the lasso are not cut. */
const SHORT_SEGMENT = 4;

/** Strokes are immutable, so their padded bounds are computed once. */
const boundsCache = new WeakMap<Stroke, Bounds>();

/**
 * Bounding box of points.
 *
 * @param pts - At least one point.
 * @returns The tight box.
 */
export function boundsOf(pts: readonly (readonly number[])[]): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[0]! < x0) x0 = p[0]!;
    if (p[0]! > x1) x1 = p[0]!;
    if (p[1]! < y0) y0 = p[1]!;
    if (p[1]! > y1) y1 = p[1]!;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Bounding box of a stroke, padded by half its nib so the pre-filters never cut off ink.
 *
 * @param stroke - The stroke.
 * @returns The padded box (cached per stroke object).
 */
export function strokeBounds(stroke: Stroke): Bounds {
  let b = boundsCache.get(stroke);
  if (!b) {
    const raw = boundsOf(stroke.points);
    const pad = NIB_DIAMETER[stroke.tool][stroke.nib] / 2;
    b = { x0: raw.x0 - pad, y0: raw.y0 - pad, x1: raw.x1 + pad, y1: raw.y1 + pad };
    boundsCache.set(stroke, b);
  }
  return b;
}

/**
 * Whether two boxes overlap (touching counts).
 *
 * @param a - First box.
 * @param b - Second box.
 * @returns True when they share any area or edge.
 */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

/**
 * Non-zero winding point-in-polygon. A self-crossing loop (figure 8) keeps both lobes, which is
 * what a hand-drawn lasso means. Edges are half-open, so a point exactly on a border shared by two
 * polygons belongs to exactly one of them.
 *
 * @param pt - The point.
 * @param poly - Vertices; implicitly closed.
 * @returns True when the point is inside.
 */
export function pointInPolygon(pt: Vec2, poly: readonly Vec2[]): boolean {
  const [px, py] = pt;
  let winding = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const cross = (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]);
    if (a[1] <= py) {
      if (b[1] > py && cross > 0) winding++;
    } else if (b[1] <= py && cross < 0) winding--;
  }
  return winding !== 0;
}

/**
 * Distance from a point to a segment.
 *
 * @param p - The point.
 * @param a - Segment start.
 * @param b - Segment end.
 * @returns The shortest distance.
 */
export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Ramer-Douglas-Peucker: drops points that deviate less than `epsilon` from the straight line,
 * so a 300-point lasso becomes about 50 vertices before it is tested (17 ms -> 3 ms on 500 strokes).
 *
 * @param pts - The path.
 * @param epsilon - Tolerance in page units.
 * @returns A new, thinner path that keeps both end points.
 */
export function simplify(pts: readonly Vec2[], epsilon: number): Vec2[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    let dmax = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distPointSegment(pts[i]!, pts[s]!, pts[e]!);
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (dmax > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/**
 * Parameters (0..1) along segment a-b where it crosses an edge of the polygon, sorted, with the
 * ends included.
 *
 * @param a - Segment start.
 * @param b - Segment end.
 * @param poly - Polygon vertices; implicitly closed.
 * @returns Sorted parameters, always starting with 0 and ending with 1.
 */
function crossings(a: Vec2, b: Vec2, poly: readonly Vec2[]): number[] {
  const ts = [0, 1];
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  for (let i = 0, n = poly.length; i < n; i++) {
    const c = poly[i]!;
    const d = poly[(i + 1) % n]!;
    const sx = d[0] - c[0];
    const sy = d[1] - c[1];
    const denom = rx * sy - ry * sx;
    if (denom === 0) continue; // parallel
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denom;
    const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denom;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  return ts.sort((p, q) => p - q);
}

/**
 * How much of a stroke's polyline lies inside the lasso, as inside length and total length.
 * Each segment is cut where it crosses the lasso, and each piece is judged by its midpoint, so a
 * sparse stroke (a fast straight line of two points) is judged by its ink, not its samples.
 *
 * @param pts - The stroke's points.
 * @param lasso - Lasso polygon.
 * @returns `[inside, total]` lengths in page units.
 */
function lengthInside(pts: Stroke['points'], lasso: readonly Vec2[]): [number, number] {
  const lb = boundsOf(lasso);
  let inside = 0;
  let total = 0;
  let prevIn = pts.length > 0 && pointInPolygon([pts[0]![0], pts[0]![1]], lasso);
  for (let i = 0; i < pts.length - 1; i++) {
    const a: Vec2 = [pts[i]![0], pts[i]![1]];
    const b: Vec2 = [pts[i + 1]![0], pts[i + 1]![1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nextIn = pointInPolygon(b, lasso);
    total += len;
    if (len < SHORT_SEGMENT && prevIn === nextIn) {
      // Pen samples are a few units apart: a hop with both ends on one side stays on it. (A lasso
      // notch narrower than SHORT_SEGMENT is not something a hand draws.)
      if (nextIn) inside += len;
    } else if (
      Math.max(a[0], b[0]) >= lb.x0 &&
      Math.min(a[0], b[0]) <= lb.x1 &&
      Math.max(a[1], b[1]) >= lb.y0 &&
      Math.min(a[1], b[1]) <= lb.y1
    ) {
      const ts = crossings(a, b, lasso);
      for (let k = 0; k < ts.length - 1; k++) {
        const m = (ts[k]! + ts[k + 1]!) / 2;
        if (pointInPolygon([a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m], lasso)) {
          inside += len * (ts[k + 1]! - ts[k]!);
        }
      }
    }
    prevIn = nextIn;
  }
  return [inside, total];
}

/**
 * Which strokes a lasso picks: those with at least half their LENGTH inside (so a two-point line
 * that crosses the loop with both ends outside is judged by the part that is in). A stroke of
 * zero length, such as a dot, is judged by its point. Edges are half-open, so a stroke lying
 * exactly on the lasso's border may or may not be taken.
 *
 * @param strokes - Candidate strokes.
 * @param lasso - Lasso polygon (already simplified, at least 3 vertices).
 * @returns Selected stroke ids, in input order.
 */
export function lassoStrokes(strokes: readonly Stroke[], lasso: readonly Vec2[]): string[] {
  if (lasso.length < 3) return [];
  const lb = boundsOf(lasso);
  const out: string[] = [];
  for (const s of strokes) {
    if (!boundsIntersect(lb, strokeBounds(s))) continue;
    const [inside, total] = lengthInside(s.points, lasso);
    const picked =
      total === 0
        ? s.points.length > 0 && pointInPolygon([s.points[0]![0], s.points[0]![1]], lasso)
        : inside * 2 >= total;
    if (picked) out.push(s.id);
  }
  return out;
}

/**
 * Which items a lasso picks: those whose centre is inside. (Intersection would grab any card the
 * loop merely grazes.)
 *
 * @param items - Candidate items.
 * @param lasso - Lasso polygon (at least 3 vertices).
 * @returns Selected item ids, in input order.
 */
export function lassoItems(items: readonly Item[], lasso: readonly Vec2[]): string[] {
  if (lasso.length < 3) return [];
  return items
    .filter((it) => pointInPolygon([it.x + it.w / 2, it.y + it.h / 2], lasso))
    .map((it) => it.id);
}

/**
 * Full lasso: thins the raw drag path, then selects strokes and items together.
 *
 * @param strokes - All strokes on the page.
 * @param items - All items on the page.
 * @param rawLasso - The points of the drag, as captured.
 * @param epsilon - Thinning tolerance in page units; the UI passes `2 / scale`. Clamped to
 *   `MAX_LASSO_EPSILON` so a phone's large page-unit tolerance cannot flatten a small deliberate loop.
 * @returns The ids picked up.
 */
export function lassoSelect(
  strokes: readonly Stroke[],
  items: readonly Item[],
  rawLasso: readonly Vec2[],
  epsilon = 2,
): LassoSelection {
  const thinned = simplify(rawLasso, Math.min(epsilon, MAX_LASSO_EPSILON));
  // A tiny closed loop can thin to two vertices; keep the raw path rather than selecting nothing.
  const lasso = thinned.length >= 3 ? thinned : rawLasso;
  return { strokeIds: lassoStrokes(strokes, lasso), itemIds: lassoItems(items, lasso) };
}

/**
 * Shortest distance between two segments.
 *
 * @param a - First segment start.
 * @param b - First segment end.
 * @param c - Second segment start.
 * @param d - Second segment end.
 * @returns The distance; 0 when they cross.
 */
function distSegmentSegment(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const orient = (p: Vec2, q: Vec2, r: Vec2): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return 0;
  return Math.min(
    distPointSegment(a, c, d),
    distPointSegment(b, c, d),
    distPointSegment(c, a, b),
    distPointSegment(d, a, b),
  );
}

/**
 * Whole-stroke eraser: the strokes the eraser sweeping from `from` to `to` touches.
 *
 * @param strokes - Candidate strokes.
 * @param from - Previous pointer position (page units).
 * @param to - Current pointer position.
 * @param tolerance - Eraser radius in page units; the UI passes `max(2.25, 5 / scale)`. Half of
 *   each stroke's nib is added to it.
 * @returns Ids of the strokes hit, in input order.
 */
export function eraseStrokes(
  strokes: readonly Stroke[],
  from: Vec2,
  to: Vec2,
  tolerance: number,
): string[] {
  const sweep: Bounds = {
    x0: Math.min(from[0], to[0]) - tolerance,
    y0: Math.min(from[1], to[1]) - tolerance,
    x1: Math.max(from[0], to[0]) + tolerance,
    y1: Math.max(from[1], to[1]) + tolerance,
  };
  const out: string[] = [];
  for (const s of strokes) {
    if (!boundsIntersect(sweep, strokeBounds(s))) continue;
    const reach = tolerance + NIB_DIAMETER[s.tool][s.nib] / 2;
    const pts = s.points;
    let hit = pts.length === 1 && distPointSegment([pts[0]![0], pts[0]![1]], from, to) <= reach;
    for (let i = 0; i < pts.length - 1 && !hit; i++) {
      const a: Vec2 = [pts[i]![0], pts[i]![1]];
      const b: Vec2 = [pts[i + 1]![0], pts[i + 1]![1]];
      hit = distSegmentSegment(a, b, from, to) <= reach;
    }
    if (hit) out.push(s.id);
  }
  return out;
}
