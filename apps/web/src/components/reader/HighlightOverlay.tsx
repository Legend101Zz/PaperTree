'use client';

/**
 * reader/HighlightOverlay — paints one page's highlights from their STORED quads.
 *
 * THE PAINT RULE (contracts.md §6, `@papertree/anchoring`'s `paint.ts`). What this draws is
 * `sourcePaint(anchor, doc, resolution)`: the anchor's own ShapeSelector quads whenever the anchor
 * was captured on these PDF bytes — which, inside one paper, is always — and the ladder's matched
 * range only for a record without usable quads. So a highlight lands on exactly the glyphs that
 * were selected, and a re-parse cannot move it. The baseline painted the whole parsed BLOCK (a
 * median 17x the selection, measured) because every tier returned the block polygon.
 *
 * THERE IS NOTHING TO MEASURE. Every number is IR space. The <svg> is sized to the SCALE-1 page and
 * composited with `transform: scale(zoom × userUnit)`, so zoom costs one transform and the geometry
 * is serialised once per change of the highlights, never per zoom step.
 *
 * WHAT IT LOOKS LIKE. A low-alpha tint the text reads through, plus a darker underline along each
 * line's baseline (the bottom edge of each quad) — the underline is what keeps a pale tint legible
 * and tells colours apart for a reader who cannot. Approximate paint (a ladder answer that is not
 * exact) adds a dashed outline: a different SHAPE, not only a different opacity.
 *
 * NOT A POINTER TARGET. The whole layer is `pointer-events: none`, so a drag that starts on a
 * highlighted word still selects text — a highlight that eats the selection gesture is a highlight
 * nobody can extend or quote. A CLICK on highlighted text is hit-tested by `SourcePane` against the
 * same quads; each highlight is still a focusable button for the keyboard (Enter/Space).
 */

import { useMemo } from 'react';

import { irPolygonToSvgPoints } from '@papertree/anchoring';
import type { BBox, Polygon } from '@papertree/document-ir';

import type { HighlightColor } from '@/lib/api/types';

export interface PaintItem {
  /** The anchor id: one highlight paints one item per anchor. */
  readonly key: string;
  readonly highlightId: string;
  readonly color: HighlightColor;
  readonly pageIndex: number;
  /** IR space. One per disconnected region. */
  readonly polygons: readonly Polygon[];
  /** IR space, one per line run: the underline runs along each one's bottom edge. */
  readonly quads: readonly BBox[];
  readonly approximate: boolean;
  /** The quote, as the accessible name. */
  readonly label: string;
  /** Not yet stored on the server. Drawn paler until it is. */
  readonly saving?: boolean;
}

export interface FlashPaint {
  /** Changes on every flash, so the animation restarts. */
  readonly key: string;
  readonly pageIndex: number;
  readonly polygons: readonly Polygon[];
}

export interface HighlightOverlayProps {
  readonly pageIndex: number;
  /** IR-space page size, i.e. the scale-1 viewport. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly zoom: number;
  /** `Page.user_unit`, applied here with the zoom — IR space deliberately does not carry it. */
  readonly userUnit?: number;
  readonly items: readonly PaintItem[];
  readonly activeHighlightId?: string | null;
  readonly flash?: FlashPaint | null;
  /** Enter or Space on a focused highlight. */
  readonly onActivate?: (highlightId: string, anchorKey: string) => void;
}

interface Region {
  readonly item: PaintItem;
  readonly points: readonly string[];
  readonly lines: readonly (readonly [number, number, number])[];
}

export function HighlightOverlay({
  pageIndex,
  pageWidth,
  pageHeight,
  zoom,
  userUnit = 1,
  items,
  activeHighlightId = null,
  flash = null,
  onActivate,
}: HighlightOverlayProps): JSX.Element {
  // ZOOM IS NOT A DEPENDENCY: the geometry is fixed in IR space; only the transform changes.
  const regions = useMemo<Region[]>(
    () =>
      items
        .filter((item) => item.pageIndex === pageIndex)
        .map((item) => ({
          item,
          points: item.polygons
            .filter((polygon) => polygon.length >= 3)
            .map((polygon) => irPolygonToSvgPoints(polygon)),
          lines: item.quads.map((q) => [q[0], q[2], q[3]] as const),
        })),
    [items, pageIndex],
  );
  const flashPoints = useMemo(
    () =>
      flash !== null && flash.pageIndex === pageIndex
        ? flash.polygons.filter((p) => p.length >= 3).map((p) => irPolygonToSvgPoints(p))
        : [],
    [flash, pageIndex],
  );

  const scale = zoom * userUnit;

  return (
    <svg
      className="pt-highlight-overlay absolute left-0 top-0"
      width={pageWidth}
      height={pageHeight}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      data-page-index={pageIndex}
      data-highlight-count={regions.length}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: '0 0',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      {regions.map(({ item, points, lines }) => (
        <g
          key={item.key}
          className="pt-hl"
          role="button"
          tabIndex={0}
          aria-label={
            item.approximate
              ? `Highlight, approximate location: ${item.label}`
              : `Highlight: ${item.label}`
          }
          data-anchor-id={item.key}
          data-highlight-id={item.highlightId}
          data-color={item.color}
          data-approximate={item.approximate ? 'true' : 'false'}
          data-saving={item.saving === true ? 'true' : 'false'}
          data-active={item.highlightId === activeHighlightId ? 'true' : 'false'}
          onKeyDown={(event) => {
            // An <g> is not a <button>: Enter and Space produce no click, so they are handled here.
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onActivate?.(item.highlightId, item.key);
            }
          }}
        >
          <title>{item.label}</title>
          {points.map((p, index) => (
            <polygon key={`f${String(index)}`} className="pt-hl-fill" points={p} />
          ))}
          {lines.map(([x0, x1, y], index) => (
            <line key={`u${String(index)}`} className="pt-hl-line" x1={x0} y1={y} x2={x1} y2={y} />
          ))}
        </g>
      ))}
      {flashPoints.length === 0 || flash === null ? null : (
        <g key={flash.key} data-flash="true" aria-hidden="true">
          {flashPoints.map((p, index) => (
            <polygon key={String(index)} className="pt-flash" points={p} />
          ))}
        </g>
      )}
    </svg>
  );
}

/** Is the IR point inside any quad of this item? The click hit test `SourcePane` runs. */
export function hitsItem(item: PaintItem, x: number, y: number, slackPt = 1.5): boolean {
  return item.quads.some(
    (q) => x >= q[0] - slackPt && x <= q[2] + slackPt && y >= q[1] - slackPt && y <= q[3] + slackPt,
  );
}
