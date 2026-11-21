/**
 * reader/figureRegions: where a page's figures are, for the dark and sepia page (#345).
 *
 * `figureMats` turns those boxes into mats that NEVER cover text which is not the figure's. The
 * mat is opaque, so two things were wrong with a bare box plus a fixed 10 px of padding: the
 * parser emits a figure's own labels ("F(x)", "identity", "x") as separate text blocks that
 * straddle or sit just outside the figure box (half of a word under the mat), and a caption starts
 * a few points under the box, inside the padding. So: a short label block that is inside, straddling
 * or within `LABEL_REACH_PT` of the box is part of the figure and the region grows to hold it whole;
 * anything else (captions, headings, body text) is an obstacle, and each side's padding stops short
 * of it (`gaps`), down to none; an obstacle that cuts into the box from outside trims the box.
 *
 * ONE FIGURE REGION, three users. `figureExtent` is the rule; the mat (`figureMats`), the float the
 * reader selects (`floatsOnPage`, so also the anchor's rectangle and the crop asked of it) all take
 * it, so the three can never disagree about where a figure ends. The parser sometimes fuses a
 * figure's label lines and its caption into one paragraph ("identity", "F(x) + x", "Figure 2. ...":
 * ResNet's Figure 2). Such a block is split by its polygon into the label bands, which belong to
 * the figure, and the caption band, which never does (`splitMixed`).
 *
 * Source recolours the whole PDF canvas, which is right for type and wrong for a plot or a photo.
 * The figure regions are the parser's `figure` and `image` boxes (the same blocks Guided shows as
 * crops, `guidedFigures`); `PageMats` draws the page's original pixels back over them on a mat.
 * Pure, so the rules are unit-tested without a canvas.
 */
import type { BBox } from '@papertree/document-ir';
import type { IndexedBlock } from '@papertree/anchoring';

const FIGURE_TYPES: ReadonlySet<string> = new Set(['figure', 'image']);

/** How much of the smaller box must lie inside the larger for it to be a panel of it. */
const PANEL_CONTAINMENT = 0.85;

function area(b: BBox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function overlap(a: BBox, b: BBox): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How far outside the box a short text block may be and still count as one of the figure's labels. */
const LABEL_REACH_PT = 14;
/** A label's short side is at most this (about one line of type), its long sides a fraction of the figure's. */
const LABEL_SHORT_SIDE_PT = 20;
const LABEL_MAX_FRACTION = 0.4;
/** How much of a block must lie inside the box for it to belong to the figure. */
const LABEL_INSIDE = 0.5;
/** An outside block may trim at most this fraction of the box (a caption grazing its edge). */
const MAX_TRIM = 0.3;
/** The most padding any side is ever asked for, in IR points; the token (`--pt-pdf-mat-pad`) is the real size. */
export const MAT_REACH_PT = 24;
/** Clear air left between a mat and the text it stops short of, in IR points. */
const CLEARANCE_PT = 0.5;

/** Block types that are never part of a figure's drawing: they are the page's own text. */
const NOT_A_LABEL = /caption|heading|header|footer|title|table|equation|footnote|reference|list/i;

/** A mat: the pixels to keep (`box`) and how much padding each side may have (`gaps`). */
export interface MatRegion {
  /** The figure plus its own labels, IR points, y down. */
  readonly box: BBox;
  /** Free padding top, right, bottom, left in IR points, 0 to `MAT_REACH_PT`: space with no other text in it. */
  readonly gaps: readonly [number, number, number, number];
}

/**
 * The boxes (IR points, y down) to keep in their own colours on one page.
 *
 * A multi-panel figure is reported as the whole crop AND each panel inside it (the YOLO and DDPM
 * pages); one mat around the whole is wanted, not a mat per panel, so a box mostly inside a larger
 * one is dropped. A scanned page is one image covering the page: it comes back as one region the
 * size of the page, so it stays as scanned (it cannot be recoloured by lightness) rather than as a
 * photographic negative.
 *
 * @param blocks - The page's blocks (`IndexedDocument.byPage`).
 * @returns Figure and image boxes, outermost only, in block order.
 */
export function figureRegions(blocks: readonly IndexedBlock[]): readonly BBox[] {
  const boxes = blocks
    .filter((b) => FIGURE_TYPES.has(b.type) && area(b.bbox) > 0)
    .map((b) => b.bbox);
  return boxes.filter(
    (box, index) =>
      !boxes.some((other, at) => {
        if (at === index) return false;
        const [a, b] = [area(box), area(other)];
        if (overlap(box, other) < PANEL_CONTAINMENT * Math.min(a, b)) return false;
        // The larger swallows the smaller; between equal boxes the earlier one is kept.
        return b > a * 1.05 || (b >= a / 1.05 && at < index);
      }),
  );
}

function width(b: BBox): number {
  return b[2] - b[0];
}
function height(b: BBox): number {
  return b[3] - b[1];
}

/** Is `o` a short run of text (not a paragraph) that this figure could own? */
function isLabelSized(o: BBox, box: BBox): boolean {
  return (
    Math.min(width(o), height(o)) <= LABEL_SHORT_SIDE_PT &&
    width(o) <= LABEL_MAX_FRACTION * width(box) &&
    height(o) <= LABEL_MAX_FRACTION * height(box)
  );
}

function reaches(o: BBox, box: BBox): boolean {
  return (
    o[0] < box[2] + LABEL_REACH_PT &&
    o[2] > box[0] - LABEL_REACH_PT &&
    o[1] < box[3] + LABEL_REACH_PT &&
    o[3] > box[1] - LABEL_REACH_PT
  );
}

/** A piece of page text near a figure: a whole block, or one band of a block that fuses labels and caption. */
interface Piece {
  readonly id: string;
  readonly type: string;
  readonly bbox: BBox;
  /** A band of label lines taken out of a fused block: the figure's own, whatever its size. */
  readonly labelBand?: true;
  /** The caption's words, on the caption band of a fused block. */
  readonly captionText?: string;
}

/** A line that opens a caption. */
const CAPTION_LINE = /^\s*(Figure|Fig\.?|Table|Algorithm|Alg\.?)\s*\d/i;
/** Two coordinates this close are the same edge. */
const SAME_EDGE = 0.5;

/**
 * The horizontal bands of a rectilinear polygon (line boxes unioned), top to bottom, one x-interval
 * each; null when the polygon is not that shape.
 */
function bandsOf(polygon: readonly (readonly number[])[] | undefined): BBox[] | null {
  if (polygon === undefined || polygon.length < 4) return null;
  const pts = polygon.map((p) => [p[0] ?? Number.NaN, p[1] ?? Number.NaN] as const);
  if (pts.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
  const edges = pts.map((a, i) => [a, pts[(i + 1) % pts.length] as typeof a] as const);
  if (edges.some(([a, b]) => Math.abs(a[0] - b[0]) > 1e-6 && Math.abs(a[1] - b[1]) > 1e-6)) {
    return null;
  }
  const ys = [...new Set(pts.map(([, y]) => y))].sort((a, b) => a - b);
  const bands: BBox[] = [];
  for (let k = 0; k + 1 < ys.length; k += 1) {
    const [y0, y1] = [ys[k] as number, ys[k + 1] as number];
    const mid = (y0 + y1) / 2;
    const xs = edges
      .filter(
        ([a, b]) =>
          Math.abs(a[0] - b[0]) <= 1e-6 && Math.min(a[1], b[1]) < mid && Math.max(a[1], b[1]) > mid,
      )
      .map(([a]) => a[0])
      .sort((a, b) => a - b);
    if (xs.length !== 2) return null; // a gap in the middle of a band: not a stack of lines
    const last = bands[bands.length - 1];
    if (
      last !== undefined &&
      Math.abs(last[0] - (xs[0] as number)) < SAME_EDGE &&
      Math.abs(last[2] - (xs[1] as number)) < SAME_EDGE
    ) {
      bands[bands.length - 1] = [last[0], last[1], last[2], y1];
    } else {
      bands.push([xs[0] as number, y0, xs[1] as number, y1]);
    }
  }
  return bands;
}

/**
 * A block that fuses a figure's label lines with its caption ("identity / F(x) + x / Figure 2. ...")
 * as the pieces it is made of: the narrow label bands, then the caption band(s) as wide as the
 * widest line. Null when the block is not that: no caption line after other lines, or a polygon
 * that does not show label lines narrower than the caption.
 */
function splitMixed(block: IndexedBlock): readonly Piece[] | null {
  const lines = (block.text ?? '').split('\n');
  const at = lines.findIndex((line, i) => i > 0 && CAPTION_LINE.test(line));
  if (at < 1) return null;
  const bands = bandsOf(block.polygon);
  if (bands === null || bands.length < 2) return null;
  const widest = Math.max(...bands.map((b) => width(b)));
  let firstCaption = bands.length;
  while (firstCaption > 0 && width(bands[firstCaption - 1] as BBox) >= 0.9 * widest)
    firstCaption -= 1;
  if (firstCaption === 0 || firstCaption === bands.length) return null;
  const captionBand = bands.slice(firstCaption).reduce((acc, b) => union(acc, b));
  const captionText = lines.slice(at).join(' ').replace(/\s+/g, ' ').trim();
  return [
    ...bands.slice(0, firstCaption).map((bbox, i) => ({
      id: `${block.id}#label${String(i)}`,
      type: block.type,
      bbox,
      labelBand: true as const,
    })),
    { id: `${block.id}#caption`, type: 'caption', bbox: captionBand, captionText },
  ];
}

/** The page's non-figure text as pieces, a fused label-and-caption block in its parts. */
function piecesOf(blocks: readonly IndexedBlock[]): readonly Piece[] {
  return blocks
    .filter((b) => !FIGURE_TYPES.has(b.type) && area(b.bbox) > 0)
    .flatMap((b) =>
      NOT_A_LABEL.test(b.type)
        ? [{ id: b.id, type: b.type, bbox: b.bbox }]
        : (splitMixed(b) ?? [{ id: b.id, type: b.type, bbox: b.bbox }]),
    );
}

/** Which pieces are this figure's own labels. */
function labelsOf(box: BBox, others: readonly Piece[]): readonly Piece[] {
  return others.filter((o) => {
    if (NOT_A_LABEL.test(o.type) || area(o.bbox) <= 0) return false;
    const inside = overlap(o.bbox, box) / area(o.bbox);
    if (inside >= 0.98) return true; // wholly inside: drawn within the figure, whatever it is
    if (o.labelBand === true) return inside >= LABEL_INSIDE || reaches(o.bbox, box);
    if (!isLabelSized(o.bbox, box)) return false;
    return inside >= LABEL_INSIDE || reaches(o.bbox, box);
  });
}

function union(a: BBox, b: BBox): BBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** Trims the box where a block from OUTSIDE it grazes in (a caption a point or two too high). */
function trimmed(box: BBox, obstacles: readonly BBox[]): BBox {
  const out: [number, number, number, number] = [box[0], box[1], box[2], box[3]];
  for (const o of obstacles) {
    if (overlap(out, o) <= 0) continue;
    const toBottom = o[1] >= out[1] + height(out) / 2 && o[3] > out[3];
    const toTop = o[3] <= out[1] + height(out) / 2 && o[1] < out[1];
    const toRight = o[0] >= out[0] + width(out) / 2 && o[2] > out[2];
    const toLeft = o[2] <= out[0] + width(out) / 2 && o[0] < out[0];
    if (toBottom && out[3] - o[1] <= MAX_TRIM * height(out)) out[3] = o[1];
    else if (toTop && o[3] - out[1] <= MAX_TRIM * height(out)) out[1] = o[3];
    else if (toRight && out[2] - o[0] <= MAX_TRIM * width(out)) out[2] = o[0];
    else if (toLeft && o[2] - out[0] <= MAX_TRIM * width(out)) out[0] = o[2];
  }
  return out;
}

/** The free padding on each side of `box`: it stops `CLEARANCE_PT` short of any obstacle. */
function gapsAround(box: BBox, obstacles: readonly BBox[]): [number, number, number, number] {
  // [top, right, bottom, left]
  const gaps: [number, number, number, number] = [
    MAT_REACH_PT,
    MAT_REACH_PT,
    MAT_REACH_PT,
    MAT_REACH_PT,
  ];
  const padded = (): BBox => [
    box[0] - gaps[3],
    box[1] - gaps[0],
    box[2] + gaps[1],
    box[3] + gaps[2],
  ];
  const limit = (side: 0 | 1 | 2 | 3, distance: number): void => {
    gaps[side] = Math.max(0, Math.min(gaps[side], distance - CLEARANCE_PT));
  };
  for (const o of obstacles) {
    if (overlap(padded(), o) <= 0) continue;
    const overX = o[0] < box[2] && o[2] > box[0];
    const overY = o[1] < box[3] && o[3] > box[1];
    // Where the block is relative to the box, by the side it extends past (a block grazing in
    // from outside has already trimmed the box, so it only ever touches the padding).
    const dBelow = o[1] - box[3];
    const dAbove = box[1] - o[3];
    const dRight = o[0] - box[2];
    const dLeft = box[0] - o[2];
    if (overX && overY) {
      // still touching the box (a block too large to trim): no padding where it pokes out
      if (o[3] > box[3]) gaps[2] = 0;
      if (o[1] < box[1]) gaps[0] = 0;
      if (o[2] > box[2]) gaps[1] = 0;
      if (o[0] < box[0]) gaps[3] = 0;
    } else if (overX) {
      if (dBelow >= 0) limit(2, dBelow);
      else limit(0, dAbove);
    } else if (overY) {
      if (dRight >= 0) limit(1, dRight);
      else limit(3, dLeft);
    } else {
      // a corner: stop short on whichever side keeps more padding
      const dx = dRight >= 0 ? dRight : dLeft;
      const dy = dBelow >= 0 ? dBelow : dAbove;
      if (dx >= dy) limit(dRight >= 0 ? 1 : 3, dx);
      else limit(dBelow >= 0 ? 2 : 0, dy);
    }
  }
  return gaps;
}

/** A figure's extent on its page: the figure and its labels, and the caption line fused with them. */
export interface FigureExtent extends MatRegion {
  /** The caption the parser fused into a label block, with its box; null when there is none. */
  readonly caption: { readonly text: string; readonly box: BBox } | null;
}

function extentOf(figure: BBox, pieces: readonly Piece[]): FigureExtent {
  const owned = labelsOf(figure, pieces);
  const grown = owned.reduce<BBox>((acc, b) => union(acc, b.bbox), figure);
  const rest = pieces.filter((b) => !owned.includes(b));
  const box = trimmed(
    grown,
    rest.map((b) => b.bbox),
  );
  const fused = rest.find((b) => b.captionText !== undefined && reaches(b.bbox, box));
  return {
    box,
    gaps: gapsAround(
      box,
      rest.map((b) => b.bbox),
    ),
    caption: fused === undefined ? null : { text: fused.captionText as string, box: fused.bbox },
  };
}

/**
 * The extent of ONE figure: its box grown to hold its own text labels, whole, and never the
 * caption (a caption fused with the labels in one block is split off and reported in `caption`).
 *
 * @param figure The figure block's box, IR points, y down.
 * @param blocks The page's blocks; figure and image blocks among them are ignored.
 * @returns The box, the padding each side can have, and a fused caption when there is one.
 */
export function figureExtent(figure: BBox, blocks: readonly IndexedBlock[]): FigureExtent {
  return extentOf(figure, piecesOf(blocks));
}

/**
 * The mats for one page: each figure region grown to hold its own labels, trimmed where outside text
 * grazes it, with the padding each side can have without covering any other text.
 *
 * @param blocks - The page's blocks (`IndexedDocument.byPage`).
 * @returns One mat per outermost figure, in block order.
 *
 * @example
 * // a figure at y 200..400 with its caption starting at y 404
 * figureMats(blocks)[0].gaps[2]; // 3.5: the bottom padding stops short of the caption
 */
export function figureMats(blocks: readonly IndexedBlock[]): readonly MatRegion[] {
  const pieces = piecesOf(blocks);
  return figureRegions(blocks).map((figure) => {
    const { box, gaps } = extentOf(figure, pieces);
    return { box, gaps };
  });
}
