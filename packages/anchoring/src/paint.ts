/**
 * anchoring/paint — WHERE a highlight is drawn in Source, which is a different question from which
 * blocks it LINKS to (contracts.md §6, ADR-002 §3.2).
 *
 * THE RULE. In Source mode an anchor with a `ShapeSelector` whose `doc.pdfSha256` equals the
 * paper's `source_hash` paints its STORED quads. The T0–T6 ladder only LINKS the anchor to blocks —
 * for Guided marks, the Navigator, AI seeds and canvas "open source". A re-parse changes links,
 * never paint.
 *
 * WHY. The glyphs are a property of the PDF's bytes, and the bytes are immutable: `paper_id` is
 * derived from them, so inside one paper the hashes are always equal. The judge measured what
 * re-deriving geometry from a new parse costs — the same 40 characters captured on two parses of
 * the same PDF have union extents that differ by a median 0.00 pt but up to 5.57 pt (p90 3.04 pt),
 * because the line-band clamp depends on segmentation (`quads_invariance.mts`, MEASURED). Painting
 * the stored quads makes a highlight byte-identical across reload, zoom, mode switch and re-parse.
 *
 * WHEN THE STORED QUADS CANNOT BE USED — a foreign `pdfSha256` (an anchor from another PDF), or no
 * quads at all (a citation minted before geometry, a legacy row) — the ladder's own geometry paints,
 * and that geometry is the matched RANGE for a confirmed tier (`resolve.ts#geometryOfRanges`).
 *
 * AN ORPHAN is an anchor with no usable stored quads AND a ladder that found nothing. It goes to
 * the unanchored tray with its quote and reason and is painted NOWHERE — least of all on whatever
 * text now sits where it used to be.
 */

import { unionOfLineRects, type BBox, type Polygon } from '@papertree/document-ir';

import type { IndexedDocument } from './document.js';
import type { Anchor, Resolution, ShapeSelector } from './types.js';

/** Where a highlight's paint came from. `stored` is exact by construction. */
export type PaintSource = 'stored' | 'ladder';

export interface SourcePaint {
  readonly pageIndex: number;
  /** IR space. One per disconnected region (a selection across a column gutter is two). */
  readonly polygons: readonly Polygon[];
  /** IR space, one per span run on a line — the underline is drawn along each one's bottom edge. */
  readonly quads: readonly BBox[];
  readonly source: PaintSource;
  /** Only a ladder paint can be approximate. Stored quads are the user's own geometry. */
  readonly approximate: boolean;
}

function shapeOf(anchor: Anchor): ShapeSelector | undefined {
  return anchor.selectors.find((s): s is ShapeSelector => s.type === 'ShapeSelector');
}

function isQuad(value: unknown): value is BBox {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    (value[2] as number) > (value[0] as number) &&
    (value[3] as number) > (value[1] as number)
  );
}

/**
 * The stored ShapeSelector, when contracts.md §6 allows it to be painted on `doc`.
 *
 * STRICT identity, unlike the ladder's T4 gate: T4 treats an EMPTY hash on either side as "same
 * document" so that hash-less test fixtures still resolve geometrically. Paint is not a guess, so
 * an absent hash never qualifies — a quad drawn on the wrong PDF is exactly the defect the rule
 * exists to prevent.
 */
export function usableStoredShape(anchor: Anchor, doc: IndexedDocument): ShapeSelector | null {
  const shape = shapeOf(anchor);
  if (shape === undefined) return null;
  if (anchor.doc.pdfSha256.length === 0 || anchor.doc.pdfSha256 !== doc.sourceHash) return null;
  if (!shape.quads.some(isQuad)) return null;
  // A page the document does not have is not paintable, whatever the hash says. `doc.pages` is
  // empty while a paper is still being read (Source renders from pdf.js alone), and then the page
  // count is not known here — the overlay only mounts on pages that exist, so nothing mis-paints.
  if (doc.pages.length > 0 && !doc.pages.some((page) => page.index === shape.pageIndex))
    return null;
  return shape;
}

/**
 * The Source paint for one anchor, or `null` when there is nothing to draw.
 *
 * `resolution` is the ladder's verdict on the same `doc` (what `resolveAnchor` returned). It is
 * consulted only when the stored quads are unusable.
 */
export function sourcePaint(
  anchor: Anchor,
  doc: IndexedDocument,
  resolution: Resolution,
): SourcePaint | null {
  const shape = usableStoredShape(anchor, doc);
  if (shape !== null) {
    const quads = shape.quads.filter(isQuad);
    const stored = shape.polygons.filter((polygon) => polygon.length >= 3);
    return {
      pageIndex: shape.pageIndex,
      // The stored polygons are `unionOfLineRects(quads)` at capture. Re-deriving them from the
      // quads is the fallback for a record that carried quads only, never a replacement.
      polygons: stored.length > 0 ? stored : unionOfLineRects(quads),
      quads,
      source: 'stored',
      approximate: false,
    };
  }
  if (resolution.state === 'orphan' || resolution.pageIndex === null) return null;
  const polygons = resolution.polygons.filter((polygon) => polygon.length >= 3);
  if (polygons.length === 0) return null;
  return {
    pageIndex: resolution.pageIndex,
    polygons,
    quads: resolution.quads,
    source: 'ladder',
    approximate: resolution.approximate || resolution.state === 'approximate',
  };
}

/**
 * Does this anchor belong in the unanchored tray while reading Source?
 *
 * Only when it can be painted nowhere: no usable stored quads and an orphaned ladder. An anchor
 * whose stored quads paint but whose text the current parse cannot find is NOT an orphan — the user
 * sees their highlight exactly where they made it; only its links (Guided, Navigator grouping) are
 * missing, and those surfaces say so themselves.
 */
export function isSourceOrphan(
  anchor: Anchor,
  doc: IndexedDocument,
  resolution: Resolution,
): boolean {
  return sourcePaint(anchor, doc, resolution) === null && resolution.state === 'orphan';
}
