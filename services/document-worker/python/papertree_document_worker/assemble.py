"""Assembly: everything the earlier stages found, as one PaperIR document that VALIDATES.

This is the module where the schema stops being a reference and starts being a constraint. A
document that passes Pydantic is well-FORMED; one that also passes `validate_paper` is well-formed
and internally CONSISTENT, and only the second is allowed out of here.

THE RULES THAT SHAPE THE CODE, rather than being checked after it

Most of `validate.py`'s 50 semantic rules are satisfied by construction because building the
document any other way makes them unsatisfiable later:

  * **Rule 10** - `page.block_ids` is exactly the blocks whose `page_index` is that page, nested
    blocks included. Built by partitioning the block list, never by appending as we go.
  * **Rule 11 / 42** - `page.flows[f]` holds only TOP-LEVEL blocks, and the six flows partition
    them. Nested blocks are excluded at the one place flows are built.
  * **Rule 14** - `order` is dense `0..n-1` within each `(page_index, flow, container)` group.
    Assigned per group at the end, so a dropped block cannot leave a hole.
  * **Rule 15** - `doc_order` is present on **exactly** the top-level `flow == "body"` blocks and
    dense across the whole document. Not "usually body"; issue #49 records that populating it
    anywhere else is an ERROR, so it is written in one loop over the body stream and nowhere else.
  * **Rule 16** - `doc_order` never runs backwards through `(page_index, order)`.
  * **Rule 1** - `bbox` is the extent of `polygon`, always, because `bbox` is COMPUTED from the
    polygon rather than carried alongside it.
  * **Rule 37** - a `pdf_text_layer` block with `text` also carries `text_normalised` and
    `content_hash`. Emitted together in one helper; there is no path that writes one without
    the other.
  * **Rule 41** - `status` and `partial_reason` are derived from a single `DocumentProfile`
    decision, so they cannot disagree.

POLYGONS COME FROM `union_of_line_rects`, AND THE MULTI-POLYGON CASE IS A BUG SIGNAL

ADR-001's second commitment: "a selection crossing a two-column gutter must return TWO
polygons". `Block.polygon` is a SINGLE ring, so a block whose line bands produce more than one
polygon is a block that spans the gutter - which `layout.py` is supposed to make impossible.
That is treated as an internal inconsistency and the block is split by falling back to the
largest ring, with the event counted, rather than silently unioned into a box that paints over
the gutter.

The bands fed in are `Span.line_band` - the typographic band from the baseline and the font's
own ascender/descender - not the raw span bbox. See `pdf.py`'s docstring for why.

IDS ARE CONTENT-DERIVED, WHICH IS WHAT MAKES RE-PARSING A NO-OP

`block_id` comes from `identity.block_id` and hashes only `(source_hash, page_index, x0, y0,
block_type, text-prefix)`. `page_id` is derived the same way from `(source_hash, page_index)` so
that it, too, is stable across re-parses; nothing here mints a random id except `paper_id`, which
is minted ONCE per source document and then carried forward by the caller.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass, field
from statistics import median
from typing import Any

from papertree_document_ir import BBox, Flows, Paper, Polygon, Section, Span
from papertree_document_ir.geometry import polygon_extent, union_of_line_rects
from papertree_document_ir.identity import (
    BlockIdInput,
    block_id,
    content_hash,
    normalise_text,
)

from papertree_document_worker.classify import DocumentProfile
from papertree_document_worker.layout import FlowKind
from papertree_document_worker.metadata import extract_metadata

__all__ = [
    "AssembledBlock",
    "PaperBuilder",
    "page_id_for",
]

IR_VERSION = "1.0.0"
COORDINATE_SPACE = "pdf_user_space_topleft"
PARSER_NAME = "papertree-document-worker"
PARSER_VERSION = "1.0.0"

#: The six flows, in the order `Flows` declares them. All six keys are required; an empty array
#: means "none in that flow" and is legal, unlike an absent key.
FLOW_KINDS: tuple[FlowKind, ...] = ("body", "caption", "footnote", "header", "footer", "margin")

_BASE32 = "abcdefghijklmnopqrstuvwxyz234567"


def _base32(digest: bytes, length: int) -> str:
    """Lowercase RFC-4648 base32, truncated. The alphabet `identity.py` uses, same reason."""
    bits = 0
    value = 0
    out: list[str] = []
    for byte in digest:
        value = (value << 8) | byte
        bits += 8
        while bits >= 5:
            bits -= 5
            out.append(_BASE32[(value >> bits) & 31])
            if len(out) == length:
                return "".join(out)
    if bits:
        out.append(_BASE32[(value << (5 - bits)) & 31])
    return "".join(out)[:length]


def page_id_for(source_hash: str, page_index: int) -> str:
    """A `pg_`-prefixed, CONTENT-DERIVED page id.

    Derived rather than minted so that re-parsing the same PDF yields the same page ids, which
    `worker/determinism.spec` requires and a ULID could not give.
    """
    digest = hashlib.sha256(f"{source_hash}|{page_index}".encode()).digest()
    return "pg_" + _base32(digest, 16)


@dataclass(slots=True)
class AssembledBlock:
    """A block before ids and ordering are assigned - everything the stages produced."""

    type: str
    page_index: int
    flow: FlowKind
    line_bands: list[BBox]
    text: str | None = None
    spans: tuple[Span, ...] = ()
    repairs: tuple[Any, ...] = ()
    source: str = "pdf_text_layer"
    confidence: float = 1.0
    payload: dict[str, Any] | None = None
    stage: str = "layout"
    #: The layout column this block was assigned to, or `None` for a full-width element. Carried
    #: so `continues_in_next_column` can require two GENUINELY DIFFERENT columns rather than
    #: inferring it from non-overlapping x - which fired 463 times on gpt3-longform, a
    #: SINGLE-COLUMN paper, because two same-column fragments need not overlap.
    column: int | None = None
    #: Set for nested blocks (a table cell in its row). Nested blocks get no `doc_order` and do
    #: not appear in `Page.flows` - D14, enforced by rules 15 and 42.
    parent: AssembledBlock | None = None
    #: Filled during assembly.
    block_id: str = ""
    polygon: Polygon = field(default_factory=list)
    bbox: BBox = field(default_factory=list)

    @property
    def is_nested(self) -> bool:
        return self.parent is not None


class PaperBuilder:
    """Collects blocks and emits a validated `Paper`."""

    def __init__(self, *, source_hash: str, paper_id: str, profile: DocumentProfile) -> None:
        #: The BARE 64-hex digest `identity.block_id` demands. The IR stores the `sha256:` form;
        #: passing the prefixed string to `block_id` is rejected rather than hashed, because it
        #: would mint a complete, plausible, WRONG id space.
        self.source_hash = source_hash
        self.paper_id = paper_id
        self.profile = profile
        self.blocks: list[AssembledBlock] = []
        self.relations: list[tuple[str, AssembledBlock, AssembledBlock, float, str]] = []
        self.sections: list[
            tuple[AssembledBlock, int, AssembledBlock | None, list[AssembledBlock]]
        ] = []
        #: Blocks whose line bands produced more than one polygon - i.e. blocks that span a
        #: gutter, which layout is supposed to prevent. Counted, never hidden.
        self.multi_polygon_blocks = 0
        #: Page frames, in page order. Set by the caller before `build`.
        self.frames: list[Any] = []
        # Per-instance, NOT class attributes: a class-level dict is shared by every builder in
        # the process, so two documents parsed in one worker would overwrite each other's order.
        self._order: dict[str, int] = {}
        self._doc_order: dict[str, int] = {}

    def add(self, block: AssembledBlock) -> AssembledBlock:
        self.blocks.append(block)
        return block

    def relate(
        self,
        kind: str,
        source: AssembledBlock,
        target: AssembledBlock,
        confidence: float,
        provenance: str,
    ) -> None:
        self.relations.append((kind, source, target, confidence, provenance))

    # ── geometry ───────────────────────────────────────────────────────────────────────────

    def _geometry(self, block: AssembledBlock) -> tuple[Polygon, BBox]:
        # THE TOLERANCE MUST MATCH THE BANDS, and `union_of_line_rects`'s docstring says why:
        # "Font-metric line boxes (what MuPDF returns) abut or overlap; GLYPH-DERIVED BOXES LEAVE
        # A GAP OF ROUGHLY THE DESCENDER DEPTH." Its 2.0 pt default is tuned for the first kind.
        #
        # `Span.line_band` is the second kind - ascender to descender, ~0.89 x size tall against
        # a ~1.19 x size line pitch, so consecutive lines sit ~3 pt apart on a 9.96 pt body.
        # Taking the default split 478 of ResNet's 485 blocks into multiple polygons, i.e. it
        # reported almost every paragraph as gutter-spanning.
        #
        # Scaled to the block's own text rather than fixed, because a 20 pt title and a 6 pt
        # footnote have different pitches. 0.55 x band height clears the intra-paragraph gap and
        # stays well under the ~10 pt gap that separates one paragraph from the next.
        heights = [b[3] - b[1] for b in block.line_bands if b[3] > b[1]]
        tolerance = 0.55 * median(heights) if heights else 2.0
        rings = (
            union_of_line_rects(block.line_bands, vertical_gap_tolerance=tolerance)
            if block.line_bands
            else []
        )
        if not rings:
            # A block with no usable bands still needs geometry - "unclassifiable regions become
            # unknown WITH GEOMETRY INTACT, never dropped". Fall back to the extent of whatever
            # bands there were; a degenerate box is caught by rule G6 rather than silently kept.
            bands = block.line_bands or [[0.0, 0.0, 1.0, 1.0]]
            box = [
                min(b[0] for b in bands),
                min(b[1] for b in bands),
                max(b[2] for b in bands),
                max(b[3] for b in bands),
            ]
            ring = [
                [box[0], box[1]],
                [box[2], box[1]],
                [box[2], box[3]],
                [box[0], box[3]],
            ]
            return ring, polygon_extent(ring)
        if len(rings) > 1:
            # See the module docstring. A body block that spans the gutter is a layout failure,
            # so the largest ring is kept and the event is counted rather than the rings being
            # merged into a box that paints over the gutter.
            self.multi_polygon_blocks += 1
            rings.sort(key=lambda r: _ring_area(r), reverse=True)
        ring = rings[0]
        return ring, polygon_extent(ring)

    # ── the build ──────────────────────────────────────────────────────────────────────────

    def assign_ids(self) -> None:
        """Compute geometry and `block_id` for every collected block.

        SEPARATE FROM `build` because crops need the id BEFORE the document exists: the URI is
        `asset://<paper>/<gen>/<kind>/<block_id>@3x.webp`, and `payload.image` has to be set
        before `build` validates rule 36. Idempotent, so `build` can call it unconditionally.
        """
        for block in self.blocks:
            block.polygon, block.bbox = self._geometry(block)
            block.block_id = block_id(
                BlockIdInput(
                    source_hash=self.source_hash,
                    page_index=block.page_index,
                    # Rule: the TOP-LEFT ANCHOR only. x1/y1 are deliberately absent from the
                    # formula, which is what lets a block grow downward and keep its id - and is
                    # exactly why a tier-1 hit must be confirmed against content_hash.
                    x0=block.bbox[0],
                    y0=block.bbox[1],
                    block_type=block.type,
                    text=block.text or "",
                )
            )

    def build(self, *, config_hash: str, parsed_at: str, profile_name: str | None = None) -> Paper:
        self.assign_ids()
        by_id = {block.block_id: block for block in self.blocks}
        if len(by_id) != len(self.blocks):
            # Rule 8. Two blocks with identical type, page, anchor and text prefix collide by
            # construction; that is a segmentation bug, not an id bug, and must not be papered
            # over by salting the id.
            raise ValueError(
                f"duplicate block ids: {len(self.blocks)} blocks produced {len(by_id)} ids"
            )

        self._assign_order()
        pages = self._build_pages()
        blocks = [self._emit_block(b) for b in self.blocks]

        status, partial_reason = self._status()
        confidences = [p.confidence for p in self.profile.pages]
        overall = round(sum(confidences) / len(confidences), 4) if confidences else None

        document: dict[str, Any] = {
            "ir_version": IR_VERSION,
            "paper_id": self.paper_id,
            "source_hash": f"sha256:{self.source_hash}",
            "generation": 1,
            "coordinate_space": COORDINATE_SPACE,
            "parser": {
                "name": PARSER_NAME,
                "version": PARSER_VERSION,
                "config_hash": config_hash,
                "parsed_at": parsed_at,
                **({"profile": profile_name} if profile_name else {}),
            },
            "status": status,
            "partial_reason": partial_reason,
            # Every one of the seven keys is required and `authors` must be `[]` rather than
            # null. Values are extracted from the document's OWN blocks and each cites the block
            # it came from verbatim - rule 6b makes anything else an ERROR.
            "metadata": extract_metadata(blocks),
            "pages": pages,
            "blocks": blocks,
            "relations": self._emit_relations(by_id),
            "sections": self._emit_sections(),
            "references": [],
            "confidence": {
                "overall": overall,
                "by_page": [p.confidence for p in self.profile.pages],
                "weakest_pages": [p.index for p in self.profile.pages if p.confidence < 0.7],
                "needs_review": any(p.confidence < 0.7 for p in self.profile.pages),
            },
        }
        return Paper.model_validate(document)

    # ── ordering ───────────────────────────────────────────────────────────────────────────

    def _assign_order(self) -> None:
        """Rules 14, 15 and 16, in one pass each, so they cannot disagree."""
        groups: dict[tuple[int, str, str], list[AssembledBlock]] = defaultdict(list)
        for block in self.blocks:
            container = block.parent.block_id if block.parent else "top"
            groups[(block.page_index, block.flow, container)].append(block)
        for members in groups.values():
            for position, block in enumerate(members):
                self._order[block.block_id] = position

        # Rule 15: doc_order on EXACTLY the top-level body blocks, dense across the document.
        # Rule 16: never running backwards through (page_index, order).
        body = sorted(
            (b for b in self.blocks if b.flow == "body" and not b.is_nested),
            key=lambda b: (b.page_index, self._order[b.block_id]),
        )
        self._doc_order = {block.block_id: index for index, block in enumerate(body)}

    # ── emission ───────────────────────────────────────────────────────────────────────────

    def _emit_block(self, block: AssembledBlock) -> dict[str, Any]:
        out: dict[str, Any] = {
            "block_id": block.block_id,
            "type": block.type,
            "page_index": block.page_index,
            "polygon": block.polygon,
            "bbox": block.bbox,
            "flow": block.flow,
            "order": self._order[block.block_id],
            "source": block.source,
            "confidence": block.confidence,
            "provenance": {"parser": PARSER_NAME, "stage": block.stage},
        }
        if block.block_id in self._doc_order:
            out["doc_order"] = self._doc_order[block.block_id]
        if block.parent is not None:
            out["parent_id"] = block.parent.block_id
        children = [b.block_id for b in self.blocks if b.parent is block]
        if children:
            out["child_ids"] = children
        if block.text is not None:
            out["text"] = block.text
            # Rule 37: both, or neither, and never one. Emitted here so no other path can write
            # `text` without them.
            if block.source == "pdf_text_layer":
                out["text_normalised"] = normalise_text(block.text)
                out["content_hash"] = content_hash(block.text)
        if block.spans:
            out["spans"] = [
                s.model_dump(mode="json", by_alias=True, exclude_unset=True) for s in block.spans
            ]
        if block.repairs:
            out["repairs"] = [
                r.model_dump(mode="json", by_alias=True, exclude_unset=True) for r in block.repairs
            ]
        if block.payload is not None:
            out["payload"] = block.payload
        return out

    def _build_pages(self) -> list[dict[str, Any]]:
        pages: list[dict[str, Any]] = []
        for profile, frame in zip(self.profile.pages, self.frames, strict=True):
            on_page = [b for b in self.blocks if b.page_index == profile.index]
            flows: dict[str, list[str]] = {}
            for kind in FLOW_KINDS:
                # Rule 11 and 42: TOP-LEVEL only, ordered by `order` (rule 12).
                members = [b for b in on_page if b.flow == kind and not b.is_nested]
                members.sort(key=lambda b: self._order[b.block_id])
                flows[kind] = [b.block_id for b in members]
            pages.append(
                {
                    "page_id": page_id_for(self.source_hash, profile.index),
                    "index": profile.index,
                    "width": frame.width,
                    "height": frame.height,
                    "rotation": frame.rotation,
                    "user_unit": frame.user_unit,
                    # D23 / G4: ALWAYS [0, 0, w, h], because block geometry is crop-relative.
                    "crop_box": frame.crop_box,
                    "media_box": frame.media_box,
                    "image": None,
                    "has_text_layer": profile.has_text_layer,
                    "is_scanned": profile.is_scanned,
                    # Rule 10: exactly the blocks on this page, nested included.
                    "block_ids": [b.block_id for b in on_page],
                    "flows": Flows.model_validate(flows).model_dump(mode="json"),
                    "confidence": profile.confidence,
                }
            )
        return pages

    def _emit_relations(self, by_id: dict[str, AssembledBlock]) -> list[dict[str, Any]]:
        seen: set[tuple[str, str, str]] = set()
        out: list[dict[str, Any]] = []
        for kind, source, target, confidence, provenance in self.relations:
            key = (kind, source.block_id, target.block_id)
            if key in seen or source.block_id not in by_id or target.block_id not in by_id:
                continue  # Rules 4 and 9: endpoints resolve, and (type, from, to) is unique.
            seen.add(key)
            out.append(
                {
                    "type": kind,
                    "from": source.block_id,
                    "to": target.block_id,
                    "confidence": confidence,
                    "provenance": provenance,
                }
            )
        return out

    def _emit_sections(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for heading, level, parent, members in self.sections:
            section: dict[str, Any] = {
                "heading_block_id": heading.block_id,
                "level": level,
                # Rule 38: excludes the heading itself, no duplicates, no NESTED blocks.
                "block_ids": [
                    b.block_id
                    for b in members
                    if b.block_id != heading.block_id and not b.is_nested
                ],
            }
            if parent is not None:
                section["parent_heading_block_id"] = parent.block_id
            out.append(Section.model_validate(section).model_dump(mode="json", exclude_unset=True))
        return out

    def _status(self) -> tuple[str, str | None]:
        """Rule 41, decided once so `status` and `partial_reason` cannot contradict."""
        reason = self.profile.partial_reason
        if reason is not None:
            return "partial", reason
        if not self.blocks:
            # Residual risk 10: `complete` with zero blocks is legal but is also the shape of a
            # total extraction failure, so it is reported as partial rather than claimed clean.
            return "partial", "no blocks were extracted from this document"
        return "complete", None


def _ring_area(ring: Polygon) -> float:
    total = 0.0
    for index in range(len(ring)):
        x0, y0 = ring[index]
        x1, y1 = ring[(index + 1) % len(ring)]
        total += x0 * y1 - x1 * y0
    return abs(total) / 2


def config_hash_for(settings: dict[str, Any]) -> str:
    """A digest over every knob that changes the output.

    `ParserInfo.config_hash` is what makes "re-parsing is a no-op" CHECKABLE: two runs that agree
    on this hash and disagree on their output are a determinism bug, and two runs that disagree
    on it are not comparable at all.
    """
    payload = json.dumps(settings, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()
