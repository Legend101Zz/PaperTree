"""The PyMuPDF boundary: raw PDF -> typed, IR-space primitives.

THE ONLY MODULE IN THE WORKER THAT IMPORTS PYMUPDF. Everything downstream works in PaperIR
coordinates and never sees a `pymupdf` object.

That is not tidiness. PyMuPDF ships `py.typed` but almost no annotations, so under
`mypy --strict` every call is a `no-untyped-call` error and every result is `Any`; `Any` leaking
into the pipeline would silently disable strict checking across the whole worker. Confining it
here means the `Any` -> concrete conversion happens exactly once, in one reviewable file, and
the ~500 lines downstream of it are checked for real.

--------------------------------------------------------------------------------------------
THE COORDINATE PIPELINE, AND THE MEASUREMENT THAT ESTABLISHED IT
--------------------------------------------------------------------------------------------

ADR-001 Amendment 1 measured the cost of getting the page frame wrong at **99.93 % of block
ids** (perturbation P9). So this is not derived from documentation; every claim below was run
against `packages/document-ir/test/fixtures-pdf/*.pdf` before it was written.

**What MuPDF actually returns.** `page.get_text("rawdict")` and `page.get_drawings()` both
return coordinates that are:

  * crop-box-relative (origin at the crop box's own top-left),
  * top-left origin, y growing downward,
  * **NOT rotated** - `/Rotate` is *not* applied,
  * pre-multiplied by `/UserUnit`.

The "not rotated" half is the surprising one and it was measured, not assumed: the same page
built at `/Rotate` 0, 90, 180 and 270 returns *byte-identical* span and drawing rects. Only
`page.rect` and `page.rotation_matrix` change. A parser that reads `get_text` and believes the
page is rotated will be wrong on all four.

**What `papertree_document_ir.geometry.normalise_point` expects** is the other thing entirely:
RAW PDF space - absolute, bottom-left origin, un-crop-shifted, un-rotated, un-scaled. Feeding
it a MuPDF rect is a complete, plausible, wrong answer.

**The pipeline this module therefore uses** is MuPDF's own, which Epic 0's oracle already
blessed (`test/fixtures-pdf/generate.py` `mupdf_oracle`)::

    r = pymupdf.Rect(raw) / user_unit     # 1. divide /UserUnit back out (page.rect is scaled
                                          #    by it; rotation_matrix is NOT - dividing after
                                          #    rotating is off by exactly that factor)
    r = r * page.rotation_matrix          # 2. now apply /Rotate
    r.normalize()                         # 3. corner-order

**Proof that this equals the contract**, rather than merely resembling it:
`tests/worker/test_geometry_contract.py` maps every marker in all 9 synthetic fixtures through
this pipeline and asserts equality with `normalise_rect(frame, marker_rects_raw_pdf_space)` -
document-ir's own function, fed the independently-recorded raw content-stream coordinates from
`conformance/geometry-vectors.json`. **9 of 9 agree**, including `combined.pdf` (/Rotate 270 +
/UserUnit 1.5 + CropBox offset + negative MediaBox). Neither side of that comparison is this
module grading itself.

This matters because the real corpus cannot test any of it: all 8 papers are /Rotate 0, no
CropBox offset, no /UserUnit (measured - see `classify.py`). The normalisation path is a no-op
on 100 % of real documents and the synthetic fixtures are its only coverage.

--------------------------------------------------------------------------------------------
SPAN VERTICAL EXTENT - and why the rule is NOT "height <= 1.3 x size"
--------------------------------------------------------------------------------------------

`EPIC-02-RESULT.md` §2.3 asks Epic 1 to "not emit spans that exceed 1.3 x their declared size".
Applied to `bbox` height that rule is wrong, and measuring it says why:

  * The tallest spans in the corpus are **rotated text**, not broken geometry. ResNet's worst
    span is `h/size = 17.55` and it is the **arXiv margin stamp** (`arXiv:1512.03385v1
    [cs.CV]`, `line["dir"] == (0, -1)`); the next worst are matplotlib **axis labels**
    (`training error (%)`, `Samples`, `Density`). Their axis-aligned box is tall because the
    text runs vertically. Their extent *across* the writing direction is `w/size = 1.00-1.33`,
    i.e. exactly one line. A height rule deletes the arXiv stamp and every rotated axis label -
    data loss, and a direct violation of "unclassifiable regions keep their geometry, never
    dropped".
  * Among genuinely horizontal spans the tallest are `{`, `}`, `x` and big operators at
    `h/size ~ 1.73`. Those glyphs really are that tall; `size` is the nominal font size, not
    the glyph's extent. Rejecting them deletes the delimiters from every display equation.
  * `size` is **never missing** from MuPDF: 0 of 84,395 spans across all 8 papers lack it.
    Epic 2's "118 of 727 spans lack size" is a property of Epic 0's hand-built fixtures, not of
    anything a PyMuPDF parser emits.

So this module keeps `bbox` **truthful** - it is the real extent of the real glyphs - and gives
Epic 2 what it actually needed by a different route: :attr:`Span.line_band`, the typographic
band computed from the baseline and the font's own metrics::

    top    = origin_y - ascender  * size
    bottom = origin_y - descender * size          (descender is negative)

That band is exactly one line high by construction, so consecutive lines cannot overlap, and it
is what :func:`union_of_line_rects` is fed when a block's polygon is built. The stored span
geometry stays honest; the polygon stops bleeding. Both properties, no clamp.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Self

import pymupdf as _pymupdf
from papertree_document_ir import BBox, Point
from papertree_document_ir.geometry import PageFrame, RawPageBoxes, normalise_page_frame

#: The whole reason this module exists (see the docstring): PyMuPDF is `py.typed` but barely
#: annotated, so `mypy --strict` rejects every call to it as `no-untyped-call`. Binding it once
#: as `Any` marks the boundary explicitly instead of scattering `# type: ignore` down the file
#: or loosening the strictness setting for the whole package - either of which would also
#: silence real errors in the code that is NOT pymupdf.
pymupdf: Any = _pymupdf

#: A rect as MuPDF hands it over, before any transform. Named so the 4-ness is in the type.
RawRect = tuple[float, float, float, float]

__all__ = [
    "Char",
    "Drawing",
    "Line",
    "PageContent",
    "RasterImage",
    "SourceDocument",
    "Span",
    "TextBlock",
    "WritingDirection",
]

WritingDirection = Literal["ltr", "rtl", "ttb", "btt"]
"""Which way a line runs, derived from MuPDF's `line["dir"]` unit vector.

Recorded rather than normalised away because it decides which axis of a span's bbox is "one line
high" - see the module docstring's span-extent section.
"""


# ── the geometry boundary ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class _PageTransform:
    """The two numbers and one matrix that carry a MuPDF coordinate into IR space.

    Held as plain floats rather than as a `pymupdf.Matrix` so that nothing downstream of this
    module needs pymupdf on its import path.
    """

    user_unit: float
    #: `page.rotation_matrix` flattened: (a, b, c, d, e, f), applying x' = a*x + c*y + e.
    matrix: tuple[float, float, float, float, float, float]

    def point(self, x: float, y: float) -> Point:
        a, b, c, d, e, f = self.matrix
        ux, uy = x / self.user_unit, y / self.user_unit
        return [a * ux + c * uy + e, b * ux + d * uy + f]

    def rect(self, raw: RawRect) -> BBox:
        """Map a rect and corner-order the result.

        Not a per-corner map: 90 and 270 exchange which corner ends up top-left, exactly as
        `geometry.normalise_rect` documents, so the answer is the EXTENT of the two mapped
        corners.
        """
        p0 = self.point(raw[0], raw[1])
        p1 = self.point(raw[2], raw[3])
        return [
            min(p0[0], p1[0]),
            min(p0[1], p1[1]),
            max(p0[0], p1[0]),
            max(p0[1], p1[1]),
        ]


# ── typed primitives ───────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Char:
    """One glyph. `bbox` and `origin` are IR space.

    Per-character boxes are the reason PyMuPDF is the dependency: they are what makes a `Span`
    addressable at sub-span granularity, which is what `Span.start`/`end` offsets into
    `Block.text` ultimately have to agree with.
    """

    text: str
    bbox: BBox
    origin: Point
    #: MuPDF's own flag for a glyph it INVENTED rather than read - a space inferred from
    #: inter-glyph distance where the content stream has no space character. It is the honest
    #: signal for `ingest/source-authenticity.spec`: a synthetic glyph is not in the glyph
    #: stream, so text reconstruction must expect it to differ.
    synthetic: bool


@dataclass(frozen=True, slots=True)
class Span:
    """A run of glyphs sharing one font, size and colour. IR space throughout."""

    text: str
    bbox: BBox
    size: float
    font: str
    flags: int
    color: int
    origin: Point
    ascender: float
    descender: float
    direction: WritingDirection
    chars: tuple[Char, ...]

    @property
    def is_rotated(self) -> bool:
        return self.direction in ("ttb", "btt")

    @property
    def line_band(self) -> BBox:
        """The typographic band: one line high, by construction, from the font's own metrics.

        This - not `bbox` - is what a block polygon is built from. See the module docstring:
        `bbox` stays truthful about where the glyphs are, and this stays truthful about where
        the LINE is, and conflating them is what makes highlights bleed into the line above.

        For rotated text the band runs along the other axis, which is why `direction` is
        recorded rather than discarded.
        """
        ox, oy = self.origin
        top = self.ascender * self.size
        bottom = -self.descender * self.size  # descender is negative; this is a positive depth
        if self.direction == "ttb":
            return [ox - bottom, oy, ox + top, self.bbox[3]]
        if self.direction == "btt":
            return [ox - top, self.bbox[1], ox + bottom, oy]
        return [self.bbox[0], oy - top, self.bbox[2], oy + bottom]


@dataclass(frozen=True, slots=True)
class Line:
    bbox: BBox
    direction: WritingDirection
    spans: tuple[Span, ...]

    @property
    def text(self) -> str:
        return "".join(s.text for s in self.spans)

    @property
    def band(self) -> BBox:
        """The union of the spans' typographic bands - the line's own non-overlapping extent."""
        bands = [s.line_band for s in self.spans]
        return [
            min(b[0] for b in bands),
            min(b[1] for b in bands),
            max(b[2] for b in bands),
            max(b[3] for b in bands),
        ]


@dataclass(frozen=True, slots=True)
class TextBlock:
    """MuPDF's own block grouping.

    Kept only as a hint. It is emphatically NOT the IR's block: findings.md B5.3 measured this
    grouping accumulating left-column and right-column text into single 4,673-character blobs.
    F1.3 re-segments from lines.
    """

    bbox: BBox
    lines: tuple[Line, ...]


@dataclass(frozen=True, slots=True)
class Drawing:
    """One vector draw operation. The thing `page.get_images()` cannot see and ResNet is made of.

    findings.md B3: ResNet has 0 rasters and (measured at pymupdf 1.28.0) 1,364 draw ops. Every
    figure in it is vector ink.
    """

    bbox: BBox
    #: MuPDF's op class: "f" fill, "s" stroke, "fs" both, "clip"/"group" for structure.
    kind: str
    stroke_opacity: float
    fill_opacity: float
    width: float
    #: Segment count, as a cheap proxy for ink density when clustering figure regions.
    item_count: int
    #: Whether MuPDF reports this op as a clipping path rather than painted ink. Clip rects are
    #: frequently page-sized and would swallow a whole page into one "figure" if clustered.
    is_clip: bool


@dataclass(frozen=True, slots=True)
class RasterImage:
    bbox: BBox
    xref: int
    width: int
    height: int
    colorspace: str
    bpc: int


@dataclass(slots=True)
class PageContent:
    """Everything one page offers, already in IR space."""

    index: int
    frame: PageFrame
    text_blocks: tuple[TextBlock, ...]
    drawings: tuple[Drawing, ...]
    images: tuple[RasterImage, ...]
    #: Raw `/Rotate`, `/UserUnit` and the boxes as written - retained so a normalisation can be
    #: audited from the parse output alone rather than by reopening the file.
    raw_boxes: RawPageBoxes
    _transform: _PageTransform = field(repr=False)

    @property
    def lines(self) -> list[Line]:
        return [ln for b in self.text_blocks for ln in b.lines]

    @property
    def spans(self) -> list[Span]:
        return [s for ln in self.lines for s in ln.spans]

    def to_ir_rect(self, raw: RawRect) -> BBox:
        """Map a further MuPDF-space rect (e.g. a clip region) into IR space."""
        return self._transform.rect(raw)


def _direction(dir_vector: Any) -> WritingDirection:
    dx, dy = float(dir_vector[0]), float(dir_vector[1])
    if abs(dx) >= abs(dy):
        return "ltr" if dx >= 0 else "rtl"
    # MuPDF's y grows downward, so dy < 0 is text running UP the page.
    return "btt" if dy < 0 else "ttb"


def _finite(values: Sequence[float]) -> bool:
    return all(math.isfinite(v) for v in values)


def _rect4(raw: Any) -> RawRect:
    """A MuPDF rect-like as an explicitly 4-long tuple, so the type survives the boundary."""
    x0, y0, x1, y1 = (float(v) for v in raw)
    return (x0, y0, x1, y1)


class SourceDocument:
    """An open PDF, plus the one fact every block id depends on: the SHA-256 of its bytes.

    `source_hash` is the bare 64-hex digest `identity.block_id` demands, NOT the `"sha256:"`
    prefixed form the IR stores - passing the prefixed form is rejected by document-ir rather
    than hashed, because it would mint a complete, plausible, wrong id space.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        data = self.path.read_bytes()
        self.byte_length = len(data)
        self.source_hash = hashlib.sha256(data).hexdigest()
        self._doc = pymupdf.open(stream=data, filetype="pdf")

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._doc.close()

    @property
    def page_count(self) -> int:
        return int(self._doc.page_count)

    @property
    def metadata(self) -> dict[str, str]:
        return {str(k): str(v) for k, v in (self._doc.metadata or {}).items() if v is not None}

    @property
    def is_encrypted(self) -> bool:
        return bool(self._doc.is_encrypted)

    def raw_page_boxes(self, index: int) -> RawPageBoxes:
        """The page boxes in RAW PDF space, which is what `normalise_page_frame` demands.

        THE TRAP, MEASURED. `page.mediabox` and `page.cropbox` are not in the same space:

        * `page.mediabox` is the raw `/MediaBox`, untouched. (`negative-mediabox.pdf`:
          `[-100, -50, 300, 400]`, identical to the recorded raw value.)
        * `page.cropbox` has already been **y-flipped into MuPDF's top-left space about the
          MediaBox's top edge**. (Same fixture, no explicit `/CropBox` so it defaults to the
          MediaBox, and MuPDF reports `[-100, 0, 300, 450]` - the flip of `[-100, -50, 300,
          400]` about `y = 400`.)

        Handing the flipped box to `normalise_page_frame` makes it intersect a top-left rect
        with a bottom-left one. On `negative-mediabox.pdf` that yields a **400 pt** frame where
        the truth is **450 pt** - a document that then fails validator rule G4, and whose every
        block id is computed against a page 50 pt shorter than the page.

        It is invisible almost everywhere, which is what makes it dangerous: the flip is the
        identity whenever the MediaBox starts at `(0, 0)` and the CropBox equals it. That is
        **all 8 corpus papers** and 7 of the 9 synthetic fixtures.

        So the flip is undone here, with the raw MediaBox as the axis - the exact inverse of
        what MuPDF applied. Verified against all four fixtures that have a distinguishable
        CropBox (`cropbox-offset`, `cropbox-outside-mediabox`, `negative-mediabox`,
        `combined`); `test_page_frame_matches_the_recorded_one` is the standing guard.
        """
        page = self._doc[index]
        media = [float(v) for v in page.mediabox]
        flipped = [float(v) for v in page.cropbox]
        media_top = max(media[1], media[3])
        crop = [flipped[0], media_top - flipped[3], flipped[2], media_top - flipped[1]]
        return RawPageBoxes(
            media_box=media,
            crop_box=crop,
            rotate=float(page.rotation),
            user_unit=self._user_unit(page),
        )

    @staticmethod
    def _user_unit(page: Any) -> float:
        """`/UserUnit`, read from the page dictionary.

        PyMuPDF exposes no accessor, so this reads the key directly. Absent (`"null"`) means 1.0
        per PDF 1.7 §7.7.3.3. A malformed value is treated as absent rather than raising: a
        broken /UserUnit must not make a document unparseable, and `classify.py` records it.
        """
        try:
            kind, value = page.parent.xref_get_key(page.xref, "UserUnit")
        except Exception:  # pragma: no cover - defensive; xref_get_key is total in practice
            return 1.0
        if kind == "null":
            return 1.0
        try:
            unit = float(value)
        except (TypeError, ValueError):
            return 1.0
        return unit if math.isfinite(unit) and unit > 0 else 1.0

    def page(self, index: int) -> PageContent:
        page = self._doc[index]
        raw = self.raw_page_boxes(index)
        frame = normalise_page_frame(raw)
        matrix = page.rotation_matrix
        transform = _PageTransform(
            user_unit=float(raw.user_unit),
            matrix=(
                float(matrix.a),
                float(matrix.b),
                float(matrix.c),
                float(matrix.d),
                float(matrix.e),
                float(matrix.f),
            ),
        )

        blocks: list[TextBlock] = []
        for block in page.get_text("rawdict")["blocks"]:
            if block.get("type") != 0:  # 1 == image; those come from get_images() with an xref
                continue
            lines: list[Line] = []
            for raw_line in block.get("lines", ()):
                direction = _direction(raw_line["dir"])
                spans = tuple(
                    span
                    for raw_span in raw_line["spans"]
                    if (span := _span(raw_span, direction, transform)) is not None
                )
                if spans:
                    lines.append(
                        Line(
                            bbox=transform.rect(_rect4(raw_line["bbox"])),
                            direction=direction,
                            spans=spans,
                        )
                    )
            if lines:
                blocks.append(
                    TextBlock(bbox=transform.rect(_rect4(block["bbox"])), lines=tuple(lines))
                )

        return PageContent(
            index=index,
            frame=frame,
            text_blocks=tuple(blocks),
            drawings=_drawings(page, transform),
            images=_images(page, transform),
            raw_boxes=raw,
            _transform=transform,
        )

    def pages(self) -> list[PageContent]:
        return [self.page(i) for i in range(self.page_count)]

    def raw_page(self, index: int) -> Any:
        """The live `pymupdf.Page`, for RENDERING only.

        The one hole in this module's boundary, and it is deliberate: rasterising a region needs
        the page object itself, not the typed primitives. `crops.py` is the only caller, and it
        uses the result solely for `get_pixmap`.
        """
        return self._doc[index]


def _span(raw: Any, direction: WritingDirection, transform: _PageTransform) -> Span | None:
    """One rawdict span -> a `Span`, or `None` if its geometry is unusable.

    A non-finite coordinate is dropped HERE rather than downstream, because validator rule G5
    makes it an ERROR at the document level and `quantise` raises on it - so a single NaN from a
    corrupt content stream would otherwise fail the whole parse instead of one span.
    """
    box = _rect4(raw["bbox"])
    origin = (float(raw["origin"][0]), float(raw["origin"][1]))
    if not _finite(box) or not _finite(origin):
        return None
    size = float(raw["size"])
    if not math.isfinite(size) or size <= 0:
        return None

    chars: list[Char] = []
    for raw_char in raw.get("chars", ()):
        char_box = _rect4(raw_char["bbox"])
        char_origin = (float(raw_char["origin"][0]), float(raw_char["origin"][1]))
        if not _finite(char_box) or not _finite(char_origin):
            continue
        chars.append(
            Char(
                text=str(raw_char["c"]),
                bbox=transform.rect(char_box),
                origin=transform.point(char_origin[0], char_origin[1]),
                synthetic=bool(raw_char.get("synthetic", False)),
            )
        )

    return Span(
        text="".join(c.text for c in chars),
        bbox=transform.rect(box),
        size=size,
        font=str(raw.get("font", "")),
        flags=int(raw.get("flags", 0)),
        color=int(raw.get("color", 0)),
        origin=transform.point(origin[0], origin[1]),
        ascender=float(raw.get("ascender", 0.8)),
        descender=float(raw.get("descender", -0.2)),
        direction=direction,
        chars=tuple(chars),
    )


def _drawings(page: Any, transform: _PageTransform) -> tuple[Drawing, ...]:
    out: list[Drawing] = []
    for raw in page.get_drawings():
        box = _rect4(raw["rect"])
        if not _finite(box):
            continue
        kind = str(raw.get("type", ""))
        out.append(
            Drawing(
                bbox=transform.rect(box),
                kind=kind,
                stroke_opacity=float(raw.get("stroke_opacity", 1.0) or 1.0),
                fill_opacity=float(raw.get("fill_opacity", 1.0) or 1.0),
                width=float(raw.get("width", 0.0) or 0.0),
                item_count=len(raw.get("items", ())),
                is_clip=kind == "clip" or bool(raw.get("level", 0)) and kind == "group",
            )
        )
    return tuple(out)


def _images(page: Any, transform: _PageTransform) -> tuple[RasterImage, ...]:
    """Embedded rasters, with their ON-PAGE rects rather than their intrinsic pixel sizes.

    `page.get_images()` gives the xref and the pixel dimensions but no placement; the placement
    comes from `get_image_rects()`. One xref can be placed several times, and each placement is
    its own region - findings.md B3 records BERT's 34 rasters being dropped wholesale by code
    that looked only at intrinsic size.
    """
    out: list[RasterImage] = []
    for info in page.get_images(full=True):
        xref = int(info[0])
        try:
            rects = page.get_image_rects(xref)
        except Exception:  # pragma: no cover - malformed xref; the image is simply not placed
            continue
        for rect in rects:
            box = _rect4(rect)
            if not _finite(box):
                continue
            out.append(
                RasterImage(
                    bbox=transform.rect(box),
                    xref=xref,
                    width=int(info[2]),
                    height=int(info[3]),
                    colorspace=str(info[5]) if len(info) > 5 else "",
                    bpc=int(info[4]) if len(info) > 4 else 0,
                )
            )
    return tuple(out)
