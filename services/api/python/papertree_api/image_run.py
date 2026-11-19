"""What an image run is made of: the seed, the crop and the title (v0.3 #348).

Both entry points build the same thing from an image anchor: the reader's
``POST /papers/{id}/threads`` with ``kind: "image"`` (and its follow-ups), and a board ask whose
tree root is an image card (every ask down that path sends the root's crop again).

    anchor ──▶ ImageContext (the float, its caption, the paragraph that first mentions it)
          ──▶ SeedPlan     (those words, as handled, datamarked passages)
          ──▶ crop PNG     (``region_crops``: tight, long side near 1,400 px)  ──▶ AgentImage

The crop is rendered here, off the event loop, and sent to the agent as base64 in the run request;
the agent hands it to a model that accepts images (and to no other).
"""

from __future__ import annotations

import base64
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

from papertree_retrieval import PaperIndex
from starlette.concurrency import run_in_threadpool

from . import evidence
from .errors import ApiError
from .image_context import ImageContext, image_caption_line, image_context, plan_image_seed
from .region_crops import CropError, render_crop
from .schemas import AgentImage
from .settings import Settings

#: The most bytes of PNG sent to the model (the agent's own cap is 4 MiB): a heavier crop is drawn
#: again at a lower dpi, three times at most.
MAX_CROP_BYTES: Final = 3 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class ImageRun:
    """The seed, the picture and the thread title of one image run."""

    context: ImageContext
    seed: evidence.SeedPlan
    images: list[AgentImage]
    #: A thread's title: the figure's label and caption, else the question.
    title: str
    dpi: int


async def prepare_image_run(
    settings: Settings,
    index: PaperIndex,
    anchor: Mapping[str, Any],
    *,
    paper_id: str,
    generation: int,
    datamark: str,
    question: str,
    with_text_anchor: Mapping[str, Any] | None = None,
    include_mention: bool = True,
) -> ImageRun:
    """Build the image run for ``anchor`` (an image anchor, already checked against the paper).

    ``with_text_anchor``: a text anchor the reader selected with the figure (its passages go
    first). ``include_mention`` false (a board ask whose paper is ``off``) sends the figure and its
    own caption and no paragraph of the paper. ``ApiError`` ``not_found`` when the PDF is not on
    this host, ``validation_failed`` for a page past the end or a box off the page.
    """
    context = image_context(index, anchor)
    chosen = (
        evidence.plan_seed(index, with_text_anchor, datamark=datamark)
        if with_text_anchor is not None
        else None
    )
    seed = plan_image_seed(
        index, context, datamark=datamark, with_text=chosen, include_mention=include_mention
    )
    try:
        crop = await run_in_threadpool(
            render_crop,
            pdf=settings.upload_root / f"{paper_id}.pdf",
            asset_root=settings.asset_root,
            paper_id=paper_id,
            generation=generation,
            page=context.page_index,
            box=context.box,
            max_bytes=MAX_CROP_BYTES,
        )
    except CropError as exc:
        raise ApiError(exc.code, exc.detail) from exc  # type: ignore[arg-type]
    caption = image_caption_line(index, context)
    image = AgentImage(
        media_type="image/png",
        data_base64=base64.b64encode(crop.png).decode("ascii"),
        caption=caption or None,
        page=context.page_index,
    )
    named = " ".join(part for part in (context.label, caption) if part)
    return ImageRun(
        context=context,
        seed=seed,
        images=[image],
        title=evidence.header_text(named or question, limit=80),
        dpi=crop.plan.dpi,
    )
