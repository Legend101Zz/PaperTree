"""F1.8 - paragraph continuation across a column break and across a page break.

"The metric nobody publishes and every reader notices" - `research/benchmarks/README.md` §4.1
lists cross-page paragraph reconstruction as a first-class metric for exactly that reason. A
paragraph split by a page break is one paragraph; a reader who selects it, a retriever that
embeds it and a narrator that reads it aloud all need to know.

TWO RELATIONS, WITH DIFFERENT RULES, AND THE VALIDATOR CHECKS BOTH

  `continues_on_next_page`   rule 24  - connects blocks on DIFFERENT pages, in ASCENDING page
                                        order.
  `continues_in_next_column` rule 24b - connects blocks on the SAME page, in ascending
                                        `bbox.x0` order, with NON-OVERLAPPING x-extents.

24b is deviation D18 and it was added because the alternative is worse: without it, a two-column
paragraph either becomes one block spanning the gutter (findings.md B5.3's 4,673-character blob)
or two blocks with no recorded relationship at all.

The non-overlapping-x requirement is what makes 24b checkable, and it is also why the relation
is emitted only between blocks the layout assigned to DIFFERENT columns - two blocks in the same
column overlap in x by construction and would fail the rule.

WHY THE EVIDENCE IS TYPOGRAPHIC AND NOT SEMANTIC

A continuation is detectable without understanding the text:

  * the earlier block does not end a sentence - no terminal `.`, `?`, `!`, and no closing
    quote or bracket after one;
  * the later block does not start one - it opens lower-case, or with a lower-case word after
    an opening bracket;
  * both are ordinary body paragraphs - a heading, caption or table cell continues nothing.

Confidence is reported rather than assumed, because the signal is real but not conclusive: a
paragraph ending in "et al." looks unterminated and one beginning with "iterative" looks like a
continuation whether or not it is.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ["Continuation", "find_continuations", "looks_unterminated", "opens_mid_sentence"]

#: Sentence-final punctuation, allowing a closing quote or bracket after it.
_TERMINAL = re.compile(r"[.!?][\"'’”)\]]*\s*$")
#: An abbreviation that ends in a period WITHOUT ending a sentence. Not exhaustive and not
#: meant to be - it covers the cases dense enough in this corpus to matter.
_ABBREVIATION = re.compile(r"\b(?:et al|e\.g|i\.e|cf|vs|Fig|Eq|Tab|Sec|resp|approx)\.\s*$", re.I)
#: A block that ends mid-word carries the hyphen `text.py` proposed a repair for; that is the
#: strongest continuation signal there is.
_HYPHEN_END = re.compile(r"[-­‐]\s*$")

#: Types that can continue or be continued. A heading continues nothing.
CONTINUABLE = frozenset({"paragraph", "abstract", "footnote", "list_item"})

#: Below this the relation is not emitted at all - an uncertain guess about document structure
#: is worse than an absent one, because a consumer cannot tell the two apart.
MIN_CONFIDENCE = 0.5


@dataclass(frozen=True, slots=True)
class Continuation:
    kind: str
    """`"continues_on_next_page"` or `"continues_in_next_column"`."""
    from_index: int
    to_index: int
    confidence: float


def looks_unterminated(text: str) -> bool:
    """Whether a block's text stops mid-sentence."""
    stripped = text.rstrip()
    if not stripped:
        return False
    if _HYPHEN_END.search(stripped):
        return True
    if _ABBREVIATION.search(stripped):
        # "... reported by Vaswani et al." genuinely may end a sentence, but far more often in
        # this corpus it does not. Treated as unterminated, and the confidence reflects the doubt.
        return True
    return not _TERMINAL.search(stripped)


def opens_mid_sentence(text: str) -> bool:
    """Whether a block's text starts as a continuation rather than a new sentence."""
    stripped = text.lstrip()
    if not stripped:
        return False
    first = stripped.lstrip("([{\"'‘“")
    if not first:
        return False
    head = first[0]
    if head.islower():
        return True
    # A digit or an opening symbol is ambiguous; a capital is a new sentence.
    return not head.isupper()


def _confidence(earlier: str, later: str) -> float:
    """Coarse and stated, not calibrated - there is no gold set for continuations yet.

    0.9  the earlier block ends in a hyphen: the word itself is split, which is unambiguous
    0.8  unterminated AND opens lower-case: both signals agree
    0.6  only one signal
    """
    if _HYPHEN_END.search(earlier.rstrip()):
        return 0.9
    unterminated = looks_unterminated(earlier)
    opens = opens_mid_sentence(later)
    if unterminated and opens:
        return 0.8
    if unterminated or opens:
        return 0.6
    return 0.0


def find_continuations(
    blocks: list[tuple[int, str, str, float, float, int | None]],
) -> list[Continuation]:
    """Continuations over the body stream, in reading order.

    Each entry is `(index, block_type, text, bbox_x0, bbox_x1, page_index)` — deliberately a
    plain tuple rather than the IR `Block`, so this module stays testable without building a
    whole document and has no import cycle with assembly.
    """
    found: list[Continuation] = []
    candidates = [b for b in blocks if b[1] in CONTINUABLE and b[2].strip()]

    for earlier, later in zip(candidates, candidates[1:], strict=False):
        confidence = _confidence(earlier[2], later[2])
        if confidence < MIN_CONFIDENCE:
            continue

        earlier_page, later_page = earlier[5], later[5]
        if earlier_page is None or later_page is None:
            continue

        if later_page == earlier_page + 1:
            found.append(Continuation("continues_on_next_page", earlier[0], later[0], confidence))
        # Rule 24b: same page, ASCENDING x0, and NON-OVERLAPPING x-extents. The x test is what
        # a same-column pair fails, and it must be CHECKED rather than assumed - two blocks in
        # one column always overlap in x, so emitting on page-equality alone would produce a
        # relation the validator rejects.
        elif later_page == earlier_page and earlier[3] < later[3] and earlier[4] <= later[3]:
            found.append(Continuation("continues_in_next_column", earlier[0], later[0], confidence))
    return found
