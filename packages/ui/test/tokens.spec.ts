/**
 * The Ex Libris tokens keep their contrast in both schemes (v0.2, #175; DESIGN.md §2).
 *
 * Reads `src/styles.css` as text, resolves `var()` aliases inside each scheme, and recomputes the
 * WCAG 2 contrast ratio of the pairs the design measured: text 4.5:1, control edges, focus and
 * graphical cues 3:1. A token edited below its bar fails here instead of in an axe run months later.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'),
  'utf8',
);

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (match === null) throw new Error(`styles.css has no rule for ${selector}`);
  return match[1] ?? '';
}

/** `--name: value;` pairs of one block, comments stripped. */
function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/(--pt-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    // Prettier wraps a long value differently at different indent depths; compare it unwrapped.
    const value = m[2]!.replace(/\s+/g, ' ').replace(/\(\s/g, '(').replace(/\s\)/g, ')').trim();
    out.set(m[1]!, value);
  }
  return out;
}

const LIGHT = declarations(rule(':root'));
const DARK = new Map([...LIGHT, ...declarations(rule(":root.dark,\n:root[data-pt-theme='dark']"))]);

/** A token's colour in a scheme, following `var(--pt-…)` aliases. */
function colour(scheme: Map<string, string>, name: string): [number, number, number] {
  let value = scheme.get(name);
  for (let hops = 0; value !== undefined && value.startsWith('var(') && hops < 4; hops += 1) {
    value = scheme.get(/var\((--pt-[a-z0-9-]+)\)/.exec(value)?.[1] ?? '');
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(value ?? '');
  if (hex === null)
    throw new Error(`${name} is not a plain #rrggbb colour (${value ?? 'undefined'})`);
  const n = Number.parseInt(hex[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2 relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(scheme: Map<string, string>, fg: string, bg: string): number {
  const [a, b] = [luminance(colour(scheme, fg)), luminance(colour(scheme, bg))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** [foreground, background, minimum ratio]. Text pairs 4.5, UI and graphical cues 3. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ['--pt-ink', '--pt-page', 4.5],
  ['--pt-ink', '--pt-ground', 4.5],
  ['--pt-ink', '--pt-ai-slip', 4.5],
  ['--pt-ink', '--pt-call-slip', 4.5],
  ['--pt-ink', '--pt-sticky', 4.5],
  ['--pt-paper-label-ink', '--pt-paper-label', 4.5],
  ['--pt-ink-2', '--pt-page', 4.5],
  ['--pt-ink-muted', '--pt-page', 4.5],
  ['--pt-primary', '--pt-page', 4.5],
  ['--pt-on-primary', '--pt-primary-fill', 4.5],
  // v0.1 surfaces paint --pt-accent as a fill under --pt-accent-ink, and as text on the page.
  ['--pt-accent-ink', '--pt-accent', 4.5],
  ['--pt-accent', '--pt-page', 4.5],
  ['--pt-pen', '--pt-call-slip', 4.5],
  ['--pt-on-tab', '--pt-tab', 4.5],
  ['--pt-ai-tab-ink', '--pt-ai-slip', 4.5],
  ['--pt-nv-ink', '--pt-ai-slip', 4.5],
  ['--pt-danger', '--pt-page', 4.5],
  ['--pt-focus', '--pt-page', 3],
  ['--pt-control-border', '--pt-page', 3],
  ['--pt-ribbon', '--pt-ground', 3],
  ['--pt-wire-supports', '--pt-linen', 3],
  ['--pt-wire-contradicts', '--pt-linen', 3],
  ['--pt-wire-derives', '--pt-linen', 3],
  ['--pt-wire-answers', '--pt-linen', 3],
  ['--pt-wire-compares', '--pt-linen', 3],
  ['--pt-wire-references', '--pt-linen', 3],
  ['--pt-wire-plain', '--pt-linen', 3],
  ['--pt-frame-outline', '--pt-linen', 3],
  // Every port pin on the board is edged in this token: the open pins' ring, the brass pins' rim.
  ['--pt-pin-ring', '--pt-linen', 3],
  // v0.2 interface components (#189)
  ['--pt-ink-2', '--pt-ground', 4.5],
  ['--pt-ink', '--pt-e2-fill', 4.5],
  ['--pt-ink', '--pt-e3-fill', 4.5],
  ['--pt-gilt-solid', '--pt-primary-fill', 3],
  ['--pt-danger', '--pt-e2-fill', 4.5],
];

describe('Ex Libris tokens', () => {
  for (const [name, scheme] of [
    ['daylight', LIGHT],
    ['lamp-lit', DARK],
  ] as const) {
    it.each(PAIRS)(`${name}: %s on %s is at least %d:1`, (fg, bg, min) => {
      expect(ratio(scheme, fg, bg)).toBeGreaterThanOrEqual(min);
    });
  }

  it('lamp-lit cards on linen have a 3:1 edge (a black shadow barely shows on near-black)', () => {
    expect(ratio(DARK, '--pt-card-edge', '--pt-linen')).toBeGreaterThanOrEqual(3);
  });

  it('keeps the OS-dark block and the explicit dark block identical', () => {
    const media =
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-pt-theme='light'\]\) \{([^}]*)\}/.exec(
        CSS,
      );
    expect(media, 'no OS-dark token block').not.toBeNull();
    const os = declarations(media?.[1] ?? '');
    const explicit = declarations(rule(":root.dark,\n:root[data-pt-theme='dark']"));
    expect(Object.fromEntries(os)).toEqual(Object.fromEntries(explicit));
  });

  it('keeps every v0.1 name, pointing at its Ex Libris role', () => {
    for (const legacy of [
      '--pt-font-body',
      '--pt-font-derived',
      '--pt-font-ui',
      '--pt-font-mono',
      '--pt-ground-raised',
      '--pt-page-ground',
      '--pt-panel-ground',
      '--pt-derived-ground',
      '--pt-derived-rule',
      '--pt-derived-ink',
      '--pt-derived-ink-muted',
      '--pt-accent',
      '--pt-accent-ink',
      '--pt-accent-soft',
      '--pt-radius',
      '--pt-radius-panel',
      '--pt-sheet-shadow',
      '--pt-float-shadow',
      '--pt-gap',
      '--pt-measure-body',
      '--pt-measure-derived',
    ]) {
      expect(LIGHT.has(legacy), `${legacy} was removed`).toBe(true);
    }
  });
});

describe('SegmentedControl current segment', () => {
  it('no rule paints the checked option with accent or primary text (it sits on --pt-ink)', () => {
    const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders: string[] = [];
    for (const m of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = m[1]!.trim();
      if (!selector.includes("pt-segmented__option[aria-checked='true']")) continue;
      const colour = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(m[2]!)?.[1]?.trim() ?? '';
      if (/--pt-(accent|primary)\b/.test(colour))
        offenders.push(`${selector} { color: ${colour} }`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('TextField on touch', () => {
  it('uses 16px type under a coarse pointer so iOS does not zoom on focus', () => {
    const block = /@media \(pointer: coarse\) \{\s*\.pt-textfield__control \{([^}]*)\}/.exec(CSS);
    expect(block?.[1]).toMatch(/font-size:\s*16px/);
  });
});

/** A token as a paint: its colour and alpha (`#rrggbb`, or `rgb(r g b / a%)`), aliases followed. */
function paint(
  scheme: Map<string, string>,
  name: string,
): { rgb: [number, number, number]; alpha: number } {
  let value = scheme.get(name);
  for (let hops = 0; value !== undefined && value.startsWith('var(') && hops < 4; hops += 1) {
    value = scheme.get(/var\((--pt-[a-z0-9-]+)\)/.exec(value)?.[1] ?? '');
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(value ?? '');
  if (rgb !== null) {
    const [r, g, b, a] = rgb.slice(1).map(Number) as [number, number, number, number];
    return { rgb: [r, g, b], alpha: a / 100 };
  }
  return { rgb: colour(scheme, name), alpha: 1 };
}

/** A translucent paint laid over an opaque ground, as the browser composites it. */
function over(
  top: { rgb: [number, number, number]; alpha: number },
  ground: [number, number, number],
): [number, number, number] {
  return top.rgb.map((c, i) => c * top.alpha + ground[i]! * (1 - top.alpha)) as [
    number,
    number,
    number,
  ];
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const WASHES = ['amber', 'green', 'blue', 'pink', 'purple'] as const;
/** pdf.js paints black type; lamp-lit multiplies the canvas onto the page, so it stays black. */
const PDF_TYPE: [number, number, number] = [0, 0, 0];

describe('the PDF page, which stays paper in both schemes (#205, frame 09b)', () => {
  for (const [name, scheme] of [
    ['daylight', LIGHT],
    ['lamp-lit', DARK],
  ] as const) {
    const page = colour(scheme, '--pt-pdf-page');

    it(`${name}: PDF type reads at 4.5:1 on the page, on every wash and under the selection`, () => {
      expect(contrast(PDF_TYPE, page)).toBeGreaterThanOrEqual(4.5);
      for (const wash of WASHES) {
        const ground = over(paint(scheme, `--pt-pdf-hl-${wash}`), page);
        expect(contrast(PDF_TYPE, ground), wash).toBeGreaterThanOrEqual(4.5);
      }
      const selected = over(paint(scheme, '--pt-pdf-selection'), page);
      expect(contrast(PDF_TYPE, selected)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: the flash ring keeps 3:1 on the page and on the lit wash it rings`, () => {
      const ring = colour(scheme, '--pt-pdf-ring');
      expect(contrast(ring, page)).toBeGreaterThanOrEqual(3);
      expect(contrast(ring, over(paint(scheme, '--pt-lit-wash'), page))).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: each highlight's underline ink keeps 3:1 on the page`, () => {
      for (const wash of WASHES) {
        expect(ratioOn(scheme, `--pt-hl-${wash}-ink`, page), wash).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('lamp-lit: the outline a flash leaves behind (data-flash="linger") keeps 3:1', () => {
    const page = colour(DARK, '--pt-pdf-page');
    const rest = Number(DARK.get('--pt-flash-rest'));
    const outline = over({ rgb: colour(DARK, '--pt-pdf-ring'), alpha: rest }, page);
    expect(contrast(outline, page)).toBeGreaterThanOrEqual(3);
  });

  it('lamp-lit: each wash stands off the dimmed page at least as far as off white by day', () => {
    const [day, night] = [colour(LIGHT, '--pt-pdf-page'), colour(DARK, '--pt-pdf-page')];
    for (const wash of WASHES) {
      const byDay = contrast(over(paint(LIGHT, `--pt-pdf-hl-${wash}`), day), day);
      const byLamp = contrast(over(paint(DARK, `--pt-pdf-hl-${wash}`), night), night);
      expect(byLamp, wash).toBeGreaterThanOrEqual(byDay);
    }
  });

  it("lamp-lit: Guided's dark page keeps the plain washes, so its light ink still reads", () => {
    const page = colour(DARK, '--pt-page');
    for (const wash of WASHES) {
      const ground = over(paint(DARK, `--pt-hl-${wash}`), page);
      expect(contrast(colour(DARK, '--pt-ink'), ground), wash).toBeGreaterThanOrEqual(4.5);
    }
  });
});

function ratioOn(
  scheme: Map<string, string>,
  fg: string,
  ground: [number, number, number],
): number {
  return contrast(colour(scheme, fg), ground);
}
