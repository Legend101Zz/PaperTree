"""The name a person gave a paper (0012, v0.3 #337).

Owns the ``paper_title`` table. The library joins the name into ``LibraryRow.custom_title`` in its
one query (``library.py``) and the API lets it win over the parsed title everywhere the library
shows one. It is keyed to the paper, not to a generation, so a re-parse keeps it. Only the
LIBRARY's title is renamed: the parsed ``metadata.title`` stays what the citation matcher and the
model's paper context read, because those are about the paper, not about the person's shelf.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from ._support import now_iso
from .errors import PaperNotFound
from .ids import OwnerId, PaperId

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object

#: The longest name a person may give a paper, after trimming (the API says the same).
PAPER_TITLE_MAX: Final = 300


class TitleMixin(_Base):
    """``set_paper_title``."""

    __slots__ = ()

    def set_paper_title(self, owner: OwnerId, paper_id: PaperId, title: str) -> str:
        """Stores the owner's name for a paper, trimmed, replacing an earlier one.

        Args:
            owner: The caller's owner handle.
            paper_id: The paper.
            title: 1 to :data:`PAPER_TITLE_MAX` characters once trimmed.

        Returns:
            The name as stored (trimmed).

        Raises:
            PaperNotFound: The paper is not this owner's.
            ValueError: The trimmed name is empty or too long.
        """
        name = title.strip()
        if not 1 <= len(name) <= PAPER_TITLE_MAX:
            raise ValueError(f"title must be 1 to {PAPER_TITLE_MAX} characters")
        owner_id = self._resolve(owner)
        with self.transaction():
            if self.owned_paper(owner, paper_id) is None:
                raise PaperNotFound(f"no paper {paper_id} for this owner")
            self._conn.execute(
                "INSERT INTO paper_title (owner_id, paper_id, title, updated_at) "
                "VALUES (?, ?, ?, ?) ON CONFLICT (owner_id, paper_id) DO UPDATE SET "
                "title = excluded.title, updated_at = excluded.updated_at",
                (owner_id, paper_id, name, now_iso()),
            )
        return name
