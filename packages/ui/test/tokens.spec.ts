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

/** A token's contrast against an already composited ground (a wash over the page, say). */
function ratioOn(
  scheme: Map<string, string>,
  fg: string,
  ground: [number, number, number],
): number {
  return contrast(colour(scheme, fg), ground);
}

const WASHES = ['amber', 'green', 'blue', 'pink', 'purple'] as const;

/** The three pages (#345): their tokens live in blocks keyed on `data-pt-page`, not on the room. */
const PAGES = {
  light: declarations(rule(":root,\n:root[data-pt-page='light']")),
  sepia: declarations(rule(":root[data-pt-page='sepia']")),
  dark: declarations(rule(":root[data-pt-page='dark']")),
} as const;

type RGB = [number, number, number];

/** WCAG 2 screen blend, which is how the dark page puts its type on its ground (pdfPage.css). */
function screen(a: RGB, b: RGB): RGB {
  return a.map((c, i) => 255 - ((255 - c) * (255 - b[i]!)) / 255) as RGB;
}

/**
 * The colour of PDF type on each page. pdf.js paints black. Light and Sepia leave it black (sepia
 * multiplies the canvas); Dark inverts it to white, multiplies by the ink and screens it onto the
 * page, which lands on the ink to within a level (pdfPage.css), a hair lighter than the token.
 */
function typeOn(name: keyof typeof PAGES): RGB {
  const scheme = PAGES[name];
  return name === 'dark'
    ? screen(colour(scheme, '--pt-pdf-ink'), colour(scheme, '--pt-pdf-page'))
    : [0, 0, 0];
}

describe('the paper in Light, Sepia and Dark (#345; #205, frame 09b)', () => {
  for (const name of ['light', 'sepia', 'dark'] as const) {
    const scheme = PAGES[name];
    const page = colour(scheme, '--pt-pdf-page');

    it(`${name}: PDF type reads at 4.5:1 on the page, on every wash and under the selection`, () => {
      expect(contrast(typeOn(name), page)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(scheme, '--pt-pdf-ink', '--pt-pdf-page')).toBeGreaterThanOrEqual(4.5);
      for (const wash of WASHES) {
        const ground = over(paint(scheme, `--pt-pdf-hl-${wash}`), page);
        expect(contrast(typeOn(name), ground), wash).toBeGreaterThanOrEqual(4.5);
      }
      const selected = over(paint(scheme, '--pt-pdf-selection'), page);
      expect(contrast(typeOn(name), selected)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: the flash ring keeps 3:1 on the page and on the lit wash it rings`, () => {
      const ring = colour(scheme, '--pt-pdf-ring');
      expect(contrast(ring, page)).toBeGreaterThanOrEqual(3);
      expect(contrast(ring, over(paint(scheme, '--pt-pdf-lit-wash'), page))).toBeGreaterThanOrEqual(
        3,
      );
    });

    it(`${name}: the outline a flash leaves behind (data-flash="linger") keeps 3:1`, () => {
      const rest = Number(scheme.get('--pt-flash-rest'));
      const outline = over({ rgb: colour(scheme, '--pt-pdf-ring'), alpha: rest }, page);
      expect(contrast(outline, page)).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: each highlight's underline ink keeps 3:1 on the page, and each wash shows`, () => {
      for (const wash of WASHES) {
        expect(ratioOn(scheme, `--pt-pdf-hl-${wash}-ink`, page), wash).toBeGreaterThanOrEqual(3);
        const ground = over(paint(scheme, `--pt-pdf-hl-${wash}`), page);
        expect(contrast(ground, page), wash).toBeGreaterThanOrEqual(1.3);
      }
    });

    it(`${name}: Guided's ink, links and highlights read on its sheet`, () => {
      const sheet = colour(scheme, '--pt-guided-page');
      for (const token of ['ink', 'ink-2', 'ink-muted', 'link'] as const) {
        expect(ratioOn(scheme, `--pt-guided-${token}`, sheet), token).toBeGreaterThanOrEqual(4.5);
      }
      for (const token of ['border', 'focus'] as const) {
        expect(ratioOn(scheme, `--pt-guided-${token}`, sheet), token).toBeGreaterThanOrEqual(3);
      }
      for (const wash of WASHES) {
        const ground = over(paint(scheme, `--pt-pdf-hl-${wash}`), sheet);
        expect(ratioOn(scheme, '--pt-guided-ink', ground), wash).toBeGreaterThanOrEqual(4.5);
        expect(ratioOn(scheme, `--pt-pdf-hl-${wash}-ink`, sheet), wash).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('Sepia and Dark put figures on a padded mat with an edge; Light has none', () => {
    expect(PAGES.light.get('--pt-pdf-mat')).toBe('transparent');
    expect(PAGES.light.get('--pt-pdf-mat-pad')).toBe('0px');
    for (const name of ['sepia', 'dark'] as const) {
      expect(PAGES[name].get('--pt-pdf-mat-pad'), name).toBe('10px');
      expect(ratio(PAGES[name], '--pt-pdf-mat-edge', '--pt-pdf-mat'), name).toBeGreaterThanOrEqual(
        1.5,
      );
    }
  });

  for (const name of ['light', 'sepia', 'dark'] as const) {
    const scheme = PAGES[name];
    const page = colour(scheme, '--pt-pdf-page');
    const mat =
      scheme.get('--pt-pdf-mat') === 'transparent' ? page : colour(scheme, '--pt-pdf-mat');

    it(`${name}: a picked picture's edge keeps 3:1 on the page and on the figure's mat (#348)`, () => {
      const edge = colour(scheme, '--pt-pdf-img-edge');
      expect(contrast(edge, page)).toBeGreaterThanOrEqual(3);
      expect(contrast(edge, mat)).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: its handles are drawn in the edge's colour on a fill that keeps 3:1 against it, and its chip reads`, () => {
      const edge = colour(scheme, '--pt-pdf-img-edge');
      expect(ratioOn(scheme, '--pt-pdf-img-handle', edge)).toBeGreaterThanOrEqual(3);
      expect(ratioOn(scheme, '--pt-pdf-img-chip-ink', edge)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: the faint outline of a float under the pointer shows on the page, and its wash does not hide the type`, () => {
      const hover = over(paint(scheme, '--pt-pdf-img-hover'), page);
      expect(contrast(hover, page)).toBeGreaterThanOrEqual(2);
      const washed = over(paint(scheme, '--pt-pdf-img-wash'), page);
      expect(contrast(typeOn(name), washed)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('dark: each wash stands off the page at least as far as off white by day', () => {
    const [day, night] = [
      colour(PAGES.light, '--pt-pdf-page'),
      colour(PAGES.dark, '--pt-pdf-page'),
    ];
    for (const wash of WASHES) {
      const byDay = contrast(over(paint(PAGES.light, `--pt-pdf-hl-${wash}`), day), day);
      const byNight = contrast(over(paint(PAGES.dark, `--pt-pdf-hl-${wash}`), night), night);
      expect(byNight, wash).toBeGreaterThanOrEqual(byDay);
    }
  });

  it("Guided's sheet and its figure crops read the page's tokens, not the room's", () => {
    const sheet = rule('.pt-guided__sheet');
    expect(property(sheet, 'background')).toBe('var(--pt-guided-page)');
    expect(property(sheet, 'color')).toBe('var(--pt-guided-ink)');
    // the room's ink tokens are re-declared inside the sheet, so everything in it follows the page
    expect(property(sheet, '--pt-ink')).toBe('var(--pt-guided-ink)');
    expect(property(sheet, '--pt-primary')).toBe('var(--pt-guided-link)');
    const crops = rule('.pt-guided__sheet .pt-figure__crop,\n.pt-guided__sheet .pt-equation__crop');
    expect(property(crops, 'background')).toBe('var(--pt-pdf-mat)');
    expect(property(crops, 'padding')).toBe('var(--pt-pdf-mat-pad)');
  });

  it('the room does not set the paper: neither dark block declares a page token', () => {
    const explicit = rule(":root.dark,\n:root[data-pt-theme='dark']");
    const media =
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-pt-theme='light'\]\) \{([^}]*)\}/.exec(
        CSS,
      )?.[1] ?? '';
    expect(media).not.toBe('');
    for (const block of [explicit, media]) {
      expect(block).not.toMatch(/--pt-(pdf|guided)-|--pt-flash-rest/);
    }
  });
});

/** One property's value in a rule body (`color`, `background`, …), comments stripped. */
function property(block: string, name: string): string | undefined {
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, '');
  return new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;]+);`).exec(clean)?.[1]?.trim();
}

/** The token a plain `var(--pt-…)` value reads. */
function tokenOf(value: string | undefined): string {
  const name = /^var\((--pt-[a-z0-9-]+)\)$/.exec(value ?? '')?.[1];
  if (name === undefined) throw new Error(`not a plain token read: ${value ?? 'undefined'}`);
  return name;
}

// PR #302's axe failure (the opened book's Summary button at 1440 lamp-lit): the shared button
// rule eased `background-color` over 120 ms, and a scheme change eased the fill too while the ink
// snapped, so for a moment the label was lamp-lit ink on daylight's page (#ede4d3 on #faf8f3,
// 1.18:1, measured). The settled pair below never changed; the transition list is the guard.
describe('the filled buttons through a scheme change (#200)', () => {
  const base = rule('.pt-button,\n.pt-toolbtn');
  const FILLED = ['secondary', 'primary', 'danger'] as const;

  for (const [name, scheme] of [
    ['daylight', LIGHT],
    ['lamp-lit', DARK],
  ] as const) {
    it.each(FILLED)(`${name}: the %s button's label reads at 4.5:1 on its fill`, (variant) => {
      const own = rule(`.pt-button--${variant}`);
      const ink = tokenOf(property(own, 'color') ?? property(base, 'color'));
      const fill = tokenOf(property(own, 'background'));
      expect(ratio(scheme, ink, fill)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('no button rule eases its fill or its ink, so a scheme change repaints both at once', () => {
    const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders: string[] = [];
    for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1]!.trim();
      if (!/\.pt-(button|toolbtn)\b/.test(selector)) continue;
      for (const t of m[2]!.matchAll(/(?:^|[;\s])transition(?:-property)?\s*:\s*([^;]+)/g)) {
        const eased = t[1]!.split(',').map((item) => item.trim().split(/\s+/)[0]);
        const colours = eased.filter((p) => /^(all|background(-color)?|color)$/.test(p ?? ''));
        if (colours.length > 0)
          offenders.push(`${selector.replace(/\s+/g, ' ')}: ${colours.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
