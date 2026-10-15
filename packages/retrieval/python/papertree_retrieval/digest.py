"""The seed of a SUMMARY run: a bounded digest of the whole paper (contracts.md §3.2, S5F).

WHY A DIGEST. A summary run used to start with nothing and read its way through the paper with the
four tools: outline first, then section after section. Live (2026-10-15, YOLO, MiniMax-M3) that was
14 tool calls and 38k input tokens, and the run ended at the tool cap with no text at all. The
whole paper is not needed to summarise it, and a model that must go and fetch each part re-reads
what the host already has. So the HOST picks the passages a summary is built from and hands them
over as the run's seed:

  * the abstract;
  * for each top-level section, its first paragraph(s) (the heading is the passage's label);
  * the conclusion (the last section whose title says conclusion, discussion or summary), whose
    first paragraphs are kept even when the budget is tight.

References, acknowledgements and appendices are not summarised: the digest stops at the first
of them.

THE BUDGET. About ``DIGEST_BUDGET_TOKENS`` (6,000) estimated tokens of what is SENT: the caller's
``cost`` is the estimate of the datamarked text, exactly as for ``build_seed``. When the digest does
not fit, the per-section allowance shrinks (900 -> 675 -> ... -> 250 characters) before any section
is dropped; sections are dropped last, from the middle of the paper outward, never the abstract,
the first section after it or the conclusion. Every passage is a whole block, or the start of one
cut at a word boundary and marked ``TEXT_TRUNCATION_MARKER``; the digest never invents or reorders
text. What was dropped is recorded in ``Digest.dropped_sections``, not hidden.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final, Literal

from papertree_retrieval.budget import DEFAULT_TOKEN_ESTIMATOR, TEXT_TRUNCATION_MARKER
from papertree_retrieval.index import IndexedSection, PaperIndex

__all__ = ["DIGEST_BUDGET_TOKENS", "Digest", "DigestPassage", "build_digest"]

#: contracts.md §3.2: "within a budget of about 6,000 estimated tokens".
DIGEST_BUDGET_TOKENS: Final = 6_000

#: Block types a digest quotes. Equations, figures, tables and captions are not prose.
PROSE_TYPES: Final = frozenset({"paragraph", "abstract", "list_item", "list"})

#: Per-section characters, from the first try down to the smallest allowance before sections go.
_ALLOWANCES: Final = (900, 675, 500, 375, 250)
#: A section's first block is always taken; more blocks are added until at least this much is held
#: (a paragraph the column break cut in two is two blocks).
_MIN_SECTION_CHARS: Final = 350
_MAX_BLOCKS_PER_SECTION: Final = 3
_MIN_WORDS: Final = 12
_ABSTRACT_CHARS: Final = 1_600
_CONCLUSION_CHARS: Final = 1_200

_SKIPPED_TITLE: Final = re.compile(
    r"^\W*(?:[0-9ivx]+[.)]?\s*)?(?:references?|bibliography|acknowledge?ments?|appendix|"
    r"appendices|supplementary|supplemental)\b",
    re.IGNORECASE,
)
_CONCLUSION_TITLE: Final = re.compile(
    r"\b(?:conclusions?|concluding|discussion|summary)\b", re.IGNORECASE
)
_ABSTRACT_TITLE: Final = re.compile(r"^\W*abstract\b", re.IGNORECASE)

Role = Literal["abstract", "section", "conclusion"]


@dataclass(frozen=True, slots=True)
class DigestPassage:
    block_id: str
    #: The block's resolved text, or its start (``truncated``).
    text: str
    role: Role
    truncated: bool
    #: ``cost(text)`` as it was spent.
    tokens: int


@dataclass(frozen=True, slots=True)
class Digest:
    passages: tuple[DigestPassage, ...]
    total_tokens: int
    budget_tokens: int
    #: The per-section character allowance that fit the budget.
    allowance: int
    #: Headings (block ids) of top-level sections that did not fit, in paper order.
    dropped_sections: tuple[str, ...]

    @property
    def block_ids(self) -> tuple[str, ...]:
        return tuple(passage.block_id for passage in self.passages)


def _raw_cost(text: str) -> int:
    return DEFAULT_TOKEN_ESTIMATOR.estimate(text)


def _clip(text: str, limit: int) -> tuple[str, bool]:
    """``text`` cut at a word boundary to at most ``limit`` characters, plus the marker."""
    flat = text.strip()
    if len(flat) <= limit:
        return flat, False
    cut = flat.rfind(" ", 0, limit)
    cut = cut if cut >= limit // 2 else limit
    return flat[:cut].rstrip() + TEXT_TRUNCATION_MARKER, True


def _prose(index: PaperIndex, block_ids: tuple[str, ...]) -> list[str]:
    """The section's quotable prose: blocks of a prose type with at least ``_MIN_WORDS`` words (a
    figure panel's label, a stray table row and a bullet stub are blocks of the paragraph type
    too, and are not what a section says)."""
    out: list[str] = []
    for block_id in sorted(dict.fromkeys(block_ids), key=index.rank):
        block = index.block(block_id)
        if (
            block is not None
            and block.type in PROSE_TYPES
            and len(block.text.split()) >= _MIN_WORDS
        ):
            out.append(block_id)
    return out


def _title(index: PaperIndex, section: IndexedSection) -> str:
    heading = index.block(section.heading_block_id)
    return heading.text.strip() if heading is not None else ""


def _first_prose(index: PaperIndex, section: IndexedSection) -> list[str]:
    """The section's own prose, else the first prose of its first sub-section that has any."""
    own = _prose(index, section.block_ids)
    if own:
        return own
    for child in index.sections:
        if child.parent_heading_block_id == section.heading_block_id:
            nested = _first_prose(index, child)
            if nested:
                return nested
    return []


def _take(
    index: PaperIndex, candidates: list[str], limit: int, role: Role
) -> list[tuple[str, str, Role, bool]]:
    """Whole blocks from the front of ``candidates`` until ``_MIN_SECTION_CHARS`` are held, the
    last one cut so that the total stays within ``limit`` characters."""
    out: list[tuple[str, str, Role, bool]] = []
    held = 0
    floor = min(_MIN_SECTION_CHARS, limit)
    for block_id in candidates[:_MAX_BLOCKS_PER_SECTION]:
        if out and held >= floor:
            break
        block = index.block(block_id)
        assert block is not None
        text, truncated = _clip(block.text, limit - held)
        if not text:
            break
        out.append((block_id, text, role, truncated))
        held += len(text)
        if held >= limit:
            break
    return out


def build_digest(
    index: PaperIndex,
    *,
    budget_tokens: int = DIGEST_BUDGET_TOKENS,
    cost: Callable[[str], int] = _raw_cost,
) -> Digest:
    """The digest passages of ``index`` within ``budget_tokens``, in reading order.

    Raises ``ValueError`` for a budget below 1. A paper with no recognisable structure (no
    sections, no abstract) gets its first prose blocks as a single unnamed run, so the digest is
    never empty for a paper that has any prose.
    """
    if budget_tokens < 1:
        raise ValueError(f"budget_tokens must be >= 1, got {budget_tokens}")
    sections = [s for s in index.sections if s.heading_block_id in index]
    top_level = min((s.level for s in sections), default=1)
    top = [s for s in sections if s.level == top_level]

    abstract_blocks = [
        b
        for b in index.reading_order
        if (block := index.block(b)) is not None
        and block.type == "abstract"
        and index.is_top_level(b)
        and len(block.text.split()) >= _MIN_WORDS
    ]
    body: list[IndexedSection] = []
    for section in top:
        title = _title(index, section)
        if _ABSTRACT_TITLE.match(title):
            if not abstract_blocks:
                abstract_blocks = _prose(index, section.block_ids)
            continue
        if _SKIPPED_TITLE.match(title):
            break  # references, acknowledgements, appendices: back matter from here on
        body.append(section)
    conclusion = next(
        (s for s in reversed(body) if _CONCLUSION_TITLE.search(_title(index, s))), None
    )

    def plan(allowance: int, keep: list[IndexedSection]) -> list[tuple[str, str, Role, bool]]:
        planned: list[tuple[str, str, Role, bool]] = []
        if abstract_blocks:
            planned += _take(
                index, abstract_blocks, min(_ABSTRACT_CHARS, allowance * 2), "abstract"
            )
        for section in keep:
            is_conclusion = section is conclusion
            role: Role = "conclusion" if is_conclusion else "section"
            limit = max(allowance, _CONCLUSION_CHARS if is_conclusion else 0)
            planned += _take(index, _first_prose(index, section), limit, role)
        return planned

    if not abstract_blocks and not body:
        # No structure at all: the first prose blocks of the document stand in for a digest.
        loose = [
            b
            for b in index.reading_order
            if index.is_top_level(b)
            and (block := index.block(b)) is not None
            and block.type in PROSE_TYPES
            and len(block.text.split()) >= _MIN_WORDS
        ]
        planned = _take(index, loose, _ABSTRACT_CHARS, "section")
        used = 0
        passages = []
        for block_id, text, role, truncated in planned:
            spent = cost(text)
            if used + spent > budget_tokens:
                break
            passages.append(DigestPassage(block_id, text, role, truncated, spent))
            used += spent
        return Digest(tuple(passages), used, budget_tokens, _ABSTRACT_CHARS, ())

    keep = list(body)
    for allowance in _ALLOWANCES:
        planned = plan(allowance, keep)
        total = sum(cost(text) for _b, text, _r, _t in planned)
        if total <= budget_tokens:
            break
    else:
        # Even the smallest allowance is over budget: drop sections, from the middle outward.
        protected = {id(s) for s in (body[:1] + ([conclusion] if conclusion is not None else []))}
        while True:
            planned = plan(_ALLOWANCES[-1], keep)
            total = sum(cost(text) for _b, text, _r, _t in planned)
            droppable = [s for s in keep if id(s) not in protected]
            if total <= budget_tokens or not droppable:
                break
            keep.remove(droppable[len(droppable) // 2])
        allowance = _ALLOWANCES[-1]
    dropped = tuple(s.heading_block_id for s in body if s not in keep)

    passages = []
    used = 0
    for block_id, text, role, truncated in planned:
        spent = cost(text)
        if used + spent > budget_tokens and passages:
            continue  # only reachable if the protected core alone is over budget
        passages.append(DigestPassage(block_id, text, role, truncated, spent))
        used += spent
    return Digest(tuple(passages), used, budget_tokens, allowance, dropped)
