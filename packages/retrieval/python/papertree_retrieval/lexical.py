"""BM25 over one paper's text blocks, in reading order — ``search_passages`` (contracts.md §4).

WHY LEXICAL, AND WHY HERE. The agent's fourth tool finds passages by words. There are no
embeddings in this repository (``expansion.py``: "the real-model delta is NOT MEASURED"), and the
old registry's ``search_semantic_blocks`` returned nothing on every real paper for that reason. BM25
needs nothing but the text the index already holds, it is deterministic, and it is the standard
first rung of any retrieval stack. It lives in ``packages/retrieval`` beside ``PaperIndex`` because
it is a view over the same blocks, and the API's tool route only calls it.

WHAT IS A DOCUMENT. Every block in ``PaperIndex.reading_order`` that has text and sits in a reading
flow (``body``, ``caption``, ``footnote``). Page furniture (``header``, ``footer``, ``margin``: the
running title, the page number, the arXiv stamp) is not searched: it repeats on every page, so it
would match any query naming the paper's title and push real passages down. ``Block.text`` is never
read: ``IndexedBlock.text`` is ``resolved_text(apply_proposed=False)`` (D4).

THE FORMULA is Okapi BM25 with the usual constants (``k1 = 1.2``, ``b = 0.75``) and the
non-negative IDF ``ln(1 + (N - df + 0.5) / (df + 0.5))``, so a term in every block scores ~0
instead of negative. A block's score is the sum over the query's DISTINCT terms. Ties are broken by
reading order, then block id, so two runs on one paper return the same list.

TOKENS are lowercase runs of letters and digits (a decimal point or a hyphen inside a run is kept:
``2.5``, ``r-cnn``), minus a short English stopword list. No stemming: a missing stemmer costs
recall on inflections, a wrong one costs precision everywhere, and neither is measured here.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from papertree_retrieval.index import PaperIndex

__all__ = ["BM25_B", "BM25_K1", "SEARCH_FLOWS", "LexicalHit", "LexicalIndex", "tokenize"]

BM25_K1: Final = 1.2
BM25_B: Final = 0.75
#: The flows a reader reads. See the module docstring for why furniture is not searched.
SEARCH_FLOWS: Final = frozenset({"body", "caption", "footnote"})

_TOKEN: Final = re.compile(r"[0-9a-z]+(?:[.\-][0-9a-z]+)*")
_STOPWORDS: Final = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "been",
        "but",
        "by",
        "can",
        "did",
        "do",
        "does",
        "for",
        "from",
        "had",
        "has",
        "have",
        "how",
        "i",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "it's",
        "may",
        "more",
        "most",
        "no",
        "not",
        "of",
        "on",
        "or",
        "our",
        "so",
        "such",
        "than",
        "that",
        "the",
        "their",
        "then",
        "there",
        "these",
        "they",
        "this",
        "those",
        "to",
        "was",
        "we",
        "were",
        "what",
        "when",
        "where",
        "which",
        "while",
        "who",
        "why",
        "will",
        "with",
        "would",
        "you",
    }
)


def tokenize(text: str) -> tuple[str, ...]:
    """Lowercase word tokens without stopwords, in order."""
    return tuple(t for t in _TOKEN.findall(text.lower()) if t not in _STOPWORDS)


@dataclass(frozen=True, slots=True)
class LexicalHit:
    block_id: str
    score: float


class LexicalIndex:
    """BM25 over one ``PaperIndex``. Build once per generation (``cache.PaperIndexCache`` does)."""

    __slots__ = ("_avg_length", "_df", "_docs", "_lengths", "_rank", "_tf")

    def __init__(self, docs: Sequence[tuple[str, tuple[str, ...]]], rank: dict[str, int]) -> None:
        self._docs: tuple[str, ...] = tuple(block_id for block_id, _tokens in docs)
        self._tf: dict[str, Counter[str]] = {block_id: Counter(tokens) for block_id, tokens in docs}
        self._lengths: dict[str, int] = {block_id: len(tokens) for block_id, tokens in docs}
        self._avg_length = (sum(self._lengths.values()) / len(docs)) if docs else 0.0
        df: Counter[str] = Counter()
        for _block_id, tokens in docs:
            df.update(set(tokens))
        self._df = df
        self._rank = rank

    @classmethod
    def build(cls, index: PaperIndex) -> LexicalIndex:
        docs: list[tuple[str, tuple[str, ...]]] = []
        for block_id in index.reading_order:
            block = index.block(block_id)
            if block is None or block.flow not in SEARCH_FLOWS or not block.text.strip():
                continue
            tokens = tokenize(block.text)
            if tokens:
                docs.append((block_id, tokens))
        return cls(docs, {block_id: index.rank(block_id) for block_id, _tokens in docs})

    def __len__(self) -> int:
        return len(self._docs)

    def search(self, query: str, limit: int) -> tuple[LexicalHit, ...]:
        """The top ``limit`` blocks with a positive score, best first. Empty on no match."""
        if limit < 1:
            return ()
        terms = tuple(dict.fromkeys(tokenize(query)))
        if not terms or not self._docs:
            return ()
        n = len(self._docs)
        idf = {
            term: math.log(1.0 + (n - self._df[term] + 0.5) / (self._df[term] + 0.5))
            for term in terms
            if self._df[term] > 0
        }
        if not idf:
            return ()
        scored: list[tuple[float, int, str]] = []
        for block_id in self._docs:
            tf = self._tf[block_id]
            length_norm = 1.0 - BM25_B + BM25_B * (self._lengths[block_id] / self._avg_length)
            score = 0.0
            for term, weight in idf.items():
                frequency = tf.get(term, 0)
                if frequency:
                    score += (
                        weight * frequency * (BM25_K1 + 1) / (frequency + BM25_K1 * length_norm)
                    )
            if score > 0:
                scored.append((-score, self._rank.get(block_id, n), block_id))
        scored.sort()
        return tuple(LexicalHit(block_id, -neg) for neg, _rank, block_id in scored[:limit])
