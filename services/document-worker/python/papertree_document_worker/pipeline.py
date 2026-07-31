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

from papertree_document_ir.validate import assert_valid_paper, validate_paper

from papertree_document_worker.assemble import AssembledBlock, PaperBuilder, config_hash_for
from papertree_document_worker.classify import classify_document
from papertree_document_worker.crops import DEFAULT_SCALE, CropStore
from papertree_document_worker.equations import detect_equation_regions
from papertree_document_worker.figures import detect_figure_regions, is_caption_line
from papertree_document_worker.hierarchy import build_sections, detect_headings
from papertree_document_worker.layout import LayoutBlock, layout_document
from papertree_document_worker.pdf import SourceDocument
from papertree_document_worker.text import build_block_text

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


def _block_type(flow: str, text: str, is_heading: bool, is_equation: bool) -> str:
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
        column_width = page_layout.columns[0].x1 - page_layout.columns[0].x0

        headings = detect_headings(page_layout, body_size)
        heading_blocks = {id(h.block) for h in headings}
        all_headings.extend(headings)

        body_lines = [line for b in page_layout.blocks if b.flow == "body" for line in b.lines]
        equation_regions = detect_equation_regions(body_lines, column_width, body_size)
        equation_lines = {id(line) for region in equation_regions for line in region.lines}

        for layout_block in page_layout.blocks:
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
            if block_type == "equation":
                # D16 / rule 36: `image` is required-and-NULLABLE. Null while the render step is
                # outstanding, which is why `status` is not `complete` until crops exist.
                payload = {"display": True, "image": None}

            assembled = builder.add(
                AssembledBlock(
                    type=block_type,
                    page_index=page.index,
                    flow=layout_block.flow,
                    line_bands=[line.band for line in layout_block.lines],
                    text=built.text,
                    spans=built.spans,
                    repairs=built.repairs,
                    confidence=1.0 if block_type != "unknown" else 0.3,
                    payload=payload,
                    stage="layout",
                )
            )
            emitted[id(layout_block)] = assembled
            if layout_block.flow == "body":
                all_body.append(layout_block)

        # Caption -> float linking, by NUMBERING first and proximity second. Proximity alone
        # attaches a caption to whichever float is nearest, which is wrong the moment two floats
        # share a page.
        figure_regions = detect_figure_regions(page)
        for layout_block in page_layout.blocks:
            if layout_block.flow != "caption" or id(layout_block) not in emitted:
                continue
            text = " ".join(line.text for line in layout_block.lines)
            parsed = is_caption_line(text)
            if parsed is None or not figure_regions:
                continue
            caption = emitted[id(layout_block)]
            nearest = min(
                figure_regions,
                key=lambda r: (
                    abs((r.bbox[1] + r.bbox[3]) / 2 - caption.bbox[1]) if caption.bbox else 0.0
                ),
            )
            figure = builder.add(
                AssembledBlock(
                    type="figure",
                    page_index=page.index,
                    flow="body",
                    line_bands=[list(nearest.bbox)],
                    source="pdf_vector" if nearest.is_vector else "pdf_raster",
                    confidence=0.8,
                    # `is_vector` is decoupled from `Block.source` by D20, so it is stated in the
                    # payload rather than inferred by a consumer from the source kind.
                    payload={"is_vector": nearest.is_vector, "image": None},
                    stage="figures",
                )
            )
            builder.relate("caption_of", caption, figure, 0.8, "geometric+numbering")
            figure_regions.remove(nearest)

    sections = build_sections(all_headings, all_body)
    builder.sections = [
        (
            emitted[id(node.heading_block)],
            node.level,
            emitted.get(id(node.parent_heading_block)) if node.parent_heading_block else None,
            [emitted[id(b)] for b in node.member_blocks if id(b) in emitted],
        )
        for node in sections
        if id(node.heading_block) in emitted
    ]

    # RULE 36: `status: "complete"` requires a non-null crop on every equation and figure. The
    # ids have to exist first, because the crop's URI names the block - hence assign_ids() here
    # rather than only inside build().
    builder.assign_ids()
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
    )
