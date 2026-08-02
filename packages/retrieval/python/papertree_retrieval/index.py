"""``PaperIndex`` — one paper generation, loaded once, in the shape retrieval actually needs.

WHY THIS EXISTS AT ALL, WHEN ``papertree_db`` ALREADY HAS READ METHODS

The expansion ladder in ``expansion.py`` touches the same paper six times per query (selection,
parents, section, neighbours, relations, citations) and every one of those touches needs a
different index over the SAME rows: by id, by (page, flow, order), by parent, by relation
endpoint, by section membership. Issuing six SQL round trips per rung, per selected block, would
be both slower and — the part that matters more here — NON-DETERMINISTIC in ordering unless every
one of those queries carried its own total ORDER BY. Loading once and indexing once means the
ordering rules are written down in exactly one place, which is what makes
``retrieval/expansion.spec``'s byte-identity assertion something the code guarantees rather than
something the tests happen to observe.

The cost was measured rather than assumed. On the two largest corpus papers, parsed by
`services/document-worker` at generation 1 (2026-08-02, this machine):

    resnet-cvpr-2col.pdf     12 pages   974 blocks   58,324 chars of text   25 relations
    neural-odes-mathheavy    18 pages   626 blocks   54,382 chars of text   18 relations

so a whole paper is ~60 KB of text plus ~1,000 small frozen dataclasses. Holding that for the
duration of one question is not a memory decision worth agonising over; holding a *connection*
open across the six rungs and hoping each query sorted stably would have been.

── THE FOUR PaperIR TRAPS THIS MODULE EXISTS TO ABSORB ─────────────────────────────────────────

1. ``doc_order`` IS ABSENT ON MOST BLOCKS, AND ``doc_order or 0`` IS A DATA-DESTROYING SORT.
   AGENTS.md names it; the numbers above make it concrete. On resnet exactly 207 of 974 blocks
   carry ``doc_order`` — it is present on precisely the TOP-LEVEL blocks whose flow is ``body``.
   The other 767 are captions, footnotes, furniture and 755 nested table cells/rows, and
   ``sorted(blocks, key=lambda b: b["doc_order"] or 0)`` collapses all of them onto position 0.
   So this module never sorts by ``doc_order``. Reading order is rebuilt the way the IR defines
   it: per page, per flow, top-level blocks by ``"order"``, each followed by a depth-first walk
   of its children. ``doc_order`` is retained on ``IndexedBlock`` because it is a fact about the
   block, and is used for nothing but reporting.

2. ``prev_id`` AND ``next_id`` ARE NEVER POPULATED BY THE PARSER THAT EXISTS. Measured, not
   guessed: 0 of 974 blocks on resnet and 0 of 626 on neural-odes carry either. They are optional
   in the schema and Epic 1 does not emit them. A retrieval ladder whose "adjacent reading-order"
   rung reads ``prev_id``/``next_id`` would therefore return nothing at all on every real paper in
   the corpus, pass a unit test built from a hand-written fixture, and be dead code in production
   — this repo's single most-repeated defect (findings.md §A: 1,698 lines with zero importers).
   Adjacency here is derived from the per-page flow ordering, and ``prev_id``/``next_id`` are
   honoured as an OVERRIDE when a future parser starts emitting them. Both paths are exercised.

3. ``Section`` HAS NO TITLE AND FRONT MATTER HAS NO SECTION. ``Section`` is
   ``{heading_block_id, level, parent_heading_block_id?, block_ids}``; the display title is
   ``blocks[heading_block_id].text``, and ``block_ids`` excludes both the heading itself and the
   contents of nested sections. Title, authors, affiliation and abstract are deliberately
   section-less, so ``section_of`` returning ``None`` is a NORMAL ANSWER and not an error — on
   resnet 12 of 974 blocks are front matter and every one of them answers ``None``.

4. ``Block.text`` KEEPS THE UNREPAIRED READING PERMANENTLY (deviation D4). The only sanctioned
   reader is ``papertree_document_ir.resolved_text``, which takes an OBJECT with ``.text`` and
   ``.repairs``, not a row dict. ``_RowBlock``/``_RowRepair`` below are that adapter and they are
   the only place this package looks at ``text`` or ``repairs``. Nothing here concatenates text
   and repairs by hand. ``apply_proposed=False`` is passed deliberately: an evidence package is
   quoted back to a reader as what the paper says, and a model-proposed OCR correction is not
   that. The count of unaccepted proposals rides along on ``IndexedBlock.proposed_repairs`` so
   the evidence package can say "this quotation has 3 unaccepted repair proposals" instead of
   silently quoting text somebody has already flagged as wrong.

── OWNERSHIP ───────────────────────────────────────────────────────────────────────────────────

``PaperIndex`` holds the ``PaperTreeDb`` and the ``OwnerId`` it was loaded with, for exactly one
reason: the semantic rung calls ``search_block_vectors`` at query time and that call needs both.
The handle is per-connection and unforgeable (see ``papertree_db.database``'s gate 3), so an index
built for one owner cannot be made to read another's vectors. There is no ``._conn`` access here
and there must never be: ``packages/db/python/tests/test_ownership.py`` AST-audits for it and
allows three modules, none of them this one.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final, Protocol, final

from papertree_db import Generation, OwnerId, PaperId, PaperTreeDb, Row
from papertree_document_ir import is_known_heading_block_type
from papertree_document_ir.identity import resolved_text

__all__ = [
    "FLOW_READING_ORDER",
    "IndexedBlock",
    "IndexedReference",
    "IndexedRelation",
    "IndexedSection",
    "PaperIndex",
    "PaperReader",
]

#: ``Block.flow`` is a CLOSED vocabulary of exactly six values (the schema's CHECK constraint
#: repeats them). This is the order a reader meets them on a page, and it is NOT the alphabetical
#: order that ``list_blocks_on_page``'s ``ORDER BY flow, "order"`` produces — that would read the
#: captions before the footer and the footnotes before the header. Declared here so the reading
#: order has one definition rather than one per call site.
FLOW_READING_ORDER: Final[tuple[str, ...]] = (
    "header",
    "body",
    "caption",
    "footnote",
    "margin",
    "footer",
)

#: Depth cap on the parent chain walk. The IR permits arbitrary nesting and a cycle in
#: ``parent_id`` is representable (nothing in the schema forbids one); the deepest chain measured
#: on the corpus is 3 — table -> table_row -> table_cell. 32 is far above anything real and turns
#: a malformed document into a bounded walk instead of a hang.
MAX_PARENT_DEPTH: Final = 32


@dataclass(frozen=True, slots=True)
class IndexedBlock:
    """One block, with the JSON columns already decoded and the text already resolved.

    Deliberately NOT the whole row. ``spans``, ``polygon``, ``content_hash``, ``alternatives`` and
    ``provenance`` are omitted because no rung of the ladder and no component of the evidence
    package reads them, and carrying a field nobody reads is how a "small" index turns into a
    second copy of the schema that drifts from the first. ``bbox`` is kept because the optional
    region-crop rung needs it and it is four floats.
    """

    block_id: str
    page_index: int
    type: str
    flow: str
    #: Rank WITHIN (page_index, flow) for a top-level block, or within the parent for a nested
    #: one. The schema's quoted ``"order"`` column; never globally unique.
    order: int
    #: Present on EXACTLY the top-level blocks whose flow is ``body`` — see trap 1 in the module
    #: docstring. Reported, never sorted on.
    doc_order: int | None
    parent_id: str | None
    child_ids: tuple[str, ...]
    prev_id: str | None
    next_id: str | None
    #: ``resolved_text(block, apply_proposed=False).text`` — the paper's own reading.
    text: str
    #: How many ``applied=false`` repairs sit on this block and are NOT reflected in ``text``.
    proposed_repairs: int
    bbox: tuple[float, float, float, float]
    confidence: float


@dataclass(frozen=True, slots=True)
class IndexedRelation:
    """One edge. ``type`` is an OPEN vocabulary — see ``expansion.py``'s unknown-type rule."""

    type: str
    from_block: str
    to_block: str
    confidence: float
    provenance: str


@dataclass(frozen=True, slots=True)
class IndexedSection:
    """One entry of ``paper.sections``. There is no title field — see trap 3."""

    heading_block_id: str
    level: int
    parent_heading_block_id: str | None
    #: Excludes the heading itself and excludes the contents of nested sections.
    block_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class IndexedReference:
    """One bibliography entry, reduced to what the citation rung needs.

    ``Reference`` carries title/authors/year/venue/doi/arxiv_id/url and deliberately does NOT
    carry the verbatim entry text or a citation label — semantic rule 35 keeps the verbatim entry
    in exactly one place, the ``reference_entry`` block. So the label a reader sees in the prose
    (``[41]``) is recovered from that block's text, not from here.
    """

    reference_entry_block_id: str
    year: int | None
    #: The bracketed numeric label this entry is printed under, when the entry's block text starts
    #: a line with one. ``None`` for author-year bibliographies (measured: bert-2col has 29
    #: reference entries and not one bracketed label).
    label: str | None


@dataclass(frozen=True, slots=True)
class _RowRepair:
    """Adapter satisfying ``papertree_document_ir.identity.RepairLike`` over a decoded JSON dict.

    The JSON key is ``"from"`` (the model spells the field ``from_`` only because ``from`` is a
    Python keyword, and the row was written from ``model_dump(by_alias=True)``).
    """

    kind: str
    applied: bool
    at: int | None
    from_: str
    to: str


@dataclass(frozen=True, slots=True)
class _RowBlock:
    """Adapter satisfying ``papertree_document_ir.identity.BlockLike`` over a row dict."""

    text: str | None
    repairs: Sequence[_RowRepair] | None


def _decode_repairs(raw: object) -> tuple[_RowRepair, ...]:
    if not isinstance(raw, str) or not raw:
        return ()
    decoded = json.loads(raw)
    if not isinstance(decoded, list):
        return ()
    out: list[_RowRepair] = []
    for entry in decoded:
        if not isinstance(entry, dict):
            continue
        at = entry.get("at")
        out.append(
            _RowRepair(
                kind=str(entry.get("kind", "")),
                applied=bool(entry.get("applied", False)),
                at=int(at) if isinstance(at, int) else None,
                from_=str(entry.get("from", "")),
                to=str(entry.get("to", "")),
            )
        )
    return tuple(out)


def _decode_child_ids(raw: object) -> tuple[str, ...]:
    if not isinstance(raw, str) or not raw:
        return ()
    decoded = json.loads(raw)
    if not isinstance(decoded, list):
        return ()
    return tuple(str(item) for item in decoded)


def _to_indexed_block(row: Row) -> IndexedBlock:
    repairs = _decode_repairs(row.get("repairs"))
    resolved = resolved_text(_RowBlock(text=row.get("text"), repairs=repairs), apply_proposed=False)
    doc_order = row.get("doc_order")
    return IndexedBlock(
        block_id=str(row["block_id"]),
        page_index=int(row["page_index"]),
        type=str(row["type"]),
        flow=str(row["flow"]),
        order=int(row["order"]),
        doc_order=int(doc_order) if isinstance(doc_order, int) else None,
        parent_id=_opt_str(row.get("parent_id")),
        child_ids=_decode_child_ids(row.get("child_ids")),
        prev_id=_opt_str(row.get("prev_id")),
        next_id=_opt_str(row.get("next_id")),
        text=resolved.text,
        proposed_repairs=sum(1 for repair in repairs if not repair.applied),
        bbox=(
            float(row["bbox_x0"]),
            float(row["bbox_y0"]),
            float(row["bbox_x1"]),
            float(row["bbox_y1"]),
        ),
        confidence=float(row["confidence"]),
    )


def _opt_str(value: object) -> str | None:
    return None if value is None else str(value)


def _reference_label(entry_text: str) -> str | None:
    """The bracketed label a numeric bibliography prints an entry under, or ``None``.

    Matched at the start of the block text OR at the start of any line within it, because Epic 1's
    reference segmentation does not put one entry per block: on resnet the third entry's ``[3]``
    marker is measurably in the MIDDLE of the block that also holds the tail of entry 2. Accepting
    a mid-line ``[3]`` would additionally match every ``[3]`` inside an arXiv identifier or a page
    range, so line-start is the constraint that keeps this a label matcher rather than a substring
    search.
    """
    for line in entry_text.split("\n"):
        stripped = line.lstrip()
        if not stripped.startswith("["):
            continue
        close = stripped.find("]")
        if close <= 1:
            continue
        inner = stripped[1:close]
        if inner.isdigit():
            return inner
    return None


class PaperReader(Protocol):
    """The six read methods ``PaperIndex`` needs, WITHOUT an owner argument.

    WHY THIS PROTOCOL EXISTS, AND WHY IT IS NOT AN ABSTRACTION FOR ITS OWN SAKE

    There are exactly two things in this repository that can serve a paper generation, and they
    are deliberately not the same kind of object:

      * ``papertree_db.PaperTreeDb`` — read-WRITE, every method takes an ``OwnerId`` first.
      * ``papertree_memory.AgentDataHandle`` — read-ONLY (``mode=ro`` plus an authorizer denying
        ``SQLITE_ATTACH``), bound to one owner at construction, so its methods take no owner at all.

    The second one is the ONLY object an agent tool may hold — that is the whole of F3.8. Before
    this protocol existed, ``PaperIndex`` stored a ``PaperTreeDb`` and an ``OwnerId`` directly, so
    the agent side had to reach it by ``cast(PaperTreeDb, _Facade(handle))`` plus a minted
    ``OwnerId`` no connection had recorded, plus three private imports from this module. That
    works, and it is three lies to the type checker in a package whose entire job is to be
    trustworthy about what the agent can touch.

    Owner-LESS is the load-bearing choice. An owner argument here would mean the agent side had to
    supply one, and the only ``OwnerId`` it could supply is a forged one — which is exactly the
    value ``papertree_db``'s gate 3 exists to reject. Binding the owner into the reader, once, at
    construction, is what makes "this index can only see one owner's paper" a fact about the object
    rather than about every call site.
    """

    def get_paper(self, paper_id: PaperId, generation: Generation) -> Row | None: ...
    def list_pages(self, paper_id: PaperId, generation: Generation) -> list[Row]: ...
    def list_blocks_on_page(
        self, paper_id: PaperId, generation: Generation, page_index: int
    ) -> list[Row]: ...
    def list_relations(self, paper_id: PaperId, generation: Generation) -> list[Row]: ...
    def count_block_vectors(self, paper_id: PaperId, generation: Generation) -> int: ...
    def search_block_vectors(
        self, paper_id: PaperId, generation: Generation, query: Sequence[float], k: int
    ) -> list[Row]: ...


@final
class _OwnerBoundDb:
    """Binds an ``OwnerId`` to a ``PaperTreeDb`` so it satisfies :class:`PaperReader`.

    This is the adapter for the read-WRITE side. It narrows rather than widens: nothing here can
    reach a write method, because nothing here forwards one. ``PaperIndex.load`` builds one of
    these and then follows exactly the same code path the agent handle does, which is what stops
    the two paths drifting.
    """

    __slots__ = ("_db", "_owner")

    def __init__(self, db: PaperTreeDb, owner: OwnerId) -> None:
        self._db = db
        self._owner = owner

    def get_paper(self, paper_id: PaperId, generation: Generation) -> Row | None:
        return self._db.get_paper(self._owner, paper_id, generation)

    def list_pages(self, paper_id: PaperId, generation: Generation) -> list[Row]:
        return self._db.list_pages(self._owner, paper_id, generation)

    def list_blocks_on_page(
        self, paper_id: PaperId, generation: Generation, page_index: int
    ) -> list[Row]:
        return self._db.list_blocks_on_page(self._owner, paper_id, generation, page_index)

    def list_relations(self, paper_id: PaperId, generation: Generation) -> list[Row]:
        return self._db.list_relations(self._owner, paper_id, generation)

    def count_block_vectors(self, paper_id: PaperId, generation: Generation) -> int:
        return self._db.count_block_vectors(self._owner, paper_id, generation)

    def search_block_vectors(
        self, paper_id: PaperId, generation: Generation, query: Sequence[float], k: int
    ) -> list[Row]:
        return self._db.search_block_vectors(self._owner, paper_id, generation, query, k)


class PaperIndex:
    """One paper generation, indexed for the expansion ladder. Read-only; build with ``load``."""

    __slots__ = (
        "_blocks",
        "_rank",
        "_reader",
        "_reading_order",
        "_references",
        "_relations_from",
        "_relations_to",
        "_section_of",
        "_sections",
        "_top_level_by_flow",
        "generation",
        "paper_id",
        "vector_count",
    )

    def __init__(
        self,
        *,
        reader: PaperReader,
        paper_id: PaperId,
        generation: Generation,
        blocks: Sequence[IndexedBlock],
        relations: Sequence[IndexedRelation],
        sections: Sequence[IndexedSection],
        references: Sequence[IndexedReference],
        vector_count: int,
    ) -> None:
        self._reader = reader
        self.paper_id = paper_id
        self.generation = generation
        self.vector_count = vector_count

        self._blocks: dict[str, IndexedBlock] = {block.block_id: block for block in blocks}
        self._sections: tuple[IndexedSection, ...] = tuple(sections)
        self._references: tuple[IndexedReference, ...] = tuple(references)

        # Per-(page, flow) TOP-LEVEL blocks, in `"order"`. This is `Page.flows` reconstructed —
        # the schema does not store it (trap 1) — and it is the substrate for both the reading
        # order and the adjacency rung.
        by_flow: dict[tuple[int, str], list[IndexedBlock]] = {}
        for block in self._blocks.values():
            if not self._is_top_level(block):
                continue
            by_flow.setdefault((block.page_index, block.flow), []).append(block)
        for bucket in by_flow.values():
            bucket.sort(key=lambda b: (b.order, b.block_id))
        self._top_level_by_flow: dict[tuple[int, str], tuple[str, ...]] = {
            key: tuple(b.block_id for b in bucket) for key, bucket in by_flow.items()
        }

        self._reading_order: tuple[str, ...] = self._build_reading_order()
        self._rank: dict[str, int] = {
            block_id: position for position, block_id in enumerate(self._reading_order)
        }

        self._relations_from: dict[str, list[IndexedRelation]] = {}
        self._relations_to: dict[str, list[IndexedRelation]] = {}
        for relation in sorted(
            relations, key=lambda r: (r.type, r.from_block, r.to_block, r.provenance)
        ):
            self._relations_from.setdefault(relation.from_block, []).append(relation)
            self._relations_to.setdefault(relation.to_block, []).append(relation)

        self._section_of: dict[str, int] = {}
        for position, section in enumerate(self._sections):
            self._section_of.setdefault(section.heading_block_id, position)
            for block_id in section.block_ids:
                self._section_of.setdefault(block_id, position)

    # ── construction ─────────────────────────────────────────────────────────────────────

    @classmethod
    def load(
        cls, db: PaperTreeDb, owner: OwnerId, paper_id: PaperId, generation: Generation
    ) -> PaperIndex:
        """Reads one paper generation through the public ``papertree_db`` surface only.

        The read-WRITE entry point, for ingest and for tests. The agent side uses
        :meth:`from_reader` with a ``papertree_memory.AgentDataHandle`` instead — it cannot use
        this one, because it has no ``OwnerId`` and forging one is precisely what
        ``papertree_db``'s gate 3 rejects.

        Both paths converge on :meth:`from_reader` one line below, deliberately: two loaders would
        be two chances for the read-only path to drift into reading something the read-write path
        does not, and that drift is invisible until it is a security bug.
        """
        return cls.from_reader(_OwnerBoundDb(db, owner), paper_id, generation)

    @classmethod
    def from_reader(
        cls, reader: PaperReader, paper_id: PaperId, generation: Generation
    ) -> PaperIndex:
        """Reads one paper generation from any owner-bound :class:`PaperReader`.

        This is what an agent tool calls, passing the read-only ``AgentDataHandle``. Nothing in
        here can write, because :class:`PaperReader` has no write method to call — the guarantee is
        the protocol's shape rather than a promise about behaviour.

        Raises ``KeyError`` when the paper generation does not exist. Returning an empty index
        instead would let a typo'd ``paper_id`` produce a retrieval that quietly finds nothing —
        indistinguishable, at the call site, from a paper with nothing to find.
        """
        paper = reader.get_paper(paper_id, generation)
        if paper is None:
            raise KeyError(f"no paper {paper_id} at generation {generation} for this owner")

        blocks: list[IndexedBlock] = []
        for page in reader.list_pages(paper_id, generation):
            for row in reader.list_blocks_on_page(paper_id, generation, int(page["page_index"])):
                blocks.append(_to_indexed_block(row))

        relations = [
            IndexedRelation(
                type=str(row["type"]),
                from_block=str(row["from_block"]),
                to_block=str(row["to_block"]),
                confidence=float(row["confidence"]),
                provenance=str(row["provenance"]),
            )
            for row in reader.list_relations(paper_id, generation)
        ]

        sections = [
            IndexedSection(
                heading_block_id=str(entry["heading_block_id"]),
                level=int(entry["level"]),
                parent_heading_block_id=_opt_str(entry.get("parent_heading_block_id")),
                block_ids=tuple(str(b) for b in entry.get("block_ids", ())),
            )
            for entry in _decode_json_list(paper.get("sections"))
        ]

        by_id = {block.block_id: block for block in blocks}
        references: list[IndexedReference] = []
        for entry in _decode_json_list(paper.get("references_json")):
            entry_block_id = str(entry["reference_entry_block_id"])
            entry_block = by_id.get(entry_block_id)
            year = entry.get("year")
            references.append(
                IndexedReference(
                    reference_entry_block_id=entry_block_id,
                    year=int(year) if isinstance(year, int) else None,
                    label=_reference_label(entry_block.text) if entry_block is not None else None,
                )
            )

        return cls(
            reader=reader,
            paper_id=paper_id,
            generation=generation,
            blocks=blocks,
            relations=relations,
            sections=sections,
            references=references,
            vector_count=reader.count_block_vectors(paper_id, generation),
        )

    # ── blocks and reading order ─────────────────────────────────────────────────────────

    def block(self, block_id: str) -> IndexedBlock | None:
        return self._blocks.get(block_id)

    def __contains__(self, block_id: object) -> bool:
        return isinstance(block_id, str) and block_id in self._blocks

    def __len__(self) -> int:
        return len(self._blocks)

    @property
    def reading_order(self) -> tuple[str, ...]:
        """Every block id, once, in the order a continuous reader meets it.

        Built per page, per flow in :data:`FLOW_READING_ORDER`, top-level blocks by ``"order"``,
        each immediately followed by a depth-first walk of its children. NOT built from
        ``doc_order`` — see trap 1.
        """
        return self._reading_order

    def rank(self, block_id: str) -> int:
        """Position in :attr:`reading_order`. The tiebreaker every ladder rung sorts by.

        A block the index has never heard of ranks after every block it has, so an id that
        survives from a stale generation sorts last instead of raising in the middle of a sort.
        """
        return self._rank.get(block_id, len(self._rank))

    def is_top_level(self, block_id: str) -> bool:
        block = self._blocks.get(block_id)
        return block is not None and self._is_top_level(block)

    def _is_top_level(self, block: IndexedBlock) -> bool:
        """A block is TOP-LEVEL when it has no parent, or its parent is a heading/title.

        The distinction is the IR's, not this package's: ``parent_id`` naming a heading means
        SECTION CONTAINMENT (the child keeps ``doc_order`` and appears in ``Page.flows``);
        ``parent_id`` naming anything else means NESTING (a table cell, a list item). Stated as
        the complement of a two-value list so an UNKNOWN parent type nests by default — splicing
        the children of an unrecognised container into the body stream is the damaging direction.

        A dangling ``parent_id`` counts as top-level rather than being dropped: losing a block
        because its parent is missing would delete content from the reading order silently.
        """
        if block.parent_id is None:
            return True
        parent = self._blocks.get(block.parent_id)
        if parent is None:
            return True
        return is_known_heading_block_type(parent.type)

    def _build_reading_order(self) -> tuple[str, ...]:
        pages = sorted({block.page_index for block in self._blocks.values()})
        order: list[str] = []
        seen: set[str] = set()
        for page_index in pages:
            for flow in FLOW_READING_ORDER:
                for block_id in self._top_level_by_flow.get((page_index, flow), ()):
                    self._descend(block_id, order, seen, depth=0)
            # A flow value outside the closed six cannot reach the database (the CHECK constraint
            # forbids it), but a block whose (page, flow) bucket was never visited would vanish
            # from the reading order entirely, so the sweep below is the belt to that braces.
            for key in sorted(self._top_level_by_flow):
                if key[0] != page_index or key[1] in FLOW_READING_ORDER:
                    continue
                for block_id in self._top_level_by_flow[key]:
                    self._descend(block_id, order, seen, depth=0)
        for block_id in sorted(self._blocks):
            if block_id not in seen:
                order.append(block_id)
                seen.add(block_id)
        return tuple(order)

    def _descend(self, block_id: str, order: list[str], seen: set[str], depth: int) -> None:
        if block_id in seen or depth > MAX_PARENT_DEPTH:
            return
        order.append(block_id)
        seen.add(block_id)
        for child_id in self.children(block_id):
            self._descend(child_id, order, seen, depth + 1)

    def children(self, block_id: str) -> tuple[str, ...]:
        """Child ids in ``"order"``: from ``child_ids`` when present, from ``parent_id`` when not.

        Both directions are read because the schema stores both and they are not required to
        agree. ``child_ids`` is authoritative for MEMBERSHIP and the children's own ``order`` is
        authoritative for SEQUENCE, so a ``child_ids`` array in a different order than the blocks
        it names does not produce a different reading order on two runs.
        """
        block = self._blocks.get(block_id)
        if block is None:
            return ()
        named = [child for child in block.child_ids if child in self._blocks]
        for candidate in self._blocks.values():
            if candidate.parent_id == block_id and candidate.block_id not in named:
                named.append(candidate.block_id)
        return tuple(
            sorted(named, key=lambda cid: (self._blocks[cid].order, cid)),
        )

    def parents(self, block_id: str, depth: int) -> tuple[str, ...]:
        """The ``parent_id`` chain, nearest first, at most ``depth`` long and cycle-safe."""
        out: list[str] = []
        seen = {block_id}
        current = self._blocks.get(block_id)
        while current is not None and len(out) < depth and len(out) < MAX_PARENT_DEPTH:
            parent_id = current.parent_id
            if parent_id is None or parent_id in seen or parent_id not in self._blocks:
                break
            out.append(parent_id)
            seen.add(parent_id)
            current = self._blocks[parent_id]
        return tuple(out)

    def top_level_ancestor(self, block_id: str) -> str:
        """The nearest ancestor that is top-level, or ``block_id`` itself when it already is."""
        current = block_id
        for _ in range(MAX_PARENT_DEPTH):
            block = self._blocks.get(current)
            if block is None or self._is_top_level(block):
                return current
            parent_id = block.parent_id
            if parent_id is None or parent_id not in self._blocks:
                return current
            current = parent_id
        return current

    # ── adjacency ────────────────────────────────────────────────────────────────────────

    def adjacent(self, block_id: str, radius: int) -> tuple[tuple[str, ...], tuple[str, ...]]:
        """``(before, after)`` in reading order, nearest first, at most ``radius`` each.

        THREE sources, in this order, and the order is the design:

          1. ``prev_id``/``next_id`` when the parser set them. It never does today (0 of 974 on
             resnet, 0 of 626 on neural-odes — see trap 2), so this branch is currently the
             unreachable one; it is first because when a parser DOES emit them they are an
             explicit statement and beat anything derived.
          2. The per-(page, flow) top-level sequence, which is what actually fires. For a NESTED
             block the sequence is its siblings under the same parent instead — a table cell's
             neighbour is the next cell, not the paragraph after the table.
          3. Page boundaries. When a top-level ``body`` block is the first or last of its page,
             the walk continues into the adjacent page's ``body`` flow. Without this, every
             question about the first paragraph on a page gets half the context it should, on
             every page, silently.

        ``continues_on_next_page`` / ``continues_in_next_column`` relations are NOT consulted
        here: they are relation edges and ``expansion.py``'s relation rung follows them, which
        keeps "why was this block retrieved" a single answer per block.
        """
        block = self._blocks.get(block_id)
        if block is None:
            return ((), ())
        sequence = self._sequence_containing(block)
        try:
            position = sequence.index(block_id)
        except ValueError:  # pragma: no cover - a block is always in its own sequence
            return ((), ())

        before = list(reversed(sequence[max(0, position - radius) : position]))
        after = list(sequence[position + 1 : position + 1 + radius])

        if block.prev_id is not None and block.prev_id in self._blocks:
            before = [block.prev_id] + [b for b in before if b != block.prev_id]
        if block.next_id is not None and block.next_id in self._blocks:
            after = [block.next_id] + [b for b in after if b != block.next_id]

        if self._is_top_level(block) and block.flow == "body":
            before += self._spill(block.page_index, radius - len(before), backwards=True)
            after += self._spill(block.page_index, radius - len(after), backwards=False)

        return (tuple(before[:radius]), tuple(after[:radius]))

    def _sequence_containing(self, block: IndexedBlock) -> tuple[str, ...]:
        if self._is_top_level(block):
            return self._top_level_by_flow.get((block.page_index, block.flow), (block.block_id,))
        parent_id = block.parent_id
        if parent_id is None:  # pragma: no cover - _is_top_level already covered this
            return (block.block_id,)
        return self.children(parent_id) or (block.block_id,)

    def _spill(self, page_index: int, wanted: int, *, backwards: bool) -> list[str]:
        """Continue the body flow onto neighbouring pages when a page's own flow runs out."""
        out: list[str] = []
        page = page_index
        step = -1 if backwards else 1
        while len(out) < wanted:
            page += step
            if page < 0:
                break
            sequence = self._top_level_by_flow.get((page, "body"))
            if sequence is None:
                if page > max((key[0] for key in self._top_level_by_flow), default=0):
                    break
                continue
            ordered = list(reversed(sequence)) if backwards else list(sequence)
            out.extend(ordered[: wanted - len(out)])
        return out

    # ── sections ─────────────────────────────────────────────────────────────────────────

    @property
    def sections(self) -> tuple[IndexedSection, ...]:
        return self._sections

    def section_of(self, block_id: str) -> IndexedSection | None:
        """The section containing ``block_id``, or ``None``.

        ``None`` IS A NORMAL ANSWER: front matter — title, authors, affiliation, abstract — is
        deliberately section-less in the IR. A nested block is resolved through its top-level
        ancestor, so a table cell answers with the section the table sits in.
        """
        position = self._section_of.get(block_id)
        if position is None:
            position = self._section_of.get(self.top_level_ancestor(block_id))
        return None if position is None else self._sections[position]

    def section_path(self, section: IndexedSection) -> tuple[IndexedSection, ...]:
        """``section`` and its ancestors, OUTERMOST FIRST — the outline path to it.

        Outermost first because that is the order it reads as a breadcrumb ("3 Deep Residual
        Learning > 3.3 Network Architectures"), and the evidence package spends its structure
        budget from the top down.
        """
        by_heading = {s.heading_block_id: s for s in self._sections}
        chain: list[IndexedSection] = []
        seen: set[str] = set()
        current: IndexedSection | None = section
        while current is not None and current.heading_block_id not in seen:
            chain.append(current)
            seen.add(current.heading_block_id)
            parent_id = current.parent_heading_block_id
            current = by_heading.get(parent_id) if parent_id is not None else None
        return tuple(reversed(chain))

    # ── relations ────────────────────────────────────────────────────────────────────────

    def relations_from(self, block_id: str) -> tuple[IndexedRelation, ...]:
        return tuple(self._relations_from.get(block_id, ()))

    def relations_to(self, block_id: str) -> tuple[IndexedRelation, ...]:
        return tuple(self._relations_to.get(block_id, ()))

    # ── references ───────────────────────────────────────────────────────────────────────

    @property
    def references(self) -> tuple[IndexedReference, ...]:
        return self._references

    def reference_by_label(self, label: str) -> IndexedReference | None:
        for reference in self._references:
            if reference.label == label:
                return reference
        return None

    # ── semantic ─────────────────────────────────────────────────────────────────────────

    def search_vectors(self, embedding: Sequence[float], k: int) -> tuple[tuple[str, float], ...]:
        """KNN over this paper generation's ``block_vectors`` partition.

        ``(block_id, distance)`` pairs sorted by ``(distance, reading-order rank, block_id)``.
        sqlite-vec returns rows in distance order but says nothing about ties, and ties are not
        hypothetical here — two blocks carrying the same embedding (an empty figure block and its
        empty neighbour) have distance 0.0 from everything. Re-sorting is what makes the semantic
        rung's output byte-identical across runs, which ``retrieval/expansion.spec`` asserts.

        Block ids the index has never heard of are DROPPED, not returned: a vector can outlive the
        block it was computed for (nothing cascades ``block_vectors`` on re-parse), and handing a
        caller an id it cannot resolve is worse than handing it fewer hits.
        """
        if k <= 0:
            return ()
        rows = self._reader.search_block_vectors(self.paper_id, self.generation, embedding, k)
        hits = [
            (str(row["block_id"]), float(row["distance"]))
            for row in rows
            if str(row["block_id"]) in self._blocks
        ]
        hits.sort(key=lambda pair: (pair[1], self.rank(pair[0]), pair[0]))
        return tuple(hits)


def _decode_json_list(raw: object) -> list[dict[str, Any]]:
    """Decodes a JSON column that holds a list of objects. Absent, null and ``""`` all mean none."""
    if not isinstance(raw, str) or not raw:
        return []
    decoded = json.loads(raw)
    if not isinstance(decoded, list):
        return []
    return [entry for entry in decoded if isinstance(entry, dict)]
