import { describe, expect, it } from 'vitest';

import { dotOutline, outlineToPath, strokeOutline, strokeOptions, strokeToPath } from './outline';
import { stroke } from './test-helpers';

describe('outline', () => {
  it('gives a non-empty closed path for 1-point and 2-point strokes', () => {
    for (const pts of [
      [[10, 10]],
      [
        [10, 10],
        [14, 12],
      ],
    ] as [number, number][][]) {
      const d = strokeToPath(stroke('s', pts));
      expect(d.length).toBeGreaterThan(10);
      expect(d.startsWith('M')).toBe(true);
      expect(d.endsWith('Z')).toBe(true);
    }
  });

  it('gives a closed path for a long stroke and nothing for no points', () => {
    const pts = Array.from({ length: 60 }, (_, i): [number, number] => [
      i * 3,
      Math.sin(i / 4) * 10,
    ]);
    expect(strokeToPath(stroke('s', pts)).endsWith('Z')).toBe(true);
    expect(strokeToPath(stroke('s', []))).toBe('');
    expect(
      outlineToPath([
        [0, 0],
        [1, 1],
      ]),
    ).toBe('');
  });

  it('sets size and last explicitly; last is false only while live', () => {
    const s = stroke('s', [[0, 0]], { nib: 'M' });
    expect(strokeOptions(s)).toMatchObject({ size: 4, last: true });
    expect(strokeOptions(s, true).last).toBe(false);
  });

  it('simulates pressure only when the input had none; highlighter never', () => {
    expect(strokeOptions(stroke('s', [[0, 0]], { hasPressure: false })).simulatePressure).toBe(
      true,
    );
    expect(strokeOptions(stroke('s', [[0, 0]], { hasPressure: true })).simulatePressure).toBe(
      false,
    );
    const hl = strokeOptions(stroke('h', [[0, 0]], { tool: 'highlighter', hasPressure: false }));
    expect(hl).toMatchObject({ simulatePressure: false, thinning: 0 });
  });

  it('draws outlines whose box matches the stroke plus about half a nib', () => {
    const pts = Array.from({ length: 40 }, (_, i): [number, number] => [100 + i * 2, 50 + i]);
    const nib = 4; // pen M
    const xs = strokeOutline(stroke('s', pts, { nib: 'M' })).map((p) => p[0]!);
    const ys = strokeOutline(stroke('s', pts, { nib: 'M' })).map((p) => p[1]!);
    expect(Math.min(...xs)).toBeGreaterThan(100 - nib * 2);
    expect(Math.max(...xs)).toBeLessThan(178 + nib * 2);
    expect(Math.min(...ys)).toBeGreaterThan(50 - nib * 2);
    expect(Math.max(...ys)).toBeLessThan(89 + nib * 2);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(70);
  });

  it('draws a single-point dot about one nib across, as a smooth many-vertex outline', () => {
    const o = strokeOutline(stroke('s', [[200, 300]], { nib: 'M', tool: 'highlighter' }));
    const xs = o.map((p) => p[0]!);
    expect(o.length).toBeGreaterThan(8);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(22 * 0.5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(22 * 1.5);
  });

  it('falls back to a nib-sized diamond when the library has nothing to draw', () => {
    const d = dotOutline(stroke('s', [[10, 10]], { nib: 'M' }));
    expect(d).toEqual([
      [8, 10],
      [10, 8],
      [12, 10],
      [10, 12],
    ]);
    expect(outlineToPath(d).endsWith('Z')).toBe(true);
  });
});
