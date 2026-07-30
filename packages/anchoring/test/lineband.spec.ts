/**
 * lineband.spec — the clamp actually removes the measured defect, and does not damage good input.
 *
 * The census this asserts against, re-derived from the fixtures at HEAD rather than quoted:
 * `resnet` has 18 places where one line's span box overlaps the next line's, by 5.16–5.39 pt;
 * `attention` has 9 and `neural-odes` has 14, the worst by 19.24 pt. The cause is MuPDF reporting
 * a run's FONT box rather than its glyphs' — 22 spans in `resnet` come out 17.28–17.35 pt tall
 * where the median is 9.96.
 *
 * Two assertions, and the second matters as much as the first: a clamp that fixed the overlaps by
 * shrinking every band would "pass" while making every highlight too short.
 */

import { describe, expect, it } from 'vitest';

import { clampLineBands, groupIntoLines, modalLinePitch, quadsForRange } from '../src/lineband.js';
import { indexDocument } from '../src/document.js';
import { FIXTURE_SLUGS, loadFixture, type FixtureSlug } from './fixtures.js';

describe('lineband — the span-box defect', () => {
  for (const slug of FIXTURE_SLUGS) {
    it(`${slug}: no clamped band overlaps the next`, () => {
      const doc = indexDocument(loadFixture(slug as FixtureSlug), 'lineband');
      let rawOverlaps = 0;
      let clampedOverlaps = 0;
      let worstRaw = 0;

      for (const block of doc.blocks) {
        if (block.spans.length < 2) continue;
        const lines = groupIntoLines(block.spans);
        if (lines.length < 2) continue;

        const raw = lines.map((line) => [
          Math.min(...line.map((s) => s.bbox[0])),
          Math.min(...line.map((s) => s.bbox[1])),
          Math.max(...line.map((s) => s.bbox[2])),
          Math.max(...line.map((s) => s.bbox[3])),
        ]);
        for (let i = 0; i + 1 < raw.length; i += 1) {
          const a = raw[i]!;
          const b = raw[i + 1]!;
          const xo = Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!);
          const yo = a[3]! - b[1]!;
          if (xo > 0 && yo > 0.5) {
            rawOverlaps += 1;
            worstRaw = Math.max(worstRaw, yo);
          }
        }

        const clamped = clampLineBands(lines);
        for (let i = 0; i + 1 < clamped.length; i += 1) {
          const a = clamped[i]!;
          const b = clamped[i + 1]!;
          const xo = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
          const yo = a[3] - b[1];
          if (xo > 0 && yo > 0.01) clampedOverlaps += 1;
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `  ${slug.padEnd(26)} raw line-band overlaps: ${String(rawOverlaps).padStart(3)}` +
          ` (worst ${worstRaw.toFixed(2)}pt) -> after clamp: ${clampedOverlaps}`,
      );
      expect(clampedOverlaps).toBe(0);
    });

    it(`${slug}: the clamp never over-shrinks and never moves a band's top`, () => {
      // The other half of the bar: a clamp that shrank EVERY band to nothing would pass the overlap
      // test above and make every highlight useless. This asserts the PROPERTIES the clamp must
      // have, not the branches it takes — re-deriving the implementation's own conditions here
      // would be circular, and an earlier version of this test that did so failed on bands the
      // successor pass had legitimately trimmed.
      const doc = indexDocument(loadFixture(slug as FixtureSlug), 'lineband');
      let unchanged = 0;
      let shrunk = 0;

      for (const block of doc.blocks) {
        const lines = groupIntoLines(block.spans);
        const pitch = modalLinePitch(lines);
        if (pitch === null) continue;
        const clamped = clampLineBands(lines);

        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]!;
          const rawTop = Math.min(...line.map((s) => s.bbox[1]));
          const rawHeight = Math.max(...line.map((s) => s.bbox[3])) - rawTop;
          const band = clamped[i]!;
          const newHeight = band[3] - band[1];

          // 1. The top NEVER moves. The measured defect is entirely downward — `y0` agrees with the
          //    neighbouring lines and only `y1` overshoots — so moving the top would introduce an
          //    error where there was none.
          expect(band[1]).toBeCloseTo(rawTop, 9);

          // 2. A band is never GROWN. The clamp only ever removes over-claim.
          expect(newHeight).toBeLessThanOrEqual(rawHeight + 1e-9);

          // 3. THE ANTI-OVER-SHRINK BOUND. A band is never shorter than the smallest of three
          //    things, each of which is a real constraint rather than a restatement of the code:
          //      • what it already was          — the clamp only ever removes over-claim;
          //      • one line of this block's type — below the modal pitch it is cutting glyphs;
          //      • the space before the next line — it cannot have more, and must not take less.
          //    Taking the minimum is what makes this independent of WHICH of the two clamp passes
          //    fired: whichever did, the survivor still covers a readable line.
          const nextLine = lines[i + 1];
          const available =
            nextLine === undefined
              ? Number.POSITIVE_INFINITY
              : Math.max(0, Math.min(...nextLine.map((s) => s.bbox[1])) - rawTop);
          expect(newHeight).toBeGreaterThanOrEqual(
            Math.min(rawHeight, pitch, available) - 1e-9,
          );

          if (Math.abs(newHeight - rawHeight) < 1e-9) unchanged += 1;
          else shrunk += 1;
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `  ${slug.padEnd(26)} bands untouched: ${String(unchanged).padStart(4)}, clamped: ${shrunk}`,
      );
      // The clamp must be a SCALPEL, not a blanket: the overwhelming majority of bands are correct
      // as extracted and must come through byte-identical.
      expect(unchanged).toBeGreaterThan(shrunk * 5);
    });
  }

  it('a selection crossing a two-column gutter produces TWO polygons, never one box', () => {
    // Commitment 2, at the layer that actually paints. Epic 0 shipped and then FIXED this exact bug
    // one level up in `unionOfLineRects`; a bounding box here would reintroduce it downstream with
    // a better view, painting straight across the gutter.
    const left = [
      { start: 0, end: 10, bbox: [50, 100, 280, 110] as [number, number, number, number] },
      { start: 10, end: 20, bbox: [50, 112, 280, 122] as [number, number, number, number] },
    ];
    const right = [
      { start: 20, end: 30, bbox: [320, 100, 550, 110] as [number, number, number, number] },
      { start: 30, end: 40, bbox: [320, 112, 550, 122] as [number, number, number, number] },
    ];
    const { polygons } = quadsForRange([...left, ...right], 0, 40);
    expect(polygons.length).toBe(2);
    // And nothing may be painted over the gutter (280..320).
    for (const polygon of polygons) {
      const xs = polygon.map((p) => p[0]);
      const spansGutter = Math.min(...xs) < 300 && Math.max(...xs) > 300;
      expect(spansGutter).toBe(false);
    }
  });

  it('clamps a synthetic run of the exact defect the fixtures exhibit', () => {
    // 9.96 pt type on 11.96 pt leading, with one line reported 17.28 pt tall — the resnet case,
    // reduced to its arithmetic so the expected numbers are readable.
    const lines = [
      [{ start: 0, end: 10, bbox: [50, 556.2, 286, 566.16] as [number, number, number, number] }],
      [{ start: 11, end: 20, bbox: [50, 568.16, 286, 585.44] as [number, number, number, number] }],
      [{ start: 21, end: 30, bbox: [50, 580.12, 286, 590.08] as [number, number, number, number] }],
    ];
    const clamped = clampLineBands(lines);
    // The defective band was 17.28 pt tall and reached 5.32 pt into the next line. It must not.
    expect(clamped[1]![3]).toBeLessThanOrEqual(clamped[2]![1] + 1e-9);
    expect(clamped[1]![3] - clamped[1]![1]).toBeLessThan(17.28);
  });
});
