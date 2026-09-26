"""S2 (#141): no real paper may dead-letter. The synthetic half, so CI runs it without a corpus.

Each defect here was found on a REAL paper first (`test_fresh_papers.py` holds the real-parse
half, gated on `./research/benchmarks/fresh/fetch_fresh.sh`). The PDFs below are built in process
with PyMuPDF, reproducing the defect's exact shape, because the corpus and the fresh set are both
gitignored and a suite that only runs locally reports green on CI by never executing
(`AGENTS.md` §4).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from papertree_document_ir.validate import validate_paper
from papertree_document_worker.pdf import SourceDocument, pymupdf
from papertree_document_worker.pipeline import parse_document

PAPER_ID = "ppr_0123456789ABCDEFGHJKMNP0TV"
PAGE_W, PAGE_H = 612.0, 792.0


def _png() -> bytes:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 16, 16))
    pixmap.set_rect(pixmap.irect, (20, 120, 200))
    return bytes(pixmap.tobytes("png"))


def _page_with_body(document: Any) -> Any:
    page = document.new_page(width=PAGE_W, height=PAGE_H)
    for index in range(12):
        page.insert_text(
            (72, 90 + index * 14),
            f"Body line {index} of the synthetic page, long enough to be ordinary prose.",
            fontsize=10,
            fontname="helv",
        )
    return page


# ── G7: an image placement that overhangs the crop box ────────────────────────────────────────


@pytest.fixture(scope="module")
def overhanging_image(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """DDPM p0's shape: a raster placed at [347.6, 467.9, 661.5, 781.9] on a 612 pt page.

    That is its real placement (arXiv 2006.11239v2, page 0): the figure's right edge runs 49.5 pt
    off the page. MuPDF reports the placement rect, not the visible part of it, so the figure
    block inherited a polygon outside the crop box and validator G7 failed the whole document.
    A second placement sits ENTIRELY off the page (x 640-700): its crop is a zero-size pixmap,
    which MuPDF refuses to encode (`Invalid bandwriter header dimensions/setup`), so before the
    clip it crashed the parse outright rather than failing validation.
    """
    out = tmp_path_factory.mktemp("overhang") / "overhang.pdf"
    document = pymupdf.open()
    page = _page_with_body(document)
    png = _png()
    page.insert_image(pymupdf.Rect(347.6, 467.9, 661.5, 781.9), stream=png)
    page.insert_image(pymupdf.Rect(640, 100, 700, 160), stream=png)
    document.save(str(out))
    document.close()
    return out


def test_image_overhang_is_clipped(overhanging_image: Path) -> None:
    """Every placement is intersected with the crop box; one wholly outside it is dropped."""
    with SourceDocument(overhanging_image) as source:
        page = source.page(0)
        boxes = [[round(v, 1) for v in image.bbox] for image in page.images]
    # The overhanging one keeps exactly its visible part; the off-page one is gone.
    assert boxes == [[347.6, 467.9, PAGE_W, 781.9]]


def test_a_paper_with_an_overhanging_image_parses_and_validates(
    overhanging_image: Path, tmp_path: Path
) -> None:
    """The document-level consequence: it used to raise G7 (or crash in crops.py)."""
    paper = parse_document(overhanging_image, paper_id=PAPER_ID, asset_root=tmp_path).paper
    assert validate_paper(paper).ok
    figures = [b for b in paper.blocks if b.type == "figure"]
    assert len(figures) == 1
    x0, y0, x1, y1 = figures[0].bbox
    assert 0 <= x0 < x1 <= PAGE_W and 0 <= y0 < y1 <= PAGE_H


# ── R21: a section orphaned when its parent's heading is retyped as a caption ─────────────────


@pytest.fixture(scope="module")
def retyped_heading(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """DDPM's shape: `Algorithm 3 Sending x0` is set bold, so it is detected as a heading, pushed
    on the section stack, and parents the numbered `4.2` and `4.3` that follow. Then
    `_block_type` retypes it `caption` (it opens `Algorithm N`), its section is filtered out, and
    `4.2`/`4.3` point at a heading that no longer opens a section: validator R21, dead letter.
    """
    out = tmp_path_factory.mktemp("retyped") / "retyped.pdf"
    document = pymupdf.open()
    page = document.new_page(width=PAGE_W, height=PAGE_H)
    y = 80.0

    def line(text: str, font: str = "helv", size: float = 10, gap: float = 13) -> None:
        nonlocal y
        page.insert_text((72, y), text, fontsize=size, fontname=font)
        y += gap

    def paragraph(name: str) -> None:
        nonlocal y
        for index in range(3):
            line(f"Paragraph text line {index} of {name}, set in the body font at body size here.")
        y += 6

    line("1 Introduction", "hebo", 12, 18)
    paragraph("intro")
    line("2 Method", "hebo", 12, 18)
    paragraph("method")
    line("Algorithm 1 Training the model", "hebo", 10, 14)
    paragraph("algorithm")
    line("2.1 Details", "hebo", 10, 14)
    paragraph("details")
    line("3 Results", "hebo", 12, 18)
    paragraph("results")
    document.save(str(out))
    document.close()
    return out


def test_retyped_heading_reparents(retyped_heading: Path, tmp_path: Path) -> None:
    """`2.1` is re-parented to `2 Method`, the nearest preceding section one level up, and the
    retyped caption's blocks stay inside a section instead of falling out of the tree."""
    paper = parse_document(retyped_heading, paper_id=PAPER_ID, asset_root=tmp_path).paper
    assert validate_paper(paper).ok
    text = {b.block_id: (b.text or "") for b in paper.blocks}
    by_title = {text[s.heading_block_id].split("\n")[0]: s for s in paper.sections}
    assert sorted(by_title) == ["1 Introduction", "2 Method", "2.1 Details", "3 Results"]
    details, method = by_title["2.1 Details"], by_title["2 Method"]
    assert details.parent_heading_block_id == method.heading_block_id
    assert (details.level, method.level) == (2, 1)
    caption = next(b for b in paper.blocks if (b.text or "").startswith("Algorithm 1"))
    assert caption.type == "caption"
    # The caption and the paragraph under it read inside section 2, where they are printed.
    algorithm_body = next(b for b in paper.blocks if "of algorithm" in (b.text or ""))
    assert caption.block_id in method.block_ids
    assert algorithm_body.block_id in method.block_ids


def test_an_orphan_with_no_section_one_level_up_becomes_top_level() -> None:
    """The fallback: with no preceding section one level up, the orphan is level 1, and every
    descendant's level is re-derived from its parent (rule 21: level == parent.level + 1)."""
    from papertree_document_worker.hierarchy import SectionNode, reparent_orphans
    from papertree_document_worker.layout import LayoutBlock

    def block() -> LayoutBlock:
        return LayoutBlock(lines=(), flow="body", column=None, bbox=[0.0, 0.0, 1.0, 1.0])

    dropped, orphan, child = block(), block(), block()
    kept = [
        SectionNode(orphan, 2, dropped, [block()]),
        SectionNode(child, 3, orphan, []),
    ]
    dropped_node = SectionNode(dropped, 1, None, [block()])
    out = reparent_orphans([dropped_node, *kept], keep=lambda node: node is not dropped_node)
    assert [(n.heading_block is orphan, n.level, n.parent_heading_block) for n in out[:1]] == [
        (True, 1, None)
    ]
    assert out[1].parent_heading_block is orphan and out[1].level == 2


# ── rule 8: a table region straddling two tables re-emits both tables' cells ──────────────────


def test_a_table_region_covered_by_two_kept_tables_is_dropped() -> None:
    """`maskrcnn-1703.06870` page 5, measured: two side-by-side ruled tables at
    [52.6, 227.9, 269.5, 339.8] and [288.6, 227.7, 545.9, 339.4], plus a third ruled region
    [205.0, 227.9, 334.9, 248.4] straddling both. Its cells ('softmax', '24.8', '25.1', ...)
    are the SAME text at the SAME place as cells the two real tables already emitted, so their
    content-derived ids collide: `848 blocks produced 842 ids`, a dead letter. It overlaps each
    table by under half its own area, so the one-at-a-time test kept it; together they cover
    85 % of it. Two real tables never share page area, so a region mostly covered by tables
    already kept is not a table.
    """
    from types import SimpleNamespace

    from papertree_document_worker.pipeline import _dedupe_tables

    left = SimpleNamespace(bbox=[52.6, 227.9, 269.5, 339.8])
    right = SimpleNamespace(bbox=[288.6, 227.7, 545.9, 339.4])
    straddle = SimpleNamespace(bbox=[205.0, 227.9, 334.9, 248.4])
    elsewhere = SimpleNamespace(bbox=[52.6, 500.0, 269.5, 600.0])
    kept = _dedupe_tables([right, straddle, left, elsewhere])
    assert straddle not in kept
    assert {id(r) for r in kept} == {id(left), id(right), id(elsewhere)}


# ── the salvage lane: an invalid document is emitted `partial`, never raised ─────────────────
#
# Each case INJECTS a real validation failure into a real parse - a defect that exists or existed
# in the parser, re-enabled - rather than hand-building an invalid document, so what is salvaged
# is exactly what the producer emits when it goes wrong.


def _text_blocks(paper: Any) -> list[tuple[str, int, str]]:
    """Every text block's (type, page, text), in document order: what salvage must preserve."""
    return [
        (b.type, b.page_index, b.text)
        for b in paper.blocks
        if b.text and b.type not in ("figure", "table", "table_row", "table_cell")
    ]


@pytest.fixture(scope="module")
def overhang_only(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """The DDPM shape alone: one raster hanging 49.5 pt off the right edge, among body text."""
    out = tmp_path_factory.mktemp("overhang-only") / "overhang-only.pdf"
    document = pymupdf.open()
    page = _page_with_body(document)
    page.insert_image(pymupdf.Rect(347.6, 467.9, 661.5, 781.9), stream=_png())
    document.save(str(out))
    document.close()
    return out


def test_invalid_ir_salvages_to_partial(
    overhang_only: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """G7, re-injected by disabling the crop-box clip: the figure is dropped, the text is not."""
    from papertree_document_worker import pdf

    clean = parse_document(overhang_only, paper_id=PAPER_ID, asset_root=tmp_path / "clean").paper
    assert clean.status == "complete"

    monkeypatch.setattr(pdf, "_clip_to_crop_box", lambda box, crop: box)
    salvaged = parse_document(overhang_only, paper_id=PAPER_ID, asset_root=tmp_path / "s").paper

    assert validate_paper(salvaged).ok
    assert salvaged.status == "partial"
    assert salvaged.partial_reason is not None
    assert "G7" in salvaged.partial_reason and "figure" in salvaged.partial_reason
    assert not [b for b in salvaged.blocks if b.type == "figure"]
    assert _text_blocks(salvaged) == _text_blocks(clean)
    # Deterministic like the rest of the parse: the same failure salvages the same way.
    again = parse_document(overhang_only, paper_id=PAPER_ID, asset_root=tmp_path / "s2").paper
    assert again.model_dump(mode="json", exclude={"parser"}) == salvaged.model_dump(
        mode="json", exclude={"parser"}
    )


def test_an_invalid_relation_is_dropped_and_nothing_else(
    retyped_heading: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """R24, injected: a `continues_on_next_page` edge between two blocks on the same page."""
    from papertree_document_worker import pipeline
    from papertree_document_worker.joining import Continuation

    clean = parse_document(retyped_heading, paper_id=PAPER_ID, asset_root=tmp_path / "c").paper
    monkeypatch.setattr(
        pipeline,
        "find_continuations",
        lambda blocks: [Continuation("continues_on_next_page", 1, 2, 0.9)],
    )
    salvaged = parse_document(retyped_heading, paper_id=PAPER_ID, asset_root=tmp_path / "s").paper
    assert validate_paper(salvaged).ok
    assert salvaged.status == "partial"
    assert salvaged.partial_reason is not None and "R24" in salvaged.partial_reason
    assert [b.block_id for b in salvaged.blocks] == [b.block_id for b in clean.blocks]
    assert salvaged.sections == clean.sections
    assert not [r for r in salvaged.relations if r.type == "continues_on_next_page"]


def test_an_orphaned_section_is_salvaged_by_the_same_reparent_rule(
    retyped_heading: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """R21, injected by turning `reparent_orphans` back into the filter it replaced."""
    from papertree_document_worker import pipeline

    def filter_only(sections: Any, keep: Any) -> Any:
        return [node for node in sections if keep(node)]

    clean = parse_document(retyped_heading, paper_id=PAPER_ID, asset_root=tmp_path / "c").paper
    monkeypatch.setattr(pipeline, "reparent_orphans", filter_only)
    salvaged = parse_document(retyped_heading, paper_id=PAPER_ID, asset_root=tmp_path / "s").paper
    assert validate_paper(salvaged).ok
    assert salvaged.status == "partial"
    assert salvaged.partial_reason is not None and "R21" in salvaged.partial_reason
    assert "re-attached" in salvaged.partial_reason
    assert _text_blocks(salvaged) == _text_blocks(clean)

    # Re-attached, not dropped: the same tree as the clean parse's, section for section.
    def tree(paper: Any) -> list[tuple[str, int, str | None]]:
        return [(s.heading_block_id, s.level, s.parent_heading_block_id) for s in paper.sections]

    assert tree(salvaged) == tree(clean)


@pytest.fixture(scope="module")
def text_off_the_page(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Text set past the right edge: its line bands leave the crop box on 4 of 5 blocks (G7)."""
    out = tmp_path_factory.mktemp("text-off") / "text-off.pdf"
    document = pymupdf.open()
    page = document.new_page(width=PAGE_W, height=PAGE_H)
    for index in range(6):
        page.insert_text(
            (72, 90 + index * 14),
            f"Body line {index} of the synthetic page, long enough to be ordinary prose.",
            fontsize=10,
            fontname="helv",
        )
    for group in range(4):
        for index in range(3):
            page.insert_text(
                (430, 300 + group * 60 + index * 14),
                f"Overhanging text line {index} runs off the right edge",
                fontsize=10,
                fontname="helv",
            )
    document.save(str(out))
    document.close()
    return out


def test_text_off_the_page_keeps_its_text_and_loses_only_geometry(
    text_off_the_page: Path, tmp_path: Path
) -> None:
    """Not injected - a PDF whose text runs off the page raised G7 before the salvage lane.
    Its text blocks are all kept, with their geometry clipped to the crop box.

    MuPDF already drops the glyphs wholly past the edge (`...runs off the right e`); the one it
    keeps STRADDLES the edge, and that glyph's band is what left the crop box."""
    paper = parse_document(text_off_the_page, paper_id=PAPER_ID, asset_root=tmp_path).paper
    assert validate_paper(paper).ok
    assert paper.status == "partial"
    assert paper.partial_reason is not None and "clipped" in paper.partial_reason
    texts = " ".join(b.text or "" for b in paper.blocks)
    for group_line in range(3):
        assert f"Overhanging text line {group_line} runs off the right e" in texts
    assert all(b.bbox[2] <= PAGE_W for b in paper.blocks)


def test_a_document_no_stage_can_salvage_re_raises_the_original_failure() -> None:
    """Salvage never invents a document: if nothing validates, the FIRST failure is the dead
    letter, not whatever the last stage tripped on."""
    from papertree_document_worker.salvage import build_or_salvage

    class Builder:
        blocks: list[Any] = []
        relations: list[Any] = []
        sections: list[Any] = []
        frames: list[Any] = []
        salvage_notes: list[str] = []
        salvage_rules: tuple[str, ...] = ()
        multi_polygon_blocks = 0
        bare_metadata = False
        emit_references = True

        def assign_ids(self) -> None:
            pass

    def build() -> Any:
        raise ValueError("the original failure")

    with pytest.raises(ValueError, match="the original failure"):
        build_or_salvage(Builder(), build)  # type: ignore[arg-type]
