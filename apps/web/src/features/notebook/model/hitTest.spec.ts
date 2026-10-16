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

  it('selects a stroke with at least half its length inside, not less', () => {
    const lasso = square(0, 0, 10, 10);
    const half = stroke('half', [
      [2, 5],
      [10, 5],
      [18, 5],
    ]); // 8 of 16 units in
    const less = stroke('less', [
      [2, 5],
      [10, 5],
      [26, 5],
    ]); // 8 of 24
    const far = stroke('far', [
      [100, 100],
      [101, 101],
    ]);
    expect(lassoStrokes([half, less, far], lasso)).toEqual(['half']);
  });

  it('selects a two-point line that crosses the lasso with both ends outside', () => {
    const through = stroke('through', [
      [-50, 5],
      [60, 5],
    ]);
    const missing = stroke('missing', [
      [-50, 50],
      [60, 50],
    ]);
    const grazing = stroke('graze', [
      [-50, 5],
      [-1, 5],
      [5, 5],
      [5, 9],
    ]);
    expect(lassoStrokes([through, missing], square(0, 0, 10, 10))).toEqual([]); // only 10 of 110 units in
    expect(
      lassoStrokes(
        [
          stroke('wide', [
            [-2, 5],
            [12, 5],
          ]),
          missing,
        ],
        square(0, 0, 10, 10),
      ),
    ).toEqual(['wide']);
    expect(lassoStrokes([grazing], square(0, 0, 10, 10))).toEqual([]);
  });

  it('judges a dot by its point and a stroke on the border without throwing', () => {
    const lasso = square(0, 0, 10, 10);
    expect(lassoStrokes([stroke('in', [[5, 5]]), stroke('out', [[50, 5]])], lasso)).toEqual(['in']);
    expect(
      lassoStrokes(
        [
          stroke('edge', [
            [0, 2],
            [0, 8],
          ]),
        ],
        lasso,
      ),
    ).toEqual(['edge']); // left edge is inside
    expect(
      lassoStrokes(
        [
          stroke('edge', [
            [10, 2],
            [10, 8],
          ]),
        ],
        lasso,
      ),
    ).toEqual([]); // right edge is outside
  });

  it('keeps a small deliberate circle even with a phone-sized tolerance', () => {
    const circle: Vec2[] = Array.from({ length: 13 }, (_, i) => [
      100 + Math.cos((i / 12) * Math.PI * 2) * 6,
      100 + Math.sin((i / 12) * Math.PI * 2) * 6,
    ]);
    const word = stroke('word', [
      [98, 100],
      [102, 100],
    ]);
    expect(lassoSelect([word], [], circle, 5).strokeIds).toEqual(['word']);
    expect(lassoSelect([word], [], circle.slice(0, 2), 5).strokeIds).toEqual([]); // 2 vertices: still nothing
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
