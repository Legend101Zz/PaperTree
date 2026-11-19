"""Pure helper for the exchange views (#201): the thread list's ``ask``.

No database and no network, so it is unit-tested on plain strings. The router
(``routers/threads.py``) feeds it stored rows; passage locators live in ``evidence.py`` because
they read the paper's parse. (An answer's coverage readout is gone: #340, #341.)
"""

from __future__ import annotations

import re
from typing import Final

#: The thread list's ask is cut to this many characters (the ellipsis included).
ASK_MAX_CHARS: Final = 160

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
