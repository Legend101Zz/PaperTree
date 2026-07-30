"""F1.2 - block text, character-range spans, and repairs that are never silent.

THE RULE THIS MODULE ENFORCES: `Block.text` IS THE PDF'S OWN GLYPH STREAM. Nothing is rewritten,
nothing is dropped, nothing is inserted except the U+000A that separates one line from the next.

That is not a conservative reading of the acceptance criterion - it is what the three golden
fixtures actually contain, and they are the normative example:

    resnet paragraph:      '...have led\\nto a series of breakthroughs for image classiﬁcation...'
    neural-odes paragraph: '...normalizing ﬂows build com-\\nplicated transformations...'

Lines are joined with `\\n`. The **ligature is still U+FB01**. The **hyphen at the line break is
still there**. All three fixtures carry `repairs: []`- zero. Epic 0 chose "no mutation at all",
and the reason is visible in the schema: `text_normalised` exists, `content_hash` is computed
over it, and `normalise_text()` already expands ligatures, collapses whitespace and case-folds.
Doing any of that a second time in `text` would be a second copy of one contract.

WHY THAT MATTERS BEYOND TIDINESS. findings.md B7 measured the old extractor rewriting U+2212
MINUS to ASCII hyphen inside its ligature table, with no record. The fix is not "record the
rewrite" - it is **do not rewrite**. A parser that never mutates cannot mutate silently, and
`ingest/source-authenticity.spec` then reduces to an identity check rather than an
edit-distance argument.

HYPHENATION, WHICH IS THE ONE REAL TENSION

`research/benchmarks/README.md` §2 says gold annotation resolves hyphenation in `text`. The
fixtures do not. Both are right for their own purpose: gold is for comparing *readings*, the IR
is for storing *what the document says*.

So a line-break hyphen is emitted as a **proposal**: a `dehyphenate` repair with
`applied: false`, `from: "-\\n"`, `to: ""`, and an `at` offset. `Block.text` keeps the hyphen;
the proposal declares the reading. Consumers that want the joined word call
`resolved_text(block, apply_proposed=True)` - the library function that exists precisely so
three epics do not each write this loop. Retrieval (Epic 3) wants it; a reader rendering the
page as typeset does not.

Rule 30b makes this checkable rather than decorative: the validator recomputes
`dehyphenate(from) == to` with its own canonical transform, so a "dehyphenation" that is
actually an arbitrary rewrite is an ERROR. And rule 27 pins the offset: for `applied: false`,
`text[at : at+len(from)] == from`.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

from papertree_document_ir import Repair, Span

from papertree_document_worker.pdf import Line
from papertree_document_worker.pdf import Span as PdfSpan

__all__ = ["BlockText", "build_block_text", "is_dehyphenatable"]

#: The line separator inside `Block.text`. One code point, so span offsets stay simple.
LINE_SEPARATOR = "\n"

#: Hyphens that end a line and may be a soft break. U+00AD is invisible; U+002D and U+2010 are
#: the ones TeX actually emits. U+2011 NON-BREAKING HYPHEN is deliberately EXCLUDED - it means
#: "never break here", so a break after it is a typesetting fact, not a hyphenation.
_BREAKING_HYPHENS = frozenset({"-", "­", "‐"})


@dataclass(frozen=True, slots=True)
class BlockText:
    """The three things a text block needs, derived together so they cannot disagree."""

    text: str
    spans: tuple[Span, ...]
    #: Empty when nothing was proposed. The caller must OMIT `repairs` entirely rather than
    #: emit `[]`: every optional array in this schema carries `minItems: 1`, so `[]` is
    #: schema-INVALID (DESIGN.md D11 - "two spellings of one fact").
    repairs: tuple[Repair, ...]

    @property
    def is_empty(self) -> bool:
        return not self.text


def is_dehyphenatable(line_text: str, next_line_text: str) -> bool:
    """Whether a line break is a soft hyphenation rather than a real hyphen.

    Conservative on purpose - a false positive silently welds two words together, and the
    proposal mechanism means a false negative merely leaves a hyphen the reader can see.

    Requires all four:
      * the line ends with a breaking hyphen;
      * a LETTER precedes it (so "--" em-dashes, "3-" ranges and " -" dashes are excluded);
      * the next line starts with a letter;
      * that letter is **lowercase**.

    The last clause is the one that earns its keep. It rejects "self-\\nAttention", which is a
    real compound that must keep its hyphen, and it costs nothing: no word is ever hyphenated
    mid-way into a capital letter, so a capital after a line-break hyphen is a compound
    essentially always.

    An earlier draft read `after.islower() or before.islower()` and did the opposite of this
    paragraph - "self-" ends in a lowercase "f", so the disjunction fired and welded
    "self-\\nAttention" into "selfAttention". The parametrised case in
    `test_hyphenation_detection_is_conservative` is that bug.
    """
    if len(line_text) < 2 or not next_line_text:
        return False
    if line_text[-1] not in _BREAKING_HYPHENS:
        return False
    if not line_text[-2].isalpha():
        return False
    after = next_line_text[0]
    return after.isalpha() and after.islower()


def _span_role(span: PdfSpan) -> str | None:
    """`Span.role` for a run that is not ordinary prose, or `None`.

    Deliberately narrow. The schema's own description of this field says why: font-driven math
    detection is what made 36.9 % of ResNet's blocks false-positive math (findings.md B1), so
    NOTHING here reads the font name. The only role assigned at this stage is the one that is a
    pure Unicode fact - a run made entirely of private-use code points cannot be prose, because
    private-use code points have no meaning to assign.

    `inline_equation` and `citation` roles are assigned later, by `equations.py` and by citation
    detection, from geometry and symbol content rather than from typeface.
    """
    if not span.text:
        return None
    if all(unicodedata.category(ch) == "Co" for ch in span.text):
        return "undecodable_glyphs"
    return None


def build_block_text(lines: Sequence[Line]) -> BlockText:
    """Join lines into one block's text, with a span per style run and repairs for hyphenation.

    Span granularity is **one IR span per PDF style run**, not one per line. Finer than the
    fixtures (which are line-granularity) and deliberately so: `size` and `font` are per-run
    facts, Epic 2 asked for `size` on every span, and a run is the largest range over which the
    bbox is a single rectangle. Rule 26 only requires spans to be non-overlapping and ascending.
    """
    text_parts: list[str] = []
    spans: list[Span] = []
    repairs: list[Repair] = []
    offset = 0

    for index, line in enumerate(lines):
        for pdf_span in line.spans:
            length = len(pdf_span.text)
            if length == 0:
                # A zero-length span would violate rule 25's `start < end`. Dropping it loses
                # nothing: it has no characters to address.
                continue
            # Optional keys are built conditionally, NOT passed as `None`. Every optional field
            # in this schema is `NON_NULLABLE_OPTIONAL`: an explicit null raises
            # "<key> is optional but never nullable; omit it instead" (DESIGN.md D11 - one
            # spelling per fact, so "absent" and "null" cannot both mean absent).
            optional: dict[str, object] = {}
            if (role := _span_role(pdf_span)) is not None:
                optional["role"] = role
            if pdf_span.font:
                optional["font"] = pdf_span.font
            spans.append(
                Span(
                    start=offset,
                    end=offset + length,
                    bbox=list(pdf_span.bbox),
                    size=pdf_span.size,
                    **optional,  # type: ignore[arg-type]
                )
            )
            offset += length
        text_parts.append(line.text)

        if index + 1 < len(lines):
            next_text = lines[index + 1].text
            if is_dehyphenatable(line.text, next_text):
                # `at` points at the hyphen, which is the last code point of the line just
                # emitted - i.e. one before the separator that is about to be appended.
                # `model_validate` with the JSON key, not the constructor: the field's alias is
                # literally "from", `populate_by_name` is off, and `from` cannot be a Python
                # keyword argument. `Repair(from_=...)` raises twice over - once for the missing
                # required "from" and once for the forbidden extra "from_".
                repairs.append(
                    Repair.model_validate(
                        {
                            "kind": "dehyphenate",
                            "applied": False,
                            "from": line.text[-1] + LINE_SEPARATOR,
                            "to": "",
                            "at": offset - 1,
                        }
                    )
                )
            text_parts.append(LINE_SEPARATOR)
            offset += len(LINE_SEPARATOR)

    return BlockText(text="".join(text_parts), spans=tuple(spans), repairs=tuple(repairs))
