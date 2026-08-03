"""The indexed view a selector is derived from — the Python twin of ``src/document.ts``.

ONLY THE CAPTURE HALF IS PORTED. ``document.ts`` also builds the indices the T0-T6 ladder queries
(``byContentHash``, the normalised stream, the binary search from a stream offset back to a block).
None of that is here: #78 §6 says derive the selectors, do NOT port the resolver, and an index whose
only caller would be a resolver that must not exist is a second contract with no first user.

THE TEXT STREAM ORDER IS THE WHOLE CONTRACT, and it is copied from ``document.ts:236-260`` rather
than re-derived, because a TextPositionSelector minted against a different order is silently wrong:

  1. pages in index order;
  2. within a page, ``Page.flows`` in FLOW_ORDER, each flow in its listed order;
  3. immediately after each block, its descendants — nested blocks carry their parent's flow but are
     deliberately absent from the flow list (D14 / rule 42), and a table cell belongs next to its
     row, not at the end of the document;
  4. anything still unreached, appended per page in ``(y0, x0)`` order, so a block no flow lists is
     included rather than silently dropped.

Blocks are joined by a single U+000A. ``doc_order`` is NOT the order: it exists only on top-level
``flow == "body"`` blocks (AGENTS.md §4, validator rule 15), so sorting by it collapses every
caption, footnote and table cell to position 0.

WHY THIS DOES NOT CALL ``papertree_api.ir._flows_for_page``, which #78 §6 recommends. That function
rebuilds ``Page.flows`` from DATABASE ROWS that do not carry it. This module is handed a ``Paper``,
which carries ``Page.flows`` already — required, all six keys, ascending ``Block.order``. There is
nothing to rebuild, so importing it would buy nothing and would drag in ``fastapi`` and the whole
document-worker: ``papertree_api/__init__.py:8`` imports ``.app``, so any importer of
``papertree_api.ir`` imports the service. A DB-backed caller reaches this module the way #78 intends
— rows → ``papertree_api.ir`` → ``Paper`` → here — with the dependency pointing the safe way.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from papertree_document_ir import Block, Page, Paper, Section, resolved_text

#: The order flows are concatenated in. ``document.ts:170``, copied deliberately: ``header`` is
#: empty on all 10 fixture pages, so its position is a choice there and is the same choice here.
FLOW_ORDER: tuple[str, ...] = ("body", "caption", "footnote", "header", "footer", "margin")

BLOCK_SEPARATOR = "\n"


@dataclass(frozen=True, slots=True)
class IndexedBlock:
    """One block, placed in the document-global text stream."""

    block: Block
    #: ``resolved_text(block).text`` — the sanctioned reading (D4), never ``Block.text`` directly.
    text: str
    #: Position in the reading order this module ASSIGNED, not ``Block.doc_order``.
    reading_index: int
    #: Half-open range in the document-global code-point stream.
    stream_start: int
    stream_end: int


@dataclass(frozen=True, slots=True)
class IndexedDocument:
    paper_id: str
    source_hash: str
    parser_version: str
    #: WHICH extraction produced the offsets. A caller obligation, not a default: two runs of one
    #: library can differ, and an anchor resolved against the other extraction is wrong at T2.
    text_stream_id: str
    pages: tuple[Page, ...]
    blocks: tuple[IndexedBlock, ...]
    by_id: dict[str, IndexedBlock]
    sections: tuple[Section, ...]
    #: The raw, un-normalised stream. A Python ``str`` indexes code points, which is the unit
    #: ``Anchor.offsetUnit`` declares, so this needs no separate code-point array.
    stream: str

    def page(self, index: int) -> Page | None:
        for page in self.pages:
            if page.index == index:
                return page
        return None

    def section_containing(self, block_id: str) -> Section | None:
        for section in self.sections:
            if block_id in section.block_ids or section.heading_block_id == block_id:
                return section
        return None


def _sort_key(block: Block) -> tuple[float, float, str]:
    return (block.bbox[1], block.bbox[0], block.block_id)


def reading_order(paper: Paper) -> list[Block]:
    """Every block, in reading order — including the ones ``doc_order`` cannot order."""
    by_id = {block.block_id: block for block in paper.blocks}
    children: dict[str, list[Block]] = defaultdict(list)
    for block in paper.blocks:
        if block.parent_id is not None:
            children[block.parent_id].append(block)
    for bucket in children.values():
        bucket.sort(key=_sort_key)

    out: list[Block] = []
    seen: set[str] = set()

    def emit(block: Block) -> None:
        if block.block_id in seen:
            return
        seen.add(block.block_id)
        out.append(block)
        for child in children.get(block.block_id, ()):
            emit(child)

    for page in sorted(paper.pages, key=lambda p: p.index):
        for flow in FLOW_ORDER:
            for block_id in getattr(page.flows, flow):
                listed = by_id.get(block_id)
                if listed is not None:
                    emit(listed)
        stragglers = sorted(
            (b for b in paper.blocks if b.page_index == page.index and b.block_id not in seen),
            key=_sort_key,
        )
        for block in stragglers:
            emit(block)

    # A block whose ``page_index`` names no page. Impossible in a schema-valid document (rule G4),
    # but dropping it would be a silent loss of text, so it goes last rather than nowhere.
    for block in paper.blocks:
        emit(block)
    return out


def index_document(paper: Paper, text_stream_id: str) -> IndexedDocument:
    """Build the stream and the per-block offsets a selector is minted from."""
    blocks: list[IndexedBlock] = []
    parts: list[str] = []
    cursor = 0
    for reading_index, source in enumerate(reading_order(paper)):
        text = resolved_text(source).text
        blocks.append(
            IndexedBlock(
                block=source,
                text=text,
                reading_index=reading_index,
                stream_start=cursor,
                stream_end=cursor + len(text),
            )
        )
        parts.append(text)
        parts.append(BLOCK_SEPARATOR)
        cursor += len(text) + 1

    return IndexedDocument(
        paper_id=paper.paper_id,
        source_hash=paper.source_hash,
        parser_version=paper.parser.version,
        text_stream_id=text_stream_id,
        pages=tuple(paper.pages),
        blocks=tuple(blocks),
        by_id={indexed.block.block_id: indexed for indexed in blocks},
        sections=tuple(paper.sections or ()),
        stream="".join(parts),
    )
