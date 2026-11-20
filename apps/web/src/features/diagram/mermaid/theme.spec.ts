import { describe, expect, it } from 'vitest';

import { DAYLIGHT, parseColor, themeVariables, type FigureTokens } from './theme';

/** Each page and room is another set of the same tokens; these stand for Light, Sepia and Dark pages. */
const THEMES: Record<string, FigureTokens> = {
  daylight: DAYLIGHT,
  sepia: {
    ...DAYLIGHT,
    page: '#f1e4c8',
    slip: '#e6d4ae',
    ink: '#3b2f20',
    inkMuted: '#6b5a42',
    border: '#8c7658',
    rule: '#cdb98f',
    accent: '#7a2a1a',
  },
  lamp: {
    ...DAYLIGHT,
    page: '#1f1c19',
    slip: '#2c2822',
    ink: '#e8e0d0',
    inkMuted: '#b0a595',
    border: '#8a7e6e',
    rule: '#3a352e',
    accent: '#d9826f',
  },
};

function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = (parseColor(hex) ?? [0, 0, 0]).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s, l };
}

const hueGap = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe('themeVariables: no default rainbow', () => {
  for (const [name, tokens] of Object.entries(THEMES)) {
    const vars = themeVariables(tokens);
    const scaleKeys = Object.keys(vars).filter((k) => /^(cScale|pie\d|git\d|fillType)/.test(k));

    it(`${name}: every colour scale, pie slice and branch colour is set (none left to Mermaid's hue rotation)`, () => {
      for (let i = 0; i < 12; i++) {
        for (const base of ['cScale', 'cScalePeer', 'cScaleLabel', 'cScaleInv']) {
          expect(vars[`${base}${String(i)}`], `${base}${String(i)}`).toMatch(/^#[0-9a-f]{6}$/);
        }
        expect(vars[`pie${String(i + 1)}`], `pie${String(i + 1)}`).toMatch(/^#[0-9a-f]{6}$/);
      }
      for (let i = 0; i < 8; i++) {
        for (const base of ['git', 'gitInv', 'gitBranchLabel', 'fillType']) {
          expect(vars[`${base}${String(i)}`], `${base}${String(i)}`).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
      for (const key of ['pieTitleTextColor', 'pieSectionTextColor', 'pieLegendTextColor']) {
        expect(vars[key]).toBe(tokens.ink);
      }
    });

    it(`${name}: the scales stay in the palette's hue (the accent's) and are muted`, () => {
      const accent = hsl(tokens.accent);
      for (const key of scaleKeys) {
        const { h, s } = hsl(vars[key] as string);
        // A neutral (ink/border mixes) has little saturation; any tint that has some is the accent's hue.
        expect(s, key).toBeLessThan(0.45);
        if (s > 0.2) expect(hueGap(h, accent.h), `${key} ${h.toFixed(0)}deg`).toBeLessThan(40);
      }
    });

    it(`${name}: the quadrant, xy-chart and pie-text colours come from the tokens`, () => {
      const allowed = new Set([
        tokens.ink,
        tokens.inkMuted,
        tokens.border,
        tokens.accent,
        tokens.page,
      ]);
      const xy = vars['xyChart'] as Record<string, string>;
      for (const color of xy['plotColorPalette']?.split(',') ?? [])
        expect(allowed.has(color)).toBe(true);
      expect(vars['quadrantPointFill']).toBe(tokens.accent);
      expect(vars['pieStrokeColor']).toBe(tokens.border);
    });
  }

  it('the page sets dark mode for the dark page only', () => {
    expect(themeVariables(THEMES['daylight'] as FigureTokens)['darkMode']).toBe(false);
    expect(themeVariables(THEMES['sepia'] as FigureTokens)['darkMode']).toBe(false);
    expect(themeVariables(THEMES['lamp'] as FigureTokens)['darkMode']).toBe(true);
  });

  it('a different page gives different fills (a figure re-themes with the page)', () => {
    const a = themeVariables(THEMES['daylight'] as FigureTokens)['cScale0'];
    const b = themeVariables(THEMES['lamp'] as FigureTokens)['cScale0'];
    expect(a).not.toBe(b);
  });
});
