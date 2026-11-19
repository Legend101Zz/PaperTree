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
 * Nothing is measured: boxes are IR points times `irScale`, like the highlight overlay; the canvas
 * is read at its own backing-store resolution so a Retina page stays sharp.
 */
import { useLayoutEffect, useRef } from 'react';

import type { BBox } from '@papertree/document-ir';

/** Props for `PageMats`. */
export interface PageMatsProps {
  /** The page's own canvas, whose pixels are original (the filter is CSS only). Null until mounted. */
  readonly source: HTMLCanvasElement | null;
  /** Bumped each time the canvas finishes painting, so the copies are redrawn from the new pixels. */
  readonly paints: number;
  /** Figure and image boxes in IR points, y down (`figureRegions`). */
  readonly regions: readonly BBox[];
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
 * <PageMats source={canvas} paints={paints} regions={figureRegions(blocks)} irScale={1.25} cssWidth={612} cssHeight={792} />
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
    regions.forEach((box, index) => {
      const target = targets.current[index];
      if (target !== null && target !== undefined) {
        copyRegion(source, target, box, irScale, cssWidth, cssHeight);
      }
    });
  }, [source, paints, regions, irScale, cssWidth, cssHeight]);

  return (
    <div className="papertree-mats" aria-hidden="true" data-papertree-mats="">
      {regions.map((box, index) => (
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
