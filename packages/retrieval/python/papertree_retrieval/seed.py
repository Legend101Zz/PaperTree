"""The seed of an explain or ask run: the selected blocks FIRST, then the structure-aware expansion,
under a budget of at most 3,000 estimated tokens (contracts.md §3.2).

WHAT IT FIXES. The baseline answer opened with the paper's title and authors (QUOTED, journey
baseline): the old evidence package spent its first component on the outline, so the first text
the model read was the front matter. Here the passages are, in order:

  1. the SELECTED blocks, in reading order — always included, and the only ones ever cut: a
     selected block too long for the whole budget is trimmed AROUND the selected text (``focus``),
     never from the top, so the sentence the reader asked about is always in what the model reads;
  2. then every other block ``expand`` reaches (parents, section, neighbours, relations,
     citations), in ladder order, each WHOLE or not at all. A block that does not fit is skipped
     and a smaller later one may still fit; every skipped id is recorded in ``Seed.dropped``.

THE BUDGET IS COUNTED ON WHAT IS SENT. ``cost`` is the caller's: the API passes the estimate of
the DATAMARKED text, because that is what the agent receives and ``papertree_prompts``' own
measurement is that marking costs 2.6x (a 9.6x for a caption with its wrapper), so a budget on raw
text would overrun by that factor on exactly the passages that are sent. The default, for callers
with no marking, is the raw estimate. Either way the number is ``AtomTokenEstimator``'s: an upper
bound on a byte-level BPE's count, not a MiniMax invoice (``budget.py``).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

from papertree_retrieval.budget import DEFAULT_TOKEN_ESTIMATOR, TEXT_TRUNCATION_MARKER
from papertree_retrieval.expansion import (
    DEFAULT_EXPANSION_POLICY,
    ExpansionPolicy,
    Stage,
    expand,
)
from papertree_retrieval.index import PaperIndex

__all__ = ["SEED_BUDGET_TOKENS", "Seed", "SeedPassage", "build_seed"]

#: contracts.md §3.2: "under a budget of <= 3,000 estimated tokens".
SEED_BUDGET_TOKENS: Final = 3_000

#: How much text before the focus a trimmed selected block keeps, so the model reads the sentence
#: with its lead-in rather than starting mid-word at the quote.
_LEAD_IN_CHARS: Final = 240
_ELLIPSIS: Final = "…"


@dataclass(frozen=True, slots=True)
class SeedPassage:
    block_id: str
    #: The block's resolved text, or a trimmed window of it (``truncated``).
    text: str
    stage: Stage
    #: ``expand``'s provenance string: ``selected``, ``parent``, ``adjacent:-1``, …
    reason: str
    #: ``cost(text)`` as it was spent.
    tokens: int
    truncated: bool = False


@dataclass(frozen=True, slots=True)
class Seed:
    passages: tuple[SeedPassage, ...]
    total_tokens: int
    budget_tokens: int
    #: Blocks the ladder reached that did not fit, in ladder order.
    dropped: tuple[str, ...]

    @property
    def block_ids(self) -> tuple[str, ...]:
        return tuple(passage.block_id for passage in self.passages)


def _raw_cost(text: str) -> int:
    return DEFAULT_TOKEN_ESTIMATOR.estimate(text)


def build_seed(
    index: PaperIndex,
    selection: Sequence[str],
    *,
    focus: str | None = None,
    budget_tokens: int = SEED_BUDGET_TOKENS,
    cost: Callable[[str], int] = _raw_cost,
    policy: ExpansionPolicy = DEFAULT_EXPANSION_POLICY,
) -> Seed:
    """The seed passages for ``selection`` (block ids of ``index``), within ``budget_tokens``.

    ``focus`` is the exact selected text: when a selected block must be trimmed, the window is
    placed so it contains the focus. Raises ``KeyError`` when no selected id is in the index (the
    same refusal ``expand`` makes) and ``ValueError`` for an empty selection or a budget below 1.
    """
    if budget_tokens < 1:
        raise ValueError(f"budget_tokens must be >= 1, got {budget_tokens}")
    expansion = expand(index, selection, policy, None)
    passages: list[SeedPassage] = []
    dropped: list[str] = []
    total = 0
    for block in expansion.blocks:
        if not block.text.strip():
            continue
        spend = cost(block.text)
        if block.stage is Stage.SELECTION:
            if total + spend > budget_tokens:
                text = _trim_to_fit(block.text, focus, budget_tokens - total, cost)
                if text is None:
                    dropped.append(block.block_id)
                    continue
                spend = cost(text)
                passages.append(
                    SeedPassage(block.block_id, text, block.stage, block.reason, spend, True)
                )
            else:
                passages.append(
                    SeedPassage(block.block_id, block.text, block.stage, block.reason, spend)
                )
            total += spend
            continue
        if total + spend > budget_tokens:
            dropped.append(block.block_id)
            continue
        passages.append(SeedPassage(block.block_id, block.text, block.stage, block.reason, spend))
        total += spend
    return Seed(tuple(passages), total, budget_tokens, tuple(dropped))


def _trim_to_fit(
    text: str, focus: str | None, allowance: int, cost: Callable[[str], int]
) -> str | None:
    """The longest window of ``text`` that costs at most ``allowance`` and CONTAINS ``focus``
    (as much of it as fits), cut at whitespace and marked at each cut end. None when not even one
    word fits.

    The window starts up to ``_LEAD_IN_CHARS`` before the focus; if that start leaves no room to
    reach the end of the focus, the lead-in shrinks (240, 120, 60, 0 characters) until it does.
    """
    at = _find(text, focus) if focus else 0
    focus_end = at + len(focus) if focus else 0
    best: str | None = None
    for lead in (_LEAD_IN_CHARS, _LEAD_IN_CHARS // 2, _LEAD_IN_CHARS // 4, 0):
        start = _word_start(text, max(0, at - lead))
        window = _longest_fitting(text, start, allowance, cost)
        if window is None:
            continue
        candidate, end = window
        if best is None:
            best = candidate
        if end >= focus_end or start >= at:
            return candidate
    return best


def _word_start(text: str, index: int) -> int:
    """``index`` moved back to the start of the word it falls in."""
    if index <= 0:
        return 0
    cut = text.rfind(" ", 0, index + 1)
    newline = text.rfind("\n", 0, index + 1)
    cut = max(cut, newline)
    return cut + 1 if cut >= 0 else 0


def _longest_fitting(
    text: str, start: int, allowance: int, cost: Callable[[str], int]
) -> tuple[str, int] | None:
    """The longest whole-word window from ``start`` whose marked rendering fits, and where it
    ends in ``text``."""
    words = text[start:].split(" ")
    prefix = _ELLIPSIS if start > 0 else ""
    low, high, best = 1, len(words), None
    while low <= high:
        middle = (low + high) // 2
        body = " ".join(words[:middle])
        candidate = prefix + body + ("" if middle == len(words) else TEXT_TRUNCATION_MARKER)
        if cost(candidate) <= allowance:
            best, low = (candidate, start + len(body)), middle + 1
        else:
            high = middle - 1
    return best


def _find(text: str, focus: str) -> int:
    """Where ``focus`` starts in ``text``, comparing with whitespace collapsed; 0 if absent."""
    at = text.find(focus)
    if at >= 0:
        return at
    words = focus.split()
    if not words:
        return 0
    at = text.find(words[0])
    return max(at, 0)
