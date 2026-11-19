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

    scale = clamp(1400 / long_side_pt, MIN_SCALE, MAX_SCALE)    MIN 1.0 (72 dpi), MAX 6.0 (432 dpi)
    scale = min(scale, 1600 / long_side_pt, sqrt(2.56e6 / area_pt))      the pixel caps win
    dpi   = round(72 * scale)

so a figure 280 pt wide comes out at 5x (360 dpi, 1,400 px), a tiny 40 pt label at the 6x
ceiling (240 px), a whole 792 pt page at 1.77x (127 dpi, 1,400 px). A box thinner than
``MIN_BOX_PT`` is grown around its centre to that size first (a 1 pt sliver is not a picture). The
long side never exceeds ``MAX_LONG_SIDE_PX`` and a crop never exceeds ``MAX_PIXELS``.

THE CACHE. ``<assets>/<paper>/<generation>/regions/p<page>-<x0>-<y0>-<x1>-<y1>@<dpi>dpi.png``, the
box in tenths of a point (the requested box rounded to 0.1 pt, so a re-selection a hair off hits the
same file, and what is rendered is what is keyed), written atomically. The paper's upload never
changes (its id is derived from its bytes) and a re-parse does not move the PDF, but the generation
is in the key because a crop of one parse is the board's record of that parse. Deleting a paper
removes ``<assets>/<paper>`` and with it every crop.

PyMuPDF is not safe to use from two threads at once, so one process-wide lock serialises renders;
callers run this in a thread pool (``run_in_threadpool``), never on the event loop.
"""

from __future__ import annotations

import math
import os
import struct
import threading
from dataclasses import dataclass
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
MAX_SCALE: Final = 6.0
#: Glyph antialiasing and rule ends are not clipped at the boundary (``CropStore`` pads the same).
PAD_PT: Final = 2.0
#: A box thinner than this is grown to it around its centre.
MIN_BOX_PT: Final = 16.0
#: Boxes are keyed, and rendered, in tenths of a point.
TENTH: Final = 10

_RENDER_LOCK = threading.Lock()


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
    #: The clip, in points, rounded to tenths of a point.
    box: BBox
    dpi: int

    @property
    def scale(self) -> float:
        """Pixels per point."""
        return self.dpi / 72.0

    @property
    def key(self) -> str:
        """The cache key of the clip: page and box in tenths of a point."""
        x0, y0, x1, y1 = (round(v * TENTH) for v in self.box)
        return f"p{self.page}-{x0}-{y0}-{x1}-{y1}"

    @property
    def size_px(self) -> tuple[int, int]:
        """The expected ``(width, height)`` of the PNG, in pixels."""
        x0, y0, x1, y1 = self.box
        return math.ceil((x1 - x0) * self.scale), math.ceil((y1 - y0) * self.scale)


@dataclass(frozen=True, slots=True)
class RenderedCrop:
    """A drawn (or cached) crop: the PNG bytes, its plan, its size and whether it was a hit."""

    png: bytes
    plan: CropPlan
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


def _grown(low: float, high: float, minimum: float, limit: float) -> tuple[float, float]:
    """``[low, high]`` grown around its centre to ``minimum`` long, then clipped to the page."""
    if high - low < minimum:
        centre = (low + high) / 2
        low, high = centre - minimum / 2, centre + minimum / 2
    low, high = max(0.0, low), min(limit, high)
    return low, high


def plan_crop(page: int, box: BBox, page_width: float, page_height: float) -> CropPlan:
    """Decide the clip and dpi for ``box`` on a page of this size.

    Raises ``CropError("validation_failed")`` when the box lies outside the page altogether.
    """
    x0, y0, x1, y1 = box
    if x1 <= 0 or y1 <= 0 or x0 >= page_width or y0 >= page_height:
        raise CropError("validation_failed", "box: the rectangle is outside the page")
    # The requested box rounded to a tenth first, so what is keyed is what is rendered.
    x0, y0, x1, y1 = (round(v * TENTH) / TENTH for v in (x0, y0, x1, y1))
    x0, x1 = _grown(x0 - PAD_PT, x1 + PAD_PT, MIN_BOX_PT, page_width)
    y0, y1 = _grown(y0 - PAD_PT, y1 + PAD_PT, MIN_BOX_PT, page_height)
    clip = tuple(round(v * TENTH) / TENTH for v in (x0, y0, x1, y1))
    width, height = clip[2] - clip[0], clip[3] - clip[1]
    if width <= 0 or height <= 0:
        raise CropError("validation_failed", "box: the rectangle is outside the page")
    return CropPlan(page=page, box=(clip[0], clip[1], clip[2], clip[3]), dpi=dpi_for(width, height))


def _path(root: Path, paper_id: str, generation: int, plan: CropPlan) -> Path:
    return root / paper_id / str(generation) / "regions" / f"{plan.key}@{plan.dpi}dpi.png"


def png_size(png: bytes) -> tuple[int, int]:
    """``(width, height)`` from a PNG's IHDR chunk."""
    if len(png) < 24 or png[:8] != b"\x89PNG\r\n\x1a\n":
        raise CropError("internal", "not a PNG")
    width, height = struct.unpack(">II", png[16:24])
    return int(width), int(height)


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

    ``max_bytes`` (the image ask sends the bytes to a model): a crop whose PNG is larger is rendered
    again at 75% of the dpi, up to three times, each its own cached file.
    ``CropError``: ``not_found`` (no PDF on this host), ``validation_failed`` (a page past the end,
    a box outside the page), ``internal`` (the PDF would not render).
    """
    if not pdf.is_file():
        raise CropError("not_found", "the original file is not on this host")
    with _RENDER_LOCK:
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
            for _attempt in range(4):
                path = _path(asset_root, paper_id, generation, plan)
                cached = path.is_file()
                png = path.read_bytes() if cached else _draw(sheet, plan, path)
                if max_bytes is None or len(png) <= max_bytes or plan.dpi <= 36:
                    width, height = png_size(png)
                    return RenderedCrop(png, plan, width, height, cached)
                plan = CropPlan(plan.page, plan.box, max(1, round(plan.dpi * 0.75)))
            raise CropError("internal", "the crop is too large to send")
        finally:
            document.close()


def _draw(sheet: pymupdf.Page, plan: CropPlan, destination: Path) -> bytes:
    clip = pymupdf.Rect(*plan.box) & sheet.rect
    pixmap = sheet.get_pixmap(clip=clip, matrix=pymupdf.Matrix(plan.scale, plan.scale), alpha=False)
    pixmap.set_dpi(plan.dpi, plan.dpi)
    png: bytes = pixmap.tobytes("png")
    destination.parent.mkdir(parents=True, exist_ok=True)
    scratch = destination.with_name(
        f".{destination.name}.{os.getpid()}.{threading.get_ident()}.tmp"
    )
    scratch.write_bytes(png)
    os.replace(scratch, destination)  # atomic: a reader never sees half a file
    return png
