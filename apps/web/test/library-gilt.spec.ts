/**
 * Gilt titles on every cloth clear 4.5:1 (WCAG 1.4.3; titles are 12–17 px, the year 11 px).
 *
 * Recomputed from the real stylesheets, not from numbers copied here: the cloths from
 * `@papertree/ui/styles.css`, the spine's gilt, sheen and weave from `features/library`'s
 * `library.css`. Each cloth is lightened by the most light the spine puts under a title (the sheen's
 * peak plus the weave's light threads), and the gilt's darkest stop must still read at 4.5:1 on it.
 * The Language cloth takes paper labels instead of gilt (DESIGN.md §2), so it is checked as ink on
 * the label. axe cannot see gilt (background-clip: text), which is why this test exists.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd(), '..', '..');
const tokens = readFileSync(resolve(ROOT, 'packages/ui/src/styles.css'), 'utf8');
const library = readFileSync(
  resolve(process.cwd(), 'src/features/library/components/library.css'),
  'utf8',
);

type Rgb = readonly [number, number, number];

function hex(value: string): Rgb {
  const h = value.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** White at `alpha` over `base`. */
function lighten(base: Rgb, alpha: number): Rgb {
  return base.map((c) => c + (255 - c) * alpha) as unknown as Rgb;
}

/** The value of a custom property declared in `css` (the first, i.e. daylight, declaration). */
function prop(css: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (match?.[1] === undefined) throw new Error(`${name} is not declared`);
  return match[1].trim();
}

const percent = (value: string) => Number(value.replace('%', '')) / 100;

const CLOTHS = ['transformers', 'vision', 'generative', 'optimization', 'rl'] as const;

describe('gilt on cloth', () => {
  const spineRule = /\.pt-spine \{([^}]+)\}/.exec(library)?.[1] ?? '';
  // The shading under the title is the background; the 2 px inset top edge is not under any text.
  const shading = /background-image:([^;]+);/.exec(spineRule)?.[1] ?? '';
  const sheenPeak = percent(prop(library, '--pt-spine-sheen-peak'));
  const weave = percent(prop(library, '--pt-spine-weave-light'));
  // Any literal white in the spine's shading counts too, in case someone adds a brighter stop.
  const literalWhites = [...shading.matchAll(/rgb\(255 255 255 \/ (\d+(?:\.\d+)?)%\)/g)].map(
    (m) => Number(m[1]) / 100,
  );
  const light = Math.max(sheenPeak, ...literalWhites) + weave;
  const giltStops = [
    prop(library, '--pt-spine-gilt-low'),
    ...(prop(library, '--pt-spine-gilt').match(/#[0-9a-f]{6}/gi) ?? []),
  ].map(hex);
  const darkestGilt = giltStops.reduce((a, b) => (luminance(a) <= luminance(b) ? a : b));

  it('reads the real shading, gilt and cloths', () => {
    expect(shading).toContain('var(--pt-spine-sheen-peak)');
    expect(shading).toContain('var(--pt-spine-weave-light)');
    expect(library).toMatch(/\.pt-spine--gilt \.pt-spine__title[^{]*\{[^}]*var\(--pt-spine-gilt\)/);
    expect(giltStops.length).toBeGreaterThanOrEqual(4);
    expect(light).toBeGreaterThan(0);
  });

  for (const cloth of CLOTHS) {
    it(`clears 4.5:1 on the ${cloth} cloth under the sheen`, () => {
      const base = hex(prop(tokens, `--pt-cloth-${cloth}`));
      const ratio = contrast(darkestGilt, lighten(base, light));
      expect(ratio, `${cloth}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('the Language cloth takes paper labels, whose ink clears 4.5:1 in both schemes', () => {
    const ink = hex(prop(tokens, '--pt-paper-label-ink'));
    const papers = [...tokens.matchAll(/--pt-paper-label:\s*(#[0-9a-f]{6})/gi)].map((m) =>
      hex(m[1] ?? ''),
    );
    expect(papers.length).toBeGreaterThanOrEqual(2);
    for (const paper of papers) expect(contrast(ink, paper)).toBeGreaterThanOrEqual(4.5);
  });
});
