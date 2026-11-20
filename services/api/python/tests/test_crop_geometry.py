"""v0.3 (#348): a crop is CENTRED on its target whatever the page's boxes are.

AGENTS.md section 4: "PyMuPDF reports its two page boxes in two different coordinate spaces", and
the flip is the identity on every corpus paper, so only a synthetic page catches a mistake: a
``/Rotate`` of 90, 180 or 270, a MediaBox not at the origin with a CropBox inside it, and both.
The target is a red box whose bbox is taken the way the worker takes every IR bbox (``pdf.py``:
MuPDF's crop-relative rect times ``page.rotation_matrix``); the crop of that bbox must hold the
whole red box, centred, with only its 2 pt margin around it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from crop_support import make_geometry_pdf
from papertree_api.region_crops import render_crop
from papertree_document_worker.pdf import pymupdf

GEOMETRIES: dict[str, dict[str, Any]] = {
    "plain": {},
    "rotated 90": {"rotation": 90},
    "rotated 270": {"rotation": 270},
    "rotated 180": {"rotation": 180},
    "mediabox off the origin, cropbox inside": {
        "media": (-100.0, -50.0, 400.0, 550.0),
        "crop": (-40.0, 10.0, 360.0, 490.0),
    },
    "rotated 90 and the same boxes": {
        "rotation": 90,
        "media": (-100.0, -50.0, 400.0, 550.0),
        "crop": (-40.0, 10.0, 360.0, 490.0),
    },
    "rotated 270 and the same boxes": {
        "rotation": 270,
        "media": (-100.0, -50.0, 400.0, 550.0),
        "crop": (-40.0, 10.0, 360.0, 490.0),
    },
}


@pytest.mark.parametrize("name", list(GEOMETRIES))
def test_a_crop_of_a_target_is_centred_on_it_whatever_the_page_boxes(
    tmp_path: Path, name: str
) -> None:
    pdf_bytes, target, size = make_geometry_pdf(**GEOMETRIES[name])
    (tmp_path / "up").mkdir()
    (tmp_path / "up" / "ppr_x.pdf").write_bytes(pdf_bytes)
    with pymupdf.open(tmp_path / "up" / "ppr_x.pdf") as probe:
        assert (float(probe[0].rect.width), float(probe[0].rect.height)) == size
    rendered = render_crop(
        pdf=tmp_path / "up" / "ppr_x.pdf",
        asset_root=tmp_path / "assets",
        paper_id="ppr_x",
        generation=1,
        page=0,
        box=target,
    )
    pix = pymupdf.Pixmap(rendered.png)
    reds = [
        (x, y)
        for y in range(pix.height)
        for x in range(pix.width)
        if (lambda p: p[0] > 200 and p[1] < 60 and p[2] < 60)(pix.pixel(x, y))
    ]
    assert reds, f"{name}: the target is not in the crop at all"
    cx = sum(x for x, _ in reds) / len(reds) / pix.width
    cy = sum(y for _, y in reds) / len(reds) / pix.height
    assert abs(cx - 0.5) < 0.02 and abs(cy - 0.5) < 0.02, f"{name}: centred at ({cx:.3f}, {cy:.3f})"
    # And it is the target, not a neighbour: the box fills the crop but for its 2 pt margin.
    width_pt, height_pt = target[2] - target[0], target[3] - target[1]
    coverage = len(reds) / (pix.width * pix.height)
    expected = (width_pt * height_pt) / ((width_pt + 4) * (height_pt + 4))
    assert coverage == pytest.approx(expected, abs=0.03), name
    # The crop is the right shape for a 80 x 60 pt target (swapped on a quarter turn).
    assert pix.width / pix.height == pytest.approx((width_pt + 4) / (height_pt + 4), rel=0.03)
