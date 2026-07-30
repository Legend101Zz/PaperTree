/**
 * document-ir/geometry.spec — the F0.4 geometry acceptance test.
 *
 * EPIC-00 names it: "Round-trips PDF↔viewport at 8 zoom levels and 4 rotations with <0.01pt error.
 * Handles `userUnit ≠ 1` and `CropBox ≠ MediaBox`." That is the `PDF ↔ viewport round-trip` block
 * below; everything else exists because passing only that would leave the rest of the coordinate
 * contract unasserted.
 *
 * WHAT IS BEING GRADED AGAINST WHAT. Every expectation comes from
 * `conformance/geometry-vectors.json`, never from the Python twin and never from this file's own
 * arithmetic. Inside that file:
 *
 *   · `fixture_vectors` expectations came from MUPDF — marker rectangles painted into real PDFs by
 *     a raw content stream, read back through MuPDF's own coordinate pipeline. An independent
 *     implementation, not this one.
 *   · everything else is hand arithmetic, written as literals in `test/fixtures-pdf/generate.py`
 *     with the working shown beside each entry.
 *
 * `python/tests/test_geometry.py` asserts the same file. Neither language is the other's oracle;
 * both are graded against one recording, exactly as identity.spec is against identity-vectors.json.
 *
 * WHY THE SYNTHETIC PDFs EXIST. ADR-001 Amendment 1 § C.6 / § H.2 measured that all 8 corpus PDFs
 * have /Rotate 0, no CropBox offset, no /UserUnit and no negative coordinates — so normalisation is
 * a no-op on 100 % of the corpus and untested by it, while perturbation P9 priced a wrong frame at
 * 99.93 % of block ids. `test/fixtures-pdf/` is that missing coverage.
 */
// oxlint-disable typescript/no-explicit-any -- the vector file is deliberately untyped JSON.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BBox, Point, Polygon } from '../src/generated/types.js';
import {
  DEFAULT_LINE_GAP_PT,
  GeometryError,
  ROTATIONS,
  type PageFrame,
  type Rotation,
  type Viewport,
  bboxFromViewport,
  bboxMatchesPolygonExtent,
  bboxToPolygon,
  bboxToViewport,
  bboxesIntersect,
  denormalisePoint,
  normalisePageFrame,
  normalisePoint,
  normalisePolygon,
  normaliseRect,
  normaliseRotation,
  pdfToViewport,
  pointInPolygon,
  polygonArea,
  polygonExtent,
  polygonIsSimple,
  polygonSignedArea,
  polygonsIntersect,
  stripUserUnit,
  unionOfLineRects,
  viewportSize,
  viewportToPdf,
} from '../src/geometry.js';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const VECTORS = JSON.parse(
  readFileSync(join(PKG, 'conformance/geometry-vectors.json'), 'utf8'),
) as Record<string, any>;

const pt = (v: readonly number[]): Point => [v[0] as number, v[1] as number];
const bx = (v: readonly number[]): BBox => [
  v[0] as number,
  v[1] as number,
  v[2] as number,
  v[3] as number,
];
const poly = (v: readonly (readonly number[])[]): Polygon => v.map(pt);

function frameFor(label: string): PageFrame {
  const record = (VECTORS['page_frames'] as any[]).find((f) => f.label === label);
  if (record === undefined) throw new Error(`no page frame ${label} in the vector file`);
  const raw = record.raw;
  return normalisePageFrame({
    mediaBox: bx(raw.media_box),
    ...(raw.crop_box === null ? {} : { cropBox: bx(raw.crop_box) }),
    rotate: raw.rotate,
    userUnit: raw.user_unit,
  });
}

/** The largest |error| seen anywhere in the round-trip suite; reported at the end of the file. */
let worstRoundTripError = 0;
function trackError(error: number): number {
  if (error > worstRoundTripError) worstRoundTripError = error;
  return error;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('the vector file is the contract', () => {
  it('is the version this suite was written against', () => {
    expect(VECTORS['contract_version']).toBe('papertree/geometry/1.0.0');
  });

  it('carries every table this suite asserts, non-empty', () => {
    for (const key of [
      'page_frames',
      'normalisation_vectors',
      'normalise_rect_vectors',
      'viewport_vectors',
      'polygon_vectors',
      'intersection_vectors',
      'line_union_vectors',
      'fixture_vectors',
    ]) {
      expect(Array.isArray(VECTORS[key]), key).toBe(true);
      expect((VECTORS[key] as any[]).length, key).toBeGreaterThan(0);
    }
  });
});

describe('normalisation — raw PDF space → IR space', () => {
  it.each((VECTORS['page_frames'] as any[]).map((f) => [f.label, f] as const))(
    '%s builds the recorded frame',
    (_label, record) => {
      const frame = frameFor(record.label);
      expect(frame.width).toBe(record.frame.width);
      expect(frame.height).toBe(record.frame.height);
      expect(frame.rotation).toBe(record.frame.rotation);
      expect(frame.userUnit).toBe(record.frame.user_unit);
      expect(frame.cropBox).toEqual(record.frame.crop_box);
      expect(frame.mediaBox).toEqual(record.frame.media_box);
      expect(frame.sourceCropBox).toEqual(record.frame.source_crop_box);
    },
  );

  it('crop_box is ALWAYS [0, 0, width, height] — DESIGN.md D23 / validator rule G4', () => {
    for (const record of VECTORS['page_frames'] as any[]) {
      const frame = frameFor(record.label);
      expect(frame.cropBox).toEqual([0, 0, frame.width, frame.height]);
      expect(frame.width).toBe(frame.cropBox[2] - frame.cropBox[0]);
      expect(frame.height).toBe(frame.cropBox[3] - frame.cropBox[1]);
    }
  });

  it.each((VECTORS['normalisation_vectors'] as any[]).map((v) => [v.label, v] as const))(
    '%s',
    (_label, vector) => {
      const frame = frameFor(vector.frame);
      expect(normalisePoint(frame, pt(vector.raw_point))).toEqual(vector.expected);
    },
  );

  it.each((VECTORS['normalisation_vectors'] as any[]).map((v) => [v.label, v] as const))(
    '%s inverts exactly',
    (_label, vector) => {
      const frame = frameFor(vector.frame);
      expect(denormalisePoint(frame, pt(vector.expected))).toEqual(vector.raw_point);
    },
  );

  it.each((VECTORS['normalise_rect_vectors'] as any[]).map((v) => [v.label, v] as const))(
    '%s',
    (_label, vector) => {
      const frame = frameFor(vector.frame);
      expect(normaliseRect(frame, bx(vector.raw_rect))).toEqual(vector.expected);
    },
  );

  it('normalises a polygon vertex by vertex, preserving order', () => {
    const frame = frameFor('frame:letter-cropped-rot90');
    const raw: Polygon = [
      [72, 720],
      [540, 720],
      [540, 90],
    ];
    expect(normalisePolygon(frame, raw)).toEqual([
      [630, 0],
      [630, 468],
      [0, 468],
    ]);
  });

  it('accepts every legal /Rotate spelling and rejects the rest', () => {
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(360)).toBe(0);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(-270)).toBe(90);
    expect(() => normaliseRotation(45)).toThrow(GeometryError);
    expect(() => normaliseRotation(Number.NaN)).toThrow(GeometryError);
  });

  it('rejects a CropBox that does not meet the MediaBox rather than emitting a null page', () => {
    expect(() =>
      normalisePageFrame({ mediaBox: [0, 0, 200, 300], cropBox: [400, 400, 500, 500] }),
    ).toThrow(GeometryError);
  });

  it('rejects a non-finite coordinate', () => {
    expect(() => normalisePageFrame({ mediaBox: [0, 0, Number.POSITIVE_INFINITY, 300] })).toThrow(
      GeometryError,
    );
  });
});

describe('the /UserUnit boundary — Amendment 1 pins it OUT of the stored frame', () => {
  it('normalisation ignores /UserUnit entirely', () => {
    const plain = normalisePageFrame({ mediaBox: [0, 0, 200, 300] });
    const scaled = normalisePageFrame({ mediaBox: [0, 0, 200, 300], userUnit: 2.5 });
    expect(scaled.width).toBe(plain.width);
    expect(scaled.height).toBe(plain.height);
    expect(normalisePoint(scaled, [100, 200])).toEqual(normalisePoint(plain, [100, 200]));
    expect(scaled.userUnit).toBe(2.5); // recorded, not applied
  });

  it('the viewport transform applies it, and is the ONLY thing that does', () => {
    const base: Viewport = { zoom: 1, rotation: 0, pageWidth: 200, pageHeight: 300 };
    expect(pdfToViewport([100, 100], base)).toEqual([100, 100]);
    expect(pdfToViewport([100, 100], { ...base, userUnit: 2.5 })).toEqual([250, 250]);
    expect(viewportSize({ ...base, userUnit: 2.5 })).toEqual({ width: 500, height: 750 });
  });

  it('stripUserUnit undoes a renderer that already applied it (PyMuPDF 1.28 does)', () => {
    // MEASURED: on a /UserUnit 2.5 page with /MediaBox [0 0 200 300], PyMuPDF 1.28 reports
    // page.rect as (0, 0, 500, 750) and scales every extracted coordinate by 2.5. Amendment 1's
    // rationale for "not applied" ("it is what MuPDF's page.rect gives") is therefore false; the
    // rule stands, but a parser must divide the factor back out exactly once.
    expect(stripUserUnit([250, 175], 2.5)).toEqual([100, 70]);
    expect(() => stripUserUnit([1, 1], 0)).toThrow(GeometryError);
  });
});

describe('PDF↔viewport round-trip, 8 zooms × 4 rotations, error <0.01pt', () => {
  const grid = VECTORS['roundtrip_grid'] as any;
  const tolerance = grid.max_abs_error_pt as number;

  it('uses 8 zooms and all 4 rotations, as the acceptance test names', () => {
    expect(grid.zooms).toHaveLength(8);
    expect(grid.rotations).toEqual([...ROTATIONS]);
    expect(tolerance).toBe(0.01);
  });

  it.each(
    (grid.rotations as Rotation[]).flatMap((rotation) =>
      (grid.zooms as number[]).map((zoom) => [rotation, zoom] as const),
    ),
  )(
    'rotation %i, zoom %f — round-trips every point, every userUnit, every page',
    (rotation, zoom) => {
      let worst = 0;
      for (const userUnit of grid.user_units as number[]) {
        for (const page of grid.pages as number[][]) {
          const viewport: Viewport = {
            zoom,
            rotation,
            userUnit,
            pageWidth: page[0] as number,
            pageHeight: page[1] as number,
          };
          for (const point of grid.points as number[][]) {
            const back = viewportToPdf(pdfToViewport(pt(point), viewport), viewport);
            worst = Math.max(worst, Math.abs(back[0] - (point[0] as number)));
            worst = Math.max(worst, Math.abs(back[1] - (point[1] as number)));
          }
        }
      }
      expect(trackError(worst)).toBeLessThan(tolerance);
    },
  );

  it('round-trips through every real page frame, including CropBox ≠ MediaBox and rotated', () => {
    // The grid above uses bare page sizes. This runs the same sweep through the frames actually
    // produced by normalisePageFrame — cropped, rotated, /UserUnit-bearing and combined — so the
    // "CropBox ≠ MediaBox" half of the acceptance criterion is exercised end to end and not by a
    // page size that happens to look cropped.
    let worst = 0;
    let combinations = 0;
    for (const record of VECTORS['page_frames'] as any[]) {
      const frame = frameFor(record.label);
      for (const zoom of grid.zooms as number[]) {
        for (const rotation of grid.rotations as Rotation[]) {
          const viewport: Viewport = {
            zoom,
            rotation,
            userUnit: frame.userUnit,
            pageWidth: frame.width,
            pageHeight: frame.height,
          };
          const probes: Point[] = [
            [0, 0],
            [frame.width, 0],
            [0, frame.height],
            [frame.width, frame.height],
            [frame.width / 2, frame.height / 3],
            [-frame.width, -frame.height], // outside the CropBox, on purpose
            [frame.width * 2, frame.height * 2],
            [0.1, 0.7],
            ...(VECTORS['normalisation_vectors'] as any[])
              .filter((v) => v.frame === record.label)
              .map((v) => pt(v.expected)),
          ];
          for (const probe of probes) {
            const back = viewportToPdf(pdfToViewport(probe, viewport), viewport);
            worst = Math.max(worst, Math.abs(back[0] - probe[0]), Math.abs(back[1] - probe[1]));
            combinations += 1;
          }
        }
      }
    }
    expect(combinations).toBeGreaterThan(1000);
    expect(trackError(worst)).toBeLessThan(tolerance);
  });

  it('round-trips a raw PDF point all the way out to the viewport and back', () => {
    // The full pipeline, which is what a highlight actually traverses:
    //   raw PDF → normalisePoint → pdfToViewport → viewportToPdf → denormalisePoint → raw PDF
    let worst = 0;
    for (const record of VECTORS['page_frames'] as any[]) {
      const frame = frameFor(record.label);
      const crop = frame.sourceCropBox;
      for (const zoom of grid.zooms as number[]) {
        for (const rotation of grid.rotations as Rotation[]) {
          const viewport: Viewport = {
            zoom,
            rotation,
            userUnit: frame.userUnit,
            pageWidth: frame.width,
            pageHeight: frame.height,
          };
          const raws: Point[] = [
            [crop[0], crop[1]],
            [crop[2], crop[3]],
            [(crop[0] + crop[2]) / 2, (crop[1] + crop[3]) / 2],
            [crop[0] - 37.5, crop[3] + 12.25],
          ];
          for (const raw of raws) {
            const back = denormalisePoint(
              frame,
              viewportToPdf(pdfToViewport(normalisePoint(frame, raw), viewport), viewport),
            );
            worst = Math.max(worst, Math.abs(back[0] - raw[0]), Math.abs(back[1] - raw[1]));
          }
        }
      }
    }
    expect(trackError(worst)).toBeLessThan(tolerance);
  });
});

describe('the viewport transform', () => {
  it.each((VECTORS['viewport_vectors'] as any[]).map((v) => [v.label, v] as const))(
    '%s',
    (_label, vector) => {
      const viewport: Viewport = {
        zoom: vector.zoom,
        rotation: vector.rotation,
        userUnit: vector.user_unit,
        pageWidth: vector.page[0],
        pageHeight: vector.page[1],
      };
      expect(viewportSize(viewport)).toEqual({
        width: vector.surface[0],
        height: vector.surface[1],
      });
      expect(pdfToViewport(pt(vector.pdf_point), viewport)).toEqual(vector.viewport_point);
      expect(viewportToPdf(pt(vector.viewport_point), viewport)).toEqual(vector.pdf_point);
    },
  );

  it('maps a bbox by re-extenting, because rotation exchanges the corners', () => {
    const viewport: Viewport = { zoom: 2, rotation: 90, pageWidth: 100, pageHeight: 200 };
    // page 100×200 at zoom 2 ⇒ W=200, H=400, surface 400×200. (10,20)→(400-40,20)=(360,20);
    // (30,50)→(400-100,60)=(300,60). Extent [300,20,360,60].
    expect(bboxToViewport([10, 20, 30, 50], viewport)).toEqual([300, 20, 360, 60]);
    expect(bboxFromViewport([300, 20, 360, 60], viewport)).toEqual([10, 20, 30, 50]);
  });

  it('rejects a zoom or userUnit that is not a positive finite number', () => {
    const base: Viewport = { zoom: 1, rotation: 0, pageWidth: 100, pageHeight: 100 };
    expect(() => pdfToViewport([0, 0], { ...base, zoom: 0 })).toThrow(GeometryError);
    expect(() => pdfToViewport([0, 0], { ...base, zoom: -1 })).toThrow(GeometryError);
    expect(() => pdfToViewport([0, 0], { ...base, userUnit: 0 })).toThrow(GeometryError);
  });
});

describe('polygon helpers', () => {
  it.each((VECTORS['polygon_vectors'] as any[]).map((v) => [v.label, v] as const))(
    '%s — extent, area, orientation, simplicity',
    (_label, vector) => {
      const p = poly(vector.polygon);
      expect(polygonExtent(p)).toEqual(vector.extent);
      expect(polygonArea(p)).toBe(vector.area);
      expect(polygonSignedArea(p)).toBe(vector.signed_area);
      expect(polygonIsSimple(p)).toBe(vector.is_simple);
      expect(bboxMatchesPolygonExtent(bx(vector.extent), p)).toBe(true);
    },
  );

  it.each(
    (VECTORS['polygon_vectors'] as any[]).flatMap((v) =>
      (v.points as any[]).map((p, i) => [`${String(v.label)}#${String(i)}`, v, p] as const),
    ),
  )('%s — point in polygon', (_label, vector, probe) => {
    expect(pointInPolygon(pt(probe.point), poly(vector.polygon))).toBe(probe.inside);
  });

  it('polygonExtent is the canonical Block.bbox — the validator and the producer share it', () => {
    // Semantic validator Geometry rule 1: bbox == polygon extent. Two implementations of "extent"
    // is exactly the drift DESIGN.md §1 exists to prevent, so the rule is a predicate over this
    // function rather than a second loop somewhere else.
    const p = poly(VECTORS['polygon_vectors'][0].polygon);
    expect(bboxMatchesPolygonExtent(polygonExtent(p), p)).toBe(true);
    expect(bboxMatchesPolygonExtent([0, 0, 1, 1], p)).toBe(false);
  });

  it('includeBoundary=false excludes points sitting exactly on an edge', () => {
    const square = poly([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(pointInPolygon([0, 5], square, true)).toBe(true);
    expect(pointInPolygon([0, 5], square, false)).toBe(false);
    expect(pointInPolygon([5, 5], square, false)).toBe(true);
  });

  it.each((VECTORS['intersection_vectors'] as any[]).map((v) => [v.label, v] as const))(
    '%s',
    (_label, vector) => {
      expect(polygonsIntersect(poly(vector.a), poly(vector.b))).toBe(vector.intersects);
      expect(polygonsIntersect(poly(vector.b), poly(vector.a))).toBe(vector.intersects);
    },
  );

  it('bbox intersection counts edge contact, and bboxToPolygon starts at the top-left', () => {
    expect(bboxesIntersect([0, 0, 10, 10], [10, 10, 20, 20])).toBe(true);
    expect(bboxesIntersect([0, 0, 10, 10], [10.0001, 0, 20, 10])).toBe(false);
    expect(bboxToPolygon([1, 2, 3, 4])).toEqual([
      [1, 2],
      [3, 2],
      [3, 4],
      [1, 4],
    ]);
    expect(bboxToPolygon([3, 4, 1, 2])).toEqual(bboxToPolygon([1, 2, 3, 4]));
  });

  it('a bbox flattening of the staircase DOES bleed — which is why polygons are the contract', () => {
    const staircase = poly(
      (VECTORS['polygon_vectors'] as any[]).find((v) => v.label === 'poly:staircase').polygon,
    );
    const notch: Point = [250, 135];
    expect(pointInPolygon(notch, staircase)).toBe(false);
    expect(pointInPolygon(notch, bboxToPolygon(polygonExtent(staircase)))).toBe(true);
  });
});

describe('union of line rects → polygon(s)', () => {
  it.each((VECTORS['line_union_vectors'] as any[]).map((v) => [v.label, v] as const))(
    '%s',
    (_label, vector) => {
      const result = unionOfLineRects((vector.rects as number[][]).map(bx), {
        verticalGapTolerance: vector.options.vertical_gap_tolerance,
        horizontalOverlapTolerance: vector.options.horizontal_overlap_tolerance,
      });
      expect(result).toEqual(vector.polygons);
    },
  );

  it("every returned polygon is simple, positive-area and within the schema's 512 vertices", () => {
    for (const vector of VECTORS['line_union_vectors'] as any[]) {
      for (const p of unionOfLineRects((vector.rects as number[][]).map(bx), {
        verticalGapTolerance: vector.options.vertical_gap_tolerance,
        horizontalOverlapTolerance: vector.options.horizontal_overlap_tolerance,
      })) {
        expect(p.length).toBeGreaterThanOrEqual(3);
        expect(p.length).toBeLessThanOrEqual(512);
        expect(polygonArea(p)).toBeGreaterThan(0);
        expect(polygonIsSimple(p)).toBe(true);
      }
    }
  });

  it('never emits a vertex inside the gutter of a two-column selection', () => {
    // The regression this whole helper exists for. Column 1 ends at x=292, column 2 starts at
    // x=320; a single bounding box would span 54..558 and paint the gutter.
    const vector = (VECTORS['line_union_vectors'] as any[]).find(
      (v) => v.label === 'union:two-column-selection',
    );
    const polygons = unionOfLineRects((vector.rects as number[][]).map(bx));
    expect(polygons).toHaveLength(2);
    for (const p of polygons) {
      for (const vertex of p) {
        expect(vertex[0] > 292 && vertex[0] < 320).toBe(false);
      }
    }
    expect(polygonsIntersect(polygons[0] as Polygon, polygons[1] as Polygon)).toBe(false);
    for (const gutterPoint of [
      [300, 105],
      [310, 120],
      [296, 135],
    ] as Point[]) {
      for (const p of polygons) expect(pointInPolygon(gutterPoint, p)).toBe(false);
    }
  });

  it('does NOT collapse to a bounding box when consecutive line boxes overlap', () => {
    // THE REGRESSION. MuPDF's line rects are font ascent/descent boxes, so consecutive lines
    // routinely abut or overlap — this helper's own docstring says so, and that made the
    // overlapping case the NORMAL case, not an edge case. Deciding band membership against the
    // band's RUNNING extent (`r.y0 < band.y1`) cascades: each merge pushes y1 down, the next line
    // overlaps THAT, and the paragraph collapses into a single 4-point rectangle. It shipped in
    // three golden fixtures. Membership is decided against the band's ANCHOR interval instead.
    const overlapping: BBox[] = [
      [54, 100, 292, 112],
      [54, 111, 292, 123],
      [54, 122, 200, 134],
    ];
    const [polygon] = unionOfLineRects(overlapping);
    expect(polygon).toBeDefined();
    // Not a rectangle: a rectangle here is the bug, and "4 vertices" is exactly how it looked.
    expect((polygon as Polygon).length).toBeGreaterThan(4);
    expect(polygon).toEqual([
      [292, 100],
      [292, 122.5],
      [200, 122.5],
      [200, 134],
      [54, 134],
      [54, 100],
    ]);
    // The lie the bounding box told: 92 pt of blank page beside the short last line.
    for (const blank of [
      [250, 128],
      [290, 133],
      [210, 130],
    ] as Point[]) {
      expect(pointInPolygon(blank, polygon as Polygon)).toBe(false);
      // …and it IS inside the bounding box, so the two really do differ where it matters.
      expect(pointInPolygon(blank, bboxToPolygon(polygonExtent(polygon as Polygon)))).toBe(true);
    }
    // Every line the caller passed is still covered — the fix must not under-claim either.
    for (const rect of overlapping) {
      const centre: Point = [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2];
      expect(pointInPolygon(centre, polygon as Polygon)).toBe(true);
    }
    expect(polygonIsSimple(polygon as Polygon)).toBe(true);
  });

  it('covers every input rect it did not drop', () => {
    const vector = (VECTORS['line_union_vectors'] as any[]).find(
      (v) => v.label === 'union:two-column-selection',
    );
    const polygons = unionOfLineRects((vector.rects as number[][]).map(bx));
    for (const rect of vector.rects as number[][]) {
      const centre: Point = [
        ((rect[0] as number) + (rect[2] as number)) / 2,
        ((rect[1] as number) + (rect[3] as number)) / 2,
      ];
      expect(polygons.some((p) => pointInPolygon(centre, p))).toBe(true);
    }
  });

  it('respects the documented defaults', () => {
    expect(DEFAULT_LINE_GAP_PT).toBe(2);
    const withinDefault = unionOfLineRects([
      [54, 100, 292, 112],
      [54, 114, 292, 126],
    ]);
    expect(withinDefault).toHaveLength(1);
    const beyondDefault = unionOfLineRects([
      [54, 100, 292, 112],
      [54, 114.001, 292, 126],
    ]);
    expect(beyondDefault).toHaveLength(2);
  });

  it('bounds the vertex count by merging bands rather than by bleeding across columns', () => {
    const rects: BBox[] = [];
    for (let i = 0; i < 300; i += 1) {
      rects.push([54, 100 + i * 13, 54 + 100 + (i % 7) * 20, 112 + i * 13]);
    }
    const [p] = unionOfLineRects(rects, { verticalGapTolerance: 2 });
    expect(p).toBeDefined();
    expect((p as Polygon).length).toBeLessThanOrEqual(512);
    expect(polygonExtent(p as Polygon)[0]).toBe(54);
    expect(polygonExtent(p as Polygon)[2]).toBe(274);
  });

  it('rejects a maxVertices that cannot hold a rectangle', () => {
    expect(() => unionOfLineRects([[0, 0, 1, 1]], { maxVertices: 3 })).toThrow(GeometryError);
  });
});

describe('synthetic PDF fixtures — the coverage the corpus cannot give (Amendment 1 § H.2)', () => {
  /**
   * Read /MediaBox, /CropBox, /Rotate and /UserUnit out of the fixture's raw bytes.
   *
   * Deliberately a 12-line regex rather than a PDF library: the fixtures are uncompressed and this
   * asserts that the values recorded in the vector file are the values *in the file*, which a
   * library would hide behind its own coordinate conventions — the very thing under test.
   */
  function pageDict(file: string): {
    mediaBox: BBox;
    cropBox: BBox | null;
    rotate: number;
    userUnit: number | null;
  } {
    const text = readFileSync(join(PKG, 'test/fixtures-pdf', file), 'latin1');
    const N = String.raw`(-?[\d.]+)`;
    const box = (key: string): BBox | null => {
      const m = new RegExp(String.raw`/${key}\s*\[\s*${N}\s+${N}\s+${N}\s+${N}\s*\]`).exec(text);
      return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    };
    const rotate = new RegExp(String.raw`/Rotate\s+${N}`).exec(text);
    const userUnit = new RegExp(String.raw`/UserUnit\s+${N}`).exec(text);
    const media = box('MediaBox');
    if (media === null) throw new Error(`${file} has no /MediaBox`);
    return {
      mediaBox: media,
      cropBox: box('CropBox'),
      rotate: rotate === null ? 0 : Number(rotate[1]),
      userUnit: userUnit === null ? null : Number(userUnit[1]),
    };
  }

  it('covers all four /Rotate values, a CropBox offset, /UserUnit and negative coordinates', () => {
    const files = (VECTORS['fixture_vectors'] as any[]).map((f) => f.file as string);
    expect(files).toEqual(
      expect.arrayContaining([
        'rotate-0.pdf',
        'rotate-90.pdf',
        'rotate-180.pdf',
        'rotate-270.pdf',
        'cropbox-offset.pdf',
        'userunit.pdf',
        'negative-mediabox.pdf',
        'combined.pdf',
      ]),
    );
  });

  it.each((VECTORS['fixture_vectors'] as any[]).map((f) => [f.file, f] as const))(
    '%s — the recorded page attributes are the ones in the file',
    (_file, record) => {
      const dict = pageDict(record.file);
      expect(dict.mediaBox).toEqual(record.raw.media_box);
      expect(dict.cropBox).toEqual(record.raw.crop_box);
      expect(dict.rotate).toEqual(record.raw.rotate);
      expect(dict.userUnit).toEqual(record.raw.user_unit);
    },
  );

  it.each((VECTORS['fixture_vectors'] as any[]).map((f) => [f.file, f] as const))(
    "%s — normalising the markers reproduces MuPDF's own answer",
    (_file, record) => {
      const dict = pageDict(record.file);
      const frame = normalisePageFrame({
        mediaBox: dict.mediaBox,
        ...(dict.cropBox === null ? {} : { cropBox: dict.cropBox }),
        rotate: dict.rotate,
        ...(dict.userUnit === null ? {} : { userUnit: dict.userUnit }),
      });
      expect([frame.width, frame.height]).toEqual(record.expected_page_size);
      const got = (record.marker_rects_raw_pdf_space as number[][]).map((r) =>
        normaliseRect(frame, bx(r)),
      );
      expect(got).toEqual(record.expected_marker_bboxes);
    },
  );

  it("MuPDF's raw page.rect is /UserUnit-scaled — the trap the IR frame must not inherit", () => {
    const record = (VECTORS['fixture_vectors'] as any[]).find((f) => f.file === 'userunit.pdf');
    // MuPDF reports (0, 0, 500, 750) for a 200×300 page with /UserUnit 2.5. The IR frame is
    // 200×300. Taking page.rect at face value would scale every stored coordinate by 2.5 and,
    // per Amendment 1 § C.6's P9 analogue, silently re-base every block id on this class of page.
    expect(record.mupdf_page_rect_unadjusted).toEqual([0, 0, 500, 750]);
    expect(record.expected_page_size).toEqual([200, 300]);
  });

  it('the /UserUnit fixture normalises identically to the same page without it', () => {
    const withUU = (VECTORS['fixture_vectors'] as any[]).find((f) => f.file === 'userunit.pdf');
    const without = (VECTORS['fixture_vectors'] as any[]).find((f) => f.file === 'rotate-0.pdf');
    expect(withUU.expected_marker_bboxes).toEqual(without.expected_marker_bboxes);
  });
});

describe('the worst observed round-trip error', () => {
  it('is reported, and is far below the 0.01 pt criterion', () => {
    // Printed rather than merely asserted: "under the bound" is the pass condition, but the actual
    // margin is what tells a future reader whether the bound is comfortable or lucky.
    console.log(
      `document-ir/geometry.spec — worst observed round-trip error: ${worstRoundTripError.toExponential(3)} pt (criterion < 0.01 pt)`,
    );
    expect(worstRoundTripError).toBeLessThan(0.01);
  });
});
