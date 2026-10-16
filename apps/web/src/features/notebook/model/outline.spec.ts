import { describe, expect, it } from 'vitest';

import { outlineToPath, strokeOptions, strokeToPath } from './outline';
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
});
