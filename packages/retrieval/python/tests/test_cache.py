"""``PaperIndexCache`` (contracts.md §4): LRU of 8, keyed by (user, paper, generation), detached.

Runs on the synthetic PDF parsed in process (``_retrieval_fixtures``), so it executes on CI.
"""

from __future__ import annotations

import pytest
from _retrieval_fixtures import ParsedPaper, synthetic_paper
from papertree_db import generation
from papertree_memory import AgentDataHandle
from papertree_retrieval import DEFAULT_CACHE_ENTRIES, PaperIndex, PaperIndexCache


def _loader(paper: ParsedPaper, calls: list[int]) -> PaperIndex:
    """What the API's tool route does: read through the READ-ONLY handle, then close it."""
    calls.append(1)
    with AgentDataHandle(paper.database_path, paper.user_id) as handle:
        return PaperIndex.from_reader(handle, paper.paper_id, paper.generation)


def test_a_hit_serves_the_same_detached_index_without_loading_again() -> None:
    paper = synthetic_paper()
    cache = PaperIndexCache()
    calls: list[int] = []
    first = cache.get(
        paper.user_id, paper.paper_id, 1, stamp="t1", load=lambda: _loader(paper, calls)
    )
    second = cache.get(
        paper.user_id, paper.paper_id, 1, stamp="t1", load=lambda: _loader(paper, calls)
    )
    assert first is second and len(calls) == 1
    assert (cache.hits, cache.misses) == (1, 1)
    # The handle the loader read through is CLOSED now; the cached index still answers every
    # structural question, because a detached copy holds only the loaded rows.
    index = first.index
    assert len(index) == len(paper.document["blocks"])
    body = [
        b
        for b in index.reading_order
        if (block := index.block(b)) is not None and block.flow == "body"
    ]
    assert len(body) > 2 and index.sections, "structural reads work on the detached copy"
    assert index.adjacent(body[1], 1) == ((body[0],), (body[2],))
    with pytest.raises(RuntimeError, match="detached"):
        index.search_vectors([0.0] * 768, 3)


def test_the_user_is_part_of_the_key() -> None:
    """The same (paper, generation) under another user is another entry: a hit is only ever an
    index the same user's handle loaded, whatever the paper-id scheme is."""
    paper = synthetic_paper()
    cache = PaperIndexCache()
    calls: list[int] = []
    cache.get(paper.user_id, paper.paper_id, 1, stamp="t", load=lambda: _loader(paper, calls))
    cache.get("usr_someone_else", paper.paper_id, 1, stamp="t", load=lambda: _loader(paper, calls))
    assert len(calls) == 2 and len(cache) == 2


def test_a_changed_stamp_is_a_miss_never_a_stale_hit() -> None:
    paper = synthetic_paper()
    cache = PaperIndexCache()
    calls: list[int] = []
    first = cache.get(
        paper.user_id, paper.paper_id, 1, stamp="a", load=lambda: _loader(paper, calls)
    )
    second = cache.get(
        paper.user_id, paper.paper_id, 1, stamp="b", load=lambda: _loader(paper, calls)
    )
    assert first is not second and len(calls) == 2 and len(cache) == 1


def test_eight_entries_least_recently_used_out_first() -> None:
    paper = synthetic_paper()
    cache = PaperIndexCache()
    assert cache.max_entries == DEFAULT_CACHE_ENTRIES == 8
    calls: list[int] = []
    for n in range(8):
        cache.get(f"usr_{n}", paper.paper_id, 1, stamp="s", load=lambda: _loader(paper, calls))
    cache.get("usr_0", paper.paper_id, 1, stamp="s", load=lambda: _loader(paper, calls))  # touch
    cache.get("usr_8", paper.paper_id, 1, stamp="s", load=lambda: _loader(paper, calls))
    assert len(cache) == 8
    users = [key[0] for key in cache.lru_order()]
    assert "usr_1" not in users, "the least recently USED entry is evicted"
    assert "usr_0" in users and users[-1] == "usr_8"
    assert len(calls) == 9


def test_a_failing_load_caches_nothing() -> None:
    paper = synthetic_paper()
    cache = PaperIndexCache()

    def missing() -> PaperIndex:
        with AgentDataHandle(paper.database_path, paper.user_id) as handle:
            return PaperIndex.from_reader(handle, paper.paper_id, generation(99))

    with pytest.raises(KeyError):
        cache.get(paper.user_id, paper.paper_id, 99, stamp="s", load=missing)
    assert len(cache) == 0
