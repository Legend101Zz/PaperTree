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
 * ONE BAND PER LINE (#346). The stored quads are one per text item, so a line with italics or inline
 * maths is several, and painting them one by one leaves white gaps and steps. At PAINT time the quads
 * of a line are merged (`mergeQuadsPerLine`); what is stored is untouched, so a re-parse still cannot
 * move a highlight. Only a record with no quads at all falls back to its polygons.
 *
 * WHAT IT LOOKS LIKE. A low-alpha tint the text reads through, plus a darker underline along each
 * line's baseline (the bottom edge of each band) — the underline is what keeps a pale tint legible
 * and tells colours apart for a reader who cannot. The LIVE selection is drawn the same way, as
 * bands in the selection token (`selection`), while the native highlight on the text layer is made
 * transparent (`.pt-reader [data-pt-selpaint]`). Approximate paint (a ladder answer that is not
 * exact) adds a dashed outline: a different SHAPE, not only a different opacity.
 *
 * NOT A POINTER TARGET. The whole layer is `pointer-events: none`, so a drag that starts on a
 * highlighted word still selects text — a highlight that eats the selection gesture is a highlight
 * nobody can extend or quote. A CLICK on highlighted text is hit-tested by `SourcePane` against the
 * same quads; each highlight is still a focusable button for the keyboard (Enter/Space).
 */

import { useMemo } from 'react';

import { irPolygonToSvgPoints, mergeQuadsPerLine } from '@papertree/anchoring';
import type { BBox, Polygon } from '@papertree/document-ir';

import type { HighlightColor } from '@/lib/api/types';

import type { FlashSource } from './actions';
import type { FlashPhase } from './flash';

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
  /** IR-space extent of the polygons: where the margin tab sits. */
  readonly extent: BBox | null;
  /** Where it is in its timeline (`reader/flash`): nothing is painted while it scrolls. */
  readonly phase: FlashPhase;
  /** How long its `scroll` phase lasts (0 when the passage was already in view). */
  readonly scrollMs: number;
  /** The numbered marker it came from (#202): "from marker 2 in the answer" in the margin. */
  readonly from?: FlashSource;
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
  /** The live selection's quads on THIS page (IR space), or null: painted as one band per line. */
  readonly selection?: readonly BBox[] | null;
  /** Enter or Space on a focused highlight. */
  readonly onActivate?: (highlightId: string, anchorKey: string) => void;
}

interface Region {
  readonly item: PaintItem;
  readonly points: readonly string[];
  readonly lines: readonly (readonly [number, number, number])[];
}

/** A band as SVG polygon points. */
function bandPoints(b: BBox): string {
  return `${String(b[0])},${String(b[1])} ${String(b[2])},${String(b[1])} ${String(b[2])},${String(b[3])} ${String(b[0])},${String(b[3])}`;
}

/** What one highlight draws: its quads merged per line, or its polygons when it has no quads. */
function regionOf(item: PaintItem): Region {
  const bands = mergeQuadsPerLine(item.quads);
  if (bands.length === 0) {
    return {
      item,
      points: item.polygons.filter((p) => p.length >= 3).map((p) => irPolygonToSvgPoints(p)),
      lines: item.quads.map((q) => [q[0], q[2], q[3]] as const),
    };
  }
  return {
    item,
    points: bands.map(bandPoints),
    lines: bands.map((b) => [b[0], b[2], b[3]] as const),
  };
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
  selection = null,
  onActivate,
}: HighlightOverlayProps): JSX.Element {
  // ZOOM IS NOT A DEPENDENCY: the geometry is fixed in IR space; only the transform changes.
  const regions = useMemo<Region[]>(
    () => items.filter((item) => item.pageIndex === pageIndex).map(regionOf),
    [items, pageIndex],
  );
  const selectionPoints = useMemo(
    () => (selection === null ? [] : mergeQuadsPerLine(selection).map(bandPoints)),
    [selection],
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
      {selectionPoints.length === 0 ? null : (
        <g className="pt-sel" aria-hidden="true" data-selection-bands={selectionPoints.length}>
          {selectionPoints.map((p, index) => (
            <polygon key={String(index)} className="pt-sel-fill" points={p} />
          ))}
        </g>
      )}
      {flashPoints.length === 0 || flash === null || flash.phase === 'scroll' ? null : (
        // `true` while the ring and wash run (their keyframes start as this group mounts, when the
        // scroll is over); `linger` for the faint outline that waits for the next action.
        <g
          key={flash.key}
          data-flash={flash.phase === 'flash' ? 'true' : 'linger'}
          aria-hidden="true"
        >
          {flashPoints.map((p, index) => (
            <polygon
              key={String(index)}
              className={flash.phase === 'flash' ? 'pt-flash' : 'pt-flash pt-flash--linger'}
              points={p}
            />
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
