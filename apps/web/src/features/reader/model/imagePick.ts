/**
 * reader/imagePick — what is selected when the reader picks a picture: a whole float (one click) or
 * a rectangle (the area tool). Pure.
 */
import type { SelectionGeometry } from './toolbarPlacement';
import type { PageFloat } from './floats';
import type { ImageKind } from '@/lib/imageAnchor';
import type { BBox } from '@papertree/document-ir';

/** The selected picture. */
export interface ImagePick {
  readonly page: number;
  /** PDF points, origin top-left. A float's includes its caption. */
  readonly box: BBox;
  /** `float`: one click on a detected float. `area`: drawn with the area tool (can be adjusted). */
  readonly origin: 'float' | 'area';
  /** The anchor's target kind: `figure` for a whole float, `figure_region` for a drawn area. */
  readonly kind: ImageKind;
  readonly float: PageFloat | null;
}

/**
 * The pick of a whole float.
 *
 * @param float The float.
 * @returns The pick, caption included.
 */
export function pickOfFloat(float: PageFloat): ImagePick {
  return { page: float.page, box: float.box, origin: 'float', kind: 'figure', float };
}

/**
 * The pick of a drawn area.
 *
 * @param page 0-based page.
 * @param box The rectangle.
 * @returns The pick.
 */
export function pickOfArea(page: number, box: BBox): ImagePick {
  return { page, box, origin: 'area', kind: 'figure_region', float: null };
}

/**
 * What the toolbar places itself by: the rectangle stands in for the selected lines.
 *
 * @param pick The pick.
 * @returns A geometry on the pick's page, with nothing on a second one.
 */
export function pickGeometry(pick: ImagePick): SelectionGeometry {
  return {
    pageIndex: pick.page,
    irQuads: [pick.box],
    irExtent: pick.box,
    endPageIndex: pick.page,
    endQuads: [],
    endExtent: null,
  };
}

/**
 * What the picture is called.
 *
 * @param pick The pick.
 * @returns "Figure 4", "Table 1", or "Selected area".
 */
export function pickLabel(pick: ImagePick): string {
  return pick.float?.label ?? 'Selected area';
}
