/**
 * layoutMode.spec — the notebook's layout rule and what each layout allows (S5e, #210).
 */
import { describe, expect, it } from 'vitest';

import { DESKTOP_MIN, LAYOUT_QUERIES, TABLET_MIN, allows, layoutModeFor } from './layoutMode';

import type { NotebookAction } from './layoutMode';

const ALL: readonly NotebookAction[] = [
  'pen',
  'highlighter',
  'eraser',
  'lasso',
  'shapes',
  'text',
  'sticky',
  'templates',
];

describe('layoutModeFor', () => {
  it('is the phone below 768, the tablet to 1279 and the desktop from 1280', () => {
    expect([320, 390, 767].map(layoutModeFor)).toEqual(['phone', 'phone', 'phone']);
    expect([768, 820, 1180, 1279].map(layoutModeFor)).toEqual([
      'tablet',
      'tablet',
      'tablet',
      'tablet',
    ]);
    expect([1280, 1440, 2560].map(layoutModeFor)).toEqual(['desktop', 'desktop', 'desktop']);
  });

  it('listens at the same two widths it decides by', () => {
    expect(TABLET_MIN).toBe(768);
    expect(DESKTOP_MIN).toBe(1280);
    expect(LAYOUT_QUERIES).toEqual({
      tablet: '(min-width: 768px)',
      desktop: '(min-width: 1280px)',
    });
  });
});

describe('allows', () => {
  it('lets the tablet and the desktop use every tool, pen switched on or not', () => {
    for (const mode of ['tablet', 'desktop'] as const) {
      for (const action of ALL) {
        expect(allows(mode, action, false), `${mode} ${action}`).toBe(true);
      }
    }
  });

  it('lets the phone type, stick and highlight, and draw only with the pen switched on', () => {
    const off = ALL.filter((a) => allows('phone', a, false));
    const on = ALL.filter((a) => allows('phone', a, true));
    expect(off).toEqual(['highlighter', 'text', 'sticky']);
    expect(on).toEqual(['pen', 'highlighter', 'text', 'sticky']);
  });

  it('never gives the phone the eraser, the lasso, shapes or templates: its ink is view only', () => {
    for (const action of ['eraser', 'lasso', 'shapes', 'templates'] as const) {
      expect(allows('phone', action, true)).toBe(false);
      expect(allows('phone', action, false)).toBe(false);
    }
  });
});
