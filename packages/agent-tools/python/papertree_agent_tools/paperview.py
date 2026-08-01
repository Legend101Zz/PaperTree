"""One paper generation, read through the read-only handle, indexed by ``papertree_retrieval``.

WHY THIS MODULE EXISTS AT ALL — A SEAM, NAMED RATHER THAN PAPERED OVER

``PaperIndex`` is the right structure for eight of this package's eighteen tools:
``get_block_children`` is ``index.children``, ``get_parent_section`` is ``index.section_of`` plus
``index.section_path``, ``get_adjacent_blocks`` is ``index.adjacent``. Every one of those methods
encodes a measured PaperIR trap that a second implementation would get wrong — reading order
rebuilt from per-page flows because ``doc_order`` is present on 207 of 974 blocks; adjacency
derived from the flow sequence because ``prev_id``/``next_id`` are populated 0 of 974 times;
``section_of`` returning ``None`` as a NORMAL answer for front matter. Re-deriving them here is
precisely the "every feature invents its own representation" failure that
``papertree_document_ir.identity`` exists to kill.

**But ``PaperIndex.load`` takes a ``PaperTreeDb``, which opens read-WRITE — the one object an
agent tool may never hold.** ``papertree_memory.agent_handle``'s docstring is explicit about why
wrapping one and exposing only its read methods is not acceptable: it gives an object whose
``__slots__`` contain a live writable connection, which is a boundary made of method visibility.

There are three ways out and only one of them is honest:

  1. Hand ``PaperIndex.load`` a ``PaperTreeDb``. Rejected: it destroys F3.8 outright.
  2. Re-implement the index over ``AgentDataHandle``. Rejected: ~300 lines duplicating four
     documented traps, which drift on the first schema change.
  3. Construct ``PaperIndex`` directly — its ``__init__`` takes already-built rows — and supply
     the two constructor arguments it holds only for the semantic rung. That is this module.

WHAT THE THIRD OPTION COSTS, STATED IN FULL SO A REVIEWER DOES NOT HAVE TO FIND IT

  * **A cast.** ``PaperIndex.__slots__`` includes ``_db: PaperTreeDb``, used in exactly one
    place: ``search_vectors`` calls ``self._db.search_block_vectors(self._owner, paper_id,
    generation, embedding, k)``. :class:`_VectorSearchFacade` implements that one method with
    that exact positional signature, delegating to ``AgentDataHandle.search_block_vectors``,
    which is the SAME SQL against the SAME vec0 partition — verified by
    ``packages/memory/python/tests/test_agent_handle_reads.py``, which asserts a vector written
    through ``PaperTreeDb`` is found through the handle. The ``cast`` is a lie to mypy and it is
    the smallest one available; ``tests/test_tools.py`` asserts the facade is still call-
    compatible, so a signature change in ``papertree_db`` fails here loudly.
  * **An ``OwnerId`` that authorises nothing.** ``mint_owner()`` returns a handle no connection
    has recorded, and ``ids.py``'s own docstring says such an object "authorises nothing" —
    resolution fails. It fills a constructor slot the facade never reads. This is fail-CLOSED by
    construction: if a future ``PaperIndex`` started resolving the owner, every call would raise
    ``OwnershipError`` rather than quietly reading a tenant we did not mean.
  * **Three private imports** from ``papertree_retrieval.index``. ``_to_indexed_block`` is the
    one that matters: it is the code that calls ``resolved_text(block, apply_proposed=False)``
    with the right adapter, and DESIGN.md D4 forbids every other consumer from concatenating
    ``text`` and ``repairs`` by hand. ``_decode_json_list`` and ``_reference_label`` come along
    because forking the bibliography-label matcher would fork the citation contract.
    ``tests/test_tools.py`` asserts all three still exist, so a rename is a failing test in this
    package rather than a silent behaviour change.

**The right fix is a ``PaperIndex.from_rows`` / ``PaperIndex.load_readonly`` classmethod in
``papertree-retrieval``, which this package does not own.** AGENTS.md §1: *"Found something
outside your owned paths? File an issue, do not edit."* This module is the workaround, and its
whole cost is the three lines above.

CACHING, AND WHY IT IS PER TURN AND NOT PER CALL
    Building a view reads every page and every block: 974 rows on the largest corpus paper, ~60
    KB of text (``index.py``'s measurement). A turn makes several tool calls against one paper,
    so :class:`ToolContext` builds the view once and holds it. It is NOT a process-level cache:
    two turns are two handles, and a cache that outlived a handle would outlive the owner
    binding that makes the handle safe.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

from papertree_db import Generation, PaperId, Row
from papertree_memory import AgentDataHandle
from papertree_retrieval import IndexedRelation, IndexedSection, PaperIndex

__all__ = ["PaperView", "load_paper_view"]

#: PaperIR's four ``Block.source`` values mapped onto ``papertree_prompts`` channels. The two
#: vocabularies are deliberately different — ``channels.py``'s docstring: ``source`` answers "how
#: were these characters obtained", ``channel`` answers "may this text be treated as the author
#: speaking". Only ``pdf_text_layer`` earns ``text_layer``; ``ocr`` maps to ``page_ocr``, which
#: ``NEVER_HIGH_PRIVILEGE_SUFFIXES`` denies privilege to no matter what the allow-list says.
#: An unmapped source falls to ``"unknown_source"``, which is a valid open-vocabulary channel and
#: is not in the privilege set — failing closed, as that module requires.
SOURCE_TO_CHANNEL: Final[Mapping[str, str]] = {
    "pdf_text_layer": "text_layer",
    "pdf_vector": "text_layer",
    "pdf_raster": "page_ocr",
    "ocr": "page_ocr",
}

UNKNOWN_CHANNEL: Final = "unknown_source"


@dataclass(frozen=True, slots=True)
class PaperView:
    """One paper generation as the tools need it: the row, the pages, the index, the channels."""

    paper_id: PaperId
    generation: Generation
    #: The ``papers`` row. JSON columns are still STRINGS — ``AgentDataHandle.get_paper`` does
    #: not parse them and neither does this, because the prompt builder needs the raw text to
    #: datamark it.
    paper: Row
    pages: tuple[Row, ...]
    index: PaperIndex
    #: ``papers.metadata`` decoded once. Every tool that reads metadata reads this.
    metadata: Mapping[str, Any]
    #: ``block_id -> blocks.source``. Kept because ``IndexedBlock`` deliberately omits ``source``
    #: (it carries only what the retrieval ladder reads) and ``UntrustedChunk`` requires a
    #: channel. Built from rows already in hand, so it costs no extra query.
    sources: Mapping[str, str]
    #: ``block_id -> blocks.payload`` decoded, for the equation / figure / table tools.
    payloads: Mapping[str, Mapping[str, Any]]
    #: ``blocks.text`` VERBATIM AND UNREPAIRED, keyed by block id. This is the column
    #: ``EvidenceSpan``'s offsets are defined against (``records.py``: "OFFSETS ARE INTO
    #: ``blocks.text``, THE UNREPAIRED READING"), so ``save_user_note`` must verify against this
    #: and NOT against ``IndexedBlock.text``. They are equal only when no repair was applied.
    raw_text: Mapping[str, str]
    vector_count: int

    def channel_for(self, block_id: str) -> str:
        """The prompt channel for one block. Falls to an unprivileged channel when unmapped."""
        return SOURCE_TO_CHANNEL.get(self.sources.get(block_id, ""), UNKNOWN_CHANNEL)

    def heading_text(self, section: IndexedSection) -> str:
        """A section's display title. ``Section`` has no title field — see ``index.py`` trap 3."""
        block = self.index.block(section.heading_block_id)
        return "" if block is None else block.text

    def page(self, page_index: int) -> Row | None:
        for row in self.pages:
            if int(row["page_index"]) == page_index:
                return row
        return None


def load_paper_view(
    handle: AgentDataHandle, paper_id: PaperId, generation: Generation
) -> PaperView:
    """Reads one paper generation through the handle and indexes it.

    Raises ``KeyError`` when the generation does not exist for this handle's user — mirroring
    ``PaperIndex.load``, and for the same reason it gives: an empty index would let a typo'd
    ``paper_id`` produce a paper with nothing in it, which is indistinguishable at the call site
    from a paper that genuinely has nothing.
    """
    paper = handle.get_paper(paper_id, generation)
    if paper is None:
        raise KeyError(
            f"no paper {paper_id} at generation {generation} for user "
            f"{handle.owner_user_id}. A read-only handle cannot create one, and an empty view "
            "would answer every question with 'nothing found'."
        )

    pages = tuple(handle.list_pages(paper_id, generation))
    rows: list[Row] = []
    for page in pages:
        rows.extend(handle.list_blocks_on_page(paper_id, generation, int(page["page_index"])))

    vector_count = handle.count_block_vectors(paper_id, generation)

    # ONE call, and the absence of a cast here is the point.
    #
    # `AgentDataHandle` satisfies `papertree_retrieval.PaperReader` STRUCTURALLY — the six
    # owner-less read methods, nothing else. There is no `cast`, no forged `OwnerId`, and no
    # private import: `PaperIndex.from_reader` is the same code path `PaperIndex.load` takes
    # after it binds an owner to a read-write `PaperTreeDb`, so the read-only and read-write
    # paths cannot drift into reading different things.
    #
    # The earlier shape of this function did all of the above by hand — it re-implemented the
    # loader, reached for three private helpers in `papertree_retrieval.index`, and handed
    # `PaperIndex` a `cast(PaperTreeDb, ...)` facade plus an `OwnerId` no connection had minted.
    # It worked. It was also three lies to the type checker inside the one package whose job is
    # to be trustworthy about what the agent can reach, which is the wrong place to be clever.
    index = PaperIndex.from_reader(handle, paper_id, generation)

    return PaperView(
        paper_id=paper_id,
        generation=generation,
        paper=paper,
        pages=pages,
        index=index,
        metadata=_decode_object(paper.get("metadata")),
        sources={str(row["block_id"]): str(row["source"]) for row in rows},
        payloads={
            str(row["block_id"]): _decode_object(row.get("payload"))
            for row in rows
            if row.get("payload")
        },
        raw_text={str(row["block_id"]): str(row["text"] or "") for row in rows},
        vector_count=vector_count,
    )


def _relation(row: Row) -> IndexedRelation:
    """One ``relations`` row. Unknown types are PRESERVED — never filtered (DESIGN.md D2)."""
    return IndexedRelation(
        type=str(row["type"]),
        from_block=str(row["from_block"]),
        to_block=str(row["to_block"]),
        confidence=float(row["confidence"]),
        provenance=str(row["provenance"]),
    )


def _optional_str(value: object) -> str | None:
    return None if value is None else str(value)


def _decode_object(raw: object) -> dict[str, Any]:
    """A JSON object column, decoded. Absent, ``null`` and ``""`` all mean "no object"."""
    if not isinstance(raw, str) or not raw:
        return {}
    decoded = json.loads(raw)
    return decoded if isinstance(decoded, dict) else {}
