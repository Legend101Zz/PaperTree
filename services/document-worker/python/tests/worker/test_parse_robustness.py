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
