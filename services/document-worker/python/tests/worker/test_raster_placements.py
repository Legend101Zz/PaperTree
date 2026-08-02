"""#57 — `pdf._images()` emits one entry per PLACEMENT, and used to emit some of them twice.

THE DEFECT

It iterated `page.get_images(full=True)` and called `page.get_image_rects(xref)` per xref. When
one on-page placement is reachable from several xrefs the same rect came back more than once.
Measured across all 8 corpus papers at pymupdf 1.28.0:

    paper                     get_image_rects   distinct
    bert-2col                            154         38
    a3c-algorithmheavy                    30         28
    every other paper                  equal      equal

`classify.classify_page` sums `_area(image.bbox)` over that list into `raster_coverage`, so
BERT's was inflated - p14 read 0.1542 where the page's actual rasters cover 0.0715.

TWO TESTS, AND ONLY ONE OF THEM RUNS ON CI

The corpus is gitignored (`AGENTS.md` §4), so the per-paper counts below skip on a clean
checkout. `test_a_placement_reachable_from_two_xrefs_is_counted_once` builds the defect's exact
shape in process instead - one image XObject placed twice, plus a second reference to it - so
the property is checked on every push whether or not anyone fetched the corpus. A suite that is
100 % skipped reports as a pass, which is `ci.yml`'s own recurring-defect note.

WHAT THIS IS NOT ABOUT

Not memory: 341.9 MB against 343.4 MB on gpt3, image traversal only. Not `is_vector` either,
though #78 §5 predicted it would move - `figures.py` unions identical boxes in `_merge_panels`
before a region is emitted, so figure and vector-region counts are byte-identical either way on
all 8 papers. See `pdf._images`'s docstring for both measurements.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import pytest
from _corpus_manifest import CORPUS_DIR as CORPUS
from _corpus_manifest import requires_corpus
from papertree_document_worker.classify import classify_page
from papertree_document_worker.pdf import SourceDocument, pymupdf


def _rounded(box: Iterable[float]) -> tuple[float, ...]:
    """A rect as a comparable key. 1e-3 because MuPDF returns float32-derived doubles and two
    descriptions of one placement can differ in the last bit."""
    return tuple(round(float(v), 3) for v in box)


# ── the shape of the defect, built in process so CI runs it ──────────────────────────────────


@pytest.fixture(scope="module")
def two_xrefs_one_placement(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A PDF whose page places one raster twice and carries a second copy of the same bytes.

    Byte-identical image data is deduplicated to ONE XObject by some producers and kept as two
    by others, and a page can reference either. That is the situation BERT's 154-against-38 is:
    the rect set is right, the enumeration visits it more than once.
    """
    out = tmp_path_factory.mktemp("rasters") / "two-xrefs.pdf"
    document = pymupdf.open()
    page = document.new_page(width=612, height=792)
    # A tiny opaque PNG, drawn twice at different places, plus a third placement of a
    # byte-identical copy - so both "same xref placed twice" and "two xrefs, one image" exist.
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 8, 8))
    pixmap.set_rect(pixmap.irect, (200, 40, 40))
    png = pixmap.tobytes("png")
    page.insert_image(pymupdf.Rect(72, 72, 172, 172), stream=png)
    page.insert_image(pymupdf.Rect(72, 300, 172, 400), stream=png)
    page.insert_image(pymupdf.Rect(300, 72, 400, 172), stream=png)
    document.save(str(out))
    document.close()
    return out


def test_a_placement_reachable_from_two_xrefs_is_counted_once(
    two_xrefs_one_placement: Path,
) -> None:
    """The invariant, on a PDF this test built: NO on-page rect appears twice.

    WATCH IT FAIL: restore the `get_images(full=True)` + `get_image_rects(xref)` pairing in
    `pdf._images`. On the corpus that takes bert from 38 placements to 154; here it takes this
    page from 3 to however many xrefs MuPDF minted for the same bytes.
    """
    with SourceDocument(two_xrefs_one_placement) as document:
        images = document.page(0).images
    boxes = [_rounded(image.bbox) for image in images]
    assert len(boxes) == len(set(boxes)), f"duplicate placements: {sorted(boxes)}"
    assert len(boxes) == 3, "three placements were drawn"


def test_the_two_enumerations_agree_as_a_SET(two_xrefs_one_placement: Path) -> None:
    """`get_image_info(xrefs=True)` is a REPLACEMENT, not an approximation.

    The only defensible reason to swap one PyMuPDF call for another is that they describe the
    same page. Asserted as set equality rather than by trusting the release notes, and asserted
    again over the whole corpus below.
    """
    raw = pymupdf.open(str(two_xrefs_one_placement))
    try:
        page = raw[0]
        by_rects = {
            _rounded(rect)
            for meta in page.get_images(full=True)
            for rect in page.get_image_rects(int(meta[0]))
        }
        by_info = {_rounded(entry["bbox"]) for entry in page.get_image_info(xrefs=True)}
    finally:
        raw.close()
    assert by_rects == by_info


def test_the_fields_the_old_call_supplied_are_all_still_populated(
    two_xrefs_one_placement: Path,
) -> None:
    """`get_images(full=True)` gave width/height/colorspace/bpc and `get_image_info` must too.

    A silently-empty `colorspace` or a zero `bpc` would be invisible - nothing downstream reads
    them today, which is exactly why a regression there would survive.
    """
    with SourceDocument(two_xrefs_one_placement) as document:
        image = document.page(0).images[0]
    assert image.xref > 0
    assert (image.width, image.height) == (8, 8)
    assert image.colorspace, "colorspace came back empty"
    assert image.bpc > 0


# ── the corpus, where the defect was found ───────────────────────────────────────────────────


#: Distinct on-page placements per paper, measured 2026-08-02 at pymupdf 1.28.0. `bert-2col` is
#: the case #57 is about: the old enumeration reported 154 for these 38.
PLACEMENTS = {
    "a3c-algorithmheavy": 28,
    "attention-is-all-you-need": 3,
    "bert-2col": 38,
    "gpt3-longform-singlecol": 83,
    "neural-odes-mathheavy": 81,
    "pdf-to-tree-acl2col": 2,
    "resnet-cvpr-2col": 0,
    "superglue-tableheavy": 0,
}


@requires_corpus
@pytest.mark.parametrize("paper", sorted(PLACEMENTS))
def test_no_corpus_page_reports_a_placement_twice(paper: str) -> None:
    with SourceDocument(CORPUS / f"{paper}.pdf") as document:
        total = 0
        for index in range(document.page_count):
            boxes = [_rounded(image.bbox) for image in document.page(index).images]
            assert len(boxes) == len(set(boxes)), f"{paper} p{index} duplicates a placement"
            total += len(boxes)
    assert total == PLACEMENTS[paper]


@requires_corpus
@pytest.mark.parametrize("paper", sorted(PLACEMENTS))
def test_the_two_enumerations_agree_on_every_corpus_page(paper: str) -> None:
    """Set equality per page, on all 195 corpus pages. This is the evidence the swap is safe."""
    raw = pymupdf.open(str(CORPUS / f"{paper}.pdf"))
    try:
        for page in raw:
            by_rects = {
                _rounded(rect)
                for meta in page.get_images(full=True)
                for rect in page.get_image_rects(int(meta[0]))
            }
            by_info = {_rounded(entry["bbox"]) for entry in page.get_image_info(xrefs=True)}
            assert by_rects == by_info, f"{paper} p{page.number}"
    finally:
        raw.close()


@requires_corpus
def test_bert_raster_coverage_is_the_area_actually_covered(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The metric #57 is really about. `classify.classify_page:169` sums placement areas, so a
    duplicated placement is counted twice and `raster_coverage` reads high.

    BERT p14 carried 116 placements for 24 distinct rects; its coverage read **0.1542** where
    the page's rasters cover **0.0715**. `raster_coverage` feeds `PageKind` and `normalise.py`
    rule 4 reads the same inventory, so this is not cosmetic.

    WATCH IT FAIL: restore the old pairing and p14 reads 0.1542 again.
    """
    with SourceDocument(CORPUS / "bert-2col.pdf") as document:
        coverage = {i: classify_page(document.page(i)).raster_coverage for i in (2, 14)}
    with capsys.disabled():
        print(f"\n[worker/#57] bert raster_coverage p2={coverage[2]:.4f} p14={coverage[14]:.4f}")
    assert coverage[14] == pytest.approx(0.0715, abs=5e-4)
    assert coverage[2] == pytest.approx(0.0326, abs=5e-4)


@requires_corpus
@pytest.mark.parametrize("paper", sorted(PLACEMENTS))
def test_figure_regions_and_is_vector_do_NOT_move(paper: str) -> None:
    """#78 §5 predicts "`is_vector` re-measured post-#57 — the number WILL move on bert". It
    does not, and this pins that rather than leaving it as a claim.

    `figures.detect_figure_regions` builds raster regions from `_significant_rasters` and then
    `_merge_panels`, which unions boxes that overlap. Duplicate placements are the SAME box, so
    they collapse before a region is emitted. Measured both ways in one process across all 8
    papers: figure-region and vector-region counts are identical, and no page changes `PageKind`.

    Recorded as a test because "the number did not move" is exactly the kind of finding that
    gets quietly re-asserted the other way by the next person reading the brief.

    IT INJECTS DUPLICATES RATHER THAN REMOVING THEM, AND THAT MATTERS. Post-#57 `page.images`
    holds no duplicates, so a test that deduplicated it again and compared would be comparing a
    list with itself - green, and asserting nothing. My first version did exactly that. Feeding
    the OLD input to the CURRENT figure detector is the direction that carries information.

    WATCH IT FAIL: drop the `_merge_panels` call from the raster branch of
    `figures.detect_figure_regions`. bert then reports 22 raster regions for 11 real ones,
    because every duplicated placement becomes its own "figure".
    """
    from papertree_document_worker.figures import detect_figure_regions

    with SourceDocument(CORPUS / f"{paper}.pdf") as document:
        for index in range(document.page_count):
            page = document.page(index)
            clean = detect_figure_regions(page)
            # What `_images` used to hand over: every placement twice.
            page.images = tuple(list(page.images) + list(page.images))
            doubled = detect_figure_regions(page)
            assert len(clean) == len(doubled), f"{paper} p{index}: region count moved"
            assert sum(r.is_vector for r in clean) == sum(r.is_vector for r in doubled), (
                f"{paper} p{index}: is_vector moved"
            )
