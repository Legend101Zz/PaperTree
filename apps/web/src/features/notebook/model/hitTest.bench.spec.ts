import { describe, expect, it } from 'vitest';

import { lassoSelect } from './hitTest';
import { stroke } from './test-helpers';

import type { Vec2 } from './page';

/** Small deterministic generator so the run is repeatable. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

describe('lasso benchmark', () => {
  it('50-vertex lasso over 500 strokes x 80 points stays well under 50 ms', async () => {
    const r = rng(7);
    const strokes = Array.from({ length: 500 }, (_, k) => {
      let x = 20 + r() * 900;
      let y = 20 + r() * 900;
      const pts: [number, number][] = [];
      for (let i = 0; i < 80; i++) {
        x += (r() - 0.5) * 8;
        y += (r() - 0.5) * 8;
        pts.push([x, y]);
      }
      return stroke(`s${k}`, pts);
    });
    const lasso: Vec2[] = Array.from({ length: 50 }, (_, i) => {
      const a = (i / 50) * Math.PI * 2;
      return [480 + Math.cos(a) * 380, 480 + Math.sin(a) * 380];
    });
    lassoSelect(strokes, [], lasso, 0.01); // warm-up, also fills the bounds cache
    const t0 = performance.now();
    const sel = lassoSelect(strokes, [], lasso, 0.01);
    const ms = performance.now() - t0;
    const { loadavg } = await import('node:os');
    console.log(
      `lasso bench: ${ms.toFixed(2)} ms, ${sel.strokeIds.length}/500 selected, load ${loadavg()
        .map((n) => n.toFixed(2))
        .join(' ')}`,
    );
    expect(sel.strokeIds.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(50);
  });
});
