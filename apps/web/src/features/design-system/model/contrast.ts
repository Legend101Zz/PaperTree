/**
 * WCAG 2 contrast maths for the design-system board. Pure: the board reads colours from the live
 * CSS custom properties and this turns two of them into a ratio, so no ratio on the page is typed
 * by hand. The formula is the one `packages/ui/test/tokens.spec.ts` asserts (that spec reads the
 * stylesheet as text; this reads computed colours), so the page and the gate cannot disagree.
 */

/** An sRGB colour, channels 0-255, with its alpha (1 when opaque). */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Parse a computed CSS colour (`rgb(…)`, `rgba(…)` or `rgb(r g b / a)`).
 *
 * @param text The browser's computed `color` string.
 * @returns The colour, or `null` when it is not an rgb form (e.g. empty before mount).
 */
export function parseRgb(text: string): Rgba | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    text.trim(),
  );
  if (m === null) return null;
  const alpha =
    m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha };
}

/**
 * `#RRGGBB` for a colour; the board prints it beside every swatch.
 *
 * @param colour The colour (alpha ignored).
 * @returns Upper-case hex.
 */
export function toHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * WCAG 2 relative luminance.
 *
 * @param colour An sRGB colour.
 * @returns Luminance from 0 (black) to 1 (white).
 */
export function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Contrast ratio of two opaque colours.
 *
 * @param a One colour.
 * @param b The other.
 * @returns The ratio (1 to 21), or `null` when either colour is translucent (a wash has no ratio
 *   of its own: it depends on what is under it).
 */
export function contrastRatio(a: Rgba, b: Rgba): number | null {
  if (a.a < 1 || b.a < 1) return null;
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
