"""ACCEPTANCE CRITERION `retrieval/budget.spec` (EPIC-03 F3.3).

    "Evidence package never exceeds the token ceiling; truncation is recorded, never silent."

TWO CLAIMS, AND THE SECOND ONE IS THE ONE THAT NEEDS CARE.

The ceiling claim is easy to assert and easy to assert VACUOUSLY: `assert total <= 8100` on an
input that would only ever have produced 900 tokens measures nothing at all, and this repo already
shipped that test once — `perf.spec` asserted `peak_mb < 2000` against a 500 MB bar on the
second-smallest paper and passed for months (AGENTS.md §2). So every ceiling assertion in this
file first asserts THE INPUT WOULD HAVE BREACHED IT: the unbudgeted cost is computed and asserted
to be many times the ceiling before the budgeted cost is asserted to be under it.

The truncation claim is asserted as a partition rather than as a presence check: every block id
that went in comes out in exactly one of {kept whole, kept truncated, dropped}, and every dropped
id appears in a `TruncationRecord`. "There is a truncation record" would pass while nine tenths of
the package vanished unnamed.

── THE ESTIMATOR, AND WHAT ITS TESTS CAN AND CANNOT SHOW ────────────────────────────────────────

There is no tokenizer in this repository (MiniMax publishes none; `tiktoken` is a different
model's vocabulary and a new dependency), so NO TEST HERE CAN COMPARE THE ESTIMATE AGAINST A TRUE
TOKEN COUNT. What can be compared, and is, are the two bounds that hold for any byte-level BPE
whose pre-tokenizer does not merge across whitespace:

    lower   tokens(s) >= number of whitespace-delimited words in s
    upper   tokens(s) <= len(s.encode("utf-8"))

The default estimator is asserted to sit strictly inside that sandwich on every non-empty block of
real parsed text available to the run. That is a genuine, falsifiable check — and to prove it has
teeth rather than merely being satisfiable, the same assertion is run against a deliberately
too-loose estimator and asserted to FAIL.

Whether the estimate is close to what MiniMax would bill is NOT MEASURED and is not claimed
anywhere in this file or in `budget.py`.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from _retrieval_corpus import CORPUS_PAPER, requires_corpus
from _retrieval_fixtures import ParsedPaper, corpus_paper
from _retrieval_fixtures import synthetic_paper as _synthetic_paper
from papertree_retrieval import (
    DEFAULT_BUDGET_POLICY,
    DEFAULT_EXPANSION_POLICY,
    DEFAULT_TOKEN_ESTIMATOR,
    EVIDENCE_CEILING_TOKENS,
    TEXT_TRUNCATION_MARKER,
    TOKENIZER_AGNOSTIC_ESTIMATOR,
    AtomTokenEstimator,
    BudgetPolicy,
    Component,
    Expansion,
    PaperIndex,
    RegionRequest,
    RetrievedBlock,
    Stage,
    TokenEstimator,
    TruncationReason,
    assemble_evidence,
    expand,
)
from papertree_retrieval.budget import _ATOM, COMPONENT_ORDER

#: One paragraph of real parsed text, repeated, is what the oversized fixtures are built from —
#: so the numbers below are about text with the shape of a paper rather than about "x" * 4000.
_FILLER_REPEATS = 24


@pytest.fixture(scope="module")
def paper() -> ParsedPaper:
    return _synthetic_paper()


@pytest.fixture(scope="module")
def index(paper: ParsedPaper) -> PaperIndex:
    return PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)


def _real_block_texts(index: PaperIndex) -> list[str]:
    out: list[str] = []
    for block_id in index.reading_order:
        block = index.block(block_id)
        assert block is not None
        if block.text:
            out.append(block.text)
    return out


def _oversized_expansion(index: PaperIndex) -> Expansion:
    """An expansion whose text is ~66x the ceiling, built from REAL parsed paragraphs repeated.

    Twelve blocks per rung, six rungs, each carrying a paragraph repeated 24 times. Nothing is
    synthetic about the CHARACTERS — they came out of the parser — only about the volume, which is
    the point: the ceiling has to hold against an expansion far larger than any policy would
    produce, not merely against a slightly-too-big one.
    """
    texts = _real_block_texts(index)
    assert texts, "the parse produced no text at all"
    filler = ("\n".join(texts) + "\n") * _FILLER_REPEATS

    blocks: list[RetrievedBlock] = []
    for stage in (
        Stage.SELECTION,
        Stage.STRUCTURE,
        Stage.ADJACENT,
        Stage.RELATED,
        Stage.CITATIONS,
        Stage.SEMANTIC,
    ):
        for position in range(12):
            blocks.append(
                RetrievedBlock(
                    block_id=f"blk_{stage.value}_{position:04d}",
                    stage=stage,
                    reason=f"{stage.value}-fixture",
                    page_index=position,
                    type="paragraph",
                    flow="body",
                    text=filler,
                    proposed_repairs=0,
                    distance=0.5 if stage is Stage.SEMANTIC else None,
                )
            )
    regions = tuple(
        RegionRequest(
            block_id=f"blk_region_{position:04d}",
            page_index=position,
            type="figure",
            bbox=(0.0, 0.0, 100.0, 100.0),
        )
        for position in range(20)
    )
    return Expansion(
        paper_id="ppr_oversized",
        generation=1,
        selection=("blk_selection_0000",),
        blocks=tuple(blocks),
        regions=regions,
        semantic_requested=True,
        vector_count=999,
    )


# ── the ceiling ──────────────────────────────────────────────────────────────────────────────


def test_the_ceiling_holds_against_an_input_that_would_blow_it_by_orders_of_magnitude(
    index: PaperIndex,
) -> None:
    """THE ACCEPTANCE CRITERION, half one. The bar is asserted to be a real bar first.

    Structure, and the order matters:

      1. compute what the expansion would cost UNBUDGETED and assert it is >= 20x the ceiling, so
         the assertion below cannot pass by the input being small (AGENTS.md §2's `perf.spec`);
      2. assert the assembled package is at or under the ceiling;
      3. assert no single component overspent its own budget either, because a package that held
         the ceiling by letting one component eat six others' budgets would satisfy (2) and would
         have inverted "structure-aware first, semantic second".
    """
    expansion = _oversized_expansion(index)

    unbudgeted = sum(DEFAULT_TOKEN_ESTIMATOR.estimate(block.text) for block in expansion.blocks)
    assert unbudgeted >= 20 * EVIDENCE_CEILING_TOKENS, (
        f"the oversized fixture only estimates {unbudgeted} tokens against a ceiling of "
        f"{EVIDENCE_CEILING_TOKENS}; this test would pass without the budget doing anything"
    )

    package = assemble_evidence(expansion, DEFAULT_BUDGET_POLICY, DEFAULT_TOKEN_ESTIMATOR)

    assert package.total_tokens <= EVIDENCE_CEILING_TOKENS
    assert package.ceiling_tokens == EVIDENCE_CEILING_TOKENS
    for usage in package.usage:
        assert usage.used_tokens <= usage.budget_tokens, usage
        assert usage.budget_tokens <= DEFAULT_BUDGET_POLICY.budget_for(usage.component)


def test_the_rendered_package_is_no_larger_than_the_total_it_reports(index: PaperIndex) -> None:
    """The ceiling has to be a claim about the string that is actually sent, not about a sum.

    Each item renders to a self-contained chunk ending in a blank line and the package is their
    concatenation, so `estimate(render()) <= sum(item.tokens)` follows from the estimator being
    subadditive. Asserted rather than assumed — a header that changed length with the token count,
    or a joiner added at render time, would break it silently.
    """
    package = assemble_evidence(
        _oversized_expansion(index), DEFAULT_BUDGET_POLICY, DEFAULT_TOKEN_ESTIMATOR
    )
    rendered = package.render()
    assert rendered
    assert DEFAULT_TOKEN_ESTIMATOR.estimate(rendered) <= package.total_tokens
    assert package.total_tokens <= EVIDENCE_CEILING_TOKENS
    assert rendered == "".join(item.render() for item in package.items)


# ── truncation is recorded, never silent ─────────────────────────────────────────────────────


def test_every_block_that_went_in_is_either_kept_or_named_in_a_truncation_record(
    index: PaperIndex,
) -> None:
    """THE ACCEPTANCE CRITERION, half two. A partition, not a presence check.

    `assert package.truncation` would pass while 700 of 720 blocks vanished unnamed. This asserts
    that {kept} ∪ {dropped} is exactly the input, that the two do not overlap, and that every
    dropped id names a component and a reason a caller can act on.
    """
    expansion = _oversized_expansion(index)
    package = assemble_evidence(expansion, DEFAULT_BUDGET_POLICY, DEFAULT_TOKEN_ESTIMATOR)

    went_in = [block.block_id for block in expansion.blocks]
    kept = list(package.block_ids)
    dropped = [
        block_id
        for record in package.truncation
        if record.component is not Component.REGIONS
        for block_id in record.dropped_block_ids
    ]

    assert sorted(kept + dropped) == sorted(went_in)
    assert not (set(kept) & set(dropped))
    assert dropped, "the oversized fixture must lose blocks or this test proves nothing"

    for record in package.truncation:
        assert record.component in set(Component)
        assert record.reason in set(TruncationReason)
        assert record.dropped_tokens >= 0
        assert record.used_tokens <= record.budget_tokens

    assert package.complete is False

    # Region crops are addresses rather than blocks, so they partition separately — and they DO
    # partition: none goes missing without a record either.
    dropped_regions = [
        block_id
        for record in package.truncation
        if record.component is Component.REGIONS
        for block_id in record.dropped_block_ids
    ]
    assert sorted([region.block_id for region in package.regions] + dropped_regions) == sorted(
        region.block_id for region in expansion.regions
    )
    assert dropped_regions


def test_a_selected_block_too_large_for_its_budget_is_cut_and_recorded_not_dropped(
    index: PaperIndex,
) -> None:
    """Selection is the one component where dropping the block defeats the purpose.

    An evidence package assembled around a selection the model never sees is a package about
    nothing, so selection text is cut to fit, the cut is visible IN the text, and the block id is
    recorded as truncated rather than as dropped. Every other component drops whole blocks — a
    half-quoted paragraph in the context is a grounding hazard.
    """
    texts = _real_block_texts(index)
    huge = ("\n".join(texts) + "\n") * _FILLER_REPEATS
    selected = RetrievedBlock(
        block_id="blk_one_enormous_selection",
        stage=Stage.SELECTION,
        reason="selected",
        page_index=0,
        type="paragraph",
        flow="body",
        text=huge,
        proposed_repairs=2,
        distance=None,
    )
    expansion = Expansion(
        paper_id="ppr_one",
        generation=1,
        selection=(selected.block_id,),
        blocks=(selected,),
        regions=(),
        semantic_requested=False,
        vector_count=0,
    )

    assert DEFAULT_TOKEN_ESTIMATOR.estimate(huge) > DEFAULT_BUDGET_POLICY.selection_tokens
    package = assemble_evidence(expansion, DEFAULT_BUDGET_POLICY, DEFAULT_TOKEN_ESTIMATOR)

    assert [item.block_id for item in package.items] == [selected.block_id]
    item = package.items[0]
    assert item.text_truncated is True
    assert item.text.endswith(TEXT_TRUNCATION_MARKER)
    assert huge.startswith(item.text[: -len(TEXT_TRUNCATION_MARKER)])
    assert item.tokens <= DEFAULT_BUDGET_POLICY.selection_tokens

    records = [r for r in package.truncation if r.reason is TruncationReason.TEXT_TRUNCATED]
    assert [r.truncated_block_ids for r in records] == [(selected.block_id,)]
    assert records[0].dropped_tokens > 0
    assert not any(selected.block_id in r.dropped_block_ids for r in package.truncation)
    # The proposed-repair count survives into the rendered evidence, so a quotation somebody has
    # already flagged as wrong is not quoted as though it were clean.
    assert "2 proposed-repairs" in item.render()


def test_a_late_component_is_never_starved_by_an_earlier_one(index: PaperIndex) -> None:
    """The invariant that let `budget.py` delete a truncation reason instead of handling it.

    A first draft carried a `CEILING_EXHAUSTED` reason for "the ceiling was gone before this
    component was reached". It cannot happen: components sum to at most the ceiling and none may
    overspend its own budget, so the remaining ceiling when a component starts is always at least
    the sum of the budgets still to come. This asserts the consequence directly — the LAST
    component in spend order gets, and can use, its full nominal budget even though an oversized
    expansion has already saturated all six before it.

    That is what makes `COMPONENT_BUDGET_EXHAUSTED` an actionable message: raising the named
    component's budget really does recover the named blocks.
    """
    package = assemble_evidence(
        _oversized_expansion(index), DEFAULT_BUDGET_POLICY, DEFAULT_TOKEN_ESTIMATOR
    )

    for usage in package.usage:
        assert usage.budget_tokens == DEFAULT_BUDGET_POLICY.budget_for(usage.component), usage
    assert package.usage_for(Component.SELECTION).items_dropped > 0
    last = package.usage_for(COMPONENT_ORDER[-1])
    assert last.used_tokens > 0, "the last component was starved, so the invariant does not hold"

    reasons = {record.reason for record in package.truncation if record.dropped_block_ids}
    assert reasons == {TruncationReason.COMPONENT_BUDGET_EXHAUSTED}
    assert TruncationReason.__members__.keys() == {
        "COMPONENT_BUDGET_EXHAUSTED",
        "TEXT_TRUNCATED",
    }, "a truncation reason was added; is it reachable? see TruncationReason's docstring"


def test_a_policy_whose_components_oversum_the_ceiling_is_rejected_at_construction() -> None:
    """A budget that cannot mean what it says is a construction error, not a runtime surprise."""
    with pytest.raises(ValueError, match="above the ceiling"):
        BudgetPolicy(
            ceiling_tokens=1_000,
            selection_tokens=900,
            structure_tokens=900,
            adjacent_tokens=0,
            related_tokens=0,
            citations_tokens=0,
            semantic_tokens=0,
            regions_tokens=0,
            tokens_per_region=0,
            text_truncation_allowed_in=frozenset(),
        )
    assert (
        sum(DEFAULT_BUDGET_POLICY.budget_for(component) for component in Component)
        == EVIDENCE_CEILING_TOKENS
    )


# ── the estimator ────────────────────────────────────────────────────────────────────────────

#: Strings chosen to break a naive estimator, each for a stated reason.
_ADVERSARIAL_TEXT = (
    "",
    " ",
    "\n\n\n",
    "x",
    "the quick brown fox jumps over the lazy dog",
    "−−−",  # U+2212 MINUS SIGN, the character findings.md B7's cleaner destroyed
    "ﬁnite diﬀerences",  # ligatures, which survive into Block.text verbatim
    "α = ∫_0^1 f(x) dx",  # Greek + integral: 2- and 3-byte code points
    "深層学習は難しい",  # CJK: 3 bytes per code point
    "\U0001f9ea\U0001f9ea",  # 4-byte code points, the case a 2-bytes-per-token floor would miss
    "a" * 500,
    "SGVsbG8sIFdvcmxkIQ==" * 5,  # base64: the named class that defeats the merge credit
    "blk_2ymglyzij4jpk22k",
)


def test_the_atom_segmentation_never_loses_a_character(index: PaperIndex) -> None:
    """`"".join(atoms(s)) == s` for every s. The property the whole estimate rests on.

    A segmentation that skipped a character — an underscore falling between two alternatives of a
    regex, say — would under-count by exactly the bytes it skipped, silently, and only on the
    strings containing that character. Checked against real parsed block text and against a list of
    strings chosen to break it.
    """
    for text in list(_ADVERSARIAL_TEXT) + _real_block_texts(index):
        rejoined = "".join(match.group(0) for match in _ATOM.finditer(text))
        assert rejoined == text, f"segmentation lost characters in {text[:60]!r}"


def test_the_provable_configuration_is_exactly_the_utf8_byte_count() -> None:
    """`bytes_per_token_floor=1` is the theorem: no byte-level BPE emits more tokens than bytes."""
    for text in _ADVERSARIAL_TEXT:
        assert TOKENIZER_AGNOSTIC_ESTIMATOR.estimate(text) == len(text.encode("utf-8"))


def test_a_floor_below_one_is_rejected() -> None:
    with pytest.raises(ValueError, match="must be >= 1"):
        AtomTokenEstimator(bytes_per_token_floor=0)


@dataclass(frozen=True, slots=True)
class _NaiveCharsPerTokenEstimator:
    """The folk estimate — "about four characters to a token" — as a `TokenEstimator`.

    Present only so `test_the_under_count_check_has_teeth` has something real to fail against. It
    is what this package would have shipped if the estimator had been written in one line, and it
    under-counts every short-worded block in the corpus.
    """

    chars_per_token: int

    @property
    def name(self) -> str:
        return f"naive/chars={self.chars_per_token}"

    def estimate(self, text: str) -> int:
        return len(text) // self.chars_per_token


def _word_count(text: str) -> int:
    return len(text.split())


def _sandwich_violations(estimator: TokenEstimator, texts: list[str]) -> list[str]:
    """Texts where the estimate falls outside [word count, utf-8 bytes]. Both bounds are real."""
    bad: list[str] = []
    for text in texts:
        estimate = estimator.estimate(text)
        if estimate < _word_count(text) or estimate > len(text.encode("utf-8")):
            bad.append(text)
    return bad


def test_the_default_estimator_never_under_counts_real_block_text(index: PaperIndex) -> None:
    """The lower bound is >=1 token per whitespace word; the upper bound is the byte count.

    Both hold for any byte-level BPE whose pre-tokenizer does not merge across whitespace, so an
    estimate outside that sandwich is provably wrong in a stated direction. Run over every
    non-empty block of real parsed text this run has.
    """
    texts = _real_block_texts(index)
    assert len(texts) >= 8, f"only {len(texts)} blocks of real text; this is too thin to mean much"
    assert _sandwich_violations(DEFAULT_TOKEN_ESTIMATOR, texts) == []
    assert _sandwich_violations(TOKENIZER_AGNOSTIC_ESTIMATOR, texts) == []


def test_the_under_count_check_has_teeth(index: PaperIndex) -> None:
    """The same check, against the estimator most people would write instead.

    Otherwise the test above is decorative, and this repo has shipped decorative assertions before
    (AGENTS.md §2). `len(text) // 4` is the folk estimate — four characters to a token — and it
    breaks the word-count bound on exactly the text a paper is full of: a page number ("1" -> 0
    tokens against 1 word), an equation, a short heading, any line whose words are short.

    Note precisely what this does NOT establish. Because `AtomTokenEstimator` charges at least one
    token per atom, ">= 1 token per word" holds for ANY `bytes_per_token_floor` — so the sandwich
    validates the SEGMENTATION, not the choice of 2. The divisor's safety is an argument in
    `budget.py`'s docstring, and it cannot become a measurement until a real tokenizer exists here.
    """
    naive = _NaiveCharsPerTokenEstimator(chars_per_token=4)
    texts = _real_block_texts(index)
    violations = _sandwich_violations(naive, texts)
    assert violations, "len(text)//4 was expected to under-count real block text and did not"
    print(
        f"\n[retrieval] len(text)//4 under-counts {len(violations)} of {len(texts)} real blocks; "
        f"the default estimator under-counts 0"
    )


def test_the_default_estimator_is_measurably_tighter_than_the_provable_one(
    index: PaperIndex,
) -> None:
    """The measurement `budget.py` quotes, recomputed rather than trusted.

    Prints the two ratios so a reader of the test log sees the real numbers for this run instead of
    a figure written down once and left to rot (AGENTS.md §2: "numbers get re-derived, not
    quoted"). The assertions bracket them loosely — the point is the direction and the order of
    magnitude, not a threshold nobody chose.
    """
    corpus = "\n".join(_real_block_texts(index))
    estimate = DEFAULT_TOKEN_ESTIMATOR.estimate(corpus)
    provable = len(corpus.encode("utf-8"))
    words = _word_count(corpus)

    print(
        f"\n[retrieval] estimator on {len(corpus)} chars of real parsed text: "
        f"estimate={estimate} bytes={provable} words={words} "
        f"estimate/bytes={estimate / provable:.3f} estimate/word={estimate / words:.2f}"
    )
    assert 0.3 < estimate / provable < 0.95
    assert estimate / words > 1.0
    assert estimate < provable


# ── end to end, on a real parsed paper ───────────────────────────────────────────────────────


def test_a_package_from_a_real_expansion_is_complete_and_deterministic(index: PaperIndex) -> None:
    """The ordinary case: a real selection on a real paper fits, so nothing is dropped at all."""
    caption = next(
        block_id
        for block_id in index.reading_order
        if (block := index.block(block_id)) is not None and block.type == "caption"
    )
    expansion = expand(index, [caption], DEFAULT_EXPANSION_POLICY, None)

    first = assemble_evidence(expansion, DEFAULT_BUDGET_POLICY, DEFAULT_TOKEN_ESTIMATOR)
    second = assemble_evidence(expansion, DEFAULT_BUDGET_POLICY, DEFAULT_TOKEN_ESTIMATOR)

    assert first == second
    assert first.complete is True
    assert first.truncation == ()
    assert first.total_tokens < EVIDENCE_CEILING_TOKENS
    assert first.estimator_name == "atom/floor=2"
    assert first.block_ids == expansion.block_ids
    assert caption in first.render()
    assert first.usage_for(Component.SELECTION).items_kept == 1


@requires_corpus
def test_the_estimator_bounds_hold_on_every_block_of_a_real_paper() -> None:
    """3,000+ blocks of real two-column CVPR text, including maths, tables and a bibliography.

    SKIPS ON CI — the corpus is gitignored. The synthetic paper checks the same bounds on every
    push; this checks them at a scale and a character diversity the synthetic paper cannot reach.
    """
    paper = corpus_paper(CORPUS_PAPER)
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    texts = _real_block_texts(index)
    assert len(texts) > 300, f"expected hundreds of text-bearing blocks, got {len(texts)}"

    assert _sandwich_violations(DEFAULT_TOKEN_ESTIMATOR, texts) == []

    joined = "\n".join(texts)
    estimate = DEFAULT_TOKEN_ESTIMATOR.estimate(joined)
    provable = len(joined.encode("utf-8"))
    words = _word_count(joined)
    print(
        f"\n[retrieval] corpus estimator: blocks={len(texts)} chars={len(joined)} "
        f"estimate={estimate} bytes={provable} words={words} "
        f"estimate/bytes={estimate / provable:.3f} estimate/word={estimate / words:.2f}"
    )
    assert estimate < provable


@requires_corpus
def test_the_ceiling_holds_on_a_real_selection_in_a_real_paper() -> None:
    """A 974-block paper, a table cell selection, and the full default policy. SKIPS ON CI."""
    paper = corpus_paper(CORPUS_PAPER)
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    paragraphs = [
        block_id
        for block_id in index.reading_order
        if (block := index.block(block_id)) is not None
        and block.type == "paragraph"
        and len(block.text) > 400
    ]
    assert paragraphs
    expansion = expand(index, paragraphs[:4], DEFAULT_EXPANSION_POLICY, None)
    package = assemble_evidence(expansion, DEFAULT_BUDGET_POLICY, DEFAULT_TOKEN_ESTIMATOR)

    assert package.total_tokens <= EVIDENCE_CEILING_TOKENS
    assert DEFAULT_TOKEN_ESTIMATOR.estimate(package.render()) <= package.total_tokens
    kept = list(package.block_ids)
    dropped = [b for record in package.truncation for b in record.dropped_block_ids]
    assert sorted(kept + dropped) == sorted(expansion.block_ids)
