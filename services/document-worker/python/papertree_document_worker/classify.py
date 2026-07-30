"""F1.1 - PDF inspection and classification. Decides what a document IS before parsing it.

Its output routes the page and, more importantly, sets `Paper.status`. Epic 1's non-goals are
explicit: **no OCR path for scanned documents - classify them, mark `partial`, and defer.** This
module is the "classify them" half, and it is what makes the deferral honest rather than a crash.

WHY A PAGE IS CALLED SCANNED HERE, AND WHY IT IS NOT JUST "NO TEXT"

An empty page has no text either, and calling it scanned would put a false `partial_reason` on a
perfectly complete parse. The three signals are combined rather than thresholded one at a time:

  * **glyph coverage** - what fraction of the crop box the text bounding boxes cover.
  * **raster coverage** - what fraction is covered by embedded images.
  * **ink presence** - whether the page has vector draw ops.

A scanned page is one where a raster covers most of the page and there is little or no text
under it. A blank page is one where nothing covers anything, and it is `blank`, not `scanned` -
DESIGN.md §11 residual risk 10 notes that "`status: complete` with zero blocks" is also what a
total extraction failure looks like, so the two are distinguished here rather than downstream.

TEXT-LAYER QUALITY IS SEPARATE FROM PRESENCE. A page can have a full text layer that is
unusable: a broken `/ToUnicode` gives U+FFFD, and a CID font with no mapping gives glyphs that
render but do not decode. PTUB category 9 ("poorly encoded PDF - broken ToUnicode, no spaces,
ligature soup, CID fonts") is a corpus category that does not exist yet, so this scores the
signal and records it rather than acting on it.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from papertree_document_worker.pdf import PageContent, SourceDocument

__all__ = [
    "DocumentProfile",
    "PageKind",
    "PageProfile",
    "classify_document",
    "classify_page",
]

#: Replacement character and the private-use range: the two things a broken /ToUnicode produces.
_UNDECODABLE = "�"
_PRIVATE_USE = range(0xE000, 0xF900)

#: A raster covering at least this fraction of the crop box, with little text over it, is a scan.
SCANNED_RASTER_COVERAGE = 0.60
#: Below this glyph coverage a page has no usable text layer of its own.
SPARSE_TEXT_COVERAGE = 0.01
#: Fewer glyphs than this and the "text layer" is furniture (a page number), not content.
SPARSE_TEXT_GLYPHS = 32


class PageKind(StrEnum):
    """What a page is, as one word. Deliberately closed - an unrecognised page is `unknown`."""

    DIGITAL = "digital"
    """A born-digital text layer. The deterministic path handles it."""
    SCANNED = "scanned"
    """Raster-dominated with no usable text. DEFERRED - Epic 1 ships no OCR."""
    VECTOR_ONLY = "vector_only"
    """Draw ops but no text: a full-page figure, or a plate."""
    BLANK = "blank"
    """Nothing on it. A real state, and NOT a parse failure."""
    UNKNOWN = "unknown"
    """Signals disagree. Parsed as best as possible, flagged for review."""


@dataclass(frozen=True, slots=True)
class PageProfile:
    index: int
    kind: PageKind
    glyph_count: int
    span_count: int
    #: Fraction of the crop box covered by text bboxes. Approximate: it sums line-band areas and
    #: does not subtract overlaps, so it is an upper bound, which is the safe direction for a
    #: "is there enough text here" test.
    text_coverage: float
    raster_coverage: float
    drawing_count: int
    #: Fraction of decoded glyphs that are U+FFFD or private-use - a broken /ToUnicode.
    undecodable_ratio: float
    #: Fraction of glyphs MuPDF INVENTED (inter-glyph spaces the content stream does not carry).
    synthetic_ratio: float
    fonts: tuple[tuple[str, int], ...]
    #: Per-page confidence, mapped onto `Page.confidence`.
    confidence: float

    @property
    def has_text_layer(self) -> bool:
        return self.glyph_count > 0

    @property
    def is_scanned(self) -> bool:
        return self.kind is PageKind.SCANNED

    @property
    def is_parseable(self) -> bool:
        """Whether the deterministic path can say anything useful about this page."""
        return self.kind in (PageKind.DIGITAL, PageKind.VECTOR_ONLY, PageKind.BLANK)


@dataclass(frozen=True, slots=True)
class DocumentProfile:
    page_count: int
    producer: str
    creator: str
    is_encrypted: bool
    pages: tuple[PageProfile, ...]
    #: Document-wide font census, most common first.
    fonts: tuple[tuple[str, int], ...] = field(default=())

    @property
    def scanned_pages(self) -> tuple[int, ...]:
        return tuple(p.index for p in self.pages if p.is_scanned)

    @property
    def is_born_digital(self) -> bool:
        return not self.scanned_pages

    @property
    def partial_reason(self) -> str | None:
        """The `Paper.partial_reason` this profile implies, or `None` if nothing is deferred.

        Rule 41 makes this required-and-non-null for `failed` and required-and-null for
        `complete`, so the caller uses its presence to choose the status rather than deciding
        separately and risking the two disagreeing.
        """
        scanned = self.scanned_pages
        if not scanned:
            return None
        listed = ", ".join(str(i) for i in scanned[:10])
        if len(scanned) > 10:
            listed += f", +{len(scanned) - 10} more"
        return (
            f"{len(scanned)} of {self.page_count} pages are scanned images with no usable text "
            f"layer (pages {listed}). This build has no OCR path, so those pages carry geometry "
            f"and page images but no text blocks."
        )


def _area(box: list[float]) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def classify_page(page: PageContent) -> PageProfile:
    page_area = max(1e-9, page.frame.width * page.frame.height)

    glyphs = 0
    undecodable = 0
    synthetic = 0
    text_area = 0.0
    fonts: Counter[str] = Counter()
    spans = page.spans
    for span in spans:
        fonts[span.font] += len(span.chars)
        text_area += _area(span.line_band)
        for char in span.chars:
            glyphs += 1
            if char.synthetic:
                synthetic += 1
            if char.text == _UNDECODABLE or (char.text and ord(char.text[0]) in _PRIVATE_USE):
                undecodable += 1

    raster_area = sum(_area(image.bbox) for image in page.images)
    # Clip rather than clamp per image: several placements of the same raster legitimately tile a
    # page, and their summed area can exceed it without any of them being wrong.
    raster_coverage = min(1.0, raster_area / page_area)
    text_coverage = min(1.0, text_area / page_area)
    # Clip paths are frequently page-sized; counting them as ink would call a blank page vector.
    painted = tuple(d for d in page.drawings if not d.is_clip)

    sparse_text = glyphs < SPARSE_TEXT_GLYPHS or text_coverage < SPARSE_TEXT_COVERAGE
    if raster_coverage >= SCANNED_RASTER_COVERAGE and sparse_text:
        kind = PageKind.SCANNED
    elif glyphs > 0:
        kind = PageKind.DIGITAL
    elif painted or page.images:
        kind = PageKind.VECTOR_ONLY
    elif not page.drawings:
        kind = PageKind.BLANK
    else:
        kind = PageKind.UNKNOWN

    undecodable_ratio = undecodable / glyphs if glyphs else 0.0
    synthetic_ratio = synthetic / glyphs if glyphs else 0.0

    return PageProfile(
        index=page.index,
        kind=kind,
        glyph_count=glyphs,
        span_count=len(spans),
        text_coverage=text_coverage,
        raster_coverage=raster_coverage,
        drawing_count=len(painted),
        undecodable_ratio=undecodable_ratio,
        synthetic_ratio=synthetic_ratio,
        fonts=tuple(fonts.most_common()),
        confidence=_page_confidence(kind, undecodable_ratio),
    )


def _page_confidence(kind: PageKind, undecodable_ratio: float) -> float:
    """Map a page's classification onto `Page.confidence` in [0, 1].

    Deliberately coarse. A calibrated number would need a gold set to calibrate against, and PTUB
    Tier B does not exist (`research/benchmarks/README.md` §7: "Gold annotations: **not
    started**"). Inventing a precise-looking figure here would be the kind of unearned number
    EPIC-00-GATE exists to catch, so these are round and their meaning is stated:

      1.00  a clean born-digital page
      0.50  no text layer to read, but geometry is intact (vector-only / blank)
      0.20  scanned - this build cannot read it at all
    """
    if kind is PageKind.SCANNED:
        return 0.2
    if kind in (PageKind.VECTOR_ONLY, PageKind.BLANK):
        return 0.5
    if kind is PageKind.UNKNOWN:
        return 0.3
    # A broken /ToUnicode degrades a digital page smoothly rather than reclassifying it: the
    # geometry is still correct and the text is still the PDF's own, just partly undecodable.
    return round(max(0.3, 1.0 - undecodable_ratio), 4)


def classify_document(document: SourceDocument, pages: list[PageContent]) -> DocumentProfile:
    profiles = tuple(classify_page(p) for p in pages)
    fonts: Counter[str] = Counter()
    for profile in profiles:
        for name, count in profile.fonts:
            fonts[name] += count
    metadata = document.metadata
    return DocumentProfile(
        page_count=document.page_count,
        producer=metadata.get("producer", ""),
        creator=metadata.get("creator", ""),
        is_encrypted=document.is_encrypted,
        pages=profiles,
        fonts=tuple(fonts.most_common()),
    )
