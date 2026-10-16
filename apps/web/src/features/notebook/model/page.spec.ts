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

  it('maps to known pixels, with scroll in the container frame', () => {
    // width 480 -> scale 0.5; page x 300 -> 150 px; scrolled 20 px right -> 130.
    expect(pageToScreen([300, 700], { containerWidth: 480, scrollX: 0, scrollY: 0 })).toEqual([
      150, 350,
    ]);
    expect(pageToScreen([300, 700], { containerWidth: 480, scrollX: 20, scrollY: 50 })).toEqual([
      130, 300,
    ]);
    expect(screenToPage([130, 300], { containerWidth: 480, scrollX: 20, scrollY: 50 })).toEqual([
      300, 700,
    ]);
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
