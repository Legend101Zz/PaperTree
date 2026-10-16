"""The opened book's figures, plate and abstract (#200), derived on read.

What the parser found, what each figure is called, and the signed URL its crop loads from.

``routers/book.py`` serves these; ``library.py`` puts the plate on ``LibraryPaper``. Everything
here is derived on read from the promoted generation. The one stored thing, the plate, is an
Anchor (``papertree_db.plate``).

A FIGURE'S LABEL comes from its caption, never from its position: the caption ``caption_of``
attaches (authoritative; ``FigurePayload.caption_block`` only mirrors it) must START with its
number, "Figure 1:", "Fig. 3." or GPT-3's "Figure 1.1:". A figure without one has no label, and a
caption that merely mentions a figure ("Figure 1.2 illustrates ...") is not a label either. The
"Use Figure 1 as the plate" offer keys on the label being exactly ``Figure 1``: GPT-3 has no such
figure (its captions are numbered 1.1, 1.2 ...), and a3c's "Figure 1." caption is attached to no
figure, so neither is offered one (``tests/test_book_api.py`` holds both to a real parse).

SIGNED URLS ARE STABLE FOR TEN MINUTES. The library polls ``GET /papers`` while a parse runs; a URL
re-signed on every poll would make the browser re-fetch every cover each time. ``exp`` is rounded up
to the next ten minutes past contracts.md §2.3's hour, so it is 60 to 70 minutes ahead.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Callable, Iterable, Mapping
from typing import Any, Final

from papertree_anchoring import IndexedDocument, capture_anchor
from papertree_db import LibraryRow, new_id
from pydantic import ValidationError

from . import assets
from .schemas import AnchorV1, LibraryPlate, PaperAbstract, PaperFigure
from .wiretime import now_wire

#: ``created.client`` of every figure Anchor this module mints (contracts.md §6).
FIGURES_CLIENT: Final = "papertree-api/figures"
#: How long one signed URL is kept before the next is minted.
URL_WINDOW_SECONDS: Final = 600

#: "Figure 1", "FIG. 2", "Fig 3", "Figure 1.1" at the very start of a caption.
_LABEL = re.compile(r"\s*(?:figure|fig\.?)\s*(\d+(?:\.\d+)*)", re.IGNORECASE)

#: ``image uri -> signed URL`` for one paper, or None when the URI is not a crop of it.
Signer = Callable[[str | None], str | None]


def figure_label(caption_text: str | None) -> str | None:
    """The figure's printed name, read from the start of its caption.

    Args:
        caption_text: The caption block's text, or None when the figure has no caption.

    Returns:
        ``"Figure 1"`` for ``"Figure 1: The Transformer"`` or ``"Fig. 1. Training error"``,
        ``"Figure 1.1"`` for ``"Figure 1.1: Language model meta-learning"``, None otherwise.

    Example:
        >>> figure_label("Figure 2: (left) Scaled Dot-Product Attention.")
        'Figure 2'
    """
    found = _LABEL.match(caption_text or "")
    return None if found is None else f"Figure {found.group(1)}"


def stable_exp(now: float) -> int:
    """The ``exp`` of a signed URL minted at ``now``: an hour ahead, rounded up to ten minutes.

    Args:
        now: Unix time.

    Returns:
        A Unix time 60 to 70 minutes after ``now``, equal for every ``now`` in one ten-minute
        window.
    """
    ahead = now + assets.SIGNED_URL_SECONDS
    return math.ceil(ahead / URL_WINDOW_SECONDS) * URL_WINDOW_SECONDS


def asset_signer(base_url: str, secret: str, now: float) -> Callable[[str, str | None], str | None]:
    """Signs crop URIs for any paper, all with one ``exp`` (see :func:`stable_exp`).

    Args:
        base_url: The request's base URL, ending in ``/``.
        secret: ``PAPERTREE_SIGNING_SECRET``.
        now: Unix time.

    Returns:
        ``sign(paper_id, image_uri)``: the signed URL of that crop, or None when the URI is not a
        servable crop of that paper (no crop rendered yet, or another paper's).
    """
    exp = stable_exp(now)

    def sign(paper_id: str, image_uri: str | None) -> str | None:
        found = assets.ASSET_URI.fullmatch(image_uri or "")
        if found is None or found["paper_id"] != paper_id:
            return None
        return assets.signed_url(
            base_url,
            secret,
            paper_id=paper_id,
            gen=int(found["gen"]),
            kind=found["kind"],
            block_id=found["block_id"],
            exp=exp,
        )

    return sign


def library_plate(
    row: LibraryRow, sign: Callable[[str, str | None], str | None]
) -> LibraryPlate | None:
    """``LibraryPaper.plate``: the chosen figure, or None for the typographic cover.

    A plate whose figure has no rendered crop is None too: the cover cannot show it.

    Args:
        row: The paper's library row.
        sign: An :func:`asset_signer`.

    Returns:
        The plate as the wire carries it.
    """
    plate = row.plate
    if plate is None:
        return None
    url = sign(row.paper_id, plate.image_uri)
    if url is None:
        return None
    return LibraryPlate(
        block_id=plate.block_id,
        page_index=plate.page_index,
        label=figure_label(plate.caption_text),
        caption_text=plate.caption_text,
        asset_url=url,
    )


def _anchor(document: IndexedDocument, block_id: str, target_kind: Any) -> AnchorV1:
    """A whole-block Anchor over ``block_id``, held to the Anchor v1 contract on its JSON.

    Strict pydantic reads a JSON array as a tuple and a Python list not, so the wire form is what
    is checked.
    """
    record = capture_anchor(
        document,
        block_id,
        anchor_id=new_id("anc"),
        at=now_wire(),
        client=FIGURES_CLIENT,
        target_kind=target_kind,
    )
    return AnchorV1.model_validate_json(json.dumps(record))


def _anchor_or_none(document: IndexedDocument, block_id: str, target_kind: Any) -> AnchorV1 | None:
    """:func:`_anchor`, or None when the contract refuses what capture produced.

    A block with no extent is such a case: it is listed, and cannot be chosen.
    """
    try:
        return _anchor(document, block_id, target_kind)
    except ValidationError:
        return None


def captions_by_figure(relations: Iterable[Mapping[str, Any]]) -> dict[str, str]:
    """``figure block id -> caption block id`` from a generation's relations.

    Args:
        relations: ``relations`` rows (``type``, ``from_block``, ``to_block``).

    Returns:
        One caption per float; the first by id when the parser attached two.
    """
    found: dict[str, str] = {}
    for relation in relations:
        if relation["type"] == "caption_of":
            found.setdefault(str(relation["to_block"]), str(relation["from_block"]))
    return found


def paper_figures(
    document: IndexedDocument, relations: Iterable[Mapping[str, Any]], sign: Signer
) -> list[PaperFigure]:
    """Every figure block of one generation, in reading order, with its caption and crop.

    Args:
        document: The generation, indexed for anchoring (its blocks' text is ``resolved_text``).
        relations: That generation's ``relations`` rows.
        sign: This paper's crop signer.

    Returns:
        One entry per ``figure`` block; Figure 2 drawn as two regions is two entries, one of them
        captioned. Detection misses some figures (#103), so this is what was FOUND, not all.
    """
    captions = captions_by_figure(relations)
    figures: list[PaperFigure] = []
    for indexed in document.blocks:
        block = indexed.block
        if block.type != "figure":
            continue
        caption_id = captions.get(block.block_id)
        caption = document.by_id.get(caption_id) if caption_id is not None else None
        caption_text = caption.text if caption is not None else None
        image = (block.payload or {}).get("image")
        figures.append(
            PaperFigure(
                block_id=block.block_id,
                page_index=block.page_index,
                bbox=(
                    float(block.bbox[0]),
                    float(block.bbox[1]),
                    float(block.bbox[2]),
                    float(block.bbox[3]),
                ),
                caption_text=caption_text,
                caption_block_id=caption_id if caption is not None else None,
                label=figure_label(caption_text),
                asset_url=sign(image.get("uri") if isinstance(image, dict) else None),
                anchor=_anchor_or_none(document, block.block_id, "figure"),
            )
        )
    return figures


def paper_abstract(document: IndexedDocument, metadata: Any) -> PaperAbstract:
    """The abstract the parser found (``metadata.abstract.block_ids``), with an Anchor on it.

    The Anchor is on its first block: the "p. 1 · Abstract" tab.

    Args:
        document: The generation, indexed for anchoring.
        metadata: ``papers.metadata`` of that generation (JSON text).

    Returns:
        The abstract's blocks' text joined by a blank line; every field None when the parser found
        no abstract (or its blocks are not in this parse).
    """
    try:
        data = json.loads(metadata) if isinstance(metadata, str) else {}
    except ValueError:
        data = {}
    abstract = data.get("abstract") if isinstance(data, dict) else None
    ids = abstract.get("block_ids") if isinstance(abstract, dict) else None
    blocks = [
        document.by_id[block_id]
        for block_id in (ids if isinstance(ids, list) else [])
        if isinstance(block_id, str) and block_id in document.by_id
    ]
    if not blocks:
        return PaperAbstract(text=None, page_index=None, anchor=None)
    first = blocks[0].block
    return PaperAbstract(
        text="\n\n".join(b.text for b in blocks),
        page_index=first.page_index,
        anchor=_anchor_or_none(document, first.block_id, "text"),
    )
