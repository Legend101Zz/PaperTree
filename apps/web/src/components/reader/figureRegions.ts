/**
 * reader/figureRegions: where a page's figures are, for the dark and sepia page (#345).
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
