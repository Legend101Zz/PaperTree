"""The Python twin of ``src/quotenorm.ts`` — the fold T3 matches against, plus the raw-offset map.

THIS IS NOT ``document_ir.normalise_text``, and ``src/quotenorm.ts:1-30`` says why at length: T3
needs the same fold PLUS de-hyphenation PLUS a map back to raw offsets, and identity normalisation
provides none of the last two. So this module reuses ``normalise_text`` per code point — the fold is
context-independent, so per-code-point output IS the fold — and adds the other two on top.

WHY THERE IS NO ``to_code_points`` HERE. ``src/quotenorm.ts`` carries one because a JavaScript
string is a sequence of UTF-16 code units and every offset in ``@papertree/anchoring`` is counted in
code points (``Anchor.offsetUnit === 'unicode'``). A Python ``str`` is already a sequence of code
points, so ``len``, slicing and indexing all count the unit this package requires and the conversion
would be the identity. Stated rather than assumed, because getting it wrong is silent.

THE ONE PLACE THIS BINDING CAN DIVERGE FROM THE TYPESCRIPT ONE, said out loud rather than hidden in
a helper. ``quotenorm.ts`` tests ``/\\p{Alphabetic}/u`` and ``/\\p{Uppercase}/u``; Python exposes
neither derived property. ``str.isalpha()`` is ``L*`` and omits ``Nl`` and ``Other_Alphabetic``, so
``Nl`` is added back below and ``Other_Alphabetic`` (combining marks such as U+0345) is NOT. The
delta can only change an outcome when the character beside a line-break hyphen is a combining mark
or a letter-number: ZERO of the 84 line-break-hyphen sites on the three golden fixtures' streams
(80 inside a block, 4 at a block boundary where the separator newline supplies the break). Measured,
not asserted by eye — ``test_selectors.py::test_no_hyphen_site_reaches_the_property_divergence``.
Note this reproduces ``quotenorm.ts``'s "61 line-break hyphens in resnet alone" exactly: 61 inside a
block, plus the one block-FINAL hyphen (``high-``) that only becomes a site once the stream joins.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from papertree_document_ir import normalise_text

#: Code points that count as a line-break hyphen. U+00AD SOFT HYPHEN is included: it means this.
HYPHENS = frozenset("\u002d\u2010\u00ad")

NEWLINES = frozenset("\n\r\v\f\u2028\u2029")


@dataclass(frozen=True, slots=True)
class NormalisedQuote:
    """The folded text plus, for each of its code points, the raw offset it came from.

    ``raw_offset_at`` is one longer than ``text``; the last entry is the raw length, so a normalised
    range ``[a, b)`` maps to the raw range ``[raw_offset_at[a], raw_offset_at[b])`` with no special
    case at the end. That is the property ``resolve.ts`` relies on when it turns a T3 match back
    into a highlight.
    """

    text: str
    raw_offset_at: tuple[int, ...]


def _is_alphabetic(char: str | None) -> bool:
    if char is None:
        return False
    return char.isalpha() or unicodedata.category(char) == "Nl"


def _is_lower_alphabetic(char: str | None) -> bool:
    return _is_alphabetic(char) and char is not None and not char.isupper()


_WHITESPACE_CACHE: dict[str, bool] = {}


def is_whitespace(char: str) -> bool:
    """Whitespace by the identity module's definition, discovered rather than duplicated.

    ``normalise_text`` collapses every whitespace code point to U+0020 and strips it at the ends, so
    a single code point whose normalised form is empty is whitespace and nothing else is. A second
    hand-written table is a second contract and it will drift — the same argument ``quotenorm.ts``
    makes, and the reason both bindings discover the set instead of listing it.
    """
    cached = _WHITESPACE_CACHE.get(char)
    if cached is None:
        cached = normalise_text(char) == ""
        _WHITESPACE_CACHE[char] = cached
    return cached


def normalise_for_match(raw: str) -> NormalisedQuote:
    """Normalise for matching, keeping every produced code point traceable to its raw offset.

    Three passes, in this order, for the reason ``quotenorm.ts`` gives: the hyphen rule has to see
    the raw newline that pass 2 would have collapsed to a space.

      1. drop a line-break hyphen and the newline run after it, when the character before the hyphen
         is alphabetic and the first character after the newline is a LOWERCASE letter — so
         ``transduc-\\ntion`` joins and ``2015-\\n2016`` and ``Kaiming-\\nHe`` do not;
      2. collapse whitespace runs to one U+0020 and strip the ends;
      3. fold each code point through ``normalise_text``, the same fold block identity uses, so a T3
         match and a T1 hit cannot disagree about what two strings are equal.
    """
    # ── 1. de-hyphenate ──
    dehyphenated: list[str] = []
    after_hyphen: list[int] = []
    length = len(raw)
    i = 0
    while i < length:
        char = raw[i]
        if char in HYPHENS:
            j = i + 1
            while j < length and raw[j] in NEWLINES:
                j += 1
            joins_a_word = (
                j > i + 1
                and i > 0
                and _is_lower_alphabetic(raw[j] if j < length else None)
                and _is_alphabetic(raw[i - 1])
            )
            if joins_a_word:
                i = j
                continue
        dehyphenated.append(char)
        after_hyphen.append(i)
        i += 1

    # ── 2. collapse whitespace ──
    collapsed: list[str] = []
    after_collapse: list[int] = []
    in_run = False
    for index, char in enumerate(dehyphenated):
        if is_whitespace(char):
            if not in_run:
                collapsed.append(" ")
                after_collapse.append(after_hyphen[index])
            in_run = True
        else:
            collapsed.append(char)
            after_collapse.append(after_hyphen[index])
            in_run = False
    start = 0
    end = len(collapsed)
    while start < end and collapsed[start] == " ":
        start += 1
    while end > start and collapsed[end - 1] == " ":
        end -= 1

    # ── 3. fold, per code point ──
    # A fold can expand one code point into several (``ß`` → ``ss``), so every produced code point
    # records the RAW offset of the code point it came from. That is what keeps a match landing
    # mid-expansion mappable back to a real character.
    out: list[str] = []
    raw_offset_at: list[int] = []
    for index in range(start, end):
        raw_offset = after_collapse[index]
        for folded_char in normalise_text(collapsed[index]):
            out.append(folded_char)
            raw_offset_at.append(raw_offset)
    raw_offset_at.append(length)
    return NormalisedQuote(text="".join(out), raw_offset_at=tuple(raw_offset_at))


def snap_to_word_boundary(text: str, offset: int, direction: int) -> int:
    """Snap an offset outward to a word boundary, so context is words and not fragments."""
    index = max(0, min(len(text), offset))
    while (
        0 < index < len(text)
        and not is_whitespace(text[index - 1])
        and not is_whitespace(text[index])
    ):
        index += direction
        if index <= 0 or index >= len(text):
            break
    return max(0, min(len(text), index))
