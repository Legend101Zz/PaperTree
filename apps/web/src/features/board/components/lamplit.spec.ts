/**
 * #215: the lamp-lit board (09c) is drawn from the tokens, and what it draws reads: by day and by
 * lamplight, every thread colour (the line and its second cue) and every pin reaches 3:1 on linen
 * and on the cards a pin sits on; the words on the cards, the glances, the thread tags and the
 * legend reach 4.5:1 on their grounds. The board's own lamp-lit tints sit in two identical blocks.
 * Reads `@papertree/ui`'s styles.css and the board's cards.css, as `pins-contrast.spec.ts` does.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = readFileSync(resolve(HERE, '../../../../../../packages/ui/src/styles.css'), 'utf8');
const CARDS = readFileSync(resolve(HERE, 'cards.css'), 'utf8');

const SCHEMES = {
  daylight: ':root',
  'lamp-lit': ":root.dark,\n:root[data-pt-theme='dark']",
} as const;

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

const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const WIRES = ['supports', 'contradicts', 'derives', 'answers', 'compares', 'references', 'plain'];

/** [foreground, background, what] pairs held to 4.5:1 (text) or 3:1 (pins, lines, edges). */
const TEXT: readonly [string, string, string][] = [
  ['--pt-ink', '--pt-call-slip', 'a passage, a glance’s words'],
  ['--pt-ink', '--pt-ai-slip', 'an answer, an AI glance'],
  ['--pt-ink-2', '--pt-call-slip', 'a glance’s kind, a card tag'],
  ['--pt-ink-2', '--pt-ai-slip', 'an AI glance’s kind'],
  ['--pt-pen', '--pt-call-slip', 'a note in the pen'],
  ['--pt-ink', '--pt-page', 'a thread tag, the legend'],
  ['--pt-ink-muted', '--pt-page', 'the legend’s hint, the counts'],
  ['--pt-on-tab', '--pt-tab', 'the page tab'],
  ['--pt-ai-tab-ink', '--pt-ai-slip', 'the AI tab'],
];
const MARKS: readonly [string, string, string][] = [
  ['--pt-pin-ring', '--pt-call-slip', 'a pin on an index card'],
  ['--pt-pin-ring', '--pt-ai-slip', 'a pin on an AI card'],
  ['--pt-card-edge', '--pt-linen', 'a card’s edge'],
  ['--pt-focus', '--pt-linen', 'the focus ring and a thread being drawn'],
];

describe('the lamp-lit board reads (09c, #215)', () => {
  for (const [scheme, selector] of Object.entries(SCHEMES)) {
    it(`${scheme}: each thread and its cue reach 3:1 on linen, and its tag glyph on the tag`, () => {
      for (const wire of WIRES) {
        const colour = token(selector, `--pt-wire-${wire}`);
        expect(contrast(colour, token(selector, '--pt-linen')), wire).toBeGreaterThanOrEqual(3);
        expect(contrast(colour, token(selector, '--pt-page')), wire).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${scheme}: card words, glances, tags and the legend reach 4.5:1`, () => {
      for (const [fg, bg, what] of TEXT) {
        expect(contrast(token(selector, fg), token(selector, bg)), what).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });

    it(`${scheme}: pins, card edges and the focus ring reach 3:1`, () => {
      for (const [fg, bg, what] of MARKS) {
        // Daylight has no card-edge token of its own (the card's shadow draws its edge).
        if (scheme === 'daylight' && fg === '--pt-card-edge') continue;
        expect(contrast(token(selector, fg), token(selector, bg)), what).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('lights the board’s own tints by lamplight, in two identical blocks', () => {
    const media = /:root:not\(\[data-pt-theme='light'\]\) \.pt-cv \{([^}]*)\}/.exec(CARDS)?.[1];
    const explicit = /:root\[data-pt-theme='dark'\] \.pt-cv \{([^}]*)\}/.exec(CARDS)?.[1];
    expect(media).toBeDefined();
    const norm = (block: string | undefined) =>
      (block ?? '')
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean);
    expect(norm(media)).toEqual(norm(explicit));
    expect(norm(media)).toContain('--pt-bc-linen-h: rgb(255 230 190 / 7%)');
    // The linen's threads are drawn from those tints, never from a fixed colour.
    expect(CARDS).toMatch(/repeating-linear-gradient\(0deg, var\(--pt-bc-linen-h\)/);
  });
});
