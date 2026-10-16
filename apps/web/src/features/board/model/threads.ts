/**
 * board/model/threads — the seven threads as the board draws them: the wire kind's design kind
 * (whose words, glyph and cue live in `@papertree/ui`'s `THREAD_KINDS` / `THREAD_LINES`, never
 * redefined here), and the curve a thread follows between two pins, with points and directions
 * along it for the cue marks, the arrowhead and the paper tag. Pure.
 */
import { THREAD_KINDS, type ThreadKind, type ThreadKindInfo } from '@papertree/ui';

import type { EdgeKind } from '@/lib/api/types';

/** The wire's seven edge kinds as the design's seven thread kinds. */
const DESIGN_KIND: Readonly<Record<EdgeKind, ThreadKind>> = {
  supports: 'supports',
  contradicts: 'contradicts',
  derives_from: 'derives',
  answers: 'answers',
  compares: 'compares',
  references: 'references',
  relates: 'plain',
};

/**
 * The design kind of a wire edge kind (`relates` is the plain link).
 *
 * @param kind The wire kind.
 * @returns Its design kind.
 */
export function threadKindOf(kind: EdgeKind): ThreadKind {
  return DESIGN_KIND[kind];
}

/**
 * The name, glyph and cue of a wire edge kind.
 *
 * @param kind The wire kind.
 * @returns Its `THREAD_KINDS` entry.
 */
export function threadInfo(kind: EdgeKind): ThreadKindInfo {
  const design = DESIGN_KIND[kind];
  return THREAD_KINDS.find((k) => k.kind === design) ?? THREAD_KINDS[0]!;
}

/** A side of a card a pin sits on. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

/** A point on the board. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A cubic curve: the two pins and the two control points that leave each pin square to its side. */
export interface ThreadCurve {
  readonly p0: Point;
  readonly p1: Point;
  readonly p2: Point;
  readonly p3: Point;
}

const OUTWARD: Readonly<Record<Side, Point>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

/**
 * How far a control point stands off its pin: half the gap ahead, a gentle loop when behind.
 *
 * @param ahead How far the other pin lies in front of this one, along this pin's side.
 * @returns The distance in board px.
 */
function standOff(ahead: number): number {
  return ahead >= 0 ? 0.5 * ahead : 6.25 * Math.sqrt(-ahead);
}

/**
 * The curve between two pins, leaving each square to the side it sits on.
 *
 * @param from The out-pin's centre.
 * @param fromSide The side of its card.
 * @param to The in-pin's centre.
 * @param toSide The side of its card.
 * @returns The curve.
 */
export function threadCurve(from: Point, fromSide: Side, to: Point, toSide: Side): ThreadCurve {
  const control = (p: Point, side: Side, q: Point): Point => {
    const d = OUTWARD[side];
    const k = standOff((q.x - p.x) * d.x + (q.y - p.y) * d.y);
    return { x: p.x + d.x * k, y: p.y + d.y * k };
  };
  return { p0: from, p1: control(from, fromSide, to), p2: control(to, toSide, from), p3: to };
}

/**
 * The curve as an SVG path.
 *
 * @param c The curve.
 * @returns `M … C …`.
 */
export function curvePath(c: ThreadCurve): string {
  const f = (p: Point): string => `${String(p.x)},${String(p.y)}`;
  return `M${f(c.p0)} C${f(c.p1)} ${f(c.p2)} ${f(c.p3)}`;
}

/**
 * The point at `t` (0..1) along the curve and the direction it runs there.
 *
 * @param c The curve.
 * @param t How far along, 0 at the out-pin and 1 at the in-pin.
 * @returns The point and its heading in degrees (0 = towards +x).
 */
export function pointAt(c: ThreadCurve, t: number): Point & { readonly angle: number } {
  const u = 1 - t;
  const at = (a: number, b: number, cc: number, d: number): number =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * cc + t * t * t * d;
  const slope = (a: number, b: number, cc: number, d: number): number =>
    3 * u * u * (b - a) + 6 * u * t * (cc - b) + 3 * t * t * (d - cc);
  const dx = slope(c.p0.x, c.p1.x, c.p2.x, c.p3.x);
  const dy = slope(c.p0.y, c.p1.y, c.p2.y, c.p3.y);
  return {
    x: at(c.p0.x, c.p1.x, c.p2.x, c.p3.x),
    y: at(c.p0.y, c.p1.y, c.p2.y, c.p3.y),
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/** The curve's arc length, sampled: cumulative px at each of `STEPS` equal steps of `t`. */
const STEPS = 48;
function arcTable(c: ThreadCurve): number[] {
  const lengths = [0];
  let prev = pointAt(c, 0);
  for (let i = 1; i <= STEPS; i += 1) {
    const next = pointAt(c, i / STEPS);
    lengths.push(lengths[i - 1]! + Math.hypot(next.x - prev.x, next.y - prev.y));
    prev = next;
  }
  return lengths;
}

/**
 * The curve's length in px (sampled; close enough to place marks).
 *
 * @param c The curve.
 * @returns Its length.
 */
export function curveLength(c: ThreadCurve): number {
  return arcTable(c)[STEPS]!;
}

/**
 * Where marks placed at fractions of the curve's LENGTH fall in `t`, interpolated within each
 * sampled step so two marks never collapse onto one point on a long thread.
 *
 * @param c The curve.
 * @param fractions Fractions of the length, from `markPositions`.
 * @returns The `t` of each mark, in order.
 */
export function tAtFractions(c: ThreadCurve, fractions: readonly number[]): number[] {
  const lengths = arcTable(c);
  const total = lengths[STEPS]!;
  return fractions.map((f) => {
    const s = f * total;
    const i = Math.max(
      1,
      lengths.findIndex((l) => l >= s),
    );
    const a = lengths[i - 1]!;
    const b = lengths[i]!;
    return (i - 1 + (b > a ? (s - a) / (b - a) : 0)) / STEPS;
  });
}

/**
 * Where a thread's paper tag sits: just below a thread that runs across, just right of one that
 * runs up or down, so the tag never hides the line's own cue (frame 06).
 *
 * @param c The curve.
 * @returns The CSS transform that places the tag (in the edge-label layer's px).
 */
export function tagTransform(c: ThreadCurve): string {
  const mid = pointAt(c, 0.5);
  const across = Math.abs(Math.cos((mid.angle * Math.PI) / 180)) >= 0.5;
  return across
    ? `translate(-50%, 0) translate(${String(mid.x)}px, ${String(mid.y + 9)}px)`
    : `translate(0, -50%) translate(${String(mid.x + 12)}px, ${String(mid.y)}px)`;
}
