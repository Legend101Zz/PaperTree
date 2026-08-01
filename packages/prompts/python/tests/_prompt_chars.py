"""Named codepoints for the tests, built with `chr()` and never pasted as literals.

Every invisible character these tests exercise is constructed from an integer here. A test
file that pastes a real zero-width space is a test file whose diff hides the thing under
test, and `test_sanitise.py::test_no_literal_invisible_character_appears_anywhere_in_this
_package` fails the whole suite if one appears — in the implementation OR in these tests.
That audit is only meaningful because this module exists to make compliance easy.
"""

from __future__ import annotations

from typing import Final

ZWSP: Final = chr(0x200B)  # ZERO WIDTH SPACE
ZWNJ: Final = chr(0x200C)  # ZERO WIDTH NON-JOINER
ZWJ: Final = chr(0x200D)  # ZERO WIDTH JOINER
LRM: Final = chr(0x200E)  # LEFT-TO-RIGHT MARK
RLM: Final = chr(0x200F)  # RIGHT-TO-LEFT MARK
LRE: Final = chr(0x202A)  # LEFT-TO-RIGHT EMBEDDING
RLE: Final = chr(0x202B)  # RIGHT-TO-LEFT EMBEDDING
PDF_BIDI: Final = chr(0x202C)  # POP DIRECTIONAL FORMATTING
LRO: Final = chr(0x202D)  # LEFT-TO-RIGHT OVERRIDE
RLO: Final = chr(0x202E)  # RIGHT-TO-LEFT OVERRIDE
LRI: Final = chr(0x2066)  # LEFT-TO-RIGHT ISOLATE
RLI: Final = chr(0x2067)  # RIGHT-TO-LEFT ISOLATE
FSI: Final = chr(0x2068)  # FIRST STRONG ISOLATE
PDI: Final = chr(0x2069)  # POP DIRECTIONAL ISOLATE
ALM: Final = chr(0x061C)  # ARABIC LETTER MARK
BOM: Final = chr(0xFEFF)  # ZERO WIDTH NO-BREAK SPACE / BOM
WJ: Final = chr(0x2060)  # WORD JOINER
SHY: Final = chr(0x00AD)  # SOFT HYPHEN
NBSP: Final = chr(0x00A0)  # NO-BREAK SPACE — whitespace, deliberately NOT stripped
LINE_SEP: Final = chr(0x2028)  # LINE SEPARATOR — whitespace, deliberately NOT stripped

#: Cyrillic lookalikes for the homoglyph rule.
CYRILLIC_A: Final = chr(0x0430)
CYRILLIC_O: Final = chr(0x043E)


def tag_encode(ascii_text: str) -> str:
    """ASCII smuggling: each ASCII character as its U+E0000-block TAG twin.

    U+E0020 TAG SPACE through U+E007E TAG TILDE mirror the printable ASCII range one for
    one, so this returns a string that renders as nothing at all and carries a full
    instruction. It is the largest gap in §13.6(a)'s published control class.
    """
    return "".join(chr(0xE0000 + ord(c)) for c in ascii_text)
