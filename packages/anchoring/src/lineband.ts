/**
 * anchoring/lineband — turn a block's spans into paintable line quads.
 *
 * WHY THIS EXISTS: `span.bbox` IS NOT A PAINTABLE RECT.
 *
 * A span's bbox is the extractor's LINE BOX, and MuPDF reports the box of the *font* used by a run
 * rather than the box of the glyphs it actually set. When a line contains a run in a font with
 * large declared metrics — a CMSY10/CMMI10 maths run in a body-text line is the usual culprit — the
 * whole line's box is reported too tall, downward. Measured directly from the fixtures at HEAD, by
 * comparing each span's height against the font size it declares:
 *
 *   | fixture       | spans | spans with no `size` | over-tall spans | overshoot | overlapping pairs |
 *   |---------------|------:|---------------------:|----------------:|-----------|------------------:|
 *   | `resnet`      |   295 |                   13 |          **17** | 7.32–7.34 pt |          **18** |
 *   | `attention`   |   173 |                   48 |               0 | —         |                 9 |
 *   | `neural-odes` |   259 |                   57 |          **12** | 5.86 pt+  |            **14** |
 *
 * (Over-tall counts exclude the one rotated `margin_note` per fixture, whose ~330 pt span box is
 * correct geometry for 90°-rotated text and not a defect.)
 *
 * Two things follow, and BOTH correct the documents that describe this data:
 *
 *   1. **The defect is not confined to `resnet`.** `fixtures/README.md` and `EPIC-00-RESULT.md`
 *      both scope it to that fixture. `neural-odes` has 12 more of it and 14 overlapping pairs, the
 *      worst by 19.24 pt. A clamp applied only to `resnet` would leave the maths-heavy paper — the
 *      one whose highlights most need it — bleeding across lines.
 *   2. **The clamp cannot be font-metric.** `size` is absent on 118 of the 727 spans in the set
 *      (16 %), concentrated in exactly the equation and algorithm blocks whose geometry is hardest.
 *      A rule of the form `height ≤ size × k` silently does nothing on a sixth of the corpus.
 *
 * So the clamp is GEOMETRIC: a line band may not be taller than the distance to the next line's
 * top. That needs no font metadata, degrades to a no-op on well-formed input, and is exactly the
 * invariant the defect violates.
 *
 * `fixtures/README.md` states the count as "21 spans … ~7.2 pt" and the epic brief as "17 spans …
 * ~7.33 pt". The 17/7.33 figure is the reproducible one; the census above is the command that
 * produces it. Block-level POLYGONS are unaffected and were checked visually at 6× — this module is
 * only ever needed for sub-block, span-derived geometry.
 */

import { polygonExtent, unionOfLineRects, type BBox, type Polygon } from '@papertree/document-ir';

export interface SpanLike {
  readonly start: number;
  readonly end: number;
  readonly bbox: BBox;
  readonly size?: number;
}

/**
 * A line band is never taller than this multiple of the block's modal line pitch. 1.0 would clip
 * the descenders of a line whose pitch happens to be tight; 1.15 leaves them and still removes a
 * 74 % overshoot.
 */
export const BAND_PITCH_TOLERANCE = 1.15;

/** Two spans are the same visual line iff they overlap vertically by more than half the shorter. */
function sameLine(a: BBox, b: BBox): boolean {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const shorter = Math.min(a[3] - a[1], b[3] - b[1]);
  return shorter > 0 && overlap > 0.5 * shorter;
}

/**
 * Group spans into visual lines, in reading order.
 *
 * The "more than half the SHORTER of the two" rule is the same one `unionOfLineRects` uses
 * internally, and it is deliberate: a superscript or a small-caps run sits at the top of a line and
 * is short, and must still join the line it belongs to, or the band would carve a notch out of text
 * the block really does cover.
 */
export function groupIntoLines(spans: readonly SpanLike[]): SpanLike[][] {
  const sorted = [...spans].toSorted((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  const lines: SpanLike[][] = [];
  for (const span of sorted) {
    const current = lines[lines.length - 1];
    const anchor = current?.[0];
    if (current !== undefined && anchor !== undefined && sameLine(anchor.bbox, span.bbox)) {
      current.push(span);
    } else {
      lines.push([span]);
    }
  }
  return lines;
}

/**
 * The modal baseline-to-baseline pitch of a block, in points, or `null` for a single-line block.
 *
 * The MODE and not the mean: a block containing one display equation among ten body lines has a
 * mean pitch dragged upward by the equation, and clamping to the mean would leave the defect in
 * place on every body line. Pitches are bucketed to 0.5 pt before the mode is taken, because
 * typeset leading is constant to within rounding and an unbucketed mode would find no repeat.
 */
export function modalLinePitch(lines: readonly SpanLike[][]): number | null {
  if (lines.length < 2) return null;
  const tops = lines.map((line) => Math.min(...line.map((s) => s.bbox[1])));
  const counts = new Map<number, number>();
  for (let i = 1; i < tops.length; i += 1) {
    const pitch = (tops[i] as number) - (tops[i - 1] as number);
    if (pitch <= 0) continue;
    const bucket = Math.round(pitch * 2) / 2;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let bestPitch = 0;
  let bestCount = -1;
  for (const [pitch, count] of counts) {
    // Ties go to the SMALLER pitch: over-clamping loses a descender, under-clamping lets two lines
    // overlap, and an overlap double-paints a highlight where a clipped descender merely looks tight.
    if (count > bestCount || (count === bestCount && pitch < bestPitch)) {
      bestCount = count;
      bestPitch = pitch;
    }
  }
  return bestPitch > 0 ? bestPitch : null;
}

/**
 * Clamp each line band so no band reaches into the next one.
 *
 * Applied in two independent passes, because they fail on different inputs:
 *
 *   1. **pitch clamp** — a band may not exceed `modalLinePitch × BAND_PITCH_TOLERANCE`. Catches the
 *      over-tall span even when it is the LAST line of the block and has no successor to collide
 *      with, which pass 2 cannot see.
 *   2. **successor clamp** — a band's bottom is pulled to the next band's top wherever it still
 *      overrun.s Catches a block whose modal pitch is itself unreliable (two lines, both defective).
 *
 * Neither pass moves a band's TOP. The measured defect is entirely downward — the `y0` values agree
 * with the neighbouring lines and only `y1` overshoots — so moving the top would introduce an error
 * where there is none.
 */
export function clampLineBands(lines: readonly SpanLike[][]): BBox[] {
  if (lines.length === 0) return [];
  const bands: BBox[] = lines.map((line) => {
    const x0 = Math.min(...line.map((s) => s.bbox[0]));
    const y0 = Math.min(...line.map((s) => s.bbox[1]));
    const x1 = Math.max(...line.map((s) => s.bbox[2]));
    const y1 = Math.max(...line.map((s) => s.bbox[3]));
    return [x0, y0, x1, y1] as BBox;
  });

  const pitch = modalLinePitch(lines);
  if (pitch !== null) {
    const maxHeight = pitch * BAND_PITCH_TOLERANCE;
    for (let i = 0; i < bands.length; i += 1) {
      const band = bands[i] as BBox;
      if (band[3] - band[1] > maxHeight) bands[i] = [band[0], band[1], band[2], band[1] + maxHeight];
    }
  }

  for (let i = 0; i + 1 < bands.length; i += 1) {
    const band = bands[i] as BBox;
    const next = bands[i + 1] as BBox;
    // Only when the two actually overlap in x: two columns' lines interleave in y and neither
    // constrains the other, and clamping across a gutter would shrink a perfectly good band.
    const xOverlap = Math.min(band[2], next[2]) - Math.max(band[0], next[0]);
    if (xOverlap > 0 && band[3] > next[1] && next[1] > band[1]) {
      bands[i] = [band[0], band[1], band[2], next[1]];
    }
  }

  return bands;
}

/**
 * The paintable region for a code-point range inside a block: clamped line bands, unioned into
 * polygons.
 *
 * Returns MORE THAN ONE POLYGON when the selection is disconnected — which is what a selection
 * crossing the gutter of a two-column paper is. `unionOfLineRects` is what guarantees that, and
 * using it rather than a bounding box is the whole of Commitment 2. Flattening this to one rect is
 * the highlight-bleed bug, and Epic 0 shipped and then fixed exactly it one layer up; reintroducing
 * it here would be the same defect with a better view.
 */
export function quadsForRange(
  spans: readonly SpanLike[],
  startOffset: number,
  endOffset: number,
): { quads: BBox[]; polygons: Polygon[] } {
  const touched = spans.filter((s) => s.start < endOffset && startOffset < s.end);
  if (touched.length === 0) return { quads: [], polygons: [] };

  const lines = groupIntoLines(touched);
  const bands = clampLineBands(lines);

  // Narrow the first and last band horizontally to the selected fraction of their line. Without
  // this a selection starting mid-line paints from the line's left edge, which reads as selecting
  // text the user did not select. Interpolating on the code-point offset assumes a monospaced
  // advance within the span, which is wrong for proportional type — but it is wrong by less than a
  // character width, and the alternative is per-glyph geometry the IR does not carry.
  const narrowed = bands.map((band, index) => {
    const line = lines[index];
    if (line === undefined) return band;
    const lineStart = Math.min(...line.map((s) => s.start));
    const lineEnd = Math.max(...line.map((s) => s.end));
    const span = lineEnd - lineStart;
    if (span <= 0) return band;
    const from = Math.max(0, Math.min(1, (startOffset - lineStart) / span));
    const to = Math.max(0, Math.min(1, (endOffset - lineStart) / span));
    if (from <= 0 && to >= 1) return band;
    const width = band[2] - band[0];
    return [band[0] + width * from, band[1], band[0] + width * to, band[3]] as BBox;
  });

  const usable = narrowed.filter((b) => b[2] - b[0] > 0 && b[3] - b[1] > 0);
  const polygons = unionOfLineRects(usable);
  return { quads: usable, polygons };
}

/** The extent of a set of polygons, for a page-level jump on an orphaned anchor. */
export function extentOf(polygons: readonly Polygon[]): BBox | null {
  if (polygons.length === 0) return null;
  let out: BBox | null = null;
  for (const polygon of polygons) {
    if (polygon.length < 3) continue;
    const extent = polygonExtent(polygon);
    out =
      out === null
        ? extent
        : [
            Math.min(out[0], extent[0]),
            Math.min(out[1], extent[1]),
            Math.max(out[2], extent[2]),
            Math.max(out[3], extent[3]),
          ];
  }
  return out;
}
