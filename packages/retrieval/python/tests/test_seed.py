"""``seed.build_seed`` (contracts.md §3.2): the selected blocks FIRST, under <= 3,000 estimated
tokens, whole blocks or nothing, and a too-long selection trimmed AROUND the selected text."""

from __future__ import annotations

import pytest
from _retrieval_corpus import CORPUS_PAPER, requires_corpus
from _retrieval_fixtures import corpus_paper, synthetic_paper
from papertree_retrieval import (
    DEFAULT_TOKEN_ESTIMATOR,
    SEED_BUDGET_TOKENS,
    TEXT_TRUNCATION_MARKER,
    PaperIndex,
    Stage,
    build_seed,
)


def _index() -> PaperIndex:
    paper = synthetic_paper()
    return PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)


def _paragraph(index: PaperIndex, needle: str) -> str:
    for block_id in index.reading_order:
        block = index.block(block_id)
        if block is not None and block.type == "paragraph" and needle in block.text:
            return block_id
    raise AssertionError(f"no paragraph with {needle!r}; the fixture drifted")


def test_the_selected_block_comes_first_and_the_budget_holds() -> None:
    index = _index()
    selected = _paragraph(index, "shortcut connection")
    seed = build_seed(index, [selected])
    assert seed.passages[0].block_id == selected
    assert seed.passages[0].stage is Stage.SELECTION and not seed.passages[0].truncated
    assert seed.total_tokens <= SEED_BUDGET_TOKENS == 3000
    assert seed.total_tokens == sum(p.tokens for p in seed.passages)
    assert len(seed.passages) > 1, "the ladder added context around the selection"
    assert all(p.text.strip() for p in seed.passages), "a textless block (a figure) is skipped"


def test_whole_blocks_are_dropped_and_recorded_when_the_budget_is_spent() -> None:
    index = _index()
    selected = _paragraph(index, "shortcut connection")
    full = build_seed(index, [selected])
    first = full.passages[0].tokens
    tight = build_seed(index, [selected], budget_tokens=first + 1)
    assert tight.block_ids == (selected,)
    assert tight.dropped, "what did not fit is recorded, not silently absent"
    assert set(tight.dropped) <= set(full.block_ids) | set(full.dropped)


def test_a_selection_longer_than_the_budget_is_trimmed_around_the_selected_text() -> None:
    index = _index()
    selected = _paragraph(index, "benchmarks")
    text = index.block(selected).text  # type: ignore[union-attr]
    focus = "Figure 1 below"
    assert focus in text and text.index(focus) > 60
    budget = DEFAULT_TOKEN_ESTIMATOR.estimate(text) // 3
    seed = build_seed(index, [selected], focus=focus, budget_tokens=budget)
    head = seed.passages[0]
    assert head.block_id == selected and head.truncated
    assert focus.split()[0] in head.text, "the window contains the selected text"
    assert head.tokens <= budget and seed.total_tokens <= budget
    assert head.text.endswith(TEXT_TRUNCATION_MARKER) or head.text.startswith("…")


def test_the_cost_function_is_what_is_spent() -> None:
    """The API spends the budget on the DATAMARKED text; a costlier rendering fits fewer blocks."""
    index = _index()
    selected = _paragraph(index, "shortcut connection")
    raw = build_seed(index, [selected], budget_tokens=200)
    marked = build_seed(
        index,
        [selected],
        budget_tokens=200,
        cost=lambda text: 3 * DEFAULT_TOKEN_ESTIMATOR.estimate(text),
    )
    assert marked.total_tokens <= 200 and raw.total_tokens <= 200
    assert len(marked.passages) <= len(raw.passages)


def test_nothing_selected_in_this_paper_is_refused() -> None:
    index = _index()
    with pytest.raises(KeyError):
        build_seed(index, ["blk_not_in_this_paper"])
    with pytest.raises(ValueError):
        build_seed(index, [])


@requires_corpus
def test_on_resnet_the_seed_opens_with_the_selection_not_the_front_matter() -> None:
    """The baseline defect (journey C): answers opened with the title and authors, because the old
    package put the outline first. A body paragraph mid-paper must seed with itself."""
    paper = corpus_paper(CORPUS_PAPER)
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    paragraphs = [
        b for b in index.reading_order if (blk := index.block(b)) and blk.type == "paragraph"
    ]
    selected = paragraphs[len(paragraphs) // 2]
    seed = build_seed(index, [selected])
    types = [index.block(p.block_id).type for p in seed.passages]  # type: ignore[union-attr]
    print(
        f"\n[seed] resnet: {len(seed.passages)} passages, {seed.total_tokens} est. tokens "
        f"(budget {seed.budget_tokens}), dropped {len(seed.dropped)}; types {types}"
    )
    assert seed.passages[0].block_id == selected
    assert types[0] == "paragraph" and "title" not in types[:1] and "author" not in types[:1]
    assert seed.total_tokens <= 3000
