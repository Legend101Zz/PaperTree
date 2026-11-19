"""The "At a glance" sheet of a paper (0013, v0.3 #337).

Owns the ``paper_glance`` table: one row per (paper, generation, prompt version), written by the API
when the Flash ``glance`` run for the paper finishes (``papertree_api.glance``) and read by
``GET /papers/{id}/glance``. It is a CACHE of a derived thing: a row holds the sheet as the API
serves it (every cap applied, every block's page resolved), never the model's raw text, and a
re-parse is a new generation and so a new row. Keyed to the owner, so another owner's paper has
none and a deleted paper takes its sheet with it (the FK cascade).
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from ._support import Row, client_json, now_iso
from .errors import PaperNotFound
from .ids import OwnerId, PaperId

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object


class GlanceMixin(_Base):
    """``get_glance`` and ``put_glance``."""

    __slots__ = ()

    def get_glance(
        self, owner: OwnerId, paper_id: PaperId, generation: int, prompt_version: str
    ) -> Row | None:
        """The cached sheet, or None.

        Args:
            owner: The caller's owner handle.
            paper_id: The paper.
            generation: The promoted generation the sheet was written from.
            prompt_version: The prompt the sheet was written under (``glance-v1``).

        Returns:
            ``{model, content, run_id, created_at}`` with ``content`` parsed, or None when this
            owner has no sheet for the key (another owner's paper included).
        """
        owner_id = self._resolve(owner)
        row = self._one(
            "SELECT model, content_json, run_id, created_at FROM paper_glance "
            "WHERE owner_id = ? AND paper_id = ? AND generation = ? AND prompt_version = ?",
            (owner_id, paper_id, generation, prompt_version),
        )
        if row is None:
            return None
        return {
            "model": row["model"],
            "content": json.loads(row["content_json"]),
            "run_id": row["run_id"],
            "created_at": row["created_at"],
        }

    def put_glance(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: int,
        prompt_version: str,
        *,
        model: str,
        content: dict[str, Any],
        run_id: str | None,
    ) -> bool:
        """Stores a sheet, unless one is already stored for the key.

        A sheet that is there stands: a second run never replaces it (there is no regenerate yet),
        so a read is stable.

        Returns:
            True when this call stored it, False when one was already there.

        Raises:
            PaperNotFound: The paper is not this owner's.
            ValueError: ``generation`` is below 1, or ``model`` or ``prompt_version`` is empty.
        """
        if generation < 1 or not model or not prompt_version:
            raise ValueError("a glance needs a generation, a prompt version and a model")
        owner_id = self._resolve(owner)
        with self.transaction():
            if self.owned_paper(owner, paper_id) is None:
                raise PaperNotFound(f"no paper {paper_id} for this owner")
            cursor = self._conn.execute(
                "INSERT INTO paper_glance (owner_id, paper_id, generation, prompt_version, model, "
                "content_json, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (owner_id, paper_id, generation, prompt_version) DO NOTHING",
                (
                    owner_id,
                    paper_id,
                    generation,
                    prompt_version,
                    model,
                    client_json(content),
                    run_id,
                    now_iso(),
                ),
            )
            return cursor.rowcount == 1
