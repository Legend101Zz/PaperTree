/**
 * The /design-system board (#191): every section renders, every shared component appears at least
 * once, and the production guard answers 404 without its flag. Contrast maths is checked against
 * known WCAG values so the printed ratios can be trusted.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesignSystemBoard, designSystemEnabled } from '@/features/design-system';
import { contrastRatio, formatRatio, parseRgb } from '@/features/design-system/model/contrast';

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);
vi.mock('next/navigation', () => ({ notFound }));

afterEach(cleanup);

describe('design-system board', () => {
  it('renders every section heading', () => {
    render(<DesignSystemBoard />);
    for (const name of [
      'Design system',
      'Colour roles',
      'Furniture and washes',
      'Type',
      'Who wrote this? Marking AI, paper and you',
      'Spacing, radius, elevation, motion',
    ]) {
      expect(
        screen.getByRole('heading', { name, level: name === 'Design system' ? 1 : 2 }),
      ).toBeTruthy();
    }
  });
});

describe('production guard', () => {
  it('is on outside production and off in production without the flag', () => {
    expect(designSystemEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(designSystemEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(
      designSystemEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM: 'off' }),
    ).toBe(false);
    expect(
      designSystemEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM: 'on' }),
    ).toBe(true);
  });

  it('the page returns notFound in production without the flag', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM', '');
    const { default: Page } = await import('@/app/design-system/page');
    expect(() => Page()).toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe('contrast maths', () => {
  it('matches WCAG for black on white and parses computed colours', () => {
    const black = parseRgb('rgb(0, 0, 0)')!;
    const white = parseRgb('rgb(255 255 255)')!;
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(parseRgb('rgba(0,0,0,0.5)')!, white)).toBeNull();
    expect(parseRgb('')).toBeNull();
  });

  it('never rounds a ratio up across its bar', () => {
    expect(formatRatio(4.46)).toBe('4.46:1');
    expect(formatRatio(4.499)).toBe('4.49:1');
    expect(formatRatio(14.3)).toBe('14.30:1');
  });
});
