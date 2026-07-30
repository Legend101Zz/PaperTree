"""build_fixture - SCAFFOLDING for F0.7's hand-checked golden fixtures.

+---------------------------------------------------------------------------------------------+
|  THIS IS NOT THE PARSER, AND IT IS NOT A STARTING POINT FOR ONE.                             |
|                                                                                              |
|  Epic 1 owns the parser. This file exists for one job: to get real papers into PaperIR       |
|  accurately enough, and cheaply enough, that F0.7's fixtures can be HAND-CHECKED against the  |
|  rendered pages. It is therefore allowed to be crude, and it is allowed to carry per-paper   |
|  corrections - see ``PAPERS`` at the bottom, which is DATA, not branches. It classifies      |
|  nothing: every block type, every flow, every section boundary and every figure/caption link |
|  in the output was decided by a human looking at the page and written into the plan. PyMuPDF |
|  is used ONLY to recover geometry and glyphs that a human cannot transcribe by hand without  |
|  introducing errors.                                                                         |
|                                                                                              |
|  If you are in Epic 1 looking for somewhere to start: this is not it. Copying this file gives|
|  you a pipeline whose "layout analysis" is a hard-coded list of MuPDF block indices.         |
+---------------------------------------------------------------------------------------------+

WHAT IT DOES GUARANTEE, because the fixture is the deliverable and the tool is not:

* Geometry goes through ``papertree_document_ir.geometry`` - ``normalise_page_frame`` for the page
  frame and ``normalise_rect`` for every coordinate - so the output is PDF user space with a
  TOP-LEFT origin, never MuPDF device space and never viewport pixels. MuPDF's page space happens
  to coincide with IR space for an unrotated page whose CropBox starts at (0, 0); the tool does not
  rely on that. It maps back to raw PDF space through ``~page.transformation_matrix`` and lets the
  library normalise, and ``_assert_frame_round_trips`` fails the build if the two ever disagree.
* A multi-line text region gets a STAIRCASE polygon from ``union_of_line_rects``, not a bounding
  box, and the build FAILS if that function returns more than one region for a block - which is
  what stops a block from silently spanning a column gutter.
* ``block_id`` comes from ``identity.block_id`` and ``content_hash`` from ``identity.content_hash``.
  Nothing here invents an id: DESIGN.md section 8's mnemonic ids fail Tier A rule I1, and passing
  I1 is most of what makes a fixture golden.
* The document is verified before it is written - Pydantic for the schema, ``validate_paper`` for
  the semantic layer, plus id recomputation and bbox/polygon/reference checks. One Tier A error and
  nothing reaches disk.

Usage::

    cd "/Volumes/Mrigesh SSD/PaperTree"
    uv run --python 3.12 --with pymupdf python packages/document-ir/tools/build_fixture.py
    uv run --python 3.12 --with pymupdf python packages/document-ir/tools/build_fixture.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from papertree_document_ir import (
    BBox,
    BlockIdInput,
    Paper,
    Polygon,
    RawPageBoxes,
    block_id,
    content_hash,
    format_diagnostics,
    normalise_page_frame,
    normalise_rect,
    normalise_text,
    polygon_extent,
    union_of_line_rects,
    validate_paper,
)
from papertree_document_ir.geometry import PageFrame, bbox_to_polygon, denormalise_point

REPO = Path(__file__).resolve().parents[3]
PKG = Path(__file__).resolve().parents[1]
CORPUS = REPO / "research" / "benchmarks" / "corpus"
FIXTURES = PKG / "fixtures"
ASSETS = FIXTURES / "assets"

#: Coordinates are rounded to this many decimals BEFORE anything is derived from them, so the
#: number in the JSON is the number the block id was hashed from and the number rule 1 compares.
#:
#: Two decimals - 0.01 pt, about 3.5 um - and not more, deliberately. A justified paragraph's line
#: rects agree on the right margin only to about 0.005 pt, and at 3 decimals that jitter survives
#: into the staircase as a run of micro-steps and zero-length edges, which rule G6 correctly reports
#: as a self-intersecting ring. Rounding the LINE RECTS before union_of_line_rects lets its own
#: collinear-vertex removal do its job, and the flush margin comes out as one straight edge.
COORD_DECIMALS = 2

#: ``ImageRef.uri`` requires an explicit non-inline scheme, so a bare relative path is rejected.
#: ``fixture://<slug>/<path>`` resolves to ``packages/document-ir/fixtures/assets/<slug>/<path>``.
URI_SCHEME = "fixture"

_BASE32_LOWER = "abcdefghijklmnopqrstuvwxyz234567"
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

Rect4 = tuple[float, float, float, float]


class BuildError(RuntimeError):
    """Something the plan asserts is not true of the PDF. Always fatal: a fixture that is only
    approximately right is worse than none, because Epic 2 cannot tell the difference."""


# ==============================================================================================
# THE PER-PAPER PLAN. Everything paper-specific is data; the engine has no per-paper branch.
# ==============================================================================================

#: One text unit: a whole MuPDF text block, or one line of it as ``(block, line)``.
TextRef = int | tuple[int, int]


@dataclass(frozen=True)
class Ref:
    """A forward reference to another planned block, resolved to its ``block_id``."""

    key: str


@dataclass(frozen=True)
class RefPolygon:
    """A forward reference to another planned block, resolved to its POLYGON.

    Exists for ``TablePayload.grid.cells[].polygon``, which must be the same region as the
    ``table_cell`` block the cell points at. Restating those coordinates in the plan would be one
    fact in two places kept in sync by hand - the failure the whole schema is careful to avoid -
    so the plan names the cell and the engine copies the geometry it already computed.
    """

    key: str


@dataclass(frozen=True)
class PageRect:
    """A rectangle in MuPDF page space, resolved to an IR-space polygon."""

    x0: float
    y0: float
    x1: float
    y1: float


@dataclass(frozen=True)
class InlinePlan:
    """A nested ``inline_equation``, located inside its parent by a role-tagged span.

    Identified by MuPDF span indices, never by character offsets: the offsets are DERIVED, so they
    cannot drift out of step with the text the engine assembles.
    """

    key: str
    parent: str
    #: Index of the line WITHIN THE PARENT'S ASSEMBLED TEXT, i.e. ``text.split("\\n")[line]``.
    line: int
    #: ``[first, last)`` MuPDF span indices within that line.
    spans: tuple[int, int]
    latex: str
    confidence: float
    latex_confidence: float


@dataclass(frozen=True)
class BlockPlan:
    """One PaperIR block, and where its geometry and glyphs come from."""

    key: str
    page: int
    type: str
    flow: str
    confidence: float
    #: MuPDF text blocks/lines IN READING ORDER. Empty for a pure-geometry block.
    text: tuple[TextRef, ...] = ()
    #: MuPDF drawing indices; a hairline (degenerate) rect is inflated by its stroke width.
    drawings: tuple[int, ...] = ()
    #: Extra regions in MuPDF page space, e.g. an embedded image's placement rectangle.
    rects: tuple[Rect4, ...] = ()
    #: ``lines`` -> staircase polygon from union_of_line_rects. ``rect`` -> the region's extent.
    geometry: Literal["lines", "rect"] = "lines"
    #: A HEADING parent means section containment (child stays top-level); anything else NESTS.
    parent: str | None = None
    source: str = "pdf_text_layer"
    stage: str = "layout+text"
    #: Vertical slack for union_of_line_rects when the default 2 pt splits one region in two.
    line_gap_pt: float | None = None
    #: Merge MuPDF "lines" that share a baseline into one visual line, joined by a space. MuPDF's
    #: line is a text RUN, not a visual line: a numbered heading arrives as two side-by-side runs
    #: ("3.2.1" and "Scaled Dot-Product Attention"), which have no x-overlap and would therefore be
    #: two disconnected regions. Opt-in rather than automatic, because on a display equation the
    #: same merge would splice a denominator onto the term beside it.
    merge_baselines: bool = False
    #: Clamp this block's LINE rects to ``(y_top, y_bottom)`` in IR space (top-left origin, points)
    #: before any polygon is built. MuPDF's line box is the FONT's ascent/descent for the run, not
    #: the ink: a run set in CMSY/CMEX - the calligraphic O of ``O(L)``, a big delimiter, an
    #: integral sign - reports a box several points taller than the glyphs, and in a tight table
    #: that box reaches into the row below. Left unclamped it makes a row's polygon enclose the
    #: NEXT row's glyphs, which is a silent lie about which region a highlight covers. Use only
    #: where the overlay shows the box overhanging content that is not the block's, and set the
    #: bound from the neighbouring glyph boxes, never from taste.
    clip_y: tuple[float, float] | None = None
    payload: Mapping[str, Any] | None = None
    #: Render a crop into assets/: ``(subdirectory, scale, ImageRef.rendered_from)``.
    crop: tuple[str, float, str] | None = None


@dataclass(frozen=True)
class SectionPlan:
    heading: str
    parent: str | None = None


@dataclass(frozen=True)
class RelationPlan:
    type: str
    from_: str
    to: str
    confidence: float
    provenance: str


@dataclass(frozen=True)
class MetadataPlan:
    """``(block key, verbatim value, confidence)`` per scalar. Semantic rule 6b requires the value
    to appear in the cited block's normalised text; the engine checks that before writing."""

    title: tuple[str, str, float] | None = None
    authors: tuple[tuple[str, str, float], ...] = ()
    abstract: tuple[tuple[str, ...], float] | None = None
    venue: tuple[str, str, float] | None = None
    arxiv_id: tuple[str, str, float] | None = None
    doi: tuple[str, str, float] | None = None
    year: tuple[str, int, float] | None = None


@dataclass(frozen=True)
class PaperPlan:
    slug: str
    pdf: str
    #: The page indices this fixture covers. Recorded in fixtures/README.md, with the reason.
    pages: tuple[int, ...]
    page_scale: float
    parser_profile: str
    blocks: tuple[BlockPlan, ...]
    inlines: tuple[InlinePlan, ...] = ()
    sections: tuple[SectionPlan, ...] = ()
    relations: tuple[RelationPlan, ...] = ()
    metadata: MetadataPlan = field(default_factory=MetadataPlan)
    #: ``PaperStatus``. A fixture that covers only part of its PDF is a PARTIAL parse of that
    #: document and should say so - ``pages`` is the whole of ``Paper.pages``, so nothing else in
    #: the document records that the other pages exist. ``partial_reason`` is required to be
    #: non-null then, and required to be null at "complete" (semantic rule 41).
    status: Literal["partial", "complete"] = "complete"
    partial_reason: str | None = None


# ==============================================================================================
# THE ENGINE
# ==============================================================================================


def _round(value: float) -> float:
    return round(float(value), COORD_DECIMALS)


def _read_user_unit(doc: Any, page: Any) -> float:
    """The page's ``/UserUnit``, or 1.0.

    THIS TOOL ONLY SUPPORTS ``/UserUnit == 1``, AND IT NOW SAYS SO INSTEAD OF ASSUMING IT. The
    two frame-building sites below used to pass a hardcoded ``user_unit=1.0`` while taking block
    coordinates from ``page.get_text("dict")``, which MuPDF has ALREADY multiplied by
    ``/UserUnit`` (measured: PyMuPDF 1.28 / MuPDF 1.29 scales ``page.rect``, ``get_text`` and
    ``get_drawings``, and does NOT scale ``page.mediabox``, ``page.cropbox`` or
    ``page.rotation_matrix`` - see ADR-001 Amendment 1's COORDINATE FRAME retraction). On a
    ``/UserUnit != 1`` page that combines an UNSCALED frame with SCALED block coordinates.

    It is a coverage gap rather than a live bug - all 8 corpus PDFs are (rotate=0, crop==media,
    userUnit=1.0), re-measured - and ``_assert_frame_round_trips`` fires loudly rather than
    corrupting anything. But this file is the only worked example of the parse path in the repo,
    so an unstated assumption here is an assumption Wave 1 inherits. Supporting it properly means
    routing every ``get_text`` coordinate through ``geometry.strip_user_unit`` first; until
    something needs that, the limitation is STATED.
    """
    raw = doc.xref_get_key(page.xref, "UserUnit")
    if raw is None or raw[0] == "null":
        return 1.0
    value = float(raw[1])
    if value != 1.0:
        raise SystemExit(
            f"page {page.number}: /UserUnit is {value}, and this tool only supports 1.0. "
            f"MuPDF pre-multiplies get_text()/get_drawings() coordinates by /UserUnit but not "
            f"page.mediabox/cropbox, so the frame and the blocks would be in different scales. "
            f"Route every coordinate through geometry.strip_user_unit() before adding such a PDF."
        )
    return value


def _round_polygon(polygon: Sequence[Sequence[float]]) -> Polygon:
    return [[_round(p[0]), _round(p[1])] for p in polygon]


def _round_box(box: Sequence[float]) -> BBox:
    return [_round(v) for v in box]


def _union(boxes: Iterable[Rect4]) -> Rect4:
    items = list(boxes)
    if not items:
        raise BuildError("cannot take the union of zero rectangles")
    return (
        min(b[0] for b in items),
        min(b[1] for b in items),
        max(b[2] for b in items),
        max(b[3] for b in items),
    )


def _base32(digest: bytes, chars: int, alphabet: str) -> str:
    buffer = 0
    bits = 0
    out: list[str] = []
    for byte in digest:
        buffer = (buffer << 8) | byte
        bits += 8
        while bits >= 5 and len(out) < chars:
            bits -= 5
            out.append(alphabet[(buffer >> bits) & 31])
        if len(out) >= chars:
            break
    return "".join(out)


def _paper_id(source_hash_hex: str) -> str:
    """A ULID-shaped id DERIVED from the PDF rather than minted from the clock.

    DESIGN.md section 7.1 requires ``paper_id`` to be minted once per ``source_hash`` and held fixed
    across re-parses. A committed fixture takes that to its conclusion: deriving it from the digest
    means rebuilding produces the same bytes instead of a diff on every run.
    """
    digest = hashlib.sha256(("papertree/fixture/paper_id|" + source_hash_hex).encode()).digest()
    return "ppr_" + _base32(digest, 26, _CROCKFORD)


def _page_id(source_hash_hex: str, index: int) -> str:
    seed = f"papertree/fixture/page_id|{source_hash_hex}|{index}"
    return "pg_" + _base32(hashlib.sha256(seed.encode()).digest(), 16, _BASE32_LOWER)


# --- MuPDF extraction -------------------------------------------------------------------------


@dataclass(frozen=True)
class RawSpan:
    text: str
    bbox: Rect4
    font: str
    size: float


@dataclass(frozen=True)
class RawLine:
    spans: tuple[RawSpan, ...]

    @property
    def text(self) -> str:
        return "".join(s.text for s in self.spans)

    @property
    def bbox(self) -> Rect4:
        return _union(s.bbox for s in self.spans)


@dataclass(frozen=True)
class RawPage:
    index: int
    frame: PageFrame
    #: MuPDF text blocks, keyed exactly as ``page.get_text("dict")["blocks"]`` numbers them.
    text_blocks: Mapping[int, tuple[RawLine, ...]]
    #: MuPDF drawings, already inflated to a non-degenerate rect by their stroke width.
    drawings: tuple[Rect4, ...]
    has_text_layer: bool


def _read_pdf(path: Path, page_indices: Sequence[int]) -> tuple[str, dict[int, RawPage], Any]:
    import pymupdf  # imported lazily so --help works without it

    source_hash_hex = hashlib.sha256(path.read_bytes()).hexdigest()
    doc = pymupdf.open(str(path))
    pages: dict[int, RawPage] = {}
    for index in page_indices:
        page = doc[index]
        frame = normalise_page_frame(
            RawPageBoxes(
                media_box=[float(v) for v in page.mediabox],
                crop_box=[float(v) for v in page.cropbox],
                rotate=float(page.rotation),
                user_unit=_read_user_unit(doc, page),
            )
        )
        _assert_frame_round_trips(page, frame)

        text_blocks: dict[int, tuple[RawLine, ...]] = {}
        for bi, block in enumerate(page.get_text("dict")["blocks"]):
            if block.get("type") != 0:
                continue
            lines: list[RawLine] = []
            for line in block["lines"]:
                spans = tuple(
                    RawSpan(
                        text=str(span["text"]),
                        bbox=(
                            float(span["bbox"][0]),
                            float(span["bbox"][1]),
                            float(span["bbox"][2]),
                            float(span["bbox"][3]),
                        ),
                        font=str(span["font"]),
                        size=float(span["size"]),
                    )
                    for span in line["spans"]
                )
                if spans:
                    lines.append(RawLine(spans=spans))
            text_blocks[bi] = tuple(lines)

        drawings: list[Rect4] = []
        for drawing in page.get_drawings():
            rect = drawing["rect"]
            pad = max(float(drawing.get("width") or 0.0), 0.25) / 2
            x0, y0, x1, y1 = (float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3]))
            # A stroked hairline has a zero-extent rect, which would be a zero-area polygon and a
            # rule G6 ERROR. Inflating by the stroke width is the region the ink actually covers.
            if y1 - y0 <= 0:
                y0, y1 = y0 - pad, y1 + pad
            if x1 - x0 <= 0:
                x0, x1 = x0 - pad, x1 + pad
            drawings.append((x0, y0, x1, y1))

        pages[index] = RawPage(
            index=index,
            frame=frame,
            text_blocks=text_blocks,
            drawings=tuple(drawings),
            has_text_layer=any(text_blocks.values()),
        )
    return source_hash_hex, pages, doc


def _assert_frame_round_trips(page: Any, frame: PageFrame) -> None:
    """MuPDF page space -> raw PDF space -> IR space must be the identity on the page rectangle.

    This is what makes ``_to_ir`` trustworthy rather than a coincidence of this corpus (unrotated
    US-Letter pages with CropBox == MediaBox). Add a rotated or cropped paper and this fails loudly
    instead of silently shifting every polygon on the page.
    """
    corner: Rect4 = (0.0, 0.0, float(frame.width), float(frame.height))
    got = _to_ir(page, frame, corner)
    for a, b in zip(got, corner, strict=True):
        if abs(a - b) > 0.01:
            raise BuildError(
                f"page frame round-trip failed: MuPDF {corner} came back as {tuple(got)}; this "
                f"page is rotated or cropped in a way this tool has never been checked against"
            )


def _to_ir(page: Any, frame: PageFrame, rect: Sequence[float]) -> BBox:
    """One MuPDF page-space rectangle -> IR space, through the geometry library.

    MuPDF hands out coordinates in its own device space. They are mapped back to RAW PDF space with
    the inverse of ``page.transformation_matrix`` and then normalised by the library, so the origin
    flip, the CropBox offset and /Rotate are each applied by the code that owns them.
    """
    import pymupdf

    raw = pymupdf.Rect(rect[0], rect[1], rect[2], rect[3]) * ~page.transformation_matrix
    return normalise_rect(frame, [float(raw.x0), float(raw.y0), float(raw.x1), float(raw.y1)])


# --- assembling blocks --------------------------------------------------------------------------


@dataclass
class BuiltBlock:
    plan: BlockPlan
    block: dict[str, Any]
    #: The region in MuPDF page space, kept so a crop can be rendered from it.
    mupdf_rect: Rect4


def _lines_of(
    raw: RawPage, refs: Sequence[TextRef], *, merge_baselines: bool = False
) -> list[RawLine]:
    """The plan's text units flattened to lines, in the order the plan lists them."""
    lines: list[RawLine] = []
    for ref in refs:
        if isinstance(ref, tuple):
            bi, li = ref
            block = raw.text_blocks.get(bi)
            if block is None or li >= len(block):
                raise BuildError(f"page {raw.index}: no MuPDF line ({bi}, {li})")
            lines.append(block[li])
        else:
            block = raw.text_blocks.get(ref)
            if not block:
                raise BuildError(f"page {raw.index}: MuPDF text block {ref} is empty or missing")
            lines.extend(block)
    return _merge_baselines(lines) if merge_baselines else lines


def _merge_baselines(lines: Sequence[RawLine]) -> list[RawLine]:
    """Join runs that sit on one baseline, left to right, with an explicit space span.

    Two runs are the same visual line when their y-intervals overlap by at least 60 % of the
    shorter one AND their x-extents are disjoint. The space is materialised as a real ``RawSpan``
    covering the gap so that character offsets, span bboxes and ``text`` stay in step.

    Runs are CLUSTERED on that y test and only then ordered left to right. Ordering on y first and
    testing "is this run to the RIGHT of the last one" is not safe: a bold run-in lead
    ("**Encoder:** The encoder is...") sits 0.06 pt BELOW the prose beside it, so the prose sorts
    first, the lead fails the to-the-right test against it, and the two never merge - a silent
    reversal that lands in ``text`` and in nothing an assertion looks at.
    """
    clusters: list[list[RawLine]] = []
    for line in sorted(lines, key=lambda line: (line.bbox[1], line.bbox[0])):
        if clusters:
            a, b = _union(run.bbox for run in clusters[-1]), line.bbox
            overlap = min(a[3], b[3]) - max(a[1], b[1])
            shorter = min(a[3] - a[1], b[3] - b[1])
            if overlap >= 0.6 * shorter and (b[0] >= a[2] or b[2] <= a[0]):
                clusters[-1].append(line)
                continue
        clusters.append([line])
    return [_join_runs(sorted(cl, key=lambda line: line.bbox[0])) for cl in clusters]


def _join_runs(runs: Sequence[RawLine]) -> RawLine:
    if len(runs) == 1:
        return runs[0]
    spans: list[RawSpan] = list(runs[0].spans)
    for previous, run in zip(runs, runs[1:], strict=False):
        gap = previous.spans[-1]
        spans.append(
            RawSpan(
                text=" ",
                bbox=(previous.bbox[2], run.bbox[1], run.bbox[0], run.bbox[3]),
                font=gap.font,
                size=gap.size,
            )
        )
        spans.extend(run.spans)
    return RawLine(spans=tuple(spans))


def _spans_for(
    page: Any,
    raw: RawPage,
    lines: Sequence[RawLine],
    inline_specs: Sequence[InlinePlan],
    inline_ids: Mapping[str, str],
) -> list[dict[str, Any]]:
    """One span per line - DESIGN.md section 10's "line-fragment granularity" - split around any
    inline run, because semantic rule 26 forbids overlapping spans. Each piece carries the union
    bbox of the MuPDF spans it actually covers rather than the whole line's box, which matters on a
    line whose radical or subscript makes the line box far taller than the prose.
    """
    by_line: dict[int, list[InlinePlan]] = {}
    for spec in inline_specs:
        by_line.setdefault(spec.line, []).append(spec)

    spans: list[dict[str, Any]] = []
    offset = 0
    for li, line in enumerate(lines):
        pieces: list[tuple[int, int, str | None]] = []
        cursor = 0
        for spec in sorted(by_line.get(li, []), key=lambda s: s.spans[0]):
            if spec.spans[0] > cursor:
                pieces.append((cursor, spec.spans[0], None))
            pieces.append((spec.spans[0], spec.spans[1], spec.key))
            cursor = spec.spans[1]
        if cursor < len(line.spans):
            pieces.append((cursor, len(line.spans), None))

        for first, last, key in pieces:
            members = line.spans[first:last]
            piece_text = "".join(s.text for s in members)
            if not piece_text:
                continue
            start = offset + sum(len(s.text) for s in line.spans[:first])
            box = _to_ir(page, raw.frame, _union(s.bbox for s in members))
            span: dict[str, Any] = {
                "start": start,
                "end": start + len(piece_text),
                "bbox": [_round(v) for v in box],
            }
            if key is not None:
                span["role"] = "inline_equation"
                span["block_id"] = inline_ids[key]
            fonts = {s.font for s in members}
            sizes = {round(s.size, 2) for s in members}
            if len(fonts) == 1:
                span["font"] = members[0].font
            if len(sizes) == 1:
                span["size"] = round(members[0].size, 2)
            spans.append(span)
        offset += len(line.text) + 1  # the "\n" that the text join inserts
    return spans


def _glyph_spans(page: Any, raw: RawPage, members: Sequence[RawSpan]) -> list[dict[str, Any]]:
    """One span per MuPDF span, offsets relative to the concatenation of their texts."""
    spans: list[dict[str, Any]] = []
    offset = 0
    for member in members:
        if not member.text:
            continue
        box = _round_box(_to_ir(page, raw.frame, member.bbox))
        spans.append(
            {
                "start": offset,
                "end": offset + len(member.text),
                "bbox": box,
                "font": member.font,
                "size": round(member.size, 2),
            }
        )
        offset += len(member.text)
    return spans


def _build_block(
    *,
    page: Any,
    raw: RawPage,
    plan: BlockPlan,
    source_hash_hex: str,
    inline_specs: Sequence[InlinePlan],
    inline_ids: Mapping[str, str],
) -> BuiltBlock:
    lines = _lines_of(raw, plan.text, merge_baselines=plan.merge_baselines)
    regions: list[Rect4] = list(plan.rects)
    for di in plan.drawings:
        if di >= len(raw.drawings):
            raise BuildError(f"page {raw.index}: no MuPDF drawing {di}")
        regions.append(raw.drawings[di])

    line_rects = [_round_box(_to_ir(page, raw.frame, line.bbox)) for line in lines]
    region_rects = [_round_box(_to_ir(page, raw.frame, r)) for r in regions]

    if plan.clip_y is not None:
        top, bottom = plan.clip_y
        clipped: list[BBox] = []
        for rect in line_rects:
            y0, y1 = max(rect[1], top), min(rect[3], bottom)
            if y1 - y0 <= 0.0:
                raise BuildError(
                    f"{plan.key}: clip_y={plan.clip_y} leaves line rect {rect} with no height - "
                    f"the clamp is meant to trim a font-metric overhang, not to relocate the block"
                )
            clipped.append([rect[0], _round(y0), rect[2], _round(y1)])
        line_rects = clipped

    polygon: Polygon
    if plan.geometry == "lines" and line_rects and not region_rects:
        gap = plan.line_gap_pt if plan.line_gap_pt is not None else 2.0
        polygons = union_of_line_rects(line_rects, vertical_gap_tolerance=gap)
        if len(polygons) != 1:
            raise BuildError(
                f"{plan.key}: union_of_line_rects returned {len(polygons)} regions, not 1 - the "
                f"plan groups lines that are not one connected run of text. Raise line_gap_pt if "
                f"the paragraph is merely loose; split the block if it genuinely is two."
            )
        polygon = _round_polygon(polygons[0])
    else:
        everything = line_rects + region_rects
        if not everything:
            raise BuildError(f"{plan.key}: the plan gives this block no geometry at all")
        extent = _union((r[0], r[1], r[2], r[3]) for r in everything)
        polygon = _round_polygon(bbox_to_polygon(list(extent)))

    bbox: BBox = [_round(v) for v in polygon_extent(polygon)]

    text: str | None = None
    spans: list[dict[str, Any]] = []
    if lines:
        text = "\n".join(line.text for line in lines)
        spans = _spans_for(page, raw, lines, inline_specs, inline_ids)

    block: dict[str, Any] = {
        "block_id": block_id(
            BlockIdInput(
                source_hash=source_hash_hex,
                page_index=raw.index,
                x0=bbox[0],
                y0=bbox[1],
                block_type=plan.type,
                text=text or "",
            )
        ),
        "type": plan.type,
        "page_index": raw.index,
        "polygon": polygon,
        "bbox": bbox,
        "flow": plan.flow,
        "order": -1,  # assigned once the page's blocks are grouped
    }
    if text is not None:
        block["text"] = text
        block["text_normalised"] = normalise_text(text)
        block["content_hash"] = content_hash(text)
        if spans:
            block["spans"] = spans
    block["source"] = plan.source
    block["confidence"] = plan.confidence
    block["provenance"] = {"parser": "papertree-fixture-scaffold", "stage": plan.stage}
    if plan.payload is not None:
        block["payload"] = dict(plan.payload)

    return BuiltBlock(
        plan=plan,
        block=block,
        mupdf_rect=_union([line.bbox for line in lines] + regions),
    )


def _build_inline(
    *,
    page: Any,
    raw: RawPage,
    parent: BlockPlan,
    spec: InlinePlan,
    source_hash_hex: str,
) -> BuiltBlock:
    lines = _lines_of(raw, parent.text, merge_baselines=parent.merge_baselines)
    if spec.line >= len(lines):
        raise BuildError(f"inline {spec.key}: {parent.key} has no line {spec.line}")
    members = lines[spec.line].spans[spec.spans[0] : spec.spans[1]]
    run = "".join(s.text for s in members)
    if not run or run != run.strip():
        raise BuildError(
            f"inline {spec.key}: the span run {run!r} is empty or carries surrounding whitespace. "
            f"Pick span indices whose glyphs are exactly the inline construct, so no trimming is "
            f"needed and the polygon encloses precisely the stored text."
        )
    box = _to_ir(page, raw.frame, _union(s.bbox for s in members))
    polygon = _round_polygon(bbox_to_polygon(list(box)))
    bbox: BBox = [_round(v) for v in polygon_extent(polygon)]
    return BuiltBlock(
        plan=BlockPlan(
            key=spec.key,
            page=parent.page,
            type="inline_equation",
            flow=parent.flow,
            confidence=spec.confidence,
            parent=spec.parent,
            stage="formula-region",
            crop=("equations", 8.0, "page"),
        ),
        block={
            "block_id": block_id(
                BlockIdInput(
                    source_hash=source_hash_hex,
                    page_index=raw.index,
                    x0=bbox[0],
                    y0=bbox[1],
                    block_type="inline_equation",
                    text=run,
                )
            ),
            "type": "inline_equation",
            "page_index": raw.index,
            "polygon": polygon,
            "bbox": bbox,
            "flow": parent.flow,
            "order": 0,
            "text": run,
            "text_normalised": normalise_text(run),
            "content_hash": content_hash(run),
            # One span per glyph run, which for an inline equation is finer than "line-fragment"
            # granularity and is deliberate: `anchoring/targets.spec` has to resolve an anchor at
            # PART of an equation, and that needs character geometry inside the block.
            "spans": _glyph_spans(page, raw, members),
            "source": "pdf_text_layer",
            "confidence": spec.confidence,
            "provenance": {"parser": "papertree-fixture-scaffold", "stage": "formula-region"},
            "payload": {
                "display": False,
                "latex": spec.latex,
                "latex_confidence": spec.latex_confidence,
                "image": None,  # filled in when the crop is rendered
            },
        },
        mupdf_rect=_union(s.bbox for s in members),
    )


def _resolve(
    value: Any,
    ids: Mapping[str, str],
    page: Any,
    frame: PageFrame,
    built: Mapping[str, BuiltBlock] | None = None,
) -> Any:
    """Replace ``Ref`` / ``RefPolygon`` / ``PageRect`` markers inside a planned payload."""
    if isinstance(value, Ref):
        return ids[value.key]
    if isinstance(value, RefPolygon):
        if built is None or value.key not in built:
            raise BuildError(f"RefPolygon({value.key!r}) names no planned block")
        return built[value.key].block["polygon"]
    if isinstance(value, PageRect):
        box = _to_ir(page, frame, (value.x0, value.y0, value.x1, value.y1))
        return _round_polygon(bbox_to_polygon(list(box)))
    if isinstance(value, Mapping):
        return {k: _resolve(v, ids, page, frame, built) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_resolve(v, ids, page, frame, built) for v in value]
    return value


def _render(page: Any, rect: Sequence[float], scale: float, out: Path) -> None:
    import pymupdf

    clip = pymupdf.Rect(rect[0], rect[1], rect[2], rect[3])
    page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip).save(str(out))


def _to_mupdf(page: Any, frame: PageFrame, x: float, y: float) -> tuple[float, float]:
    """The inverse of :func:`_to_ir` for one point: IR space -> MuPDF page space."""
    raw = denormalise_point(frame, [float(x), float(y)])
    a, b, c, d, e, f = (float(v) for v in page.transformation_matrix)
    return (a * raw[0] + c * raw[1] + e, b * raw[0] + d * raw[1] + f)


# ==============================================================================================
# THE EYEBALL PASS - the only check that can catch a polygon which is valid but wrong
# ==============================================================================================

#: Deliberately high-contrast and per-type: the point is to see at a glance that an `equation`
#: outline is around an equation and a `caption` outline is around a caption.
_OVERLAY_COLOURS: Mapping[str, tuple[float, float, float]] = {
    "title": (0.80, 0.10, 0.10),
    "author": (0.75, 0.35, 0.00),
    "affiliation": (0.60, 0.45, 0.00),
    "heading": (0.85, 0.15, 0.55),
    "abstract": (0.05, 0.45, 0.20),
    "paragraph": (0.05, 0.30, 0.85),
    "equation": (0.90, 0.35, 0.00),
    "inline_equation": (1.00, 0.55, 0.00),
    "figure": (0.00, 0.60, 0.60),
    "caption": (0.55, 0.10, 0.75),
    "table": (0.00, 0.50, 0.30),
    "table_row": (0.20, 0.70, 0.40),
    "table_cell": (0.45, 0.85, 0.55),
    "algorithm": (0.45, 0.20, 0.70),
    "footnote": (0.45, 0.45, 0.45),
    "page_number": (0.45, 0.45, 0.45),
    "annotation": (0.30, 0.30, 0.30),
    "unknown": (0.95, 0.00, 0.95),
}


def overlay(plan: PaperPlan, document: Mapping[str, Any], out: Path, scale: float = 2.0) -> int:
    """Draw every polygon on its own page, labelled ``type#order dDOC_ORDER``, one PNG per page.

    A fixture can pass every rule in DESIGN.md section 5.2 and still be wrong - a polygon around
    the paragraph BELOW the one it names validates perfectly. Nothing but looking at the page
    catches that, so the tool renders the page for looking at.
    """
    import pymupdf

    out.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(str(CORPUS / plan.pdf))
    written = 0
    for page_object in document["pages"]:
        index = int(page_object["index"])
        page = doc[index]
        frame = normalise_page_frame(
            RawPageBoxes(
                media_box=[float(v) for v in page.mediabox],
                crop_box=[float(v) for v in page.cropbox],
                rotate=float(page.rotation),
                user_unit=_read_user_unit(doc, page),
            )
        )
        shape = page.new_shape()
        for block in document["blocks"]:
            if int(block["page_index"]) != index:
                continue
            colour = _OVERLAY_COLOURS.get(str(block["type"]), (0.0, 0.0, 0.0))
            points = [pymupdf.Point(*_to_mupdf(page, frame, x, y)) for x, y in block["polygon"]]
            shape.draw_polyline([*points, points[0]])
            shape.finish(color=colour, width=0.6, closePath=True)
            label = f"{block['type']}#{block['order']}"
            if "doc_order" in block:
                label += f" d{block['doc_order']}"
            anchor = _to_mupdf(page, frame, block["bbox"][0], block["bbox"][1])
            shape.insert_text(
                pymupdf.Point(anchor[0] + 0.8, anchor[1] - 1.0),
                label,
                fontsize=4.0,
                color=colour,
            )
        shape.commit()
        target = out / f"overlay-p{index}.png"
        page.get_pixmap(matrix=pymupdf.Matrix(scale, scale)).save(str(target))
        written += 1
    doc.close()
    return written


# --- the whole document -------------------------------------------------------------------------


def build(plan: PaperPlan, *, write: bool = True) -> dict[str, Any]:
    pdf = CORPUS / plan.pdf
    if not pdf.exists():
        raise BuildError(f"{pdf} is missing (the corpus is gitignored; fetch it first)")
    source_hash_hex, raw_pages, doc = _read_pdf(pdf, plan.pages)

    plans = {b.key: b for b in plan.blocks}
    rank: dict[str, float] = {b.key: float(i) for i, b in enumerate(plan.blocks)}
    built: dict[str, BuiltBlock] = {}
    inline_by_parent: dict[str, list[InlinePlan]] = {}
    for spec in plan.inlines:
        if spec.parent not in plans:
            raise BuildError(f"inline {spec.key}: no parent block {spec.parent!r}")
        inline_by_parent.setdefault(spec.parent, []).append(spec)

    # Pass 1a: inline equations first - the parent's role-tagged span needs their ids.
    inline_ids: dict[str, str] = {}
    for spec in plan.inlines:
        parent = plans[spec.parent]
        item = _build_inline(
            page=doc[parent.page],
            raw=raw_pages[parent.page],
            parent=parent,
            spec=spec,
            source_hash_hex=source_hash_hex,
        )
        inline_ids[spec.key] = item.block["block_id"]
        built[spec.key] = item
        rank[spec.key] = rank[spec.parent] + 0.5

    # Pass 1b: everything else.
    for block_plan in plan.blocks:
        built[block_plan.key] = _build_block(
            page=doc[block_plan.page],
            raw=raw_pages[block_plan.page],
            plan=block_plan,
            source_hash_hex=source_hash_hex,
            inline_specs=inline_by_parent.get(block_plan.key, []),
            inline_ids=inline_ids,
        )

    ids = {key: item.block["block_id"] for key, item in built.items()}
    if len(set(ids.values())) != len(ids):
        raise BuildError("two blocks collided on one block_id - the plan has a duplicate region")

    keys = sorted(built, key=lambda k: rank[k])

    # Pass 2: order (dense within (page, flow, container)), doc_order, parents, children.
    def is_nested(key: str) -> bool:
        parent_key = built[key].plan.parent
        return parent_key is not None and built[parent_key].block["type"] not in (
            "title",
            "heading",
        )

    top_level: dict[tuple[int, str], list[str]] = {}
    nested: dict[str, list[str]] = {}
    for key in keys:
        block = built[key].block
        parent_key = built[key].plan.parent
        if parent_key is not None and is_nested(key):
            nested.setdefault(parent_key, []).append(key)
        else:
            top_level.setdefault((block["page_index"], block["flow"]), []).append(key)
    for group in (*top_level.values(), *nested.values()):
        for index, key in enumerate(group):
            built[key].block["order"] = index

    doc_order = 0
    for page_index in plan.pages:
        for key in top_level.get((page_index, "body"), []):
            built[key].block["doc_order"] = doc_order
            doc_order += 1

    children: dict[str, list[str]] = {}
    for key in keys:
        parent_key = built[key].plan.parent
        if parent_key is not None:
            children.setdefault(parent_key, []).append(key)
            built[key].block["parent_id"] = ids[parent_key]
    for key, kids in children.items():
        built[key].block["child_ids"] = [ids[k] for k in sorted(kids, key=lambda k: rank[k])]

    # Pass 3: payload markers, crops, page rasters.
    asset_root = ASSETS / plan.slug
    if write:
        for sub in ("pages", "figures", "equations"):
            (asset_root / sub).mkdir(parents=True, exist_ok=True)

    for key in keys:
        item = built[key]
        page = doc[item.plan.page]
        frame = raw_pages[item.plan.page].frame
        if "payload" in item.block:
            item.block["payload"] = _resolve(item.block["payload"], ids, page, frame, built)
        if item.plan.crop is None:
            continue
        sub, scale, rendered_from = item.plan.crop
        name = f"{item.block['block_id']}@{scale:g}x.png"
        if write:
            _render(page, item.mupdf_rect, scale, asset_root / sub / name)
        payload: dict[str, Any] = item.block.setdefault("payload", {})
        payload["image"] = {
            "uri": f"{URI_SCHEME}://{plan.slug}/{sub}/{name}",
            "scale": scale,
            "dpi": 72 * scale,
            "rendered_from": rendered_from,
        }

    pages: list[dict[str, Any]] = []
    for page_index in plan.pages:
        frame = raw_pages[page_index].frame
        name = f"{page_index:03d}@{plan.page_scale:g}x.png"
        if write:
            _render(
                doc[page_index],
                (0.0, 0.0, float(frame.width), float(frame.height)),
                plan.page_scale,
                asset_root / "pages" / name,
            )
        on_page = [k for k in keys if built[k].block["page_index"] == page_index]
        confidences = [float(built[k].block["confidence"]) for k in on_page]
        pages.append(
            {
                "page_id": _page_id(source_hash_hex, page_index),
                "index": page_index,
                "width": _round(frame.width),
                "height": _round(frame.height),
                "rotation": frame.rotation,
                "user_unit": frame.user_unit,
                "crop_box": [_round(v) for v in frame.crop_box],
                "media_box": [_round(v) for v in frame.media_box],
                "image": {
                    "uri": f"{URI_SCHEME}://{plan.slug}/pages/{name}",
                    "scale": plan.page_scale,
                    "dpi": 72 * plan.page_scale,
                    "rendered_from": "page",
                },
                "has_text_layer": raw_pages[page_index].has_text_layer,
                "is_scanned": False,
                "block_ids": [ids[k] for k in on_page],
                "flows": {
                    flow: [ids[k] for k in top_level.get((page_index, flow), [])]
                    for flow in ("body", "caption", "footnote", "header", "footer", "margin")
                },
                # DESIGN.md section 10: Page.confidence is the block-count-weighted mean of its
                # blocks, which for equally-weighted blocks is the plain mean.
                "confidence": round(sum(confidences) / len(confidences), 4),
            }
        )

    by_page = [float(p["confidence"]) for p in pages]
    all_blocks = [float(built[k].block["confidence"]) for k in keys]
    weakest = min(range(len(by_page)), key=lambda i: by_page[i])

    doc.close()
    return {
        "ir_version": "1.0.0",
        "paper_id": _paper_id(source_hash_hex),
        "source_hash": f"sha256:{source_hash_hex}",
        "generation": 1,
        "coordinate_space": "pdf_user_space_topleft",
        "parser": {
            "name": "papertree-fixture-scaffold",
            "version": "0.1.0",
            "config_hash": "sha256:" + hashlib.sha256(plan.parser_profile.encode()).hexdigest(),
            "profile": plan.parser_profile,
            "parsed_at": "2026-07-30T00:00:00Z",
        },
        "status": plan.status,
        "partial_reason": plan.partial_reason if plan.status == "partial" else None,
        "metadata": _metadata(plan, built, ids),
        "pages": pages,
        "blocks": [built[k].block for k in keys],
        "relations": _relations(plan, built, ids, keys),
        "sections": _sections(plan, built, ids),
        "references": [],
        "confidence": {
            "overall": round(sum(all_blocks) / len(all_blocks), 4),
            "by_page": by_page,
            "weakest_pages": [plan.pages[weakest]],
            "needs_review": any(c < 0.7 for c in by_page),
        },
    }


def _sections(
    plan: PaperPlan, built: Mapping[str, BuiltBlock], ids: Mapping[str, str]
) -> list[dict[str, Any]]:
    levels: dict[str, int] = {}
    out: list[dict[str, Any]] = []
    for spec in plan.sections:
        level = 1 if spec.parent is None else levels[spec.parent] + 1
        levels[spec.heading] = level
        members = [k for k, item in built.items() if item.plan.parent == spec.heading]
        # DESIGN.md section 4: ordered by doc_order where present, by (page_index, order) otherwise.
        members.sort(
            key=lambda k: (
                built[k].block.get("doc_order", 10**6),
                built[k].block["page_index"],
                built[k].block["order"],
            )
        )
        section: dict[str, Any] = {"heading_block_id": ids[spec.heading], "level": level}
        if spec.parent is not None:
            section["parent_heading_block_id"] = ids[spec.parent]
        section["block_ids"] = [ids[k] for k in members]
        out.append(section)
    return out


def _relations(
    plan: PaperPlan,
    built: Mapping[str, BuiltBlock],
    ids: Mapping[str, str],
    keys: Sequence[str],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for key in keys:
        parent_key = built[key].plan.parent
        if parent_key is not None:
            out.append(
                {
                    "type": "parent_of",
                    "from": ids[parent_key],
                    "to": ids[key],
                    "confidence": 1.0,
                    "provenance": "hand-checked-layout",
                }
            )
    for spec in plan.relations:
        out.append(
            {
                "type": spec.type,
                "from": ids[spec.from_],
                "to": ids[spec.to],
                "confidence": spec.confidence,
                "provenance": spec.provenance,
            }
        )
    return out


def _scalar(
    built: Mapping[str, BuiltBlock], ids: Mapping[str, str], spec: tuple[str, Any, float]
) -> dict[str, Any]:
    key, value, confidence = spec
    haystack = normalise_text(str(built[key].block.get("text") or ""))
    if normalise_text(str(value)) not in haystack:
        raise BuildError(
            f"metadata value {value!r} does not appear in block {key!r}'s normalised text, so "
            f"semantic rule 6b would reject it"
        )
    return {"value": value, "source_block_id": ids[key], "confidence": confidence}


def _metadata(
    plan: PaperPlan, built: Mapping[str, BuiltBlock], ids: Mapping[str, str]
) -> dict[str, Any]:
    m = plan.metadata
    return {
        "title": _scalar(built, ids, m.title) if m.title else None,
        "authors": [_scalar(built, ids, a) for a in m.authors],
        "abstract": (
            {"block_ids": [ids[k] for k in m.abstract[0]], "confidence": m.abstract[1]}
            if m.abstract
            else None
        ),
        "doi": _scalar(built, ids, m.doi) if m.doi else None,
        "arxiv_id": _scalar(built, ids, m.arxiv_id) if m.arxiv_id else None,
        "venue": _scalar(built, ids, m.venue) if m.venue else None,
        "year": _scalar(built, ids, m.year) if m.year else None,
    }


# ==============================================================================================
# VERIFICATION - the checks the F0.7 brief names, run before anything reaches disk
# ==============================================================================================


def verify(document: Mapping[str, Any]) -> str:
    paper = Paper.model_validate(document)  # the generated Pydantic model == the JSON Schema
    report = validate_paper(paper)  # the semantic layer, DESIGN.md section 5.2

    problems: list[str] = []
    source_hex = str(document["source_hash"]).removeprefix("sha256:")
    known = {b["block_id"] for b in document["blocks"]}

    for block in document["blocks"]:
        expected = block_id(
            BlockIdInput(
                source_hash=source_hex,
                page_index=block["page_index"],
                x0=block["bbox"][0],
                y0=block["bbox"][1],
                block_type=block["type"],
                text=block.get("text", ""),
            )
        )
        if expected != block["block_id"]:
            problems.append(f"block_id {block['block_id']} does not recompute (got {expected})")
        extent = polygon_extent(block["polygon"])
        if any(abs(a - b) > 1e-9 for a, b in zip(extent, block["bbox"], strict=True)):
            problems.append(f"{block['block_id']}: bbox {block['bbox']} != extent {list(extent)}")

    for relation in document["relations"]:
        for end in ("from", "to"):
            if relation[end] not in known:
                problems.append(f"relation {relation['type']}.{end} does not resolve")
    for page in document["pages"]:
        claimed = {b["block_id"] for b in document["blocks"] if b["page_index"] == page["index"]}
        if set(page["block_ids"]) != claimed:
            problems.append(f"page {page['index']}: block_ids disagree with blocks[]")

    lines = [
        f"ok = {report.ok} | errors = {len(report.errors)} | warnings = {len(report.warnings)}",
        format_diagnostics(report.diagnostics) or "(no diagnostics)",
    ]
    if problems:
        lines.append("EXTRA CHECKS FAILED:\n" + "\n".join(problems))
    text = "\n".join(lines)
    if not report.ok or problems:
        raise BuildError(text)
    return text


# ==============================================================================================
# MAIN
# ==============================================================================================


def _dump(document: Mapping[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build a golden PaperIR fixture. NOT the parser - see the module docstring."
    )
    parser.add_argument("--paper", action="append", help="slug to build; repeatable")
    parser.add_argument("--check", action="store_true", help="build and verify without writing")
    parser.add_argument(
        "--overlay", type=Path, help="also write annotated page renders here for the eyeball pass"
    )
    args = parser.parse_args(argv)

    for slug in args.paper or sorted(PAPERS):
        if slug not in PAPERS:
            print(f"unknown paper {slug!r}; known: {', '.join(sorted(PAPERS))}", file=sys.stderr)
            return 2
        document = build(PAPERS[slug], write=not args.check)
        print(f"-- {slug} " + "-" * 60)
        print(verify(document))
        if args.overlay is not None:
            print(f"overlays: {overlay(PAPERS[slug], document, args.overlay / slug)}")
        if not args.check:
            out = FIXTURES / f"{slug}.paperir.json"
            _dump(document, out)
            print(f"wrote {out}")
        print(f"{len(document['blocks'])} blocks over {len(document['pages'])} pages")
    return 0


# ==============================================================================================
# PLANS - per-paper data. Every line below was decided by looking at the rendered page.
# ==============================================================================================

#: Verbatim from a born-digital text layer, region fully recovered, type hand-assigned after
#: looking at the page. DESIGN.md section 10 calls 1.0 "a legitimate value, not a placeholder"
#: for exactly this case.
TEXT_CONF = 1.0
#: The same, but the region was assembled from more than one MuPDF text block by hand.
MERGED_CONF = 0.98
#: An unclassifiable vector rule: DESIGN.md section 10's "detector has no score" default.
RULE_CONF = 0.3
#: A float region whose EXTENT was delimited by hand from the rendered page rather than read off a
#: text box: the classification is certain, the last point or two of the boundary is not.
FIGURE_CONF = 0.95


def _attention() -> PaperPlan:
    """Attention Is All You Need (NeurIPS 2017), pages 0-3.

    Why 0-3: the shortest prefix that clears the F0.7 bar while staying genuinely hand-checkable.
    It carries the front matter, three levels of section hierarchy (3 / 3.2 / 3.2.1), BOTH raster
    figures with their captions, display equation (1), an inline equation located by a role-tagged
    span, footnotes, page numbers, a rotated margin stamp, and four unclassifiable vector rules.

    The MuPDF text-block and drawing indices below are for this exact PDF. ``--check`` fails loudly
    if any of them stops pointing at what the plan says it does.
    """
    blocks: list[BlockPlan] = [
        # ---- page 0: front matter -----------------------------------------------------------
        BlockPlan("p0-notice", 0, "paragraph", "body", MERGED_CONF, text=(0, 1), line_gap_pt=4.0),
        BlockPlan(
            "p0-rule-above-title",
            0,
            "unknown",
            "body",
            RULE_CONF,
            drawings=(0,),
            geometry="rect",
            source="pdf_vector",
            stage="vector-region",
        ),
        BlockPlan("p0-title", 0, "title", "body", TEXT_CONF, text=(2,)),
        BlockPlan(
            "p0-rule-below-title",
            0,
            "unknown",
            "body",
            RULE_CONF,
            drawings=(1,),
            geometry="rect",
            source="pdf_vector",
            stage="vector-region",
        ),
        BlockPlan("p0-author-1", 0, "author", "body", MERGED_CONF, text=(3, 4)),
        BlockPlan("p0-author-2", 0, "author", "body", MERGED_CONF, text=(5, 6)),
        BlockPlan("p0-author-3", 0, "author", "body", TEXT_CONF, text=(7,)),
        BlockPlan("p0-author-4", 0, "author", "body", TEXT_CONF, text=(8,)),
        BlockPlan("p0-author-5", 0, "author", "body", TEXT_CONF, text=(9,)),
        BlockPlan("p0-author-6", 0, "author", "body", TEXT_CONF, text=(10,)),
        BlockPlan("p0-author-7", 0, "author", "body", MERGED_CONF, text=(11, 12)),
        BlockPlan("p0-author-8", 0, "author", "body", TEXT_CONF, text=(13,)),
        BlockPlan("p0-h-abstract", 0, "heading", "body", TEXT_CONF, text=(14,)),
        BlockPlan(
            "p0-abstract", 0, "abstract", "body", TEXT_CONF, text=(15,), parent="p0-h-abstract"
        ),
        BlockPlan(
            "p0-footnote-rule",
            0,
            "unknown",
            "footnote",
            RULE_CONF,
            drawings=(2,),
            geometry="rect",
            source="pdf_vector",
            stage="vector-region",
        ),
        BlockPlan("p0-footnote-star", 0, "footnote", "footnote", TEXT_CONF, text=(16,)),
        BlockPlan("p0-footnote-dagger", 0, "footnote", "footnote", TEXT_CONF, text=((17, 0),)),
        BlockPlan("p0-footnote-ddagger", 0, "footnote", "footnote", TEXT_CONF, text=((17, 1),)),
        BlockPlan("p0-footer", 0, "footer", "footer", TEXT_CONF, text=(18,)),
        BlockPlan("p0-arxiv", 0, "margin_note", "margin", TEXT_CONF, text=(19,)),
        # ---- page 1: sections 1, 2, 3 --------------------------------------------------------
        BlockPlan("p1-h-intro", 1, "heading", "body", TEXT_CONF, merge_baselines=True, text=(0,)),
        BlockPlan("p1-intro-1", 1, "paragraph", "body", TEXT_CONF, text=(1,), parent="p1-h-intro"),
        BlockPlan("p1-intro-2", 1, "paragraph", "body", TEXT_CONF, text=(2,), parent="p1-h-intro"),
        BlockPlan("p1-intro-3", 1, "paragraph", "body", TEXT_CONF, text=(3,), parent="p1-h-intro"),
        BlockPlan("p1-intro-4", 1, "paragraph", "body", TEXT_CONF, text=(4,), parent="p1-h-intro"),
        BlockPlan(
            "p1-h-background", 1, "heading", "body", TEXT_CONF, merge_baselines=True, text=(5,)
        ),
        BlockPlan(
            "p1-bg-1", 1, "paragraph", "body", TEXT_CONF, text=(6,), parent="p1-h-background"
        ),
        BlockPlan(
            "p1-bg-2", 1, "paragraph", "body", TEXT_CONF, text=(7,), parent="p1-h-background"
        ),
        BlockPlan(
            "p1-bg-3", 1, "paragraph", "body", TEXT_CONF, text=(8,), parent="p1-h-background"
        ),
        BlockPlan(
            "p1-bg-4", 1, "paragraph", "body", TEXT_CONF, text=(9,), parent="p1-h-background"
        ),
        BlockPlan("p1-h-model", 1, "heading", "body", TEXT_CONF, merge_baselines=True, text=(10,)),
        BlockPlan("p1-model-1", 1, "paragraph", "body", TEXT_CONF, text=(11,), parent="p1-h-model"),
        BlockPlan("p1-page-number", 1, "page_number", "footer", TEXT_CONF, text=(12,)),
        # ---- page 2: Figure 1 (raster), sections 3.1 and 3.2 ---------------------------------
        BlockPlan(
            "p2-figure-1",
            2,
            "figure",
            "body",
            TEXT_CONF,
            rects=((196.6, 72.0, 415.4, 394.4),),
            geometry="rect",
            parent="p1-h-model",
            source="pdf_raster",
            stage="figure-region",
            crop=("figures", 3.0, "raster"),
            payload={
                "figure_number": "1",
                "figure_kind": "diagram",
                "is_vector": False,
                "caption_block": Ref("p2-figure-1-caption"),
            },
        ),
        BlockPlan(
            "p2-figure-1-caption",
            2,
            "caption",
            "caption",
            TEXT_CONF,
            text=(1,),
            parent="p1-h-model",
        ),
        BlockPlan("p2-model-2", 2, "paragraph", "body", TEXT_CONF, text=(2,), parent="p1-h-model"),
        BlockPlan(
            "p2-h-stacks",
            2,
            "heading",
            "body",
            TEXT_CONF,
            merge_baselines=True,
            text=(3,),
            parent="p1-h-model",
        ),
        # "Encoder:" / "Decoder:" are bold run-in leads: a separate MuPDF run on the SAME baseline
        # as the prose beside them, separated by a quad space. Without merge_baselines the joiner
        # puts a "\n" between them and `text` claims a line break the page does not have.
        BlockPlan(
            "p2-encoder",
            2,
            "paragraph",
            "body",
            TEXT_CONF,
            merge_baselines=True,
            text=(4,),
            parent="p2-h-stacks",
        ),
        BlockPlan(
            "p2-decoder",
            2,
            "paragraph",
            "body",
            TEXT_CONF,
            merge_baselines=True,
            text=(5,),
            parent="p2-h-stacks",
        ),
        BlockPlan(
            "p2-h-attention",
            2,
            "heading",
            "body",
            TEXT_CONF,
            merge_baselines=True,
            text=(6,),
            parent="p1-h-model",
        ),
        BlockPlan(
            "p2-attention-1", 2, "paragraph", "body", TEXT_CONF, text=(7,), parent="p2-h-attention"
        ),
        BlockPlan("p2-page-number", 2, "page_number", "footer", TEXT_CONF, text=(8,)),
        # ---- page 3: Figure 2 (raster, two panels), equation (1), sections 3.2.1 / 3.2.2 -----
        BlockPlan(
            "p3-figure-2",
            3,
            "figure",
            "body",
            0.9,
            rects=((147.8, 71.2, 467.0, 267.3),),
            geometry="rect",
            parent="p2-h-attention",
            source="pdf_raster",
            stage="figure-region",
            crop=("figures", 3.0, "raster"),
            payload={
                "figure_number": "2",
                "figure_kind": "diagram",
                "is_vector": False,
                "caption_block": Ref("p3-figure-2-caption"),
                "panels": [
                    {
                        "label": "Scaled Dot-Product Attention",
                        "polygon": PageRect(147.8, 71.2, 266.2, 221.3),
                        "source": "pdf_raster",
                        "confidence": 0.9,
                    },
                    {
                        "label": "Multi-Head Attention",
                        "polygon": PageRect(346.8, 71.2, 467.0, 267.3),
                        "source": "pdf_raster",
                        "confidence": 0.9,
                    },
                ],
                "detected_labels": [
                    {
                        "text": "Scaled Dot-Product Attention",
                        "polygon": PageRect(147.8, 71.2, 266.2, 81.2),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "Multi-Head Attention",
                        "polygon": PageRect(363.6, 71.2, 450.2, 81.2),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                ],
            },
        ),
        BlockPlan(
            "p3-figure-2-caption",
            3,
            "caption",
            "caption",
            TEXT_CONF,
            text=(4,),
            parent="p2-h-attention",
        ),
        BlockPlan(
            "p3-attention-2", 3, "paragraph", "body", TEXT_CONF, text=(5,), parent="p2-h-attention"
        ),
        BlockPlan(
            "p3-h-sdpa",
            3,
            "heading",
            "body",
            TEXT_CONF,
            merge_baselines=True,
            text=(6,),
            parent="p2-h-attention",
        ),
        BlockPlan("p3-sdpa-1", 3, "paragraph", "body", TEXT_CONF, text=(7,), parent="p3-h-sdpa"),
        BlockPlan("p3-sdpa-2", 3, "paragraph", "body", TEXT_CONF, text=(8,), parent="p3-h-sdpa"),
        BlockPlan(
            "p3-equation-1",
            3,
            "equation",
            "body",
            0.95,
            text=(9, 10, 11),
            geometry="rect",
            parent="p3-h-sdpa",
            stage="formula-region",
            crop=("equations", 4.0, "page"),
            payload={
                "display": True,
                "equation_number": "1",
                # Hand-transcribed from the crop, which is the ground truth (ADR-001). This is a
                # declared INTERPRETATION carrying its own confidence, not a second source of text.
                "latex": (
                    "\\mathrm{Attention}(Q, K, V) = "
                    "\\mathrm{softmax}\\!\\left(\\frac{QK^{T}}{\\sqrt{d_k}}\\right)V"
                ),
                "latex_confidence": 0.95,
            },
        ),
        BlockPlan("p3-sdpa-3", 3, "paragraph", "body", TEXT_CONF, text=(12,), parent="p3-h-sdpa"),
        BlockPlan("p3-sdpa-4", 3, "paragraph", "body", TEXT_CONF, text=(13,), parent="p3-h-sdpa"),
        BlockPlan(
            "p3-h-mha",
            3,
            "heading",
            "body",
            TEXT_CONF,
            merge_baselines=True,
            text=(14,),
            parent="p2-h-attention",
        ),
        BlockPlan("p3-mha-1", 3, "paragraph", "body", TEXT_CONF, text=(15,), parent="p3-h-mha"),
        BlockPlan(
            "p3-footnote-rule",
            3,
            "unknown",
            "footnote",
            RULE_CONF,
            drawings=(7,),
            geometry="rect",
            source="pdf_vector",
            stage="vector-region",
        ),
        BlockPlan("p3-footnote-4", 3, "footnote", "footnote", MERGED_CONF, text=(16, 17)),
        BlockPlan("p3-page-number", 3, "page_number", "footer", TEXT_CONF, text=(18,)),
    ]

    return PaperPlan(
        slug="attention-is-all-you-need",
        pdf="attention-is-all-you-need.pdf",
        pages=(0, 1, 2, 3),
        page_scale=2.0,
        parser_profile="fixture-hand-checked-pages-0-3",
        blocks=tuple(blocks),
        inlines=(
            InlinePlan(
                key="p3-sdpa-1-sqrt-dk",
                parent="p3-sdpa-1",
                line=2,
                spans=(2, 5),  # the radical, "d", and the subscript "k"
                latex="\\sqrt{d_k}",
                confidence=0.92,
                latex_confidence=0.95,
            ),
        ),
        sections=(
            SectionPlan("p0-h-abstract"),
            SectionPlan("p1-h-intro"),
            SectionPlan("p1-h-background"),
            SectionPlan("p1-h-model"),
            SectionPlan("p2-h-stacks", parent="p1-h-model"),
            SectionPlan("p2-h-attention", parent="p1-h-model"),
            SectionPlan("p3-h-sdpa", parent="p2-h-attention"),
            SectionPlan("p3-h-mha", parent="p2-h-attention"),
        ),
        relations=(
            RelationPlan(
                "caption_of", "p2-figure-1-caption", "p2-figure-1", 1.0, "geometric+numbering"
            ),
            RelationPlan(
                "caption_of", "p3-figure-2-caption", "p3-figure-2", 1.0, "geometric+numbering"
            ),
            # The paragraph beginning "An attention function..." breaks across the page boundary.
            RelationPlan(
                "continues_on_next_page",
                "p2-attention-1",
                "p3-attention-2",
                0.95,
                "sentence-continuation",
            ),
            RelationPlan("footnote_of", "p3-footnote-4", "p3-sdpa-4", 0.9, "marker-numbering"),
        ),
        metadata=MetadataPlan(
            title=("p0-title", "Attention Is All You Need", 1.0),
            authors=(
                ("p0-author-1", "Ashish Vaswani", 1.0),
                ("p0-author-2", "Noam Shazeer", 1.0),
                ("p0-author-3", "Niki Parmar", 1.0),
                ("p0-author-4", "Jakob Uszkoreit", 1.0),
                ("p0-author-5", "Llion Jones", 1.0),
                ("p0-author-6", "Aidan N. Gomez", 1.0),
                ("p0-author-7", "Łukasz Kaiser", 1.0),
                ("p0-author-8", "Illia Polosukhin", 1.0),
            ),
            abstract=(("p0-abstract",), 1.0),
            venue=("p0-footer", "Neural Information Processing Systems", 0.95),
            arxiv_id=("p0-arxiv", "1706.03762", 0.98),
            year=("p0-footer", 2017, 0.95),
        ),
    )


def _neural_odes() -> PaperPlan:
    """Neural Ordinary Differential Equations (NeurIPS 2018), pages 0-2.

    WHY 0-2. This is the math-heavy fixture, so what it has to prove is that the EQUATION block
    type carries real content. Pages 0-2 are the shortest prefix that does, and they carry a great
    deal else besides: front matter and abstract, three section headings, five numbered display
    equations (1)-(5), three role-tagged inline equations nested inside their paragraphs, BOTH
    figures with linked captions, a full table with 5 rows and 24 nested cells, an algorithm
    listing, a cross-page paragraph continuation, two unclassifiable vector rules, a footnote, page
    numbers and a rotated arXiv margin stamp. Page 3 would add a fourth section and a fourth figure
    and nothing structurally new, at the cost of roughly a third more geometry to check by eye.

    LAYOUT NOTE, because it is the thing a reader most visibly breaks on. Pages 0 and 1 are NOT
    single-column: each has a two-column band in the middle of an otherwise full-measure page. On
    page 0 the left column carries the prose and equations (1) and (2) while Figure 1 floats in the
    right column; on page 1 Figure 2 floats in the LEFT column while the prose and equations (4)
    and (5) run down the right. Body reading order below is therefore left column top-to-bottom and
    then right column, before the full-measure text resumes underneath.

    WHAT IS DELIBERATELY ABSENT, and why:

    * ``EquationPayload.latex`` on the five DISPLAY equations. A hand-written LaTeX rendering of a
      two-dimensional formula is an interpretation, and PaperIR gives ``latex`` no authorship
      channel (DESIGN.md section 11.4 leans on ``image`` being the ground truth instead). Epic 1's
      F1.7 VLM step owns it. What the fixture does carry for each of them is verbatim glyph text,
      per-line spans, the equation number, and the rendered crop that ADR-001 calls the ground
      truth. The three INLINE equations do carry ``latex``: each is a handful of symbols whose
      transcription can be checked at a glance against the crop, and each states its own
      ``latex_confidence``.
    * ``cites`` relations and ``Paper.references``. The bibliography is on page 13, outside the
      range, so there is no ``reference_entry`` block for a citation to point at and semantic rule
      23 would reject an invented one.
    * ``continues_in_next_column``. No paragraph in these three pages actually runs from the foot
      of one column into the head of the next - the columns hold different material - and inventing
      the relation to exercise rule 24b would be a lie about the page.

    The MuPDF text-block and drawing coordinates below are for this exact PDF, checked against
    2x page renders with every polygon overlaid (``--overlay``).
    """
    #: Table 1 on page 2: (row, column, MuPDF line, is a header cell). The top-left corner cell of
    #: the grid is genuinely empty, so there is no cell for (0, 0) rather than an invented one.
    table_cells: tuple[tuple[int, int, tuple[int, int], bool], ...] = (
        (0, 1, (15, 0), True),
        (0, 2, (15, 1), True),
        (0, 3, (15, 2), True),
        (0, 4, (15, 3), True),
        (1, 0, (16, 0), False),
        (1, 1, (16, 1), False),
        (1, 2, (16, 2), False),
        (1, 3, (16, 3), False),
        (1, 4, (16, 4), False),
        (2, 0, (16, 5), False),
        (2, 1, (16, 6), False),
        (2, 2, (16, 7), False),
        (2, 3, (16, 8), False),
        (2, 4, (16, 9), False),
        (3, 0, (16, 10), False),
        (3, 1, (16, 11), False),
        (3, 2, (16, 12), False),
        (3, 3, (16, 13), False),
        (3, 4, (16, 14), False),
        (4, 0, (16, 15), False),
        (4, 1, (16, 16), False),
        (4, 2, (16, 17), False),
        (4, 3, (16, 18), False),
        (4, 4, (16, 19), False),
    )

    #: Per-row lower clamp for Table 1, in IR points. The Memory and Time columns are set in
    #: CMSY/CMR at a size whose font descent runs ~5.7 pt below the ink of "O(L)", so MuPDF hands
    #: back a line box that reaches into the NEXT row: unclamped, row 2's polygon encloses row 3's
    #: tilde accents and row 2's Memory cell encloses part of row 3's. Each bound below is the
    #: bottom of the LOWEST GLYPH BOX actually in that row, read off `get_text("rawdict")` char
    #: boxes: row 2 ")" ends at 595.17, row 3 ")" at 605.13, row 4 ")" at 615.08. Rows 0, 1 and the
    #: purely textual columns need no clamp - their line boxes already stop at their own ink.
    row_clip_bottom: dict[int, float] = {2: 595.17, 3: 605.13, 4: 615.08}

    def cell_key(r: int, c: int) -> str:
        return f"p2-t1-r{r}c{c}"

    def clip_for(r: int) -> tuple[float, float] | None:
        bottom = row_clip_bottom.get(r)
        return None if bottom is None else (0.0, bottom)

    table_blocks: list[BlockPlan] = []
    for r in range(5):
        members = [spec for spec in table_cells if spec[0] == r]
        # The row's own region and text are DERIVED from its cells, so there is no hand-written
        # rectangle to drift. D14: rows nest inside the table, cells inside the row, and neither
        # appears in Page.flows or carries a doc_order.
        table_blocks.append(
            BlockPlan(
                f"p2-t1-row{r}",
                2,
                "table_row",
                "body",
                TEXT_CONF,
                text=tuple(spec[2] for spec in members),
                geometry="rect",
                parent="p2-table1",
                stage="table-grid",
                clip_y=clip_for(r),
            )
        )
        table_blocks += [
            BlockPlan(
                cell_key(r, c),
                2,
                "table_cell",
                "body",
                TEXT_CONF,
                text=(line,),
                clip_y=clip_for(r),
                parent=f"p2-t1-row{r}",
                stage="table-grid",
            )
            for (_, c, line, _) in members
        ]

    grid_cells = [
        {
            "cell_id": Ref(cell_key(r, c)),
            "r": r,
            "c": c,
            "polygon": RefPolygon(cell_key(r, c)),
            **({"is_header": True} if header else {}),
        }
        for (r, c, _, header) in table_cells
    ]

    blocks: list[BlockPlan] = [
        # ---- page 0: front matter (belongs to NO section - DESIGN.md section 4) --------------
        BlockPlan(
            "p0-rule-above-title",
            0,
            "unknown",
            "body",
            RULE_CONF,
            rects=((108.0, 79.2, 504.0, 83.18),),
            geometry="rect",
            source="pdf_vector",
            stage="vector-region",
        ),
        BlockPlan("p0-title", 0, "title", "body", TEXT_CONF, text=(0,)),
        # A stroked hairline: zero height as MuPDF reports it, inflated here by its 0.996 pt stroke
        # width, because a zero-area polygon is a rule G6 ERROR and the ink really is that wide.
        BlockPlan(
            "p0-rule-below-title",
            0,
            "unknown",
            "body",
            RULE_CONF,
            rects=((108.0, 131.94, 504.0, 132.94),),
            geometry="rect",
            source="pdf_vector",
            stage="vector-region",
        ),
        BlockPlan("p0-authors", 0, "author", "body", TEXT_CONF, text=(1,)),
        BlockPlan("p0-affiliation", 0, "affiliation", "body", TEXT_CONF, text=(2,)),
        BlockPlan("p0-abstract-heading", 0, "heading", "body", TEXT_CONF, text=(3,)),
        BlockPlan("p0-abstract", 0, "abstract", "body", TEXT_CONF, text=(4,)),
        # ---- page 0: section 1 ---------------------------------------------------------------
        # MuPDF puts "1", "Introduction" and the two figure panel labels in one text block; only
        # the first two lines are the heading, and merge_baselines joins them into one visual line.
        BlockPlan(
            "s1-heading",
            0,
            "heading",
            "body",
            MERGED_CONF,
            text=((5, 0), (5, 1)),
            merge_baselines=True,
        ),
        BlockPlan("p0-para-1", 0, "paragraph", "body", TEXT_CONF, text=(23,), parent="s1-heading"),
        # The "(1)" tag is a REGION of the equation, not part of its text: it is recorded once, in
        # payload.equation_number. Same for (2)-(5) below.
        BlockPlan(
            "p0-eq-1",
            0,
            "equation",
            "body",
            TEXT_CONF,
            text=((24, 0),),
            rects=((304.2, 459.2, 315.8, 469.2),),
            geometry="rect",
            parent="s1-heading",
            stage="formula-region",
            payload={"display": True, "equation_number": "1", "image": None},
            crop=("equations", 6.0, "page"),
        ),
        BlockPlan("p0-para-2", 0, "paragraph", "body", TEXT_CONF, text=(25,), parent="s1-heading"),
        BlockPlan("p0-para-3", 0, "paragraph", "body", TEXT_CONF, text=(26,), parent="s1-heading"),
        BlockPlan(
            "p0-eq-2",
            0,
            "equation",
            "body",
            MERGED_CONF,
            text=((27, 0), (28, 0), (28, 1)),
            rects=((304.2, 581.0, 315.8, 590.9),),
            geometry="rect",
            parent="s1-heading",
            stage="formula-region",
            payload={"display": True, "equation_number": "2", "image": None},
            crop=("equations", 6.0, "page"),
        ),
        # Figure 1 floats in the RIGHT column and is therefore read after the whole left column.
        # All-vector: both panels are drawing operations, and the axis labels inside the region are
        # part of the figure rather than blocks of their own.
        BlockPlan(
            "p0-fig-1",
            0,
            "figure",
            "body",
            FIGURE_CONF,
            rects=((322.5, 394.5, 505.5, 521.5),),
            geometry="rect",
            source="pdf_vector",
            stage="figure-region",
            parent="s1-heading",
            payload={
                "figure_number": "1",
                "figure_kind": "plot",
                "is_vector": True,
                "caption_block": Ref("p0-caption-fig1"),
                "image": None,
            },
            crop=("figures", 3.0, "page"),
        ),
        BlockPlan(
            "p0-caption-fig1",
            0,
            "caption",
            "caption",
            MERGED_CONF,
            text=(22,),
            merge_baselines=True,
            parent="s1-heading",
        ),
        BlockPlan("p0-para-4", 0, "paragraph", "body", TEXT_CONF, text=(29,), parent="s1-heading"),
        BlockPlan("p0-para-5", 0, "paragraph", "body", TEXT_CONF, text=(30,), parent="s1-heading"),
        BlockPlan(
            "p0-para-6",
            0,
            "paragraph",
            "body",
            MERGED_CONF,
            text=(31,),
            merge_baselines=True,
            parent="s1-heading",
        ),
        # Page furniture: in no section, and out of the body flow so a continuous reader and the
        # audiobook never walk into it.
        BlockPlan("p0-footnote", 0, "footnote", "footnote", TEXT_CONF, text=(32,)),
        BlockPlan("p0-arxiv", 0, "annotation", "margin", TEXT_CONF, text=(33,)),
        # ---- page 1: the rest of section 1 -----------------------------------------------------
        BlockPlan(
            "p1-para-7",
            1,
            "paragraph",
            "body",
            MERGED_CONF,
            text=(0,),
            merge_baselines=True,
            parent="s1-heading",
        ),
        BlockPlan(
            "p1-para-8",
            1,
            "paragraph",
            "body",
            MERGED_CONF,
            text=(1,),
            merge_baselines=True,
            parent="s1-heading",
        ),
        BlockPlan(
            "p1-para-9",
            1,
            "paragraph",
            "body",
            MERGED_CONF,
            text=(2,),
            merge_baselines=True,
            parent="s1-heading",
        ),
        # ---- page 1: section 2 -----------------------------------------------------------------
        BlockPlan(
            "s2-heading",
            1,
            "heading",
            "body",
            MERGED_CONF,
            text=((3, 0), (3, 1)),
            merge_baselines=True,
        ),
        BlockPlan("p1-para-10", 1, "paragraph", "body", TEXT_CONF, text=(4,), parent="s2-heading"),
        BlockPlan("p1-para-11", 1, "paragraph", "body", TEXT_CONF, text=(5,), parent="s2-heading"),
        BlockPlan("p1-para-12", 1, "paragraph", "body", TEXT_CONF, text=(6,), parent="s2-heading"),
        # Equation (3) runs the full measure. MuPDF blocks 8 and 13 are the two large delimiters,
        # which extract as the control characters U+0012/U+0013: real ink, not text, so they are
        # regions here and are deliberately absent from Block.text.
        BlockPlan(
            "p1-eq-3",
            1,
            "equation",
            "body",
            MERGED_CONF,
            text=((7, 0), (9, 0), (10, 0), (11, 0), (12, 0), (14, 0)),
            rects=(
                (201.5, 396.0, 208.9, 406.0),
                (315.9, 396.0, 323.2, 406.0),
                (492.4, 403.1, 504.0, 413.1),
            ),
            geometry="rect",
            parent="s2-heading",
            stage="formula-region",
            payload={"display": True, "equation_number": "3", "image": None},
            crop=("equations", 6.0, "page"),
        ),
        # Figure 2 floats in the LEFT column here, so it is read BEFORE the right-column prose.
        # Vector arrows and curves with the maths labels placed as small rasters; `is_vector` names
        # the drawing content and `source` the dominant extraction path (DESIGN.md D20).
        BlockPlan(
            "p1-fig-2",
            1,
            "figure",
            "body",
            FIGURE_CONF,
            rects=((107.5, 425.0, 315.5, 573.0),),
            geometry="rect",
            source="pdf_vector",
            stage="figure-region",
            parent="s2-heading",
            payload={
                "figure_number": "2",
                "figure_kind": "diagram",
                "is_vector": True,
                "caption_block": Ref("p1-caption-fig2"),
                "image": None,
            },
            crop=("figures", 3.0, "page"),
        ),
        BlockPlan(
            "p1-caption-fig2",
            1,
            "caption",
            "caption",
            TEXT_CONF,
            text=(34,),
            parent="s2-heading",
        ),
        BlockPlan("p1-para-13", 1, "paragraph", "body", TEXT_CONF, text=(35,), parent="s2-heading"),
        BlockPlan(
            "p1-eq-4",
            1,
            "equation",
            "body",
            MERGED_CONF,
            text=((36, 0), (37, 0), (37, 1), (38, 0)),
            rects=((492.4, 515.3, 504.0, 525.3),),
            geometry="rect",
            parent="s2-heading",
            stage="formula-region",
            payload={"display": True, "equation_number": "4", "image": None},
            crop=("equations", 6.0, "page"),
        ),
        BlockPlan("p1-para-14", 1, "paragraph", "body", TEXT_CONF, text=(39,), parent="s2-heading"),
        BlockPlan("p1-para-15", 1, "paragraph", "body", TEXT_CONF, text=(40,), parent="s2-heading"),
        BlockPlan(
            "p1-eq-5",
            1,
            "equation",
            "body",
            MERGED_CONF,
            text=((41, 0), (42, 0), (43, 0), (44, 0), (45, 0), (46, 0), (46, 1)),
            rects=((492.4, 675.5, 504.0, 685.4),),
            geometry="rect",
            parent="s2-heading",
            stage="formula-region",
            payload={"display": True, "equation_number": "5", "image": None},
            crop=("equations", 6.0, "page"),
        ),
        # The full-measure paragraph at the foot of page 1, which runs on into page 2.
        BlockPlan(
            "p1-para-16",
            1,
            "paragraph",
            "body",
            MERGED_CONF,
            text=((47, 0), (48, 0), (49, 0), (49, 1)),
            parent="s2-heading",
        ),
        BlockPlan("p1-pagenum", 1, "page_number", "footer", TEXT_CONF, text=(50,)),
        # ---- page 2: the rest of section 2 -----------------------------------------------------
        BlockPlan(
            "p2-para-17",
            2,
            "paragraph",
            "body",
            MERGED_CONF,
            text=((0, 0), (1, 0), (1, 1), (1, 2)),
            parent="s2-heading",
        ),
        # Algorithm 1. MuPDF shreds the listing into seven text blocks because every fraction is
        # its own run; the reading order below was read off the page line by line. The rectangle is
        # the ruled frame (the three stroked rules at y=120.01, 133.61 and 222.59).
        BlockPlan(
            "p2-algorithm",
            2,
            "algorithm",
            "body",
            MERGED_CONF,
            text=(
                (2, 0),
                (3, 0),
                (4, 0),
                (4, 1),
                (4, 2),
                (4, 3),
                (4, 4),
                (4, 5),
                (4, 6),
                (5, 0),
                (6, 0),
                (6, 1),
                (6, 2),
                (6, 3),
                (6, 4),
                (7, 0),
                (7, 1),
                (7, 2),
                (7, 3),
                (7, 4),
                (8, 0),
                (8, 1),
            ),
            rects=((107.6, 119.6, 504.0, 222.8),),
            geometry="rect",
            parent="s2-heading",
            stage="layout+text",
        ),
        BlockPlan("p2-para-18", 2, "paragraph", "body", TEXT_CONF, text=(9,), parent="s2-heading"),
        BlockPlan("p2-para-19", 2, "paragraph", "body", TEXT_CONF, text=(10,), parent="s2-heading"),
        # ---- page 2: section 3 -----------------------------------------------------------------
        BlockPlan(
            "s3-heading",
            2,
            "heading",
            "body",
            MERGED_CONF,
            text=((11, 0), (11, 1)),
            merge_baselines=True,
        ),
        BlockPlan("p2-para-20", 2, "paragraph", "body", TEXT_CONF, text=(12,), parent="s3-heading"),
        BlockPlan(
            "p2-para-21",
            2,
            "paragraph",
            "body",
            MERGED_CONF,
            text=(13,),
            merge_baselines=True,
            parent="s3-heading",
        ),
        # Left column, and it wraps back to the full measure UNDER the table - so its staircase
        # polygon is L-shaped, which is exactly what union_of_line_rects is for.
        BlockPlan(
            "p2-para-22",
            2,
            "paragraph",
            "body",
            MERGED_CONF,
            text=(17,),
            merge_baselines=True,
            parent="s3-heading",
        ),
        # Table 1 floats in the right column, read after the left column. The rectangle spans the
        # three stroked rules (x 307.99-509.67, y 562.41-617.4) grown to the last row's glyph boxes.
        BlockPlan(
            "p2-table1",
            2,
            "table",
            "body",
            MERGED_CONF,
            rects=((307.99, 562.09, 509.67, 620.75),),
            geometry="rect",
            parent="s3-heading",
            stage="table-region",
            payload={
                "table_number": "1",
                "caption_block": Ref("p2-caption-table1"),
                "grid": {"rows": 5, "cols": 5, "cells": grid_cells},
            },
        ),
        *table_blocks,
        BlockPlan(
            "p2-caption-table1",
            2,
            "caption",
            "caption",
            TEXT_CONF,
            text=(14,),
            parent="s3-heading",
        ),
        BlockPlan(
            "p2-para-23",
            2,
            "paragraph",
            "body",
            MERGED_CONF,
            text=(18,),
            merge_baselines=True,
            parent="s3-heading",
        ),
        BlockPlan("p2-pagenum", 2, "page_number", "footer", TEXT_CONF, text=(19,)),
    ]

    return PaperPlan(
        slug="neural-odes-mathheavy",
        pdf="neural-odes-mathheavy.pdf",
        pages=(0, 1, 2),
        page_scale=2.0,
        parser_profile="hand-checked-golden-fixture:neural-odes-mathheavy:pages-0-2",
        status="partial",
        partial_reason=(
            "Golden fixture: only pages 0-2 of the 18-page source PDF are parsed. Paper.pages "
            "therefore describes three pages and nothing else in the document records that the "
            "other fifteen exist, which is what makes this a PARTIAL parse rather than a complete "
            'one. Every other obligation of status "complete" is met anyway: no confidence is '
            "null (rule 13b) and every equation and figure carries a rendered crop (rule 36). "
            "References are empty because the bibliography is on page 13. See "
            "packages/document-ir/fixtures/README.md."
        ),
        blocks=tuple(blocks),
        inlines=(
            # The adjoint, which is the paper's central definition, and the two places the
            # partial derivative it names is used again.
            InlinePlan("p1-ieq-zt", "p1-para-13", 3, (0, 4), "z(t)", TEXT_CONF, 0.95),
            InlinePlan(
                "p1-ieq-adjoint",
                "p1-para-13",
                4,
                (6, 13),
                r"\partial L / \partial z(t)",
                TEXT_CONF,
                0.9,
            ),
            InlinePlan(
                "p1-ieq-dldz0",
                "p1-para-14",
                0,
                (2, 10),
                r"\partial L / \partial z(t_0)",
                TEXT_CONF,
                0.9,
            ),
        ),
        # Flat, and honestly so: pages 0-2 contain no numbered subsection, so there is nothing for
        # parent_heading_block_id to point at. The bold run-in labels ("Memory efficiency",
        # "Software", "Model Architectures") are lead-ins inside a paragraph, not headings.
        sections=(
            SectionPlan("s1-heading"),
            SectionPlan("s2-heading"),
            SectionPlan("s3-heading"),
        ),
        relations=(
            RelationPlan("caption_of", "p0-caption-fig1", "p0-fig-1", 1.0, "geometric+numbering"),
            RelationPlan("caption_of", "p1-caption-fig2", "p1-fig-2", 1.0, "geometric+numbering"),
            RelationPlan(
                "caption_of", "p2-caption-table1", "p2-table1", 1.0, "geometric+numbering"
            ),
            # "...All integrals for solving z, a" / "and dL/dtheta can be computed in a single
            # call..." - one sentence broken by the page break.
            RelationPlan(
                "continues_on_next_page", "p1-para-16", "p2-para-17", 1.0, "text-continuity"
            ),
        ),
        metadata=MetadataPlan(
            title=("p0-title", "Neural Ordinary Differential Equations", 1.0),
            authors=(
                ("p0-authors", "Ricky T. Q. Chen", 1.0),
                ("p0-authors", "Yulia Rubanova", 1.0),
                ("p0-authors", "Jesse Bettencourt", 1.0),
                ("p0-authors", "David Duvenaud", 1.0),
            ),
            abstract=(("p0-abstract",), 1.0),
            venue=("p0-footnote", "Neural Information Processing Systems (NeurIPS 2018)", 0.95),
            arxiv_id=("p0-arxiv", "1806.07366", 0.98),
            year=("p0-footnote", 2018, 0.95),
        ),
    )


def _resnet() -> PaperPlan:
    """Deep Residual Learning for Image Recognition (arXiv 1512.03385), pages 0-2.

    Why 0-2: the shortest prefix that clears the F0.7 bar while staying genuinely hand-checkable.
    findings.md section H2 records the live v1 path finding ZERO figures in this paper while its
    figures are ALL VECTOR - no embedded raster on any page - so getting a vector figure into a
    fixture with its caption linked is the single most valuable thing this feature does. These
    three pages carry BOTH of the paper's early vector figures (Figure 1 on page 0, Figure 2 on
    page 1) with their captions and their in-figure labels, both residual-mapping display equations
    (1) and (2), an inline equation located by a role-tagged span, two levels of numbered section
    hierarchy (3 / 3.1 / 3.2 / 3.3), a two-column reading order interrupted by a float, two column
    continuations, two page continuations, footnotes, page numbers, the arXiv margin stamp and two
    unclassifiable vector rules.

    Page 3 was deliberately left out: it is one ~100-label network diagram whose labels would
    double the fixture's size without exercising anything the first three pages do not.

    The MuPDF text-block and drawing indices below are for this exact PDF. ``--check`` fails loudly
    if any of them stops pointing at what the plan says it does.
    """
    blocks: list[BlockPlan] = [
        # ---- page 0: front matter, abstract, section 1, Figure 1 (vector) --------------------
        BlockPlan("p0-title", 0, "title", "body", TEXT_CONF, text=(0,)),
        # Four names share one baseline, so MuPDF reports them as four lines of one block. They
        # are four authors and are emitted as four blocks, left to right.
        BlockPlan("p0-author-1", 0, "author", "body", TEXT_CONF, text=((1, 0),)),
        BlockPlan("p0-author-2", 0, "author", "body", TEXT_CONF, text=((1, 1),)),
        BlockPlan("p0-author-3", 0, "author", "body", TEXT_CONF, text=((1, 2),)),
        BlockPlan("p0-author-4", 0, "author", "body", TEXT_CONF, text=((1, 3),)),
        BlockPlan(
            "p0-affiliation",
            0,
            "affiliation",
            "body",
            MERGED_CONF,
            text=((1, 4), (1, 5)),
            line_gap_pt=6.0,
        ),
        BlockPlan("p0-h-abstract", 0, "heading", "body", TEXT_CONF, text=(2,)),
        BlockPlan(
            "p0-abstract-1", 0, "abstract", "body", TEXT_CONF, text=(3,), parent="p0-h-abstract"
        ),
        BlockPlan(
            "p0-abstract-2", 0, "abstract", "body", TEXT_CONF, text=(4,), parent="p0-h-abstract"
        ),
        BlockPlan("p0-h-intro", 0, "heading", "body", TEXT_CONF, text=(5,)),
        BlockPlan("p0-intro-1", 0, "paragraph", "body", TEXT_CONF, text=(6,), parent="p0-h-intro"),
        # The rule above the footnotes: a stroked hairline and nothing more. No parser can say what
        # it means, so it is emitted as `unknown` WITH ITS GEOMETRY rather than dropped.
        BlockPlan(
            "p0-footnote-rule",
            0,
            "unknown",
            "footnote",
            RULE_CONF,
            drawings=(0,),
            geometry="rect",
            source="pdf_vector",
            stage="vector-region",
        ),
        BlockPlan(
            "p0-footnote-1", 0, "footnote", "footnote", TEXT_CONF, text=(7,), parent="p0-h-abstract"
        ),
        # THE headline block of this fixture: an all-vector figure recovered from 58 drawing
        # groups, zero embedded rasters, with its caption linked by a caption_of relation.
        BlockPlan(
            "p0-figure-1",
            0,
            "figure",
            "body",
            FIGURE_CONF,
            drawings=tuple(range(1, 59)),
            geometry="rect",
            parent="p0-h-intro",
            source="pdf_vector",
            stage="vector-figure",
            crop=("figures", 4.0, "vector"),
            payload={
                "figure_number": "1",
                "figure_kind": "plot",
                "is_vector": True,
                "caption_block": Ref("p0-figure-1-caption"),
                "panels": [
                    {
                        "label": "training error",
                        "polygon": PageRect(308.86, 224.40, 434.70, 302.40),
                        "source": "pdf_vector",
                        "confidence": 0.9,
                    },
                    {
                        "label": "test error",
                        "polygon": PageRect(424.80, 224.40, 545.11, 302.40),
                        "source": "pdf_vector",
                        "confidence": 0.9,
                    },
                ],
                "detected_labels": [
                    {
                        "text": "20",
                        "polygon": PageRect(316.26, 224.89, 319.60, 228.23),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "20",
                        "polygon": PageRect(438.09, 224.89, 441.43, 228.23),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "training error (%)",
                        "polygon": PageRect(308.98, 235.53, 315.53, 282.12),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "56-layer",
                        "polygon": PageRect(521.65, 240.43, 543.58, 247.02),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "test error (%)",
                        "polygon": PageRect(430.81, 241.30, 437.36, 276.51),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "20-layer",
                        "polygon": PageRect(521.65, 252.37, 543.58, 258.95),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "10",
                        "polygon": PageRect(316.26, 257.37, 319.60, 260.71),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "10",
                        "polygon": PageRect(438.09, 257.37, 441.43, 260.71),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "56-layer",
                        "polygon": PageRect(400.26, 263.25, 422.19, 269.84),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "20-layer",
                        "polygon": PageRect(400.26, 278.70, 422.19, 285.28),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "0",
                        "polygon": PageRect(317.05, 289.93, 319.56, 293.27),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "0",
                        "polygon": PageRect(439.76, 289.93, 441.43, 293.27),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "0",
                        "polygon": PageRect(319.34, 292.13, 321.01, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "1",
                        "polygon": PageRect(335.22, 292.13, 336.89, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "2",
                        "polygon": PageRect(351.20, 292.13, 352.87, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "3",
                        "polygon": PageRect(367.08, 292.13, 368.75, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "4",
                        "polygon": PageRect(383.06, 292.13, 384.73, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "5",
                        "polygon": PageRect(399.03, 292.13, 400.70, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "6",
                        "polygon": PageRect(414.92, 292.13, 416.59, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "0",
                        "polygon": PageRect(441.16, 292.13, 442.83, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "1",
                        "polygon": PageRect(457.05, 292.13, 458.72, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "2",
                        "polygon": PageRect(473.02, 292.13, 474.69, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "3",
                        "polygon": PageRect(488.91, 292.13, 490.58, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "4",
                        "polygon": PageRect(504.88, 292.13, 506.55, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "5",
                        "polygon": PageRect(520.86, 292.13, 522.53, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "6",
                        "polygon": PageRect(536.75, 292.13, 538.42, 295.47),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "iter. (1e4)",
                        "polygon": PageRect(357.87, 295.64, 383.92, 302.20),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "iter. (1e4)",
                        "polygon": PageRect(479.69, 295.64, 505.75, 302.20),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                ],
            },
        ),
        BlockPlan(
            "p0-figure-1-caption",
            0,
            "caption",
            "caption",
            TEXT_CONF,
            text=(26,),
            parent="p0-h-intro",
        ),
        BlockPlan(
            "p0-intro-1-cont", 0, "paragraph", "body", TEXT_CONF, text=(27,), parent="p0-h-intro"
        ),
        # One line of this paragraph ends a sentence mid-measure, so the next fragment sits on the
        # same baseline with no x-overlap; 2.0 pt of slack is a hair too tight to bridge it.
        BlockPlan(
            "p0-intro-2",
            0,
            "paragraph",
            "body",
            TEXT_CONF,
            text=(28,),
            parent="p0-h-intro",
            line_gap_pt=2.5,
        ),
        BlockPlan("p0-intro-3", 0, "paragraph", "body", TEXT_CONF, text=(29,), parent="p0-h-intro"),
        BlockPlan("p0-intro-4", 0, "paragraph", "body", TEXT_CONF, text=(30,), parent="p0-h-intro"),
        BlockPlan("p0-page-number", 0, "page_number", "footer", TEXT_CONF, text=(31,)),
        BlockPlan("p0-arxiv", 0, "margin_note", "margin", TEXT_CONF, text=(32,)),
        # ---- page 1: Figure 2 (vector), rest of section 1, section 2 --------------------------
        BlockPlan(
            "p1-figure-2",
            1,
            "figure",
            "body",
            FIGURE_CONF,
            drawings=tuple(range(0, 16)),
            # The drawing operations stop at the arrow head; the "F(x)", "x" and "identity" labels
            # sit outside them, so the float's region is the union of the two.
            rects=((98.28, 78.40, 231.58, 155.84),),
            geometry="rect",
            parent="p0-h-intro",
            source="pdf_vector",
            stage="vector-figure",
            crop=("figures", 4.0, "vector"),
            payload={
                "figure_number": "2",
                "figure_kind": "diagram",
                "is_vector": True,
                "caption_block": Ref("p1-figure-2-caption"),
                "detected_labels": [
                    {
                        "text": "x",
                        "polygon": PageRect(142.92, 78.40, 148.52, 87.65),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "weight layer",
                        "polygon": PageRect(137.35, 95.47, 173.63, 102.77),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "relu",
                        "polygon": PageRect(159.13, 106.32, 172.22, 114.49),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "F(x)",
                        "polygon": PageRect(98.28, 106.78, 117.70, 122.82),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "x",
                        "polygon": PageRect(215.31, 111.81, 220.91, 121.05),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "weight layer",
                        "polygon": PageRect(137.35, 119.98, 173.63, 127.28),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "identity",
                        "polygon": PageRect(205.97, 123.64, 231.58, 131.81),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    # MinionPro's thin space is encoded as U+0001 in this glyph stream; it renders
                    # as a space and is transcribed as one.
                    {
                        "text": "F(x) + x",
                        "polygon": PageRect(106.92, 139.80, 143.33, 155.84),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                    {
                        "text": "relu",
                        "polygon": PageRect(159.13, 146.19, 172.22, 154.36),
                        "source": "pdf_text_layer",
                        "confidence": 1.0,
                    },
                ],
            },
        ),
        BlockPlan(
            "p1-figure-2-caption",
            1,
            "caption",
            "caption",
            TEXT_CONF,
            text=(7,),
            parent="p0-h-intro",
        ),
        BlockPlan("p1-intro-5", 1, "paragraph", "body", TEXT_CONF, text=(8,), parent="p0-h-intro"),
        BlockPlan("p1-intro-6", 1, "paragraph", "body", TEXT_CONF, text=(9,), parent="p0-h-intro"),
        BlockPlan("p1-intro-7", 1, "paragraph", "body", TEXT_CONF, text=(10,), parent="p0-h-intro"),
        BlockPlan("p1-intro-8", 1, "paragraph", "body", TEXT_CONF, text=(11,), parent="p0-h-intro"),
        BlockPlan("p1-intro-9", 1, "paragraph", "body", TEXT_CONF, text=(12,), parent="p0-h-intro"),
        BlockPlan(
            "p1-intro-10", 1, "paragraph", "body", TEXT_CONF, text=(13,), parent="p0-h-intro"
        ),
        BlockPlan(
            "p1-intro-11", 1, "paragraph", "body", TEXT_CONF, text=(14,), parent="p0-h-intro"
        ),
        BlockPlan("p1-h-related", 1, "heading", "body", TEXT_CONF, text=(15,)),
        BlockPlan(
            "p1-related-1", 1, "paragraph", "body", TEXT_CONF, text=(16,), parent="p1-h-related"
        ),
        BlockPlan(
            "p1-related-2", 1, "paragraph", "body", TEXT_CONF, text=(17,), parent="p1-h-related"
        ),
        BlockPlan(
            "p1-related-3", 1, "paragraph", "body", TEXT_CONF, text=(18,), parent="p1-h-related"
        ),
        BlockPlan(
            "p1-related-4", 1, "paragraph", "body", TEXT_CONF, text=(19,), parent="p1-h-related"
        ),
        BlockPlan("p1-page-number", 1, "page_number", "footer", TEXT_CONF, text=(20,)),
        # ---- page 2: sections 3 / 3.1 / 3.2 / 3.3, equations (1) and (2) ----------------------
        BlockPlan(
            "p2-related-5", 2, "paragraph", "body", TEXT_CONF, text=(0,), parent="p1-h-related"
        ),
        BlockPlan("p2-h-s3", 2, "heading", "body", TEXT_CONF, text=(1,)),
        BlockPlan("p2-h-s31", 2, "heading", "body", TEXT_CONF, text=(2,), parent="p2-h-s3"),
        BlockPlan("p2-s31-1", 2, "paragraph", "body", TEXT_CONF, text=(3,), parent="p2-h-s31"),
        BlockPlan("p2-s31-2", 2, "paragraph", "body", TEXT_CONF, text=(4,), parent="p2-h-s31"),
        BlockPlan("p2-s31-3", 2, "paragraph", "body", TEXT_CONF, text=(5,), parent="p2-h-s31"),
        BlockPlan("p2-h-s32", 2, "heading", "body", TEXT_CONF, text=(6,), parent="p2-h-s3"),
        BlockPlan("p2-s32-1", 2, "paragraph", "body", TEXT_CONF, text=(7,), parent="p2-h-s32"),
        BlockPlan(
            "p2-equation-1",
            2,
            "equation",
            "body",
            # The region deliberately includes the right-aligned equation number, which is a
            # judgement about the float's extent rather than a fact the text layer states.
            0.95,
            text=(8,),
            geometry="rect",
            parent="p2-h-s32",
            stage="formula-region",
            crop=("equations", 6.0, "page"),
            payload={
                "display": True,
                "equation_number": "1",
                # Hand-transcribed from the crop, which ADR-001 calls the ground truth. A declared
                # INTERPRETATION carrying its own confidence, not a second source of text.
                "latex": "\\mathbf{y} = \\mathcal{F}(\\mathbf{x}, \\{W_i\\}) + \\mathbf{x}",
                "latex_confidence": 0.95,
            },
        ),
        BlockPlan("p2-s32-2", 2, "paragraph", "body", TEXT_CONF, text=(9,), parent="p2-h-s32"),
        BlockPlan(
            "p2-footnote-rule",
            2,
            "unknown",
            "footnote",
            RULE_CONF,
            drawings=(0,),
            geometry="rect",
            source="pdf_vector",
            stage="vector-region",
        ),
        BlockPlan(
            "p2-footnote-2", 2, "footnote", "footnote", TEXT_CONF, text=(10,), parent="p2-h-s31"
        ),
        BlockPlan("p2-s32-3", 2, "paragraph", "body", TEXT_CONF, text=(11,), parent="p2-h-s32"),
        BlockPlan("p2-s32-4", 2, "paragraph", "body", TEXT_CONF, text=(12,), parent="p2-h-s32"),
        BlockPlan("p2-s32-5", 2, "paragraph", "body", TEXT_CONF, text=(13,), parent="p2-h-s32"),
        BlockPlan(
            "p2-equation-2",
            2,
            "equation",
            "body",
            0.95,
            text=(14,),
            geometry="rect",
            parent="p2-h-s32",
            stage="formula-region",
            crop=("equations", 6.0, "page"),
            payload={
                "display": True,
                "equation_number": "2",
                "latex": "\\mathbf{y} = \\mathcal{F}(\\mathbf{x}, \\{W_i\\}) + W_s\\mathbf{x}",
                "latex_confidence": 0.95,
            },
        ),
        BlockPlan("p2-s32-6", 2, "paragraph", "body", TEXT_CONF, text=(15,), parent="p2-h-s32"),
        BlockPlan("p2-s32-7", 2, "paragraph", "body", TEXT_CONF, text=(16,), parent="p2-h-s32"),
        BlockPlan("p2-s32-8", 2, "paragraph", "body", TEXT_CONF, text=(17,), parent="p2-h-s32"),
        BlockPlan("p2-h-s33", 2, "heading", "body", TEXT_CONF, text=(18,), parent="p2-h-s3"),
        BlockPlan("p2-s33-1", 2, "paragraph", "body", TEXT_CONF, text=(19,), parent="p2-h-s33"),
        BlockPlan("p2-s33-2", 2, "paragraph", "body", TEXT_CONF, text=(20,), parent="p2-h-s33"),
        BlockPlan("p2-s33-3", 2, "paragraph", "body", TEXT_CONF, text=(21,), parent="p2-h-s33"),
        BlockPlan("p2-page-number", 2, "page_number", "footer", TEXT_CONF, text=(22,)),
    ]

    return PaperPlan(
        slug="resnet-cvpr-2col",
        pdf="resnet-cvpr-2col.pdf",
        pages=(0, 1, 2),
        page_scale=2.0,
        parser_profile="fixture-hand-checked-pages-0-2",
        blocks=tuple(blocks),
        inlines=(
            # "y = W_1 x + x", the single-layer degenerate case of Eqn.(1).
            #
            # Chosen over the more iconic "F(x) := H(x) - x" two paragraphs earlier for a geometric
            # reason, and the choice was made by LOOKING AT THE RENDERED CROP: MuPDF reports a
            # CMSY10 span's box as the FONT's bounding box, not the glyph's, so any run containing
            # the calligraphic F or H comes back ~7 pt taller than its line and its crop catches
            # the top of the following line. This run is CMBX10/CMR10/CMMI10/CMR7 only, so its
            # polygon is the typographic line band and its crop is exactly the equation.
            InlinePlan(
                key="p2-s32-7-linear-layer",
                parent="p2-s32-7",
                line=4,
                spans=(0, 7),
                latex="\\mathbf{y} = W_1\\mathbf{x} + \\mathbf{x}",
                confidence=0.92,
                latex_confidence=0.95,
            ),
        ),
        sections=(
            SectionPlan("p0-h-abstract"),
            SectionPlan("p0-h-intro"),
            SectionPlan("p1-h-related"),
            SectionPlan("p2-h-s3"),
            SectionPlan("p2-h-s31", parent="p2-h-s3"),
            SectionPlan("p2-h-s32", parent="p2-h-s3"),
            SectionPlan("p2-h-s33", parent="p2-h-s3"),
        ),
        relations=(
            RelationPlan(
                "caption_of", "p0-figure-1-caption", "p0-figure-1", 1.0, "geometric+numbering"
            ),
            RelationPlan(
                "caption_of", "p1-figure-2-caption", "p1-figure-2", 1.0, "geometric+numbering"
            ),
            # A float at the top of the right column interrupts a paragraph mid-sentence. This is
            # the structure DESIGN.md D18 added `continues_in_next_column` for: two blocks with
            # disjoint x-extents and one polygon each, rather than one polygon over the gutter.
            RelationPlan(
                "continues_in_next_column", "p0-intro-1", "p0-intro-1-cont", 0.97, "text-continuity"
            ),
            RelationPlan(
                "continues_in_next_column", "p2-s32-2", "p2-s32-3", 0.97, "text-continuity"
            ),
            RelationPlan(
                "continues_on_next_page", "p0-intro-4", "p1-intro-5", 0.97, "text-continuity"
            ),
            # "In addition, high-" / "way networks ..." - a word split across the page break.
            RelationPlan(
                "continues_on_next_page", "p1-related-4", "p2-related-5", 0.99, "hyphen-continuity"
            ),
            RelationPlan("footnote_of", "p0-footnote-1", "p0-abstract-2", 0.98, "marker-numbering"),
            RelationPlan("footnote_of", "p2-footnote-2", "p2-s31-1", 0.98, "marker-numbering"),
        ),
        metadata=MetadataPlan(
            title=("p0-title", "Deep Residual Learning for Image Recognition", 1.0),
            authors=(
                ("p0-author-1", "Kaiming He", 1.0),
                ("p0-author-2", "Xiangyu Zhang", 1.0),
                ("p0-author-3", "Shaoqing Ren", 1.0),
                ("p0-author-4", "Jian Sun", 1.0),
            ),
            abstract=(("p0-abstract-1", "p0-abstract-2"), 1.0),
            # Read out of the arXiv stamp in the left margin - the one place on these pages where
            # either fact is printed. `venue` and `doi` stay null: neither appears on pages 0-2 of
            # this preprint, and a value from anywhere else is not a PaperIR fact (rule 6b).
            arxiv_id=("p0-arxiv", "1512.03385", 0.99),
            year=("p0-arxiv", 2015, 0.95),
        ),
    )


PAPERS: dict[str, PaperPlan] = {
    plan.slug: plan for plan in (_attention(), _neural_odes(), _resnet())
}


if __name__ == "__main__":
    raise SystemExit(main())
