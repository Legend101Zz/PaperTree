'use client';

/**
 * reader/HighlightOverlay — paints resolved anchors over one page.
 *
 * THERE IS NOTHING TO MEASURE. Every number below comes from the IR and the zoom scalar. No
 * `getClientRects()`, no `getBoundingClientRect()`, no `offsetWidth`, no percentage of a DOM node.
 * The v1 reader divided `getClientRects()` by `window.innerWidth` at capture and treated the result
 * as a fraction of the page element at paint, which is why its highlights land wrong on creation,
 * move on resize and differ per device. `packages/anchoring/test/zoom.spec.ts` is the tripwire on
 * that: it passes at ~1e-13 pt BY CONSTRUCTION, and it stops passing the day a DOM read reappears
 * in this path.
 *
 * THE ARCHITECTURE, in one line: the <svg> is sized to the SCALE-1 viewport (`pageWidth` x
 * `pageHeight`, IR points) and scaled with `transform: scale(zoom * userUnit); transform-origin: 0 0`.
 * Zoom therefore costs ONE composited transform. `points` strings are memoised on the resolutions
 * alone — `zoom` is deliberately not in that dependency list, and adding it would silently turn
 * every zoom step into an O(vertices) re-serialisation of the whole page.
 *
 * POLYGONS, NOT RECTANGLES. `Resolution.polygons` has more than one entry exactly when the region
 * is disconnected — which is what a selection crossing the gutter of a two-column paper is. Each
 * one gets its own <polygon>. Flattening to a bounding box paints over the gutter, and
 * `unionOfLineRects` exists precisely so that never has to happen.
 *
 * NOTHING IS SILENTLY OMITTED. An anchor that resolved to this page but produced no paintable
 * geometry gets a visible page-level pin rather than disappearing; an approximate one gets a dashed
 * outline and its own "approximate location" affordance. `reparse.spec`'s requirement is that every
 * failure reaches the user, and a highlight that is simply absent satisfies nothing.
 */

import { useMemo } from 'react';

import {
  extentOf,
  irPolygonToSvgPoints,
  type AnchorFailureReason,
  type Resolution,
  type ResolutionState,
} from '@papertree/anchoring';
import type { BBox } from '@papertree/document-ir';

/** WCAG 2.5.5 / the iPad line of the wireframe (§19.5): every tap target is at least this, in CSS px. */
const MIN_TARGET_CSS_PX = 44;

/** Stroke and dash lengths are divided by the scale so they stay constant in CSS px across zoom. */
const OUTLINE_CSS_PX = 1.5;
const DASH_CSS_PX = 6;

export interface HighlightOverlayItem {
  readonly anchorId: string;
  readonly resolution: Resolution;
  /** The stored quote. Becomes the accessible name — a highlight with no name is unreachable. */
  readonly label?: string;
}

export interface HighlightOverlayProps {
  /** The page this overlay covers. Items resolving elsewhere are ignored, not hidden. */
  readonly pageIndex: number;
  /** IR-space page size, i.e. the scale-1 viewport. `Page.width` / `Page.height`, unscaled. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly zoom: number;
  /** `Page.user_unit`. APPLIED here with the zoom — IR space deliberately does not carry it. */
  readonly userUnit?: number;
  readonly items: readonly HighlightOverlayItem[];
  readonly activeAnchorId?: string | null;
  readonly onActivate?: (anchorId: string) => void;
  /** Tapping the "approximate location" badge. Falls back to `onActivate`. */
  readonly onExplainApproximate?: (anchorId: string, resolution: Resolution) => void;
  /** Tapping an unplaceable anchor's pin. This is the route to `UnanchoredTray`. */
  readonly onOpenUnanchoredTray?: (anchorId: string) => void;
  readonly className?: string;
}

interface PaintedRegion {
  readonly anchorId: string;
  readonly state: ResolutionState;
  readonly approximate: boolean;
  readonly label: string;
  /** One SVG `points` string per polygon. Serialised ONCE, never on zoom. */
  readonly points: readonly string[];
  readonly extent: BBox;
  /** IR-space height of the shortest band, so the hit padding can be sized from it. */
  readonly minBandHeight: number;
}

interface UnplacedRegion {
  readonly anchorId: string;
  readonly label: string;
  readonly reason: AnchorFailureReason | undefined;
}

/** Human text for the reason codes the overlay can surface. `UnanchoredTray` owns the long form. */
const SHORT_REASON: Record<AnchorFailureReason, string> = {
  block_id_missing: 'the paragraph it was on is no longer in this parse',
  block_text_changed: 'the paragraph it was on now has different text',
  quote_below_threshold: 'the quoted text could not be found confidently',
  quote_too_short_no_context: 'the quote was too short to find on its own',
  no_geometric_overlap: 'nothing on the page overlaps where it was',
  section_not_found: 'the section it was in is gone',
  page_out_of_range: 'that page no longer exists',
  no_selectors: 'the record carries no selectors',
};

function buildRegions(
  items: readonly HighlightOverlayItem[],
  pageIndex: number,
): { painted: PaintedRegion[]; unplaced: UnplacedRegion[] } {
  const painted: PaintedRegion[] = [];
  const unplaced: UnplacedRegion[] = [];

  for (const item of items) {
    const resolution = item.resolution;
    if (resolution.pageIndex !== pageIndex) continue;

    const label = item.label ?? 'highlight';
    const usable = resolution.polygons.filter((polygon) => polygon.length >= 3);
    const extent = extentOf(usable);

    if (usable.length === 0 || extent === null) {
      unplaced.push({ anchorId: item.anchorId, label, reason: resolution.reason });
      continue;
    }

    let minBandHeight = Number.POSITIVE_INFINITY;
    for (const polygon of usable) {
      const bounds = extentOf([polygon]);
      if (bounds !== null) minBandHeight = Math.min(minBandHeight, bounds[3] - bounds[1]);
    }

    painted.push({
      anchorId: item.anchorId,
      state: resolution.state,
      approximate: resolution.approximate || resolution.state === 'approximate',
      label,
      points: usable.map((polygon) => irPolygonToSvgPoints(polygon)),
      extent,
      minBandHeight: Number.isFinite(minBandHeight) ? minBandHeight : 0,
    });
  }

  return { painted, unplaced };
}

export function HighlightOverlay({
  pageIndex,
  pageWidth,
  pageHeight,
  zoom,
  userUnit = 1,
  items,
  activeAnchorId = null,
  onActivate,
  onExplainApproximate,
  onOpenUnanchoredTray,
  className,
}: HighlightOverlayProps): JSX.Element {
  // ZOOM IS NOT A DEPENDENCY. That is the whole architecture in one line: the geometry is fixed in
  // IR space and only the CSS transform below changes when the user zooms.
  const { painted, unplaced } = useMemo(() => buildRegions(items, pageIndex), [items, pageIndex]);

  const scale = zoom * userUnit;
  // Counter-scale for anything that must stay a constant size on screen (strokes, badges). Guarded
  // because a zoom of 0 is a legitimate transient while a viewer initialises, and 1/0 would poison
  // every transform attribute with `Infinity`.
  const inverse = scale > 0 ? 1 / scale : 1;

  return (
    <svg
      className={`pt-highlight-overlay absolute left-0 top-0${className === undefined ? '' : ` ${className}`}`}
      width={pageWidth}
      height={pageHeight}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      data-page-index={pageIndex}
      data-unplaced-count={unplaced.length}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: '0 0',
        // The layer never eats a scroll, a pinch or a text selection; individual regions opt back in.
        pointerEvents: 'none',
        touchAction: 'manipulation',
        overflow: 'visible',
      }}
    >
      {painted.map((region) => {
        const active = region.anchorId === activeAnchorId;
        // A line band is ~12 pt tall and can never be 44 CSS px on its own without lying about the
        // geometry. So the PAINT stays exact and a transparent stroke widens only the HIT area to
        // the 44 px minimum — `pointer-events: all` makes an unpainted stroke hit-testable.
        const hitPadCssPx = Math.max(0, MIN_TARGET_CSS_PX - region.minBandHeight * scale);

        return (
          <g
            key={region.anchorId}
            role="button"
            tabIndex={0}
            aria-label={
              region.approximate
                ? `Highlight, approximate location: ${region.label}`
                : `Highlight: ${region.label}`
            }
            data-anchor-id={region.anchorId}
            data-state={region.state}
            data-approximate={region.approximate ? 'true' : 'false'}
            style={{ pointerEvents: 'auto', touchAction: 'manipulation', cursor: 'pointer' }}
            onPointerUp={() => onActivate?.(region.anchorId)}
            onKeyDown={(event) => {
              // An <g> is not a <button>: Enter and Space produce no click, so they are handled here.
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onActivate?.(region.anchorId);
              }
            }}
          >
            <title>{region.approximate ? `${region.label} (approximate location)` : region.label}</title>

            {region.points.map((points, index) => (
              <polygon
                key={`paint-${String(index)}`}
                points={points}
                // Approximate regions are a DASHED OUTLINE over a much fainter tint: the user must
                // be able to tell "this is where you highlighted" from "this is roughly where we
                // think it was" without reading anything.
                fill={
                  region.approximate
                    ? 'rgba(245, 158, 11, 0.12)'
                    : active
                      ? 'rgba(250, 204, 21, 0.45)'
                      : 'rgba(250, 204, 21, 0.28)'
                }
                stroke={region.approximate ? 'rgba(180, 83, 9, 0.95)' : 'rgba(202, 138, 4, 0.55)'}
                strokeWidth={OUTLINE_CSS_PX * inverse}
                strokeDasharray={
                  region.approximate ? `${DASH_CSS_PX * inverse} ${DASH_CSS_PX * inverse}` : undefined
                }
                strokeLinejoin="round"
                pointerEvents="none"
              />
            ))}

            {region.points.map((points, index) => (
              <polygon
                key={`hit-${String(index)}`}
                points={points}
                fill="none"
                stroke="transparent"
                strokeWidth={hitPadCssPx * inverse}
                strokeLinejoin="round"
                pointerEvents="all"
              />
            ))}
          </g>
        );
      })}

      {/*
        The approximate-location affordance. Counter-scaled so it is 44x44 CSS px at EVERY zoom —
        a badge that scales with the page is 22 px at 50 % and fails the touch-target rule exactly
        where the user is most likely to be on a tablet.
      */}
      {painted
        .filter((region) => region.approximate)
        .map((region) => {
          const explain = (): void => {
            if (onExplainApproximate === undefined) {
              onActivate?.(region.anchorId);
              return;
            }
            onExplainApproximate(region.anchorId, resolutionFor(items, region.anchorId));
          };
          return (
          <g
            key={`approx-${region.anchorId}`}
            transform={`translate(${region.extent[0]} ${region.extent[1]}) scale(${inverse})`}
            role="button"
            tabIndex={0}
            aria-label={`Approximate location — we could not place "${region.label}" exactly. Open details.`}
            style={{ pointerEvents: 'auto', touchAction: 'manipulation', cursor: 'help' }}
            onPointerUp={explain}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                explain();
              }
            }}
          >
            <title>Approximate location — this highlight could not be placed exactly.</title>
            <rect
              x={-MIN_TARGET_CSS_PX}
              y={-MIN_TARGET_CSS_PX}
              width={MIN_TARGET_CSS_PX}
              height={MIN_TARGET_CSS_PX}
              rx={8}
              fill="rgba(180, 83, 9, 0.92)"
            />
            <text
              x={-MIN_TARGET_CSS_PX / 2}
              y={-MIN_TARGET_CSS_PX / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={18}
              fill="#fff"
              aria-hidden="true"
            >
              {'≈'}
            </text>
          </g>
          );
        })}

      {/*
        Resolved to THIS page but with no paintable geometry — a `guided_para` target, or a tier
        that could name the page and nothing finer. It gets a pin at the page corner rather than
        vanishing. Deleting or hiding a failed anchor is the one thing Hypothesis's 2017 orphans
        decision rules out.
      */}
      {unplaced.map((item, index) => (
        <g
          key={`unplaced-${item.anchorId}`}
          transform={`translate(${MIN_TARGET_CSS_PX * inverse * (index + 0.25)} ${MIN_TARGET_CSS_PX * inverse * 0.25}) scale(${inverse})`}
          role="button"
          tabIndex={0}
          aria-label={`Unplaced highlight on this page: ${item.label}${
            item.reason === undefined ? '' : ` — ${SHORT_REASON[item.reason]}`
          }. Open the unanchored tray.`}
          style={{ pointerEvents: 'auto', touchAction: 'manipulation', cursor: 'pointer' }}
          onPointerUp={() => onOpenUnanchoredTray?.(item.anchorId)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpenUnanchoredTray?.(item.anchorId);
            }
          }}
        >
          <title>
            {item.reason === undefined
              ? 'This highlight belongs to this page but could not be placed on it.'
              : `Could not be placed: ${SHORT_REASON[item.reason]}.`}
          </title>
          <rect
            width={MIN_TARGET_CSS_PX}
            height={MIN_TARGET_CSS_PX}
            rx={8}
            fill="rgba(120, 113, 108, 0.92)"
          />
          <text
            x={MIN_TARGET_CSS_PX / 2}
            y={MIN_TARGET_CSS_PX / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={20}
            fill="#fff"
            aria-hidden="true"
          >
            {'⚬'}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** The resolution behind a painted region, for the callbacks that want the whole verdict. */
function resolutionFor(items: readonly HighlightOverlayItem[], anchorId: string): Resolution {
  const found = items.find((item) => item.anchorId === anchorId);
  if (found === undefined) {
    throw new Error(`HighlightOverlay: no item ${anchorId}; the painted list is derived from items`);
  }
  return found.resolution;
}
