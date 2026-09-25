"""Highlights and their anchors — moved here unchanged from ``database.py`` (S0 split).

S4 owns this module after S0 (slice-plan.md §3). This commit only MOVES the 0001-schema methods
into the mixin so the split lands on its own; migration 0005 replaces them in the next commit.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

from ._support import Row, now_iso, to_json
from .ids import AnchorId, BlockId, Generation, HighlightId, OwnerId, PaperId, new_id

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object


class HighlightsMixin(_Base):
    __slots__ = ()

    # ── highlights + anchors ─────────────────────────────────────────────────────────

    def create_highlight(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: Generation,
        color: str,
        note: str | None = None,
    ) -> HighlightId:
        owner_id = self._resolve(owner)
        highlight_id = new_id("hl")
        now = now_iso()
        self._conn.execute(
            "INSERT INTO highlights (highlight_id, owner_id, paper_id, generation, color, note, "
            "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (highlight_id, owner_id, paper_id, generation, color, note, now, now),
        )
        return HighlightId(highlight_id)

    def get_highlight(self, owner: OwnerId, highlight_id: HighlightId) -> Row | None:
        owner_id = self._resolve(owner)
        return self._one(
            "SELECT * FROM highlights WHERE owner_id = ? AND highlight_id = ?",
            (owner_id, highlight_id),
        )

    def list_highlights(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation
    ) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM highlights WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "ORDER BY created_at",
            (owner_id, paper_id, generation),
        )

    def update_highlight_note(
        self, owner: OwnerId, highlight_id: HighlightId, note: str | None
    ) -> int:
        """The write findings.md §F1 got wrong: update by id alone, no owner filter."""
        owner_id = self._resolve(owner)
        cursor = self._conn.execute(
            "UPDATE highlights SET note = ?, updated_at = ? "
            "WHERE owner_id = ? AND highlight_id = ?",
            (note, now_iso(), owner_id, highlight_id),
        )
        return cursor.rowcount

    def delete_highlight(self, owner: OwnerId, highlight_id: HighlightId) -> int:
        owner_id = self._resolve(owner)
        cursor = self._conn.execute(
            "DELETE FROM highlights WHERE owner_id = ? AND highlight_id = ?",
            (owner_id, highlight_id),
        )
        return cursor.rowcount

    def create_anchor(
        self,
        owner: OwnerId,
        highlight_id: HighlightId,
        paper_id: PaperId,
        generation: Generation,
        block_id: BlockId,
        tier: int,
        polygon: Sequence[Sequence[float]],
        bbox: Sequence[float],
        *,
        char_start: int | None = None,
        char_end: int | None = None,
        text_quote: str | None = None,
        quote_prefix: str | None = None,
        quote_suffix: str | None = None,
        content_hash: str | None = None,
    ) -> AnchorId:
        owner_id = self._resolve(owner)
        anchor_id = new_id("anc")
        self._conn.execute(
            """INSERT INTO anchors (anchor_id, owner_id, highlight_id, paper_id, generation,
                 block_id, tier, char_start, char_end, text_quote, quote_prefix, quote_suffix,
                 content_hash, polygon, bbox_x0, bbox_y0, bbox_x1, bbox_y1, resolved_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                anchor_id,
                owner_id,
                highlight_id,
                paper_id,
                generation,
                block_id,
                tier,
                char_start,
                char_end,
                text_quote,
                quote_prefix,
                quote_suffix,
                content_hash,
                to_json([list(point) for point in polygon]),
                bbox[0],
                bbox[1],
                bbox[2],
                bbox[3],
                now_iso(),
            ),
        )
        return AnchorId(anchor_id)

    def list_anchors(self, owner: OwnerId, highlight_id: HighlightId) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM anchors WHERE owner_id = ? AND highlight_id = ? "
            "ORDER BY tier, anchor_id",
            (owner_id, highlight_id),
        )

    def resolve_highlights(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation
    ) -> list[Row]:
        """THE MULTI-TABLE JOIN, with the owner predicate on EVERY joined table.

        findings.md §F3 is the version of this query that filters the root only. Note the
        join keys themselves carry owner_id, so ``anchors -> blocks`` cannot straddle two
        owners even if a predicate were dropped.
        """
        owner_id = self._resolve(owner)
        return self._all(
            """SELECT h.highlight_id, a.anchor_id, b.block_id, a.tier, h.color, h.note,
                      a.text_quote, a.content_hash AS anchor_content_hash,
                      b.content_hash AS block_content_hash, b.text AS block_text,
                      b.page_index, b.polygon AS block_polygon
                 FROM highlights h
                 JOIN anchors a
                   ON a.owner_id = h.owner_id AND a.highlight_id = h.highlight_id
                  AND a.owner_id = ?
                 JOIN blocks b
                   ON b.owner_id = a.owner_id AND b.paper_id = a.paper_id
                  AND b.generation = a.generation AND b.block_id = a.block_id
                  AND b.owner_id = h.owner_id
                WHERE h.owner_id = ? AND h.paper_id = ? AND h.generation = ?
                ORDER BY h.created_at, a.tier""",
            (owner_id, owner_id, paper_id, generation),
        )
