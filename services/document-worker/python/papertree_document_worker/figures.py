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

from papertree_document_ir import BBox

from papertree_document_worker.pdf import Drawing, Line, PageContent, RasterImage

__all__ = ["FigureRegion", "detect_figure_regions", "is_caption_line"]

#: Ink within this distance joins one cluster. A figure's internal whitespace is much smaller
#: than the gap between a figure and the body text around it.
MERGE_TOLERANCE_PT = 12.0
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


def _union(boxes: list[BBox]) -> BBox:
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    ]


def _inside(band: BBox, region: BBox) -> bool:
    """Whether a line band sits inside a region, allowing a small overhang.

    Centre-based rather than containment-based: a diagram label frequently pokes a point or two
    outside the ink that surrounds it, and requiring full containment would leave those labels
    in the body stream - which is the entire failure this module exists to prevent.
    """
    cx = (band[0] + band[2]) / 2
    cy = (band[1] + band[3]) / 2
    return region[0] <= cx <= region[2] and region[1] <= cy <= region[3]


def detect_figure_regions(page: PageContent) -> list[FigureRegion]:
    """Vector clusters and raster placements, with their interior text claimed.

    Rasters are emitted per PLACEMENT, not per xref: one image drawn twice is two figures, and
    findings.md B3 records BERT's 34 rasters being dropped wholesale by code that looked only at
    intrinsic pixel size rather than at on-page extent.
    """
    regions: list[FigureRegion] = []

    ink = [d for d in page.drawings if _paintable(d)]
    for indices in _cluster([d.bbox for d in ink], MERGE_TOLERANCE_PT):
        box = _union([ink[i].bbox for i in indices])
        if (
            box[2] - box[0] < MIN_FIGURE_SIDE_PT
            or box[3] - box[1] < MIN_FIGURE_SIDE_PT
            or (box[2] - box[0]) * (box[3] - box[1]) < MIN_FIGURE_AREA_PT2
        ):
            continue
        regions.append(FigureRegion(bbox=box, is_vector=True, ink_count=len(indices)))

    for image in _significant_rasters(page.images):
        regions.append(FigureRegion(bbox=list(image.bbox), is_vector=False, ink_count=1))

    # Claim interior text. Largest region first so a label inside a sub-panel of a big figure is
    # claimed by the panel that actually contains it rather than by whichever was found first.
    regions.sort(key=lambda r: r.area, reverse=True)
    claimed: set[int] = set()
    resolved: list[FigureRegion] = []
    for region in regions:
        interior = tuple(
            line
            for index, line in enumerate(page.lines)
            if index not in claimed and _inside(line.band, region.bbox)
        )
        for index, line in enumerate(page.lines):
            if index not in claimed and _inside(line.band, region.bbox):
                claimed.add(index)
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
