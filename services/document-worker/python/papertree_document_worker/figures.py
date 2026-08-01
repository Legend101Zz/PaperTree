"""F1.5 - figure regions, including the vector figures the old extractor could not see.

findings.md B3, measured: ResNet extracts **0 figures**. `page.get_images(full=True)` returns
only embedded rasters and ResNet has none - every figure in it is vector ink. Measured again
here at pymupdf 1.28.0: **0 rasters, 1,364 draw operations**. BERT's 34 rasters were all dropped
by a 50x50 pt size filter. Attention has 3 rasters and 169 draw ops.

So a figure is found by clustering *ink*, not by asking for images.

WHY THIS MODULE RUNS BEFORE READING ORDER, WHICH REVERSES THE EPIC'S STATED DEPENDENCY

`EPIC-01-ingest.md` says "F1.5, F1.6, F1.7 are parallel-safe once F1.2/F1.3 land". They are not,
and building F1.3 first is what showed why. ResNet page 3 carries Figure 3's architecture
diagram, whose interior is ~40 text labels at 4.92 pt (`3x3 conv, 64`, `size: 224`, `output`)
**interleaved in y with the body text of both columns**. Fed to paragraph segmentation they
shredded it: 95 blocks per page against a true ~15, because every label broke the run.

That is findings.md B6 - "Diagram interior labels (BERT Fig. 1): `T[SEP]`, `E[CLS]`, `BERT`" -
arriving through segmentation rather than through heading detection. Figure interiors are not
body text and must be removed from the body stream **before** columns are assigned, not
classified afterwards. `EPIC-01-RESULT.md` records the reversal.

WHAT COUNTS AS INK

Not every draw op. Three are excluded and each exclusion is load-bearing:

  * **clip paths** - frequently page-sized, and clustering one swallows the whole page;
  * **fully transparent ops** - present in TeX output and invisible by definition;
  * **rules** - a long thin fill is a table rule, a footnote separator or an underline, not a
    figure. `\\hrule` is how LaTeX draws the footnote separator, and clustering it merges a
    footnote into whatever is above it.

Clustering is single-linkage over inflated boxes, which is the standard shape for "ink that
belongs together": two ops join when their boxes come within `MERGE_TOLERANCE_PT`, and
connectivity is transitive so a dashed line joins the axis it belongs to.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from statistics import median

from papertree_document_ir import BBox

from papertree_document_worker.pdf import Drawing, Line, PageContent, RasterImage

__all__ = ["FigureRegion", "detect_figure_regions", "is_caption_line"]

#: Ink within this distance joins one cluster. A figure's internal whitespace is much smaller
#: than the gap between a figure and the body text around it.
MERGE_TOLERANCE_PT = 12.0

#: SECOND-PASS MERGE. Two ink clusters join when their gap is small RELATIVE TO THEIR OWN SIZE,
#: not just small in absolute points.
#:
#: Measured on ResNet page 3, which is why this exists. Figure 3 is three side-by-side network
#: stacks (VGG-19, 34-layer plain, 34-layer residual) at x = 74-122, 144-193 and 215-285. The
#: gaps between them are ~22 pt - larger than MERGE_TOLERANCE_PT - so the first pass emits three
#: regions where the document has one figure. A flat tolerance cannot fix that without also
#: swallowing the body text 22 pt away from a small plot.
#:
#: The ratio does distinguish them: 22 pt between two 450 pt-tall stacks is 5 % of their extent
#: and obviously internal; 22 pt between a 60 pt plot and a paragraph is 37 % and obviously not.
PANEL_GAP_RATIO = 0.12
#: ...and the two clusters must overlap on the other axis by at least this share of the smaller,
#: so that two unrelated plots stacked in a column do not merge through a shared x-range.
PANEL_OVERLAP_SHARE = 0.5

#: A line SMALLER than this share of the page's dominant font, sitting within
#: `LABEL_MARGIN_PT` of a figure, is one of that figure's labels even when it falls outside the
#: ink. ResNet Figure 3's `output size: 224` legend sits at x = 51-68 against ink starting at
#: x = 74 - outside every cluster, 4.92 pt against a 9.96 pt body. findings.md B6 records these
#: exact labels being promoted to HEADINGS by the old extractor.
LABEL_MAX_SIZE_SHARE = 0.75
LABEL_MARGIN_PT = 18.0
#: A cluster smaller than this in either dimension is a glyph decoration, a bullet or a rule
#: cap, not a figure.
MIN_FIGURE_SIDE_PT = 24.0
#: ...and it must cover at least this area. 24x24 = 576, so this additionally rejects long thin
#: clusters that clear both side minima only in one dimension.
MIN_FIGURE_AREA_PT2 = 1600.0
#: An op thinner than this in one dimension while long in the other is a RULE. LaTeX's
#: `\hrule` is 0.4 pt; table rules are 0.4-1.5 pt.
RULE_MAX_THICKNESS_PT = 2.5
RULE_MIN_ASPECT = 8.0

_CAPTION_START = re.compile(
    r"^\s*(?:figure|fig\.?|table|algorithm|listing)\s*([0-9]+|[IVXivx]+)\s*[.:)\s]", re.IGNORECASE
)


@dataclass(frozen=True, slots=True)
class FigureRegion:
    bbox: BBox
    is_vector: bool
    #: Draw ops (vector) or placements (raster) that produced this region.
    ink_count: int
    #: Lines that fall INSIDE the region - a diagram's interior labels. They are removed from
    #: the body stream and become the figure's own nested content.
    interior_lines: tuple[Line, ...] = ()

    @property
    def area(self) -> float:
        return (self.bbox[2] - self.bbox[0]) * (self.bbox[3] - self.bbox[1])


def is_caption_line(text: str) -> tuple[str, str] | None:
    """`("figure", "3")` when the line opens a caption, else `None`.

    Numbering is the strong half of caption linking; proximity alone attaches a caption to
    whatever float is nearest, which is wrong whenever two floats share a page.
    """
    match = _CAPTION_START.match(text)
    if not match:
        return None
    kind = text.strip().split()[0].rstrip(".:)").lower()
    kind = "figure" if kind in ("fig", "figure") else kind
    return kind, match.group(1)


def _is_rule(drawing: Drawing) -> bool:
    width = drawing.bbox[2] - drawing.bbox[0]
    height = drawing.bbox[3] - drawing.bbox[1]
    thin = min(width, height)
    long_side = max(width, height)
    if thin > RULE_MAX_THICKNESS_PT:
        return False
    return long_side >= RULE_MIN_ASPECT * max(thin, 0.1)


def _paintable(drawing: Drawing) -> bool:
    if drawing.is_clip:
        return False
    if drawing.stroke_opacity <= 0.0 and drawing.fill_opacity <= 0.0:
        return False
    return not _is_rule(drawing)


def _cluster(boxes: list[BBox], tolerance: float) -> list[list[int]]:
    """Single-linkage clustering over boxes inflated by `tolerance`.

    Union-find rather than a sweep: connectivity must be transitive so that a dashed axis line
    joins the plot it annotates even though its individual dashes do not touch the plot body.
    """
    parent = list(range(len(boxes)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(boxes)):
        a = boxes[i]
        for j in range(i + 1, len(boxes)):
            b = boxes[j]
            if (
                a[0] - tolerance <= b[2]
                and b[0] - tolerance <= a[2]
                and a[1] - tolerance <= b[3]
                and b[1] - tolerance <= a[3]
            ):
                ra, rb = find(i), find(j)
                if ra != rb:
                    parent[rb] = ra

    groups: dict[int, list[int]] = {}
    for i in range(len(boxes)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def _gap_and_overlap(a: BBox, b: BBox, axis: int) -> tuple[float, float]:
    """Gap along `axis` (0 = x, 1 = y) and the overlap share on the other axis."""
    other = 1 - axis
    gap = max(a[axis] - b[axis + 2], b[axis] - a[axis + 2])
    lo = max(a[other], b[other])
    hi = min(a[other + 2], b[other + 2])
    smaller = min(a[other + 2] - a[other], b[other + 2] - b[other])
    share = (hi - lo) / smaller if smaller > 0 else 0.0
    return gap, share


def _same_figure(a: BBox, b: BBox) -> bool:
    """Whether two ink clusters are panels of one figure. See `PANEL_GAP_RATIO`."""
    for axis in (0, 1):
        gap, overlap_share = _gap_and_overlap(a, b, axis)
        if overlap_share < PANEL_OVERLAP_SHARE:
            continue
        other = 1 - axis
        extent = min(a[other + 2] - a[other], b[other + 2] - b[other])
        if gap <= max(MERGE_TOLERANCE_PT, PANEL_GAP_RATIO * extent):
            return True
    return False


def _merge_panels(boxes: list[BBox]) -> list[BBox]:
    """Fixed-point merge of ink clusters into figures. Iterates because merging two panels can
    bring the result within reach of a third - ResNet Figure 3 is exactly that, three stacks."""
    current = list(boxes)
    changed = True
    while changed and len(current) > 1:
        changed = False
        merged: list[BBox] = []
        for box in current:
            for index, existing in enumerate(merged):
                if _same_figure(existing, box):
                    merged[index] = _union([existing, box])
                    changed = True
                    break
            else:
                merged.append(box)
        current = merged
    return current


def _union(boxes: list[BBox]) -> BBox:
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    ]


def _within(inner: BBox, outer: BBox) -> bool:
    return (
        inner[0] >= outer[0] - 0.5
        and inner[1] >= outer[1] - 0.5
        and inner[2] <= outer[2] + 0.5
        and inner[3] <= outer[3] + 0.5
    )


def _inside(band: BBox, region: BBox) -> bool:
    """Whether a line band sits inside a region, allowing a small overhang.

    Centre-based rather than containment-based: a diagram label frequently pokes a point or two
    outside the ink that surrounds it, and requiring full containment would leave those labels
    in the body stream - which is the entire failure this module exists to prevent.
    """
    cx = (band[0] + band[2]) / 2
    cy = (band[1] + band[3]) / 2
    return region[0] <= cx <= region[2] and region[1] <= cy <= region[3]


def _claims(band: BBox, region: BBox, size: float, body_size: float) -> bool:
    """Whether a line belongs to a figure: inside its ink, or a small label just outside it."""
    if _inside(band, region):
        return True
    if size >= LABEL_MAX_SIZE_SHARE * body_size:
        return False
    grown: BBox = [
        region[0] - LABEL_MARGIN_PT,
        region[1] - LABEL_MARGIN_PT,
        region[2] + LABEL_MARGIN_PT,
        region[3] + LABEL_MARGIN_PT,
    ]
    return _inside(band, grown)


def detect_figure_regions(page: PageContent) -> list[FigureRegion]:
    """Vector clusters and raster placements, with their interior text claimed.

    Rasters are emitted per PLACEMENT, not per xref: one image drawn twice is two figures, and
    findings.md B3 records BERT's 34 rasters being dropped wholesale by code that looked only at
    intrinsic pixel size rather than at on-page extent.
    """
    regions: list[FigureRegion] = []

    ink = [d for d in page.drawings if _paintable(d)]
    clusters = _cluster([d.bbox for d in ink], MERGE_TOLERANCE_PT)
    for box in _merge_panels([_union([ink[i].bbox for i in idx]) for idx in clusters]):
        if (
            box[2] - box[0] < MIN_FIGURE_SIDE_PT
            or box[3] - box[1] < MIN_FIGURE_SIDE_PT
            or (box[2] - box[0]) * (box[3] - box[1]) < MIN_FIGURE_AREA_PT2
        ):
            continue
        ink_count = sum(1 for d in ink if _within(d.bbox, box))
        regions.append(FigureRegion(bbox=box, is_vector=True, ink_count=ink_count))

    # RASTER PLACEMENTS ARE PANEL-MERGED TOO, and measuring said why. A matplotlib figure
    # exported as a raster is placed once PER PANEL, so neural-odes returned 63 raster regions
    # for a paper with about four figures - every subplot its own "figure". The same adaptive
    # merge the vector clusters use collapses them, because the relation is identical: panels of
    # one float sit close together relative to their own size.
    raster_boxes = [list(image.bbox) for image in _significant_rasters(page.images)]
    for box in _merge_panels(raster_boxes):
        regions.append(
            FigureRegion(
                bbox=box,
                is_vector=False,
                ink_count=sum(1 for b in raster_boxes if _within(b, box)),
            )
        )

    # Claim interior text. Largest region first so a label inside a sub-panel of a big figure is
    # claimed by the panel that actually contains it rather than by whichever was found first.
    sizes = [s.size for line in page.lines for s in line.spans if s.size > 0]
    body_size = median(sizes) if sizes else 10.0

    regions.sort(key=lambda r: r.area, reverse=True)
    claimed: set[int] = set()
    resolved: list[FigureRegion] = []
    for region in regions:
        taken = [
            index
            for index, line in enumerate(page.lines)
            if index not in claimed
            and _claims(
                line.band,
                region.bbox,
                line.spans[0].size if line.spans else body_size,
                body_size,
            )
        ]
        interior = tuple(page.lines[index] for index in taken)
        claimed.update(taken)
        resolved.append(
            FigureRegion(
                bbox=region.bbox,
                is_vector=region.is_vector,
                ink_count=region.ink_count,
                interior_lines=interior,
            )
        )
    resolved.sort(key=lambda r: (r.bbox[1], r.bbox[0]))
    return resolved


def _significant_rasters(images: tuple[RasterImage, ...]) -> list[RasterImage]:
    """Raster placements big enough on the page to be a figure.

    The filter is on ON-PAGE extent, never on intrinsic pixel size: a 40x40 px logo scaled to
    200x200 pt is a figure, and a 2000x2000 px texture placed at 8x8 pt is not.
    """
    return [
        image
        for image in images
        if (image.bbox[2] - image.bbox[0]) >= MIN_FIGURE_SIDE_PT
        and (image.bbox[3] - image.bbox[1]) >= MIN_FIGURE_SIDE_PT
    ]
