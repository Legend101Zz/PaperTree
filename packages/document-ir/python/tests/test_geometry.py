"""The Python twin of ``test/geometry.spec.ts`` - the F0.4 geometry acceptance test.

EPIC-00 names it: "Round-trips PDF<->viewport at 8 zoom levels and 4 rotations with <0.01pt error.
Handles ``userUnit != 1`` and ``CropBox != MediaBox``." That is
``TestViewportRoundTrip`` below; everything else exists because passing only that would leave the
rest of the coordinate contract unasserted.

WHAT IS BEING GRADED AGAINST WHAT. Every expectation comes from
``conformance/geometry-vectors.json`` - never from the TypeScript twin, never from this file's own
arithmetic. Inside that file, ``fixture_vectors`` expectations came from MUPDF (marker rectangles
painted into real PDFs by a raw content stream and read back through MuPDF's own coordinate
pipeline); everything else is hand arithmetic written as literals in
``test/fixtures-pdf/generate.py`` with the working shown beside each entry.

``test/geometry.spec.ts`` asserts the same file. Neither language is the other's oracle.

WHY THE SYNTHETIC PDFs EXIST. ADR-001 Amendment 1 sections C.6 / H.2 measured that all 8 corpus
PDFs have /Rotate 0, no CropBox offset, no /UserUnit and no negative coordinates - so normalisation
is a no-op on 100% of the corpus and untested by it, while perturbation P9 priced a wrong frame at
99.93% of block ids. ``test/fixtures-pdf/`` is that missing coverage. Note that this module reads
those PDFs with a 12-line regex rather than a PDF library: pymupdf is a fixture-GENERATION
dependency, not a test dependency, and a library would hide the raw values behind its own
coordinate conventions - the very thing under test.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from papertree_document_ir.geometry import (
    DEFAULT_LINE_GAP_PT,
    ROTATIONS,
    GeometryError,
    PageFrame,
    RawPageBoxes,
    Rotation,
    Viewport,
    bbox_from_viewport,
    bbox_matches_polygon_extent,
    bbox_to_polygon,
    bbox_to_viewport,
    bboxes_intersect,
    denormalise_point,
    normalise_page_frame,
    normalise_point,
    normalise_polygon,
    normalise_rect,
    normalise_rotation,
    pdf_to_viewport,
    point_in_polygon,
    polygon_area,
    polygon_extent,
    polygon_is_simple,
    polygon_signed_area,
    polygons_intersect,
    strip_user_unit,
    union_of_line_rects,
    viewport_size,
    viewport_to_pdf,
)

PKG = Path(__file__).resolve().parents[2]
VECTORS: dict[str, Any] = json.loads(
    (PKG / "conformance" / "geometry-vectors.json").read_text(encoding="utf-8")
)

PAGE_FRAMES: list[dict[str, Any]] = VECTORS["page_frames"]
NORMALISATION_VECTORS: list[dict[str, Any]] = VECTORS["normalisation_vectors"]
NORMALISE_RECT_VECTORS: list[dict[str, Any]] = VECTORS["normalise_rect_vectors"]
VIEWPORT_VECTORS: list[dict[str, Any]] = VECTORS["viewport_vectors"]
POLYGON_VECTORS: list[dict[str, Any]] = VECTORS["polygon_vectors"]
INTERSECTION_VECTORS: list[dict[str, Any]] = VECTORS["intersection_vectors"]
LINE_UNION_VECTORS: list[dict[str, Any]] = VECTORS["line_union_vectors"]
FIXTURE_VECTORS: list[dict[str, Any]] = VECTORS["fixture_vectors"]
GRID: dict[str, Any] = VECTORS["roundtrip_grid"]

# The largest |error| seen anywhere in the round-trip suite; reported by the last test.
_worst_round_trip_error = 0.0


def _track(error: float) -> float:
    global _worst_round_trip_error
    _worst_round_trip_error = max(_worst_round_trip_error, error)
    return error


def frame_for(label: str) -> PageFrame:
    record = next(f for f in PAGE_FRAMES if f["label"] == label)
    raw = record["raw"]
    return normalise_page_frame(
        RawPageBoxes(
            media_box=raw["media_box"],
            crop_box=raw["crop_box"],
            rotate=raw["rotate"],
            user_unit=raw["user_unit"],
        )
    )


def ids(vectors: list[dict[str, Any]], key: str = "label") -> list[str]:
    return [str(v[key]) for v in vectors]


# --- the vector file is the contract ------------------------------------------------------------


def test_contract_version() -> None:
    assert VECTORS["contract_version"] == "papertree/geometry/1.0.0"


@pytest.mark.parametrize(
    "key",
    [
        "page_frames",
        "normalisation_vectors",
        "normalise_rect_vectors",
        "viewport_vectors",
        "polygon_vectors",
        "intersection_vectors",
        "line_union_vectors",
        "fixture_vectors",
    ],
)
def test_every_table_is_present_and_non_empty(key: str) -> None:
    assert isinstance(VECTORS[key], list)
    assert VECTORS[key]


# --- normalisation ------------------------------------------------------------------------------


@pytest.mark.parametrize("record", PAGE_FRAMES, ids=ids(PAGE_FRAMES))
def test_page_frame_matches_recording(record: dict[str, Any]) -> None:
    frame = frame_for(record["label"])
    expected = record["frame"]
    assert frame.width == expected["width"]
    assert frame.height == expected["height"]
    assert frame.rotation == expected["rotation"]
    assert frame.user_unit == expected["user_unit"]
    assert frame.crop_box == expected["crop_box"]
    assert frame.media_box == expected["media_box"]
    assert frame.source_crop_box == expected["source_crop_box"]


@pytest.mark.parametrize("record", PAGE_FRAMES, ids=ids(PAGE_FRAMES))
def test_crop_box_is_always_page_sized(record: dict[str, Any]) -> None:
    """DESIGN.md D23 / semantic validator rule G4 - the cheapest coordinate-space check there is."""
    frame = frame_for(record["label"])
    assert frame.crop_box == [0.0, 0.0, frame.width, frame.height]
    assert frame.width == frame.crop_box[2] - frame.crop_box[0]
    assert frame.height == frame.crop_box[3] - frame.crop_box[1]


@pytest.mark.parametrize("vector", NORMALISATION_VECTORS, ids=ids(NORMALISATION_VECTORS))
def test_normalise_point(vector: dict[str, Any]) -> None:
    frame = frame_for(vector["frame"])
    assert normalise_point(frame, vector["raw_point"]) == vector["expected"]


@pytest.mark.parametrize("vector", NORMALISATION_VECTORS, ids=ids(NORMALISATION_VECTORS))
def test_denormalise_point_inverts_exactly(vector: dict[str, Any]) -> None:
    frame = frame_for(vector["frame"])
    assert denormalise_point(frame, vector["expected"]) == vector["raw_point"]


@pytest.mark.parametrize("vector", NORMALISE_RECT_VECTORS, ids=ids(NORMALISE_RECT_VECTORS))
def test_normalise_rect(vector: dict[str, Any]) -> None:
    frame = frame_for(vector["frame"])
    assert normalise_rect(frame, vector["raw_rect"]) == vector["expected"]


def test_normalise_polygon_preserves_vertex_order() -> None:
    frame = frame_for("frame:letter-cropped-rot90")
    raw = [[72, 720], [540, 720], [540, 90]]
    assert normalise_polygon(frame, raw) == [[630, 0], [630, 468], [0, 468]]


def test_rotate_spellings() -> None:
    assert normalise_rotation(0) == 0
    assert normalise_rotation(360) == 0
    assert normalise_rotation(-90) == 270
    assert normalise_rotation(450) == 90
    assert normalise_rotation(-270) == 90
    with pytest.raises(GeometryError):
        normalise_rotation(45)
    with pytest.raises(GeometryError):
        normalise_rotation(float("nan"))


def test_crop_box_disjoint_from_media_box_is_rejected() -> None:
    with pytest.raises(GeometryError):
        normalise_page_frame(
            RawPageBoxes(media_box=[0, 0, 200, 300], crop_box=[400, 400, 500, 500])
        )


def test_non_finite_coordinate_is_rejected() -> None:
    with pytest.raises(GeometryError):
        normalise_page_frame(RawPageBoxes(media_box=[0, 0, float("inf"), 300]))


# --- the /UserUnit boundary ---------------------------------------------------------------------


def test_normalisation_ignores_user_unit() -> None:
    """Amendment 1 pins /UserUnit OUT of the frame the block id is computed in."""
    plain = normalise_page_frame(RawPageBoxes(media_box=[0, 0, 200, 300]))
    scaled = normalise_page_frame(RawPageBoxes(media_box=[0, 0, 200, 300], user_unit=2.5))
    assert (scaled.width, scaled.height) == (plain.width, plain.height)
    assert normalise_point(scaled, [100, 200]) == normalise_point(plain, [100, 200])
    assert scaled.user_unit == 2.5  # recorded, not applied


def test_viewport_is_the_only_place_user_unit_is_applied() -> None:
    base = Viewport(zoom=1, rotation=0, page_width=200, page_height=300)
    assert pdf_to_viewport([100, 100], base) == [100, 100]
    scaled = Viewport(zoom=1, rotation=0, page_width=200, page_height=300, user_unit=2.5)
    assert pdf_to_viewport([100, 100], scaled) == [250, 250]
    assert viewport_size(scaled) == (500, 750)


def test_strip_user_unit_undoes_a_renderer_that_already_applied_it() -> None:
    """MEASURED: PyMuPDF 1.28 reports page.rect as (0,0,500,750) for a 200x300 /UserUnit 2.5 page
    and scales every extracted coordinate by 2.5. Amendment 1's rationale for "not applied" - "it is
    what MuPDF's page.rect gives" - is therefore false. The RULE stands; a parser must divide the
    factor back out exactly once."""
    assert strip_user_unit([250, 175], 2.5) == [100, 70]
    with pytest.raises(GeometryError):
        strip_user_unit([1, 1], 0)


# --- the named acceptance test ------------------------------------------------------------------


class TestViewportRoundTrip:
    """PDF<->viewport round-trip, 8 zooms x 4 rotations, error <0.01pt."""

    def test_grid_matches_the_named_criterion(self) -> None:
        assert len(GRID["zooms"]) == 8
        assert GRID["rotations"] == list(ROTATIONS)
        assert GRID["max_abs_error_pt"] == 0.01

    @pytest.mark.parametrize("rotation", GRID["rotations"])
    @pytest.mark.parametrize("zoom", GRID["zooms"])
    def test_round_trip(self, rotation: Rotation, zoom: float) -> None:
        worst = 0.0
        for user_unit in GRID["user_units"]:
            for page in GRID["pages"]:
                viewport = Viewport(
                    zoom=zoom,
                    rotation=rotation,
                    page_width=page[0],
                    page_height=page[1],
                    user_unit=user_unit,
                )
                for point in GRID["points"]:
                    back = viewport_to_pdf(pdf_to_viewport(point, viewport), viewport)
                    worst = max(worst, abs(back[0] - point[0]), abs(back[1] - point[1]))
        assert _track(worst) < GRID["max_abs_error_pt"]

    def test_round_trip_through_every_real_page_frame(self) -> None:
        """The grid above uses bare page sizes. This runs the same sweep through the frames actually
        produced by ``normalise_page_frame`` - cropped, rotated, /UserUnit-bearing and combined - so
        the "CropBox != MediaBox" half of the criterion is exercised end to end."""
        worst = 0.0
        combinations = 0
        for record in PAGE_FRAMES:
            frame = frame_for(record["label"])
            for zoom in GRID["zooms"]:
                for rotation in GRID["rotations"]:
                    viewport = Viewport(
                        zoom=zoom,
                        rotation=rotation,
                        page_width=frame.width,
                        page_height=frame.height,
                        user_unit=frame.user_unit,
                    )
                    probes = [
                        [0.0, 0.0],
                        [frame.width, 0.0],
                        [0.0, frame.height],
                        [frame.width, frame.height],
                        [frame.width / 2, frame.height / 3],
                        [-frame.width, -frame.height],  # outside the CropBox, on purpose
                        [frame.width * 2, frame.height * 2],
                        [0.1, 0.7],
                        *(
                            v["expected"]
                            for v in NORMALISATION_VECTORS
                            if v["frame"] == record["label"]
                        ),
                    ]
                    for probe in probes:
                        back = viewport_to_pdf(pdf_to_viewport(probe, viewport), viewport)
                        worst = max(worst, abs(back[0] - probe[0]), abs(back[1] - probe[1]))
                        combinations += 1
        assert combinations > 1000
        assert _track(worst) < GRID["max_abs_error_pt"]

    def test_round_trip_of_the_whole_pipeline(self) -> None:
        """raw PDF -> normalise -> viewport -> back -> raw PDF: what a highlight traverses."""
        worst = 0.0
        for record in PAGE_FRAMES:
            frame = frame_for(record["label"])
            crop = frame.source_crop_box
            for zoom in GRID["zooms"]:
                for rotation in GRID["rotations"]:
                    viewport = Viewport(
                        zoom=zoom,
                        rotation=rotation,
                        page_width=frame.width,
                        page_height=frame.height,
                        user_unit=frame.user_unit,
                    )
                    raws = [
                        [crop[0], crop[1]],
                        [crop[2], crop[3]],
                        [(crop[0] + crop[2]) / 2, (crop[1] + crop[3]) / 2],
                        [crop[0] - 37.5, crop[3] + 12.25],
                    ]
                    for raw in raws:
                        back = denormalise_point(
                            frame,
                            viewport_to_pdf(
                                pdf_to_viewport(normalise_point(frame, raw), viewport), viewport
                            ),
                        )
                        worst = max(worst, abs(back[0] - raw[0]), abs(back[1] - raw[1]))
        assert _track(worst) < GRID["max_abs_error_pt"]


# --- the viewport transform ---------------------------------------------------------------------


@pytest.mark.parametrize("vector", VIEWPORT_VECTORS, ids=ids(VIEWPORT_VECTORS))
def test_viewport_vector(vector: dict[str, Any]) -> None:
    viewport = Viewport(
        zoom=vector["zoom"],
        rotation=vector["rotation"],
        page_width=vector["page"][0],
        page_height=vector["page"][1],
        user_unit=vector["user_unit"],
    )
    assert list(viewport_size(viewport)) == vector["surface"]
    assert pdf_to_viewport(vector["pdf_point"], viewport) == vector["viewport_point"]
    assert viewport_to_pdf(vector["viewport_point"], viewport) == vector["pdf_point"]


def test_bbox_to_viewport_re_extents() -> None:
    # page 100x200 at zoom 2 -> W=200, H=400, surface 400x200. (10,20)->(360,20); (30,50)->(300,60).
    viewport = Viewport(zoom=2, rotation=90, page_width=100, page_height=200)
    assert bbox_to_viewport([10, 20, 30, 50], viewport) == [300, 20, 360, 60]
    assert bbox_from_viewport([300, 20, 360, 60], viewport) == [10, 20, 30, 50]


@pytest.mark.parametrize(("zoom", "user_unit"), [(0, 1), (-1, 1), (1, 0), (1, float("nan"))])
def test_viewport_rejects_non_positive_scale(zoom: float, user_unit: float) -> None:
    viewport = Viewport(zoom=zoom, rotation=0, page_width=100, page_height=100, user_unit=user_unit)
    with pytest.raises(GeometryError):
        pdf_to_viewport([0, 0], viewport)


# --- polygon helpers ------------------------------------------------------------------------------


@pytest.mark.parametrize("vector", POLYGON_VECTORS, ids=ids(POLYGON_VECTORS))
def test_polygon_extent_area_orientation_simplicity(vector: dict[str, Any]) -> None:
    polygon = vector["polygon"]
    assert polygon_extent(polygon) == vector["extent"]
    assert polygon_area(polygon) == vector["area"]
    assert polygon_signed_area(polygon) == vector["signed_area"]
    assert polygon_is_simple(polygon) is vector["is_simple"]
    assert bbox_matches_polygon_extent(vector["extent"], polygon)


@pytest.mark.parametrize(
    ("vector", "probe"),
    [(v, p) for v in POLYGON_VECTORS for p in v["points"]],
    ids=[f"{v['label']}#{i}" for v in POLYGON_VECTORS for i, _ in enumerate(v["points"])],
)
def test_point_in_polygon(vector: dict[str, Any], probe: dict[str, Any]) -> None:
    assert point_in_polygon(probe["point"], vector["polygon"]) is probe["inside"]


def test_polygon_extent_is_the_canonical_block_bbox() -> None:
    """Semantic validator Geometry rule 1: ``bbox == polygon extent``.

    Two implementations of "extent" is exactly the drift DESIGN.md section 1 exists to prevent, so
    the rule is a predicate over this function rather than a second loop somewhere else.
    """
    polygon = POLYGON_VECTORS[0]["polygon"]
    assert bbox_matches_polygon_extent(polygon_extent(polygon), polygon)
    assert not bbox_matches_polygon_extent([0, 0, 1, 1], polygon)


def test_include_boundary_false_excludes_edge_points() -> None:
    square = [[0, 0], [10, 0], [10, 10], [0, 10]]
    assert point_in_polygon([0, 5], square, True) is True
    assert point_in_polygon([0, 5], square, False) is False
    assert point_in_polygon([5, 5], square, False) is True


@pytest.mark.parametrize("vector", INTERSECTION_VECTORS, ids=ids(INTERSECTION_VECTORS))
def test_polygons_intersect(vector: dict[str, Any]) -> None:
    assert polygons_intersect(vector["a"], vector["b"]) is vector["intersects"]
    assert polygons_intersect(vector["b"], vector["a"]) is vector["intersects"]


def test_bbox_helpers() -> None:
    assert bboxes_intersect([0, 0, 10, 10], [10, 10, 20, 20]) is True
    assert bboxes_intersect([0, 0, 10, 10], [10.0001, 0, 20, 10]) is False
    assert bbox_to_polygon([1, 2, 3, 4]) == [[1, 2], [3, 2], [3, 4], [1, 4]]
    assert bbox_to_polygon([3, 4, 1, 2]) == bbox_to_polygon([1, 2, 3, 4])


def test_bbox_flattening_bleeds_which_is_why_polygons_are_the_contract() -> None:
    staircase = next(v for v in POLYGON_VECTORS if v["label"] == "poly:staircase")["polygon"]
    notch = [250, 135]
    assert point_in_polygon(notch, staircase) is False
    assert point_in_polygon(notch, bbox_to_polygon(polygon_extent(staircase))) is True


# --- union of line rects --------------------------------------------------------------------------


def _union(vector: dict[str, Any]) -> list[list[list[float]]]:
    return union_of_line_rects(
        vector["rects"],
        vertical_gap_tolerance=vector["options"]["vertical_gap_tolerance"],
        horizontal_overlap_tolerance=vector["options"]["horizontal_overlap_tolerance"],
    )


@pytest.mark.parametrize("vector", LINE_UNION_VECTORS, ids=ids(LINE_UNION_VECTORS))
def test_union_of_line_rects(vector: dict[str, Any]) -> None:
    assert _union(vector) == vector["polygons"]


@pytest.mark.parametrize("vector", LINE_UNION_VECTORS, ids=ids(LINE_UNION_VECTORS))
def test_union_output_is_schema_legal(vector: dict[str, Any]) -> None:
    for polygon in _union(vector):
        assert 3 <= len(polygon) <= 512
        assert polygon_area(polygon) > 0
        assert polygon_is_simple(polygon)


def test_union_never_enters_the_gutter() -> None:
    """The regression this helper exists for.

    Column 1 ends at x=292, column 2 starts at x=320; a single bounding box would span 54..558 and
    paint the gutter.
    """
    vector = next(v for v in LINE_UNION_VECTORS if v["label"] == "union:two-column-selection")
    polygons = union_of_line_rects(vector["rects"])
    assert len(polygons) == 2
    for polygon in polygons:
        for vertex in polygon:
            assert not (292 < vertex[0] < 320)
    assert polygons_intersect(polygons[0], polygons[1]) is False
    for gutter_point in ([300, 105], [310, 120], [296, 135]):
        for polygon in polygons:
            assert point_in_polygon(gutter_point, polygon) is False


def test_union_does_not_collapse_to_a_bounding_box_when_line_boxes_overlap() -> None:
    """THE REGRESSION.

    MuPDF's line rects are font ascent/descent boxes, so consecutive lines routinely abut or
    overlap - this helper's own docstring says so, which made the overlapping case the NORMAL case
    rather than an edge case. Deciding band membership against the band's RUNNING extent
    (``r.y0 < band.y1``) cascades: each merge pushes y1 down, the next line overlaps THAT, and the
    paragraph collapses into a single 4-point rectangle. It shipped in three golden fixtures.
    Membership is decided against the band's ANCHOR interval instead.
    """
    overlapping = [[54, 100, 292, 112], [54, 111, 292, 123], [54, 122, 200, 134]]
    polygons = union_of_line_rects(overlapping)
    assert len(polygons) == 1
    polygon = polygons[0]
    # Not a rectangle: a rectangle here is the bug, and "4 vertices" is exactly how it looked.
    assert len(polygon) > 4
    assert polygon == [
        [292.0, 100.0],
        [292.0, 122.5],
        [200.0, 122.5],
        [200.0, 134.0],
        [54.0, 134.0],
        [54.0, 100.0],
    ]
    # The lie the bounding box told: 92 pt of blank page beside the short last line.
    for blank in ([250, 128], [290, 133], [210, 130]):
        assert point_in_polygon(blank, polygon) is False
        # ...and it IS inside the bounding box, so the two really do differ where it matters.
        assert point_in_polygon(blank, bbox_to_polygon(list(polygon_extent(polygon)))) is True
    # Every line the caller passed is still covered - the fix must not under-claim either.
    for rect in overlapping:
        centre = [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2]
        assert point_in_polygon(centre, polygon) is True
    assert polygon_is_simple(polygon) is True


def test_union_covers_every_rect_it_did_not_drop() -> None:
    vector = next(v for v in LINE_UNION_VECTORS if v["label"] == "union:two-column-selection")
    polygons = union_of_line_rects(vector["rects"])
    for rect in vector["rects"]:
        centre = [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2]
        assert any(point_in_polygon(centre, p) for p in polygons)


def test_union_defaults_are_the_documented_ones() -> None:
    assert DEFAULT_LINE_GAP_PT == 2
    assert len(union_of_line_rects([[54, 100, 292, 112], [54, 114, 292, 126]])) == 1
    assert len(union_of_line_rects([[54, 100, 292, 112], [54, 114.001, 292, 126]])) == 2


def test_union_bounds_vertices_by_merging_bands_not_by_bleeding() -> None:
    rects = [[54, 100 + i * 13, 54 + 100 + (i % 7) * 20, 112 + i * 13] for i in range(300)]
    polygons = union_of_line_rects(rects, vertical_gap_tolerance=2)
    assert len(polygons) == 1
    assert len(polygons[0]) <= 512
    assert polygon_extent(polygons[0])[0] == 54
    assert polygon_extent(polygons[0])[2] == 274


def test_union_rejects_a_max_vertices_that_cannot_hold_a_rectangle() -> None:
    with pytest.raises(GeometryError):
        union_of_line_rects([[0, 0, 1, 1]], max_vertices=3)


# --- synthetic PDF fixtures -----------------------------------------------------------------------

_NUM = r"(-?[\d.]+)"


def _page_dict(file: str) -> dict[str, Any]:
    """Read /MediaBox, /CropBox, /Rotate and /UserUnit out of the fixture's RAW BYTES.

    Deliberately a regex rather than a PDF library: this asserts that the values recorded in the
    vector file are the values *in the file*, which a library would hide behind its own coordinate
    conventions - the very thing under test. (PyMuPDF's ``page.cropbox``, for instance, is reported
    in MuPDF's flipped top-left system, not as the raw /CropBox array.)
    """
    text = (PKG / "test" / "fixtures-pdf" / file).read_bytes().decode("latin-1")

    def box(key: str) -> list[float] | None:
        m = re.search(rf"/{key}\s*\[\s*{_NUM}\s+{_NUM}\s+{_NUM}\s+{_NUM}\s*\]", text)
        return None if m is None else [float(g) for g in m.groups()]

    rotate = re.search(rf"/Rotate\s+{_NUM}", text)
    user_unit = re.search(rf"/UserUnit\s+{_NUM}", text)
    media = box("MediaBox")
    if media is None:
        raise AssertionError(f"{file} has no /MediaBox")
    return {
        "media_box": media,
        "crop_box": box("CropBox"),
        "rotate": 0.0 if rotate is None else float(rotate.group(1)),
        "user_unit": None if user_unit is None else float(user_unit.group(1)),
    }


def test_fixtures_cover_the_corpus_gap() -> None:
    """Amendment 1 section H.2: "Epic 0 should add one rotated, one cropped and one
    /UserUnit-bearing PDF to the corpus"."""
    files = {f["file"] for f in FIXTURE_VECTORS}
    assert {
        "rotate-0.pdf",
        "rotate-90.pdf",
        "rotate-180.pdf",
        "rotate-270.pdf",
        "cropbox-offset.pdf",
        "userunit.pdf",
        "negative-mediabox.pdf",
        "combined.pdf",
    } <= files


@pytest.mark.parametrize("record", FIXTURE_VECTORS, ids=ids(FIXTURE_VECTORS, "file"))
def test_recorded_page_attributes_are_the_ones_in_the_file(record: dict[str, Any]) -> None:
    dict_ = _page_dict(record["file"])
    assert dict_["media_box"] == record["raw"]["media_box"]
    assert dict_["crop_box"] == record["raw"]["crop_box"]
    assert dict_["rotate"] == record["raw"]["rotate"]
    assert dict_["user_unit"] == record["raw"]["user_unit"]


@pytest.mark.parametrize("record", FIXTURE_VECTORS, ids=ids(FIXTURE_VECTORS, "file"))
def test_normalising_the_markers_reproduces_mupdfs_answer(record: dict[str, Any]) -> None:
    dict_ = _page_dict(record["file"])
    frame = normalise_page_frame(
        RawPageBoxes(
            media_box=dict_["media_box"],
            crop_box=dict_["crop_box"],
            rotate=dict_["rotate"],
            user_unit=1.0 if dict_["user_unit"] is None else dict_["user_unit"],
        )
    )
    assert [frame.width, frame.height] == record["expected_page_size"]
    got = [normalise_rect(frame, r) for r in record["marker_rects_raw_pdf_space"]]
    assert got == record["expected_marker_bboxes"]


def test_mupdf_page_rect_is_user_unit_scaled_and_the_ir_frame_is_not() -> None:
    """MuPDF reports (0,0,500,750) for a 200x300 page with /UserUnit 2.5. The IR frame is 200x300.

    Taking page.rect at face value would scale every stored coordinate by 2.5 and, by the same
    mechanism Amendment 1's P9 measured at 99.93%, silently re-base every block id on such pages.
    """
    record = next(f for f in FIXTURE_VECTORS if f["file"] == "userunit.pdf")
    assert record["mupdf_page_rect_unadjusted"] == [0, 0, 500, 750]
    assert record["expected_page_size"] == [200, 300]


def test_user_unit_fixture_normalises_identically_to_the_plain_one() -> None:
    with_uu = next(f for f in FIXTURE_VECTORS if f["file"] == "userunit.pdf")
    without = next(f for f in FIXTURE_VECTORS if f["file"] == "rotate-0.pdf")
    assert with_uu["expected_marker_bboxes"] == without["expected_marker_bboxes"]


def test_zzz_report_worst_round_trip_error(capsys: pytest.CaptureFixture[str]) -> None:
    """Reported rather than merely asserted: "under the bound" is the pass condition, but the actual
    margin is what tells a future reader whether the bound is comfortable or lucky."""
    assert _worst_round_trip_error > 0, "the round-trip suite must have run before this test"
    with capsys.disabled():
        print(
            f"\ndocument-ir/geometry.spec (python) - worst observed round-trip error: "
            f"{_worst_round_trip_error:.3e} pt (criterion < 0.01 pt)"
        )
    assert _worst_round_trip_error < 0.01
