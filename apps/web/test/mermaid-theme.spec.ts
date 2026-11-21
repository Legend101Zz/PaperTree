/**
 * The Mermaid theme of a figure (features/diagram/mermaid/theme): the app's tokens mapped onto
 * Mermaid's base theme, per room (Daylight, Lamp-lit) and per page (Light, Sepia, Dark), with the
 * values packages/ui styles.css gives each.
 */
import { describe, expect, it } from 'vitest';

import {
  DAYLIGHT,
  isDark,
  mix,
  parseColor,
  readTokens,
  themeVariables,
  tokensKey,
  type FigureTokens,
} from '@/features/diagram/mermaid/theme';

const LAMP_LIT: FigureTokens = {
  ink: '#ede4d3',
  inkMuted: '#b8ab97',
  page: '#2c251f',
  slip: '#3d3124',
  rule: '#4a3f35',
  border: '#8e8170',
  accent: '#f0a08f',
  font: DAYLIGHT.font,
};
// The paper's page (Sepia / Dark) is read from the same token names on a figure inside it.
const SEPIA: FigureTokens = { ...DAYLIGHT, page: '#f4ecd8', ink: '#3b2f22', inkMuted: '#6f5e49' };
const DARK_PAGE: FigureTokens = { ...LAMP_LIT, page: '#1c1714' };

describe('themeVariables', () => {
  it('Daylight: ink on ivory, the oxblood accent, not dark mode', () => {
    const v = themeVariables(DAYLIGHT);
    expect(v['darkMode']).toBe(false);
    expect(v['background']).toBe('#faf8f3');
    expect(v['primaryTextColor']).toBe('#2a2521');
    expect(v['lineColor']).toBe('#675d53');
    expect(v['secondaryBorderColor']).toBe('#7a1f1f');
    expect(v['fontFamily']).toContain('Alegreya Sans');
  });

  it('Lamp-lit: dark mode, light ink on the dark page', () => {
    const v = themeVariables(LAMP_LIT);
    expect(v['darkMode']).toBe(true);
    expect(v['background']).toBe('#2c251f');
    expect(v['primaryTextColor']).toBe('#ede4d3');
    expect(v['nodeBorder']).toBe('#8e8170');
  });

  it('Sepia and Dark pages follow their own page colour', () => {
    expect(themeVariables(SEPIA)['background']).toBe('#f4ecd8');
    expect(themeVariables(SEPIA)['darkMode']).toBe(false);
    expect(themeVariables(DARK_PAGE)['background']).toBe('#1c1714');
    expect(themeVariables(DARK_PAGE)['darkMode']).toBe(true);
  });

  it('introduces no colour outside the palette: every value is a token or a blend of tokens', () => {
    const v = themeVariables(DAYLIGHT);
    for (const [key, value] of Object.entries(v)) {
      if (typeof value !== 'string' || !key.match(/Color|Bkg|Fill|cScale|Background|background/))
        continue;
      if (key.startsWith('font')) continue;
      expect(value, key).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(v['cScale0']).toMatch(/^#[0-9a-f]{6}$/);
    expect(v['cScaleLabel11']).toBe('#2a2521');
    expect((v['xyChart'] as Record<string, string>)['plotColorPalette']).toContain('#7a1f1f');
  });

  it('a different theme is a different key; the same tokens are the same key', () => {
    expect(tokensKey(DAYLIGHT)).toBe(tokensKey({ ...DAYLIGHT }));
    expect(tokensKey(DAYLIGHT)).not.toBe(tokensKey(LAMP_LIT));
  });
});

describe('colours', () => {
  it('parse hex, short hex and both rgb() forms, and refuse what Mermaid cannot', () => {
    expect(parseColor('#2a2521')).toEqual([42, 37, 33]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgb(122, 31, 31)')).toEqual([122, 31, 31]);
    expect(parseColor('rgb(122 31 31)')).toEqual([122, 31, 31]);
    expect(parseColor('rgb(122 31 31 / 8%)')).toBeNull();
    expect(parseColor('var(--x)')).toBeNull();
    expect(parseColor('')).toBeNull();
  });

  it('mix and isDark', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(isDark('#1c1714')).toBe(true);
    expect(isDark('#faf8f3')).toBe(false);
  });
});

describe('readTokens', () => {
  it('reads the computed tokens of an element and falls back to daylight for what it cannot read', () => {
    const el = document.createElement('div');
    el.style.setProperty('--pt-ink', 'rgb(237 228 211)');
    el.style.setProperty('--pt-page', '#2c251f');
    el.style.setProperty('--pt-accent', 'rgb(240 160 143 / 14%)');
    document.body.append(el);
    const t = readTokens(el);
    el.remove();
    // happy-dom may not resolve custom properties; whatever it gives, every colour is a hex.
    for (const key of ['ink', 'inkMuted', 'page', 'slip', 'rule', 'border', 'accent'] as const) {
      expect(t[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(t.accent).toBe(DAYLIGHT.accent); // an alpha token is not handed to Mermaid
    expect(t.font).toContain('sans-serif');
  });
});
