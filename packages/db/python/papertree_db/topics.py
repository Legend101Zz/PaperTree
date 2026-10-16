"""Topics: the person's own shelves, and which paper sits under which (issue #193, part 1).

Owns the ``topics`` and ``paper_topics`` tables of ``0009_topics.sql`` and the one pure rule that
proposes a shelf for a paper (``suggest_by_category``). ``TopicsMixin`` is the database half of the
``/topics`` routes; the routes and the seam where part 2's model call plugs in live in the API.

THE RULE THAT MATTERS: a suggestion never shelves a paper. ``paper_topics.status`` says which of
the three things a row is, and only ``accepted`` groups the shelf (``LibraryRow.topic``).

WHY THE CATEGORIES ARE READ THROUGH ``list_library``. The arXiv category of a paper is derived from
its parsed margin stamp (``library.stamp_category``), not stored, so the topic's categories and the
suggestion take it from the same ``LibraryRow`` the shelf shows: there is one definition of "the
paper's category" and it cannot drift between the shelf and the topics.
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Literal

from ._support import now_iso
from .errors import PaperNotFound, TopicExists, TopicNotFound
from .ids import OwnerId, PaperId, new_id
from .library import LibraryMixin

#: The six cloth colours of the design (``topics.cloth``).
CLOTHS: Final = ("transformers", "vision", "generative", "optimization", "language", "rl")

#: The longest topic name. Enforced here and by the API, not by a CHECK (see 0009).
TOPIC_NAME_MAX: Final = 60

_SQLITE_INTEGER_MAX: Final = 2**63 - 1

TopicSource = Literal["arxiv_category", "manual", "model"]
PaperTopicStatus = Literal["none", "suggested", "accepted", "rejected"]


@dataclass(frozen=True, slots=True)
class TopicRef:
    """A topic as another record points at it."""

    topic_id: str
    name: str
    cloth: str | None


@dataclass(frozen=True, slots=True)
class TopicRow:
    """One topic with what it holds (accepted papers only)."""

    topic_id: str
    name: str
    cloth: str | None
    sort_order: int
    created_at: str
    paper_count: int
    #: Sum of the held papers' page counts (a paper of unknown length counts for 0).
    page_count: int
    #: Distinct ``arxiv_category`` of the held papers, sorted.
    categories: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class TopicSuggestion:
    """An offer of a shelf for a paper: an EXISTING topic, or the name of a new one.

    Exactly one of ``topic_id`` and ``suggested_name`` is set.
    """

    topic_id: str | None
    suggested_name: str | None
    source: TopicSource
    #: ``cs.CL`` for ``arxiv_category``, the model id for ``model``, else None.
    source_detail: str | None


@dataclass(frozen=True, slots=True)
class PaperTopicRow:
    """A paper's relationship to the topics, as ``GET /papers/{id}/topic`` reports it."""

    paper_id: str
    status: PaperTopicStatus
    #: The topic accepted, offered or rejected; None for ``none`` or a proposed new name.
    topic: TopicRef | None
    suggested_name: str | None
    source: TopicSource | None
    source_detail: str | None
    decided_at: str | None
    #: The paper's own category, shown whatever the status ("suggested from arXiv cs.CL").
    arxiv_category: str | None


@dataclass(frozen=True, slots=True)
class Holding:
    """One accepted placement, the input of ``suggest_by_category``."""

    topic_id: str
    #: The arXiv category of the held paper, or None.
    category: str | None
    #: When the person accepted it (an ISO instant); the tie-break "most recently used".
    decided_at: str


def suggest_by_category(
    category: str | None, holdings: Sequence[Holding]
) -> TopicSuggestion | None:
    """The person's existing topic that already holds the most papers of ``category``.

    Ties go to the topic whose matching paper was accepted most recently, then to the smaller
    ``topic_id`` so the answer never depends on row order. Never invents a topic name: with no
    category, or no topic holding a paper of it, there is NO deterministic suggestion and the
    caller may ask a model (part 2). Nothing here writes; a suggestion shelves nothing.

    Args:
        category: The paper's arXiv category (``cs.CL``), or None when it has none.
        holdings: Every accepted placement the person has, with its paper's category.

    Returns:
        A suggestion with ``source='arxiv_category'`` and ``source_detail=category``, or None.

    Example:
        Two ``cs.CL`` papers under "Transformers" and one under "Reading list" suggest
        "Transformers" for a new ``cs.CL`` paper.
    """
    if category is None:
        return None
    count: dict[str, int] = defaultdict(int)
    latest: dict[str, str] = {}
    for holding in holdings:
        if holding.category != category:
            continue
        count[holding.topic_id] += 1
        latest[holding.topic_id] = max(latest.get(holding.topic_id, ""), holding.decided_at)
    if not count:
        return None
    # Highest count, then latest use. `max` keeps the FIRST of equals, so walking the ids in order
    # makes the smallest id the last tie-break and the answer independent of row order.
    best = max(sorted(count), key=lambda topic: (count[topic], latest[topic]))
    return TopicSuggestion(
        topic_id=best, suggested_name=None, source="arxiv_category", source_detail=category
    )


def clean_topic_name(name: str) -> str:
    """The name trimmed, or ValueError when it is empty or over ``TOPIC_NAME_MAX`` characters."""
    trimmed = name.strip()
    if not trimmed or len(trimmed) > TOPIC_NAME_MAX:
        raise ValueError(f"topic name must be 1 to {TOPIC_NAME_MAX} characters")
    return trimmed


def _check_cloth(cloth: str | None) -> None:
    if cloth is not None and cloth not in CLOTHS:
        raise ValueError(f"cloth must be one of {list(CLOTHS)}, got {cloth!r}")


class TopicsMixin(LibraryMixin):
    """``PaperTreeDb``'s topic methods (#193): one slice of the class, in its own file."""

    __slots__ = ()

    # ── topics ────────────────────────────────────────────────────────────────────────

    def list_topics(self, owner: OwnerId) -> list[TopicRow]:
        """The owner's topics in shelf order (``sort_order``, then oldest first), with counts.

        Args:
            owner: The caller's owner handle.

        Returns:
            One row per topic; ``paper_count``, ``page_count`` and ``categories`` count the
            ACCEPTED papers only.
        """
        owner_id = self._resolve(owner)
        topics = self._all(
            "SELECT topic_id, name, cloth, sort_order, created_at FROM topics WHERE owner_id = ? "
            "ORDER BY sort_order, created_at, topic_id",
            (owner_id,),
        )
        held = self._all(
            "SELECT paper_id, topic_id FROM paper_topics "
            "WHERE owner_id = ? AND status = 'accepted'",
            (owner_id,),
        )
        facts = (
            {row.paper_id: row for row in self.list_library(owner)} if held else {}
        )  # one pass over the library, not one query per paper
        papers: dict[str, int] = defaultdict(int)
        pages: dict[str, int] = defaultdict(int)
        categories: dict[str, set[str]] = defaultdict(set)
        for placement in held:
            topic_id = placement["topic_id"]
            paper = facts.get(placement["paper_id"])
            papers[topic_id] += 1
            if paper is None:
                continue
            pages[topic_id] += paper.page_count or 0
            if paper.arxiv_category is not None:
                categories[topic_id].add(paper.arxiv_category)
        return [
            TopicRow(
                topic_id=t["topic_id"],
                name=t["name"],
                cloth=t["cloth"],
                sort_order=t["sort_order"],
                created_at=t["created_at"],
                paper_count=papers[t["topic_id"]],
                page_count=pages[t["topic_id"]],
                categories=tuple(sorted(categories[t["topic_id"]])),
            )
            for t in topics
        ]

    def get_topic(self, owner: OwnerId, topic_id: str) -> TopicRow | None:
        """One topic with its counts, or None when it is not this owner's."""
        return next((t for t in self.list_topics(owner) if t.topic_id == topic_id), None)

    def create_topic(self, owner: OwnerId, name: str, cloth: str | None = None) -> TopicRow:
        """Adds a topic at the end of the shelf order.

        Args:
            owner: The caller's owner handle.
            name: 1 to ``TOPIC_NAME_MAX`` characters after trimming.
            cloth: One of ``CLOTHS``, or None.

        Returns:
            The new topic (no papers yet).

        Raises:
            ValueError: The name is empty or too long, or the cloth is unknown.
            TopicExists: The owner already has a topic of that name, in any letter case.
        """
        owner_id = self._resolve(owner)
        name = clean_topic_name(name)
        _check_cloth(cloth)
        topic_id = new_id("top")
        with self.transaction():
            if self._by_name(owner_id, name) is not None:
                raise TopicExists(f"you already have a topic called {name!r}")
            top = self._one(
                "SELECT MAX(sort_order) AS top FROM topics WHERE owner_id = ?", (owner_id,)
            )
            order = 0 if top is None or top["top"] is None else min(int(top["top"]) + 1, 2**31)
            try:
                self._conn.execute(
                    "INSERT INTO topics (topic_id, owner_id, name, cloth, sort_order, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (topic_id, owner_id, name, cloth, order, now_iso()),
                )
            except sqlite3.IntegrityError as exc:  # a concurrent create won the unique index
                raise TopicExists(f"you already have a topic called {name!r}") from exc
        created = self.get_topic(owner, topic_id)
        assert created is not None  # we just wrote it
        return created

    def update_topic(
        self,
        owner: OwnerId,
        topic_id: str,
        *,
        name: str | None = None,
        cloth: str | None = None,
        sort_order: int | None = None,
    ) -> TopicRow:
        """Renames, recolours or reorders a topic; an argument left None is left alone.

        Raises:
            TopicNotFound: The topic is not this owner's.
            ValueError: The name, cloth or sort order is not valid.
            TopicExists: Another topic of the owner already has that name.
        """
        owner_id = self._resolve(owner)
        if name is not None:
            name = clean_topic_name(name)
        _check_cloth(cloth)
        if sort_order is not None and (
            isinstance(sort_order, bool) or not 0 <= sort_order <= _SQLITE_INTEGER_MAX
        ):
            raise ValueError("sort_order must be a non-negative integer")
        with self.transaction():
            if (
                self._one(
                    "SELECT 1 AS x FROM topics WHERE owner_id = ? AND topic_id = ?",
                    (owner_id, topic_id),
                )
                is None
            ):
                raise TopicNotFound(f"no topic {topic_id} for this owner")
            if name is not None:
                clash = self._by_name(owner_id, name)
                if clash is not None and clash != topic_id:
                    raise TopicExists(f"you already have a topic called {name!r}")
            self._conn.execute(
                "UPDATE topics SET name = COALESCE(?, name), cloth = COALESCE(?, cloth), "
                "sort_order = COALESCE(?, sort_order) WHERE owner_id = ? AND topic_id = ?",
                (name, cloth, sort_order, owner_id, topic_id),
            )
        updated = self.get_topic(owner, topic_id)
        assert updated is not None
        return updated

    def delete_topic(self, owner: OwnerId, topic_id: str) -> None:
        """Deletes a topic.

        Its accepted papers become unshelved (0009's trigger); the papers, their reading state
        and their highlights are untouched.

        Raises:
            TopicNotFound: The topic is not this owner's.
        """
        owner_id = self._resolve(owner)
        done = self._conn.execute(
            "DELETE FROM topics WHERE owner_id = ? AND topic_id = ?", (owner_id, topic_id)
        )
        if done.rowcount == 0:
            raise TopicNotFound(f"no topic {topic_id} for this owner")

    # ── a paper's topic ───────────────────────────────────────────────────────────────

    def get_paper_topic(self, owner: OwnerId, paper_id: PaperId) -> PaperTopicRow:
        """The paper's relationship to the topics; status ``none`` when there is no row.

        Raises:
            PaperNotFound: The paper is not this owner's.
        """
        owner_id = self._resolve(owner)
        library = self.library_row(owner, paper_id)
        if library is None:
            raise PaperNotFound(f"no paper {paper_id} for this owner")
        row = self._one(
            "SELECT pt.status, pt.source, pt.source_detail, pt.suggested_name, pt.decided_at, "
            "       t.topic_id, t.name, t.cloth "
            "  FROM paper_topics pt LEFT JOIN topics t "
            "    ON t.owner_id = pt.owner_id AND t.topic_id = pt.topic_id "
            " WHERE pt.owner_id = ? AND pt.paper_id = ?",
            (owner_id, paper_id),
        )
        if row is None:
            return PaperTopicRow(
                paper_id, "none", None, None, None, None, None, library.arxiv_category
            )
        topic = (
            None
            if row["topic_id"] is None
            else TopicRef(row["topic_id"], row["name"], row["cloth"])
        )
        return PaperTopicRow(
            paper_id=paper_id,
            status=row["status"],
            topic=topic,
            suggested_name=row["suggested_name"],
            source=row["source"],
            source_detail=row["source_detail"],
            decided_at=row["decided_at"],
            arxiv_category=library.arxiv_category,
        )

    def deterministic_suggestion(self, owner: OwnerId, paper_id: PaperId) -> TopicSuggestion | None:
        """What ``suggest_by_category`` proposes for this paper from the owner's accepted topics.

        Reads only; stores nothing.

        Raises:
            PaperNotFound: The paper is not this owner's.
        """
        owner_id = self._resolve(owner)
        library = self.library_row(owner, paper_id)
        if library is None:
            raise PaperNotFound(f"no paper {paper_id} for this owner")
        if library.arxiv_category is None:
            return None
        categories = {row.paper_id: row.arxiv_category for row in self.list_library(owner)}
        holdings = [
            Holding(r["topic_id"], categories.get(r["paper_id"]), r["decided_at"])
            for r in self._all(
                "SELECT paper_id, topic_id, decided_at FROM paper_topics "
                "WHERE owner_id = ? AND status = 'accepted'",
                (owner_id,),
            )
        ]
        return suggest_by_category(library.arxiv_category, holdings)

    def record_suggestion(
        self, owner: OwnerId, paper_id: PaperId, suggestion: TopicSuggestion
    ) -> PaperTopicRow:
        """Stores an offer for a paper that has no row yet. The paper is NOT shelved.

        Idempotent: an existing row, whatever its status, is left exactly as it is.

        Raises:
            PaperNotFound: The paper is not this owner's.
            TopicNotFound: The suggestion names a topic that is not this owner's.
            ValueError: The suggestion names neither a topic nor a new name, or both.
        """
        owner_id = self._resolve(owner)
        if (suggestion.topic_id is None) == (suggestion.suggested_name is None):
            raise ValueError("a suggestion names exactly one of a topic and a new topic name")
        name = (
            None
            if suggestion.suggested_name is None
            else clean_topic_name(suggestion.suggested_name)
        )
        with self.transaction():
            self._require_paper(owner_id, paper_id)
            if suggestion.topic_id is not None:
                self._require_topic(owner_id, suggestion.topic_id)
            self._conn.execute(
                "INSERT INTO paper_topics (owner_id, paper_id, topic_id, status, source, "
                "source_detail, suggested_name, created_at) "
                "VALUES (?, ?, ?, 'suggested', ?, ?, ?, ?) "
                "ON CONFLICT (owner_id, paper_id) DO NOTHING",
                (
                    owner_id,
                    paper_id,
                    suggestion.topic_id,
                    suggestion.source,
                    suggestion.source_detail,
                    name,
                    now_iso(),
                ),
            )
        return self.get_paper_topic(owner, paper_id)

    def accept_topic(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        *,
        topic_id: str | None = None,
        new_topic_name: str | None = None,
        cloth: str | None = None,
    ) -> PaperTopicRow:
        """Shelves the paper under a topic and stamps ``decided_at``.

        Name an existing topic with ``topic_id``, or a topic by ``new_topic_name``: that one is
        created if the owner has none of that name (any letter case) and reused if they do. When
        the choice is the offer that was made (same topic, or same proposed name) the row keeps
        its ``source`` and ``source_detail`` ("suggested from arXiv cs.CL, you accepted"); any
        other choice is ``manual``.

        Raises:
            PaperNotFound: The paper is not this owner's.
            TopicNotFound: ``topic_id`` is not this owner's.
            ValueError: Not exactly one of ``topic_id`` and ``new_topic_name``, or a bad name or
                cloth.
        """
        owner_id = self._resolve(owner)
        if (topic_id is None) == (new_topic_name is None):
            raise ValueError("name exactly one of topic_id and new_topic_name")
        with self.transaction():
            self._require_paper(owner_id, paper_id)
            chosen: str | None
            proposed: str | None = None
            if topic_id is not None:
                self._require_topic(owner_id, topic_id)
                chosen = topic_id
            else:
                assert new_topic_name is not None
                proposed = clean_topic_name(new_topic_name)
                chosen = self._by_name(owner_id, proposed)
                if chosen is None:
                    chosen = self.create_topic(owner, proposed, cloth).topic_id
            before = self._one(
                "SELECT topic_id, status, source, source_detail, suggested_name "
                "FROM paper_topics WHERE owner_id = ? AND paper_id = ?",
                (owner_id, paper_id),
            )
            kept = (
                before is not None
                and before["status"] == "suggested"
                and (
                    before["topic_id"] == chosen
                    or (
                        before["suggested_name"] is not None
                        and proposed is not None
                        and before["suggested_name"].casefold() == proposed.casefold()
                    )
                )
            )
            source = before["source"] if kept and before else "manual"
            detail = before["source_detail"] if kept and before else None
            stamp = now_iso()
            self._conn.execute(
                "INSERT INTO paper_topics (owner_id, paper_id, topic_id, status, source, "
                "source_detail, suggested_name, decided_at, created_at) "
                "VALUES (:o, :p, :t, 'accepted', :s, :d, NULL, :now, :now) "
                "ON CONFLICT (owner_id, paper_id) DO UPDATE SET topic_id = :t, "
                "status = 'accepted', source = :s, source_detail = :d, suggested_name = NULL, "
                "decided_at = :now",
                {"o": owner_id, "p": paper_id, "t": chosen, "s": source, "d": detail, "now": stamp},
            )
        return self.get_paper_topic(owner, paper_id)

    def reject_topic(self, owner: OwnerId, paper_id: PaperId) -> PaperTopicRow:
        """Records the person's no, so the same offer is not made again.

        With no offer on file the row is a bare rejection (``source='manual'``); an offer keeps
        its source.

        Raises:
            PaperNotFound: The paper is not this owner's.
        """
        owner_id = self._resolve(owner)
        stamp = now_iso()
        with self.transaction():
            self._require_paper(owner_id, paper_id)
            self._conn.execute(
                "INSERT INTO paper_topics (owner_id, paper_id, topic_id, status, source, "
                "decided_at, created_at) VALUES (?, ?, NULL, 'rejected', 'manual', ?, ?) "
                "ON CONFLICT (owner_id, paper_id) DO UPDATE SET status = 'rejected', "
                "decided_at = excluded.decided_at",
                (owner_id, paper_id, stamp, stamp),
            )
        return self.get_paper_topic(owner, paper_id)

    def clear_topic(self, owner: OwnerId, paper_id: PaperId) -> PaperTopicRow:
        """Unshelves the paper: the row goes and the status is ``none``.

        The deterministic offer may be made again on the next read; it is only ever an offer.

        Raises:
            PaperNotFound: The paper is not this owner's.
        """
        owner_id = self._resolve(owner)
        with self.transaction():
            self._require_paper(owner_id, paper_id)
            self._conn.execute(
                "DELETE FROM paper_topics WHERE owner_id = ? AND paper_id = ?",
                (owner_id, paper_id),
            )
        return self.get_paper_topic(owner, paper_id)

    # ── internals ─────────────────────────────────────────────────────────────────────

    def _by_name(self, owner_id: str, name: str) -> str | None:
        """The id of the owner's topic called ``name`` (the column is NOCASE), or None."""
        row = self._one(
            "SELECT topic_id FROM topics WHERE owner_id = ? AND name = ?", (owner_id, name)
        )
        return None if row is None else str(row["topic_id"])

    def _require_paper(self, owner_id: str, paper_id: PaperId) -> None:
        if (
            self._one(
                "SELECT 1 AS x FROM paper_owners WHERE owner_id = ? AND paper_id = ?",
                (owner_id, paper_id),
            )
            is None
        ):
            raise PaperNotFound(f"no paper {paper_id} for this owner")

    def _require_topic(self, owner_id: str, topic_id: str) -> None:
        if (
            self._one(
                "SELECT 1 AS x FROM topics WHERE owner_id = ? AND topic_id = ?",
                (owner_id, topic_id),
            )
            is None
        ):
            raise TopicNotFound(f"no topic {topic_id} for this owner")
