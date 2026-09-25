"""One paper generation, read through the read-only handle, indexed by ``papertree_retrieval``.

``PaperIndex`` encodes the measured PaperIR traps a second implementation would get wrong —
reading order rebuilt from per-page flows because ``doc_order`` exists only on top-level body
blocks; adjacency from the flow sequence because ``prev_id``/``next_id`` are never populated;
``section_of`` returning ``None`` as a NORMAL answer for front matter. So a view is built with
``PaperIndex.from_reader(handle, …)``: the read-only ``AgentDataHandle`` satisfies
``papertree_retrieval.PaperReader`` structurally, with no cast, no forged ``OwnerId`` and no private
import, and the read-only and read-write paths share one loader.

(This module's earlier header described a workaround — a cast facade and three private imports —
that ``PaperIndex.from_reader`` replaced; the reader release removed the eighteen-tool registry it
served, slice-plan §R R10. The API's internal paper tools use ``papertree_retrieval``'s
``PaperIndexCache`` directly; this view is kept for callers that also want the page rows, the
channels and the raw, unrepaired text.)

CACHING. A view is NOT cached: its index keeps the handle it was read through (for the vector
rung), and a handle is closed at the end of the request that opened it. The bounded, cross-request
cache is ``papertree_retrieval.PaperIndexCache``, which stores DETACHED indexes for that reason.
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
