import { THREAD_KINDS } from '@papertree/ui';
import { describe, expect, it } from 'vitest';

import { EDGE_KINDS } from './flow';
import {
  curvePath,
  marksAlong,
  pointAt,
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

  it('spaces cue marks along the thread, clear of both pins', () => {
    const marks = marksAlong(curve, 28);
    expect(marks.length).toBeGreaterThanOrEqual(6);
    expect(Math.min(...marks)).toBeGreaterThan(0.08);
    expect(Math.max(...marks)).toBeLessThan(0.92);
    expect(marks).toEqual([...marks].sort((a, b) => a - b));
  });
});
