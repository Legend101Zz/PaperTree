"""The parse, end to end: a PDF path in, a validated PaperIR document out.

STAGE ORDER, AND WHY IT IS NOT THE ORDER THE EPIC FILE STATES

    classify -> text+geometry -> FIGURE REGIONS -> columns/flows/order -> hierarchy -> assemble

`EPIC-01-ingest.md` says F1.5/F1.6/F1.7 are parallel-safe once F1.2/F1.3 land. Measuring it says
otherwise and issue #50 records why: ResNet page 3's Figure 3 carries ~40 interior labels at
4.92 pt **interleaved in y with the body text of both columns**, and feeding them to paragraph
segmentation shredded the page into 95 blocks against a true ~15. A float's interior is not body
text and has to leave the stream before columns are assigned, not be reclassified afterwards.

WHAT THIS FUNCTION GUARANTEES

Its output passes BOTH `Paper.model_validate` (well-formed) and `validate_paper` (internally
consistent) or it raises. There is no "mostly valid" return: a document that trips a Tier-A ERROR
is a document `packages/db` would store and every downstream consumer would then trust.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from statistics import median
from typing import Any

from papertree_document_ir import BBox
from papertree_document_ir.validate import assert_valid_paper, validate_paper

from papertree_document_worker.assemble import AssembledBlock, PaperBuilder, config_hash_for
from papertree_document_worker.classify import classify_document
from papertree_document_worker.crops import DEFAULT_SCALE, CropStore
from papertree_document_worker.equations import detect_equation_regions
from papertree_document_worker.figures import detect_figure_regions, is_caption_line
from papertree_document_worker.frontmatter import classify_front_matter
from papertree_document_worker.hierarchy import build_sections, detect_headings
from papertree_document_worker.joining import find_continuations
from papertree_document_worker.layout import LayoutBlock, layout_document
from papertree_document_worker.pdf import SourceDocument
from papertree_document_worker.references import (
    classify_reference_entries,
)
from papertree_document_worker.tables import detect_tables
from papertree_document_worker.text import build_block_text
from papertree_document_worker.vlm import VlmBudget, VlmClient, VlmError

__all__ = ["ParseResult", "ParserConfig", "parse_document"]

#: A fixed timestamp is NOT used - `parsed_at` is the one field excluded from the determinism
#: comparison (DESIGN.md §7.1), so it may vary between runs without breaking byte-identity.
#: The caller supplies it so tests can pin it.
DEFAULT_PARSED_AT = "2026-07-31T00:00:00Z"


@dataclass(frozen=True, slots=True)
class ParserConfig:
    """Every knob that changes the output. Hashed into `ParserInfo.config_hash`.

    That hash is what makes "re-parsing is a no-op" checkable: two runs agreeing on it and
    disagreeing on their output are a determinism bug; two runs disagreeing on it are not
    comparable at all.
    """

    #: Render scale for figure and equation crops.
    crop_scale: float = DEFAULT_SCALE
    #: URI scheme for stored crops. Opaque by default - see crops.py.
    asset_scheme: str = "asset"
    #: Cap on VLM calls per document. 0 disables the VLM entirely.
    vlm_max_calls: int = 0
    vlm_model: str = "MiniMax-M3"

    def as_dict(self) -> dict[str, Any]:
        return {
            "crop_scale": self.crop_scale,
            "asset_scheme": self.asset_scheme,
            "vlm_max_calls": self.vlm_max_calls,
            "vlm_model": self.vlm_model if self.vlm_max_calls else None,
        }


@dataclass(slots=True)
class ParseResult:
    paper: Any
    crops_written: int = 0
    #: Diagnostics from `validate_paper`, retained even when it passed - WARN-level findings
    #: (rule 3, G6, G8) are legal and worth surfacing rather than discarding.
    diagnostics: list[Any] = field(default_factory=list)
    multi_polygon_blocks: int = 0
    page_count: int = 0
    #: VLM calls made, and what they cost. Reported so a run's spend is a fact, not a guess.
    vlm_calls: int = 0
    vlm_tokens: int = 0


#: A caption sits directly under its float, or occasionally over it. Beyond this many points
#: away it is a caption for something else - findings.md B3 measured the old extractor searching
#: only a 60 pt band BELOW a single image rect, which is why 1 of 3 captions were found on
#: Attention and 1 of 4 on Neural ODEs.
CAPTION_MAX_GAP_PT = 90.0
#: ...and it must sit under the float, not beside it. Horizontal overlap is what distinguishes
#: "the caption of this figure" from "a caption in the other column at the same height", and
#: proximity alone cannot: on a two-column page the nearest region by vertical centre is
#: frequently the float in the OTHER column.
CAPTION_MIN_X_OVERLAP = 0.35


def _x_overlap_share(a: BBox, b: BBox) -> float:
    lo, hi = max(a[0], b[0]), min(a[2], b[2])
    smaller = min(a[2] - a[0], b[2] - b[0])
    return (hi - lo) / smaller if smaller > 0 else 0.0


def _overlaps(a: BBox, b: BBox, share: float) -> bool:
    """Whether `a` is covered by `b` by at least `share` of `a`'s own area."""
    lo_x, hi_x = max(a[0], b[0]), min(a[2], b[2])
    lo_y, hi_y = max(a[1], b[1]), min(a[3], b[3])
    if hi_x <= lo_x or hi_y <= lo_y:
        return False
    area = (a[2] - a[0]) * (a[3] - a[1])
    return area > 0 and (hi_x - lo_x) * (hi_y - lo_y) / area >= share


def _nearest_float(
    caption: BBox, candidates: list[tuple[Any, AssembledBlock]]
) -> tuple[Any, AssembledBlock] | None:
    """The float a caption belongs to: overlapping in x, adjacent in y, nearest of those.

    Three constraints rather than one distance, because each rules out a failure the others
    permit: x-overlap rules out the other column, the gap rules out a float three paragraphs
    away, and "nearest" then picks among genuine candidates.
    """
    viable = []
    for pair in candidates:
        box = pair[0].bbox
        if _x_overlap_share(caption, box) < CAPTION_MIN_X_OVERLAP:
            continue
        # Distance between the two edges that would touch: the float's bottom to the caption's
        # top (caption below, the usual case) or the caption's bottom to the float's top.
        gap = min(abs(caption[1] - box[3]), abs(box[1] - caption[3]))
        if gap <= CAPTION_MAX_GAP_PT:
            viable.append((gap, pair))
    if not viable:
        return None
    return min(viable, key=lambda item: item[0])[1]


def _dedupe_tables(regions: list[Any]) -> list[Any]:
    """Drop table regions that substantially overlap one already kept.

    Rule groups can produce two regions over the same table when a mid-rule is slightly narrower
    than the top rule. Emitting both gives two sets of cells at identical positions with
    identical text - and identical block ids, because the id hashes exactly (page, anchor, type,
    text). Measured on ResNet: 858 blocks producing 856 ids, which `PaperBuilder` rejects rather
    than salting, since a collision here is a segmentation bug and not an id bug.
    """
    kept: list[Any] = []
    for region in sorted(regions, key=lambda r: -(r.bbox[2] - r.bbox[0]) * (r.bbox[3] - r.bbox[1])):
        overlapping = False
        for existing in kept:
            lo_x, hi_x = (
                max(region.bbox[0], existing.bbox[0]),
                min(region.bbox[2], existing.bbox[2]),
            )
            lo_y, hi_y = (
                max(region.bbox[1], existing.bbox[1]),
                min(region.bbox[3], existing.bbox[3]),
            )
            if hi_x > lo_x and hi_y > lo_y:
                area = (region.bbox[2] - region.bbox[0]) * (region.bbox[3] - region.bbox[1])
                if area > 0 and (hi_x - lo_x) * (hi_y - lo_y) / area > 0.5:
                    overlapping = True
                    break
        if not overlapping:
            kept.append(region)
    return kept


def _merge_equation_blocks(
    blocks: tuple[LayoutBlock, ...], regions: list[Any]
) -> list[LayoutBlock]:
    """One block per display equation, because the REGION knows its extent and layout does not.

    Layout runs before equation detection - it has to, since `detect_equation_regions` needs the
    body line stream - so it segments a display equation with the same rules it uses on prose.
    A display equation is not prose. MuPDF returns its numerator, its denominator, its relation
    symbol and its right-margin number as separate lines at different x, and `_same_block`'s
    indent rule then splits every one of them into its own block.

    Measured against gold on `neural-odes-mathheavy` page 14: **17 gold equations, 66 predicted
    blocks, and not one match at IoU 0.5**. Fragments like `'dht+1\\ndht ='`, `'dht .'` and
    `'(35)\\ndt'` are each a correct piece of an equation and none of them is an equation.

    So the fragments a region already claims are re-joined into the one block that region
    describes. Nothing about detection changes; this only stops layout's answer from overriding
    the more specific detector's, which is the same ordering principle issue #50 established for
    figures and headings.

    The merged block keeps the EARLIEST `order` of its parts, so its position in the flow is the
    position where the equation starts.
    """
    if not regions:
        return list(blocks)

    region_of: dict[int, int] = {}
    for index, region in enumerate(regions):
        for line in region.lines:
            region_of[id(line)] = index

    def sole_region(block: LayoutBlock) -> int | None:
        """The region this block belongs to entirely, or `None` if it straddles or is prose.

        Claimed lines only. A block sharing the equation's BAND but claimed by nothing - the
        `(35)` in the right margin is the standing example - is picked up by `_shares_the_band`
        below instead, and only if it is not prose.
        """
        if not block.lines:
            return None
        found = {region_of.get(id(line)) for line in block.lines}
        if len(found) != 1:
            return None
        only = found.pop()
        return only

    out: list[LayoutBlock] = []
    members: dict[int, list[LayoutBlock]] = {}
    unclaimed: list[LayoutBlock] = []
    for block in blocks:
        claimed_by = sole_region(block)
        if claimed_by is None:
            unclaimed.append(block)
        else:
            members.setdefault(claimed_by, []).append(block)

    # THE EQUATION NUMBER IS LEFT OUT, DELIBERATELY, AFTER TRYING THE OTHER WAY.
    #
    # `(35)` sits at the right margin, is claimed by no region, and forms its own block - so the
    # merged equation's box stops short of it while gold runs to the column edge. The obvious fix
    # is to absorb any non-prose block sharing the region's vertical band, and it was written,
    # measured and removed: on `neural-odes` p14 it took the count from 16 predicted against 17
    # gold to **6**, chaining several distinct equations into one block through the fragments
    # between them. Trading a boxing-convention gap for a merge that destroys real boundaries is
    # a worse document, and the near-miss column now makes that visible either way.
    out.extend(unclaimed)

    for group in members.values():
        if len(group) == 1:
            out.append(group[0])
            continue
        lines = tuple(
            line for block in sorted(group, key=lambda b: b.order) for line in block.lines
        )
        # The union of what was merged, NOT `regions[index].bbox`. The region's own extent covers
        # only the lines its seed rules claimed, so a block absorbed by `_shares_the_band` - the
        # right-margin equation number, most often - would sit outside the box describing it, and
        # `assemble.py` would then rebuild the polygon from the lines anyway and disagree.
        bands = [line.band for block in group for line in block.lines]
        out.append(
            LayoutBlock(
                lines=lines,
                flow=group[0].flow,
                column=group[0].column,
                bbox=[
                    min(b[0] for b in bands),
                    min(b[1] for b in bands),
                    max(b[2] for b in bands),
                    max(b[3] for b in bands),
                ],
                order=min(block.order for block in group),
            )
        )
    return sorted(out, key=lambda b: b.order)


#: Quantile of a column's body-line right edges taken as its right text margin. See
#: `_right_text_margins` for why it is a quantile rather than the maximum.
RIGHT_MARGIN_QUANTILE = 0.90


def _right_text_margins(page_layout: Any) -> dict[int | None, float]:
    """Where each column's text actually stops, per page, from the body lines themselves.

    NOT `PageLayout.columns[i].x1`. A `Column` is a PARTITION of the page - on a single-column
    page `detect_columns` returns `Column(0, 0.0, page_width)`, so its `x1` is 612.0 on every
    paper in this corpus and extending anything to it would run a display equation 100 pt past
    the last glyph on the page. Measured on `neural-odes-mathheavy` p14: `columns == [(0, 612)]`
    while the body text stops at **504.00** and gold's own right edges sit at 507-531.

    A QUANTILE, NOT THE MAXIMUM, because one stray wide line moves a maximum and cannot move a
    quantile: `resnet-cvpr-2col` p0 column 0 has a p50 of 286.37 and a **max of 441.78** - the
    title, set across the measure on a page whose body is two columns. p90 on the pages that
    carry gold equations lands within 1.75 pt of the maximum every time (neural-odes p14
    504.00 vs 505.49; attention p3 504.17 vs 505.65; resnet p2 286.37/545.11 vs 286.37/545.12),
    so the robustness is free.

    `None` is a real key - `layout.py` gives a full-width block no column - and it takes the
    widest margin on the page, which is what "full width" means.
    """
    rights: dict[int | None, list[float]] = {}
    for block in page_layout.blocks:
        if block.flow != "body":
            continue
        for line in block.lines:
            rights.setdefault(block.column, []).append(line.band[2])
    margins: dict[int | None, float] = {}
    for column, edges in rights.items():
        edges.sort()
        margins[column] = edges[min(int(RIGHT_MARGIN_QUANTILE * len(edges)), len(edges) - 1)]
    if margins:
        margins[None] = max(margins.values())
    return margins


def _extend_to_right_margin(bands: list[BBox], margin: float | None) -> list[BBox]:
    """A display equation's bands, run out to the right text margin. HORIZONTAL ONLY.

    WHY THIS IS THE SHAPE OF THE FIX, AND WHY IT IS RIGHT-EDGE-ONLY.

    Gold boxes a display equation across the measure of its column *including the right-margin
    equation number*; the parser boxes the glyph bands, so `(35)` - which is claimed by no
    equation region and forms its own block - falls outside the box describing the equation it
    numbers. That gap is worth **0 matches at IoU 0.5 against 21 gold equations** corpus-wide.

    `EPIC-01-RESULT.md` and issue #55 both describe gold as boxing "the full column width". It
    does not, and the difference decides the shape of the fix. Re-measured here on
    `neural-odes-mathheavy` p14's 17 gold equations:

        right edges   507.06  508.98  510.90  513.30  513.30  513.78  515.22  515.22  515.22
                      516.18  517.14  518.10  521.46  531.54   ... plus 187.38 198.42 400.50
        left  edges   109.14  111.54  116.34  134.58  136.50 x5  176.82  201.78  228.18
                      248.34  256.02  258.90  276.66  323.22

    Fourteen of seventeen right edges sit in a 24 pt band at the column's right margin. The left
    edges scatter over **214 pt**, because a centred display equation is left where its glyphs
    are. So a symmetric extension to both column bounds would over-box 9 of 17 on the left; the
    right edge is the only one gold actually supports, and it is the only one moved here.

    The VERTICAL approach is separately measured and reverted - see `_merge_equation_blocks`.
    """
    if margin is None:
        return bands
    return [[band[0], band[1], max(band[2], margin), band[3]] for band in bands]


def _block_type(flow: str, text: str, is_heading: bool, is_equation: bool) -> str:
    # A block opening `Figure 3.` / `Table 1:` IS a caption, whatever flow it landed in.
    # Rule 22 requires `caption_of.from` to be a `caption` block, and the flow classifier does
    # not always route these correctly - so the NUMBERING decides the type, which is the same
    # signal `figures.py` uses to link the caption to its float.
    if is_caption_line(text) is not None:
        return "caption"
    if is_heading:
        return "heading"
    if is_equation:
        return "equation"
    if flow == "caption":
        return "caption"
    if flow == "footnote":
        return "footnote"
    if flow in ("header", "footer"):
        return "page_number" if text.strip().isdigit() else flow
    if flow == "margin":
        return "margin_note"
    return "paragraph"


def parse_document(
    path: str | Path,
    *,
    paper_id: str,
    asset_root: Path,
    config: ParserConfig | None = None,
    parsed_at: str = DEFAULT_PARSED_AT,
) -> ParseResult:
    """Parse one PDF into a validated PaperIR document.

    `asset_root` must live OUTSIDE the repository: CI's codegen-drift step is a whole-tree
    `git status --porcelain --untracked-files=all`, and `.gitignore` covers none of these paths.
    """
    config = config or ParserConfig()

    document = SourceDocument(path)
    try:
        pages = document.pages()
        profile = classify_document(document, pages)
        layout = layout_document(pages)
        source_hash = document.source_hash
        return _assemble(
            document, pages, layout, profile, source_hash, paper_id, asset_root, config, parsed_at
        )
    finally:
        document.close()


def _assemble(
    document: SourceDocument,
    pages: list[Any],
    layout: Any,
    profile: Any,
    source_hash: str,
    paper_id: str,
    asset_root: Path,
    config: ParserConfig,
    parsed_at: str,
) -> ParseResult:

    builder = PaperBuilder(source_hash=source_hash, paper_id=paper_id, profile=profile)
    builder.frames = [page.frame for page in pages]

    all_headings = []
    all_body: list[LayoutBlock] = []
    emitted: dict[int, AssembledBlock] = {}
    pending_grids: list[tuple[AssembledBlock, list[tuple[int, int, AssembledBlock]]]] = []
    #: Page 0's body size, kept for `frontmatter.py`. The title ratio has to be measured against
    #: the page the title is ON - a later page's body size would be the same number by luck on
    #: this corpus and wrong on any paper whose front matter is set differently from its body.
    front_matter_body_size = 10.0

    for page, page_layout in zip(pages, layout.pages, strict=True):
        sizes = [
            span.size
            for block in page_layout.blocks
            if block.flow == "body"
            for line in block.lines
            for span in line.spans
            if span.size > 0
        ]
        body_size = median(sizes) if sizes else 10.0
        if page.index == 0:
            front_matter_body_size = body_size
        column_width = page_layout.columns[0].x1 - page_layout.columns[0].x0

        # TABLES FIRST, for the same reason figures run before layout: a table's cells are
        # interleaved in y with body text on a two-column page, and a cell promoted to a heading
        # is findings.md B6's `'0.24 M'` defect. Their lines are claimed here so neither equation
        # detection nor hierarchy sees them.
        table_regions = _dedupe_tables(detect_tables(page, column_width))
        table_lines: set[int] = set()
        float_blocks: list[tuple[Any, AssembledBlock]] = []
        for region in table_regions:
            table_block = builder.add(
                AssembledBlock(
                    type="table",
                    page_index=page.index,
                    flow="body",
                    line_bands=[list(region.bbox)],
                    confidence=0.75,
                    stage="tables",
                    # `html` is deliberately absent - rule 32b, see tables.py.
                    # `grid.cells` needs every cell's block_id, which does not exist until
                    # assign_ids() runs - so the grid is filled in after, exactly like crops.
                    # `html` is deliberately absent (rule 32b, see tables.py).
                    payload={"grid": {"rows": len(region.rows), "cols": region.column_count}},
                )
            )
            float_blocks.append((region, table_block))
            grid_cells: list[tuple[int, int, AssembledBlock]] = []
            for row_index, row in enumerate(region.rows):
                row_block = builder.add(
                    AssembledBlock(
                        type="table_row",
                        page_index=page.index,
                        flow="body",
                        line_bands=[list(row.bbox)],
                        confidence=0.75,
                        stage="tables",
                        parent=table_block,
                    )
                )
                for column_index, (cell_box, cell_text) in enumerate(row.cells):
                    cell_block = builder.add(
                        AssembledBlock(
                            type="table_cell",
                            page_index=page.index,
                            flow="body",
                            line_bands=[list(cell_box)],
                            text=cell_text or None,
                            confidence=0.75,
                            stage="tables",
                            parent=row_block,
                        )
                    )
                    grid_cells.append((row_index, column_index, cell_block))
            pending_grids.append((table_block, grid_cells))
            for line in page.lines:
                centre_y = (line.band[1] + line.band[3]) / 2
                if not (region.bbox[1] - 2 <= centre_y <= region.bbox[3] + 2):
                    continue
                # A CAPTION IS NEVER A TABLE CELL, even when it sits inside the rule group's
                # vertical span - and on this corpus it routinely does, because a table's
                # caption is set above its toprule and inside the same float.
                #
                # Measured on ResNet: 10 blocks open with a `Figure N` / `Table N` marker and
                # only 4 survived to be typed `caption`. The other 6 - exactly its table count -
                # were swallowed here and re-emitted as cells, which capped figures.spec's
                # ">=80% captioned" clause at a level no linker could reach. The captions were
                # never missing; they were being consumed.
                if is_caption_line(line.text.strip()) is not None:
                    continue
                table_lines.add(id(line))

        body_lines = [
            line
            for b in page_layout.blocks
            if b.flow == "body"
            for line in b.lines
            if id(line) not in table_lines
        ]
        equation_regions = detect_equation_regions(body_lines, column_width, body_size)
        equation_lines = {id(line) for region in equation_regions for line in region.lines}

        # HEADINGS ARE DETECTED LAST, and that ordering is the fix for a measured defect.
        #
        # Running it first gave a3c 156 heading candidates and gpt3-longform 324, against real
        # section counts of 7-25, and ResNet emitted `'y = F(x, {Wi}) + x.'` - a display
        # equation - as a heading. A heading detector cannot tell a short isolated line set
        # slightly larger than the body from a numbered display equation or a table row,
        # because geometrically they ARE the same thing.
        #
        # So the two stronger, more specific detectors run first and claim their lines, and
        # hierarchy sees only what is left. Same ordering figures already forced (issue #50).
        claimed = table_lines | equation_lines
        headings = [
            heading
            for heading in detect_headings(page_layout, body_size)
            if not (
                heading.block.lines and all(id(line) in claimed for line in heading.block.lines)
            )
        ]
        heading_blocks = {id(h.block) for h in headings}
        all_headings.extend(headings)

        right_margins = _right_text_margins(page_layout)

        for layout_block in _merge_equation_blocks(page_layout.blocks, equation_regions):
            if layout_block.lines and all(id(line) in table_lines for line in layout_block.lines):
                continue  # every line already emitted as a table cell
            built = build_block_text(list(layout_block.lines))
            if not built.text.strip():
                continue
            is_equation = bool(layout_block.lines) and all(
                id(line) in equation_lines for line in layout_block.lines
            )
            block_type = _block_type(
                layout_block.flow,
                built.text,
                id(layout_block) in heading_blocks,
                is_equation,
            )
            payload: dict[str, Any] | None = None
            line_bands = [line.band for line in layout_block.lines]
            if block_type == "equation":
                # D16 / rule 36: `image` is required-and-NULLABLE. Null while the render step is
                # outstanding, which is why `status` is not `complete` until crops exist.
                payload = {"display": True, "image": None}
                # THE BANDS ARE WIDENED, NOT THE BLOCK'S bbox, because the bbox is COMPUTED.
                # `assemble._geometry` builds the polygon from `line_bands` and rule 1 makes
                # `bbox` the polygon's extent, so a `LayoutBlock.bbox` set here is discarded.
                # This also fixes a second thing for free: two fragments of one equation at
                # disjoint x (a numerator at 320-347 and its `(35)` at 490-505) produced two
                # rings, and `_geometry` keeps only the largest.
                line_bands = _extend_to_right_margin(
                    line_bands, right_margins.get(layout_block.column)
                )

            assembled = builder.add(
                AssembledBlock(
                    type=block_type,
                    page_index=page.index,
                    flow=layout_block.flow,
                    line_bands=line_bands,
                    text=built.text,
                    spans=built.spans,
                    repairs=built.repairs,
                    confidence=1.0 if block_type != "unknown" else 0.3,
                    payload=payload,
                    column=layout_block.column,
                    stage="layout",
                )
            )
            emitted[id(layout_block)] = assembled
            if layout_block.flow == "body":
                all_body.append(layout_block)

        # FIGURES ARE EMITTED FOR EVERY DETECTED REGION, captioned or not.
        #
        # An earlier version created the figure block INSIDE the caption-linking loop, so a
        # figure whose caption was not detected produced no block at all. PTUB measured the
        # result: ResNet yielded **0 figures** against an acceptance bar of >=5, while
        # `detect_figure_regions` was finding 12 - the regions existed and were being thrown
        # away. That is findings.md B3's "zero figures on ResNet" re-created one layer up.
        #
        # A figure is a figure because there is ink on the page. A caption is a separate fact.
        # A REGION THAT OVERLAPS A DETECTED TABLE IS THAT TABLE, NOT A FIGURE. Both are found by
        # clustering ink, so a bordered table's interior rules and cell borders cluster exactly
        # like a diagram would. Emitting both gives two blocks over one object, and it caps
        # caption linking: ResNet reported 11 figure regions for ~6 real figures, so at most
        # ~55% could ever carry a caption however good the linker was.
        #
        # Tables win because they were found by a STRONGER signal - a booktabs rule group is
        # unambiguous where an ink cluster is a heuristic.
        # Rule 22: `caption_of.to` may point at a figure, table, diagram or plot. TABLES ARE
        # OFFERED AS LINK TARGETS TOO - roughly half of this corpus's captions are "Table N",
        # and with only figures on offer they had nothing legal to bind to.
        figure_blocks: list[tuple[Any, AssembledBlock]] = []
        # Deduplicated by QUANTISED TOP-LEFT ANCHOR, because that is what the id hashes. A
        # figure carries no text, so two regions sharing a 1 pt-quantised (x0, y0) produce the
        # SAME block_id - `block_id` hashes (source_hash, page, x0, y0, type, text-prefix) and
        # every one of those is equal. a3c hit it: 1011 blocks, 1009 ids.
        seen_anchors: set[tuple[int, int]] = set()
        for region in detect_figure_regions(page):
            anchor = (round(region.bbox[0]), round(region.bbox[1]))
            if anchor in seen_anchors:
                continue
            if any(_overlaps(region.bbox, t.bbox, 0.5) for t in table_regions):
                continue
            seen_anchors.add(anchor)
            figure_blocks.append(
                (
                    region,
                    builder.add(
                        AssembledBlock(
                            type="figure",
                            page_index=page.index,
                            flow="body",
                            line_bands=[list(region.bbox)],
                            source="pdf_vector" if region.is_vector else "pdf_raster",
                            confidence=0.8 if region.is_vector else 0.9,
                            # D20: `is_vector` is DECOUPLED from Block.source, so it is stated
                            # rather than left for a consumer to infer from the source kind.
                            payload={"is_vector": region.is_vector, "image": None},
                            stage="figures",
                        )
                    ),
                )
            )

        # Caption -> float linking, by NUMBERING first and proximity second. Proximity alone
        # attaches a caption to whichever float is nearest, which is wrong the moment two floats
        # share a page.
        unlinked = float_blocks + figure_blocks
        for layout_block in page_layout.blocks:
            if id(layout_block) not in emitted or not unlinked:
                continue
            caption = emitted[id(layout_block)]
            if caption.type != "caption":
                continue  # rule 22: caption_of.from must be a `caption` block
            band = caption.line_bands[0] if caption.line_bands else [0.0, 0.0, 0.0, 0.0]
            match = _nearest_float(band, unlinked)
            if match is None:
                continue
            builder.relate("caption_of", caption, match[1], 0.8, "geometric+numbering")
            unlinked.remove(match)

    sections = build_sections(all_headings, all_body)
    # RULE 21: a section's `heading_block_id` must name a block of a KNOWN HEADING type - only
    # `title` or `heading`. `detect_headings` works on layout blocks, but the final type is
    # decided later and a heading-shaped line that opens `Figure 3.` becomes a `caption`, so a
    # node can survive detection and then point at a non-heading. Filtered here rather than
    # earlier, because this is the first point at which the emitted type is known.
    builder.sections = [
        (
            emitted[id(node.heading_block)],
            node.level,
            emitted.get(id(node.parent_heading_block)) if node.parent_heading_block else None,
            [emitted[id(b)] for b in node.member_blocks if id(b) in emitted],
        )
        for node in sections
        if id(node.heading_block) in emitted
        and emitted[id(node.heading_block)].type in ("heading", "title")
    ]

    # FRONT MATTER IS TYPED HERE, AND THE POSITION IS LOAD-BEARING TWICE OVER.
    #
    # After the section tree (above), because retyping the `Abstract` heading would break rule
    # 21 - a section's `heading_block_id` must name a `heading` or `title` - and `frontmatter`
    # is careful to leave the heading alone precisely so this ordering stays safe.
    #
    # Before `assign_ids()`, because `block_id` hashes the block TYPE. Retyping afterwards would
    # leave every front-matter block carrying an id minted for the type it used to have, and
    # `worker/determinism.spec` would still pass, because the wrong ids would be wrong the same
    # way every run.
    for retype in classify_front_matter(builder.blocks, front_matter_body_size):
        retype.block.type = retype.new_type
    # Same layer, same reason: `reference_entry` is a type, and `block_id` hashes the type.
    for entry in classify_reference_entries(builder.blocks):
        entry.block.type = entry.new_type

    # RULE 36: `status: "complete"` requires a non-null crop on every equation and figure. The
    # ids have to exist first, because the crop's URI names the block - hence assign_ids() here
    # rather than only inside build().
    builder.assign_ids()

    # RULE 32: every `grid.cells[].text` must equal the text of the block named by `cell_id`,
    # and `cell_id` must name a `table_cell` on the same page. Filled here rather than at
    # emission because the ids do not exist until now.
    for table_block, cells in pending_grids:
        assert table_block.payload is not None
        table_block.payload["grid"]["cells"] = [
            {
                "cell_id": cell.block_id,
                "r": row_index,
                "c": column_index,
                "polygon": cell.polygon,
                **({"text": cell.text} if cell.text else {}),
            }
            for row_index, column_index, cell in cells
        ]

    store = CropStore(
        root=asset_root, paper_id=paper_id, scheme=config.asset_scheme, scale=config.crop_scale
    )
    for block in builder.blocks:
        if block.type not in ("equation", "inline_equation", "figure") or block.payload is None:
            continue
        raw_page = document.raw_page(block.page_index)
        block.payload["image"] = store.render(
            raw_page,
            block.bbox,
            kind="figures" if block.type == "figure" else "equations",
            block_id=block.block_id,
            rendered_from="vector" if block.source == "pdf_vector" else "page",
        )

    # F1.8, over the assembled body stream in reading order. Needs geometry, so it runs after
    # assign_ids() has computed every bbox.
    body_blocks = [b for b in builder.blocks if b.flow == "body" and not b.is_nested]
    continuations = find_continuations(
        [
            (index, b.type, b.text or "", b.bbox[0], b.bbox[2], b.page_index)
            for index, b in enumerate(body_blocks)
        ]
    )
    for link in continuations:
        # `continues_in_next_column` needs two GENUINELY DIFFERENT columns. Inferring it from
        # non-overlapping x alone fired 463 times on gpt3-longform - a single-column paper -
        # because two fragments in one column need not overlap horizontally.
        if link.kind == "continues_in_next_column":
            earlier_column = body_blocks[link.from_index].column
            later_column = body_blocks[link.to_index].column
            if earlier_column is None or later_column is None or earlier_column == later_column:
                continue
        builder.relate(
            link.kind,
            body_blocks[link.from_index],
            body_blocks[link.to_index],
            link.confidence,
            "typographic",
        )

    # F1.7's VLM half: ONLY flagged regions, only when a budget is configured, and the crop is
    # always retained whatever happens. The LaTeX is a DECLARED INTERPRETATION with its own
    # confidence sitting beside the ground truth, never a source field (DESIGN.md §2.2).
    vlm_budget = VlmBudget(max_calls=config.vlm_max_calls)
    if config.vlm_max_calls > 0:
        client = VlmClient(model=config.vlm_model)
        if client.available:
            for block in builder.blocks:
                if block.type != "equation" or block.payload is None or vlm_budget.exhausted:
                    continue
                try:
                    reading = client.read_equation(
                        store.read("equations", block.block_id), vlm_budget
                    )
                except VlmError:
                    # A failed call leaves the crop and no latex, which is a valid document.
                    # Never a partial reading.
                    continue
                if reading is not None and reading.latex:
                    block.payload["latex"] = reading.latex
                    block.payload["latex_confidence"] = reading.confidence

    paper = builder.build(
        config_hash=config_hash_for(config.as_dict()),
        parsed_at=parsed_at,
    )
    # `assert_valid_paper` raises on any ERROR and returns None; `validate_paper` yields the
    # full report. Both are called: the assertion is the gate, the report is what surfaces the
    # WARN-level findings (rule 3, G6, G8) that are legal but worth carrying.
    assert_valid_paper(paper)
    report = validate_paper(paper)
    return ParseResult(
        paper=paper,
        diagnostics=list(report.diagnostics),
        multi_polygon_blocks=builder.multi_polygon_blocks,
        page_count=len(pages),
        crops_written=store.written,
        vlm_calls=vlm_budget.calls,
        vlm_tokens=vlm_budget.input_tokens + vlm_budget.output_tokens,
    )
