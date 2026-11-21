/**
 * anchoring/linemerge — one paintable band per line, from the quads a selection or a highlight kept.
 *
 * WHY: a quad is one PDF text item's selected part. A line holding italics, inline maths or a
 * ligature break is several items, so painting the quads one by one leaves white gaps between them
 * and steps where a taller maths run pokes above its neighbours (#346). The stored quads stay the
 * truth (ADR-002: geometry is never re-derived); this only MERGES them at paint time, so the
 * highlight lands on exactly the glyphs that were selected and merely reads as one band per line.
 *
 * TWO COLUMNS STAY TWO. Two quads on one y-band are one band only when the horizontal gap between
 * them is smaller than a line's height: an inter-word space or an italic hop is a fraction of that,
 * a column gutter (15–25 pt against a 10 pt line) is more. Merging across a gutter is the
 * highlight-bleed defect `quadsForRange` documents, so the gap rule is the whole of the column test.
 *
 * Reuses `groupIntoLines` (what a visual line is) and `clampLineBands` (no band reaches into the
 * line below it), so a merged band follows the same rules as a span-derived one.
 */

import type { BBox } from '@papertree/document-ir';

import { clampLineBands, groupIntoLines, type SpanLike } from './lineband.js';

/** Quads on one line join when the gap between them is under this many line heights. */
export const MERGE_GAP_LINES = 1;

const asSpan = (bbox: BBox): SpanLike => ({ start: 0, end: 0, bbox });

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Split one visual line's quads into runs separated by a gap wider than the line is tall. */
function runsOf(line: readonly SpanLike[]): BBox[] {
  const boxes = line.map((s) => s.bbox).toSorted((a, b) => a[0] - b[0]);
  const reach = median(boxes.map((b) => b[3] - b[1])) * MERGE_GAP_LINES;
  const runs: BBox[] = [];
  for (const box of boxes) {
    const run = runs[runs.length - 1];
    if (run !== undefined && box[0] - run[2] <= reach) {
      runs[runs.length - 1] = [
        run[0],
        Math.min(run[1], box[1]),
        Math.max(run[2], box[2]),
        Math.max(run[3], box[3]),
      ];
    } else {
      runs.push(box);
    }
  }
  return runs;
}

/**
 * Merge quads into one band per line (per column).
 *
 * @param quads - Quads as stored or measured, `[x0, y0, x1, y1]` in IR points, in any order.
 * @returns Bands in reading order (top to bottom, left to right), none reaching into the band below
 *   it in the same column. Empty for no usable quad.
 * @example
 * mergeQuadsPerLine([[10, 0, 40, 10], [44, 0, 90, 10]]) // one band: [[10, 0, 90, 10]]
 */
export function mergeQuadsPerLine(quads: readonly BBox[]): BBox[] {
  const usable = quads.filter((q) => q[2] > q[0] && q[3] > q[1]);
  if (usable.length === 0) return [];
  const bands = groupIntoLines(usable.map(asSpan))
    .flatMap(runsOf)
    .toSorted((a, b) => a[1] - b[1] || a[0] - b[0]);

  // A column is a chain of bands that overlap in x; the clamp compares each band with the next in
  // ITS column only, so interleaved columns do not shrink one another.
  const columns: BBox[][] = [];
  for (const band of bands) {
    const column = columns.find((c) => {
      const last = c[c.length - 1] as BBox;
      return Math.min(last[2], band[2]) - Math.max(last[0], band[0]) > 0;
    });
    if (column === undefined) columns.push([band]);
    else column.push(band);
  }
  return columns
    .flatMap((column) => clampLineBands(column.map((band) => [asSpan(band)])))
    .toSorted((a, b) => a[1] - b[1] || a[0] - b[0]);
}
