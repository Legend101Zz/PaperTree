"""A diagram answer (v0.2 S7a, #216): parts stored as they stream, and the plate read back.

A diagram run's message keeps the model's raw lines in ``content``; what the reader is shown comes
from the rows stored as each part arrived (``ai_diagram_parts``) and the plate's title and links
(``ai_messages.diagram_json``). DESIGN.md §4: a part is CITED (its quote is word for word in a
passage the run read: an Anchor, ``supported``), NOT VERIFIED (near a passage: an Anchor, not
supported; or found nowhere: no Anchor) or INFERRED (no quote), never silently uncited. Where a
quote is found is ``quotes.py``'s; the locator of a cited part is derived from the parse, never
stored.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final

from papertree_anchoring import IndexedDocument
from papertree_db import OwnerId, PaperTreeDb
from papertree_db.ai import DiagramPartIn

from . import evidence
from .logging import log_event
from .quotes import QuoteResolver, clean_quote
from .schemas import AgentLink, AgentPart

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
    that came; the title and links are written to the message as they come too. Parts keep the
    AGENT's letters: they rise, but may skip one when a frame was dropped on the way (logged by
    ``agent_client.AgentStream``), and an arrow or link from a letter that was never stored is
    left out. A part the agent should never have sent (a letter out of order, a part the table
    refuses) is logged and left out, never stored half-right.
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
    #: The letters stored, in order.
    stored: list[str] = field(default_factory=list)

    @property
    def count(self) -> int:
        """How many parts are on the plate."""
        return len(self.stored)

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
        placed = set(self.stored)
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
        if self.stored and part.letter <= self.stored[-1]:
            self._refuse("letter_out_of_order")
            return None
        after: list[str] = []
        edge: list[str | None] = []
        for letter, label in zip(part.after, part.edge, strict=False):
            if letter in self.stored and letter not in after:
                after.append(letter)
                edge.append(label)
        quote = block_id = anchor = page_index = supported = None
        if part.cite is not None:
            quote = clean_quote(part.cite.quote)
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
            ordinal=ord(part.letter) - ord("A"),
            label=part.label,
            text=part.text,
            kind=part.kind,
            after=after,
            edge=edge,
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
        self.stored.append(part.letter)
        return part_wire(stored_shape(row), self.locators)

    def _anchor(self, block_id: str | None) -> dict[str, Any] | None:
        """``evidence.mint_block_anchor`` over ``block_id``, or None.

        On None the part is kept as not verified: an Anchor the contract refuses is never stored.
        """
        if block_id is None or self.document is None or block_id not in self.document.by_id:
            return None
        anchor = evidence.mint_block_anchor(self.document, block_id, self.new_id("cit"))
        if anchor is None:
            log_event(
                "run.diagram_anchor_invalid",
                level="error",
                run_id=self.run_id,
                error_code="anchor_invalid",
            )
        return anchor

    def _refuse(self, code: str) -> None:
        log_event("run.diagram_dropped", level="warning", run_id=self.run_id, error_code=code)
