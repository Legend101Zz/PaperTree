"""F3.2 — the structure-aware expansion ladder. Acceptance: ``retrieval/expansion.spec``.

    direct selection
      -> parent/child expansion      (parent_id / child_ids, and the parent SECTION)
      -> adjacent reading-order      (per-page flows; prev_id/next_id when a parser sets them)
      -> equation/figure relations   (defines, explains, caption_of, visually_associated_with,
                                      result_of, references — and unknown types PRESERVED)
      -> citations                   (cites, references -> reference_entry blocks)
      -> semantic (sqlite-vec)       (LAST, and opt-in — see "SEMANTIC IS NOT A DEFAULT")
      -> optional region crop

── WHY A LADDER AND NOT A VECTOR INDEX ─────────────────────────────────────────────────────────

EPIC-03 §4: "Retrieval is structure-aware first, semantic second. Measure the delta before adding
vector search — do not assume embeddings help." That is not a stylistic preference, and this
module is built so the instruction is CHECKABLE rather than merely honoured in prose:

  * the six structural rungs read nothing but ``blocks``, ``relations`` and ``papers.sections``.
    ``tests/test_expansion.py`` asserts a full expansion on a paper with ``count_block_vectors``
    == 0, so a structural path that had quietly grown an embedding dependency fails rather than
    degrades;
  * the semantic rung is reached only when the caller passes a ``SemanticQuery``. There is no
    default. ``expand`` takes ``semantic`` as a REQUIRED parameter whose value may be ``None``,
    so "should this question use vectors?" is a decision somebody wrote down, not a default
    somebody inherited. (Epic 2's post-mortem: four of five unreachable-feature defects involved
    an optional argument, and none would have survived being mandatory.)

WHAT IS HONESTLY NOT MEASURED. There is no embedding model in this repository. Epic 0 computes no
embeddings — ``put_block_vector``'s own docstring says so — and producing real ones needs either a
network call or a new runtime dependency, both forbidden here. So the structural-vs-semantic delta
that the epic asks for is measured in ``tests/test_semantic_delta.py`` against DETERMINISTIC
SYNTHETIC VECTORS, which measures the PLUMBING (does the rung fire, does it add blocks the
structural rungs missed, is the ordering stable) and measures NOTHING about whether real
embeddings help. The real-model delta is NOT MEASURED and is reported as NOT MEASURED. Inventing a
number for it would be the failure mode AGENTS.md §2 exists to prevent.

── DETERMINISM, WHICH IS AN ACCEPTANCE CRITERION AND NOT AN ASPIRATION ─────────────────────────

``retrieval/expansion.spec`` requires byte-identical output ordering for identical input. Three
rules deliver it and all three are load-bearing:

  1. NO SET'S ITERATION ORDER REACHES A RESULT. Sets appear here only as membership tests
     (``in``); the single set comprehension in the package, ``index.py``'s page list, is consumed
     by ``sorted()`` on the same line. Python's set iteration order depends on insertion history
     and on hash randomisation of ``str`` — which is ON by default (PYTHONHASHSEED unset), so a
     set-ordered result would differ between two PROCESSES while looking perfectly stable inside
     one test run. That is the worst shape a determinism bug can have: green locally, green in
     CI, wrong in production, and ``test_expansion.py`` runs two subprocesses to catch it.
  2. EVERY RUNG SORTS BY AN EXPLICIT TOTAL KEY ending in the block id. Reading-order rank is the
     primary key almost everywhere; ties below it are broken by id, which is unique per paper
     generation by primary key.
  3. A BLOCK BELONGS TO EXACTLY ONE RUNG — the first that reaches it. Rungs run in ladder order,
     so "which rung claimed this block" is a function of the input alone. The rung is recorded on
     the block, so "why is this in my prompt" always has one answer.

── THE OPEN RELATION VOCABULARY ────────────────────────────────────────────────────────────────

``Relation.type`` is OPEN: any string matching ``^[a-z][a-z0-9_]{0,63}$`` is valid, and DESIGN.md
D2 requires that an unknown type be PRESERVED, never dropped. ``is_known_relation_type`` is
therefore used here as a SORT KEY and never as a filter — known types come first, in the epic's
declared order, and everything else follows sorted by type name. A relation type invented by a
future parser is followed exactly like a known one and reaches the caller labelled with its own
name. ``tests/test_expansion.py`` asserts this with a type no version of this schema has heard of.

── WHAT THE PARSER ACTUALLY EMITS, WHICH IS LESS THAN THE VOCABULARY SUGGESTS ──────────────────

Measured on this machine, 2026-08-02, generation 1, `services/document-worker` at its current
commit:

    resnet-cvpr-2col      caption_of 7    continues_in_next_column 9   continues_on_next_page 9
    neural-odes           caption_of 9    continues_in_next_column 2   continues_on_next_page 7
    attention/bert        same three types, no others

Three of twelve known types, and NONE of ``cites``, ``references``, ``defines``, ``explains``,
``result_of``, ``footnote_of`` or ``parent_of``. Two consequences were designed around rather than
discovered later:

  * the relation rung would return figures-from-captions and nothing else, so it also walks
    relations in BOTH directions (a figure reached from its caption, and a caption reached from
    its figure) and treats continuation edges as relations rather than as adjacency;
  * the citation rung would be permanently dead code — the exact failure findings.md §A records
    (1,698 lines of extraction with zero importers). It therefore has a documented FALLBACK: when
    no ``cites``/``references`` edge exists, bracketed numeric markers in the selection's own text
    (``[41]``, ``[22, 21]`` — 28 such paragraphs on resnet, 20 on attention) are matched against
    the label each ``reference_entry`` block prints. Every hit is labelled
    ``reason="cited-label:[41]"`` so a caller can tell an inferred citation from a parsed one, and
    author-year bibliographies (bert-2col: 29 entries, zero brackets) simply yield nothing.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final

from papertree_document_ir import is_known_relation_type

from papertree_retrieval.index import IndexedRelation, PaperIndex

__all__ = [
    "CITATION_RELATION_TYPES",
    "DEFAULT_EXPANSION_POLICY",
    "DEFAULT_REGION_TYPES",
    "KNOWN_RELATION_ORDER",
    "RELATED_RELATION_TYPES",
    "STAGE_ORDER",
    "Expansion",
    "ExpansionPolicy",
    "RegionRequest",
    "RetrievedBlock",
    "SemanticQuery",
    "Stage",
    "expand",
]


class Stage(StrEnum):
    """The rungs, in ladder order. A block is attributed to exactly one."""

    SELECTION = "selection"
    #: parent_id / child_ids, plus the parent SECTION and the outline path to it.
    STRUCTURE = "structure"
    ADJACENT = "adjacent"
    #: equation/figure relations, in both directions, including unknown types.
    RELATED = "related"
    CITATIONS = "citations"
    SEMANTIC = "semantic"


#: Ladder order, as a tuple, because a ``StrEnum``'s ``__members__`` order is an implementation
#: detail and the budget assembler in ``budget.py`` spends against this exact sequence.
STAGE_ORDER: Final[tuple[Stage, ...]] = (
    Stage.SELECTION,
    Stage.STRUCTURE,
    Stage.ADJACENT,
    Stage.RELATED,
    Stage.CITATIONS,
    Stage.SEMANTIC,
)

#: The 12 known relation types, verbatim and in the order ADR-001 declares them. Used ONLY to
#: rank relation types deterministically — never to filter one out. See the module docstring.
KNOWN_RELATION_ORDER: Final[tuple[str, ...]] = (
    "parent_of",
    "next_in_reading_order",
    "caption_of",
    "references",
    "defines",
    "explains",
    "result_of",
    "footnote_of",
    "continues_on_next_page",
    "continues_in_next_column",
    "visually_associated_with",
    "cites",
)

#: Types the CITATION rung owns. Everything else that is not structural belongs to RELATED.
CITATION_RELATION_TYPES: Final[frozenset[str]] = frozenset({"cites"})

#: Types the RELATED rung follows by name. ``references`` appears in BOTH this set and the
#: citation rung's handling because the vocabulary overloads it: "see Figure 2" and "see [41]"
#: are the same edge type pointing at different kinds of block. The rung that claims a particular
#: edge is decided by the TARGET's block type, not by the edge name alone — see ``_related``.
RELATED_RELATION_TYPES: Final[frozenset[str]] = frozenset(
    {
        "caption_of",
        "references",
        "defines",
        "explains",
        "result_of",
        "footnote_of",
        "visually_associated_with",
        "continues_on_next_page",
        "continues_in_next_column",
        "next_in_reading_order",
    }
)

#: Block types that a citation edge may legitimately land on.
_REFERENCE_BLOCK_TYPES: Final[frozenset[str]] = frozenset({"reference_entry"})

#: Block types worth asking for a rendered region of. Open-vocabulary safe: an unrecognised type
#: simply does not get a crop, which is the harmless direction.
DEFAULT_REGION_TYPES: Final[frozenset[str]] = frozenset(
    {"figure", "diagram", "plot", "table", "equation", "algorithm"}
)

#: ``[41]`` or ``[22, 21]`` or ``[21,\n50, 40]`` — the in-prose citation markers a numeric
#: bibliography prints. Deliberately narrow: digits, commas, whitespace and the two dash
#: characters that appear in ranges, and nothing else, so ``[MASK]`` and ``[CLS]`` (which occur
#: throughout bert-2col) are not mistaken for citations.
_CITATION_MARKER = re.compile(r"\[(\d[\d,\s–-]*)\]")


@dataclass(frozen=True, slots=True)
class SemanticQuery:
    """The opt-in semantic rung. Every field is required; there is no default query.

    ``embedding`` must be 768-dimensional — the width ``block_vectors`` declares in
    0001_core.sql — and ``papertree_db.to_vector_blob`` raises if it is not. ``model`` is carried
    so a caller can record WHICH embedding space the hits came from; mixing two models in one
    partition produces distances that are arithmetically fine and semantically meaningless, and
    the only defence available is writing down which model asked.
    """

    embedding: Sequence[float]
    k: int
    model: str


@dataclass(frozen=True, slots=True)
class ExpansionPolicy:
    """Every bound the ladder obeys. Passed explicitly; see ``DEFAULT_EXPANSION_POLICY``.

    The defaults are sized against what the evidence package can actually afford rather than
    against what is interesting: ``budget.py`` gives the structure component 1,500 tokens and a
    median corpus paragraph estimates at ~120 (measured over resnet's 98 paragraphs), so a
    section-sibling limit above ~8 buys blocks that the budget will only drop again. Retrieving
    what will be discarded is not free — it is the difference between "we chose not to include
    this" and "we never looked", and only the first is recoverable by raising a budget.
    """

    #: How far up ``parent_id`` to walk from a selected block. 2 covers table_cell -> row -> table.
    parent_depth: int = 2
    #: Children of a selected block. A ResNet table has 342 cells (findings.md §H2), so this is a
    #: cap that WILL bind, and it binds on the first ``"order"`` values rather than an arbitrary
    #: subset.
    child_limit: int = 12
    #: Blocks taken from the selection's own section, nearest in reading order first.
    section_sibling_limit: int = 6
    #: Neighbours each side, per selected block.
    adjacent_radius: int = 2
    related_limit: int = 12
    citation_limit: int = 8
    semantic_limit: int = 8
    region_types: frozenset[str] = DEFAULT_REGION_TYPES
    include_regions: bool = True
    #: Follow relation types this schema version has never heard of. Default ON: DESIGN.md D2
    #: requires unknown types to be preserved, and a caller who turns this off is choosing to
    #: drop information and has to say so.
    follow_unknown_relation_types: bool = True
    #: Infer citations from bracketed markers when no ``cites`` edge exists. See the module
    #: docstring's fallback note; hits are labelled distinctly either way.
    infer_citation_labels: bool = True

    def __post_init__(self) -> None:
        for name in (
            "parent_depth",
            "child_limit",
            "section_sibling_limit",
            "adjacent_radius",
            "related_limit",
            "citation_limit",
            "semantic_limit",
        ):
            value = getattr(self, name)
            if value < 0:
                raise ValueError(f"{name} must be >= 0, got {value}")


#: The policy the epic's budgets were sized for. A module constant rather than a default argument
#: so that "which policy ran?" is answerable from a stack trace and a caller can diff against it.
DEFAULT_EXPANSION_POLICY: Final = ExpansionPolicy()


@dataclass(frozen=True, slots=True)
class RetrievedBlock:
    """One block the ladder reached, with the rung that reached it and why.

    ``reason`` is a short machine-readable provenance string, not prose, and it is what makes the
    evidence package auditable: ``"selected"``, ``"parent"``, ``"child"``, ``"section-heading"``,
    ``"section-sibling"``, ``"adjacent:-1"``, ``"caption_of<-blk_x"``, ``"cites->blk_y"``,
    ``"cited-label:[41]"``, ``"vector"``. Answering "why is this block in the prompt" from data
    rather than from a log line is the same requirement F3.3 puts on truncation.
    """

    block_id: str
    stage: Stage
    reason: str
    page_index: int
    type: str
    flow: str
    text: str
    #: How many ``applied=false`` repairs this block carries. Non-zero means the quotation is
    #: text somebody has already proposed a correction to; the evidence package says so.
    proposed_repairs: int
    #: sqlite-vec distance for ``Stage.SEMANTIC`` hits, ``None`` everywhere else.
    distance: float | None = None


@dataclass(frozen=True, slots=True)
class RegionRequest:
    """A request for a rendered crop — data, not pixels.

    This package does not render. ``services/document-worker``'s ``CropStore`` owns rasterisation
    and owns the measured scale constant; duplicating either here would create the second
    representation that DESIGN.md's whole structure exists to prevent. What the ladder produces is
    the ADDRESS of the region, which is exactly what the F3.1 tool ``crop_pdf_region`` takes.
    """

    block_id: str
    page_index: int
    type: str
    bbox: tuple[float, float, float, float]


@dataclass(frozen=True, slots=True)
class Expansion:
    """The ladder's output. Ordered, deduplicated, and attributable rung by rung."""

    paper_id: str
    generation: int
    selection: tuple[str, ...]
    #: Every retrieved block, once, in ladder order then within-rung order.
    blocks: tuple[RetrievedBlock, ...]
    regions: tuple[RegionRequest, ...]
    #: Whether the caller asked for the semantic rung at all. ``False`` is the structural-only
    #: run, and is what ``tests/test_semantic_delta.py`` compares against.
    semantic_requested: bool
    #: ``count_block_vectors`` at expansion time. Reported so "semantic found nothing" and
    #: "there were no vectors to search" are distinguishable in the result rather than only in a
    #: debugger — they are the same empty list otherwise.
    vector_count: int
    #: Blocks the ladder reached but the policy's per-rung caps excluded, per rung. Retrieval
    #: truncation is recorded for the same reason budget truncation is: silently returning 12 of
    #: 342 table cells is a decision, and a decision nobody can see is indistinguishable from a
    #: bug.
    capped: tuple[tuple[Stage, int], ...] = field(default_factory=tuple)

    def by_stage(self, stage: Stage) -> tuple[RetrievedBlock, ...]:
        return tuple(block for block in self.blocks if block.stage is stage)

    @property
    def block_ids(self) -> tuple[str, ...]:
        return tuple(block.block_id for block in self.blocks)


class _Accumulator:
    """Collects blocks rung by rung, first-claim-wins, with no set ever iterated."""

    __slots__ = ("_capped", "_claimed", "_index", "_out")

    def __init__(self, index: PaperIndex) -> None:
        self._index = index
        self._out: list[RetrievedBlock] = []
        self._claimed: set[str] = set()
        self._capped: dict[Stage, int] = {}

    def claimed(self, block_id: str) -> bool:
        return block_id in self._claimed

    def add(
        self, block_id: str, stage: Stage, reason: str, *, distance: float | None = None
    ) -> bool:
        """Records ``block_id`` under ``stage``. Returns False when it was already claimed."""
        if block_id in self._claimed:
            return False
        block = self._index.block(block_id)
        if block is None:
            return False
        self._claimed.add(block_id)
        self._out.append(
            RetrievedBlock(
                block_id=block.block_id,
                stage=stage,
                reason=reason,
                page_index=block.page_index,
                type=block.type,
                flow=block.flow,
                text=block.text,
                proposed_repairs=block.proposed_repairs,
                distance=distance,
            )
        )
        return True

    def cap(self, stage: Stage, dropped: int) -> None:
        if dropped > 0:
            self._capped[stage] = self._capped.get(stage, 0) + dropped

    def count(self) -> int:
        return len(self._out)

    def blocks(self) -> tuple[RetrievedBlock, ...]:
        return tuple(self._out)

    def capped(self) -> tuple[tuple[Stage, int], ...]:
        return tuple((stage, self._capped[stage]) for stage in STAGE_ORDER if stage in self._capped)


def expand(
    index: PaperIndex,
    selection: Sequence[str],
    policy: ExpansionPolicy,
    semantic: SemanticQuery | None,
) -> Expansion:
    """Runs the ladder over ``selection`` and returns a deterministic, deduplicated expansion.

    ``policy`` and ``semantic`` are REQUIRED — pass ``DEFAULT_EXPANSION_POLICY`` and ``None`` to
    get the structural-only default. Neither has a default value on purpose: this is the function
    where "we accidentally ran vector search on every question" and "we accidentally retrieved 342
    table cells" would both be one forgotten keyword away.

    ``selection`` must be non-empty and must name blocks in ``index``. A selection of ids that are
    all unknown raises ``KeyError`` rather than returning an empty expansion, because an evidence
    package assembled around nothing at all looks, to the model, exactly like a paper with nothing
    in it.
    """
    if not selection:
        raise ValueError("selection must name at least one block")
    ordered_selection = tuple(
        sorted(
            dict.fromkeys(block_id for block_id in selection if block_id in index),
            key=lambda block_id: (index.rank(block_id), block_id),
        )
    )
    if not ordered_selection:
        raise KeyError(f"none of the selected blocks exist in {index.paper_id}: {list(selection)}")

    acc = _Accumulator(index)
    for block_id in ordered_selection:
        acc.add(block_id, Stage.SELECTION, "selected")

    # Computed BEFORE the structure rung, and handed to it as a reservation. Section siblings are
    # sorted by proximity in reading order, so without this the nearest one or two are ALWAYS the
    # immediate neighbours and the adjacency rung is left with scraps. That is not merely an
    # attribution quibble: budgets are per component and are deliberately not reallocated
    # (budget.py), so the immediate neighbours would compete for the structure component's 1,500
    # tokens while the adjacency component's 1,300 went unspent. The reservation makes the two
    # rungs disjoint by construction rather than by luck.
    adjacency = _adjacent_targets(index, ordered_selection, policy)
    reserved = frozenset(block_id for block_id, _reason in adjacency)

    _structure(index, ordered_selection, policy, acc, reserved)
    _adjacent(adjacency, acc)
    _related(index, ordered_selection, policy, acc)
    _citations(index, ordered_selection, policy, acc)
    if semantic is not None:
        _semantic(index, policy, semantic, acc)

    blocks = acc.blocks()
    regions = _regions(index, blocks, policy) if policy.include_regions else ()
    return Expansion(
        paper_id=str(index.paper_id),
        generation=int(index.generation),
        selection=ordered_selection,
        blocks=blocks,
        regions=regions,
        semantic_requested=semantic is not None,
        vector_count=index.vector_count,
        capped=acc.capped(),
    )


# ── rung 2: parent / child / section ─────────────────────────────────────────────────────────


def _structure(
    index: PaperIndex,
    selection: Sequence[str],
    policy: ExpansionPolicy,
    acc: _Accumulator,
    reserved_for_adjacency: frozenset[str],
) -> None:
    """Parents, children, the parent section's heading path, and the section's own blocks.

    Order within the rung, and it is deliberate: the OUTLINE first (headings, outermost first),
    then ancestors, then children, then section siblings. A model reading the package top-down
    meets "where in the paper am I" before "what is next to me", and the outline costs a few dozen
    tokens against the section siblings' several hundred — so when the structure budget binds, the
    part that survives is the part that orients.

    ``reserved_for_adjacency`` is skipped by the SECTION-SIBLING step only. A heading that is also
    an immediate neighbour is still claimed here, because "this is the heading of your section" is
    a strictly more informative statement than "this is the block before yours" and only one
    reason can be recorded per block.
    """
    for block_id in selection:
        section = index.section_of(block_id)
        if section is None:
            # NORMAL: front matter is deliberately section-less (title, authors, abstract).
            continue
        for ancestor in index.section_path(section):
            reason = (
                "section-heading"
                if ancestor.heading_block_id == section.heading_block_id
                else "outline-heading"
            )
            acc.add(ancestor.heading_block_id, Stage.STRUCTURE, reason)

    for block_id in selection:
        for depth, parent_id in enumerate(index.parents(block_id, policy.parent_depth), start=1):
            acc.add(parent_id, Stage.STRUCTURE, f"parent:{depth}")

    for block_id in selection:
        children = index.children(block_id)
        for child_id in children[: policy.child_limit]:
            acc.add(child_id, Stage.STRUCTURE, "child")
        acc.cap(Stage.STRUCTURE, max(0, len(children) - policy.child_limit))

    for block_id in selection:
        section = index.section_of(block_id)
        if section is None:
            continue
        anchor = index.rank(block_id)
        candidates = sorted(
            (
                sibling
                for sibling in section.block_ids
                if sibling in index and sibling not in reserved_for_adjacency
            ),
            key=lambda sibling: (abs(index.rank(sibling) - anchor), index.rank(sibling), sibling),
        )
        taken = 0
        for sibling in candidates:
            if taken >= policy.section_sibling_limit:
                break
            if acc.add(sibling, Stage.STRUCTURE, "section-sibling"):
                taken += 1
        acc.cap(Stage.STRUCTURE, max(0, len(candidates) - policy.section_sibling_limit))


# ── rung 3: adjacent reading order ───────────────────────────────────────────────────────────


def _adjacent_targets(
    index: PaperIndex, selection: Sequence[str], policy: ExpansionPolicy
) -> tuple[tuple[str, str], ...]:
    """``(block_id, reason)`` for every neighbour, nearest first, before and after INTERLEAVED.

    Interleaved rather than "all the before ones, then all the after ones" so that when the
    adjacency budget binds, what survives is a symmetric window around the selection instead of a
    lopsided one — a truncated package that keeps two paragraphs before and none after reads as
    though the selection ended the section.

    Pure: it adds nothing. ``expand`` calls it before the structure rung so the ids can be reserved,
    and ``_adjacent`` then consumes the same tuple, so the two rungs cannot disagree about what
    adjacency means.
    """
    out: list[tuple[str, str]] = []
    for block_id in selection:
        before, after = index.adjacent(block_id, policy.adjacent_radius)
        for offset in range(1, policy.adjacent_radius + 1):
            if offset <= len(before):
                out.append((before[offset - 1], f"adjacent:-{offset}"))
            if offset <= len(after):
                out.append((after[offset - 1], f"adjacent:+{offset}"))
    return tuple(out)


def _adjacent(targets: Sequence[tuple[str, str]], acc: _Accumulator) -> None:
    for block_id, reason in targets:
        acc.add(block_id, Stage.ADJACENT, reason)


# ── rung 4: equation / figure relations ──────────────────────────────────────────────────────


def _relation_sort_key(relation: IndexedRelation, endpoint: str) -> tuple[int, str, str, str]:
    """Known types in ADR-001's declared order, then unknown types alphabetically.

    ``is_known_relation_type`` is consulted HERE and only here, and only to produce a rank. An
    unknown type sorts after every known one and is otherwise treated identically — that is what
    "preserved, never dropped" means operationally.
    """
    if relation.type in KNOWN_RELATION_ORDER:
        rank = KNOWN_RELATION_ORDER.index(relation.type)
    elif is_known_relation_type(relation.type):  # pragma: no cover - defensive
        rank = len(KNOWN_RELATION_ORDER)
    else:
        rank = len(KNOWN_RELATION_ORDER) + 1
    return (rank, relation.type, endpoint, relation.provenance)


def _related(
    index: PaperIndex, selection: Sequence[str], policy: ExpansionPolicy, acc: _Accumulator
) -> None:
    """Follows relations in BOTH directions and preserves unknown types.

    Both directions because the only relation the parser emits today is ``caption_of``, pointing
    FROM the caption TO the figure. A one-directional walk would answer "what does this caption
    describe" and would answer "what does this figure say" with silence — and the second is the
    question a reader who clicked a figure is actually asking.

    A ``cites``-typed edge is skipped here and left to the citation rung, so that a reference
    entry is never labelled as though it were a figure relation. A ``references`` edge is claimed
    by whichever rung matches its TARGET: pointing at a ``reference_entry`` it is a citation,
    pointing at anything else it is "see Figure 2".
    """
    taken = 0
    dropped = 0
    for block_id in selection:
        edges: list[tuple[tuple[int, str, str, str], str, str]] = []
        for relation in index.relations_from(block_id):
            if _is_citation_edge(index, relation, outgoing=True):
                continue
            if not _rung_follows(relation.type, policy):
                continue
            edges.append(
                (
                    _relation_sort_key(relation, relation.to_block),
                    relation.to_block,
                    f"{relation.type}->{relation.from_block}",
                )
            )
        for relation in index.relations_to(block_id):
            if _is_citation_edge(index, relation, outgoing=False):
                continue
            if not _rung_follows(relation.type, policy):
                continue
            edges.append(
                (
                    _relation_sort_key(relation, relation.from_block),
                    relation.from_block,
                    f"{relation.type}<-{relation.to_block}",
                )
            )
        for _key, target, reason in sorted(edges):
            if taken >= policy.related_limit:
                dropped += 1
                continue
            if acc.add(target, Stage.RELATED, reason):
                taken += 1
    acc.cap(Stage.RELATED, dropped)


def _rung_follows(relation_type: str, policy: ExpansionPolicy) -> bool:
    if relation_type in RELATED_RELATION_TYPES:
        return True
    if relation_type in CITATION_RELATION_TYPES or relation_type == "parent_of":
        return False
    return policy.follow_unknown_relation_types


def _is_citation_edge(index: PaperIndex, relation: IndexedRelation, *, outgoing: bool) -> bool:
    if relation.type in CITATION_RELATION_TYPES:
        return True
    if relation.type != "references":
        return False
    target = index.block(relation.to_block if outgoing else relation.from_block)
    return target is not None and target.type in _REFERENCE_BLOCK_TYPES


# ── rung 5: citations ────────────────────────────────────────────────────────────────────────


def _citations(
    index: PaperIndex, selection: Sequence[str], policy: ExpansionPolicy, acc: _Accumulator
) -> None:
    """``cites``/``references`` edges into reference entries, then the label fallback.

    The fallback runs even when some edges were found, but only for markers no edge already
    explains — a paper where the parser resolved 2 of 6 citation markers should not lose the other
    4, and a caller can still tell them apart by ``reason``.
    """
    taken = 0
    dropped = 0
    for block_id in selection:
        edges: list[tuple[tuple[int, str, str, str], str, str]] = []
        for relation in index.relations_from(block_id):
            if _is_citation_edge(index, relation, outgoing=True):
                edges.append(
                    (
                        _relation_sort_key(relation, relation.to_block),
                        relation.to_block,
                        f"{relation.type}->{relation.from_block}",
                    )
                )
        for relation in index.relations_to(block_id):
            if _is_citation_edge(index, relation, outgoing=False):
                edges.append(
                    (
                        _relation_sort_key(relation, relation.from_block),
                        relation.from_block,
                        f"{relation.type}<-{relation.to_block}",
                    )
                )
        for _key, target, reason in sorted(edges):
            if taken >= policy.citation_limit:
                dropped += 1
                continue
            if acc.add(target, Stage.CITATIONS, reason):
                taken += 1

        if not policy.infer_citation_labels:
            continue
        block = index.block(block_id)
        if block is None:  # pragma: no cover - selection is filtered by `in index`
            continue
        for label in _citation_labels(block.text):
            reference = index.reference_by_label(label)
            if reference is None:
                continue
            if taken >= policy.citation_limit:
                dropped += 1
                continue
            if acc.add(
                reference.reference_entry_block_id,
                Stage.CITATIONS,
                f"cited-label:[{label}]",
            ):
                taken += 1
    acc.cap(Stage.CITATIONS, dropped)


def _citation_labels(text: str) -> tuple[str, ...]:
    """Numeric labels from in-prose markers, first-appearance order, deduplicated.

    ``[22, 21]`` yields ``("22", "21")`` — printed order, not sorted order, because a reader's
    "the first citation in this sentence" is the printed one. Ranges are NOT expanded: ``[3-7]``
    yields ``("3", "7")`` and not the five entries between them, since expanding a range would
    invent citations the sentence does not make and the ranges in this corpus are en-dashes inside
    page numbers far more often than they are citation ranges.
    """
    out: list[str] = []
    for match in _CITATION_MARKER.finditer(text):
        for part in re.split(r"[,\s–-]+", match.group(1)):
            if part.isdigit() and part not in out:
                out.append(part)
    return tuple(out)


# ── rung 6: semantic ─────────────────────────────────────────────────────────────────────────


def _semantic(
    index: PaperIndex, policy: ExpansionPolicy, query: SemanticQuery, acc: _Accumulator
) -> None:
    """LAST, opt-in, and it never displaces a structurally-reached block.

    ``k`` is asked for as ``max(query.k, semantic_limit)`` and then trimmed, because sqlite-vec's
    KNN does not know which blocks the structural rungs already claimed: asking for exactly ``k``
    and then discarding the ones already present returns fewer than ``k`` NEW hits, and the number
    it returns would depend on how much the structure happened to overlap. Over-fetching then
    trimming makes "8 semantic hits" mean 8 semantic hits.
    """
    if policy.semantic_limit <= 0 or query.k <= 0:
        return
    wanted = min(query.k, policy.semantic_limit)
    hits = index.search_vectors(query.embedding, max(query.k, policy.semantic_limit) + acc.count())
    taken = 0
    dropped = 0
    for block_id, distance in hits:
        if acc.claimed(block_id):
            continue
        if taken >= wanted:
            dropped += 1
            continue
        if acc.add(block_id, Stage.SEMANTIC, "vector", distance=distance):
            taken += 1
    acc.cap(Stage.SEMANTIC, dropped)


# ── rung 7: optional region crops ────────────────────────────────────────────────────────────


def _regions(
    index: PaperIndex, blocks: Sequence[RetrievedBlock], policy: ExpansionPolicy
) -> tuple[RegionRequest, ...]:
    """Crop addresses for every retrieved block whose type is worth looking at.

    In ``blocks`` order, so the crop a reader would see first is the crop the budget keeps first.
    NOTE THE INHERITED DEFECT: EPIC-03 §3 records that Epic 1's equation extents are wrong (#55 —
    0 of 17 matched at IoU 0.5 on neural-odes) and that figure regions block caption association
    (#51). The bbox handed over here is whatever the parser stored, so an equation crop will land
    badly through no fault of this code. It is emitted anyway, with the block type attached, so a
    consumer can report accuracy PER TARGET TYPE — one aggregate number would hide exactly this.
    """
    out: list[RegionRequest] = []
    for retrieved in blocks:
        if retrieved.type not in policy.region_types:
            continue
        block = index.block(retrieved.block_id)
        if block is None:  # pragma: no cover - retrieved blocks come from the index
            continue
        out.append(
            RegionRequest(
                block_id=block.block_id,
                page_index=block.page_index,
                type=block.type,
                bbox=block.bbox,
            )
        )
    return tuple(out)
