'use client';

/**
 * The page's ink (S5c, #208): every stored stroke decoded by `stroke.ts` and outlined by
 * `perfect-freehand` (`outline.ts`) into ONE SVG in page units, under the items. Paths are derived
 * once per stroke and cached; new ink is drawn by `InkSurface` (S5d, #209). Highlighter washes
 * paint first, under the pen, in their own blend group (`--pt-nb-hl-blend`). Each path carries
 * its stroke id, so the eraser can hide what it touches without a render. Colours are token names
 * mapped to `--pt-*`, set as a style because an SVG presentation attribute does not resolve `var()`.
 */
import { memo, useMemo } from 'react';

import { strokeToPath } from '../model/outline';

import type { Stroke } from '../model/stroke';
import type { ReactNode } from 'react';

/** Props for `InkLayer`. */
export interface InkLayerProps {
  readonly strokes: readonly Stroke[];
  /** Page height in page units (the width is always `PAGE_WIDTH`). */
  readonly height: number;
  readonly width: number;
  /**
   * Announce the layer as "Your handwriting". Default true; false for a second layer on the same
   * page, so the ink is announced once. No count: like the panel's "Ink: yours", it says whose.
   */
  readonly labelled?: boolean;
  /** Draw only this box of the page (the phone's view-only strip, S5e), in page units. */
  readonly crop?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** A token name is letters, digits and dashes; anything else falls back to the pen colour. */
const TOKEN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The CSS colour for a stroke's token name.
 *
 * @param token - E.g. `pen` or `hl-amber`.
 * @returns `var(--pt-<token>)`, or the pen colour for a name that is not a token.
 */
export function inkColour(token: string): string {
  return TOKEN.test(token) ? `var(--pt-${token}, var(--pt-pen))` : 'var(--pt-pen)';
}

/**
 * Outline `d` strings by stroke object. Strokes are immutable and history keeps the same object
 * for a stroke that did not change, so moving one note never re-outlines 500 strokes.
 */
const OUTLINES = new WeakMap<Stroke, string>();

function outlineOf(stroke: Stroke): string {
  const known = OUTLINES.get(stroke);
  if (known !== undefined) return known;
  const d = strokeToPath(stroke);
  OUTLINES.set(stroke, d);
  return d;
}

/** All strokes of a page as filled outlines. */
export const InkLayer = memo(function InkLayer({
  strokes,
  height,
  width,
  labelled = true,
  crop,
}: InkLayerProps): ReactNode {
  const paths = useMemo(
    () =>
      strokes.map((s) => ({
        id: s.id,
        d: outlineOf(s),
        fill: inkColour(s.color),
        wash: s.tool === 'highlighter',
      })),
    [strokes],
  );
  if (paths.length === 0) return null;
  const draw = (p: (typeof paths)[number]): ReactNode => (
    <path key={p.id} data-stroke-id={p.id} d={p.d} style={{ fill: p.fill }} />
  );
  return (
    <svg
      className="pt-nb-ink"
      width={width}
      height={height}
      viewBox={
        crop === undefined
          ? `0 0 ${String(width)} ${String(height)}`
          : [crop.x, crop.y, crop.width, crop.height].map(String).join(' ')
      }
      {...(labelled
        ? { role: 'img', 'aria-label': 'Your handwriting (not searchable)' }
        : { 'aria-hidden': true })}
    >
      <g className="pt-nb-ink__wash">{paths.filter((p) => p.wash).map(draw)}</g>
      {paths.filter((p) => !p.wash).map(draw)}
    </svg>
  );
});
