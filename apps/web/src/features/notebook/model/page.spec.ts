import { describe, expect, it } from 'vitest';

import { PAGE_WIDTH, pageScale, pageToScreen, screenToPage, TEMPLATE_SPACING } from './page';

describe('page coordinates', () => {
  it('scales by container width over the fixed page width', () => {
    expect(pageScale(PAGE_WIDTH)).toBe(1);
    expect(pageScale(480)).toBe(0.5);
    expect(() => pageScale(0)).toThrow(RangeError);
  });

  it('round-trips page -> screen -> page with scroll', () => {
    const view = { containerWidth: 1180, scrollX: 12, scrollY: 340 };
    const [sx, sy] = pageToScreen([100, 700], view);
    const [px, py] = screenToPage([sx, sy], view);
    expect(px).toBeCloseTo(100, 9);
    expect(py).toBeCloseTo(700, 9);
  });

  it('keeps ink beside a block when the container resizes', () => {
    const block = 300;
    const ink = 330;
    for (const w of [390, 1180, 1440]) {
      const v = { containerWidth: w, scrollX: 0, scrollY: 0 };
      const ratio = pageToScreen([ink, 0], v)[0] / pageToScreen([block, 0], v)[0];
      expect(ratio).toBeCloseTo(ink / block, 9);
    }
  });

  it('has spacing for all five templates', () => {
    expect(Object.keys(TEMPLATE_SPACING).sort()).toEqual([
      'blank',
      'cornell',
      'derivation',
      'dot',
      'lined',
    ]);
    expect(TEMPLATE_SPACING.dot.grid).toBe(24);
  });
});
