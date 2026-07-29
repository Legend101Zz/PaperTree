/**
 * document-ir/geometry — the coordinate contract (F0.4).
 *
 * ADR-001 Commitment 2: geometry is stored in PDF USER SPACE, POINTS, ORIGIN TOP-LEFT, normalised
 * exactly ONCE at parse time, alongside the page's width, height, rotation and user_unit. Never
 * viewport pixels, never fractions of a DOM element. Regions are POLYGONS, not rectangles, because
 * a selection spanning lines in a two-column layout is not a rectangle and flattening it to a
 * bounding box is what makes highlights bleed across columns (findings.md).
 *
 * There are exactly three coordinate spaces in this codebase and this file is the only place any
 * of them is converted into another:
 *
 *   1. RAW PDF SPACE      what the file says. Origin BOTTOM-LEFT, y UP, relative to the MediaBox,
 *                         /Rotate not applied, /UserUnit not applied.
 *   2. IR SPACE           what PaperIR stores. Origin TOP-LEFT of the page's post-rotation crop
 *                         rect, y DOWN, /Rotate applied, /UserUnit *deliberately NOT applied*,
 *                         units = PDF default user space (1/72 in).
 *   3. VIEWPORT SPACE     what a reader renders. IR space scaled by zoom * userUnit and rotated by
 *                         the *viewer's* extra rotation. Ephemeral; never stored.
 *
 * ─── THE /UserUnit BOUNDARY, stated explicitly because it is the classic silent fork ───────────
 *
 * ADR-001 Amendment 1 § "COORDINATE FRAME" pins that /UserUnit is NOT applied to the frame the
 * block id is computed in. The acceptance test `document-ir/geometry.spec` separately requires the
 * viewport transform to HANDLE userUnit != 1. Both are true and they are not in tension:
 *
 *     IR space  = default user space units.       userUnit is RECORDED (Page.user_unit) only.
 *     VIEWPORT  = IR space * zoom * userUnit.     userUnit is APPLIED here, and ONLY here.
 *
 * `normalisePageFrame` / `normalisePoint` therefore never multiply by userUnit; `pdfToViewport` /
 * `viewportToPdf` always do. Amendment 1 § C.6 measured the cost of getting an unstated frame
 * convention wrong at 99.93 % of block ids, so the boundary is a named function, not a comment.
 *
 * MEASURED CAVEAT, and the reason `stripUserUnit` exists. Amendment 1 justifies "not applied" with
 * "it is what MuPDF's page.rect gives". That justification is FALSE as of PyMuPDF 1.28 / MuPDF
 * 1.29: on a page with /UserUnit 2.5 and /MediaBox [0 0 200 300], `page.rect` is (0, 0, 500, 750)
 * and every coordinate `get_drawings()` / `get_text()` returns is likewise pre-multiplied by 2.5.
 * (`page.rotation_matrix` is NOT, which is a second trap.) The *rule* still stands — it is pinned
 * by fiat and all implementations must agree — but a PyMuPDF-based parser must divide userUnit
 * back out exactly once before storing. See `stripUserUnit`.
 *
 * The Python twin is `python/papertree_document_ir/geometry.py`; both are checked against
 * `conformance/geometry-vectors.json`, which is generated from synthetic PDFs by
 * `test/fixtures-pdf/generate.py`. Neither language is the other's oracle.
 */

import type { BBox, Point, Polygon } from './generated/types.js';

// ─── errors ─────────────────────────────────────────────────────────────────────────────────────

/** Raised for input that cannot be interpreted as geometry. Never for merely unusual geometry. */
export class GeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeometryError';
  }
}

// ─── rotation ───────────────────────────────────────────────────────────────────────────────────

/** A page or viewer rotation, in degrees CLOCKWISE, as PDF /Rotate defines it. */
export type Rotation = 0 | 90 | 180 | 270;

/** The four rotations, in the order the conformance vectors and the spec table use. */
export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270] as const;

/**
 * Reduce a raw /Rotate value to the canonical 0/90/180/270. PDF 1.7 §7.7.3.3 permits any multiple
 * of 90, including negatives and values ≥ 360; anything else is a malformed page.
 */
export function normaliseRotation(rotate: number): Rotation {
  if (!Number.isFinite(rotate) || rotate % 90 !== 0) {
    throw new GeometryError(`/Rotate must be a multiple of 90, got ${String(rotate)}`);
  }
  const r = ((rotate % 360) + 360) % 360;
  return r as Rotation;
}

/** True iff the rotation exchanges the width and height axes. */
export function rotationSwapsAxes(rotation: Rotation): boolean {
  return rotation === 90 || rotation === 270;
}

// ─── 1. normalisation: raw PDF space → IR space (parse time, used once) ─────────────────────────

/** The raw page attributes, exactly as they appear in the PDF page dictionary. */
export interface RawPageBoxes {
  /** /MediaBox as written: [x0, y0, x1, y1], bottom-left origin, corners in either order. */
  mediaBox: BBox;
  /** /CropBox as written. Absent ⇒ defaults to the MediaBox (PDF 1.7 §14.11.2). */
  cropBox?: BBox;
  /** /Rotate as written. Absent ⇒ 0. Any multiple of 90, may be negative or ≥ 360. */
  rotate?: number;
  /** /UserUnit as written. Absent ⇒ 1. RECORDED, never applied to IR coordinates. */
  userUnit?: number;
}

/**
 * A page's coordinate frame, normalised once. Everything a consumer needs to place a polygon, plus
 * the one raw fact (`sourceCropBox`) that lets the normalisation be re-derived or audited.
 *
 * Maps onto PaperIR `Page` as: width, height, rotation, user_unit, crop_box, media_box. Note
 * DESIGN.md D23 / validator rule G4 — `cropBox` is ALWAYS [0, 0, width, height], because block
 * geometry is crop-box-relative; `mediaBox` is frequently negative, which is correct.
 */
export interface PageFrame {
  /** Post-rotation width of the crop rect, in default user space points. */
  width: number;
  /** Post-rotation height of the crop rect, in default user space points. */
  height: number;
  /** The /Rotate that has ALREADY been applied. Recorded for auditability; do not apply twice. */
  rotation: Rotation;
  /** The /UserUnit. RECORDED ONLY — not applied to any coordinate in this frame. */
  userUnit: number;
  /** Always [0, 0, width, height] (D23 / G4). */
  cropBox: BBox;
  /** The MediaBox expressed in IR space. Often has negative x0/y0; that is correct, not an error. */
  mediaBox: BBox;
  /**
   * The EFFECTIVE crop box in RAW PDF space — corner-ordered and intersected with the media box per
   * PDF 1.7 §14.11.2. Retained because it is the entire input to `normalisePoint`, so the
   * normalisation is reproducible from the frame alone rather than from the original file.
   */
  sourceCropBox: BBox;
}

function requireFinite(values: readonly number[], what: string): void {
  for (const v of values) {
    if (!Number.isFinite(v)) throw new GeometryError(`${what} must be finite, got ${String(v)}`);
  }
}

/** Corner-order a raw PDF box: PDF permits [x1 y1 x0 y0] and viewers must cope. */
function orderBox(box: BBox, what: string): BBox {
  requireFinite(box, what);
  const [a, b, c, d] = box;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/**
 * Raw PDF page attributes → the canonical IR frame. Call this ONCE per page, at parse time.
 *
 * Handles, in this order: corner-ordering, CropBox defaulting, CropBox ∩ MediaBox, the
 * bottom-left → top-left origin flip, a CropBox origin that is not (0, 0), and /Rotate. It does
 * NOT apply /UserUnit — see the module header.
 */
export function normalisePageFrame(raw: RawPageBoxes): PageFrame {
  const media = orderBox(raw.mediaBox, '/MediaBox');
  const cropRequested = raw.cropBox === undefined ? media : orderBox(raw.cropBox, '/CropBox');

  // PDF 1.7 §14.11.2: the crop box is clipped to the media box; the visible page is the
  // intersection. A CropBox that escapes the MediaBox is common and is not an error.
  const crop: BBox = [
    Math.max(cropRequested[0], media[0]),
    Math.max(cropRequested[1], media[1]),
    Math.min(cropRequested[2], media[2]),
    Math.min(cropRequested[3], media[3]),
  ];
  const cw = crop[2] - crop[0];
  const ch = crop[3] - crop[1];
  if (!(cw > 0) || !(ch > 0)) {
    throw new GeometryError(
      `/CropBox ∩ /MediaBox is empty (crop=[${crop.join(', ')}], media=[${media.join(', ')}])`,
    );
  }

  const rotation = normaliseRotation(raw.rotate ?? 0);
  const userUnit = raw.userUnit ?? 1;
  if (!Number.isFinite(userUnit) || userUnit <= 0) {
    throw new GeometryError(`/UserUnit must be finite and > 0, got ${String(userUnit)}`);
  }

  const swap = rotationSwapsAxes(rotation);
  const width = swap ? ch : cw;
  const height = swap ? cw : ch;

  const frame: PageFrame = {
    width,
    height,
    rotation,
    userUnit,
    cropBox: [0, 0, width, height],
    // Placeholder; replaced below once `sourceCropBox` is available to normalise through.
    mediaBox: [0, 0, 0, 0],
    sourceCropBox: crop,
  };
  frame.mediaBox = normaliseRect(frame, media);
  return frame;
}

/**
 * One raw PDF point → IR space. The whole normalisation, in four lines:
 *
 *   u = rawX - crop.x0      offset from the crop box's OWN origin — a CropBox that does not start
 *   v = crop.y1 - rawY      at (0, 0) cannot leak into the result (Amendment 1 § COORDINATE FRAME)
 *   then rotate (u, v) clockwise by /Rotate inside the cw × ch rect.
 *
 * Rotation table, derived and then verified against MuPDF's own `rotation_matrix` on synthetic
 * PDFs (see `test/fixtures-pdf/generate.py`):
 *
 *      0    (x, y) = (u, v)               page is cw × ch
 *     90    (x, y) = (ch - v, u)          page is ch × cw
 *    180    (x, y) = (cw - u, ch - v)     page is cw × ch
 *    270    (x, y) = (v, cw - u)          page is ch × cw
 */
export function normalisePoint(frame: PageFrame, rawPoint: Point): Point {
  requireFinite(rawPoint, 'point');
  const crop = frame.sourceCropBox;
  const cw = crop[2] - crop[0];
  const ch = crop[3] - crop[1];
  const u = rawPoint[0] - crop[0];
  const v = crop[3] - rawPoint[1];
  switch (frame.rotation) {
    case 0:
      return [u, v];
    case 90:
      return [ch - v, u];
    case 180:
      return [cw - u, ch - v];
    default:
      return [v, cw - u];
  }
}

/** The exact inverse of `normalisePoint`: IR space → raw PDF space. */
export function denormalisePoint(frame: PageFrame, point: Point): Point {
  requireFinite(point, 'point');
  const crop = frame.sourceCropBox;
  const cw = crop[2] - crop[0];
  const ch = crop[3] - crop[1];
  let u: number;
  let v: number;
  switch (frame.rotation) {
    case 0:
      [u, v] = [point[0], point[1]];
      break;
    case 90:
      [u, v] = [point[1], ch - point[0]];
      break;
    case 180:
      [u, v] = [cw - point[0], ch - point[1]];
      break;
    default:
      [u, v] = [cw - point[1], point[0]];
      break;
  }
  return [u + crop[0], crop[3] - v];
}

/**
 * A raw PDF rect → an IR-space bbox. Not a per-corner map: 90°/270° exchange which corner is
 * top-left, so the result is the EXTENT of the two mapped corners.
 */
export function normaliseRect(frame: PageFrame, rawRect: BBox): BBox {
  const ordered = orderBox(rawRect, 'rect');
  const a = normalisePoint(frame, [ordered[0], ordered[1]]);
  const b = normalisePoint(frame, [ordered[2], ordered[3]]);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** A raw PDF polygon → an IR-space polygon. Vertex order is preserved. */
export function normalisePolygon(frame: PageFrame, rawPolygon: Polygon): Polygon {
  return rawPolygon.map((p) => normalisePoint(frame, p));
}

/**
 * Divide /UserUnit back out of a coordinate that a renderer already scaled by it.
 *
 * PyMuPDF 1.28 / MuPDF 1.29 pre-multiply `page.rect` and every extracted coordinate by /UserUnit,
 * but NOT `page.rotation_matrix`. IR space is default user space (Amendment 1), so a parser must
 * apply this exactly once — before `normalisePoint`, while still in raw PDF space — and must not
 * apply it to the box arrays it read out of the page dictionary, which are never scaled.
 */
export function stripUserUnit(point: Point, userUnit: number): Point {
  if (!Number.isFinite(userUnit) || userUnit <= 0) {
    throw new GeometryError(`userUnit must be finite and > 0, got ${String(userUnit)}`);
  }
  return [point[0] / userUnit, point[1] / userUnit];
}

// ─── 2. the viewport transform, both directions ─────────────────────────────────────────────────

/**
 * Everything the reader's transform is parameterised by. Deliberately five fields: Epic 2 anchors
 * against this signature, so it is a contract.
 *
 * `rotation` is the viewer's EXTRA rotation, applied on top of the page's own /Rotate, which is
 * already baked into `pageWidth`/`pageHeight` and into every stored polygon. A reader showing the
 * page as authored passes 0. It is not a second chance to apply /Rotate.
 */
export interface Viewport {
  /** Render scale, 1 = 72 dpi. */
  zoom: number;
  /** The viewer's extra rotation, clockwise, on top of the page's baked-in /Rotate. */
  rotation: Rotation;
  /** The page's /UserUnit. Applied HERE and only here (module header). Absent ⇒ 1. */
  userUnit?: number;
  /** PageFrame.width — IR space, post-/Rotate. */
  pageWidth: number;
  /** PageFrame.height — IR space, post-/Rotate. */
  pageHeight: number;
}

/** zoom × userUnit. The single scalar that separates IR points from viewport units. */
export function viewportScale(viewport: Viewport): number {
  const userUnit = viewport.userUnit ?? 1;
  if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
    throw new GeometryError(`zoom must be finite and > 0, got ${String(viewport.zoom)}`);
  }
  if (!Number.isFinite(userUnit) || userUnit <= 0) {
    throw new GeometryError(`userUnit must be finite and > 0, got ${String(userUnit)}`);
  }
  return viewport.zoom * userUnit;
}

/** The size of the rendered surface, in viewport units. Axes exchange at 90° and 270°. */
export function viewportSize(viewport: Viewport): { width: number; height: number } {
  const s = viewportScale(viewport);
  requireFinite([viewport.pageWidth, viewport.pageHeight], 'page size');
  const w = viewport.pageWidth * s;
  const h = viewport.pageHeight * s;
  return rotationSwapsAxes(viewport.rotation) ? { width: h, height: w } : { width: w, height: h };
}

/** IR space → viewport units. */
export function pdfToViewport(point: Point, viewport: Viewport): Point {
  requireFinite(point, 'point');
  const s = viewportScale(viewport);
  const w = viewport.pageWidth * s;
  const h = viewport.pageHeight * s;
  const x = point[0] * s;
  const y = point[1] * s;
  switch (viewport.rotation) {
    case 0:
      return [x, y];
    case 90:
      return [h - y, x];
    case 180:
      return [w - x, h - y];
    default:
      return [y, w - x];
  }
}

/** Viewport units → IR space. The exact inverse of `pdfToViewport`. */
export function viewportToPdf(point: Point, viewport: Viewport): Point {
  requireFinite(point, 'point');
  const s = viewportScale(viewport);
  const w = viewport.pageWidth * s;
  const h = viewport.pageHeight * s;
  switch (viewport.rotation) {
    case 0:
      return [point[0] / s, point[1] / s];
    case 90:
      return [point[1] / s, (h - point[0]) / s];
    case 180:
      return [(w - point[0]) / s, (h - point[1]) / s];
    default:
      return [(w - point[1]) / s, point[0] / s];
  }
}

/** IR bbox → viewport bbox. Re-extents, because rotation exchanges the corners. */
export function bboxToViewport(bbox: BBox, viewport: Viewport): BBox {
  const a = pdfToViewport([bbox[0], bbox[1]], viewport);
  const b = pdfToViewport([bbox[2], bbox[3]], viewport);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** Viewport bbox → IR bbox. Re-extents, for the same reason. */
export function bboxFromViewport(bbox: BBox, viewport: Viewport): BBox {
  const a = viewportToPdf([bbox[0], bbox[1]], viewport);
  const b = viewportToPdf([bbox[2], bbox[3]], viewport);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

// ─── 3. polygon helpers ─────────────────────────────────────────────────────────────────────────

/**
 * Tolerance for "bbox equals polygon extent" (DESIGN.md semantic validator, Geometry rule 1). The
 * schema says the identity is exact; this epsilon exists only so a producer that round-trips
 * through a decimal formatter is not failed for the last ulp.
 */
export const BBOX_EXTENT_EPSILON_PT = 1e-9;

/**
 * The extent of a polygon: [min x, min y, max x, max y].
 *
 * This is the CANONICAL implementation of `Block.bbox`. The schema requires `bbox` to equal the
 * polygon's extent and the semantic validator checks it, so a producer and the validator must
 * compute it here rather than each rolling their own — that is the whole reason this function is
 * exported rather than inlined.
 */
export function polygonExtent(polygon: Polygon): BBox {
  if (polygon.length === 0) throw new GeometryError('polygon has no vertices');
  const first = polygon[0] as Point;
  requireFinite(first, 'vertex');
  let x0 = first[0];
  let y0 = first[1];
  let x1 = first[0];
  let y1 = first[1];
  for (let i = 1; i < polygon.length; i += 1) {
    const p = polygon[i] as Point;
    requireFinite(p, 'vertex');
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

/** Validator rule 1, as a predicate, so the rule and the producer cannot drift. */
export function bboxMatchesPolygonExtent(
  bbox: BBox,
  polygon: Polygon,
  epsilon: number = BBOX_EXTENT_EPSILON_PT,
): boolean {
  const extent = polygonExtent(polygon);
  for (let i = 0; i < 4; i += 1) {
    if (Math.abs((bbox[i] as number) - (extent[i] as number)) > epsilon) return false;
  }
  return true;
}

/**
 * Twice the signed area (the shoelace sum). Positive = counter-clockwise in a y-UP frame, which in
 * IR space (y DOWN) reads as clockwise on screen. Exposed because orientation is occasionally what
 * a caller actually wants, and because `polygonArea` must not hide the sign convention.
 */
export function polygonSignedArea(polygon: Polygon): number {
  if (polygon.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    requireFinite(a, 'vertex');
    total += a[0] * b[1] - b[0] * a[1];
  }
  return total / 2;
}

/** Absolute area, in pt². Zero for a degenerate ring — validator rule G6 requires strictly > 0. */
export function polygonArea(polygon: Polygon): number {
  return Math.abs(polygonSignedArea(polygon));
}

function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (cross !== 0) return false;
  return (
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1])
  );
}

/**
 * Even-odd (crossing number) point-in-polygon.
 *
 * Boundary is tested EXPLICITLY and first, because the classic ray-cast leaves boundary points
 * undefined — and "undefined" between two languages means "forks". `includeBoundary` decides it;
 * the default is inclusive, which is what a highlight hit-test wants.
 */
export function pointInPolygon(point: Point, polygon: Polygon, includeBoundary = true): boolean {
  requireFinite(point, 'point');
  if (polygon.length < 3) return false;
  const n = polygon.length;
  for (let i = 0; i < n; i += 1) {
    if (onSegment(point, polygon[i] as Point, polygon[(i + 1) % n] as Point)) {
      return includeBoundary;
    }
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const a = polygon[i] as Point;
    const b = polygon[j] as Point;
    if (a[1] > point[1] !== b[1] > point[1]) {
      const t = ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (point[0] < t) inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (d !== 0) {
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }
  return (
    onSegment(p3, p1, p2) || onSegment(p4, p1, p2) || onSegment(p1, p3, p4) || onSegment(p2, p3, p4)
  );
}

/**
 * Do two polygons share any point? Boundary contact counts as intersecting.
 *
 * Edge-crossing alone is not sufficient — one polygon wholly inside the other has no crossing —
 * so containment is checked in both directions. O(n·m); polygons here are bounded at 512 vertices.
 */
export function polygonsIntersect(a: Polygon, b: Polygon): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const ea = polygonExtent(a);
  const eb = polygonExtent(b);
  if (!bboxesIntersect(ea, eb)) return false;
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i] as Point;
    const a2 = a[(i + 1) % a.length] as Point;
    for (let j = 0; j < b.length; j += 1) {
      if (segmentsIntersect(a1, a2, b[j] as Point, b[(j + 1) % b.length] as Point)) return true;
    }
  }
  return pointInPolygon(a[0] as Point, b) || pointInPolygon(b[0] as Point, a);
}

/**
 * Is the ring simple (non-self-intersecting)? Validator rule G6 reports a bowtie as a WARN — a
 * parser bug, not a data-integrity failure — so this is a predicate, not a throw.
 */
export function polygonIsSimple(polygon: Polygon): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a1 = polygon[i] as Point;
      const a2 = polygon[(i + 1) % n] as Point;
      const b1 = polygon[j] as Point;
      const b2 = polygon[(j + 1) % n] as Point;
      // Adjacent edges legitimately meet at the vertex they share; they may touch NOWHERE else.
      const shared = j === i + 1 ? a2 : i === 0 && j === n - 1 ? a1 : null;
      if (shared !== null) {
        for (const p of [a1, a2]) {
          if (!pointsEqual(p, shared) && onSegment(p, b1, b2)) return false;
        }
        for (const p of [b1, b2]) {
          if (!pointsEqual(p, shared) && onSegment(p, a1, a2)) return false;
        }
        continue;
      }
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

/** [x0, y0, x1, y1] → a 4-vertex ring, clockwise on screen, starting at the top-left corner. */
export function bboxToPolygon(bbox: BBox): Polygon {
  const b = orderBox(bbox, 'bbox');
  return [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[2], b[3]],
    [b[0], b[3]],
  ];
}

/** Inclusive overlap test: two boxes that merely touch along an edge DO intersect. */
export function bboxesIntersect(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

// ─── union of line rects → polygon(s) ───────────────────────────────────────────────────────────

/**
 * Default vertical slack, in points, for treating two line rects as part of the same run of text.
 * Font-metric line boxes (what MuPDF returns) abut or overlap; glyph-derived boxes leave a gap of
 * roughly the descender depth. 2 pt spans that without reaching the ~10 pt gap between a paragraph
 * and the next one on a 10 pt body.
 */
export const DEFAULT_LINE_GAP_PT = 2;

/**
 * Default horizontal slack. Zero: two rects must genuinely overlap in x to be the same column. The
 * gutter of a two-column paper is 15–25 pt, so this is the knob that stops highlights bleeding.
 */
export const DEFAULT_LINE_OVERLAP_PT = 0;

export interface LineUnionOptions {
  /** Max vertical gap between consecutive lines of one run. Default `DEFAULT_LINE_GAP_PT`. */
  verticalGapTolerance?: number;
  /** Min horizontal overlap for two rects to be in one run. Default `DEFAULT_LINE_OVERLAP_PT`. */
  horizontalOverlapTolerance?: number;
  /** Max vertices per returned polygon (the schema's cap). Default 512. */
  maxVertices?: number;
}

interface Band {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function pointsEqual(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function simplifyRing(ring: Point[]): Polygon {
  const deduped: Point[] = [];
  for (const p of ring) {
    const last = deduped[deduped.length - 1];
    if (last === undefined || !pointsEqual(last, p)) deduped.push(p);
  }
  while (
    deduped.length > 1 &&
    pointsEqual(deduped[0] as Point, deduped[deduped.length - 1] as Point)
  ) {
    deduped.pop();
  }
  // Drop collinear vertices: adjacent bands with the same left or right edge would otherwise emit
  // a redundant point at every band boundary, tripling the vertex count for no shape change.
  const out: Point[] = [];
  const n = deduped.length;
  for (let i = 0; i < n; i += 1) {
    const prev = deduped[(i - 1 + n) % n] as Point;
    const cur = deduped[i] as Point;
    const next = deduped[(i + 1) % n] as Point;
    const cross =
      (cur[0] - prev[0]) * (next[1] - prev[1]) - (cur[1] - prev[1]) * (next[0] - prev[0]);
    if (cross !== 0) out.push(cur);
  }
  return out.length >= 3 ? out : deduped;
}

function bandsToRing(bands: readonly Band[]): Polygon {
  const n = bands.length;
  // Horizontal boundary between band i-1 and band i: the midpoint of the gap, so the ring is a
  // closed staircase with no slivers between lines.
  const edges: number[] = [(bands[0] as Band).y0];
  for (let i = 1; i < n; i += 1) {
    edges.push(((bands[i - 1] as Band).y1 + (bands[i] as Band).y0) / 2);
  }
  edges.push((bands[n - 1] as Band).y1);

  const ring: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const b = bands[i] as Band;
    ring.push([b.x1, edges[i] as number], [b.x1, edges[i + 1] as number]);
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    const b = bands[i] as Band;
    ring.push([b.x0, edges[i + 1] as number], [b.x0, edges[i] as number]);
  }
  return simplifyRing(ring);
}

/**
 * Turn a multi-line text selection into region polygons.
 *
 * THIS IS THE FUNCTION COMMITMENT 2 EXISTS FOR. Given one rect per selected line, it returns the
 * staircase outline of each CONNECTED RUN of lines — not the bounding box of the lot. A selection
 * that crosses the gutter of a two-column paper therefore comes back as TWO polygons, one per
 * column, and nothing is painted over the gutter. Flattening to a single bbox is precisely the
 * highlight-bleed bug in findings.md.
 *
 * Two rects join a run iff they overlap in x by more than `horizontalOverlapTolerance` AND their
 * y-intervals overlap or are separated by at most `verticalGapTolerance`. Connectivity is
 * transitive, so a short last line still joins the paragraph above it.
 *
 * Rects with non-positive width or height are dropped (a zero-width selection is not a region).
 * Returned polygons are ordered by (top, left) so the output is stable across languages.
 */
export function unionOfLineRects(
  rects: readonly BBox[],
  options: LineUnionOptions = {},
): Polygon[] {
  const gap = options.verticalGapTolerance ?? DEFAULT_LINE_GAP_PT;
  const overlap = options.horizontalOverlapTolerance ?? DEFAULT_LINE_OVERLAP_PT;
  const maxVertices = options.maxVertices ?? 512;
  if (maxVertices < 4) throw new GeometryError('maxVertices must be at least 4');

  const boxes: Band[] = [];
  for (const r of rects) {
    const o = orderBox(r, 'line rect');
    if (o[2] - o[0] > 0 && o[3] - o[1] > 0) boxes.push({ x0: o[0], y0: o[1], x1: o[2], y1: o[3] });
  }
  if (boxes.length === 0) return [];
  boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0 || a.y1 - b.y1 || a.x1 - b.x1);

  // Union-find over the "same run of text" relation.
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while ((parent[r] as number) !== r) r = parent[r] as number;
    let c = i;
    while ((parent[c] as number) !== c) {
      const next = parent[c] as number;
      parent[c] = r;
      c = next;
    }
    return r;
  };
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i] as Band;
      const b = boxes[j] as Band;
      const xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const yGap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      if (xOverlap > overlap && yGap <= gap) {
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) parent[rb] = ra;
      }
    }
  }

  const groups = new Map<number, Band[]>();
  for (let i = 0; i < boxes.length; i += 1) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket === undefined) groups.set(root, [boxes[i] as Band]);
    else bucket.push(boxes[i] as Band);
  }

  const polygons: Polygon[] = [];
  for (const members of groups.values()) {
    // Collapse rects that share a vertical band into one. They are already in the same run, so
    // taking their x-extent cannot reach another column.
    const bands: Band[] = [];
    for (const r of members) {
      const cur = bands[bands.length - 1];
      if (cur !== undefined && r.y0 < cur.y1) {
        cur.x0 = Math.min(cur.x0, r.x0);
        cur.x1 = Math.max(cur.x1, r.x1);
        cur.y1 = Math.max(cur.y1, r.y1);
      } else {
        bands.push({ ...r });
      }
    }
    // Bound the vertex count: merge the adjacent band pair whose union wastes the least area,
    // repeatedly. Over-approximates WITHIN a run, never across runs.
    while (bands.length * 2 + 2 > maxVertices && bands.length > 1) {
      let best = 0;
      let bestCost = Infinity;
      for (let i = 0; i + 1 < bands.length; i += 1) {
        const a = bands[i] as Band;
        const b = bands[i + 1] as Band;
        const merged = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0);
        const cost = merged * 2 - (a.x1 - a.x0) - (b.x1 - b.x0);
        if (cost < bestCost) {
          bestCost = cost;
          best = i;
        }
      }
      const a = bands[best] as Band;
      const b = bands[best + 1] as Band;
      bands.splice(best, 2, {
        x0: Math.min(a.x0, b.x0),
        y0: a.y0,
        x1: Math.max(a.x1, b.x1),
        y1: b.y1,
      });
    }
    polygons.push(bandsToRing(bands));
  }

  polygons.sort((p, q) => {
    const ep = polygonExtent(p);
    const eq = polygonExtent(q);
    return ep[1] - eq[1] || ep[0] - eq[0];
  });
  return polygons;
}
