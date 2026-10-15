"""``digest.build_digest`` (contracts.md §3.2, S5F): the seed of a summary run is a bounded digest
of the whole paper, picked by the host (abstract, each top-level section's first paragraph(s), the
conclusion), so a summary does not have to read its way through the paper with tools."""

from __future__ import annotations

import pytest
from _retrieval_corpus import CORPUS_PAPER, requires_corpus
from _retrieval_fixtures import corpus_paper, synthetic_paper
from papertree_retrieval import (
    DEFAULT_TOKEN_ESTIMATOR,
    DIGEST_BUDGET_TOKENS,
    TEXT_TRUNCATION_MARKER,
    PaperIndex,
    build_digest,
)


def _index() -> PaperIndex:
    paper = synthetic_paper()
    return PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)


def test_the_digest_is_the_first_paragraph_of_each_section_in_reading_order() -> None:
    index = _index()
    digest = build_digest(index)
    assert DIGEST_BUDGET_TOKENS == 6000
    texts = [index.block(b).text for b in digest.block_ids]  # type: ignore[union-attr]
    assert len(texts) == 2, "one paragraph for 1 Introduction, one for 2 Method"
    assert texts[0].startswith("Deep networks are more difficult")
    assert texts[1].startswith("The shortcut connection performs identity mapping")
    ranks = [index.rank(b) for b in digest.block_ids]
    assert ranks == sorted(ranks)
    assert [p.role for p in digest.passages] == ["section", "section"]
    assert digest.total_tokens == sum(p.tokens for p in digest.passages) <= digest.budget_tokens


def test_equations_figures_captions_and_references_are_not_in_the_digest() -> None:
    index = _index()
    types = {index.block(b).type for b in build_digest(index).block_ids}  # type: ignore[union-attr]
    assert types == {"paragraph"}


def test_a_tight_budget_shrinks_the_allowance_before_a_section_goes() -> None:
    index = _index()
    full = build_digest(index)
    tight = build_digest(index, budget_tokens=full.passages[0].tokens + 1)
    assert tight.allowance < full.allowance
    assert tight.block_ids == full.block_ids[:1]
    assert len(tight.dropped_sections) == 1
    assert tight.total_tokens <= tight.budget_tokens


def test_the_first_section_is_kept_however_small_the_budget_is_and_the_drop_is_recorded() -> None:
    index = _index()
    tiny = build_digest(index, budget_tokens=60)
    assert tiny.passages, "never empty for a paper that has prose"
    assert tiny.block_ids[0] == build_digest(index).block_ids[0]
    assert tiny.total_tokens <= 60 or len(tiny.passages) == 1
    assert tiny.dropped_sections, "what was left out is recorded, not hidden"


def test_the_cost_function_is_the_callers_so_marked_text_is_what_the_budget_counts() -> None:
    index = _index()
    raw = build_digest(index)
    marked = build_digest(index, cost=lambda t: 3 * DEFAULT_TOKEN_ESTIMATOR.estimate(t))
    assert marked.total_tokens > raw.total_tokens


def test_it_is_deterministic() -> None:
    index = _index()
    assert build_digest(index) == build_digest(index)


def test_a_budget_below_one_is_refused() -> None:
    with pytest.raises(ValueError):
        build_digest(_index(), budget_tokens=0)


@requires_corpus
def test_a_real_paper_gets_its_abstract_its_sections_and_its_conclusion_within_budget() -> None:
    paper = corpus_paper(CORPUS_PAPER)
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    digest = build_digest(index)
    roles = [p.role for p in digest.passages]
    assert digest.total_tokens <= DIGEST_BUDGET_TOKENS
    assert roles[0] == "abstract" and "section" in roles
    titles = []
    for passage in digest.passages:
        section = index.section_of(passage.block_id)
        if section is not None:
            titles.append(index.block(section.heading_block_id).text.lower())  # type: ignore[union-attr]
    assert titles, "every passage but the abstract sits in a titled section"
    assert not any("references" in t or "acknowledg" in t or t.startswith("a. ") for t in titles), (
        "the digest stops at the back matter"
    )


@requires_corpus
def test_on_a_real_paper_a_long_paragraph_is_cut_at_a_word_and_marked() -> None:
    paper = corpus_paper(CORPUS_PAPER)
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    digest = build_digest(index, budget_tokens=1_200)
    assert digest.total_tokens <= 1_200
    cut = [p for p in digest.passages if p.truncated]
    assert cut, "a 1,200-token digest of a full paper cuts paragraphs"
    for passage in cut:
        assert passage.text.endswith(TEXT_TRUNCATION_MARKER)
        start = passage.text.removesuffix(TEXT_TRUNCATION_MARKER)
        assert index.block(passage.block_id).text.startswith(start)  # type: ignore[union-attr]
        assert not start.endswith(" ")
