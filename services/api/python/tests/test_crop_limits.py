"""v0.3 (#348) hardening of ``region_crops`` and the crop route, from the independent review.

* the cache is bounded: a box is keyed on a coarse grid (stepping it by 0.1 pt mints no file), a
  ``gen`` is only ever one the paper has, a paper's crops are capped (count and bytes, least
  recently used out), and the image run's size retry writes ONE file;
* a cache hit takes no lock, and two requests for one new box draw it once;
* a huge or non-finite box is an error or a clamp, never an ``OverflowError`` (a 500);
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import pytest
from api_support import assert_envelope, auth, harness, register, seed_paper
from crop_support import RED_BOX, store_pdf
from papertree_api import region_crops
from papertree_api.region_crops import CropError, plan_crop, render_crop

SLUG = "resnet-cvpr-2col"


def _render(root: Path, box: tuple[float, float, float, float], **extra: Any) -> Any:
    return render_crop(
        pdf=root / "up" / "ppr_x.pdf",
        asset_root=root / "assets",
        paper_id="ppr_x",
        generation=1,
        page=0,
        box=box,
        **extra,
    )


def _files(root: Path) -> list[Path]:
    return sorted((root / "assets").rglob("regions/*.png"))


def _store(root: Path) -> None:
    store_pdf(root / "up", "ppr_x")


# ── 1. the cache is bounded ──────────────────────────────────────────────────────────────────


def test_a_box_stepped_by_a_tenth_of_a_point_mints_one_file_not_one_per_step(
    tmp_path: Path,
) -> None:
    _store(tmp_path)
    for step in range(40):
        x0 = 100.0 + step * 0.1  # 100.0 .. 103.9: a client probing the cache
        _render(tmp_path, (x0, 200.0, 380.0, 300.0))
    names = [p.name for p in _files(tmp_path)]
    assert len(names) <= 4, names  # one per whole point (100..103), never one per 0.1
    # The grid moves edges OUTWARD, so the crop never loses what was asked for: the coarse box
    # contains the requested one.
    assert region_crops.coarse_box((100.3, 200.2, 379.6, 299.9)) == (100.0, 200.0, 380.0, 300.0)
    assert region_crops.coarse_box((100.0, 200.0, 380.0, 300.0)) == (100.0, 200.0, 380.0, 300.0)


def test_what_is_rendered_is_what_is_keyed_the_crop_never_loses_the_requested_box(
    tmp_path: Path,
) -> None:
    _store(tmp_path)
    requested = (100.4, 200.4, 379.6, 299.6)
    plan = plan_crop(0, requested, 612, 792)
    x0, y0, x1, y1 = plan.box
    assert x0 <= requested[0] - region_crops.PAD_PT + 1e-9 and y0 <= requested[1] - 2 + 1e-9
    assert x1 >= requested[2] + region_crops.PAD_PT - 1e-9 and y1 >= requested[3] + 2 - 1e-9
    near = _render(tmp_path, requested)
    again = _render(tmp_path, (100.1, 200.1, 379.9, 299.9))  # the same coarse box
    assert near.png == again.png and again.cached


def test_gen_must_be_one_the_paper_has_and_the_default_is_the_promoted_one(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, SLUG)
        store_pdf(h.settings.upload_root, paper_id)
        x0, y0, x1, y1 = RED_BOX
        query = {"page": 0, "x0": x0, "y0": y0, "x1": x1, "y1": y1}
        for path in ("crop", "crop-url"):
            for gen in (2, 999, 10**18):
                response = h.client.get(
                    f"/papers/{paper_id}/{path}", params={**query, "gen": gen}, headers=auth(token)
                )
                assert_envelope(response, 404, "not_found")
        assert not list(h.settings.asset_root.rglob("regions")), "no directory for a made-up gen"
        real = h.client.get(
            f"/papers/{paper_id}/crop", params={**query, "gen": 1}, headers=auth(token)
        )
        default = h.client.get(f"/papers/{paper_id}/crop", params=query, headers=auth(token))
        assert real.status_code == default.status_code == 200
        assert default.headers["x-crop-cache"] == "hit"  # the default IS generation 1
        assert list(h.settings.asset_root.rglob("999")) == []
        zero = h.client.get(
            f"/papers/{paper_id}/crop", params={**query, "gen": 0}, headers=auth(token)
        )
        assert_envelope(zero, 422, "validation_failed")  # the grammar of `?gen=` is unchanged


def test_a_papers_crops_are_capped_by_count_and_the_least_recently_used_go_first(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _store(tmp_path)
    monkeypatch.setattr(region_crops, "MAX_CACHED_CROPS", 5)

    def box(index: int) -> tuple[float, float, float, float]:
        return (100.0 + index * 10, 200.0, 380.0, 300.0)

    for index in range(4):  # box(0) is the oldest, box(1..3) newer
        _render(tmp_path, box(index))
    assert _render(tmp_path, box(0)).cached  # box(0) is USED again: now the newest of the four
    for index in range(4, 7):
        _render(tmp_path, box(index))
        assert len(_files(tmp_path)) <= 5
    assert len(_files(tmp_path)) == 5
    # By use, oldest first: 1, 2, 3, 0, 4, 5, 6. The two least recently used (1 and 2) are gone,
    # and box(0), the oldest WRITTEN but recently USED, stayed.
    assert _render(tmp_path, box(6)).cached, "the crop just written is never the one evicted"
    assert _render(tmp_path, box(0)).cached, "a crop that is used stays"
    assert not _render(tmp_path, box(1)).cached, "an old, unused crop went"
    # Eviction counted this paper's files only, across its generations.
    assert {p.parent.parent.parent.name for p in _files(tmp_path)} == {"ppr_x"}


def test_a_papers_crops_are_capped_by_bytes_never_evicting_the_one_just_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _store(tmp_path)
    size = len(_render(tmp_path, (100.0, 200.0, 380.0, 300.0)).png)
    monkeypatch.setattr(region_crops, "MAX_CACHED_BYTES", int(size * 2.5))
    for index in range(1, 8):
        rendered = _render(tmp_path, (100.0 + index * 10, 200.0, 380.0, 300.0))
        assert rendered.png
    total = sum(p.stat().st_size for p in _files(tmp_path))
    assert total <= size * 2.5 + 2000 and len(_files(tmp_path)) >= 1
    assert _render(tmp_path, (100.0 + 7 * 10, 200.0, 380.0, 300.0)).cached


def test_the_size_retry_of_an_image_run_writes_one_file_not_one_per_attempt(tmp_path: Path) -> None:
    _store(tmp_path)
    box = (100.0, 200.0, 380.0, 300.0)
    full = len(_render(tmp_path, box).png)
    for path in _files(tmp_path):
        path.unlink()
    capped = _render(tmp_path, box, max_bytes=int(full * 0.55))
    assert capped.dpi < region_crops.dpi_for(284.0, 104.0), "it really was drawn again, smaller"
    assert len(capped.png) <= int(full * 0.55)
    written = _files(tmp_path)
    assert len(written) == 1 and written[0].name.endswith("dpi-fit.png"), [p.name for p in written]
    again = _render(tmp_path, box, max_bytes=int(full * 0.55))
    assert again.cached and again.png == capped.png and len(_files(tmp_path)) == 1
    # A plain crop request of the same box is the full render (and the fit file is not mistaken
    # for it).
    plain = _render(tmp_path, box)
    assert not plain.cached and len(plain.png) == full and plain.dpi > capped.dpi
    assert len(_files(tmp_path)) == 2


# ── 2. the lock ──────────────────────────────────────────────────────────────────────────────


def _module_locks() -> list[Any]:
    lock_type = type(threading.Lock())
    return [v for v in vars(region_crops).values() if isinstance(v, lock_type)]


def test_a_cache_hit_takes_no_lock_so_it_is_not_queued_behind_anyone_elses_render(
    tmp_path: Path,
) -> None:
    _store(tmp_path)
    box = (100.0, 200.0, 380.0, 300.0)
    drawn = _render(tmp_path, box)
    locks = _module_locks()
    assert locks, "the module has its render locks"
    for lock in locks:
        assert lock.acquire(timeout=1)  # somebody else's render holds EVERY module lock
    results: list[Any] = []
    try:
        worker = threading.Thread(target=lambda: results.append(_render(tmp_path, box)))
        worker.start()
        worker.join(timeout=5)
        assert not worker.is_alive(), "the cache hit waited on a lock"
    finally:
        for lock in locks:
            lock.release()
    assert results[0].cached and results[0].png == drawn.png


def test_two_requests_for_one_new_box_draw_it_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _store(tmp_path)
    calls: list[int] = []
    original = region_crops._draw

    def counting(*args: Any, **kwargs: Any) -> bytes:
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(region_crops, "_draw", counting)
    box = (100.0, 200.0, 380.0, 300.0)
    results: list[Any] = []
    threads = [
        threading.Thread(target=lambda: results.append(_render(tmp_path, box))) for _ in range(6)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert len(results) == 6 and len(calls) == 1
    assert sum(1 for r in results if not r.cached) == 1
    assert len({r.png for r in results}) == 1


# ── 4. a huge or non-finite box ──────────────────────────────────────────────────────────────


def test_a_huge_finite_box_is_clipped_to_the_page_and_a_non_finite_one_is_refused() -> None:
    plan = plan_crop(0, (10.0, 10.0, 1e308, 1e308), 612, 792)  # an OverflowError before
    assert plan.box == (8.0, 8.0, 612.0, 792.0)
    assert plan_crop(0, (-1e308, -1e308, 50.0, 60.0), 612, 792).box[0] == 0.0
    for bad in (
        (0.0, 0.0, float("inf"), 10.0),
        (0.0, float("nan"), 10.0, 10.0),
        (-float("inf"), 0.0, 10.0, 10.0),
    ):
        with pytest.raises(CropError) as excinfo:
            plan_crop(0, bad, 612, 792)
        assert excinfo.value.code == "validation_failed"
    with pytest.raises(CropError):
        plan_crop(0, (1e308, 1e308, 1.5e308, 1.5e308), 612, 792)  # beyond every page
