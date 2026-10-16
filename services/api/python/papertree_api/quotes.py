"""Where a diagram part's quote is in the paper (v0.2 S7a, #216; S7a review S2, S3).

A quote is looked for in the passages THIS RUN READ only: the seed and what its ``get_passage`` /
``get_section`` calls returned, which are the run's handles (``ai_run_handles``). Never in the rest
of the paper: a quote of a passage the model never read is a memory or a coincidence, and "cited"
is the strongest label the product shows (DESIGN.md §4). A quote must also be long enough to be
evidence of anything: "the model" is in most passages and proves nothing.

  VERBATIM (shown "cited"): the quote, any datamark the model copied removed, is a substring of one
    of those passages once both are folded the way an Anchor's quote is matched
    (``normalise_for_match``: line hyphens joined, whitespace collapsed, the identity fold). The
    first such passage in handle order, the selection first.
  NEAR (shown "not verified", with that passage's Anchor): not verbatim, but the lexical checker
    the answers use says the passage supports it; of every passage that does, the one covering the
    most of the quote's content words (handle order breaks a tie), so a near copy of b6 anchors to
    b6, not to a long b1 that shares its section's vocabulary. This is a claim check, not a quote
    similarity test: word order and negation are not seen, which is why "near" is never "cited".

A quote that spans two passages (a paragraph the parser split) is verbatim in neither: at best it
is near.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from papertree_agent_tools import PaperVocabulary, content_tokens
from papertree_anchoring import IndexedDocument, normalise_for_match
from papertree_prompts import DATAMARK_SHAPE

from . import evidence

#: The contract's floor for a quote (`PartCite.quote` minLength), in code points.
MIN_QUOTE_CHARS: Final = 8
#: A quote shorter than this many words, or with fewer content words, is not evidence.
MIN_QUOTE_WORDS: Final = 3
MIN_QUOTE_CONTENT_WORDS: Final = 2
_SPACE: Final = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class Found:
    """Where a quote was found: the passage's block, and whether word for word."""

    block_id: str | None
    verbatim: bool


def clean_quote(quote: str) -> str:
    """The quote without datamark look-alikes, whitespace collapsed (what is stored and shown).

    Args:
        quote: The model's quote.

    Returns:
        The cleaned quote.
    """
    return _SPACE.sub(" ", DATAMARK_SHAPE.sub(" ", quote)).strip()


def is_evidence(quote: str) -> bool:
    """Whether a cleaned quote is long enough to show where anything comes from.

    Args:
        quote: A cleaned quote.

    Returns:
        True for at least :data:`MIN_QUOTE_CHARS` characters, :data:`MIN_QUOTE_WORDS` words and
        :data:`MIN_QUOTE_CONTENT_WORDS` content words (stopwords such as "the" do not count).
    """
    words = [word for word in quote.split() if any(ch.isalnum() for ch in word)]
    return (
        len(quote) >= MIN_QUOTE_CHARS
        and len(words) >= MIN_QUOTE_WORDS
        and len(content_tokens(quote)) >= MIN_QUOTE_CONTENT_WORDS
    )


class QuoteResolver:
    """Looks for one run's part quotes in the passages that run read (see the module docstring)."""

    def __init__(
        self,
        document: IndexedDocument | None,
        run_blocks: Sequence[str],
        texts: Mapping[str, str],
        paper: PaperVocabulary | None,
    ) -> None:
        """Builds the resolver for one run.

        Args:
            document: The anchoring document of the run's generation; None when it cannot be
                loaded (then nothing is found).
            run_blocks: The block ids the run read (its handles), in handle order.
            texts: ``block_id -> text`` of those blocks, for the lexical check.
            paper: The whole paper's vocabulary (``evidence.vocabulary_of``), or None.
        """
        self._document = document
        self._run_blocks = [
            b
            for b in dict.fromkeys(run_blocks)
            if b in texts and document is not None and b in document.by_id
        ]
        self._texts = texts
        self._paper = paper
        self._folded: dict[str, str] = {}

    def _fold(self, block_id: str) -> str:
        folded = self._folded.get(block_id)
        if folded is None:
            assert self._document is not None  # only run blocks the document holds are folded
            folded = normalise_for_match(self._document.by_id[block_id].text).text
            self._folded[block_id] = folded
        return folded

    def find(self, quote: str) -> Found:
        """Where ``quote`` is among the run's passages.

        Args:
            quote: The model's quote (cleaned or not).

        Returns:
            ``Found(block, True)`` for a verbatim match, ``Found(block, False)`` for a near one,
            ``Found(None, False)`` when it is nowhere, or too short to be evidence.
        """
        clean = clean_quote(quote)
        if not is_evidence(clean):
            return Found(None, False)
        needle = normalise_for_match(clean).text
        for block_id in self._run_blocks:
            if needle in self._fold(block_id):
                return Found(block_id, True)
        best: str | None = None
        best_coverage = -1.0
        for block_id in self._run_blocks:
            assessed = evidence.claim_assessment(clean, [block_id], self._texts, self._paper)
            if (
                assessed is not None
                and assessed.verdict == "supported"
                and assessed.coverage > best_coverage  # strictly: the earlier handle wins a tie
            ):
                best, best_coverage = block_id, assessed.coverage
        return Found(best, False)
