"""``PaperIndexCache`` — the bounded, cross-request cache of loaded paper generations.

contracts.md §4: the agent's paper tools read through a ``PaperIndex`` that is LRU-cached by
``(user_id, paper_id, generation)``, 8 entries, because building one costs 38-420 ms per request
(QUOTED, proposal A) and a run makes up to 16 tool requests against the same paper.

THREE RULES, EACH A BUG THE OBVIOUS CACHE HAS:

  1. THE USER IS IN THE KEY (contracts.md §4). Today a ``paper_id`` is derived from (user, bytes),
     so two users never share one — but a cache must not make isolation depend on how an id is
     minted elsewhere. Keyed by ``(user_id, paper_id, generation)``, a hit can only ever be an
     index that the SAME user's read-only handle loaded.
  2. WHAT IS CACHED IS DETACHED (``PaperIndex.detached``). The index a loader returns keeps the
     reader it was read through — an ``AgentDataHandle`` the request closes when it ends. Caching
     that object would cache a closed connection bound to the first requester.
  3. A STAMP GUARDS STALENESS. The key names a generation, and a generation is written in one
     transaction and never edited — but it can be DELETED and written again (a paper deleted and
     re-uploaded, a failed generation retried). The caller passes the generation's
     ``papers.created_at`` as the stamp (one indexed row read per request); a different stamp is a
     miss, never a stale hit.

The cache is process-local and in memory. It holds at most ``max_entries`` indexes; the least
recently USED is evicted first. A ``threading.Lock`` makes it safe to share between threads,
though the API calls it from one event loop.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final

from papertree_retrieval.index import PaperIndex
from papertree_retrieval.lexical import LexicalIndex

__all__ = ["DEFAULT_CACHE_ENTRIES", "CachedPaper", "PaperIndexCache"]

#: contracts.md §4.
DEFAULT_CACHE_ENTRIES: Final = 8

CacheKey = tuple[str, str, int]


@dataclass(frozen=True, slots=True)
class CachedPaper:
    """One cached generation: the detached index, and the BM25 index over its text blocks (built
    once with it, so ``search_passages`` does not re-tokenise the paper on every call)."""

    index: PaperIndex
    lexical: LexicalIndex
    stamp: str


class PaperIndexCache:
    __slots__ = ("_entries", "_lock", "hits", "max_entries", "misses")

    def __init__(self, max_entries: int = DEFAULT_CACHE_ENTRIES) -> None:
        if max_entries < 1:
            raise ValueError(f"max_entries must be >= 1, got {max_entries}")
        self.max_entries = max_entries
        self._entries: OrderedDict[CacheKey, CachedPaper] = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(
        self,
        user_id: str,
        paper_id: str,
        generation: int,
        *,
        stamp: str,
        load: Callable[[], PaperIndex],
    ) -> CachedPaper:
        """The cached generation, or ``load()``'s, detached, stored and returned.

        ``load`` runs under this cache's lock, so two concurrent misses for one key load once. It
        may raise (``KeyError`` for a generation this user does not have); nothing is cached then.
        """
        key: CacheKey = (user_id, paper_id, generation)
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry.stamp == stamp:
                self._entries.move_to_end(key)
                self.hits += 1
                return entry
            self.misses += 1
            index = load().detached()
            entry = CachedPaper(index=index, lexical=LexicalIndex.build(index), stamp=stamp)
            self._entries[key] = entry
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)
            return entry

    def __len__(self) -> int:
        return len(self._entries)

    def lru_order(self) -> tuple[CacheKey, ...]:
        """Least recently used first."""
        with self._lock:
            return tuple(self._entries)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
