"""Reading state: where each owner is in each paper, and the rule that says "finished" (#192).

Owns the ``reading_state`` table (0006) and the one pure function that turns its numbers into a
state. The library joins the row into ``LibraryRow.reading`` (``library.py``); the reader writes it
through ``PUT /papers/{id}/reading-state``. Pages are zero-based, as the reader writes them.

THE PROGRESS RULE (the owner may change it; it lives only in :func:`progress_state`):

    not started   no row
    reading now   a row, and not finished
    finished      ``furthest_page >= page_count - 1`` (reached the last page), or set explicitly

``furthest_page`` only grows and ``finished_at`` is never cleared, so scrolling back up the paper
does not un-finish it.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final, Literal

from ._support import now_iso
from .errors import PaperNotFound
from .ids import OwnerId, PaperId

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object

#: What a row with a place in it can be. "Not started" is the absence of a row, not a value.
ProgressState = Literal["reading", "finished"]

#: The reading modes the reader has (matches the ``mode`` CHECK in 0006).
READING_MODES: Final = frozenset({"source", "guided", "split"})


def reached_last_page(furthest_page: int, page_count: int | None) -> bool:
    """True when ``furthest_page`` is the last page of a paper whose length is known.

    Args:
        furthest_page: The furthest zero-based page ever reached.
        page_count: The paper's page count, or None when not known (then nothing is "last").

    Returns:
        Whether the reader has reached the final page.
    """
    return page_count is not None and page_count > 0 and furthest_page >= page_count - 1


def progress_state(
    furthest_page: int, page_count: int | None, finished_at: str | None
) -> ProgressState:
    """The progress rule for a paper that HAS a reading-state row.

    Args:
        furthest_page: The furthest zero-based page ever reached.
        page_count: The paper's page count, or None when not known.
        finished_at: The stored ``finished_at`` (set explicitly or by an earlier write).

    Returns:
        ``"finished"`` when ``finished_at`` is set or the last page was reached, else
        ``"reading"``.

    Example:
        >>> progress_state(9, 10, None)
        'finished'
        >>> progress_state(3, 10, None)
        'reading'
    """
    if finished_at is not None or reached_last_page(furthest_page, page_count):
        return "finished"
    return "reading"


@dataclass(frozen=True, slots=True)
class ReadingState:
    """One owner's place in one paper, with the progress rule already applied."""

    last_page: int
    furthest_page: int
    #: The paper's page count now (not when the row was written); None while unknown.
    page_count: int | None
    mode: str | None
    #: When the reader last wrote its page: equal to ``updated_at`` (every write is a "read").
    #: Named for the library's "Last opened"; it is NOT the first open.
    opened_at: str
    updated_at: str
    finished_at: str | None
    state: ProgressState


#: A paper's page count the way ``library.py`` derives it: what the upload measured, else the
#: promoted generation's page rows. Restated here: the two modules must not import each other.
_PAGE_COUNT_SQL: Final = """
SELECT COALESCE(po.page_count,
                NULLIF((SELECT COUNT(*) FROM pages pg
                         JOIN paper_promotions pp
                           ON pp.owner_id = pg.owner_id AND pp.paper_id = pg.paper_id
                          AND pp.generation = pg.generation
                        WHERE pg.owner_id = po.owner_id AND pg.paper_id = po.paper_id), 0)
       ) AS page_count
  FROM paper_owners po WHERE po.owner_id = ? AND po.paper_id = ?
"""


def reading_state_from(row: Mapping[str, Any], page_count: int | None) -> ReadingState:
    """Builds a :class:`ReadingState` from a ``reading_state`` row and the paper's page count.

    Args:
        row: Anything with the row's columns by name.
        page_count: The paper's page count, or None when unknown.

    Returns:
        The state, the progress rule applied.
    """
    state = progress_state(int(row["furthest_page"]), page_count, row["finished_at"])
    # "finished" always carries a time. A row written while the page count was unknown can be
    # finished only by the count arriving later; the write that got it there is the best time we
    # have, so that is what is shown (the stored column stays NULL).
    finished_at = row["finished_at"]
    if state == "finished" and finished_at is None:
        finished_at = row["updated_at"]
    return ReadingState(
        last_page=int(row["last_page"]),
        furthest_page=int(row["furthest_page"]),
        page_count=page_count,
        mode=row["mode"],
        opened_at=row["opened_at"],
        updated_at=row["updated_at"],
        finished_at=finished_at,
        state=state,
    )


class ReadingMixin(_Base):
    """``PaperTreeDb``'s reading-state methods (#192): one slice of the class, in its own file."""

    __slots__ = ()

    def put_reading_state(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        last_page: int,
        mode: str | None = None,
        *,
        finished: bool = False,
    ) -> ReadingState:
        """Records that the owner is on ``last_page`` of the paper now (an upsert).

        ``opened_at`` and ``updated_at`` become now, ``furthest_page`` is raised and never lowered,
        ``finished_at`` is set the first time the last page is reached (or when ``finished``) and
        never cleared, and a ``mode`` of None keeps the stored mode.

        Args:
            owner: The caller's owner handle.
            paper_id: The paper.
            last_page: The zero-based page the reader is on.
            mode: ``source``, ``guided`` or ``split``; None keeps the stored one.
            finished: Mark the paper finished whatever the page (an explicit "mark as read").

        Returns:
            The stored state, the progress rule applied.

        Raises:
            PaperNotFound: The paper is not this owner's.
            ValueError: ``last_page`` is negative or, when the page count is known, past the last
                page; or ``mode`` is not a reading mode.
        """
        owner_id = self._resolve(owner)
        if isinstance(last_page, bool) or not isinstance(last_page, int) or last_page < 0:
            raise ValueError(f"last_page must be a non-negative integer, got {last_page!r}")
        if mode is not None and mode not in READING_MODES:
            raise ValueError(f"mode must be one of {sorted(READING_MODES)}, got {mode!r}")
        with self.transaction():
            owned = self._conn.execute(_PAGE_COUNT_SQL, (owner_id, paper_id)).fetchone()
            if owned is None:
                raise PaperNotFound(f"no paper {paper_id} for this owner")
            page_count = owned["page_count"]
            if page_count is not None and last_page >= page_count:
                raise ValueError(f"last_page {last_page} is past the last page ({page_count - 1})")
            stamp = now_iso()
            # The last page's index; NULL (page count unknown) compares false, so nothing finishes.
            last_index = None if page_count is None else page_count - 1
            self._conn.execute(
                "INSERT INTO reading_state (owner_id, paper_id, last_page, furthest_page, mode, "
                "opened_at, updated_at, finished_at) "
                "VALUES (:o, :p, :page, :page, :mode, :t, :t, "
                "        CASE WHEN :force OR :page >= :last THEN :t END) "
                "ON CONFLICT (owner_id, paper_id) DO UPDATE SET "
                "  last_page = excluded.last_page, "
                "  furthest_page = MAX(furthest_page, excluded.furthest_page), "
                "  mode = COALESCE(excluded.mode, mode), "
                "  opened_at = excluded.opened_at, updated_at = excluded.updated_at, "
                "  finished_at = COALESCE(finished_at, "
                "    CASE WHEN :force OR MAX(furthest_page, excluded.furthest_page) >= :last "
                "         THEN :t END)",
                {
                    "o": owner_id,
                    "p": paper_id,
                    "page": last_page,
                    "mode": mode,
                    "t": stamp,
                    "force": 1 if finished else 0,
                    "last": last_index,
                },
            )
        state = self.get_reading_state(owner, paper_id)
        assert state is not None  # we just wrote it
        return state

    def get_reading_state(self, owner: OwnerId, paper_id: PaperId) -> ReadingState | None:
        """The owner's reading state for one paper, or None when they have not started it.

        Args:
            owner: The caller's owner handle.
            paper_id: The paper.

        Returns:
            The state, or None (not started, or not this owner's paper: the two look the same).
        """
        owner_id = self._resolve(owner)
        row = self._conn.execute(
            "SELECT last_page, furthest_page, mode, opened_at, updated_at, finished_at "
            "FROM reading_state WHERE owner_id = ? AND paper_id = ?",
            (owner_id, paper_id),
        ).fetchone()
        if row is None:
            return None
        owned = self._conn.execute(_PAGE_COUNT_SQL, (owner_id, paper_id)).fetchone()
        return reading_state_from(row, None if owned is None else owned["page_count"])
