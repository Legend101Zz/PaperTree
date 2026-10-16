import { describe, expect, it } from 'vitest';

import {
  eraseStrokes,
  lassoItems,
  lassoSelect,
  lassoStrokes,
  pointInPolygon,
  simplify,
} from './hitTest';
import { stroke, sticky } from './test-helpers';

import type { Vec2 } from './page';

const square = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

describe('lasso', () => {
  it('handles convex and concave polygons', () => {
    const concave: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [5, 4],
      [0, 10],
    ]; // a notch cut from the bottom
    expect(pointInPolygon([5, 2], concave)).toBe(true);
    expect(pointInPolygon([5, 8], concave)).toBe(false); // inside the notch
    expect(pointInPolygon([1, 8], concave)).toBe(true);
    expect(pointInPolygon([11, 5], concave)).toBe(false);
    expect(pointInPolygon([5, 5], square(0, 0, 10, 10))).toBe(true);
  });

  it('keeps both lobes of a figure-8 but not the pinch', () => {
    const bow: Vec2[] = [
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 10],
    ];
    expect(pointInPolygon([8, 5], bow)).toBe(true);
    expect(pointInPolygon([2, 5], bow)).toBe(true);
    expect(pointInPolygon([5, 1], bow)).toBe(false);
  });

  it('selects a stroke with half its points inside, not fewer', () => {
    const lasso = square(0, 0, 10, 10);
    const half = stroke('half', [
      [2, 2],
      [4, 4],
      [20, 4],
      [30, 4],
    ]);
    const fewer = stroke('fewer', [
      [2, 2],
      [20, 4],
      [30, 4],
      [40, 4],
    ]);
    const far = stroke('far', [
      [100, 100],
      [101, 101],
    ]);
    expect(lassoStrokes([half, fewer, far], lasso)).toEqual(['half']);
  });

  it('decides a block on its centre; an edge centre belongs to exactly one neighbour', () => {
    const a = sticky('a', 2, 2, 4, 4); // centre (4,4)
    const b = sticky('b', -2, 2, 30, 4); // centre (13,4), outside
    expect(lassoItems([a, b], square(0, 0, 10, 10))).toEqual(['a']);
    const onEdge = sticky('e', 5, 0, 10, 10); // centre (10,5) on the shared border
    const left = lassoItems([onEdge], square(0, 0, 10, 10)).length;
    const right = lassoItems([onEdge], square(10, 0, 20, 10)).length;
    expect(left + right).toBe(1);
  });

  it('ignores a lasso under 3 vertices and selects both kinds together', () => {
    expect(
      lassoSelect(
        [stroke('s', [[1, 1]])],
        [],
        [
          [0, 0],
          [5, 5],
        ],
      ),
    ).toEqual({ strokeIds: [], itemIds: [] });
    const raw = [...square(-5, -5, 50, 50), [-5, -5] as Vec2];
    const sel = lassoSelect(
      [
        stroke('s', [
          [1, 1],
          [2, 2],
        ]),
      ],
      [sticky('i', 10, 10)],
      raw,
    );
    expect(sel).toEqual({ strokeIds: ['s'], itemIds: ['i'] });
  });

  it('simplify thins a nearly straight line to its ends and keeps corners', () => {
    expect(
      simplify(
        [
          [0, 0],
          [5, 0.1],
          [10, -0.1],
          [20, 0],
        ],
        1,
      ),
    ).toEqual([
      [0, 0],
      [20, 0],
    ]);
    expect(
      simplify(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        1,
      ),
    ).toHaveLength(3);
  });
});

describe('eraser', () => {
  const line = stroke('line', [
    [0, 10],
    [100, 10],
  ]);
  const lone = stroke('dot', [[50, 50]]);

  it('hits a crossed stroke, including a point stroke, and misses a far one', () => {
    expect(eraseStrokes([line, lone], [50, 0], [50, 20], 2)).toEqual(['line']);
    expect(eraseStrokes([line, lone], [45, 50], [55, 50], 2)).toEqual(['dot']);
    expect(eraseStrokes([line, lone], [50, 30], [60, 40], 2)).toEqual([]);
  });

  it('counts half the nib: a near miss within tolerance + nib/2 still hits', () => {
    // F nib = 2.5, so reach = 2 + 1.25; a sweep 3 units above the line hits, 4 does not.
    expect(eraseStrokes([line], [10, 7], [20, 7], 2)).toEqual(['line']);
    expect(eraseStrokes([line], [10, 6], [20, 6], 2)).toEqual([]);
  });
});
