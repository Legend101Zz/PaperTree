"""Rendering a rectangle of a page to a PNG, for the image card and the image ask (v0.3 #348).

What the reader shows as an image card and what the image ask sends the model.

    GET /papers/{id}/crop?page=&x0=&y0=&x1=&y1=      (``routers/crops.py``)

THE SPACE. ``page`` is 0-based and the box is in the page's PDF space as PyMuPDF has it: points,
origin top-left, the space of every IR ``bbox`` and of an Anchor's ``ShapeSelector`` quads. The
same numbers an image anchor holds (``image_anchor.image_box``) are the numbers rendered, so the
board card and the answer are about the same pixels.

THE DPI RULE (#348's 19 Nov comment: the model's image is heavily downsampled server-side, so a
crop must be tight and its text large). The box is padded by ``PAD_PT`` (glyph antialiasing) and
clipped to the page; its LONG side is then rendered at about ``TARGET_LONG_SIDE_PX`` (1,400) pixels:

    scale = clamp(1400 / long_side_pt, MIN_SCALE, MAX_SCALE)    MIN 1.0 (72 dpi), MAX 10.0 (720 dpi)
    scale = min(scale, 1600 / long_side_pt, sqrt(2.56e6 / area_pt))      the pixel caps win
    dpi   = round(72 * scale)

so a figure 280 pt wide comes out at 5x (360 dpi, 1,400 px), a small 137 pt figure at 10x
(720 dpi, 1,370 px), a tiny 40 pt label at the 10x ceiling (400 px), a whole 792 pt page at
1.77x (127 dpi, 1,400 px). A box thinner than ``MIN_BOX_PT`` is grown around its centre to that
size first (a 1 pt sliver is not a picture). The long side never exceeds ``MAX_LONG_SIDE_PX`` and a
crop never exceeds ``MAX_PIXELS``.

THE GRID. A box is first made COARSE: each edge is moved OUTWARD to a whole point (``GRID_PT``:
x0 and y0 down, x1 and y1 up, so a crop never loses content that was asked for) and clamped to
``0..MAX_COORD_PT`` (14,400 pt, the PDF format's own 200-inch page limit). The coarse box is what is
keyed AND what is rendered (padded, grown and clipped to the page after it), so a client that steps
a box by 0.1 pt gets the same file ten times in ten and cannot mint a file per step. A box with a
non-finite edge is a 422 and a huge finite one is clamped, never an ``OverflowError``.

THE CACHE. ``<assets>/<paper>/<generation>/regions/p<page>-<x0>-<y0>-<x1>-<y1>@<dpi>dpi.png``, the
coarse box in whole points, written atomically. ``<generation>`` is only ever one the paper has
(the route checks it), the paper's upload never changes (its id is derived from its bytes), but the
generation is in the key because a crop of one parse is the board's record of that parse. Deleting a
paper removes ``<assets>/<paper>`` and with it every crop.

THE CAP. A paper's crops, over all its generations, are capped at ``MAX_CACHED_CROPS`` files and
``MAX_CACHED_BYTES`` bytes; after a write the least recently USED files (mtime, which a cache hit
refreshes) go first until both limits hold, never the file just written. 200 crops is several times
what a reader selects from one paper (a figure or a region per question). The bytes limit is the
one that bites: a figure's crop is 0.1 to 0.5 MB of PNG and a photograph's a few MB (at most
``MAX_PIXELS``, 2.56 Mpx), so 96 MiB holds all 200 usual crops or a few dozen photographs, and a
user with N papers costs at most N x 96 MiB, never an unbounded disk.

THE SIZE RETRY. The image ask sends the PNG to a model, so ``max_bytes`` caps it: a crop over the
cap is drawn again at 75% of the dpi, up to three times, IN MEMORY, and only the one that is kept
is written, as ``...@<dpi>dpi-fit.png`` (one such file per box; a later one replaces it). The full
resolution render of that box is not cached by an image run, a plain crop request writes it.

THREADS. PyMuPDF is not thread-safe: MuPDF keeps one global context that every ``Document`` shares,
so even two different PDFs must not be used from two threads at once. ``_MUPDF_LOCK`` therefore
guards the opening and drawing of a PDF, and ONLY that. A cache hit is a directory listing and a
file read, takes no lock and is not serialised behind anyone's render. Two requests for the SAME
box share a striped per-key lock, so the second waits for the first and then finds the file (one
render, not two) while a request for another box does not wait on it. Callers run this in a thread
pool (``run_in_threadpool``), never on the event loop.
"""

from __future__ import annotations

import contextlib
import hashlib
import math
import os
import struct
import threading
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

from papertree_document_worker.pdf import pymupdf

from .image_anchor import BBox

#: What the long side of a crop is rendered to, in pixels, when the box allows it.
TARGET_LONG_SIDE_PX: Final = 1400
#: Hard ceilings: the long side, and the whole picture (a vision model downsamples what is bigger).
MAX_LONG_SIDE_PX: Final = 1600
MAX_PIXELS: Final = 2_560_000
MIN_SCALE: Final = 1.0
MAX_SCALE: Final = 10.0
#: Glyph antialiasing and rule ends are not clipped at the boundary (``CropStore`` pads the same).
PAD_PT: Final = 2.0
#: A box thinner than this is grown to it around its centre.
MIN_BOX_PT: Final = 16.0
#: Boxes are keyed, and rendered, on a grid of whole points, moved outward.
GRID_PT: Final = 1.0
#: The PDF format's own page limit (200 inches); a coordinate beyond it is clamped to it.
MAX_COORD_PT: Final = 14_400.0
#: Boxes are signed (``canonical_box``) in tenths of a point; the signature is not the cache key.
TENTH: Final = 10
#: One paper's cached crops (every generation): a count and a byte cap; the reasoning is above.
MAX_CACHED_CROPS: Final = 200
MAX_CACHED_BYTES: Final = 96 * 1024 * 1024
#: The size retry's file: ``<key>@<dpi>dpi-fit.png``.
FIT_SUFFIX: Final = "-fit"

#: PyMuPDF's one global MuPDF context: held while a PDF is opened and drawn, never otherwise.
_MUPDF_LOCK = threading.Lock()
#: Striped per-key locks: one render per cache key, no table that grows with the keys.
_KEY_LOCKS: Final = tuple(threading.Lock() for _ in range(64))
#: Cache cleaning (a directory walk and unlinks) is one at a time.
_EVICT_LOCK = threading.Lock()


class CropError(Exception):
    """A crop that cannot be made; ``code`` is the API's error code."""

    def __init__(self, code: str, detail: str) -> None:
        """Keep the API error ``code`` and the reader-facing ``detail``."""
        super().__init__(detail)
        self.code = code
        self.detail = detail


@dataclass(frozen=True, slots=True)
class CropPlan:
    """A crop decided but not yet drawn: the page, the clip in points and the dpi."""

    page: int
    #: The clip, in points: the coarse box padded, grown and clipped to the page.
    box: BBox
    dpi: int

    @property
    def scale(self) -> float:
        """Pixels per point."""
        return self.dpi / 72.0

    @property
    def size_px(self) -> tuple[int, int]:
        """The ``(width, height)`` of the PNG in pixels, give or take one (MuPDF rounds out)."""
        x0, y0, x1, y1 = self.box
        return math.ceil((x1 - x0) * self.scale), math.ceil((y1 - y0) * self.scale)


@dataclass(frozen=True, slots=True)
class RenderedCrop:
    """A drawn (or cached) crop: the PNG bytes, its dpi, its size and whether it was a hit."""

    png: bytes
    dpi: int
    width_px: int
    height_px: int
    cached: bool


def canonical_box(page: int, box: BBox) -> str:
    """The string a signed crop URL signs: the page and the box in tenths of a point."""
    x0, y0, x1, y1 = (round(v * TENTH) for v in box)
    return f"p{page}:{x0},{y0},{x1},{y1}"


def dpi_for(width_pt: float, height_pt: float) -> int:
    """The dpi a ``width_pt`` x ``height_pt`` clip is rendered at (the rule in the module doc)."""
    long_side = max(width_pt, height_pt)
    scale = min(MAX_SCALE, max(MIN_SCALE, TARGET_LONG_SIDE_PX / long_side))
    scale = min(scale, MAX_LONG_SIDE_PX / long_side, math.sqrt(MAX_PIXELS / (width_pt * height_pt)))
    return max(1, round(72.0 * scale))


def _outside() -> CropError:
    return CropError("validation_failed", "box: the rectangle is outside the page")


def coarse_box(box: BBox) -> BBox:
    """``box`` on the cache grid, moved outward.

    Every edge goes OUTWARD to a whole point and is clamped to ``0..MAX_COORD_PT``.
    ``CropError("validation_failed")`` for a non-finite edge or a box that cannot touch any page
    (its far edges must be right of and below 0).
    """
    if not all(math.isfinite(v) for v in box):
        raise CropError("validation_failed", "box: every coordinate must be a finite number")
    x0, y0, x1, y1 = box
    if x1 <= 0 or y1 <= 0 or x0 >= MAX_COORD_PT or y0 >= MAX_COORD_PT:
        raise _outside()

    def clamp(v: float) -> float:
        return min(max(v, 0.0), MAX_COORD_PT)

    return (
        math.floor(clamp(x0) / GRID_PT) * GRID_PT,
        math.floor(clamp(y0) / GRID_PT) * GRID_PT,
        math.ceil(clamp(x1) / GRID_PT) * GRID_PT,
        math.ceil(clamp(y1) / GRID_PT) * GRID_PT,
    )


def box_key(page: int, box: BBox) -> str:
    """The cache key of a page and a coarse box: ``p<page>-<x0>-<y0>-<x1>-<y1>`` in whole points."""
    x0, y0, x1, y1 = (round(v / GRID_PT) for v in coarse_box(box))
    return f"p{page}-{x0}-{y0}-{x1}-{y1}"


def _grown(low: float, high: float, minimum: float, limit: float) -> tuple[float, float]:
    """``[low, high]`` grown around its centre to ``minimum`` long, then clipped to the page."""
    if high - low < minimum:
        centre = (low + high) / 2
        low, high = centre - minimum / 2, centre + minimum / 2
    low, high = max(0.0, low), min(limit, high)
    return low, high


def plan_crop(page: int, box: BBox, page_width: float, page_height: float) -> CropPlan:
    """Decide the clip and dpi for ``box`` on a page of this size.

    Raises ``CropError("validation_failed")`` when the box is not finite or lies outside the page
    altogether.
    """
    x0, y0, x1, y1 = coarse_box(box)  # what is keyed is what is rendered
    if x0 >= page_width or y0 >= page_height:
        raise _outside()
    x0, x1 = _grown(x0 - PAD_PT, x1 + PAD_PT, MIN_BOX_PT, page_width)
    y0, y1 = _grown(y0 - PAD_PT, y1 + PAD_PT, MIN_BOX_PT, page_height)
    clip = tuple(round(v * TENTH) / TENTH for v in (x0, y0, x1, y1))
    width, height = clip[2] - clip[0], clip[3] - clip[1]
    if width <= 0 or height <= 0:
        raise _outside()
    return CropPlan(page=page, box=(clip[0], clip[1], clip[2], clip[3]), dpi=dpi_for(width, height))


def png_size(png: bytes) -> tuple[int, int]:
    """``(width, height)`` from a PNG's IHDR chunk."""
    if len(png) < 24 or png[:8] != b"\x89PNG\r\n\x1a\n":
        raise CropError("internal", "not a PNG")
    width, height = struct.unpack(">II", png[16:24])
    return int(width), int(height)


def _regions(root: Path, paper_id: str, generation: int) -> Path:
    return root / paper_id / str(generation) / "regions"


def _found(regions: Path, key: str, suffix: str) -> tuple[Path, int] | None:
    """The cached file of ``key`` and its dpi, or None.

    ``suffix`` "" is the full render, ``FIT_SUFFIX`` the size retry. The dpi is in the name because
    it follows from the page's size, which a hit does not open the PDF to learn.
    """
    try:
        for path in regions.glob(f"{key}@*dpi{suffix}.png"):
            dpi = path.name[len(key) + 1 : -len(f"dpi{suffix}.png")]
            if dpi.isdigit():
                return path, int(dpi)
    except OSError:
        pass
    return None


def _hit(regions: Path, key: str, max_bytes: int | None) -> RenderedCrop | None:
    """A cached crop that fits ``max_bytes``, read WITHOUT any lock.

    A hit refreshes the file's mtime (the least-recently-used order of the cap).
    """
    suffixes = ("",) if max_bytes is None else ("", FIT_SUFFIX)
    for suffix in suffixes:
        found = _found(regions, key, suffix)
        if found is None:
            continue
        path, dpi = found
        try:
            if max_bytes is not None and suffix == "" and path.stat().st_size > max_bytes:
                continue  # the full render is too heavy to send: the fit file, or draw one
            png = path.read_bytes()
            with contextlib.suppress(OSError):
                os.utime(path)
            width, height = png_size(png)
        except (OSError, CropError):
            continue  # gone since the listing (evicted), or not a PNG: draw it again
        return RenderedCrop(png, dpi, width, height, True)
    return None


def render_crop(
    *,
    pdf: Path,
    asset_root: Path,
    paper_id: str,
    generation: int,
    page: int,
    box: BBox,
    max_bytes: int | None = None,
) -> RenderedCrop:
    """The crop of ``box`` on ``page`` (0-based) of ``pdf``, from the cache when it is there.

    ``max_bytes`` (the image ask sends the bytes to a model): a crop whose PNG is larger is drawn
    again at 75% of the dpi, up to three times, in memory; the one kept is the only file written.
    ``CropError``: ``not_found`` (no PDF on this host), ``validation_failed`` (a page past the end,
    a box outside the page or not finite), ``internal`` (the PDF would not render).
    """
    if not pdf.is_file():
        raise CropError("not_found", "the original file is not on this host")
    key = box_key(page, box)  # raises for a box that is not finite or touches no page
    regions = _regions(asset_root, paper_id, generation)
    hit = _hit(regions, key, max_bytes)
    if hit is not None:
        return hit
    stripe = int.from_bytes(
        hashlib.blake2b(f"{regions}/{key}".encode(), digest_size=4).digest(), "big"
    )
    with _KEY_LOCKS[stripe % len(_KEY_LOCKS)]:
        hit = _hit(regions, key, max_bytes)  # another request drew it while this one waited
        if hit is not None:
            return hit
        png, plan, fit = _drawn(pdf, page, box, max_bytes)
        suffix = FIT_SUFFIX if fit else ""
        destination = regions / f"{key}@{plan.dpi}dpi{suffix}.png"
        _store(png, destination)
        if fit:  # one fit file per box: a stale one (another cap, another dpi) goes
            for stale in regions.glob(f"{key}@*dpi{FIT_SUFFIX}.png"):
                if stale != destination:
                    with contextlib.suppress(OSError):
                        stale.unlink()
        _evict(asset_root / paper_id, keep=destination)
    width, height = png_size(png)
    return RenderedCrop(png, plan.dpi, width, height, False)


def _drawn(pdf: Path, page: int, box: BBox, max_bytes: int | None) -> tuple[bytes, CropPlan, bool]:
    """Open the PDF, draw the crop (and the retries over ``max_bytes``) under the MuPDF lock.

    Returns the PNG, its plan and whether it is a size-retry (not the full-rule render).
    """
    with _MUPDF_LOCK:
        try:
            document = pymupdf.open(pdf)
        except Exception as exc:  # a PDF MuPDF cannot open: the parser had one too
            raise CropError("internal", "the PDF could not be opened") from exc
        try:
            if page >= document.page_count:
                count = document.page_count
                raise CropError(
                    "validation_failed", f"page: the paper has {count} pages (0 to {count - 1})"
                )
            sheet = document[page]
            plan = plan_crop(page, box, float(sheet.rect.width), float(sheet.rect.height))
            png = _draw(sheet, plan)
            fit = False
            for _attempt in range(3):
                if max_bytes is None or len(png) <= max_bytes or plan.dpi <= 36:
                    break
                plan = replace(plan, dpi=max(1, round(plan.dpi * 0.75)))
                png, fit = _draw(sheet, plan), True
            if max_bytes is not None and len(png) > max_bytes and plan.dpi > 36:
                raise CropError("internal", "the crop is too large to send")
            return png, plan, fit
        finally:
            document.close()


def _draw(sheet: pymupdf.Page, plan: CropPlan) -> bytes:
    clip = pymupdf.Rect(*plan.box) & sheet.rect
    pixmap = sheet.get_pixmap(clip=clip, matrix=pymupdf.Matrix(plan.scale, plan.scale), alpha=False)
    pixmap.set_dpi(plan.dpi, plan.dpi)
    png: bytes = pixmap.tobytes("png")
    return png


def _store(png: bytes, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    scratch = destination.with_name(
        f".{destination.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    scratch.write_bytes(png)
    os.replace(scratch, destination)  # atomic: a reader never sees half a file


def _evict(paper_dir: Path, *, keep: Path) -> None:
    """Hold a paper's cached crops to ``MAX_CACHED_CROPS`` and ``MAX_CACHED_BYTES``.

    The least recently used (oldest mtime) go first, never ``keep`` (the one just written).
    """
    with _EVICT_LOCK:
        entries: list[tuple[float, str, int, Path]] = []
        for path in paper_dir.glob("*/regions/*.png"):
            try:
                info = path.stat()
            except OSError:
                continue
            entries.append((info.st_mtime, path.name, info.st_size, path))
        count, total = len(entries), sum(size for _, _, size, _ in entries)
        if count <= MAX_CACHED_CROPS and total <= MAX_CACHED_BYTES:
            return
        for _mtime, _name, size, path in sorted(entries, key=lambda e: (e[0], e[1])):
            if count <= MAX_CACHED_CROPS and total <= MAX_CACHED_BYTES:
                break
            if path == keep:
                continue
            with contextlib.suppress(OSError):
                path.unlink()
            count, total = count - 1, total - size
