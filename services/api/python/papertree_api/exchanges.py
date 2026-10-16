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
    """THE paragraph list of an answer; ``MessageCoverage.uncited_paragraphs`` indexes into it.

    The rule (the web mirrors it exactly): split ``content`` on blank lines (a line holding only
    spaces or tabs counts as blank), trim each piece, drop empty pieces, and drop a piece that is
    a single Markdown heading line (``#`` to ``######`` followed by text). Nothing else is
    dropped: a ``**Bold line**`` is a paragraph, and a bullet list with no blank line between its
    items is ONE paragraph.

    Example:
        >>> answer_paragraphs("# Title")
        []
    """
    parts = (part.strip() for part in _BLANK_LINE.split(content))
    return [p for p in parts if p and not _MARKDOWN_HEADING.fullmatch(p)]


def message_coverage(
    content: str, citations: Iterable[tuple[str, str, bool | None]]
) -> dict[str, Any]:
    """How much of an assistant answer is cited (the wire ``MessageCoverage``).

    Args:
        content: The assistant message text, markers included.
        citations: One ``(marker, passage_key, supported)`` per STORED citation of the message
            (one per distinct handle the run resolved).

    Returns:
        ``citations``: marker handle occurrences in ``content`` whose handle has a stored
        citation (``[b1, b8]`` counts 2; a repeat counts again). ``unresolved_markers``: the
        occurrences whose handle has none (the model wrote ``[b99]``; the run dropped it), so a
        hallucinated handle is never counted as a citation. ``passages``: distinct passage keys
        among the stored citations. ``paragraphs`` and ``uncited_paragraphs``: see
        :func:`answer_paragraphs` (a paragraph is cited when it holds any marker, resolved or
        not). ``not_verified``: stored citations whose ``supported`` is False; ``None`` ("never
        checked") is NOT counted, and is not "verified" either.

    Example:
        >>> message_coverage("A [b1] [b9].", [("b1", "g1:x", True)])["unresolved_markers"]
        1
    """
    stored = list(citations)
    known = {marker for marker, _, _ in stored}
    resolved = unresolved = 0
    for match in MARKER.finditer(content):
        for handle in (h.strip() for h in match.group(1).split(",")):
            if handle in known:
                resolved += 1
            else:
                unresolved += 1
    paragraphs = answer_paragraphs(content)
    return {
        "passages": len({key for _, key, _ in stored}),
        "citations": resolved,
        "unresolved_markers": unresolved,
        "paragraphs": len(paragraphs),
        "uncited_paragraphs": [i for i, p in enumerate(paragraphs) if not MARKER.search(p)],
        "not_verified": sum(1 for _, _, supported in stored if supported is False),
    }
