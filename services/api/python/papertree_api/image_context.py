"""The words that go with a picture: what the image ask sends BESIDE the crop (v0.3 #348).

#348's 19 Nov comment: the model's image is heavily downsampled server-side (it read dense small
text wrong, on both Flash and M3), so a crop is never sent alone. It always comes with, as TEXT:

* the float's CAPTION (``caption_of``: caption -> float), and
* the paragraph that FIRST MENTIONS it: the lowest ``doc_order`` source of a ``references`` edge
  into the float (ties and nested sources by reading-order rank), a prose block (not another
  caption or a footnote).

THE PARSER'S GAPS ARE REAL (measured 2026-11-20 on resnet-cvpr-2col: Figure 1 has its
``caption_of`` and two ``references`` edges, but Figure 2's caption is a body paragraph
("identity F(x)+x / Figure 2. Residual learning: a building block.") with no edge, and no
``references`` edge points at it). So each edge is tried first and the printed label second: a
float with no ``caption_of`` takes the nearest block on its page (within ``CAPTION_REACH_PT``) that
has a line starting "Figure N." (its words from that line on), and a float with no ``references``
edge takes the first body paragraph, by ``doc_order``, that names "Figure N" (the caption
excluded). A float with neither gets the nearest text blocks, as a free rectangle does.

WHICH FLOAT. An image anchor names one (a ``figure`` anchor's ``BlockSelector``, when its block is a
float of this parse) or it is a free rectangle (``figure_region``): then it is the float it lies
INSIDE (at least half of the rectangle overlaps the float's box, or its centre is in it; the
smallest such float wins, a panel over the whole figure). A rectangle in no float gets the NEAREST
text blocks on its page instead (up to three, the nearest caption first): the words around it.

``plan_image_seed`` turns that into the run's seed: passages ``[b1…]`` in this order, a selected
text first when the reader shift-selected a paragraph with the figure (``with_text``), then the
caption, then the first mention, then the nearby blocks. Each is capped and datamarked like any
seed passage and its label says what it is, so the model cites the right one.

Pure over a ``PaperIndex`` (no I/O), so every rule has a plain test, one of them on a real parse.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from papertree_prompts import datamark_text
from papertree_retrieval import PaperIndex

from . import evidence
from .image_anchor import BBox, block_id_of, image_box

#: The blocks an image can be: the IR's figure-like floats.
FLOAT_TYPES: Final = frozenset({"figure", "diagram", "plot", "table", "algorithm"})
#: A mention is prose: never another float's caption, a footnote, a reference or page furniture.
PROSE_TYPES: Final = frozenset({"paragraph", "abstract", "list_item", "list"})
#: What counts as "words near a region" when no float holds it.
NEARBY_TYPES: Final = PROSE_TYPES | {"caption"}
#: How much of a region must lie inside a float for the region to be "of" that float.
INSIDE_FRACTION: Final = 0.5
MAX_NEARBY: Final = 3
#: Characters of each text sent beside the picture (cut at a sentence end where one is in reach).
CAPTION_CHARS: Final = 1200
MENTION_CHARS: Final = 2400
NEARBY_CHARS: Final = 800
SEED_TOKENS: Final = 1500

_LABEL: Final = re.compile(
    r"^\s*((?:Figure|Fig\.?|Table|Algorithm|Plot|Diagram)\s*[0-9]+(?:\.[0-9]+)*[a-z]?)", re.I
)
#: A label split into its word ("Fig.") and its number ("2", "1.1", "3b").
_LABEL_PARTS: Final = re.compile(
    r"^(Figure|Fig\.?|Table|Algorithm|Plot|Diagram)\s*([0-9]+(?:\.[0-9]+)*[a-z]?)$", re.I
)
#: A line of text that opens a caption: "Figure 2." or "Fig. 2:" at the start of a line.
_CAPTION_LINE: Final = re.compile(
    r"^[ \t]*((?:Figure|Fig\.?|Table|Algorithm)[ \t]*[0-9]+(?:\.[0-9]+)*[a-z]?)[ \t]*[.:]",
    re.I | re.M,
)
#: How near (page points) a block must be to a float to be its caption when no edge says so.
CAPTION_REACH_PT: Final = 40.0


@dataclass(frozen=True, slots=True)
class ImageContext:
    """What surrounds an image anchor in one parse."""

    page_index: int
    #: The rectangle the reader chose (the anchor's quad), in page points.
    box: BBox
    float_id: str | None
    float_type: str | None
    #: "Figure 2", read from the start of the caption; None when there is no caption or it has none.
    label: str | None
    caption_id: str | None
    #: The caption's own words when it is only PART of its block (a caption found by its printed
    #: label inside a body paragraph); None means the whole block is the caption.
    caption_text: str | None
    mention_id: str | None
    #: With no float: the nearest text blocks, in reading order. Empty when a float holds the box.
    nearby_ids: tuple[str, ...]

    @property
    def text_block_ids(self) -> tuple[str, ...]:
        """Every block whose words go beside the picture, in the order they are sent."""
        ids = [self.caption_id, self.mention_id, *self.nearby_ids]
        return tuple(dict.fromkeys(i for i in ids if i is not None))


def _overlap(a: BBox, b: Sequence[float]) -> float:
    width = min(a[2], b[2]) - max(a[0], b[0])
    height = min(a[3], b[3]) - max(a[1], b[1])
    return max(0.0, width) * max(0.0, height)


def _area(box: Sequence[float]) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _gap(a: BBox, b: Sequence[float]) -> float:
    """The distance between two boxes (0 when they touch or overlap)."""
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return math.hypot(dx, dy)


def float_of(index: PaperIndex, page: int, box: BBox, block_id: str | None) -> str | None:
    """The float block this image is, or lies inside; None for a rectangle in no float."""
    if block_id is not None:
        named = index.block(block_id)
        if named is not None and named.type in FLOAT_TYPES:
            return block_id
    centre = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
    region = _area(box)
    best: tuple[float, str] | None = None
    for candidate in index.reading_order:
        block = index.block(candidate)
        if block is None or block.type not in FLOAT_TYPES or block.page_index != page:
            continue
        inside = region > 0 and _overlap(box, block.bbox) / region >= INSIDE_FRACTION
        holds_centre = (
            block.bbox[0] <= centre[0] <= block.bbox[2]
            and block.bbox[1] <= centre[1] <= block.bbox[3]
        )
        if inside or holds_centre:
            size = _area(block.bbox)
            if best is None or size < best[0]:
                best = (size, candidate)
    return None if best is None else best[1]


def caption_of(index: PaperIndex, float_id: str) -> str | None:
    """The caption block of a float: the source of its ``caption_of`` edge (first by position)."""
    sources = [r.from_block for r in index.relations_to(float_id) if r.type == "caption_of"]
    sources = [s for s in sources if s in index]
    return min(sources, key=index.rank) if sources else None


def first_mention_of(index: PaperIndex, float_id: str) -> str | None:
    """The prose block that first mentions a float, by its ``references`` edges.

    It is the lowest ``doc_order`` source of a ``references`` edge into the float. A source with no
    ``doc_order`` (nested in a list) sorts after the body ones, by reading-order rank; a caption,
    footnote or reference entry is never a mention.
    """
    sources: list[str] = []
    for relation in index.relations_to(float_id):
        block = index.block(relation.from_block) if relation.type == "references" else None
        if block is not None and block.type in PROSE_TYPES and block.text.strip():
            sources.append(relation.from_block)
    if not sources:
        return None

    def order(block_id: str) -> tuple[int, int, int]:
        block = index.block(block_id)
        assert block is not None
        placed = block.doc_order is None
        return (1 if placed else 0, block.doc_order or 0, index.rank(block_id))

    return min(sources, key=order)


def nearest_text(index: PaperIndex, page: int, box: BBox, *, limit: int = MAX_NEARBY) -> list[str]:
    """The text blocks nearest a region on its page, returned in reading order.

    The nearest ``limit`` are chosen; a caption on the page is always one of them.
    """
    scored: list[tuple[float, int, str]] = []
    for block_id in index.reading_order:
        block = index.block(block_id)
        if block is None or block.page_index != page or block.type not in NEARBY_TYPES:
            continue
        if not block.text.strip():
            continue
        scored.append((_gap(box, block.bbox), index.rank(block_id), block_id))
    scored.sort()
    chosen = [block_id for _gap_, _rank, block_id in scored[:limit]]
    captions = [b for _g, _r, b in scored if (blk := index.block(b)) and blk.type == "caption"]
    if captions and not any((blk := index.block(b)) and blk.type == "caption" for b in chosen):
        chosen = [*chosen[: limit - 1], captions[0]]
    return sorted(chosen, key=index.rank)


def label_of(index: PaperIndex, caption_id: str | None, text: str | None = None) -> str | None:
    """The label a caption opens with ("Figure 2", "Fig. 2", "Table 5"), as printed."""
    block = index.block(caption_id) if caption_id is not None else None
    words = text if text is not None else (block.text if block is not None else "")
    found = _LABEL.match(words)
    return None if found is None else " ".join(found.group(1).split())


def captionless_caption(index: PaperIndex, float_id: str) -> tuple[str, str] | None:
    """Find the caption of a float that has no ``caption_of`` edge, by its printed label.

    Returns ``(block_id, words)`` of the nearest block on the float's page, within
    ``CAPTION_REACH_PT``, that has a line opening "Figure N." (or Table, Algorithm); the words are
    taken from that line to the end of the block. None if there is none.
    """
    anchor = index.block(float_id)
    if anchor is None:
        return None
    found: list[tuple[float, int, str, str]] = []
    for block_id in index.reading_order:
        block = index.block(block_id)
        if block is None or block.page_index != anchor.page_index or block_id == float_id:
            continue
        if block.type not in NEARBY_TYPES:
            continue
        line = _CAPTION_LINE.search(block.text)
        gap = _gap(anchor.bbox, block.bbox)
        if line is not None and gap <= CAPTION_REACH_PT:
            found.append((gap, index.rank(block_id), block_id, block.text[line.start() :]))
    if not found:
        return None
    _gap_, _rank, block_id, words = min(found)
    return block_id, words


def mention_by_label(index: PaperIndex, label: str | None, skip: str | None) -> str | None:
    """Find the first mention of a float that no ``references`` edge points at, by its label.

    It is the first body paragraph (lowest ``doc_order``) that names the label, "Figure 2" or
    "Fig. 2" (never "Figure 20"). ``skip`` is the caption's block.
    """
    parts = _LABEL_PARTS.match(label or "")
    if parts is None:
        return None
    word, number = parts.group(1), parts.group(2)
    family = r"(?:Figure|Fig\.?)" if word.lower().startswith("fig") else re.escape(word)
    named = re.compile(rf"\b{family}\s*{re.escape(number)}(?![0-9a-z])", re.I)
    best: tuple[int, int, str] | None = None
    for block_id in index.reading_order:
        block = index.block(block_id)
        if block is None or block_id == skip or block.type not in PROSE_TYPES:
            continue
        if block.doc_order is None or named.search(block.text) is None:
            continue
        if best is None or (block.doc_order, index.rank(block_id)) < best[:2]:
            best = (block.doc_order, index.rank(block_id), block_id)
    return None if best is None else best[2]


def image_context(index: PaperIndex, anchor: Mapping[str, Any]) -> ImageContext:
    """The context of an image anchor in this parse. ``ValueError`` if it is not an image anchor."""
    page, box = image_box(anchor)
    float_id = float_of(index, page, box, block_id_of(anchor))
    caption = mention = caption_text = None
    nearby: list[str] = []
    float_type: str | None = None
    if float_id is not None:
        found = index.block(float_id)
        float_type = found.type if found is not None else None
        caption = caption_of(index, float_id)
        if caption is None and (inferred := captionless_caption(index, float_id)) is not None:
            caption, caption_text = inferred
        label = label_of(index, caption, caption_text)
        mention = first_mention_of(index, float_id) or mention_by_label(index, label, caption)
    if float_id is None or (caption is None and mention is None):
        nearby = nearest_text(index, page, box)
        label = None
    return ImageContext(
        page_index=page,
        box=box,
        float_id=float_id,
        float_type=float_type,
        label=label,
        caption_id=caption,
        caption_text=caption_text,
        mention_id=mention,
        nearby_ids=tuple(nearby),
    )


# ── the seed ─────────────────────────────────────────────────────────────────────────────────


def cut(text: str, limit: int) -> str:
    """Flatten ``text`` to one line and cut it to ``limit`` characters.

    The cut is at a sentence end within the last fifth of ``limit``, else at a word with an
    ellipsis.
    """
    flat = " ".join(text.split())
    if len(flat) <= limit:
        return flat
    head = flat[:limit]
    stop = max(head.rfind(". "), head.rfind("? "), head.rfind("! "))
    if stop >= limit * 0.8:
        return head[: stop + 1]
    return head.rsplit(" ", 1)[0] + " …"


def plan_image_seed(
    index: PaperIndex,
    context: ImageContext,
    *,
    datamark: str,
    with_text: evidence.SeedPlan | None = None,
    include_mention: bool = True,
    budget_tokens: int = SEED_TOKENS,
) -> evidence.SeedPlan:
    """Build the seed of an image run.

    ``with_text``'s passages (the paragraph the reader selected with the figure) come first, then
    the caption, the first mention and the nearby blocks, each capped, datamarked and labelled for
    what it is. The caption always goes; the rest only while the budget (marked tokens, like every
    seed) allows. ``include_mention`` false is the board's ``paper: off``: the figure and its own
    caption, no paragraph of the paper.
    """
    cost = evidence.marked_cost(datamark)
    passages: list[tuple[str, str, str]] = []
    total = 0
    if with_text is not None:
        passages.extend(with_text.passages)
        total += with_text.total_tokens
    taken = {block for block, _label, _text in passages}
    plan: list[tuple[str, str, int]] = []
    if context.caption_id is not None:
        plan.append((context.caption_id, "the figure's caption", CAPTION_CHARS))
    if include_mention and context.mention_id is not None:
        plan.append(
            (context.mention_id, "where the paper first mentions the figure", MENTION_CHARS)
        )
    if include_mention:
        plan.extend((b, "text next to the figure", NEARBY_CHARS) for b in context.nearby_ids)
    for position, (block_id, what, limit) in enumerate(plan):
        block = index.block(block_id)
        if block is None or block_id in taken:
            continue
        own = (
            context.caption_text
            if block_id == context.caption_id and what.endswith("caption")
            else None
        )
        text = cut(own if own is not None else block.text, limit)
        spend = cost(text)
        if position > 0 and total + spend > budget_tokens:
            continue
        label = f"{evidence.passage_label(index, block_id)} · {what}"
        passages.append((block_id, label, datamark_text(text, datamark=datamark)))
        taken.add(block_id)
        total += spend
    anchor_block = context.float_id or (passages[0][0] if passages else None)
    section = evidence.section_title(index, anchor_block) if anchor_block is not None else None
    return evidence.SeedPlan(
        block_ids=tuple(block for block, _label, _text in passages),
        quote=with_text.quote if with_text is not None else "",
        page_label=f"p. {evidence.page_label(context.page_index)}",
        section=section,
        passages=tuple(passages),
        total_tokens=total,
    )


def image_caption_line(index: PaperIndex, context: ImageContext) -> str:
    """The short caption line that rides on the image itself (``images[].caption``).

    It is the caption's words, at most 400 characters, and "" when the figure has none.
    """
    block = index.block(context.caption_id) if context.caption_id is not None else None
    if block is None:
        return ""
    return cut(context.caption_text if context.caption_text is not None else block.text, 400)
