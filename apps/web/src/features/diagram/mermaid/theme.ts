/**
 * The Mermaid theme of one figure (v0.3): the app's own CSS tokens, read from the figure's computed
 * style at render time, mapped onto Mermaid's `base` theme variables. Nothing here knows which room
 * or page is showing: Light / Sepia / Dark pages and Daylight / Lamp-lit rooms are just different
 * values of the same `--pt-*` tokens (packages/ui styles.css), so a figure re-themes by being read
 * and drawn again. Pure apart from `readTokens`, which touches one element.
 *
 * Mermaid derives and darkens colours with its own parser, which reads hex and comma `rgb()` but
 * not the space-separated alpha form some tokens use, so every colour is normalised to `#rrggbb`
 * here and a token that cannot be read falls back to the daylight value.
 */

/** The tokens a figure is drawn with, each normalised to `#rrggbb` (or the font stack as written). */
export interface FigureTokens {
  readonly ink: string;
  readonly inkMuted: string;
  readonly page: string;
  readonly slip: string;
  readonly rule: string;
  readonly border: string;
  readonly accent: string;
  readonly font: string;
}

/** Daylight, used when a token cannot be read (a test DOM, a not-yet-loaded sheet). */
export const DAYLIGHT: FigureTokens = {
  ink: '#2a2521',
  inkMuted: '#675d53',
  page: '#faf8f3',
  slip: '#ece3d0',
  rule: '#dad3c6',
  border: '#8a7e6e',
  accent: '#7a1f1f',
  font: "'Alegreya Sans', 'Gill Sans', 'Trebuchet MS', sans-serif",
};

const TOKEN_NAMES: Readonly<Record<keyof FigureTokens, string>> = {
  ink: '--pt-ink',
  inkMuted: '--pt-ink-muted',
  page: '--pt-page',
  slip: '--pt-ai-slip',
  rule: '--pt-rule',
  border: '--pt-control-border',
  accent: '--pt-accent',
  font: '--pt-font-ui',
};

type Rgb = readonly [number, number, number];

/**
 * A CSS colour as red, green, blue, or null when it is not a plain opaque colour.
 *
 * @param value A `--pt-*` token's computed value.
 * @returns The channels (0-255), or null.
 */
export function parseColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex !== null) {
    const h =
      (hex[1] as string).length === 3
        ? [...(hex[1] as string)].map((c) => c + c).join('')
        : (hex[1] as string);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*\)$/.exec(text);
  if (fn !== null) {
    const channels = [fn[1], fn[2], fn[3]].map((c) => Math.round(Number(c)));
    if (channels.every((c) => c >= 0 && c <= 255)) return channels as unknown as Rgb;
  }
  return null;
}

const hex2 = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
const toHex = (rgb: Rgb): string => `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;

/**
 * `a` blended toward `b`.
 *
 * @param a The base colour (`#rrggbb`).
 * @param b The colour mixed in.
 * @param amount How much of `b`, 0..1.
 * @returns The blend as `#rrggbb`.
 */
export function mix(a: string, b: string, amount: number): string {
  const x = parseColor(a) ?? [0, 0, 0];
  const y = parseColor(b) ?? [0, 0, 0];
  return toHex([
    x[0] + (y[0] - x[0]) * amount,
    x[1] + (y[1] - x[1]) * amount,
    x[2] + (y[2] - x[2]) * amount,
  ]);
}

/**
 * Whether a background reads as dark (Mermaid's `darkMode` lightens instead of darkening).
 *
 * @param colour A `#rrggbb` background.
 * @returns True for a dark one.
 */
export function isDark(colour: string): boolean {
  const c = parseColor(colour) ?? [255, 255, 255];
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 128;
}

/**
 * The tokens as an element sees them.
 *
 * @param el The figure's element: its computed style carries the room, the page and any panel's own.
 * @returns The tokens, each falling back to daylight when unreadable.
 */
export function readTokens(el: Element): FigureTokens {
  const style = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const key of Object.keys(TOKEN_NAMES) as (keyof FigureTokens)[]) {
    const raw = style.getPropertyValue(TOKEN_NAMES[key]).trim();
    if (key === 'font') out[key] = raw === '' ? DAYLIGHT.font : raw;
    else {
      const rgb = parseColor(raw);
      out[key] = rgb === null ? DAYLIGHT[key] : toHex(rgb);
    }
  }
  return out as unknown as FigureTokens;
}

/**
 * A stable key of the tokens: a theme change is a different key, an unrelated style change is not.
 *
 * @param tokens The tokens.
 * @returns A string to compare or cache by.
 */
export function tokensKey(tokens: FigureTokens): string {
  return Object.values(tokens).join('|');
}

/**
 * Twelve soft fills for the figures that colour by branch (mindmap, timeline), all within the palette.
 *
 * @param t The tokens.
 * @returns Twelve `#rrggbb` fills.
 */
function scale(t: FigureTokens): string[] {
  const tints = [t.accent, t.inkMuted, t.border, t.accent, t.inkMuted, t.border];
  return Array.from({ length: 12 }, (_, i) =>
    mix(t.page, tints[i % 6] as string, 0.1 + 0.05 * (i % 3)),
  );
}

/**
 * Mermaid `base` theme variables for a set of tokens: ink on page, the oxblood accent for emphasis,
 * hairline rules, the UI face. No hue outside the palette is introduced.
 *
 * @param t The tokens.
 * @returns The `themeVariables` object for `mermaid.initialize`.
 */
export function themeVariables(t: FigureTokens): Record<string, unknown> {
  const dark = isDark(t.page);
  const node = mix(t.page, t.rule, 0.55);
  const soft = mix(t.page, t.accent, 0.1);
  const cluster = mix(t.page, t.rule, 0.25);
  const fills = scale(t);
  const vars: Record<string, unknown> = {
    darkMode: dark,
    background: t.page,
    fontFamily: t.font,
    fontSize: '14px',
    primaryColor: node,
    primaryTextColor: t.ink,
    primaryBorderColor: t.border,
    secondaryColor: soft,
    secondaryTextColor: t.ink,
    secondaryBorderColor: t.accent,
    tertiaryColor: cluster,
    tertiaryTextColor: t.ink,
    tertiaryBorderColor: t.rule,
    lineColor: t.inkMuted,
    textColor: t.ink,
    mainBkg: node,
    nodeBorder: t.border,
    nodeTextColor: t.ink,
    clusterBkg: cluster,
    clusterBorder: t.border,
    titleColor: t.ink,
    edgeLabelBackground: t.page,
    labelBackground: t.page,
    labelTextColor: t.ink,
    noteBkgColor: t.slip,
    noteTextColor: t.ink,
    noteBorderColor: t.border,
    actorBkg: node,
    actorBorder: t.border,
    actorTextColor: t.ink,
    actorLineColor: t.inkMuted,
    signalColor: t.ink,
    signalTextColor: t.ink,
    labelBoxBkgColor: node,
    labelBoxBorderColor: t.border,
    loopTextColor: t.ink,
    activationBkgColor: soft,
    activationBorderColor: t.border,
    sequenceNumberColor: t.page,
    transitionColor: t.inkMuted,
    transitionLabelColor: t.ink,
    stateBkg: node,
    stateLabelColor: t.ink,
    compositeBackground: cluster,
    compositeTitleBackground: node,
    compositeBorder: t.border,
    innerEndBackground: t.ink,
    specialStateColor: t.inkMuted,
    classText: t.ink,
    relationColor: t.inkMuted,
    relationLabelColor: t.ink,
    attributeBackgroundColorOdd: node,
    attributeBackgroundColorEven: cluster,
    errorBkgColor: soft,
    errorTextColor: t.ink,
    quadrant1Fill: mix(t.page, t.accent, 0.14),
    quadrant2Fill: mix(t.page, t.inkMuted, 0.1),
    quadrant3Fill: mix(t.page, t.rule, 0.3),
    quadrant4Fill: mix(t.page, t.inkMuted, 0.1),
    quadrant1TextFill: t.ink,
    quadrant2TextFill: t.ink,
    quadrant3TextFill: t.ink,
    quadrant4TextFill: t.ink,
    quadrantPointFill: t.accent,
    quadrantPointTextFill: t.ink,
    quadrantXAxisTextFill: t.inkMuted,
    quadrantYAxisTextFill: t.inkMuted,
    quadrantTitleFill: t.ink,
    quadrantInternalBorderStrokeFill: t.rule,
    quadrantExternalBorderStrokeFill: t.border,
    xyChart: {
      backgroundColor: t.page,
      titleColor: t.ink,
      xAxisTitleColor: t.inkMuted,
      xAxisLabelColor: t.inkMuted,
      xAxisTickColor: t.border,
      xAxisLineColor: t.border,
      yAxisTitleColor: t.inkMuted,
      yAxisLabelColor: t.inkMuted,
      yAxisTickColor: t.border,
      yAxisLineColor: t.border,
      plotColorPalette: [t.accent, t.inkMuted, t.border, t.ink].join(','),
    },
  };
  fills.forEach((fill, i) => {
    vars[`cScale${String(i)}`] = fill;
    vars[`cScaleLabel${String(i)}`] = t.ink;
    vars[`cScaleInv${String(i)}`] = t.ink;
  });
  return vars;
}
