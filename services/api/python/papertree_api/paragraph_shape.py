"""Text-shape rules for "is this block a numbered body paragraph?" (#201).

A passage locator's ``¶`` must be a number a reader can reproduce by counting paragraphs on the
page. The parser types some non-paragraphs ``paragraph`` (a heading it did not section, a figure
label, a caption) and splits one paragraph into several blocks (column and figure breaks). Each
rule here removes one such artefact from the count; a block the rules refuse gets
``para_index: null`` and the UI shows the page only. When in doubt the answer is "not countable":
no ¶ is better than a wrong ¶ where the product promises traceability.

Pure functions over text, no parse needed, so each rule is unit-tested on strings taken from the
real parses of the corpus PDFs (Attention, ResNet, BERT).
"""

from __future__ import annotations

import re
from typing import Final

#: Fewer words than this is a label or a fragment, never a paragraph (``F(x)``, "Left-to-right
#: language model-").
MIN_PARAGRAPH_WORDS: Final = 4
#: A line this short with no closing punctuation is a heading the parser typed ``paragraph``.
MAX_HEADING_WORDS: Final = 8

_TERMINAL: Final = re.compile(r"[.!?:;,)\]\"'”’]$")
_NUMBERED_HEADING: Final = re.compile(r"^\s*\d+(?:\.\d+)*\.?\s+\S")
_CAPTION_START: Final = re.compile(r"^\s*(?:Figure|Fig\.|Table)\s*\d", re.IGNORECASE)
_CAPTION_LINE: Final = re.compile(r"(?m)^.*\b(?:Figure|Fig\.|Table)\s*\d+[.:]\s")
#: A caption is a few lines; a longer block that mentions "Figure 2." is body text.
_CAPTION_MAX_WORDS: Final = 40
_CONTINUATION_START: Final = re.compile(r"^\s*(?:[a-z]|[(),;:\]])")


def _words(text: str) -> int:
    return len(text.split())


def is_label_shaped(text: str) -> bool:
    """Too short to be a paragraph: a figure label such as ``F(x)``, or a stray fragment."""
    return _words(text) < MIN_PARAGRAPH_WORDS


def is_heading_shaped(text: str) -> bool:
    """Whether a ``paragraph`` block is really a heading the parser never made a section of.

    ``Model Architecture`` (short, no closing punctuation) or a numbered title (``3.2 Scaled
    Dot-Product Attention``).
    """
    stripped = text.strip()
    if not stripped or _TERMINAL.search(stripped):
        return False
    words = _words(stripped)
    return words <= MAX_HEADING_WORDS or (
        bool(_NUMBERED_HEADING.match(stripped)) and words <= MAX_HEADING_WORDS * 2
    )


def is_caption_shaped(text: str) -> bool:
    """Whether a block is a figure or table caption.

    It starts ``Figure 2``/``Table 1``, or is a short block with a ``Figure N.`` caption line
    (ResNet's label-plus-caption block).
    """
    if _CAPTION_START.match(text):
        return True
    return _words(text) <= _CAPTION_MAX_WORDS and bool(_CAPTION_LINE.search(text))


def starts_as_continuation(text: str) -> bool:
    """Whether a block begins like the middle of a sentence.

    A lowercase letter or a bracket or comma first: the tail of the previous paragraph, split off
    by a column or page break.
    """
    return bool(_CONTINUATION_START.match(text))


def ends_unfinished(text: str) -> bool:
    """Whether a block ends with no closing punctuation, so the next block is its tail."""
    stripped = text.rstrip()
    return bool(stripped) and not _TERMINAL.search(stripped)
