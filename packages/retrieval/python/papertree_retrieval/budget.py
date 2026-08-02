"""F3.3 — evidence-package assembly under a token ceiling. Acceptance: ``retrieval/budget.spec``.

An ``Expansion`` in, an ``EvidencePackage`` out: an ordered list of quoted blocks that fits a
~8,100-token ceiling, spends it against per-component budgets, and records every byte it dropped
as DATA rather than as a log line.

═══ TOKEN COUNTING: WHY THIS IS AN ESTIMATE, AND WHAT KIND OF ESTIMATE ════════════════════════

The honest starting point is that THIS REPOSITORY CANNOT COUNT TOKENS.

  * The provider is MiniMax (EPIC-03 §0.1, switched 2026-07-31). MiniMax publishes no tokenizer,
    so there is nothing to count with that would be correct for the model actually being called.
  * ``tiktoken`` would produce precise-looking numbers for a DIFFERENT model's vocabulary. On
    English prose GPT-4's cl100k and a Chinese-trained BPE disagree by tens of percent, and the
    direction of the disagreement is not knowable in advance. It is also a new runtime dependency,
    which this package does not take (its pyproject lists ``papertree-db`` and
    ``papertree-document-ir`` and nothing else).
  * So the choice is not "precise vs approximate". It is "approximate and says so" vs "approximate
    and pretends not to be". AGENTS.md §2 is a list of what the second one costs.

WHAT IS IMPLEMENTED. A deterministic, conservative UPPER-BOUND estimator, ``AtomTokenEstimator``,
built on one property that is true of every byte-level BPE tokenizer in production — GPT-2/3/4,
LLaMA, Mistral, Qwen, and by every public description MiniMax:

    the vocabulary contains all 256 single-byte tokens, and every merge REPLACES two tokens with
    one. Therefore tokens(s) <= len(s.encode("utf-8")), for every string s, always.

That is a theorem, not a calibration, and it is what ``bytes_per_token_floor=1`` computes.
``TOKENIZER_AGNOSTIC_ESTIMATOR`` is that configuration and it is exported for callers who need
the guarantee to be a proof.

It is also ~4x too pessimistic for English prose, where byte-level BPEs achieve roughly 4 bytes
per token. Spending an 8,100-token ceiling at 1 token/byte fills about 8 KB of text — under a
quarter of the window the model actually has. So the DEFAULT estimator claims a merge credit, and
claims it in exactly one place where it is defensible:

    an atom of ASCII alphanumerics (with an optional leading run of spaces/tabs attached, the way
    every GPT-2-family pre-tokenizer attaches it) costs ceil(bytes / 2) tokens;
    EVERY OTHER BYTE costs 1 token.

``bytes_per_token_floor=2`` is exactly half of the ~4 bytes/token that byte-level BPEs achieve on
English prose, i.e. a stated 2x safety margin — and it is A CALIBRATION, NOT A PROOF. The strings
that defeat it are nameable and are named here rather than discovered later: a run of ASCII
alphanumerics containing no learned merges at all (a base64 blob, a SHA hash, a long random
identifier) tokenizes at up to 1 token/byte and would be under-counted by up to 2x. Non-ASCII text
is NOT in that category — Greek in a maths paper, CJK, an emoji in a footnote all fall to the
1 token/byte branch, which is the provable bound — because that is precisely where a
prose-calibrated divisor would have been wrong and silent.

WHAT IS ACTUALLY CHECKED, AND WHAT CANNOT BE. Two bounds hold for any byte-level BPE whose
pre-tokenizer does not merge across whitespace, and both are computable here:

    lower    tokens(s) >= the number of whitespace-delimited words in s
    upper    tokens(s) <= len(s.encode("utf-8"))

``tests/test_budget.py`` asserts the estimate sits inside that sandwich on every non-empty block of
real parsed text, and — so the check is known to have teeth rather than to be satisfiable by
anything — asserts that the estimator most people would reach for, ``len(text) // 4``, FALLS OUT of
it on the same input.

Be precise about what the lower bound proves, because it is easy to over-read: the ``max(1, ...)``
per atom makes ">= 1 token per word" STRUCTURAL, true for any ``bytes_per_token_floor``. So the
sandwich test validates the SEGMENTATION (no text silently lost, no atom costing zero) and does NOT
validate the choice of 2. THE DIVISOR'S SAFETY IS AN ARGUMENT, NOT A MEASUREMENT, and it cannot
become a measurement in this repository until a real tokenizer exists to compare against.

Measured on this machine, 2026-08-02, and re-derived by the tests at run time rather than quoted
from here (AGENTS.md §2):

    resnet-cvpr-2col, 780 text-bearing blocks, 59,103 chars
        estimate 35,830   utf-8 bytes 59,728   words 9,442
        estimate/bytes 0.600      estimate/word 3.79
    the synthetic CI paper, 13 text-bearing blocks, 734 chars
        estimate/bytes 0.589      estimate/word 3.40

So the default spends about 60% of the provable ceiling, at roughly 3.8 estimated tokens per
whitespace word against a real BPE's ~1.3 on English prose — call it 2.5-3x headroom, which is the
price of not having a tokenizer. `len(text) // 4`, the folk estimate, UNDER-counts 3 of those 13
synthetic blocks; the default under-counts none.

THE CEILING CLAIM IS THEREFORE AN UPPER-BOUND CLAIM. ``EvidencePackage.total_tokens`` is the
estimator's number, and "never exceeds 8,100" means "never exceeds 8,100 ESTIMATED tokens, where
the estimate is designed not to under-count ordinary paper text". It is not a promise about a
MiniMax invoice.

SWAPPING IN A REAL TOKENIZER. ``TokenEstimator`` is a ``Protocol`` with a single ``estimate``
method, and ``assemble_evidence`` takes one as a REQUIRED argument. Wiring MiniMax's tokenizer, or
``tiktoken``, or an HTTP token-count endpoint is a new class implementing one method — no call
site changes, no signature changes. That is the whole reason the estimator is an argument rather
than a module function.

═══ THE BUDGET ════════════════════════════════════════════════════════════════════════════════

~8,100 tokens, split into seven per-component budgets that sum to at most the ceiling — the
default policy sums to EXACTLY 8,100. Unused budget is NOT reallocated, and that is a decision
rather than an omission: a component's budget is a cap on how much of the window ONE KIND of
evidence may claim, and letting semantic hits soak up the citation component's leftovers is
precisely how "structure-aware first, semantic second" becomes "semantic, mostly" without anybody
editing a line of policy.

That one invariant — components sum to at most the ceiling, enforced in
``BudgetPolicy.__post_init__`` — is what makes the ceiling hold without any global
arithmetic during assembly, and it is also what deleted a truncation reason that could never
fire. See ``TruncationReason``.

TRUNCATION IS RECORDED, NEVER SILENT. Every component that lost anything emits a
``TruncationRecord`` naming the component, the reason, the block ids dropped, and the token counts
on both sides of the decision. ``EvidencePackage.truncation`` is the acceptance criterion's
"recorded" — it is data on the returned object, queryable by the caller and by a test, not a
warning somebody has to be watching a log to see.

WHOLE BLOCKS ARE DROPPED; TEXT IS TRUNCATED ONLY WHERE IT MUST BE. A half-quoted block is a
grounding hazard: the model cites block X, the reader opens block X, and the sentence the model
quoted is not the sentence that is there. So every component drops whole items — except the
SELECTION component, where dropping the block the user actually selected produces an evidence
package about nothing. There, and only there, text is cut to fit, the cut is marked in the text
with ``TEXT_TRUNCATION_MARKER``, and the block id appears in the truncation record's
``truncated_block_ids``.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, Protocol

from papertree_retrieval.expansion import Expansion, RegionRequest, RetrievedBlock, Stage

__all__ = [
    "DEFAULT_BUDGET_POLICY",
    "DEFAULT_TOKEN_ESTIMATOR",
    "EVIDENCE_CEILING_TOKENS",
    "TEXT_TRUNCATION_MARKER",
    "TOKENIZER_AGNOSTIC_ESTIMATOR",
    "AtomTokenEstimator",
    "BudgetPolicy",
    "Component",
    "ComponentUsage",
    "EvidenceItem",
    "EvidencePackage",
    "TokenEstimator",
    "TruncationReason",
    "TruncationRecord",
    "assemble_evidence",
]

#: EPIC-03 F3.3's "~8,100-token ceiling", taken literally.
EVIDENCE_CEILING_TOKENS: Final = 8_100

#: Appended where a block's text was cut. Inside the quoted text on purpose: a model that reads
#: the package sees that the quotation is partial, and a reader who compares the citation against
#: the paper sees why it does not match to the last word.
TEXT_TRUNCATION_MARKER: Final = " […truncated]"


class TokenEstimator(Protocol):
    """One method, so a real tokenizer can replace the estimate without touching a call site."""

    @property
    def name(self) -> str:
        """Recorded on the package, so a stored evidence package says what counted it."""

    def estimate(self, text: str) -> int: ...


#: An atom is either a run of ASCII alphanumerics with an optional leading run of spaces/tabs, or
#: a single character. The second alternative is ``.`` under ``DOTALL`` and therefore ALWAYS
#: matches, which is what makes the segmentation total: ``"".join(atoms(s)) == s`` for every ``s``,
#: and ``tests/test_budget.py`` asserts exactly that. A segmentation that could silently skip a
#: character would under-count by however many characters it skipped.
_ATOM = re.compile(r"[ \t]*[A-Za-z0-9]+|.", re.DOTALL)


@dataclass(frozen=True, slots=True)
class AtomTokenEstimator:
    """A deterministic conservative upper bound. See the module docstring for the full argument.

    ``bytes_per_token_floor`` is the minimum number of UTF-8 bytes assumed to be consumed per
    token WITHIN an ASCII-alphanumeric atom. ``1`` is the only value that is a theorem; larger
    values are calibrations and this class does not pretend otherwise.
    """

    bytes_per_token_floor: int

    def __post_init__(self) -> None:
        if self.bytes_per_token_floor < 1:
            raise ValueError(
                "bytes_per_token_floor must be >= 1; a floor below 1 claims a tokenizer emits "
                "fewer tokens than there are bytes to emit them from, which no BPE does"
            )

    @property
    def name(self) -> str:
        return f"atom/floor={self.bytes_per_token_floor}"

    def estimate(self, text: str) -> int:
        total = 0
        floor = self.bytes_per_token_floor
        for match in _ATOM.finditer(text):
            atom = match.group(0)
            size = len(atom.encode("utf-8"))
            if len(atom) == size and atom[-1].isascii() and atom[-1].isalnum():
                # ASCII alphanumeric atom: the one place a merge credit is claimed.
                total += max(1, -(-size // floor))
            else:
                # Everything else at the provable ceiling of one token per byte.
                total += size
        return total


#: The proof. ``tokens(s) <= estimate(s)`` for any byte-level BPE, at ~4x the real cost of prose.
TOKENIZER_AGNOSTIC_ESTIMATOR: Final = AtomTokenEstimator(bytes_per_token_floor=1)

#: The working default: a stated 2x margin over English prose, and the provable bound everywhere
#: that margin would not have been measured.
DEFAULT_TOKEN_ESTIMATOR: Final = AtomTokenEstimator(bytes_per_token_floor=2)


class Component(StrEnum):
    """The seven budget lines. Six mirror the ladder's rungs; ``REGIONS`` is the crop rung."""

    SELECTION = "selection"
    STRUCTURE = "structure"
    ADJACENT = "adjacent"
    RELATED = "related"
    CITATIONS = "citations"
    SEMANTIC = "semantic"
    REGIONS = "regions"


#: Spend order. Earlier components get their budget first, so when the CEILING (rather than a
#: component budget) binds, what survives is what the ladder ranked highest.
COMPONENT_ORDER: Final[tuple[Component, ...]] = (
    Component.SELECTION,
    Component.STRUCTURE,
    Component.ADJACENT,
    Component.RELATED,
    Component.CITATIONS,
    Component.SEMANTIC,
    Component.REGIONS,
)

_STAGE_COMPONENT: Final[dict[Stage, Component]] = {
    Stage.SELECTION: Component.SELECTION,
    Stage.STRUCTURE: Component.STRUCTURE,
    Stage.ADJACENT: Component.ADJACENT,
    Stage.RELATED: Component.RELATED,
    Stage.CITATIONS: Component.CITATIONS,
    Stage.SEMANTIC: Component.SEMANTIC,
}


class TruncationReason(StrEnum):
    """Why something was lost. Two causes, and a third that was designed OUT rather than handled.

    THERE IS NO ``ceiling_exhausted``, AND THAT ABSENCE IS THE DESIGN. The first draft had one, for
    "the 8,100-token ceiling was already gone before this component was reached". It is
    UNREACHABLE, and provably so: ``BudgetPolicy`` refuses at construction unless the component
    budgets sum to at most the ceiling, and no component can spend more than its own budget, so the
    remaining ceiling when component *k* starts is always at least the sum of the budgets of
    components *k* onwards. A branch that cannot execute is the defect findings.md §A records
    (1,698 lines of extraction with zero importers) in miniature, and a truncation REASON that
    cannot occur is worse than most dead code because it appears in the public vocabulary and
    invites callers to handle a case that will never arrive. Removed, and the invariant that
    removes it is asserted in ``tests/test_budget.py``.
    """

    #: The component spent its own budget. Raising that component's budget recovers these blocks —
    #: which is exactly what the invariant above makes a true and actionable statement.
    COMPONENT_BUDGET_EXHAUSTED = "component_budget_exhausted"
    #: A selected block's own text was longer than the whole selection budget and was cut to fit.
    TEXT_TRUNCATED = "text_truncated"


@dataclass(frozen=True, slots=True)
class TruncationRecord:
    """One loss, as data. ``EvidencePackage.truncation`` is a tuple of these."""

    component: Component
    reason: TruncationReason
    #: Blocks omitted entirely, in the order they would have appeared.
    dropped_block_ids: tuple[str, ...]
    #: Blocks kept but with their text cut. Never overlaps ``dropped_block_ids``.
    truncated_block_ids: tuple[str, ...]
    #: Estimated tokens that did not make it in. For ``TEXT_TRUNCATED``, the tokens cut off.
    dropped_tokens: int
    budget_tokens: int
    used_tokens: int


@dataclass(frozen=True, slots=True)
class ComponentUsage:
    """What one component actually spent. Emitted for every component, including empty ones."""

    component: Component
    budget_tokens: int
    used_tokens: int
    items_kept: int
    items_dropped: int


@dataclass(frozen=True, slots=True)
class BudgetPolicy:
    """The ceiling and its seven per-component shares.

    Seven named integer fields rather than a mapping, deliberately: a ``Mapping`` field makes the
    dataclass unhashable and lets a caller pass a policy that is silently missing a component,
    which then gets a budget of zero and drops everything it was handed while the package still
    reports a valid-looking total. Named fields make a missing budget a ``TypeError``.
    """

    ceiling_tokens: int
    selection_tokens: int
    structure_tokens: int
    adjacent_tokens: int
    related_tokens: int
    citations_tokens: int
    semantic_tokens: int
    regions_tokens: int
    #: What one rendered region crop is charged. An image's real token cost cannot be estimated
    #: from text at all — it is a function of the provider's tiling of the rasterised crop — so it
    #: is DECLARED rather than computed, and the declaration is visible in the policy instead of
    #: buried as a constant.
    tokens_per_region: int
    #: Components permitted to cut a block's text rather than drop the block. See the module
    #: docstring's last paragraph for why this is not simply "all of them".
    text_truncation_allowed_in: frozenset[Component]

    def __post_init__(self) -> None:
        if self.ceiling_tokens <= 0:
            raise ValueError(f"ceiling_tokens must be > 0, got {self.ceiling_tokens}")
        total = sum(self.budget_for(component) for component in COMPONENT_ORDER)
        if total > self.ceiling_tokens:
            raise ValueError(
                f"component budgets sum to {total}, above the ceiling of {self.ceiling_tokens}. "
                "The assembler would still hold the ceiling, but the per-component budgets would "
                "have stopped meaning what they say for whichever component ran last."
            )
        for component in COMPONENT_ORDER:
            if self.budget_for(component) < 0:
                raise ValueError(f"{component} budget must be >= 0")
        if self.tokens_per_region < 0:
            raise ValueError("tokens_per_region must be >= 0")

    def budget_for(self, component: Component) -> int:
        match component:
            case Component.SELECTION:
                return self.selection_tokens
            case Component.STRUCTURE:
                return self.structure_tokens
            case Component.ADJACENT:
                return self.adjacent_tokens
            case Component.RELATED:
                return self.related_tokens
            case Component.CITATIONS:
                return self.citations_tokens
            case Component.SEMANTIC:
                return self.semantic_tokens
            case Component.REGIONS:
                return self.regions_tokens


#: The shares, summing to exactly 8,100. Sized from the ladder, not from round numbers: the
#: selection is what the question is about and gets the most; structure buys the outline plus a
#: handful of section siblings (a median corpus paragraph estimates at ~120 tokens under the
#: default estimator, so 1,500 buys roughly a dozen); semantic is LAST and smallest because the
#: epic's rule is that it is the fallback, and a budget is the only place that rule becomes
#: enforceable rather than aspirational.
DEFAULT_BUDGET_POLICY: Final = BudgetPolicy(
    ceiling_tokens=EVIDENCE_CEILING_TOKENS,
    selection_tokens=2_200,
    structure_tokens=1_500,
    adjacent_tokens=1_300,
    related_tokens=1_100,
    citations_tokens=900,
    semantic_tokens=600,
    regions_tokens=500,
    tokens_per_region=250,
    text_truncation_allowed_in=frozenset({Component.SELECTION}),
)


@dataclass(frozen=True, slots=True)
class EvidenceItem:
    """One quoted block, already rendered and already costed.

    ``tokens`` is the cost of :meth:`render`'s output, not of ``text`` — the header a prompt puts
    around a quotation is not free, and a ceiling that counted only the quotations would be
    breached by the framing that carries them.
    """

    component: Component
    block_id: str
    page_index: int
    type: str
    flow: str
    reason: str
    text: str
    tokens: int
    text_truncated: bool
    proposed_repairs: int
    distance: float | None

    def render(self) -> str:
        """The exact string this item contributes to the prompt. Ends with a blank line.

        Ending each item with ``"\\n\\n"`` means the whole package is the plain concatenation of
        its items, so ``estimate(package.render()) <= sum(item.tokens)`` follows from the
        estimator being subadditive — and ``tests/test_budget.py`` asserts the inequality rather
        than assuming it.
        """
        flags = "" if self.proposed_repairs == 0 else f" | {self.proposed_repairs} proposed-repairs"
        distance = "" if self.distance is None else f" | d={self.distance:.6f}"
        return (
            f"[{self.block_id} | p{self.page_index + 1} | {self.type}/{self.flow} "
            f"| {self.reason}{flags}{distance}]\n{self.text}\n\n"
        )


@dataclass(frozen=True, slots=True)
class EvidencePackage:
    """The assembled package: what was kept, what it cost, and exactly what was lost."""

    paper_id: str
    generation: int
    selection: tuple[str, ...]
    items: tuple[EvidenceItem, ...]
    regions: tuple[RegionRequest, ...]
    usage: tuple[ComponentUsage, ...]
    truncation: tuple[TruncationRecord, ...]
    total_tokens: int
    ceiling_tokens: int
    estimator_name: str

    @property
    def complete(self) -> bool:
        """True when nothing was dropped or cut. The negation of "there is a truncation record"."""
        return not self.truncation

    @property
    def block_ids(self) -> tuple[str, ...]:
        return tuple(item.block_id for item in self.items)

    def usage_for(self, component: Component) -> ComponentUsage:
        for entry in self.usage:
            if entry.component is component:
                return entry
        raise KeyError(component)  # pragma: no cover - usage covers every component

    def render(self) -> str:
        """The evidence text, in order. The concatenation of the items — nothing is added here.

        Region crops are NOT rendered: they are addresses, and turning one into pixels is
        ``services/document-worker``'s job. Their declared token cost is already in
        :attr:`total_tokens`, so a caller that attaches the images is spending budget the package
        has already reserved.
        """
        return "".join(item.render() for item in self.items)


def assemble_evidence(
    expansion: Expansion,
    policy: BudgetPolicy,
    estimator: TokenEstimator,
) -> EvidencePackage:
    """Fits ``expansion`` into ``policy``'s ceiling and records everything that did not fit.

    ``policy`` and ``estimator`` are both REQUIRED. The estimator especially: a default would mean
    that the day a real MiniMax tokenizer arrives, every call site that forgot to pass one keeps
    silently using the approximation, and the approximation is the thing whose limits this module
    spends 60 lines documenting.

    The result satisfies, by construction and by assertion in ``tests/test_budget.py``:

        total_tokens <= policy.ceiling_tokens
        estimator.estimate(package.render()) <= total_tokens
        every dropped block id appears in exactly one TruncationRecord
    """
    items: list[EvidenceItem] = []
    usage: list[ComponentUsage] = []
    truncation: list[TruncationRecord] = []
    regions: list[RegionRequest] = []

    for component in COMPONENT_ORDER:
        # `budget_for` and NOT `min(budget_for, remaining_ceiling)`. The policy invariant makes
        # such a clamp a no-op (see TruncationReason's docstring), and a no-op clamp hides the
        # invariant it silently depends on. The total is still checked once, below.
        budget = policy.budget_for(component)

        if component is Component.REGIONS:
            used, kept_regions, dropped_regions = _spend_regions(expansion.regions, policy, budget)
            regions.extend(kept_regions)
            usage.append(
                ComponentUsage(
                    component=component,
                    budget_tokens=budget,
                    used_tokens=used,
                    items_kept=len(kept_regions),
                    items_dropped=len(dropped_regions),
                )
            )
            if dropped_regions:
                truncation.append(
                    TruncationRecord(
                        component=component,
                        reason=TruncationReason.COMPONENT_BUDGET_EXHAUSTED,
                        dropped_block_ids=tuple(r.block_id for r in dropped_regions),
                        truncated_block_ids=(),
                        dropped_tokens=len(dropped_regions) * policy.tokens_per_region,
                        budget_tokens=budget,
                        used_tokens=used,
                    )
                )
            continue

        stage = _component_stage(component)
        retrieved = expansion.by_stage(stage)
        used = 0
        kept: list[EvidenceItem] = []
        dropped: list[str] = []
        dropped_tokens = 0
        truncated: list[str] = []
        truncated_tokens = 0
        may_truncate_text = component in policy.text_truncation_allowed_in

        for block in retrieved:
            item = _build_item(component, block, block.text, estimator, text_truncated=False)
            if used + item.tokens <= budget:
                kept.append(item)
                used += item.tokens
                continue

            headroom = budget - used
            if may_truncate_text and headroom > 0:
                fitted = _fit_text(component, block, estimator, headroom)
                if fitted is not None:
                    kept.append(fitted)
                    truncated.append(block.block_id)
                    truncated_tokens += item.tokens - fitted.tokens
                    used += fitted.tokens
                    continue

            dropped.append(block.block_id)
            dropped_tokens += item.tokens

        items.extend(kept)
        usage.append(
            ComponentUsage(
                component=component,
                budget_tokens=budget,
                used_tokens=used,
                items_kept=len(kept),
                items_dropped=len(dropped),
            )
        )
        if truncated:
            truncation.append(
                TruncationRecord(
                    component=component,
                    reason=TruncationReason.TEXT_TRUNCATED,
                    dropped_block_ids=(),
                    truncated_block_ids=tuple(truncated),
                    dropped_tokens=truncated_tokens,
                    budget_tokens=budget,
                    used_tokens=used,
                )
            )
        if dropped:
            truncation.append(
                TruncationRecord(
                    component=component,
                    reason=TruncationReason.COMPONENT_BUDGET_EXHAUSTED,
                    dropped_block_ids=tuple(dropped),
                    truncated_block_ids=(),
                    dropped_tokens=dropped_tokens,
                    budget_tokens=budget,
                    used_tokens=used,
                )
            )

    total = sum(item.tokens for item in items) + len(regions) * policy.tokens_per_region
    if total > policy.ceiling_tokens:  # pragma: no cover - the loop above cannot produce this
        raise AssertionError(
            f"assembled package estimates {total} tokens against a ceiling of "
            f"{policy.ceiling_tokens}; the per-component spend loop is wrong"
        )

    return EvidencePackage(
        paper_id=expansion.paper_id,
        generation=expansion.generation,
        selection=expansion.selection,
        items=tuple(items),
        regions=tuple(regions),
        usage=tuple(usage),
        truncation=tuple(truncation),
        total_tokens=total,
        ceiling_tokens=policy.ceiling_tokens,
        estimator_name=estimator.name,
    )


def _component_stage(component: Component) -> Stage:
    for stage, mapped in _STAGE_COMPONENT.items():
        if mapped is component:
            return stage
    raise KeyError(component)  # pragma: no cover - REGIONS is handled before this is reached


def _build_item(
    component: Component,
    block: RetrievedBlock,
    text: str,
    estimator: TokenEstimator,
    *,
    text_truncated: bool,
) -> EvidenceItem:
    """Builds the item, renders it, and costs the RENDERED form. See ``EvidenceItem.tokens``.

    Built twice because ``render()`` is a method on the item and the token count is a field of it:
    once with ``tokens=0`` to obtain the rendered string, once with the real count. The header is a
    fixed number of characters that does not depend on ``tokens``, so the two renderings are
    identical and the count is of the string that is actually emitted.
    """
    draft = EvidenceItem(
        component=component,
        block_id=block.block_id,
        page_index=block.page_index,
        type=block.type,
        flow=block.flow,
        reason=block.reason,
        text=text,
        tokens=0,
        text_truncated=text_truncated,
        proposed_repairs=block.proposed_repairs,
        distance=block.distance,
    )
    return EvidenceItem(
        component=draft.component,
        block_id=draft.block_id,
        page_index=draft.page_index,
        type=draft.type,
        flow=draft.flow,
        reason=draft.reason,
        text=draft.text,
        tokens=estimator.estimate(draft.render()),
        text_truncated=draft.text_truncated,
        proposed_repairs=draft.proposed_repairs,
        distance=draft.distance,
    )


def _fit_text(
    component: Component,
    block: RetrievedBlock,
    estimator: TokenEstimator,
    headroom: int,
) -> EvidenceItem | None:
    """The longest prefix of the block's text whose rendered item fits ``headroom``, or ``None``.

    Binary search over the prefix LENGTH IN CHARACTERS. Valid because the estimator is monotone
    non-decreasing in the prefix (each additional character adds a byte to some atom, and an
    atom's cost never falls as it grows), so "fits" is a step function with one boundary. Cutting
    on characters rather than bytes keeps the result a valid ``str`` — slicing UTF-8 bytes would
    split a multi-byte code point and produce a quotation that is not text.

    Returns ``None`` when even the empty-text item does not fit, in which case the caller drops
    the block whole. An item with no text is not emitted: a citation to a block whose quoted text
    is empty is worse than an honest omission with a truncation record.
    """
    if not block.text:
        return None

    def cost(text: str) -> int:
        return _build_item(component, block, text, estimator, text_truncated=True).tokens

    marker = TEXT_TRUNCATION_MARKER
    if cost(marker.strip()) > headroom:
        return None

    low, high = 0, len(block.text)
    while low < high:
        middle = (low + high + 1) // 2
        if cost(block.text[:middle] + marker) <= headroom:
            low = middle
        else:
            high = middle - 1
    if low <= 0:
        return None
    return _build_item(component, block, block.text[:low] + marker, estimator, text_truncated=True)


def _spend_regions(
    requests: Sequence[RegionRequest], policy: BudgetPolicy, budget: int
) -> tuple[int, list[RegionRequest], list[RegionRequest]]:
    """Region crops cost a declared flat rate each. Kept in ladder order until the budget runs."""
    if policy.tokens_per_region == 0:
        return (0, list(requests), [])
    affordable = budget // policy.tokens_per_region
    kept = list(requests[:affordable])
    dropped = list(requests[affordable:])
    return (len(kept) * policy.tokens_per_region, kept, dropped)
