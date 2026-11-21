'use client';

/**
 * reader/PageMats: figures keep their own colours on a dark or sepia page (#345).
 *
 * THE CHOICE, for the PDF's dark page. Two ways were weighed.
 *  - pdf.js's `pageColors` render option recolours vector text and keeps raster images, but it
 *    needs a re-render of every mounted page on each change of page colour (the canvas is the
 *    paper), it recolours vector figures too (a plot's lines become the ink colour), and it has no
 *    notion of hue, so coloured type turns into the ink colour.
 *  - A CSS filter on the canvas (`pdfPage.css`: invert, then hue-rotate by 180 degrees, which maps
 *    lightness and keeps hue) recolours the pixels already drawn: switching page is instant, with
 *    no re-parse and no re-render. Its cost is that figures are inverted too, so the figure boxes
 *    (the parser knows them) are drawn back from the SAME canvas, whose pixels the filter never
 *    touched, on a mat.
 * The second is chosen: live, and it keeps vector figures intact. The copy is a `drawImage` of a
 * box out of the canvas that is already there, so it costs a blit per figure, not a render.
 *
 * THE MAT NEVER COVERS OTHER TEXT. It is opaque, so its padding is only as wide as the free space
 * round the figure (`MatRegion.gaps`, from `figureMats`): a caption that starts 4 pt under the
 * figure stops the bottom padding at 4 pt, and a figure's own labels are inside the box, drawn
 * whole. The stylesheet takes the smaller of `--pt-pdf-mat-pad` and the gap per side.
 *
 * SEPIA KEEPS THE MAT. The sepia canvas multiplies, so figure colours do survive it (a white
 * ground becomes the cream), but the design (P4 step 4, and V3-37: "figures keep their colours on
 * a mat", with `--pt-pdf-mat` #FBF5E6 and its edge for sepia) sets a figure on a lighter plate on
 * sepia too, and a multiply would tint every figure by the cream. The same mat, the same rule.
 *
 * Nothing is measured: boxes are IR points times `irScale`, like the highlight overlay; the canvas
 * is read at its own backing-store resolution so a Retina page stays sharp.
 */
import { useLayoutEffect, useRef, type CSSProperties } from 'react';

import type { BBox } from '@papertree/document-ir';

import type { MatRegion } from './figureRegions';

/** Props for `PageMats`. */
export interface PageMatsProps {
  /** The page's own canvas, whose pixels are original (the filter is CSS only). Null until mounted. */
  readonly source: HTMLCanvasElement | null;
  /** Bumped each time the canvas finishes painting, so the copies are redrawn from the new pixels. */
  readonly paints: number;
  /** Figure mats in IR points, y down (`figureMats`): the pixels to keep and the padding each side may have. */
  readonly regions: readonly MatRegion[];
  /** IR points to CSS pixels: `zoom × userUnit`. */
  readonly irScale: number;
  /** The page's CSS box, the canvas's. */
  readonly cssWidth: number;
  readonly cssHeight: number;
}

/** Copies one IR box out of the page canvas into `target`, at the canvas's own resolution. */
function copyRegion(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
  box: BBox,
  irScale: number,
  cssWidth: number,
  cssHeight: number,
): void {
  if (cssWidth <= 0 || cssHeight <= 0 || source.width <= 1) return;
  const kx = source.width / cssWidth;
  const ky = source.height / cssHeight;
  const sx = Math.max(0, box[0] * irScale * kx);
  const sy = Math.max(0, box[1] * irScale * ky);
  const sw = Math.min(source.width - sx, (box[2] - box[0]) * irScale * kx);
  const sh = Math.min(source.height - sy, (box[3] - box[1]) * irScale * ky);
  if (sw < 1 || sh < 1) return;
  target.width = Math.round(sw);
  target.height = Math.round(sh);
  target.getContext('2d')?.drawImage(source, sx, sy, sw, sh, 0, 0, target.width, target.height);
}

/**
 * The mats: one box per figure, above the recoloured canvas and under the text layer, so selecting
 * text and the highlight overlay (above both) work as before. Draws nothing for a light page
 * (the caller does not mount it).
 *
 * @example
 * <PageMats source={canvas} paints={paints} regions={figureMats(blocks)} irScale={1.25} cssWidth={612} cssHeight={792} />
 */
export function PageMats({
  source,
  paints,
  regions,
  irScale,
  cssWidth,
  cssHeight,
}: PageMatsProps): JSX.Element {
  const targets = useRef<(HTMLCanvasElement | null)[]>([]);

  useLayoutEffect(() => {
    if (source === null) return;
    regions.forEach((region, index) => {
      const target = targets.current[index];
      if (target !== null && target !== undefined) {
        copyRegion(source, target, region.box, irScale, cssWidth, cssHeight);
      }
    });
  }, [source, paints, regions, irScale, cssWidth, cssHeight]);

  return (
    <div className="papertree-mats" aria-hidden="true" data-papertree-mats="">
      {regions.map(({ box, gaps }, index) => (
        <div
          // eslint-disable-next-line react/no-array-index-key -- boxes have no ids; order is the id
          key={index}
          className="papertree-mat"
          data-papertree-mat=""
          style={{
            left: `${box[0] * irScale}px`,
            top: `${box[1] * irScale}px`,
            width: `${(box[2] - box[0]) * irScale}px`,
            height: `${(box[3] - box[1]) * irScale}px`,
            // the free padding per side, which the stylesheet caps at the token (top right bottom left)
            ...({
              '--pt-mat-gap-t': `${gaps[0] * irScale}px`,
              '--pt-mat-gap-r': `${gaps[1] * irScale}px`,
              '--pt-mat-gap-b': `${gaps[2] * irScale}px`,
              '--pt-mat-gap-l': `${gaps[3] * irScale}px`,
            } as CSSProperties),
          }}
        >
          <canvas
            ref={(el) => {
              targets.current[index] = el;
            }}
          />
        </div>
      ))}
    </div>
  );
}
