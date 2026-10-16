/**
 * Every port pin is a control, so its outline must reach 3:1 against the board in both schemes
 * (WCAG 1.4.11; #212 review N5). This reads the pin rules in `threads.css` (each pin is edged in
 * `--pt-pin-ring`) and computes that token against `--pt-linen` from `@papertree/ui`'s styles,
 * in daylight and by lamplight. The brass fill alone is checked too, to show why the rim exists.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const THREADS_CSS = readFileSync(resolve(HERE, 'threads.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const TOKENS = readFileSync(resolve(HERE, '../../../../../../packages/ui/src/styles.css'), 'utf8');

/** `--name: #rrggbb` from the first block whose selector is exactly `selector`. */
function token(selector: string, name: string): string {
  const start = TOKENS.indexOf(`\n${selector} {`);
  expect(start, `styles.css has no ${selector} block`).toBeGreaterThan(-1);
  const block = TOKENS.slice(start, TOKENS.indexOf('\n}', start));
  const hex = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1];
  expect(hex, `${name} in ${selector}`).toBeDefined();
  return hex!;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SCHEMES = {
  daylight: ':root',
  'lamp-lit': ":root.dark,\n:root[data-pt-theme='dark']",
} as const;

describe('port pins reach 3:1 against the board', () => {
  it('edges every pin, open and brass, in the pin-ring token', () => {
    for (const port of ['evidence_in', 'question_in', 'claim_out', 'answer_out']) {
      const rules = [...THREADS_CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, selector]) =>
        selector!.split(',').some((s) => s.trim() === `.pt-cv .pt-pin--${port}`),
      );
      expect(
        rules.some(([, , body]) => /border:\s*[\d.]+px solid var\(--pt-pin-ring\)/.test(body!)),
        `.pt-pin--${port} has no pin-ring edge`,
      ).toBe(true);
    }
  });

  for (const [scheme, selector] of Object.entries(SCHEMES)) {
    it(`${scheme}: the pin ring on linen is at least 3:1`, () => {
      const ring = token(selector, '--pt-pin-ring');
      const linen = token(selector, '--pt-linen');
      expect(contrast(ring, linen)).toBeGreaterThanOrEqual(3);
    });
  }

  it('the bare brass would not be enough by day (why the rim is there)', () => {
    // The brass gradient's middle stop, as `--pt-brass` draws it.
    expect(TOKENS).toContain('--pt-brass: linear-gradient(180deg, #e7cf8e, #b8944c 45%');
    expect(contrast('#b8944c', token(':root', '--pt-linen'))).toBeLessThan(3);
  });
});
