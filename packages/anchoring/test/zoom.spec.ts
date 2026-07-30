/**
 * anchoring/zoom.spec + anchoring/resize.spec — centroid drift < 1 pt.
 *
 * "Highlight centroid drift <1pt across zoom 50/75/100/150/200/400%."
 * "Drift <1pt across 5 viewport widths incl. iPad portrait and landscape."
 *
 * WHY THESE PASS BY CONSTRUCTION, AND WHY THEY ARE STILL WORTH ASSERTING.
 *
 * The overlay is sized to the scale-1 viewport and scaled with `transform: scale(z)`. Zoom
 * therefore multiplies every coordinate by one scalar and divides it back by the same scalar; the
 * drift is float rounding, not geometry, and it is ~1e-13 pt rather than ~1 pt. Viewport WIDTH does
 * not enter the transform at all — that is the point — so resize drift is exactly zero.
 *
 * The bar is nevertheless real, because it is a TRIPWIRE on the architecture rather than a
 * measurement of it. The v1 reader fails it by orders of magnitude: it divides `getClientRects()`
 * by `window.innerWidth` at capture and treats the result as a fraction of the page element at
 * paint, so its drift is a function of the browser window and the criterion cannot be met at all.
 * The day someone reintroduces a DOM measurement into this path, these numbers stop being 1e-13.
 *
 * Real fixture geometry, not synthetic rects: 199 blocks including the 92 non-rectangular polygons
 * and the rotated margin stamps.
 */

import { describe, expect, it } from 'vitest';

import { pdfToViewport, viewportToPdf, type Point } from '@papertree/document-ir';

import { viewportFor } from '../src/bridge.js';
import { indexDocument } from '../src/document.js';
import { FIXTURE_SLUGS, loadFixture, type FixtureSlug } from './fixtures.js';

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 4];

/** iPad portrait/landscape CSS widths plus a phone, a laptop and a wide desktop. */
const VIEWPORT_WIDTHS = [390, 834, 1194, 1440, 2560];

const DRIFT_TOLERANCE_PT = 1;

function centroid(polygon: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of polygon) {
    x += p[0];
    y += p[1];
  }
  return [x / polygon.length, y / polygon.length];
}

describe('anchoring/zoom.spec — centroid drift < 1pt across 50%–400%', () => {
  for (const slug of FIXTURE_SLUGS) {
    it(`${slug}: every block round-trips at every zoom`, () => {
      const doc = indexDocument(loadFixture(slug as FixtureSlug), 'zoom');
      let worst = 0;
      let checked = 0;

      for (const block of doc.blocks) {
        if (block.polygon.length < 3) continue;
        const page = doc.pages.find((p) => p.index === block.pageIndex);
        if (page === undefined) continue;
        const before = centroid(block.polygon);

        for (const zoom of ZOOMS) {
          const viewport = viewportFor({
            pageWidth: page.width,
            pageHeight: page.height,
            zoom,
            userUnit: page.user_unit,
          });
          // Paint, then recover — exactly what a click on a painted highlight does.
          const painted = block.polygon.map((p) => pdfToViewport(p, viewport));
          const recovered = painted.map((p) => viewportToPdf(p, viewport));
          const after = centroid(recovered);
          const drift = Math.hypot(after[0] - before[0], after[1] - before[1]);
          worst = Math.max(worst, drift);
          checked += 1;
        }
      }

      expect(checked).toBeGreaterThan(0);
      expect(worst).toBeLessThan(DRIFT_TOLERANCE_PT);
      // eslint-disable-next-line no-console
      console.log(`  zoom  ${slug.padEnd(26)} ${checked} round-trips, worst drift ${worst.toExponential(2)} pt`);
    });
  }

  it('userUnit != 1 is applied at the viewport and cancels on the round trip', () => {
    // No fixture page has `user_unit != 1` — all 10 are exactly 1.0 — so this is the only place the
    // boundary is exercised at all. `packages/document-ir/test/fixtures-pdf/userunit.pdf` covers it
    // against a real file; this covers the transform.
    const viewport = viewportFor({ pageWidth: 200, pageHeight: 300, zoom: 1.5, userUnit: 2.5 });
    const point: Point = [123.45, 234.56];
    const painted = pdfToViewport(point, viewport);
    expect(painted[0]).toBeCloseTo(123.45 * 1.5 * 2.5, 9);
    const back = viewportToPdf(painted, viewport);
    expect(Math.hypot(back[0] - point[0], back[1] - point[1])).toBeLessThan(1e-9);
  });

  it('a viewer rotation round-trips at all four angles', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const viewport = viewportFor({
        pageWidth: 612,
        pageHeight: 792,
        zoom: 1.25,
        userUnit: 1,
        viewerRotation: rotation,
      });
      const point: Point = [100, 700];
      const back = viewportToPdf(pdfToViewport(point, viewport), viewport);
      expect(Math.hypot(back[0] - point[0], back[1] - point[1])).toBeLessThan(1e-9);
    }
  });
});

describe('anchoring/resize.spec — drift < 1pt across 5 viewport widths', () => {
  for (const slug of FIXTURE_SLUGS) {
    it(`${slug}: geometry is independent of viewport width`, () => {
      const doc = indexDocument(loadFixture(slug as FixtureSlug), 'resize');
      let worst = 0;

      for (const block of doc.blocks) {
        if (block.polygon.length < 3) continue;
        const page = doc.pages.find((p) => p.index === block.pageIndex);
        if (page === undefined) continue;
        const before = centroid(block.polygon);

        for (const width of VIEWPORT_WIDTHS) {
          // A reader fits the page to the available width. THE FIT AFFECTS THE ZOOM AND NOTHING
          // ELSE — there is no other path from viewport width into the geometry, and that absence
          // is what this test exists to protect. A 16 pt gutter each side, as the wireframes show.
          const zoom = (width - 32) / page.width;
          const viewport = viewportFor({
            pageWidth: page.width,
            pageHeight: page.height,
            zoom,
            userUnit: page.user_unit,
          });
          const after = centroid(
            block.polygon.map((p) => viewportToPdf(pdfToViewport(p, viewport), viewport)),
          );
          worst = Math.max(worst, Math.hypot(after[0] - before[0], after[1] - before[1]));
        }
      }

      expect(worst).toBeLessThan(DRIFT_TOLERANCE_PT);
      // eslint-disable-next-line no-console
      console.log(`  resize ${slug.padEnd(26)} worst drift across 5 widths: ${worst.toExponential(2)} pt`);
    });
  }
});
