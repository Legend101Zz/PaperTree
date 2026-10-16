"""Pure helpers for the exchange views (#201): the thread list's ``ask`` and an answer's coverage.

No database and no network, so both are unit-tested on plain strings. The router
(``routers/threads.py``) feeds them stored rows; passage locators live in ``evidence.py`` because
they read the paper's parse.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any, Final

from .evidence import MARKER

#: The thread list's ask is cut to this many characters (the ellipsis included).
ASK_MAX_CHARS: Final = 160

_BLANK_LINE: Final = re.compile(r"\n[ \t]*\n")
_MARKDOWN_HEADING: Final = re.compile(r"#{1,6}\s+\S[^\n]*")
_WHITESPACE: Final = re.compile(r"\s+")


def ask_excerpt(content: str | None, *, limit: int = ASK_MAX_CHARS) -> str:
    """The first user message as the thread list shows it.

    Whitespace is collapsed. Text longer than ``limit`` is cut on a word boundary and ends in
    ``…``; the result never exceeds ``limit`` characters. One unbroken word longer than the limit
    is cut mid-word (there is no boundary to use).

    Args:
        content: The user message text, or None when the thread has none yet.
        limit: Maximum length of the result, ellipsis included.

    Returns:
        The excerpt, "" for no message.

    Example:
        >>> ask_excerpt("Explain this passage.")
        'Explain this passage.'
    """
    text = _WHITESPACE.sub(" ", content or "").strip()
    if len(text) <= limit:
        return text
    head = text[: limit - 1]
    if not text[limit - 1].isspace():  # the cut fell inside a word: back up to the last space
        cut = head.rfind(" ")
        if cut > 0:
            head = head[:cut]
    return head.rstrip() + "…"


def answer_paragraphs(content: str) -> list[str]:
    """An answer's paragraphs: blank-line separated, a bare Markdown heading skipped."""
    parts = (part.strip() for part in _BLANK_LINE.split(content))
    return [p for p in parts if p and not _MARKDOWN_HEADING.fullmatch(p)]


def message_coverage(content: str, citations: Iterable[tuple[str, bool | None]]) -> dict[str, Any]:
    """How much of an assistant answer is cited (the wire ``MessageCoverage``).

    Args:
        content: The assistant message text, markers included.
        citations: One ``(passage_key, supported)`` per stored citation of the message.

    Returns:
        ``passages``: distinct passage keys among ``citations``. ``citations``: marker handle
        occurrences in ``content`` (``[b1, b8]`` counts 2; a repeat counts again).
        ``paragraphs``: see :func:`answer_paragraphs`. ``uncited_paragraphs``: the 0-based
        indexes of paragraphs with no marker. ``not_verified``: citations whose ``supported`` is
        False (``None``, "never checked", does not count).

    Example:
        >>> message_coverage("A [b1].", [("g1:x", True)])["citations"]
        1
    """
    stored = list(citations)
    paragraphs = answer_paragraphs(content)
    return {
        "passages": len({key for key, _ in stored}),
        "citations": sum(len(m.group(1).split(",")) for m in MARKER.finditer(content)),
        "paragraphs": len(paragraphs),
        "uncited_paragraphs": [i for i, p in enumerate(paragraphs) if not MARKER.search(p)],
        "not_verified": sum(1 for _, supported in stored if supported is False),
    }
