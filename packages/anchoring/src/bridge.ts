/**
 * anchoring/bridge — the ONE place pdf.js's coordinates and PaperIR's meet.
 *
 * THE COLLISION, stated plainly, because four separate documents in this repo disagree about it.
 *
 *   `research/synthesis-10-highlight-and-qa.md` §10.2 and `literature/13-highlight-anchoring.md`
 *   both mandate "PDF user space, points, **origin bottom-left**" for stored quads.
 *   `packages/document-ir/src/geometry.ts` — which is SHIPPED, and which every fixture polygon and
 *   every `block_id` was computed in — mandates IR space: **origin TOP-LEFT, y DOWN, `/Rotate`
 *   APPLIED, `/UserUnit` NOT applied.**
 *
 * IR SPACE WINS, and not by preference. 199 fixture polygons, 433 conformance vectors and every
 * block id in existence are already expressed in it; `geometry.ts`'s own header declares itself
 * "the only place any of them is converted into another". Re-deriving the transform by hand here
 * would be a second implementation of a pinned contract — the exact defect the identity module
 * spends 200 lines of comment warning about — so this module CALLS `normalisePageFrame` and
 * `normalisePoint` rather than reimplementing them.
 *
 * WHAT pdf.js GIVES YOU, and the three traps in it:
 *
 *   1. `PDFPageProxy.view` is `intersect(CropBox, MediaBox)` in RAW PDF space — bottom-left origin,
 *      y UP. It is NOT `[0, 0, w, h]` on academic PDFs from journal typesetters, which frequently
 *      have CropBox ≠ MediaBox. pdf.js PR #6968 (2025-04-10) is a bug fix for precisely the failure
 *      of forgetting that, and the symptom is a Y conversion that is wrong whenever the box's
 *      bottom-left is not at the origin.
 *
 *   2. **`getViewport({ rotation: 0 })` DISCARDS the page's `/Rotate`.** The parameter is the
 *      ABSOLUTE rotation, defaulting to `page.rotate` — it is not "no extra rotation". IR space has
 *      `/Rotate` already applied, so the viewport that corresponds to IR space at zoom 1 is
 *      `getViewport({ scale: 1 })`, NOT `getViewport({ scale: 1, rotation: 0 })`. Every brief in
 *      this repo says the latter. On a rotated page they are different viewports and the difference
 *      is a highlight in the wrong place. See `captureViewportRotation`.
 *
 *   3. **The installed `pdfjs-dist@3.11.174` has no `/UserUnit` support at all** — no
 *      `PDFPageProxy.userUnit`, and `PageViewport` never multiplies by it. `--total-scale-factor`
 *      and `--user-unit` do not exist in its CSS either; v3 has only `--scale-factor`. Documents
 *      describing "userUnit folded into the scale" are describing v4+. This module therefore takes
 *      `userUnit` as an explicit argument from the IR's `Page.user_unit` and never asks pdf.js.
 *
 * NOTHING HERE IMPORTS pdf.js. The inputs are the three plain values pdf.js exposes, so the whole
 * bridge is testable in Node against `packages/document-ir/test/fixtures-pdf/`'s synthetic rotate /
 * cropbox-offset / userunit PDFs without a browser.
 */

import {
  normalisePageFrame,
  normalisePoint,
  pdfToViewport,
  viewportToPdf,
  type BBox,
  type PageFrame,
  type Point,
  type Rotation,
  type Viewport,
} from '@papertree/document-ir';

/** Exactly what `PDFPageProxy` exposes that this needs. Deliberately not the pdf.js type. */
export interface PdfPageBox {
  /** `PDFPageProxy.view` — `intersect(CropBox, MediaBox)`, RAW PDF space, bottom-left origin. */
  readonly view: BBox;
  /** `PDFPageProxy.rotate` — the page's `/Rotate`. */
  readonly rotate: number;
  /**
   * `Page.user_unit` FROM THE IR, not from pdf.js — v3 does not expose it. Absent ⇒ 1.
   */
  readonly userUnit?: number;
}

/**
 * The IR frame for a pdf.js page.
 *
 * `mediaBox` is passed as the view as well, and that is correct rather than lazy: `view` is already
 * the CropBox∩MediaBox intersection that `normalisePageFrame` would compute, so handing it in as
 * both boxes makes the intersection idempotent and `sourceCropBox` come out equal to `view` — which
 * is exactly the box every subsequent conversion must be relative to. The resulting
 * `frame.mediaBox` is then `[0, 0, w, h]` rather than the true MediaBox in IR space; nothing in the
 * reader reads that field, and pdf.js does not expose the raw MediaBox separately to do better.
 */
export function frameForPdfPage(page: PdfPageBox): PageFrame {
  return normalisePageFrame({
    mediaBox: page.view,
    cropBox: page.view,
    rotate: page.rotate,
    userUnit: page.userUnit ?? 1,
  });
}

/**
 * A raw PDF point — what `PageViewport.convertToPdfPoint` returns — to IR space.
 *
 * `convertToPdfPoint` and NOT `convertToViewportRectangle`. That method DOES still exist in the
 * installed `pdfjs-dist@3.11.174` (and in 5.4.296), so the four documents in this repo asserting it
 * "no longer exists" are describing pdf.js master and are wrong about the installed version — but
 * the instruction to convert corners individually is right anyway, for a different reason: v3's
 * implementation does not min/max-renormalise, so its output is not a valid rect once the Y flip
 * has exchanged which corner is which.
 */
export function pdfPointToIr(frame: PageFrame, rawPoint: Point): Point {
  return normalisePoint(frame, rawPoint);
}

/**
 * A raw PDF rect to an IR bbox, by converting BOTH corners and re-taking the extent.
 *
 * Re-extenting is not defensive: at 90° and 270° the rotation exchanges which corner is top-left,
 * so a per-corner map produces `x0 > x1` and every downstream `bbox[2] - bbox[0]` goes negative.
 * Quad vertex ORDER is discarded entirely — ISO 32000-1 §12.5.6.10 specifies an order real files do
 * not follow, and pdf.js's own source calls the situation "even worse" because Adobe's applications
 * violate it too. pdf.js renormalises via min/max; so does this.
 */
export function pdfRectToIr(frame: PageFrame, rawRect: BBox): BBox {
  const a = normalisePoint(frame, [rawRect[0], rawRect[1]]);
  const b = normalisePoint(frame, [rawRect[2], rawRect[3]]);
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
  ];
}

/**
 * The `rotation` to pass to `page.getViewport()` so the result matches IR space.
 *
 * THE TRAP: `getViewport({ rotation })` sets the ABSOLUTE rotation, defaulting to `page.rotate`.
 * IR space already has `/Rotate` applied. So the viewport corresponding to "IR space, no viewer
 * rotation" is `getViewport({ scale: z, rotation: page.rotate })` — equivalently just
 * `getViewport({ scale: z })` — and `getViewport({ scale: 1, rotation: 0 })`, which every brief in
 * this repo specifies, is a DIFFERENT viewport on any page whose `/Rotate` is not 0.
 *
 * `viewerRotation` is the user's extra rotation on top of the page's own, and it is what
 * `Viewport.rotation` means in `document-ir`. The two must not be confused, and passing
 * `page.rotation` as `Viewport.rotation` double-rotates every highlight.
 *
 * All 10 fixture pages are `/Rotate 0`, so this distinction is invisible there and is covered by
 * `packages/document-ir/test/fixtures-pdf/rotate-{90,180,270}.pdf` instead.
 */
export function captureViewportRotation(pageRotate: number, viewerRotation: Rotation = 0): number {
  return (((pageRotate + viewerRotation) % 360) + 360) % 360;
}

/**
 * The `Viewport` for painting IR geometry at a given zoom.
 *
 * `userUnit` is APPLIED here and only here — `document-ir`'s named boundary. Omitting it silently
 * defaults to 1 and mis-scales every large-format figure page, which is the classic silent fork the
 * geometry module's header calls out.
 */
export function viewportFor(args: {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly zoom: number;
  readonly userUnit?: number;
  readonly viewerRotation?: Rotation;
}): Viewport {
  return {
    zoom: args.zoom,
    rotation: args.viewerRotation ?? 0,
    userUnit: args.userUnit ?? 1,
    pageWidth: args.pageWidth,
    pageHeight: args.pageHeight,
  };
}

/**
 * An IR bbox to the CSS rect of an overlay painted at scale 1.
 *
 * THE OVERLAY IS SIZED TO THE SCALE-1 VIEWPORT AND SCALED WITH A CSS TRANSFORM. That is the whole
 * trick, and it is why zoom and resize are free rather than a recompute:
 *
 *     <div style="width: {w}px; height: {h}px; transform: scale(z); transform-origin: 0 0">
 *
 * Zoom then costs one composited transform. Nothing is re-measured, nothing is re-laid-out, and —
 * critically — NOTHING IS READ BACK FROM THE DOM. The v1 reader divides `getClientRects()` by
 * `window.innerWidth` at capture and treats the result as a fraction of the page element at paint,
 * which is why its highlights land wrong on creation, move on resize, and differ per device. Every
 * number in this function comes from the IR and the zoom; there is no measurement to be wrong.
 *
 * Returned in CSS pixels at scale 1, so the caller multiplies by nothing.
 */
export function irBboxToOverlayRect(bbox: BBox): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  return {
    left: bbox[0],
    top: bbox[1],
    width: Math.max(0, bbox[2] - bbox[0]),
    height: Math.max(0, bbox[3] - bbox[1]),
  };
}

/** An IR polygon to an SVG `points` attribute at scale 1. */
export function irPolygonToSvgPoints(polygon: readonly Point[]): string {
  return polygon.map((p) => `${p[0]},${p[1]}`).join(' ');
}

/** Round-trip helpers, re-exported so consumers never reach for a second implementation. */
export { pdfToViewport, viewportToPdf };
