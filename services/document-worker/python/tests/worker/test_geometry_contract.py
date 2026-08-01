"""The worker's coordinate pipeline equals `papertree_document_ir.geometry`'s, on every fixture.

WHY THIS TEST IS THE FIRST ONE IN THE EPIC. ADR-001 Amendment 1's P9 perturbation measured the
cost of a wrong page frame at **99.93 % of block ids**. Every other acceptance test in Epic 1
runs downstream of this one, and all of them would still pass with the frame wrong - determinism
is preserved by a consistently wrong frame, reading order does not depend on the origin, and
figures are found by clustering ink whatever space it is in. This is the only check that fails.

WHAT MAKES IT AN ORACLE AND NOT A TAUTOLOGY. Three independently-produced things are compared:

  1. `marker_rects_raw_pdf_space` - the literal `x y w h re f` operands Epic 0 wrote into each
     fixture's content stream. Raw PDF space, no library between them and the file.
  2. `normalise_rect(frame, ...)` applied to (1) - document-ir's own contract function, which
     this worker does not own and may not edit.
  3. `PageContent`'s rects, read back out of the SAME PDF through MuPDF's extraction API and
     mapped by `pdf.py`'s `_PageTransform`.

(3) never sees (1). A bug in `_PageTransform` cannot hide, because (2) is computed from the
content-stream operands rather than from anything MuPDF or this worker produced.

The real corpus cannot substitute for these fixtures: all 8 papers are /Rotate 0, CropBox ==
MediaBox, no /UserUnit (`test_classify.py` asserts that, so it stays true). The entire
normalisation path is a no-op on 100 % of real documents.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from papertree_document_ir.geometry import (
    RawPageBoxes,
    normalise_page_frame,
    normalise_rect,
)
from papertree_document_worker.pdf import SourceDocument

REPO = Path(__file__).resolve().parents[5]
FIXTURE_DIR = REPO / "packages" / "document-ir" / "test" / "fixtures-pdf"
VECTORS = REPO / "packages" / "document-ir" / "conformance" / "geometry-vectors.json"

# One point. The fixtures paint axis-aligned rects, so the pipelines can only agree or not;
# there is no tolerance band worth arguing about. 1e-9 absorbs binary64 association order only.
EPSILON = 1e-9


def _vectors() -> list[dict[str, Any]]:
    return list(json.loads(VECTORS.read_text())["fixture_vectors"])


FIXTURE_VECTORS = _vectors()


def _ids(records: list[dict[str, Any]]) -> list[str]:
    return [str(r["file"]) for r in records]


def test_the_conformance_file_and_the_fixture_directory_agree() -> None:
    """Guards the guard: a vector for a file that is not there checks nothing, silently."""
    assert FIXTURE_VECTORS, "geometry-vectors.json carries no fixture_vectors"
    on_disk = {p.name for p in FIXTURE_DIR.glob("*.pdf")}
    named = {str(r["file"]) for r in FIXTURE_VECTORS}
    assert named <= on_disk, f"vectors name PDFs that do not exist: {sorted(named - on_disk)}"
    assert len(named) >= 9, f"expected at least 9 geometry fixtures, found {len(named)}"


@pytest.mark.parametrize("record", FIXTURE_VECTORS, ids=_ids(FIXTURE_VECTORS))
def test_page_frame_matches_the_recorded_one(record: dict[str, Any]) -> None:
    with SourceDocument(FIXTURE_DIR / record["file"]) as doc:
        raw = doc.raw_page_boxes(0)
    assert [float(v) for v in raw.media_box] == record["raw"]["media_box"]
    assert raw.crop_box is not None
    # The record writes `null` where the page carries no explicit /CropBox; PDF 1.7 §14.11.2
    # says that means the MediaBox, and `SourceDocument` resolves it rather than propagating
    # the absence. This is also the assertion that catches the cropbox y-flip described in
    # `raw_page_boxes` - on `negative-mediabox.pdf` the flipped value differs from the
    # MediaBox it is supposed to default to.
    expected_crop = record["raw"]["crop_box"] or record["raw"]["media_box"]
    assert [float(v) for v in raw.crop_box] == expected_crop
    assert raw.rotate == record["raw"]["rotate"]
    # The conformance file writes `null` where the key is absent; PDF 1.7 §7.7.3.3 says that
    # means 1.0, and `SourceDocument` resolves it rather than propagating the absence.
    assert raw.user_unit == (record["raw"]["user_unit"] or 1.0)

    frame = normalise_page_frame(raw)
    assert [frame.width, frame.height] == record["expected_page_size"]
    # D23 / validator rule G4: block geometry is crop-box-relative, so crop_box is ALWAYS
    # [0, 0, w, h]. This is the cheapest coordinate-space check that exists.
    assert frame.crop_box == [0.0, 0.0, frame.width, frame.height]


@pytest.mark.parametrize("record", FIXTURE_VECTORS, ids=_ids(FIXTURE_VECTORS))
def test_worker_transform_equals_normalise_rect_on_every_marker(record: dict[str, Any]) -> None:
    """The load-bearing assertion. See the module docstring for why it is not circular."""
    frame = normalise_page_frame(
        RawPageBoxes(
            media_box=record["raw"]["media_box"],
            crop_box=record["raw"]["crop_box"],
            rotate=record["raw"]["rotate"],
            user_unit=record["raw"]["user_unit"] or 1.0,
        )
    )
    contract = [normalise_rect(frame, r) for r in record["marker_rects_raw_pdf_space"]]

    with SourceDocument(FIXTURE_DIR / record["file"]) as doc:
        worker = [list(d.bbox) for d in doc.page(0).drawings]

    assert len(worker) == len(contract), (
        f"{record['file']}: {len(worker)} drawings read back against "
        f"{len(contract)} recorded markers"
    )
    for got, want in zip(worker, contract, strict=True):
        assert all(abs(a - b) < EPSILON for a, b in zip(got, want, strict=True)), (
            f"{record['file']}: worker {got} != contract {want}"
        )


# `negative-mediabox.pdf` deliberately paints a marker outside the visible page: MuPDF clips
# the CropBox to the MediaBox (PDF 1.7 §14.11.2) and the fixture exists to exercise exactly that
# corner. Validator rule 3 is a WARN for the same reason - "parsers do emit marginally
# out-of-box geometry" - and it is only promoted to ERROR by G7 when more than 5 % of a page's
# blocks are outside. Listing the exception by name keeps the check meaningful everywhere else
# rather than loosening it globally into a check that cannot fail.
PARTLY_OUT_OF_BOX = {"negative-mediabox.pdf"}


@pytest.mark.parametrize("record", FIXTURE_VECTORS, ids=_ids(FIXTURE_VECTORS))
def test_every_marker_lands_inside_the_page(record: dict[str, Any]) -> None:
    """Rule 3 / G7's precondition. A frame error usually shows up here first, as geometry that
    is plausible in isolation but outside the page it claims to be on."""
    if record["file"] in PARTLY_OUT_OF_BOX:
        pytest.skip(f"{record['file']} paints outside the crop box on purpose")
    with SourceDocument(FIXTURE_DIR / record["file"]) as doc:
        page = doc.page(0)
    w, h = page.frame.width, page.frame.height
    for box in (d.bbox for d in page.drawings):
        assert -EPSILON <= box[0] <= box[2] <= w + EPSILON, f"{record['file']}: x out of {w}: {box}"
        assert -EPSILON <= box[1] <= box[3] <= h + EPSILON, f"{record['file']}: y out of {h}: {box}"


def test_user_unit_is_divided_out_exactly_once() -> None:
    """`userunit.pdf` and `rotate-0.pdf` are the same page at /UserUnit 2.5 and 1.0.

    Their IR geometry must be IDENTICAL. Dividing zero times scales every coordinate by 2.5;
    dividing twice scales it by 0.4. Both produce a self-consistent document with a completely
    different id space, which is the failure P9 priced - and MuPDF pre-multiplies `page.rect`
    while leaving `rotation_matrix` alone, so the mistake is easy to make in either direction.
    """
    with SourceDocument(FIXTURE_DIR / "userunit.pdf") as scaled:
        scaled_page = scaled.page(0)
    with SourceDocument(FIXTURE_DIR / "rotate-0.pdf") as plain:
        plain_page = plain.page(0)

    assert scaled_page.raw_boxes.user_unit == 2.5
    assert plain_page.raw_boxes.user_unit == 1.0
    assert (scaled_page.frame.width, scaled_page.frame.height) == (
        plain_page.frame.width,
        plain_page.frame.height,
    )
    assert [list(d.bbox) for d in scaled_page.drawings] == [
        list(d.bbox) for d in plain_page.drawings
    ]


def test_rotation_is_applied_by_the_worker_not_by_mupdf() -> None:
    """The measured MuPDF fact this module is built on, pinned as a test.

    `get_drawings()` returns IDENTICAL coordinates at /Rotate 0, 90, 180 and 270 - the rotation
    lives only in `page.rotation_matrix`. If a future PyMuPDF starts pre-rotating extraction
    coordinates, `_PageTransform` would apply /Rotate a second time and every rotated page's ids
    would move. This test is what turns that upgrade into a red build rather than a silent
    re-basing, and it is why the dependency is pinned `<2`.
    """
    frames = {}
    for name in ("rotate-0.pdf", "rotate-90.pdf", "rotate-180.pdf", "rotate-270.pdf"):
        with SourceDocument(FIXTURE_DIR / name) as doc:
            page = doc.page(0)
        frames[name] = (page.frame.rotation, [list(d.bbox) for d in page.drawings])

    assert [frames[n][0] for n in frames] == [0, 90, 180, 270]
    # The four rotations must NOT produce the same IR geometry - if they did, the transform is
    # a no-op and the rotation was silently dropped.
    distinct = {tuple(tuple(b) for b in geometry) for _, geometry in frames.values()}
    assert len(distinct) == 4, "rotation is not reaching IR space; the transform is a no-op"
