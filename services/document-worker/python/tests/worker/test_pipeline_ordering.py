"""#50 — figure regions are detected BEFORE columns and paragraphs, and nothing may reorder it.

WHAT THE ORDERING IS, AND WHY IT IS NOT THE ONE THE EPIC FILE STATED

    F1.1 classify -> F1.2 text+geometry -> F1.5 figure REGIONS -> F1.3 columns/flows/order

`EPIC-01-ingest.md` said "F1.5, F1.6, F1.7 are parallel-safe once F1.2/F1.3 land", twice, and
building F1.3 first is what showed it backwards. ResNet page 3 carries Figure 3's architecture
diagram: ~40 interior labels at 4.92 pt against a 9.96 pt body, INTERLEAVED IN Y with the body
text of both columns. Fed to paragraph segmentation every label breaks the run. Epic 1 was
forbidden from editing the epic file, so the reversal lived only in `EPIC-01-RESULT.md` §6 and
in two module docstrings; the erratum is now in the epic file and this is the guard.

WHY A GUARD AT ALL, GIVEN IT ALREADY WORKS

`layout_page` removes `region.interior_lines` at one line. Nothing asserted it. Deleting that
line leaves every test in this repository green except the corpus × gold baselines added in
#95 — which skip on CI, because the corpus is gitignored. So on a clean checkout the ordering
could be reversed and CI would not notice.

The invariant tested here is the one that matters and is stronger than a block count: **no line
claimed by a figure region may appear in any body block.** A count can be matched by accident;
that cannot.

CI RUNS THE SYNTHETIC HALF. The corpus half skips loudly (AGENTS.md §4).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from _corpus_manifest import CORPUS_DIR as CORPUS
from _corpus_manifest import requires_corpus
from papertree_document_worker.figures import detect_figure_regions
from papertree_document_worker.layout import layout_document, layout_page
from papertree_document_worker.pdf import PageContent, SourceDocument, pymupdf


@pytest.fixture(scope="module")
def diagram_with_interior_labels(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """ResNet p3's shape, in miniature and in process.

    Two columns of ordinary body text at 10 pt, and between them a box of vector ink carrying
    small interior labels at 5 pt whose y-positions INTERLEAVE with the body lines. That
    interleaving is the whole defect: a label sitting between two body lines breaks the
    paragraph run in `_same_block`'s size rule.
    """
    out = tmp_path_factory.mktemp("ordering") / "diagram.pdf"
    document = pymupdf.open()
    page = document.new_page(width=612, height=792)

    body = "Residual learning eases the training of substantially deeper networks here."
    for row in range(12):
        y = 100 + row * 24
        page.insert_text((60, y), body[:44], fontsize=10)
        page.insert_text((330, y), body[:44], fontsize=10)

    # The figure: a filled rectangle of ink, wide enough and tall enough to clear
    # MIN_FIGURE_SIDE_PT/MIN_FIGURE_AREA_PT2, sitting in the middle of the page...
    page.draw_rect(pymupdf.Rect(180, 110, 300, 380), color=(0, 0, 0), width=1.5)
    page.draw_line(pymupdf.Point(180, 240), pymupdf.Point(300, 240))
    page.draw_line(pymupdf.Point(240, 110), pymupdf.Point(240, 380))
    # ...and its interior labels, at 5 pt, at y values BETWEEN the body rows above.
    for row in range(10):
        page.insert_text((190, 122 + row * 24), f"3x3 conv, {64 << (row % 3)}", fontsize=5)

    document.save(str(out))
    document.close()
    return out


def _without_figure_removal(page: PageContent, monkeypatch: pytest.MonkeyPatch) -> int:
    """Blocks `layout_page` produces when figure interiors are NOT taken out first.

    Patched by NAME through `monkeypatch`, because that is the only seam: `layout_page` calls
    `detect_figure_regions` at module scope, which is exactly the coupling #50 is about. The
    string form is what keeps both mypy (the name is imported into `layout`'s namespace, not
    re-exported from it) and ruff (B009/B010) satisfied, and `monkeypatch` undoes it even if the
    assertion below raises.
    """
    monkeypatch.setattr("papertree_document_worker.layout.detect_figure_regions", lambda _page: [])
    return len(layout_page(page, heads=set()).blocks)


def _page_of(path: Path) -> PageContent:
    with SourceDocument(path) as document:
        return document.page(0)


def test_the_synthetic_diagram_is_actually_detected_as_a_figure(
    diagram_with_interior_labels: Path,
) -> None:
    """The fixture has to exercise the thing before the test below means anything.

    A fixture whose "figure" clusters no ink would make the interleaving test pass vacuously —
    no region, no interior lines, nothing to leak. This is the guard on the guard.
    """
    page = _page_of(diagram_with_interior_labels)
    regions = detect_figure_regions(page)
    assert regions, "the fixture drew no detectable figure; the tests below would be vacuous"
    assert any(len(r.interior_lines) >= 5 for r in regions), (
        "the fixture's figure claims no interior labels; there is nothing to keep out of the "
        f"body stream. Claimed: {[len(r.interior_lines) for r in regions]}"
    )


def test_no_figure_interior_line_reaches_a_body_block(
    diagram_with_interior_labels: Path,
) -> None:
    """THE INVARIANT. Every line a figure region claims is out of the body stream by the time
    columns are assigned.

    WATCH IT FAIL: make `layout_page`'s `detect_figure_regions(page)` return `[]`. The interior
    labels then land in body blocks and this reports them by name.
    """
    page = _page_of(diagram_with_interior_labels)
    interior = {
        id(line) for region in detect_figure_regions(page) for line in region.interior_lines
    }
    assert interior, "no interior lines to test — see the fixture guard above"

    layout = layout_page(page, heads=set())
    leaked = [
        line.text
        for block in layout.blocks
        if block.flow == "body"
        for line in block.lines
        if id(line) in interior
    ]
    assert not leaked, (
        f"{len(leaked)} figure-interior line(s) reached the body stream: {leaked[:5]}. "
        "Figure regions must be detected BEFORE columns are assigned (#50) — reclassifying "
        "afterwards cannot undo a segmentation already made on bad input."
    )


def test_removing_the_interior_lines_changes_the_segmentation(
    diagram_with_interior_labels: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """...and it is not a no-op, which is the other way this guard could be vacuous.

    If the labels happened not to break any paragraph run, the invariant above would hold for a
    reason unrelated to the ordering. This asserts the ordering CHANGES the answer.
    """
    page = _page_of(diagram_with_interior_labels)
    with_removal = len(layout_page(page, heads=set()).blocks)
    without_removal = _without_figure_removal(page, monkeypatch)

    assert without_removal > with_removal, (
        f"segmentation is identical either way ({with_removal} blocks) — this fixture no longer "
        "reproduces #50 and the invariant above is passing for the wrong reason"
    )


# ── the corpus, where #50 was measured ───────────────────────────────────────────────────────

#: Blocks per page WITH the interior removal, measured 2026-08-02 on `main` at `c8bf62e`.
#: The WITHOUT figures are in the erratum in `EPIC-01-ingest.md`; only the direction and the
#: leak-freedom are asserted, because the absolute counts are the parser's business and belong
#: to `test_corpus_gold.py`'s baselines rather than here.
INTERLEAVED_PAPERS = ("resnet-cvpr-2col", "bert-2col", "attention-is-all-you-need")


@requires_corpus
@pytest.mark.parametrize("paper", INTERLEAVED_PAPERS)
def test_no_corpus_page_leaks_a_figure_interior_into_the_body(paper: str) -> None:
    with SourceDocument(CORPUS / f"{paper}.pdf") as document:
        pages = document.pages()
        layout = layout_document(pages)
        for page, page_layout in zip(pages, layout.pages, strict=True):
            interior = {
                id(line) for region in detect_figure_regions(page) for line in region.interior_lines
            }
            if not interior:
                continue
            leaked = [
                line.text
                for block in page_layout.blocks
                if block.flow == "body"
                for line in block.lines
                if id(line) in interior
            ]
            assert not leaked, f"{paper} p{page.index}: {len(leaked)} leaked, e.g. {leaked[:3]}"


@requires_corpus
def test_resnet_page_3_is_the_page_the_issue_is_about(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """ResNet p3 — Figure 3, the VGG-19 / 34-layer-plain / 34-layer-residual diagram.

    #50's worked example, re-derived. With the removal it segments to a plausible page; without
    it, the ~40 interior labels at 4.92 pt shred it. The exact counts are printed rather than
    only asserted, because the number is the deliverable and the bound is the gate.
    """
    with SourceDocument(CORPUS / "resnet-cvpr-2col.pdf") as document:
        pages = document.pages()
        with_removal = len(layout_page(pages[3], heads=set()).blocks)
        without_removal = _without_figure_removal(pages[3], monkeypatch)
        labels = [
            span.size
            for region in detect_figure_regions(pages[3])
            for line in region.interior_lines
            for span in line.spans
        ]

    with capsys.disabled():
        print(
            f"\n[worker/#50] resnet p3: {with_removal} blocks with the figure-interior removal, "
            f"{without_removal} without. {len(labels)} interior label spans, "
            f"smallest {min(labels):.2f} pt."
        )
    assert without_removal >= 3 * with_removal, (
        "resnet p3 no longer shows #50's effect; the erratum's numbers need re-deriving"
    )
    assert min(labels) < 6.0, "the small interior labels are what #50 is about"
