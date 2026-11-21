"""v0.3 (#348): ``GET /papers/{id}/crop`` and ``/crop-url``: a rectangle of a page as a PNG.

The picture is a PDF built in process (``crop_support``), so these run without the corpus. What is
held: the PNG's size and dpi follow the rule (long side about 1,400 px, clamped, pixel-capped), a
second request is a cache hit on disk, another user's paper is a 404, a signed URL stands in for
the Bearer for exactly one paper, generation, page and box, and a box off the page is clamped or
refused.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit

import pytest
from api_support import assert_envelope, auth, harness, register, seed_paper
from crop_support import BLUE_BOX, RED_BOX, store_pdf
from papertree_api import assets, region_crops
from papertree_api.region_crops import dpi_for, plan_crop
from papertree_document_worker.pdf import pymupdf

SLUG = "resnet-cvpr-2col"


def params(box: tuple[float, float, float, float], page: int = 0) -> dict[str, Any]:
    x0, y0, x1, y1 = box
    return {"page": page, "x0": x0, "y0": y0, "x1": x1, "y1": y1}


def pixel(png: bytes, x: int, y: int) -> tuple[int, int, int]:
    pix = pymupdf.Pixmap(png)
    r, g, b = pix.pixel(x, y)[:3]
    return int(r), int(g), int(b)


def paper(h: Any, email: str = "alice@example.com") -> tuple[str, str]:
    token = register(h.client, email)
    paper_id = seed_paper(h.settings, h.client, token, SLUG)
    store_pdf(h.settings.upload_root, paper_id)
    return token, paper_id


# ── the dpi rule ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("width", "height", "dpi"),
    [
        (280.0, 100.0, 360),  # a figure: 5x, the long side 1,400 px
        (280.0, 280.0, 360),
        (612.0, 792.0, 127),  # a whole page: 1.77x, the long side still 1,400 px
        (40.0, 12.0, 720),  # a tiny label: capped at 10x
        (137.0, 78.0, 720),  # a small figure (resnet Figure 2): 10x, its long side 1,370 px
    ],
)
def test_the_dpi_puts_the_long_side_near_1400_px_and_is_clamped(
    width: float, height: float, dpi: int
) -> None:
    assert dpi_for(width, height) == dpi
    long_px = max(width, height) * dpi / 72
    assert long_px <= region_crops.MAX_LONG_SIDE_PX
    assert width * height * (dpi / 72) ** 2 <= region_crops.MAX_PIXELS
    if dpi < 720:
        assert 1390 <= long_px <= 1410


def test_a_huge_box_is_pixel_capped_not_left_at_the_minimum_scale() -> None:
    dpi = dpi_for(5000.0, 3000.0)
    assert 5000 * dpi / 72 <= region_crops.MAX_LONG_SIDE_PX
    assert dpi < 72  # the cap beats the 72 dpi floor on a poster-sized page


def test_a_sliver_is_grown_and_a_box_is_clipped_to_the_page() -> None:
    plan = plan_crop(0, (100.0, 100.0, 101.0, 300.0), 612, 792)
    assert plan.box[2] - plan.box[0] >= region_crops.MIN_BOX_PT
    edge = plan_crop(0, (500.0, 700.0, 900.0, 1000.0), 612, 792)
    assert edge.box[2] == 612 and edge.box[3] == 792
    with pytest.raises(region_crops.CropError):
        plan_crop(0, (700.0, 100.0, 900.0, 200.0), 612, 792)


# ── the endpoint ─────────────────────────────────────────────────────────────────────────────


def test_a_crop_is_a_png_at_the_chosen_dpi_and_shows_the_box(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = paper(h)
        response = h.client.get(
            f"/papers/{paper_id}/crop", params=params(RED_BOX), headers=auth(token)
        )
        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "image/png"
        assert response.content.startswith(b"\x89PNG")
        plan = plan_crop(0, RED_BOX, 612, 792)
        width, height = region_crops.png_size(response.content)
        assert (width, height) == tuple(int(v) for v in response.headers["x-crop-size"].split("x"))
        assert response.headers["x-crop-dpi"] == str(plan.dpi) == "355"
        assert 1380 <= max(width, height) <= 1420  # tight: the box (and 2 pt of margin) at 355 dpi
        assert max(width, height) > min(width, height) * 2  # the box is 280 x 100, not a page
        # The centre of the box is the red fill; the 2 pt margin outside it is white paper.
        assert pixel(response.content, width // 2, height - 10)[0] > 200
        assert pixel(response.content, 2, 2) == (255, 255, 255)
        assert pixel(response.content, width // 2, height // 2 + 150) != (255, 255, 255)
        # Nothing else on the page: a box over the blue square is blue, not red.
        blue = h.client.get(
            f"/papers/{paper_id}/crop", params=params(BLUE_BOX), headers=auth(token)
        )
        bw, bh = region_crops.png_size(blue.content)
        assert pixel(blue.content, bw // 2, bh // 2)[2] > 200


def test_the_second_request_is_a_cache_hit_on_disk(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = paper(h)
        first = h.client.get(
            f"/papers/{paper_id}/crop", params=params(RED_BOX), headers=auth(token)
        )
        assert first.headers["x-crop-cache"] == "miss"
        regions = list((h.settings.asset_root / paper_id).rglob("regions/*.png"))
        assert [p.name for p in regions] == ["p0-100-200-380-300@355dpi.png"]
        written = regions[0].stat()
        again = h.client.get(
            f"/papers/{paper_id}/crop", params=params(RED_BOX), headers=auth(token)
        )
        assert again.headers["x-crop-cache"] == "hit" and again.content == first.content
        # Not rewritten (same file, same bytes); only touched, so the cap's LRU sees the use.
        seen = regions[0].stat()
        assert seen.st_ino == written.st_ino and seen.st_size == written.st_size
        assert seen.st_mtime_ns >= written.st_mtime_ns
        # A box a hair off (within a tenth of a point) is the same file; a real change is another.
        near = (RED_BOX[0] + 0.01, *RED_BOX[1:])
        assert (
            h.client.get(
                f"/papers/{paper_id}/crop", params=params(near), headers=auth(token)
            ).headers["x-crop-cache"]
            == "hit"
        )
        other = (RED_BOX[0] + 5, *RED_BOX[1:])
        assert (
            h.client.get(
                f"/papers/{paper_id}/crop", params=params(other), headers=auth(token)
            ).headers["x-crop-cache"]
            == "miss"
        )
        assert len(list((h.settings.asset_root / paper_id).rglob("regions/*.png"))) == 2


def test_another_users_paper_is_a_404_and_no_session_is_a_401(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = paper(h)
        bob = register(h.client, "bob@example.com")
        for path in ("crop", "crop-url"):
            assert_envelope(
                h.client.get(
                    f"/papers/{paper_id}/{path}", params=params(RED_BOX), headers=auth(bob)
                ),
                404,
                "not_found",
            )
            assert_envelope(
                h.client.get(f"/papers/{paper_id}/{path}", params=params(RED_BOX)),
                401,
                "auth_required",
            )
        assert (
            h.client.get(
                f"/papers/{paper_id}/crop", params=params(RED_BOX), headers=auth(token)
            ).status_code
            == 200
        )
        # Bob's refused requests drew nothing: the only crop on disk is alice's.
        assert len(list(h.settings.asset_root.rglob("regions/*.png"))) == 1


def test_a_signed_url_loads_without_a_session_for_exactly_one_box(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = paper(h)
        minted = h.client.get(
            f"/papers/{paper_id}/crop-url", params=params(RED_BOX), headers=auth(token)
        )
        assert minted.status_code == 200, minted.text
        info = minted.json()
        assert info["dpi"] == 355 and 1380 <= max(info["width"], info["height"]) <= 1420
        url = info["url"]
        split = urlsplit(url)
        assert split.path == f"/papers/{paper_id}/crop"
        query = dict(parse_qsl(split.query))
        assert set(query) == {"page", "x0", "y0", "x1", "y1", "gen", "exp", "sig"}
        bare = h.client.get(url)  # no Authorization header: an <img> cannot send one
        assert bare.status_code == 200 and bare.headers["content-type"] == "image/png"
        assert bare.headers["x-crop-cache"] == "hit"  # crop-url drew it already

        def refetch(**changes: Any) -> Any:
            return h.client.get(f"{split.path}?{urlencode({**query, **changes})}")

        assert_envelope(refetch(x1="381"), 401, "auth_required")  # another box
        assert_envelope(refetch(page="1"), 401, "auth_required")  # another page
        assert_envelope(refetch(gen="2"), 401, "auth_required")  # another generation
        assert_envelope(refetch(sig="A" * 43), 401, "auth_required")
        assert_envelope(refetch(exp=str(int(time.time()) - 5)), 401, "auth_required")
        # The signature is the crop kind's: an asset signature for the same words does not open it.
        replay = assets.sign(
            h.settings.signing_secret, paper_id, int(query["gen"]), "figures",
            region_crops.canonical_box(0, RED_BOX), int(query["exp"]),
        )  # fmt: skip
        assert_envelope(refetch(sig=replay), 401, "auth_required")
        assert h.client.get(url).status_code == 200  # and the real one still loads


def test_a_box_off_the_page_is_clamped_and_a_bad_one_refused(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = paper(h)

        def get(page: int = 0, **box: float) -> Any:
            query = {**params(RED_BOX, page), **box}
            return h.client.get(f"/papers/{paper_id}/crop", params=query, headers=auth(token))

        edge = get(x0=500, y0=700, x1=900, y1=1000)
        assert edge.status_code == 200
        width, height = region_crops.png_size(edge.content)
        assert width / height == pytest.approx((612 - 498) / (792 - 698), rel=0.02)  # clipped
        sliver = get(x0=100, y0=100, x1=100.5, y1=300)
        assert sliver.status_code == 200
        assert region_crops.png_size(sliver.content)[0] >= 16 * 355 / 72 * 0.5  # grown, not 1 px
        assert_envelope(get(x0=700, y0=100, x1=900, y1=200), 422, "validation_failed")
        assert_envelope(get(x0=300, x1=200), 422, "validation_failed")  # backwards
        assert_envelope(get(page=2), 422, "validation_failed")  # the paper has two pages
        assert_envelope(get(page=-1), 422, "validation_failed")
        assert_envelope(get(x0=float("nan")), 422, "validation_failed")
        blank = get(page=1)
        assert blank.status_code == 200 and pixel(blank.content, 5, 5) == (255, 255, 255)


def test_a_paper_whose_pdf_is_not_on_this_host_is_a_404(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token, paper_id = paper(h)
        (h.settings.upload_root / f"{paper_id}.pdf").unlink()
        assert_envelope(
            h.client.get(f"/papers/{paper_id}/crop", params=params(RED_BOX), headers=auth(token)),
            404,
            "not_found",
        )
