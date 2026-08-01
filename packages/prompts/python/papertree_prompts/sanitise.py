r"""Character-level neutralisation of untrusted document text — two passes, in one order.

This module owns exactly two questions, and nothing else in the package re-asks them:
which characters are deleted, and which sequences are replaced by a space. It is the
first two steps of `research/synthesis-13-memory.md` §13.6(a)'s four-step pipeline; steps
3 and 4 (datamark stripping, datamark interleaving) live in `untrusted.py` because they
need a per-request secret and these two do not.

WHY THE ORDER IS FIXED, AND WHAT ACTUALLY BREAKS WHEN IT IS REVERSED
  §13.6(a) states the rule — "strip control characters *before* tag-stripping (otherwise
  `<U+200B>script>` — a tag with a zero-width space inside — survives)". That sentence is
  right about the conclusion and imprecise about the mechanism, and the imprecision matters
  because a reviewer who checks it against `TAGISH` will find it does not hold and may
  then conclude the ordering is decorative. It is not. Worked through:

    `TAGISH` deletes every BARE `<` and every BARE `>` unconditionally — it does not
    match balanced pairs. So `<U+200B` inside `<...>` loses both angle brackets under
    EITHER order. The zero-width space changes nothing on that branch.

    The branch where the order is load-bearing is the ENTITY branch. `&`+U+200B+`lt;`
    does NOT match the entity alternative of `TAGISH`, because the zero-width space sits
    between the `&` and the `l`. Strip control characters LAST and the sequence survives
    tag-stripping intact, and control-stripping then repairs it into a live `&lt;`. Feed
    `&`+U+200B+`lt;/untrusted_document&`+U+200B+`gt;` through the reversed pipeline and
    the model is handed `&lt;/untrusted_document&gt;`. Feed it through this one and the
    entity is gone. `tests/test_untrusted.py` runs both pipelines side by side and asserts
    the difference; the reversed pipeline in that test is a real experiment that was run
    against this module by swapping the two `.sub` calls here, watching the assertion
    fail, and putting them back.

  A second, quieter ordering dependency exists between this module and `untrusted.py`:
  control-stripping can CREATE a datamark-shaped sequence (`^ab<U+200B>cdef12` becomes
  `^abcdef12`), so the datamark strip must run after `sanitise`, never before it. That is
  enforced by `untrusted.py` calling `sanitise` first and is pinned by a test there.

WHY ENTITIES ARE STRIPPED AT ALL
  Not because we render HTML — we do not. Because the READER of this text is a language
  model, and a model handed `&lt;/untrusted_document&gt;` inside a document that is itself
  delimited by `<untrusted_document>` tags has been shown the closing delimiter in a form it
  can plausibly resolve. The downstream artefact renderer escapes markup independently
  (§13.6(b), and EchoLeak / CVE-2025-32711 is why it does); this pass is about the model,
  not about the renderer.

WHAT IS DELIBERATELY *NOT* STRIPPED, EACH WITH ITS REASON
  - `\t`, `\n`, `\r` and every Unicode whitespace character (U+00A0, U+2028, U+2029, …).
    They are whitespace, and whitespace is the datamark's insertion point: leaving them in
    means a line break inside a hostile paragraph becomes one more place the token appears.
    Python's `re` matches U+2028/U+2029/U+00A0 with `\s` on `str` patterns, which is what
    `untrusted.py` relies on.
  - Entity-shaped sequences with NO trailing semicolon (`&lt` with no `;`). HTML5's error
    recovery decodes a named subset of those, so this is a real residual and it is stated
    rather than papered over. It is not closed here because the closing rule — strip `&`
    followed by 2+ letters — deletes the ampersand from "Fish&Chips" and from every
    "Smith & Jones et al." variant a bibliography contains. The cost of that false positive
    is silent corruption of the paper's own text on every request; the benefit is a hardening
    step against a decode our own pipeline never performs. §13.6(b)'s escaping renderer is
    where the semicolon-less form is actually contained.
  - Chat-template delimiters that use square brackets (`[INST]`, `[/INST]`). `[12]` is
    plausibly the most frequent token in a scientific paper's body text, and stripping
    brackets would destroy the citation graph the rest of Epic 3 exists to expose. The
    angle-bracket family is covered because `<` and `>` are not load-bearing in prose;
    brackets are.

THE CONTROL CLASS, AND WHERE IT EXCEEDS §13.6(a)
  §13.6(a)'s class is the ranges marked "§13.6(a)" in the table below. Every one of them is
  kept. Seven ranges are ADDED, and each is a character that is invisible when rendered
  and that the published class misses:

    U+0080–U+009F  C1 controls. The C0 block is stripped; its Latin-1 twin was not.
    U+00AD         SOFT HYPHEN. Invisible, and PDF extractors do emit it at discretionary
                   line breaks. Removing it joins the two halves of a hyphenated word,
                   which is the reading the author intended. This is the one addition that
                   changes how extracted text reads, and it changes it toward correct.
    U+061C         ARABIC LETTER MARK. UAX #9 lists it alongside U+200E/U+200F as an
                   implicit bidi mark; the published class catches those two via the
                   U+200B–U+200F range and misses this one entirely.
    U+180E         MONGOLIAN VOWEL SEPARATOR. Reclassified Zs → Cf in Unicode 6.3, so it is
                   invisible and is NOT matched by `\s`, which is the worst combination.
    U+2060–U+2064  WORD JOINER and the invisible operators (FUNCTION APPLICATION, INVISIBLE
                   TIMES, INVISIBLE SEPARATOR, INVISIBLE PLUS). All zero-width, and all
                   genuinely plausible in a maths-heavy paper's text layer.
    U+FE00–U+FE0F, U+E0100–U+E01EF   Variation selectors, base and supplement. Zero-width.
                   The cost of stripping them is emoji presentation, which a research
                   paper's text layer does not need.
    U+FFF9–U+FFFB  Interlinear annotation anchors; renderers hide the annotation body.
    U+E0000–U+E007F  TAG characters. U+E0020–U+E007E encode the whole printable ASCII range
                   invisibly, one tag character per ASCII character. This is the "ASCII
                   smuggling" family, and it is the single largest gap in the published
                   class: a complete instruction can be carried in it with zero visible
                   glyphs and zero characters from any range §13.6(a) lists.

  The class is a deletion, not a replacement, on purpose: these characters carry no width,
  so replacing them with a space would insert a word boundary the author did not write and
  would change `co<SHY>operate` into two tokens.
"""

from __future__ import annotations

import re
from typing import Final

#: The invisible/control class, as an explicit integer table.
#:
#: A TABLE OF CODEPOINTS, NOT A REGEX LITERAL, AND THAT IS A SECURITY DECISION. The obvious
#: spelling of this class is a character class containing the characters themselves. That
#: spelling puts a zero-width space, a right-to-left override and a TAG character INTO THIS
#: FILE, where they are invisible in every diff, every code review and every terminal that
#: is supposed to police them — which is precisely the trick the class exists to defeat. It
#: was written that way first and the literals were confirmed present in the file with a
#: byte-level dump; this table replaced it. Integers cannot hide.
#:
#: Each row is (first, last, why). Ranges marked §13.6(a) are the published class from
#: research/synthesis-13-memory.md; the rest are additions argued in the module docstring.
CONTROL_AND_INVISIBLE_RANGES: Final[tuple[tuple[int, int, str], ...]] = (
    (0x0000, 0x0008, "C0 controls below TAB (§13.6(a))"),
    (0x000B, 0x000C, "VT, FF - the two C0 whitespace chars we do NOT keep (§13.6(a))"),
    (0x000E, 0x001F, "C0 controls above CR (§13.6(a))"),
    (0x007F, 0x007F, "DELETE (§13.6(a))"),
    (0x0080, 0x009F, "C1 controls - the Latin-1 twin of a block already stripped"),
    (0x00AD, 0x00AD, "SOFT HYPHEN - invisible, and emitted by PDF extractors"),
    (0x061C, 0x061C, "ARABIC LETTER MARK - a UAX #9 implicit bidi mark, missed upstream"),
    (0x180E, 0x180E, "MONGOLIAN VOWEL SEPARATOR - Cf since Unicode 6.3, so not \\s"),
    (0x200B, 0x200F, "ZWSP ZWNJ ZWJ LRM RLM (§13.6(a))"),
    (0x202A, 0x202E, "LRE RLE PDF LRO RLO - explicit bidi overrides (§13.6(a))"),
    (0x2060, 0x2064, "WORD JOINER and the invisible maths operators"),
    (0x2066, 0x2069, "LRI RLI FSI PDI - bidi isolates (§13.6(a))"),
    (0xFE00, 0xFE0F, "variation selectors"),
    (0xFEFF, 0xFEFF, "ZWNBSP / BOM (§13.6(a))"),
    (0xFFF9, 0xFFFB, "interlinear annotation anchors - renderers hide the body"),
    (0xE0000, 0xE007F, "TAG characters - the ASCII-smuggling block, entirely missed upstream"),
    (0xE0100, 0xE01EF, "variation selectors supplement"),
)


def _class_from(ranges: tuple[tuple[int, int, str], ...]) -> re.Pattern[str]:
    """Compiles the table into one character class.

    ``re.escape`` is applied to every endpoint so that a future row landing on ``]``, ``-``
    or ``^`` cannot silently re-open the class it is supposed to close.
    """
    parts: list[str] = []
    for first, last, _why in ranges:
        low = re.escape(chr(first))
        parts.append(low if first == last else f"{low}-{re.escape(chr(last))}")
    return re.compile(f"[{''.join(parts)}]")


#: Invisible and control characters, deleted outright.
CONTROL_AND_INVISIBLE: Final = _class_from(CONTROL_AND_INVISIBLE_RANGES)


#: Markup-shaped sequences, replaced by a space. Bare `<` and `>` go unconditionally; the
#: entity branch widens §13.6(a)'s `#x?[0-9A-Fa-f]{2,6}` because `&#x0000003c;` is seven hex
#: digits, decodes to `<` in every HTML parser, and slips straight through a 6-digit cap.
TAGISH: Final = re.compile(
    r"[<>]|&(?:[A-Za-z][A-Za-z0-9]{1,31}|#[0-9]{1,10}|#[Xx][0-9A-Fa-f]{1,10});"
)


def strip_control(text: str) -> str:
    """Deletes every invisible/control character. MUST run before `strip_tagish`."""
    return CONTROL_AND_INVISIBLE.sub("", text)


def strip_tagish(text: str) -> str:
    """Replaces markup-shaped sequences with a space.

    A space, not the empty string, for two reasons. `a<b>c` collapsing to `abc` invents a
    word the author did not write. And the space becomes a whitespace gap, which means the
    datamark step in `untrusted.py` then plants a token at exactly the position where an
    attacker put markup — the neutralisation leaves a visible mark instead of a hole.
    """
    return TAGISH.sub(" ", text)


def sanitise(text: str) -> str:
    """Steps 1 and 2 of §13.6(a), in the only order that is correct.

    Callers outside this package should not need this: `render_untrusted` applies it. It is
    exported because the advisory detector reports offsets against RAW text and a caller
    comparing raw against rendered needs the same transform we used.
    """
    return strip_tagish(strip_control(text))
