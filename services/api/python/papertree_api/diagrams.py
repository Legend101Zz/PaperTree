"""A diagram answer (v0.2 S7a, #216): quotes found, parts stored as they stream, the plate read.

A diagram run's message keeps the model's raw lines in ``content``; what the reader is shown comes
from the rows stored as each part arrived (``ai_diagram_parts``) and the plate's title and links
(``ai_messages.diagram_json``). DESIGN.md §4: a part is CITED (its quote is in the paper word for
word: an Anchor, ``supported``), NOT VERIFIED (the quote is there with differences: an Anchor,
not supported; or found nowhere: no Anchor) or INFERRED (no quote), never silently uncited. The
locator of a cited part is derived from the parse, never stored.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final

from papertree_agent_tools import PaperVocabulary
from papertree_anchoring import IndexedDocument, capture_citation, normalise_for_match
from papertree_db import OwnerId, PaperTreeDb
from papertree_db.ai import DiagramPartIn
from papertree_prompts import DATAMARK_SHAPE
from pydantic import ValidationError

from . import evidence
from .logging import log_event
from .schemas import AgentLink, AgentPart, AnchorV1
from .wiretime import now_wire

#: Shorter than this, a quote is not evidence of anything (R3 Q1: `quote` is 8-240 characters).
MIN_QUOTE_CHARS: Final = 8
_SPACE: Final = re.compile(r"\s+")

#: A message's status -> its plate's (``schemas.DiagramStatus``): the reader's Stop is `stopped`.
_PLATE_STATUS: Final[dict[str, str]] = {
    "streaming": "streaming",
    "complete": "complete",
    "partial": "partial",
    "aborted": "stopped",
    "error": "error",
}


def plate_status(message_status: str) -> str:
    """The plate status a message status reads as.

    Args:
        message_status: ``ai_messages.status`` (as shown, after the "run can no longer finish"
            rule of ``routers.threads.message_wire``).

    Returns:
        One of ``schemas.DiagramStatus``.
    """
    return _PLATE_STATUS.get(message_status, "error")


def part_wire(part: Mapping[str, Any], locators: evidence.PassageLocators | None) -> dict[str, Any]:
    """One stored part (``list_diagram_parts`` row) as ``schemas.DiagramPart``.

    Args:
        part: The row, with ``after``, ``edge`` and ``anchor`` already parsed.
        locators: The locators of the part's generation, or None when that parse cannot be
            loaded (the cite then has no locator).

    Returns:
        The wire dict. ``cite`` is None for an inferred part (no quote); otherwise it carries the
        model's quote, the Anchor (None when the quote was found nowhere) and ``supported``.
    """
    cite: dict[str, Any] | None = None
    quote = part["cite_quote"]
    if quote is not None:
        anchor = part["anchor"]
        cite = {
            "citation_id": anchor["id"] if anchor is not None else None,
            "quote": quote,
            "anchor": anchor,
            "locator": locators.locate(anchor) if anchor is not None and locators else None,
            "page_index": part["page_index"],
            "supported": bool(part["supported"]),
        }
    return {
        "letter": part["letter"],
        "label": part["label"],
        "text": part["note"],
        "kind": part["part_kind"],
        "after": list(part["after"]),
        "edge": list(part["edge"]),
        "cite": cite,
    }


def diagram_wire(
    plate: Mapping[str, Any] | None,
    message_status: str,
    parts: Sequence[Mapping[str, Any]],
    locators: evidence.PassageLocators | None,
) -> dict[str, Any]:
    """A diagram message's ``schemas.MessageDiagram``.

    Args:
        plate: ``ai_messages.diagram_json`` parsed (``{title, links}``), or None before the model
            wrote a plate line.
        message_status: The message's status as shown.
        parts: Its stored parts, in letter order.
        locators: As for :func:`part_wire`.

    Returns:
        ``{title, status, parts, links}``. A plate that ended (``complete`` or ``partial``) with no
        part reads as ``error``: never an empty plate (an orphan swept with raw lines but no part
        is ``partial`` on the message).
    """
    plate = plate or {}
    status = plate_status(message_status)
    if status in ("complete", "partial") and not parts:
        status = "error"
    return {
        "title": plate.get("title"),
        "status": status,
        "parts": [part_wire(part, locators) for part in parts],
        "links": [dict(link) for link in plate.get("links", [])],
    }


# ── finding a quote ──────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Found:
    """Where a quote was found: the block, and whether word for word."""

    block_id: str | None
    verbatim: bool


class QuoteResolver:
    """Looks for a part's quote in the paper, the run's own passages first.

    VERBATIM: the quote, with any datamark the model copied removed, is a substring of a block's
    text once both are folded the way an Anchor's quote is matched (``normalise_for_match``: line
    hyphens joined, whitespace collapsed, the identity fold). The run's blocks (the seed and its
    tool reads) are searched first, then every block in reading order: a quote the paper says word
    for word is cited wherever it is. WITH DIFFERENCES: no block holds it verbatim, but the lexical
    checker the answers use (``evidence.claim_verdict``) finds it ``supported`` by one of the run's
    own blocks. Otherwise it is found nowhere. A quote that spans two blocks (a paragraph the parser
    split) is not verbatim in either: it can only be "with differences".
    """

    def __init__(
        self,
        document: IndexedDocument | None,
        run_blocks: Sequence[str],
        texts: Mapping[str, str],
        paper: PaperVocabulary | None,
    ) -> None:
        """Builds the resolver for one run.

        Args:
            document: The anchoring document of the run's generation; None when it cannot be
                loaded (then nothing is found).
            run_blocks: The block ids the run was shown, in handle order.
            texts: ``block_id -> text`` of those blocks, for the lexical check.
            paper: The whole paper's vocabulary (``evidence.vocabulary_of``), or None.
        """
        self._document = document
        self._run_blocks = [b for b in dict.fromkeys(run_blocks) if b in texts]
        self._texts = texts
        self._paper = paper
        self._folded: dict[str, str] = {}

    @staticmethod
    def clean(quote: str) -> str:
        """The quote without datamark look-alikes, whitespace collapsed (what is stored and shown).

        Args:
            quote: The model's quote.

        Returns:
            The cleaned quote.
        """
        return _SPACE.sub(" ", DATAMARK_SHAPE.sub(" ", quote)).strip()

    def _fold(self, block_id: str) -> str:
        folded = self._folded.get(block_id)
        if folded is None and self._document is not None:
            indexed = self._document.by_id.get(block_id)
            folded = normalise_for_match(indexed.text).text if indexed is not None else ""
            self._folded[block_id] = folded
        return folded or ""

    def find(self, quote: str) -> Found:
        """Where ``quote`` is in the paper.

        Args:
            quote: The model's quote (cleaned or not).

        Returns:
            ``Found(block, True)`` for a verbatim match, ``Found(block, False)`` for one with
            differences, ``Found(None, False)`` when it is nowhere.
        """
        clean = self.clean(quote)
        needle = normalise_for_match(clean).text
        if self._document is None or len(needle) < MIN_QUOTE_CHARS:
            return Found(None, False)
        everything = [b.block.block_id for b in self._document.blocks]
        for block_id in dict.fromkeys([*self._run_blocks, *everything]):
            if needle in self._fold(block_id):
                return Found(block_id, True)
        for block_id in self._run_blocks:
            if evidence.claim_verdict(clean, [block_id], self._texts, self._paper) == "supported":
                return Found(block_id, False)
        return Found(None, False)


# ── a plate as it streams ────────────────────────────────────────────────────────────────────


def stored_shape(part: DiagramPartIn) -> dict[str, Any]:
    """A part about to be stored, in the shape ``list_diagram_parts`` reads back.

    Args:
        part: The part.

    Returns:
        The row-shaped dict :func:`part_wire` takes, so the live event and the read are one shape.
    """
    return {
        "letter": part.letter,
        "label": part.label,
        "note": part.text,
        "part_kind": part.kind,
        "after": list(part.after),
        "edge": list(part.edge),
        "cite_quote": part.quote,
        "anchor": None if part.anchor is None else dict(part.anchor),
        "supported": part.supported,
        "page_index": part.page_index,
    }


@dataclass
class PlateBuilder:
    """One diagram run's plate as its events arrive (the broker's, ``agent_client.RunBroker``).

    Each part is resolved and STORED at once, so a Stop, a timeout or a lost agent keeps the parts
    that came; the title and links are written to the message as they come too. A part the agent
    should never have sent (a letter out of order, a thirteenth part, an arrow from a later part)
    is logged and left out, never stored half-right.
    """

    db: PaperTreeDb
    owner: OwnerId
    run_id: str
    message_id: str
    generation: int
    resolver: QuoteResolver
    document: IndexedDocument | None
    locators: evidence.PassageLocators | None
    new_id: Callable[[str], str]
    title: str | None = None
    links: list[dict[str, Any]] = field(default_factory=list)
    count: int = 0

    def plate(self) -> dict[str, Any]:
        """``ai_messages.diagram_json``: ``{title, links}``."""
        return {"title": self.title, "links": list(self.links)}

    def _save(self) -> None:
        self.db.set_message_diagram(self.owner, self.message_id, self.plate())

    def on_plate(self, title: str) -> dict[str, Any]:
        """The plate line: stores the title.

        Args:
            title: The plate's title.

        Returns:
            The browser's ``plate`` event data.
        """
        self.title = title
        self._save()
        return {"title": title}

    def on_link(self, link: AgentLink) -> dict[str, Any] | None:
        """A feedback edge: stored when both its ends are placed parts.

        Args:
            link: The agent's ``link`` event.

        Returns:
            The browser's ``link`` event data, or None when it is left out.
        """
        placed = {chr(ord("A") + i) for i in range(self.count)}
        if link.source not in placed or link.target not in placed or link.source == link.target:
            self._refuse("link_unplaced")
            return None
        wire = {"source": link.source, "target": link.target, "label": link.label}
        self.links.append(wire)
        self._save()
        return wire

    def on_part(self, part: AgentPart) -> dict[str, Any] | None:
        """A part: its quote found in the paper, an Anchor minted, the row stored.

        Args:
            part: The agent's ``part`` event.

        Returns:
            The browser's ``part`` event data (``schemas.DiagramPart``), or None when it is left
            out.
        """
        expected = chr(ord("A") + self.count)
        if part.letter != expected:
            self._refuse("letter_out_of_order")
            return None
        quote = block_id = anchor = page_index = supported = None
        if part.cite is not None:
            quote = QuoteResolver.clean(part.cite.quote)
            found = self.resolver.find(quote)
            supported = found.verbatim
            anchor = self._anchor(found.block_id)
            if anchor is not None and found.block_id is not None and self.document is not None:
                block_id = found.block_id
                page_index = self.document.by_id[found.block_id].block.page_index
            else:
                supported = False  # an Anchor that could not be minted is not "cited"
        row = DiagramPartIn(
            part_id=self.new_id("dpt"),
            ordinal=self.count,
            label=part.label,
            text=part.text,
            kind=part.kind,
            after=list(part.after),
            edge=list(part.edge),
            quote=quote,
            anchor=anchor,
            supported=supported,
            generation=self.generation,
            block_id=block_id,
            page_index=page_index,
        )
        try:
            self.db.put_diagram_part(self.owner, self.message_id, row)
        except ValueError:
            self._refuse("part_invalid")
            return None
        self.count += 1
        return part_wire(stored_shape(row), self.locators)

    def _anchor(self, block_id: str | None) -> dict[str, Any] | None:
        """A whole-block citation Anchor over ``block_id``, or None.

        The record is refused when the contract would refuse it (the same check
        ``evidence.CitationMinter`` makes).
        """
        if block_id is None or self.document is None or block_id not in self.document.by_id:
            return None
        citation_id = self.new_id("cit")
        anchor: dict[str, Any] = dict(
            capture_citation(self.document, block_id, citation_id=citation_id, at=now_wire())
        )
        try:
            AnchorV1.model_validate_json(json.dumps(anchor))
        except ValidationError:
            self._refuse("anchor_invalid")
            return None
        return anchor

    def _refuse(self, code: str) -> None:
        log_event("run.diagram_dropped", level="warning", run_id=self.run_id, error_code=code)
