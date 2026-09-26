"""``lexical.LexicalIndex``: BM25 over the reading-order text blocks (``search_passages``, §4).

The synthetic PDF runs on CI; the resnet run is corpus-gated and skips loudly.
"""

from __future__ import annotations

from _retrieval_corpus import CORPUS_PAPER, requires_corpus
from _retrieval_fixtures import corpus_paper, synthetic_paper
from papertree_retrieval import LexicalIndex, PaperIndex, tokenize


def _index() -> PaperIndex:
    paper = synthetic_paper()
    return PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)


def test_tokens_are_lowercase_words_without_stopwords() -> None:
    assert tokenize("The R-CNN pipeline runs at 45.5 FPS, and it is slow.") == (
        "r-cnn",
        "pipeline",
        "runs",
        "45.5",
        "fps",
        "slow",
    )


def test_the_block_that_says_it_ranks_first() -> None:
    index = _index()
    lexical = LexicalIndex.build(index)
    hits = lexical.search("shortcut connection identity mapping", 3)
    assert hits, "a phrase printed in the paper must be found"
    top = index.block(hits[0].block_id)
    assert top is not None and "shortcut connection performs identity mapping" in top.text
    assert [h.score for h in hits] == sorted((h.score for h in hits), reverse=True)


def test_no_match_is_empty_and_furniture_is_never_searched() -> None:
    index = _index()
    lexical = LexicalIndex.build(index)
    assert lexical.search("transformer quantum lattice", 8) == ()
    assert lexical.search("the of and", 8) == (), "a stopword-only query matches nothing"
    # "Preprint. Under review." is printed on both pages, in the header flow, and nowhere else.
    flows = {block.flow for b in index.reading_order if (block := index.block(b)) is not None}
    assert "header" in flows, "the fixture has furniture, so the exclusion is exercised"
    assert lexical.search("preprint review", 8) == (), "the running head is never a passage"


def test_limit_and_ties_are_deterministic() -> None:
    index = _index()
    one, two = LexicalIndex.build(index), LexicalIndex.build(index)
    assert one.search("residual", 8) == two.search("residual", 8)
    assert len(one.search("residual", 1)) == 1
    assert one.search("residual", 0) == ()


@requires_corpus
def test_on_resnet_a_real_query_finds_the_passage_that_answers_it() -> None:
    paper = corpus_paper(CORPUS_PAPER)
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    lexical = LexicalIndex.build(index)
    hits = lexical.search("identity shortcut projection", 5)
    texts = [block.text.lower() for h in hits if (block := index.block(h.block_id)) is not None]
    print(f"\n[lexical] resnet: {len(lexical)} searchable blocks; top hit: {texts[0][:100]!r}")
    assert texts and "shortcut" in texts[0] and "identity" in texts[0]
