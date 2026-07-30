"""F1.1 - classification, including the page kinds the corpus does not contain.

THE CORPUS GAP THIS TEST EXISTS TO CLOSE. `research/benchmarks/README.md` §1.3 lists 12 corpus
categories; 8 papers are seeded and they occupy 4 of them. Category 8 ("scanned / historical")
is empty, so the branch that decides "this page is a scan, defer it" has **no real document to
run against**. Epic 1's non-goal is explicit - classify scanned pages, mark `partial`, defer -
which means the classification is the *entire* deliverable for that class, and shipping it
untested would be shipping the deliverable untested.

So the scanned and blank pages are built here, in-process, from the real corpus: a corpus page
is rendered to a raster and re-wrapped as an image-only PDF. That is exactly what a scanner
produces - pixels, no text layer - and it needs no new fixture committed to the repo.

It is not a substitute for a real scan (no skew, no noise, no JPEG artefacts, no OCR text
layer), and this file does not pretend otherwise: it asserts the *routing decision*, which is
all Epic 1 promises for that class.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from _corpus_manifest import CORPUS_DIR as CORPUS
from _corpus_manifest import CORPUS_PARAMS, FIXTURE_PDFS, requires_corpus
from papertree_document_worker.classify import (
    DocumentProfile,
    PageKind,
    classify_document,
    classify_page,
)

# `pymupdf` here is pdf.py's deliberately-Any-typed alias, not the module: PyMuPDF is
# `py.typed` with almost no annotations, so importing it directly makes every call a
# `no-untyped-call` error under `mypy --strict`. Reusing the one declared boundary keeps that
# in a single place rather than scattering ignores through the tests.
from papertree_document_worker.pdf import SourceDocument, pymupdf

# EVERY test below needs the corpus, which is gitignored. Module-level so the skip carries a
# reason even for the parametrised ones - a `parametrize` over an empty glob collects ZERO
# cases and reports nothing at all, which is how the first CI run on this branch "passed"
# these while running none of them. See tests/conftest.py.
pytestmark = requires_corpus


def _profile(path: Path) -> DocumentProfile:
    with SourceDocument(path) as doc:
        return classify_document(doc, doc.pages())


@pytest.fixture(scope="module")
def scanned_pdf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """ResNet page 0, rendered to 150 dpi pixels and re-wrapped with no text layer."""
    out = tmp_path_factory.mktemp("scanned") / "scanned.pdf"
    source = pymupdf.open(CORPUS / "resnet-cvpr-2col.pdf")
    pixmap = source[0].get_pixmap(dpi=150)
    scanned = pymupdf.open()
    page = scanned.new_page(width=source[0].rect.width, height=source[0].rect.height)
    page.insert_image(page.rect, pixmap=pixmap)
    scanned.save(out)
    scanned.close()
    source.close()
    return out


@pytest.fixture(scope="module")
def blank_pdf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("blank") / "blank.pdf"
    doc = pymupdf.open()
    doc.new_page(width=612, height=792)
    doc.save(out)
    doc.close()
    return out


@pytest.mark.parametrize("path", CORPUS_PARAMS, ids=lambda p: p.name if p else "no-corpus")
def test_every_corpus_page_is_born_digital(path: Path) -> None:
    """All 8 papers are arXiv/LaTeX preprints with a full text layer, on all 195 pages.

    Asserted rather than assumed because it is the premise the whole deterministic path rests
    on, and because the corpus is expected to grow into the other 8 PTUB categories - at which
    point this test is the thing that says so out loud instead of the parser quietly producing
    empty output.
    """
    profile = _profile(path)
    assert profile.is_born_digital
    assert profile.partial_reason is None
    assert all(p.kind is PageKind.DIGITAL for p in profile.pages)
    assert all(p.has_text_layer for p in profile.pages)
    # NOT `>= 0.99`. That was a guess, and measuring it found something real: ResNet page 4
    # scores 0.9868 because 1.32 % of its glyphs are undecodable - 48 CMEX10 glyphs at U+F8EE,
    # U+F8F0, U+F8F9 and U+F8FB. Those are TeX's PRIVATE-USE codepoints for the *pieces* of a
    # large delimiter (the hooks and vertical extensions of a big bracket), and they have no
    # Unicode meaning by construction. The classifier is right and the threshold was wrong.
    #
    # 0.95 is the floor a clean born-digital page must clear. Two things depend on this staying
    # visible rather than being rounded away: `equations.py` treats CMEX10 private-use runs as a
    # positive display-math signal, and `ingest/source-authenticity.spec` has to expect exactly
    # these code points in `Block.text` and not mistake them for model prose.
    assert all(p.confidence >= 0.95 for p in profile.pages)


@pytest.mark.parametrize("path", CORPUS_PARAMS, ids=lambda p: p.name if p else "no-corpus")
def test_the_corpus_exercises_none_of_the_normalisation_path(path: Path) -> None:
    """The measurement behind `pdf.py`'s module docstring, pinned so it stays true.

    Every corpus page is /Rotate 0, CropBox == MediaBox at the origin, /UserUnit absent. If a
    paper is ever added that breaks this, the geometry code gains real coverage and this test
    should be UPDATED, not deleted - the point is that the fact is tracked, because
    ADR-001 Amendment 1 §H.2 asks for exactly such a paper and it has not been added.
    """
    with SourceDocument(path) as doc:
        for index in range(doc.page_count):
            raw = doc.raw_page_boxes(index)
            assert raw.rotate == 0
            assert raw.user_unit == 1.0
            assert raw.crop_box == raw.media_box
            assert raw.media_box[0] == 0 and raw.media_box[1] == 0


def test_a_rendered_page_with_no_text_layer_is_scanned(scanned_pdf: Path) -> None:
    profile = _profile(scanned_pdf)
    page = profile.pages[0]
    assert page.kind is PageKind.SCANNED
    assert not page.has_text_layer
    assert page.raster_coverage >= 0.99
    assert page.is_scanned and not page.is_parseable
    assert page.confidence == 0.2


def test_a_scanned_page_forces_a_partial_reason_naming_it(scanned_pdf: Path) -> None:
    """Rule 41 ties `partial_reason` to `status`, so the two must be decided together.

    A scanned page that produced no `partial_reason` would ship as `status: complete` with no
    text - which DESIGN.md §11 residual risk 10 names as indistinguishable from a total
    extraction failure.
    """
    profile = _profile(scanned_pdf)
    assert profile.scanned_pages == (0,)
    reason = profile.partial_reason
    assert reason is not None
    assert "1 of 1 pages are scanned" in reason
    assert "no OCR path" in reason


def test_a_blank_page_is_blank_and_not_scanned(blank_pdf: Path) -> None:
    """The distinction that stops an empty page from acquiring a false `partial_reason`."""
    profile = _profile(blank_pdf)
    page = profile.pages[0]
    assert page.kind is PageKind.BLANK
    assert not page.is_scanned
    assert page.is_parseable
    assert profile.partial_reason is None
    assert profile.is_born_digital


def test_a_page_of_vector_ink_with_no_text_is_vector_only() -> None:
    """The synthetic geometry fixtures are exactly this: painted markers, no text at all."""
    with SourceDocument(FIXTURE_PDFS / "rotate-0.pdf") as doc:
        page = classify_page(doc.page(0))
    assert page.kind is PageKind.VECTOR_ONLY
    assert page.drawing_count == 3
    assert not page.has_text_layer
    assert page.is_parseable, "geometry is intact; the page is parseable, just textless"


def test_font_census_is_document_wide_and_ordered() -> None:
    profile = _profile(CORPUS / "resnet-cvpr-2col.pdf")
    assert profile.fonts, "a LaTeX paper has fonts"
    counts = [n for _, n in profile.fonts]
    assert counts == sorted(counts, reverse=True), "census must be most-common-first"
    assert sum(counts) == sum(p.glyph_count for p in profile.pages)


def test_producer_is_read_from_the_document_metadata() -> None:
    profile = _profile(CORPUS / "attention-is-all-you-need.pdf")
    assert profile.producer.startswith("pdfTeX")
    assert not profile.is_encrypted
