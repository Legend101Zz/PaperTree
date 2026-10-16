import { THREAD_KINDS, THREAD_LINES, markPositions } from '@papertree/ui';
import { describe, expect, it } from 'vitest';

import { EDGE_KINDS } from './flow';
import {
  curveLength,
  curvePath,
  pointAt,
  tAtFractions,
  tagTransform,
  threadCurve,
  threadInfo,
  threadKindOf,
} from './threads';

describe('the wire kinds are the design’s seven threads', () => {
  it('maps each of the seven to a distinct design kind and takes its words from THREAD_KINDS', () => {
    const kinds = EDGE_KINDS.map((k) => threadKindOf(k.kind));
    expect(new Set(kinds).size).toBe(7);
    expect(new Set(kinds)).toEqual(new Set(THREAD_KINDS.map((k) => k.kind)));
    expect(threadInfo('relates')).toMatchObject({ label: 'plain link', glyph: '—' });
    expect(EDGE_KINDS.map((k) => k.label)).toEqual(THREAD_KINDS.map((k) => k.label));
  });
});

describe('the curve between two pins', () => {
  const curve = threadCurve({ x: 0, y: 0 }, 'right', { x: 200, y: 100 }, 'left');

  it('runs from pin to pin, leaving each square to its side', () => {
    expect(curvePath(curve)).toBe('M0,0 C100,0 100,100 200,100');
    expect(pointAt(curve, 0)).toMatchObject({ x: 0, y: 0, angle: 0 });
    expect(pointAt(curve, 1)).toMatchObject({ x: 200, y: 100, angle: 0 });
    expect(pointAt(curve, 0.5)).toMatchObject({ x: 100, y: 50 });
  });

  it('points an answer’s arrowhead down into a pin on the top edge', () => {
    const down = threadCurve({ x: 0, y: 0 }, 'bottom', { x: 0, y: 60 }, 'top');
    expect(pointAt(down, 1).angle).toBe(90);
    expect(tagTransform(down)).toBe('translate(0, -50%) translate(12px, 30px)');
    expect(tagTransform(curve)).toMatch(/^translate\(-50%, 0\)/);
  });

  it('spaces cue marks evenly by length, never two at one point, even on a long thread', () => {
    const long = threadCurve({ x: 0, y: 0 }, 'right', { x: 1600, y: 0 }, 'left');
    const length = curveLength(long);
    const ts = tAtFractions(long, markPositions(THREAD_LINES.contradicts, length));
    const xs = ts.map((t) => pointAt(long, t).x);
    expect(xs.length).toBeGreaterThan(50);
    expect(new Set(xs.map((x) => Math.round(x))).size).toBe(xs.length);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const gap of gaps) expect(gap).toBeGreaterThan(20);
    expect(Math.min(...ts)).toBeGreaterThan(0);
    expect(Math.max(...ts)).toBeLessThan(1);
  });

  it('puts the supports plus and the derives chevrons mid-thread, as the legend does', () => {
    const length = curveLength(curve);
    const [plus] = tAtFractions(curve, markPositions(THREAD_LINES.supports, length));
    expect(pointAt(curve, plus!).x).toBeCloseTo(100, 0);
    expect(markPositions(THREAD_LINES.derives, length)).toEqual([0.5]);
  });
});
