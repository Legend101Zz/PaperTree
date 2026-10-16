"""A diagram answer (v0.2 S7a, #216): its parts and plate as the browser reads them.

A diagram run's message keeps the model's raw lines in ``content``; what the reader is shown comes
from the rows the broker stored as each part arrived (``ai_diagram_parts``) and the plate's title
and links (``ai_messages.diagram_json``). This module turns those rows into the wire shapes of
``schemas.MessageDiagram`` (DESIGN.md §4: a part is cited, not verified or inferred, never silently
uncited). The locator of a cited part is derived on read from the parse, never stored.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Final

from . import evidence

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
