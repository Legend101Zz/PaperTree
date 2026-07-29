"""The Python twin of ``src/geometry.ts`` - the coordinate contract (F0.4).

ADR-001 Commitment 2: geometry is stored in PDF USER SPACE, POINTS, ORIGIN TOP-LEFT, normalised
exactly ONCE at parse time, alongside the page's width, height, rotation and user_unit. Never
viewport pixels, never fractions of a DOM element. Regions are POLYGONS, not rectangles, because a
selection spanning lines in a two-column layout is not a rectangle and flattening it to a bounding
box is what makes highlights bleed across columns (findings.md).

There are exactly three coordinate spaces in this codebase and this module is the only place in
Python where any of them is converted into another:

1. RAW PDF SPACE - what the file says. Origin BOTTOM-LEFT, y UP, relative to the MediaBox,
   /Rotate not applied, /UserUnit not applied.
2. IR SPACE - what PaperIR stores. Origin TOP-LEFT of the page's post-rotation crop rect, y DOWN,
   /Rotate applied, /UserUnit *deliberately NOT applied*, units = PDF default user space (1/72 in).
3. VIEWPORT SPACE - what a reader renders. IR space scaled by ``zoom * user_unit`` and rotated by
   the *viewer's* extra rotation. Ephemeral; never stored.

THE /UserUnit BOUNDARY, stated explicitly because it is the classic silent fork
---------------------------------------------------------------------------------
ADR-001 Amendment 1 section "COORDINATE FRAME" pins that /UserUnit is NOT applied to the frame the
block id is computed in. The acceptance test ``document-ir/geometry.spec`` separately requires the
viewport transform to HANDLE ``user_unit != 1``. Both are true and they are not in tension::

    IR space  = default user space units.      user_unit is RECORDED (Page.user_unit) only.
    VIEWPORT  = IR space * zoom * user_unit.   user_unit is APPLIED here, and ONLY here.

``normalise_page_frame`` / ``normalise_point`` therefore never multiply by user_unit;
``pdf_to_viewport`` / ``viewport_to_pdf`` always do. Amendment 1 section C.6 measured the cost of
getting an unstated frame convention wrong at 99.93% of block ids, so the boundary is a named
function, not a comment.

MEASURED CAVEAT, and the reason ``strip_user_unit`` exists. Amendment 1 justifies "not applied"
with "it is what MuPDF's page.rect gives". That justification is FALSE as of PyMuPDF 1.28 / MuPDF
1.29: on a page with /UserUnit 2.5 and /MediaBox [0 0 200 300], ``page.rect`` is (0, 0, 500, 750)
and every coordinate ``get_drawings()`` / ``get_text()`` returns is likewise pre-multiplied by 2.5.
(``page.rotation_matrix`` is NOT, which is a second trap.) The *rule* still stands - it is pinned by
fiat and all implementations must agree - but a PyMuPDF-based parser must divide user_unit back out
exactly once before storing. See ``strip_user_unit``.

The TypeScript twin is ``src/geometry.ts``; both are checked against
``conformance/geometry-vectors.json``, which is generated from synthetic PDFs by
``test/fixtures-pdf/generate.py``. Neither language is the other's oracle.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from papertree_document_ir.generated.models import BBox, Point, Polygon

__all__ = [
    "BBOX_EXTENT_EPSILON_PT",
    "DEFAULT_LINE_GAP_PT",
    "DEFAULT_LINE_OVERLAP_PT",
    "ROTATIONS",
    "GeometryError",
    "PageFrame",
    "RawPageBoxes",
    "Rotation",
    "Viewport",
    "bbox_from_viewport",
    "bbox_matches_polygon_extent",
    "bbox_to_polygon",
    "bbox_to_viewport",
    "bboxes_intersect",
    "denormalise_point",
    "normalise_page_frame",
    "normalise_point",
    "normalise_polygon",
    "normalise_rect",
    "normalise_rotation",
    "pdf_to_viewport",
    "point_in_polygon",
    "polygon_area",
    "polygon_extent",
    "polygon_is_simple",
    "polygon_signed_area",
    "polygons_intersect",
    "rotation_swaps_axes",
    "strip_user_unit",
    "union_of_line_rects",
    "viewport_scale",
    "viewport_size",
    "viewport_to_pdf",
]

PointLike = Sequence[float]
BBoxLike = Sequence[float]
PolygonLike = Sequence[Sequence[float]]


class GeometryError(ValueError):
    """Raised for input that cannot be read as geometry. Never for merely unusual geometry."""


# --- rotation ---------------------------------------------------------------------------------

Rotation = Literal[0, 90, 180, 270]
"""A page or viewer rotation, in degrees CLOCKWISE, as PDF /Rotate defines it."""

ROTATIONS: tuple[Rotation, ...] = (0, 90, 180, 270)
"""The four rotations, in the order the conformance vectors and the spec table use."""


def normalise_rotation(rotate: float) -> Rotation:
    """Reduce a raw /Rotate to the canonical 0/90/180/270.

    PDF 1.7 section 7.7.3.3 permits any multiple of 90, including negatives and values >= 360;
    anything else is a malformed page.
    """
    if not math.isfinite(rotate) or rotate % 90 != 0:
        raise GeometryError(f"/Rotate must be a multiple of 90, got {rotate!r}")
    r = int(rotate) % 360
    if r == 0:
        return 0
    if r == 90:
        return 90
    if r == 180:
        return 180
    return 270


def rotation_swaps_axes(rotation: Rotation) -> bool:
    """True iff the rotation exchanges the width and height axes."""
    return rotation in (90, 270)


# --- 1. normalisation: raw PDF space -> IR space (parse time, used once) -----------------------


@dataclass(frozen=True)
class RawPageBoxes:
    """The raw page attributes, exactly as they appear in the PDF page dictionary."""

    media_box: BBoxLike
    """/MediaBox as written: [x0, y0, x1, y1], bottom-left origin, corners in either order."""
    crop_box: BBoxLike | None = None
    """/CropBox as written. ``None`` -> defaults to the MediaBox (PDF 1.7 section 14.11.2)."""
    rotate: float = 0
    """/Rotate as written. Any multiple of 90, may be negative or >= 360."""
    user_unit: float = 1.0
    """/UserUnit as written. RECORDED, never applied to IR coordinates."""


@dataclass
class PageFrame:
    """A page's coordinate frame, normalised once.

    Everything a consumer needs to place a polygon, plus the one raw fact (``source_crop_box``) that
    lets the normalisation be re-derived or audited.

    Maps onto PaperIR ``Page`` as width, height, rotation, user_unit, crop_box, media_box. Note
    DESIGN.md D23 / validator rule G4 - ``crop_box`` is ALWAYS ``[0, 0, width, height]``, because
    block geometry is crop-box-relative; ``media_box`` is frequently negative, which is correct.
    """

    width: float
    """Post-rotation width of the crop rect, in default user space points."""
    height: float
    """Post-rotation height of the crop rect, in default user space points."""
    rotation: Rotation
    """The /Rotate that has ALREADY been applied. Recorded for auditability; never apply twice."""
    user_unit: float
    """The /UserUnit. RECORDED ONLY - not applied to any coordinate in this frame."""
    crop_box: BBox
    """Always ``[0, 0, width, height]`` (D23 / G4)."""
    source_crop_box: BBox
    """The EFFECTIVE crop box in RAW PDF space - corner-ordered and intersected with the media box
    per PDF 1.7 section 14.11.2. Retained because it is the entire input to ``normalise_point``, so
    the normalisation is reproducible from the frame alone rather than from the original file."""
    media_box: BBox = field(default_factory=lambda: [0.0, 0.0, 0.0, 0.0])
    """The MediaBox in IR space. Often has negative x0/y0; that is correct, not an error."""


def _require_finite(values: Sequence[float], what: str) -> None:
    for v in values:
        if not math.isfinite(v):
            raise GeometryError(f"{what} must be finite, got {v!r}")


def _order_box(box: BBoxLike, what: str) -> BBox:
    """Corner-order a raw PDF box: PDF permits ``[x1 y1 x0 y0]`` and viewers must cope."""
    if len(box) != 4:
        raise GeometryError(f"{what} must have 4 numbers, got {len(box)}")
    _require_finite(box, what)
    a, b, c, d = (float(box[0]), float(box[1]), float(box[2]), float(box[3]))
    return [min(a, c), min(b, d), max(a, c), max(b, d)]


def normalise_page_frame(raw: RawPageBoxes) -> PageFrame:
    """Raw PDF page attributes -> the canonical IR frame. Call ONCE per page, at parse time.

    Handles, in this order: corner-ordering, CropBox defaulting, CropBox intersect MediaBox, the
    bottom-left -> top-left origin flip, a CropBox origin that is not (0, 0), and /Rotate. It does
    NOT apply /UserUnit - see the module docstring.
    """
    media = _order_box(raw.media_box, "/MediaBox")
    crop_requested = media if raw.crop_box is None else _order_box(raw.crop_box, "/CropBox")

    # PDF 1.7 section 14.11.2: the crop box is clipped to the media box; the visible page is the
    # intersection. A CropBox that escapes the MediaBox is common and is not an error.
    crop: BBox = [
        max(crop_requested[0], media[0]),
        max(crop_requested[1], media[1]),
        min(crop_requested[2], media[2]),
        min(crop_requested[3], media[3]),
    ]
    cw = crop[2] - crop[0]
    ch = crop[3] - crop[1]
    if not cw > 0 or not ch > 0:
        raise GeometryError(f"/CropBox intersect /MediaBox is empty (crop={crop}, media={media})")

    rotation = normalise_rotation(raw.rotate)
    user_unit = float(raw.user_unit)
    if not math.isfinite(user_unit) or user_unit <= 0:
        raise GeometryError(f"/UserUnit must be finite and > 0, got {user_unit!r}")

    swap = rotation_swaps_axes(rotation)
    width = ch if swap else cw
    height = cw if swap else ch

    frame = PageFrame(
        width=width,
        height=height,
        rotation=rotation,
        user_unit=user_unit,
        crop_box=[0.0, 0.0, width, height],
        source_crop_box=crop,
    )
    frame.media_box = normalise_rect(frame, media)
    return frame


def normalise_point(frame: PageFrame, raw_point: PointLike) -> Point:
    """One raw PDF point -> IR space. The whole normalisation, in four lines::

        u = raw_x - crop.x0    offset from the crop box's OWN origin - a CropBox that does not
        v = crop.y1 - raw_y    start at (0, 0) cannot leak into the result (Amendment 1 frame)

    then rotate ``(u, v)`` clockwise by /Rotate inside the ``cw x ch`` rect:

    ======  ==========================  ===================
    Rotate  (x, y)                      page size
    ======  ==========================  ===================
    0       ``(u, v)``                  ``cw x ch``
    90      ``(ch - v, u)``             ``ch x cw``
    180     ``(cw - u, ch - v)``        ``cw x ch``
    270     ``(v, cw - u)``             ``ch x cw``
    ======  ==========================  ===================

    Derived, then verified against MuPDF's own ``rotation_matrix`` on synthetic PDFs (see
    ``test/fixtures-pdf/generate.py``).
    """
    _require_finite(raw_point, "point")
    crop = frame.source_crop_box
    cw = crop[2] - crop[0]
    ch = crop[3] - crop[1]
    u = raw_point[0] - crop[0]
    v = crop[3] - raw_point[1]
    if frame.rotation == 0:
        return [u, v]
    if frame.rotation == 90:
        return [ch - v, u]
    if frame.rotation == 180:
        return [cw - u, ch - v]
    return [v, cw - u]


def denormalise_point(frame: PageFrame, point: PointLike) -> Point:
    """The exact inverse of :func:`normalise_point`: IR space -> raw PDF space."""
    _require_finite(point, "point")
    crop = frame.source_crop_box
    cw = crop[2] - crop[0]
    ch = crop[3] - crop[1]
    if frame.rotation == 0:
        u, v = point[0], point[1]
    elif frame.rotation == 90:
        u, v = point[1], ch - point[0]
    elif frame.rotation == 180:
        u, v = cw - point[0], ch - point[1]
    else:
        u, v = cw - point[1], point[0]
    return [u + crop[0], crop[3] - v]


def normalise_rect(frame: PageFrame, raw_rect: BBoxLike) -> BBox:
    """A raw PDF rect -> an IR-space bbox.

    Not a per-corner map: 90/270 exchange which corner is top-left, so the result is the EXTENT of
    the two mapped corners.
    """
    ordered = _order_box(raw_rect, "rect")
    a = normalise_point(frame, [ordered[0], ordered[1]])
    b = normalise_point(frame, [ordered[2], ordered[3]])
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])]


def normalise_polygon(frame: PageFrame, raw_polygon: PolygonLike) -> Polygon:
    """A raw PDF polygon -> an IR-space polygon. Vertex order is preserved."""
    return [normalise_point(frame, p) for p in raw_polygon]


def strip_user_unit(point: PointLike, user_unit: float) -> Point:
    """Divide /UserUnit back out of a coordinate that a renderer already scaled by it.

    PyMuPDF 1.28 / MuPDF 1.29 pre-multiply ``page.rect`` and every extracted coordinate by
    /UserUnit, but NOT ``page.rotation_matrix``. IR space is default user space (Amendment 1), so a
    parser must apply this exactly once - before :func:`normalise_point`, while still in raw PDF
    space - and must not apply it to the box arrays it read out of the page dictionary, which are
    never scaled.
    """
    if not math.isfinite(user_unit) or user_unit <= 0:
        raise GeometryError(f"user_unit must be finite and > 0, got {user_unit!r}")
    return [point[0] / user_unit, point[1] / user_unit]


# --- 2. the viewport transform, both directions -----------------------------------------------


@dataclass(frozen=True)
class Viewport:
    """Everything the reader's transform is parameterised by.

    Deliberately five fields: Epic 2 anchors against this signature, so it is a contract.

    ``rotation`` is the viewer's EXTRA rotation, applied on top of the page's own /Rotate, which is
    already baked into ``page_width``/``page_height`` and into every stored polygon. A reader
    showing the page as authored passes 0. It is not a second chance to apply /Rotate.
    """

    zoom: float
    """Render scale, 1 = 72 dpi."""
    rotation: Rotation
    """The viewer's extra rotation, clockwise, on top of the page's baked-in /Rotate."""
    page_width: float
    """``PageFrame.width`` - IR space, post-/Rotate."""
    page_height: float
    """``PageFrame.height`` - IR space, post-/Rotate."""
    user_unit: float = 1.0
    """The page's /UserUnit. Applied HERE and only here (module docstring)."""


def viewport_scale(viewport: Viewport) -> float:
    """``zoom * user_unit``. The single scalar separating IR points from viewport units."""
    if not math.isfinite(viewport.zoom) or viewport.zoom <= 0:
        raise GeometryError(f"zoom must be finite and > 0, got {viewport.zoom!r}")
    if not math.isfinite(viewport.user_unit) or viewport.user_unit <= 0:
        raise GeometryError(f"user_unit must be finite and > 0, got {viewport.user_unit!r}")
    return viewport.zoom * viewport.user_unit


def viewport_size(viewport: Viewport) -> tuple[float, float]:
    """``(width, height)`` of the rendered surface. Axes exchange at 90 and 270."""
    s = viewport_scale(viewport)
    _require_finite([viewport.page_width, viewport.page_height], "page size")
    w = viewport.page_width * s
    h = viewport.page_height * s
    return (h, w) if rotation_swaps_axes(viewport.rotation) else (w, h)


def pdf_to_viewport(point: PointLike, viewport: Viewport) -> Point:
    """IR space -> viewport units."""
    _require_finite(point, "point")
    s = viewport_scale(viewport)
    w = viewport.page_width * s
    h = viewport.page_height * s
    x = point[0] * s
    y = point[1] * s
    if viewport.rotation == 0:
        return [x, y]
    if viewport.rotation == 90:
        return [h - y, x]
    if viewport.rotation == 180:
        return [w - x, h - y]
    return [y, w - x]


def viewport_to_pdf(point: PointLike, viewport: Viewport) -> Point:
    """Viewport units -> IR space. The exact inverse of :func:`pdf_to_viewport`."""
    _require_finite(point, "point")
    s = viewport_scale(viewport)
    w = viewport.page_width * s
    h = viewport.page_height * s
    if viewport.rotation == 0:
        return [point[0] / s, point[1] / s]
    if viewport.rotation == 90:
        return [point[1] / s, (h - point[0]) / s]
    if viewport.rotation == 180:
        return [(w - point[0]) / s, (h - point[1]) / s]
    return [(w - point[1]) / s, point[0] / s]


def bbox_to_viewport(bbox: BBoxLike, viewport: Viewport) -> BBox:
    """IR bbox -> viewport bbox. Re-extents, because rotation exchanges the corners."""
    a = pdf_to_viewport([bbox[0], bbox[1]], viewport)
    b = pdf_to_viewport([bbox[2], bbox[3]], viewport)
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])]


def bbox_from_viewport(bbox: BBoxLike, viewport: Viewport) -> BBox:
    """Viewport bbox -> IR bbox. Re-extents, for the same reason."""
    a = viewport_to_pdf([bbox[0], bbox[1]], viewport)
    b = viewport_to_pdf([bbox[2], bbox[3]], viewport)
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])]


# --- 3. polygon helpers -------------------------------------------------------------------------

BBOX_EXTENT_EPSILON_PT = 1e-9
"""Tolerance for "bbox equals polygon extent" (DESIGN.md semantic validator, Geometry rule 1).

The schema says the identity is exact; this epsilon exists only so a producer that round-trips
through a decimal formatter is not failed for the last ulp.
"""


def polygon_extent(polygon: PolygonLike) -> BBox:
    """The extent of a polygon: ``[min x, min y, max x, max y]``.

    This is the CANONICAL implementation of ``Block.bbox``. The schema requires ``bbox`` to equal
    the polygon's extent and the semantic validator checks it, so a producer and the validator must
    compute it here rather than each rolling their own - that is the whole reason this is a public
    function rather than an inlined loop.
    """
    if len(polygon) == 0:
        raise GeometryError("polygon has no vertices")
    first = polygon[0]
    _require_finite(first, "vertex")
    x0 = x1 = float(first[0])
    y0 = y1 = float(first[1])
    for p in polygon[1:]:
        _require_finite(p, "vertex")
        if p[0] < x0:
            x0 = p[0]
        if p[1] < y0:
            y0 = p[1]
        if p[0] > x1:
            x1 = p[0]
        if p[1] > y1:
            y1 = p[1]
    return [x0, y0, x1, y1]


def bbox_matches_polygon_extent(
    bbox: BBoxLike, polygon: PolygonLike, epsilon: float = BBOX_EXTENT_EPSILON_PT
) -> bool:
    """Validator rule 1, as a predicate, so the rule and the producer cannot drift."""
    extent = polygon_extent(polygon)
    return all(abs(bbox[i] - extent[i]) <= epsilon for i in range(4))


def polygon_signed_area(polygon: PolygonLike) -> float:
    """Half the shoelace sum.

    Positive = counter-clockwise in a y-UP frame, which in IR space (y DOWN) reads as clockwise on
    screen. Exposed because orientation is occasionally what a caller actually wants, and because
    :func:`polygon_area` must not hide the sign convention.
    """
    n = len(polygon)
    if n < 3:
        return 0.0
    total = 0.0
    for i in range(n):
        a = polygon[i]
        b = polygon[(i + 1) % n]
        _require_finite(a, "vertex")
        total += a[0] * b[1] - b[0] * a[1]
    return total / 2


def polygon_area(polygon: PolygonLike) -> float:
    """Absolute area, in pt^2. Zero for a degenerate ring - rule G6 requires strictly > 0."""
    return abs(polygon_signed_area(polygon))


def _on_segment(p: PointLike, a: PointLike, b: PointLike) -> bool:
    cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if cross != 0:
        return False
    return min(a[0], b[0]) <= p[0] <= max(a[0], b[0]) and min(a[1], b[1]) <= p[1] <= max(a[1], b[1])


def point_in_polygon(point: PointLike, polygon: PolygonLike, include_boundary: bool = True) -> bool:
    """Even-odd (crossing number) point-in-polygon.

    Boundary is tested EXPLICITLY and first, because the classic ray-cast leaves boundary points
    undefined - and "undefined" between two languages means "forks". ``include_boundary`` decides
    it; the default is inclusive, which is what a highlight hit-test wants.
    """
    _require_finite(point, "point")
    n = len(polygon)
    if n < 3:
        return False
    for i in range(n):
        if _on_segment(point, polygon[i], polygon[(i + 1) % n]):
            return include_boundary
    inside = False
    j = n - 1
    for i in range(n):
        a = polygon[i]
        b = polygon[j]
        if (a[1] > point[1]) != (b[1] > point[1]):
            t = (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]
            if point[0] < t:
                inside = not inside
        j = i
    return inside


def _segments_intersect(p1: PointLike, p2: PointLike, p3: PointLike, p4: PointLike) -> bool:
    d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0])
    if d != 0:
        t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d
        u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d
        return 0 <= t <= 1 and 0 <= u <= 1
    return (
        _on_segment(p3, p1, p2)
        or _on_segment(p4, p1, p2)
        or _on_segment(p1, p3, p4)
        or _on_segment(p2, p3, p4)
    )


def polygons_intersect(a: PolygonLike, b: PolygonLike) -> bool:
    """Do two polygons share any point? Boundary contact counts as intersecting.

    Edge-crossing alone is not sufficient - one polygon wholly inside the other has no crossing - so
    containment is checked in both directions. O(n*m); polygons here are bounded at 512 vertices.
    """
    if len(a) < 3 or len(b) < 3:
        return False
    if not bboxes_intersect(polygon_extent(a), polygon_extent(b)):
        return False
    for i in range(len(a)):
        a1 = a[i]
        a2 = a[(i + 1) % len(a)]
        for j in range(len(b)):
            if _segments_intersect(a1, a2, b[j], b[(j + 1) % len(b)]):
                return True
    return point_in_polygon(a[0], b) or point_in_polygon(b[0], a)


def _points_equal(a: PointLike, b: PointLike) -> bool:
    return a[0] == b[0] and a[1] == b[1]


def polygon_is_simple(polygon: PolygonLike) -> bool:
    """Is the ring simple (non-self-intersecting)?

    Validator rule G6 reports a bowtie as a WARN - a parser bug, not a data-integrity failure - so
    this is a predicate, not a raise.
    """
    n = len(polygon)
    if n < 3:
        return False
    for i in range(n):
        for j in range(i + 1, n):
            a1 = polygon[i]
            a2 = polygon[(i + 1) % n]
            b1 = polygon[j]
            b2 = polygon[(j + 1) % n]
            # Adjacent edges legitimately meet at the vertex they share; may touch NOWHERE else.
            shared: PointLike | None = None
            if j == i + 1:
                shared = a2
            elif i == 0 and j == n - 1:
                shared = a1
            if shared is not None:
                for p in (a1, a2):
                    if not _points_equal(p, shared) and _on_segment(p, b1, b2):
                        return False
                for p in (b1, b2):
                    if not _points_equal(p, shared) and _on_segment(p, a1, a2):
                        return False
                continue
            if _segments_intersect(a1, a2, b1, b2):
                return False
    return True


def bbox_to_polygon(bbox: BBoxLike) -> Polygon:
    """``[x0, y0, x1, y1]`` -> a 4-vertex ring, clockwise on screen, starting at the top-left."""
    b = _order_box(bbox, "bbox")
    return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]


def bboxes_intersect(a: BBoxLike, b: BBoxLike) -> bool:
    """Inclusive overlap test: two boxes that merely touch along an edge DO intersect."""
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


# --- union of line rects -> polygon(s) ----------------------------------------------------------

DEFAULT_LINE_GAP_PT = 2.0
"""Default vertical slack, in points, for treating two line rects as the same run of text.

Font-metric line boxes (what MuPDF returns) abut or overlap; glyph-derived boxes leave a gap of
roughly the descender depth. 2 pt spans that without reaching the ~10 pt gap between a paragraph and
the next one on a 10 pt body.
"""

DEFAULT_LINE_OVERLAP_PT = 0.0
"""Default horizontal slack. Zero: two rects must genuinely overlap in x to be the same column.

The gutter of a two-column paper is 15-25 pt, so this is the knob that stops highlights bleeding.
"""


@dataclass
class _Band:
    x0: float
    y0: float
    x1: float
    y1: float


def _simplify_ring(ring: list[Point]) -> Polygon:
    deduped: list[Point] = []
    for p in ring:
        if not deduped or not _points_equal(deduped[-1], p):
            deduped.append(p)
    while len(deduped) > 1 and _points_equal(deduped[0], deduped[-1]):
        deduped.pop()
    # Drop collinear vertices: adjacent bands with the same left or right edge would otherwise emit
    # a redundant point at every band boundary, tripling the vertex count for no shape change.
    out: list[Point] = []
    n = len(deduped)
    for i in range(n):
        prev = deduped[(i - 1) % n]
        cur = deduped[i]
        nxt = deduped[(i + 1) % n]
        cross = (cur[0] - prev[0]) * (nxt[1] - prev[1]) - (cur[1] - prev[1]) * (nxt[0] - prev[0])
        if cross != 0:
            out.append(cur)
    return out if len(out) >= 3 else deduped


def _bands_to_ring(bands: list[_Band]) -> Polygon:
    n = len(bands)
    # Horizontal boundary between band i-1 and band i: the midpoint of the gap, so the ring is a
    # closed staircase with no slivers between lines.
    edges: list[float] = [bands[0].y0]
    for i in range(1, n):
        edges.append((bands[i - 1].y1 + bands[i].y0) / 2)
    edges.append(bands[n - 1].y1)

    ring: list[Point] = []
    for i in range(n):
        ring.append([bands[i].x1, edges[i]])
        ring.append([bands[i].x1, edges[i + 1]])
    for i in range(n - 1, -1, -1):
        ring.append([bands[i].x0, edges[i + 1]])
        ring.append([bands[i].x0, edges[i]])
    return _simplify_ring(ring)


def union_of_line_rects(
    rects: Sequence[BBoxLike],
    vertical_gap_tolerance: float = DEFAULT_LINE_GAP_PT,
    horizontal_overlap_tolerance: float = DEFAULT_LINE_OVERLAP_PT,
    max_vertices: int = 512,
) -> list[Polygon]:
    """Turn a multi-line text selection into region polygons.

    THIS IS THE FUNCTION COMMITMENT 2 EXISTS FOR. Given one rect per selected line, it returns the
    staircase outline of each CONNECTED RUN of lines - not the bounding box of the lot. A selection
    that crosses the gutter of a two-column paper therefore comes back as TWO polygons, one per
    column, and nothing is painted over the gutter. Flattening to a single bbox is precisely the
    highlight-bleed bug in findings.md.

    Two rects join a run iff they overlap in x by more than ``horizontal_overlap_tolerance`` AND
    their y-intervals overlap or are separated by at most ``vertical_gap_tolerance``. Connectivity
    is transitive, so a short last line still joins the paragraph above it.

    Rects with non-positive width or height are dropped (a zero-width selection is not a region).
    Returned polygons are ordered by (top, left) so the output is stable across languages.
    """
    if max_vertices < 4:
        raise GeometryError("max_vertices must be at least 4")

    boxes: list[_Band] = []
    for raw in rects:
        o = _order_box(raw, "line rect")
        if o[2] - o[0] > 0 and o[3] - o[1] > 0:
            boxes.append(_Band(o[0], o[1], o[2], o[3]))
    if not boxes:
        return []
    boxes.sort(key=lambda b: (b.y0, b.x0, b.y1, b.x1))

    # Union-find over the "same run of text" relation.
    parent = list(range(len(boxes)))

    def find(i: int) -> int:
        root = i
        while parent[root] != root:
            root = parent[root]
        cur = i
        while parent[cur] != cur:
            parent[cur], cur = root, parent[cur]
        return root

    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i], boxes[j]
            x_overlap = min(a.x1, b.x1) - max(a.x0, b.x0)
            y_gap = max(a.y0, b.y0) - min(a.y1, b.y1)
            if x_overlap > horizontal_overlap_tolerance and y_gap <= vertical_gap_tolerance:
                ra, rb = find(i), find(j)
                if ra != rb:
                    parent[rb] = ra

    groups: dict[int, list[_Band]] = {}
    for i, box in enumerate(boxes):
        groups.setdefault(find(i), []).append(box)

    polygons: list[Polygon] = []
    for members in groups.values():
        # Collapse rects that share a vertical band into one. They are already in the same run, so
        # taking their x-extent cannot reach another column.
        bands: list[_Band] = []
        for r in members:
            if bands and r.y0 < bands[-1].y1:
                cur = bands[-1]
                cur.x0 = min(cur.x0, r.x0)
                cur.x1 = max(cur.x1, r.x1)
                cur.y1 = max(cur.y1, r.y1)
            else:
                bands.append(_Band(r.x0, r.y0, r.x1, r.y1))
        # Bound the vertex count: merge the adjacent band pair whose union wastes the least area,
        # repeatedly. Over-approximates WITHIN a run, never across runs.
        while len(bands) * 2 + 2 > max_vertices and len(bands) > 1:
            best = 0
            best_cost = math.inf
            for i in range(len(bands) - 1):
                a, b = bands[i], bands[i + 1]
                merged = max(a.x1, b.x1) - min(a.x0, b.x0)
                cost = merged * 2 - (a.x1 - a.x0) - (b.x1 - b.x0)
                if cost < best_cost:
                    best_cost = cost
                    best = i
            a, b = bands[best], bands[best + 1]
            bands[best : best + 2] = [_Band(min(a.x0, b.x0), a.y0, max(a.x1, b.x1), b.y1)]
        polygons.append(_bands_to_ring(bands))

    polygons.sort(key=lambda p: (polygon_extent(p)[1], polygon_extent(p)[0]))
    return polygons
