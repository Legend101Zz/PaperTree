"""The cover plate: which of a paper's figures the owner chose as its cover (0010, #200).

Owns the ``paper_plate`` table and the one rule that finds the chosen figure in a generation. The
row stores an ANCHOR on the figure (``@papertree/anchoring``'s record, minted by
``GET /papers/{id}/figures``), never a bare block id: a block id is content-derived and a re-parse
retires it (AGENTS.md §4). The library joins the figure into ``LibraryRow.plate`` in its one query
(``library.py``); ``PUT /papers/{id}/plate`` refuses an anchor that finds no figure here.

FINDING THE FIGURE (:func:`plate_block_sql`). The full resolver is TypeScript's and is not ported
(``papertree_anchoring``'s header); this is the two rungs a figure needs, as ``evidence.py`` does
for a seed: the anchor's ``BlockSelector`` when it names a figure of THIS generation, else the
figure on the ``ShapeSelector``'s page whose box overlaps the stored one by an IoU of at least
:data:`PLATE_MIN_IOU` (the stored quad is PDF space, which a re-parse keeps). Nothing found means
no plate: the cover falls back to the typographic one, never to a different figure.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final

from ._support import now_iso
from .errors import PaperNotFound
from .ids import Generation, OwnerId, PaperId

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object

#: How much a figure of a later parse must overlap the stored box to be "the same figure". A
#: proposal, not a measured value: two panels side by side overlap 0, a re-cropped figure ~0.9.
PLATE_MIN_IOU: Final = 0.5


def plate_block_sql(anchor: str, owner: str, paper: str, gen: str) -> str:
    """A scalar SQL expression: the figure block a plate Anchor names in one generation, or NULL.

    Args:
        anchor: The SQL expression holding the Anchor JSON (a column, or ``?``).
        owner: The SQL expression holding the owner id.
        paper: The SQL expression holding the paper id.
        gen: The SQL expression holding the generation.

    Returns:
        SQL text to splice into a query; it binds nothing itself.
    """
    # CROSS JOIN fixes the loop order: the selectors drive and each finds its block by an index.
    # A plain JOIN let the planner walk every block of the paper per selector instead.
    keys = f"b.owner_id = {owner} AND b.paper_id = {paper} AND b.generation = {gen}"
    return f"""COALESCE(
      (SELECT b.block_id FROM json_each({anchor}, '$.selectors') s
        CROSS JOIN blocks b ON {keys} AND b.block_id = json_extract(s.value, '$.blockId')
        WHERE json_extract(s.value, '$.type') = 'BlockSelector' AND b.type = 'figure'
        LIMIT 1),
      (SELECT hit FROM (
         SELECT b.block_id AS hit,
                MAX(0, MIN(b.bbox_x1, q.x1) - MAX(b.bbox_x0, q.x0))
                  * MAX(0, MIN(b.bbox_y1, q.y1) - MAX(b.bbox_y0, q.y0)) AS inter,
                (b.bbox_x1 - b.bbox_x0) * (b.bbox_y1 - b.bbox_y0)
                  + (q.x1 - q.x0) * (q.y1 - q.y0) AS total
           FROM (SELECT json_extract(s.value, '$.pageIndex') AS page,
                        json_extract(s.value, '$.quads[0][0]') AS x0,
                        json_extract(s.value, '$.quads[0][1]') AS y0,
                        json_extract(s.value, '$.quads[0][2]') AS x1,
                        json_extract(s.value, '$.quads[0][3]') AS y1
                   FROM json_each({anchor}, '$.selectors') s
                  WHERE json_extract(s.value, '$.type') = 'ShapeSelector') q
          CROSS JOIN blocks b ON {keys} AND b.page_index = q.page AND b.type = 'figure')
        WHERE inter > 0 AND inter >= {PLATE_MIN_IOU} * (total - inter)
        ORDER BY inter * 1.0 / (total - inter) DESC, hit LIMIT 1))"""


@dataclass(frozen=True, slots=True)
class PlateFigure:
    """The figure a paper's plate shows, found in its promoted generation (derived on read)."""

    #: A hint for the client (which figure of ``GET /figures`` is the plate); never stored.
    block_id: str
    page_index: int
    #: The crop's ``asset://`` URI (``payload.image.uri``), or None when none was rendered.
    image_uri: str | None
    #: The text of the caption ``caption_of`` attaches to it, or None.
    caption_text: str | None


class PlateMixin(_Base):
    """``PaperTreeDb``'s cover-plate methods (#200): one slice of the class, in its own file."""

    __slots__ = ()

    def set_plate(self, owner: OwnerId, paper_id: PaperId, anchor: Mapping[str, Any]) -> None:
        """Stores ``anchor`` as the paper's plate, replacing any earlier choice.

        The caller has checked that the anchor names a figure of the paper (:meth:`plate_figure`);
        the table only holds it to the paper (0010's CHECK).

        Args:
            owner: The caller's owner handle.
            paper_id: The paper.
            anchor: The Anchor record on the chosen figure.

        Raises:
            PaperNotFound: The paper is not this owner's.
            ValueError: The anchor's ``doc.paperId`` is another paper.
        """
        owner_id = self._resolve(owner)
        doc = anchor.get("doc")
        if not isinstance(doc, Mapping) or doc.get("paperId") != paper_id:
            raise ValueError("the anchor is on another paper")
        with self.transaction():
            if self.owned_paper(owner, paper_id) is None:
                raise PaperNotFound(f"no paper {paper_id} for this owner")
            self._conn.execute(
                "INSERT INTO paper_plate (owner_id, paper_id, anchor_json, chosen_at) "
                "VALUES (?, ?, ?, ?) ON CONFLICT (owner_id, paper_id) DO UPDATE SET "
                "anchor_json = excluded.anchor_json, chosen_at = excluded.chosen_at",
                (owner_id, paper_id, json.dumps(anchor, ensure_ascii=False), now_iso()),
            )

    def get_plate(self, owner: OwnerId, paper_id: PaperId) -> dict[str, Any] | None:
        """The stored plate Anchor, or None for the typographic cover.

        Args:
            owner: The caller's owner handle.
            paper_id: The paper.

        Returns:
            The Anchor record as stored.
        """
        owner_id = self._resolve(owner)
        row = self._conn.execute(
            "SELECT anchor_json FROM paper_plate WHERE owner_id = ? AND paper_id = ?",
            (owner_id, paper_id),
        ).fetchone()
        if row is None:
            return None
        anchor: dict[str, Any] = json.loads(row["anchor_json"])
        return anchor

    def clear_plate(self, owner: OwnerId, paper_id: PaperId) -> bool:
        """Puts the typographic cover back.

        Args:
            owner: The caller's owner handle.
            paper_id: The paper.

        Returns:
            True when a plate was removed, False when there was none.
        """
        owner_id = self._resolve(owner)
        cursor = self._conn.execute(
            "DELETE FROM paper_plate WHERE owner_id = ? AND paper_id = ?", (owner_id, paper_id)
        )
        return cursor.rowcount > 0

    def plate_figure(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: Generation,
        anchor: Mapping[str, Any],
    ) -> str | None:
        """The figure block ``anchor`` names in one generation, by the rule the library reads with.

        Args:
            owner: The caller's owner handle.
            paper_id: The paper.
            generation: The generation to look in (the promoted one, for a write).
            anchor: An Anchor record.

        Returns:
            The figure's block id, or None when the anchor names no figure there.
        """
        owner_id = self._resolve(owner)
        row = self._conn.execute(
            f"SELECT {plate_block_sql(':anchor', ':o', ':p', ':g')} AS block_id",
            {"anchor": json.dumps(anchor), "o": owner_id, "p": paper_id, "g": generation},
        ).fetchone()
        return None if row is None or row["block_id"] is None else str(row["block_id"])
