"""Highlights and their anchors on 0005's schema (contracts.md §1.1, §2.4, §6). S4 owns it next.

THE RULE 0005 IS BUILT ON. A highlight belongs to the PAPER (``paper_owners``), never to a parse
generation, so a re-parse cannot delete it. Each anchor is the whole ``@papertree/anchoring`` Anchor
v1 record, stored verbatim (minus ``resolution``) in ``anchors.anchor_json``. What a resolver
concluded about an anchor on one generation — tier, state, block ids — is a CACHE in
``anchor_resolutions``, keyed by generation, and it dies with that generation. The only bridge
between user state and parse state is the Anchor.

WHAT S0 IMPLEMENTS HERE: ``create_highlight`` and ``list_highlights`` (the ★ rows of §1.1), plus
``get_highlight``, ``update_highlight``, ``delete_highlight``, ``put_resolutions`` and
``upgrade_legacy_anchor``, because the S0 highlight routes are thin over them. Every write runs in
ONE ``transaction()``: a highlight is never stored without all of its anchors and resolutions.

WHAT THIS MODULE VALIDATES, AND WHY HERE RATHER THAN ONLY IN THE ROUTE. The SQL carries the
invariants it can express (``anchor_json.doc.paperId = paper_id``, ``provenanceClass``,
``targetKind``, ``anchorVersion``). It cannot express "``doc.pdfSha256`` equals this paper's
``source_hash``" (a CHECK cannot read another table) or "a new user anchor carries a quote and at
least one quad" (contracts.md §2.4 ``anchor_incomplete``). Both are checked here, before any row is
written, so every caller — the HTTP route today, an import tool tomorrow — gets them. A failure is a
:class:`~papertree_db.errors.HighlightRejected` whose ``code`` is the contract's error code, so the
route maps it to a 422 without re-deriving anything. The full JSON-schema check of the record
(``contracts/anchor/anchor-v1.schema.json``) is the API's job (S0 wave 2) and is not duplicated.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final

from ._support import Row, canonical_json, client_json, now_iso
from .errors import GenerationNotFound, HighlightConflict, HighlightRejected, PaperNotFound
from .ids import OwnerId, PaperId

if TYPE_CHECKING:
    from .database import DatabaseCore as _Base
else:
    _Base = object

#: contracts.md §2.4: ``anchors: [...] (1..64)``.
MAX_ANCHORS_PER_HIGHLIGHT: Final = 64
#: contracts.md §2.4: ``PUT …/resolutions`` takes at most 500 items.
MAX_RESOLUTIONS_PER_PUT: Final = 500
RESOLUTION_STATES: Final = frozenset({"anchored", "approximate", "orphan"})
PROVENANCE_CLASSES: Final = frozenset({"source", "ai_generated"})
#: The largest value SQLite's INTEGER holds (a signed 64-bit integer). JSON integers are unbounded,
#: so every integer this module binds — a generation, a page index — is checked against it FIRST:
#: one past it raised ``OverflowError`` out of the driver, which the route turned into a 500.
SQLITE_INTEGER_MAX: Final = 2**63 - 1
#: What 0005 writes into ``doc.textStreamId`` for a row it converted from the 0001 shape. Only those
#: may be replaced through :meth:`HighlightsMixin.upgrade_legacy_anchor` (contracts.md §1.1).
LEGACY_TEXT_STREAM_ID: Final = "legacy-0001"

#: contracts.md §0: client-minted ids. ``highlight_id`` must match the prefixed form; ``anchor.id``
#: may also be a bare UUID (``crypto.randomUUID()``, which is what ``captureAnchor`` is given).
PREFIXED_ID: Final = re.compile(r"^[a-z]{2,4}_[0-9A-Za-z-]{8,64}$")
BARE_UUID: Final = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


# ── inputs ───────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class AnchorIn:
    """One anchor of a new highlight: the Anchor v1 record as JSON data; ordinal = its index."""

    anchor: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class ResolutionIn:
    """One T0-cache entry: what a resolver concluded about ``anchor_id`` on ``generation``."""

    anchor_id: str
    generation: int
    tier: int
    state: str
    block_ids: Sequence[str]
    score: float | None
    resolver_version: str
    reason: str | None = None


# ── outputs ──────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class HighlightRow:
    """A stored ``highlights`` row. ``owner_id`` is deliberately absent (AGENTS.md §4).

    ``created`` is True only on the value :meth:`HighlightsMixin.create_highlight` returns when
    THAT call inserted the row; an idempotent replay returns the stored row with ``created=False``,
    which is how the route tells 201 from 200.
    """

    highlight_id: str
    paper_id: str
    color: str
    note: str | None
    created_generation: int
    created_at: str
    updated_at: str
    created: bool = False


@dataclass(frozen=True, slots=True)
class ResolutionRow:
    generation: int
    tier: int
    state: str
    block_ids: tuple[str, ...]
    score: float | None
    reason: str | None
    resolver_version: str
    resolved_at: str


@dataclass(frozen=True, slots=True)
class AnchorRow:
    anchor_id: str
    ordinal: int
    #: The stored Anchor v1 record, parsed. Never carries ``resolution`` (contracts.md §2.4).
    anchor: dict[str, Any]
    #: The cache entry for the generation that was asked about, or None (none asked, none stored).
    resolution: ResolutionRow | None


@dataclass(frozen=True, slots=True)
class HighlightWithAnchors:
    highlight_id: str
    paper_id: str
    color: str
    note: str | None
    created_generation: int
    created_at: str
    updated_at: str
    #: In ordinal order. EMPTY for an anchorless row, which is still listed (fixes N2).
    anchors: tuple[AnchorRow, ...]


@dataclass(frozen=True, slots=True)
class _PreparedAnchor:
    anchor_id: str
    ordinal: int
    anchor_json: str
    canonical: str
    target_kind: str
    provenance_class: str
    quote_exact: str | None
    page_index: int | None


# ── the mixin ────────────────────────────────────────────────────────────────────────────────


class HighlightsMixin(_Base):
    __slots__ = ()

    # ★ contracts.md §1.1
    def create_highlight(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        *,
        highlight_id: str,
        color: str,
        note: str | None,
        created_generation: int,
        anchors: Sequence[AnchorIn],
        resolutions: Sequence[ResolutionIn],
    ) -> HighlightRow:
        """Stores a highlight with all of its anchors and resolutions, atomically, or nothing.

        IDEMPOTENT ON ``highlight_id``. The id is client-minted, so a retried POST carries the id
        of the first attempt. If this owner already has that id with the SAME BODY — same
        ``paper_id``, ``color``, ``note`` and the same anchor records in the same order, compared
        as canonical JSON — the stored row is returned with ``created=False`` and nothing is
        written. ``resolutions`` are NOT part of the comparison: they are a cache the reader
        refreshes through ``put_resolutions``, so a replay whose cache entry moved is still the
        same highlight. The same id with a different body raises :class:`HighlightConflict`.

        Raises :class:`PaperNotFound` (the owner has no ``paper_owners`` row for ``paper_id``),
        :class:`HighlightRejected` with ``code`` ``validation_failed`` / ``anchor_incomplete`` /
        ``anchor_mismatch``, or :class:`HighlightConflict`. Never a bare ``sqlite3`` error for a
        bad body: an ``IntegrityError`` the checks below did not foresee is re-raised as
        ``validation_failed``, after the transaction has rolled back, and every integer is bounded
        to SQLite's range before it is bound (``SQLITE_INTEGER_MAX``), so none overflows.
        """
        owner_id = self._resolve(owner)
        _check_prefixed_id("highlight_id", highlight_id)
        _check_color(color)
        if note is not None and not isinstance(note, str):
            raise HighlightRejected("validation_failed", "note must be a string or null")
        _check_generation("created_generation", created_generation)
        if isinstance(anchors, (str, bytes)) or not isinstance(anchors, Sequence):
            raise HighlightRejected("validation_failed", "anchors must be a list")
        if not anchors:
            raise HighlightRejected("validation_failed", "anchors: a highlight needs 1 anchor")
        if len(anchors) > MAX_ANCHORS_PER_HIGHLIGHT:
            raise HighlightRejected(
                "validation_failed",
                f"anchors: at most {MAX_ANCHORS_PER_HIGHLIGHT} per highlight, got {len(anchors)}",
            )
        if isinstance(resolutions, (str, bytes)) or not isinstance(resolutions, Sequence):
            raise HighlightRejected("validation_failed", "resolutions must be a list")

        with self.transaction():
            source_hash = self._owned_source_hash(owner_id, paper_id)
            prepared = [
                _prepare_anchor(
                    item.anchor if isinstance(item, AnchorIn) else None,
                    ordinal=index,
                    paper_id=paper_id,
                    source_hash=source_hash,
                    require_complete=True,
                )
                for index, item in enumerate(anchors)
            ]
            anchor_ids = [p.anchor_id for p in prepared]
            if len(set(anchor_ids)) != len(anchor_ids):
                raise HighlightRejected("validation_failed", "anchors: anchor ids must be unique")

            existing = self._one(
                "SELECT highlight_id, paper_id, color, note, created_generation, created_at, "
                "updated_at FROM highlights WHERE owner_id = ? AND highlight_id = ?",
                (owner_id, highlight_id),
            )
            if existing is not None:
                return self._replay_or_conflict(owner_id, existing, paper_id, color, note, prepared)

            checked = [
                _check_resolution(r, f"resolutions[{index}]", anchor_ids=set(anchor_ids))
                for index, r in enumerate(resolutions)
            ]
            keys = [(r.anchor_id, r.generation) for r in checked]
            if len(set(keys)) != len(keys):
                raise HighlightRejected(
                    "validation_failed", "resolutions: one entry per (anchor_id, generation)"
                )
            for gen in sorted({r.generation for r in checked}):
                if not self._generation_exists(owner_id, paper_id, gen):
                    raise HighlightRejected(
                        "validation_failed",
                        f"resolutions: generation {gen} of this paper does not exist",
                    )

            now = now_iso()
            try:
                self._conn.execute(
                    "INSERT INTO highlights (highlight_id, owner_id, paper_id, color, note, "
                    "created_generation, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                    (highlight_id, owner_id, paper_id, color, note, created_generation, now, now),
                )
                self._conn.executemany(
                    "INSERT INTO anchors (anchor_id, owner_id, highlight_id, paper_id, ordinal, "
                    "anchor_json, target_kind, provenance_class, quote_exact, page_index, "
                    "created_generation, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    [
                        (
                            p.anchor_id,
                            owner_id,
                            highlight_id,
                            paper_id,
                            p.ordinal,
                            p.anchor_json,
                            p.target_kind,
                            p.provenance_class,
                            p.quote_exact,
                            p.page_index,
                            created_generation,
                            now,
                        )
                        for p in prepared
                    ],
                )
                self._conn.executemany(
                    _UPSERT_RESOLUTION, _resolution_params(owner_id, paper_id, checked, now)
                )
            except sqlite3.IntegrityError as exc:
                message = str(exc)
                if "highlights.highlight_id" in message or "anchors.anchor_id" in message:
                    # The ids are global primary keys and client-minted, so another owner (or a
                    # different highlight of this one) already holds one of them.
                    raise HighlightConflict(
                        "highlight_id or an anchor id is already in use"
                    ) from exc
                raise HighlightRejected(
                    "validation_failed", f"the highlight could not be stored ({message})"
                ) from exc

        return HighlightRow(
            highlight_id=highlight_id,
            paper_id=paper_id,
            color=color,
            note=note,
            created_generation=created_generation,
            created_at=now,
            updated_at=now,
            created=True,
        )

    # ★ contracts.md §1.1
    def list_highlights(
        self, owner: OwnerId, paper_id: PaperId, generation: int | None
    ) -> list[HighlightWithAnchors]:
        """Every highlight on the paper, with its anchors and each anchor's cache entry for
        ``generation`` (``None``: no generation asked about, so every ``resolution`` is None).

        LEFT JOINs throughout, so an anchorless highlight (``anchors == ()``) and an anchor with no
        cache entry for this generation (``resolution is None``) are both STILL LISTED. N2 was the
        inner join that silently dropped them. Owner-scoped on every table: each join key carries
        ``owner_id`` and the root is filtered by it.

        Raises :class:`HighlightRejected` (``validation_failed``) for a ``generation`` that is not
        an integer from 1 to ``SQLITE_INTEGER_MAX`` — it is bound as a SQL parameter.
        """
        owner_id = self._resolve(owner)
        return self._select_highlights(owner_id, paper_id, generation, None)

    def get_highlight(
        self, owner: OwnerId, paper_id: PaperId, highlight_id: str, generation: int | None
    ) -> HighlightWithAnchors | None:
        """One highlight of this paper, shaped like ``list_highlights``' rows, or None."""
        owner_id = self._resolve(owner)
        rows = self._select_highlights(owner_id, paper_id, generation, highlight_id)
        return rows[0] if rows else None

    def update_highlight(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        highlight_id: str,
        *,
        color: str | None = None,
        note: str | None = None,
    ) -> HighlightRow | None:
        """Changes colour and/or note. ``None`` leaves a field unchanged; ``note=""`` clears it.

        Scoped by owner AND ``paper_id``: a highlight id presented under another paper's path is
        not found, which fixes the path-ignoring defect of the 0001 routes. Returns None when the
        highlight is not on this paper.
        """
        owner_id = self._resolve(owner)
        sets: list[str] = []
        params: list[Any] = []
        if color is not None:
            _check_color(color)
            sets.append("color = ?")
            params.append(color)
        if note is not None:
            if not isinstance(note, str):
                raise HighlightRejected("validation_failed", "note must be a string or null")
            sets.append("note = ?")
            params.append(note if note != "" else None)
        if sets:
            sets.append("updated_at = ?")
            params.append(now_iso())
            self._conn.execute(
                # The column names are the fixed literals above; only values are bound.
                f"UPDATE highlights SET {', '.join(sets)} "
                "WHERE owner_id = ? AND paper_id = ? AND highlight_id = ?",
                (*params, owner_id, paper_id, highlight_id),
            )
        row = self._one(
            "SELECT highlight_id, paper_id, color, note, created_generation, created_at, "
            "updated_at FROM highlights WHERE owner_id = ? AND paper_id = ? AND highlight_id = ?",
            (owner_id, paper_id, highlight_id),
        )
        return None if row is None else _highlight_row(row)

    def delete_highlight(self, owner: OwnerId, paper_id: PaperId, highlight_id: str) -> int:
        """Deletes the highlight, its anchors and their cache entries (FK cascades). 0 or 1."""
        owner_id = self._resolve(owner)
        cursor = self._conn.execute(
            "DELETE FROM highlights WHERE owner_id = ? AND paper_id = ? AND highlight_id = ?",
            (owner_id, paper_id, highlight_id),
        )
        return cursor.rowcount

    def put_resolutions(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: int,
        items: Sequence[ResolutionIn],
    ) -> int:
        """Upserts cache entries on ``(owner_id, anchor_id, generation)``. Returns the count.

        Every ``item.generation`` must equal ``generation``; every anchor must be on this paper.
        Raises :class:`PaperNotFound`, :class:`GenerationNotFound` (``generation`` of this paper was
        never stored, or has been deleted), or :class:`HighlightRejected`. All or nothing.
        """
        owner_id = self._resolve(owner)
        _check_generation("generation", generation)
        if isinstance(items, (str, bytes)) or not isinstance(items, Sequence):
            raise HighlightRejected("validation_failed", "items must be a list")
        if len(items) > MAX_RESOLUTIONS_PER_PUT:
            raise HighlightRejected(
                "validation_failed", f"items: at most {MAX_RESOLUTIONS_PER_PUT}, got {len(items)}"
            )
        with self.transaction():
            self._owned_source_hash(owner_id, paper_id)
            if not self._generation_exists(owner_id, paper_id, generation):
                raise GenerationNotFound(f"generation {generation} of this paper does not exist")
            known = {
                str(row["anchor_id"])
                for row in self._all(
                    "SELECT anchor_id FROM anchors WHERE owner_id = ? AND paper_id = ?",
                    (owner_id, paper_id),
                )
            }
            checked = [
                _check_resolution(item, f"items[{index}]", anchor_ids=known)
                for index, item in enumerate(items)
            ]
            for index, item in enumerate(checked):
                if item.generation != generation:
                    raise HighlightRejected(
                        "validation_failed",
                        f"items[{index}].generation is {item.generation}, not {generation}",
                    )
            self._conn.executemany(
                _UPSERT_RESOLUTION, _resolution_params(owner_id, paper_id, checked, now_iso())
            )
        return len(checked)

    def upgrade_legacy_anchor(
        self, owner: OwnerId, paper_id: PaperId, anchor_id: str, anchor_json: Mapping[str, Any]
    ) -> None:
        """Replaces a 0005-converted anchor's record with a full one the reader captured.

        Allowed ONLY while the stored record's ``doc.textStreamId`` is ``legacy-0001``, i.e. the row
        0005 built in SQL without a quote (contracts.md §1.1, ADR-002 §6.3). The new record must
        keep the anchor's id and paper, match the paper's ``source_hash``, and be complete (a
        quote and at least one quad). Raises :class:`PaperNotFound` or :class:`HighlightRejected`.
        """
        owner_id = self._resolve(owner)
        with self.transaction():
            source_hash = self._owned_source_hash(owner_id, paper_id)
            stored = self._one(
                "SELECT anchor_json, ordinal FROM anchors "
                "WHERE owner_id = ? AND paper_id = ? AND anchor_id = ?",
                (owner_id, paper_id, anchor_id),
            )
            if stored is None:
                raise HighlightRejected(
                    "validation_failed", f"anchor {anchor_id} is not on this paper"
                )
            current = json.loads(str(stored["anchor_json"]))
            if current.get("doc", {}).get("textStreamId") != LEGACY_TEXT_STREAM_ID:
                raise HighlightRejected(
                    "validation_failed",
                    f"anchor {anchor_id} is not a legacy-0001 row, so it cannot be upgraded",
                )
            prepared = _prepare_anchor(
                anchor_json,
                ordinal=int(stored["ordinal"]),
                paper_id=paper_id,
                source_hash=source_hash,
                require_complete=True,
            )
            if prepared.anchor_id != anchor_id:
                raise HighlightRejected(
                    "validation_failed", "upgraded_anchor.id must equal the anchor it replaces"
                )
            self._conn.execute(
                "UPDATE anchors SET anchor_json = ?, target_kind = ?, provenance_class = ?, "
                "quote_exact = ?, page_index = ? WHERE owner_id = ? AND anchor_id = ?",
                (
                    prepared.anchor_json,
                    prepared.target_kind,
                    prepared.provenance_class,
                    prepared.quote_exact,
                    prepared.page_index,
                    owner_id,
                    anchor_id,
                ),
            )

    # ── internals ────────────────────────────────────────────────────────────────────────

    def _owned_source_hash(self, owner_id: str, paper_id: str) -> str:
        row = self._one(
            "SELECT source_hash FROM paper_owners WHERE owner_id = ? AND paper_id = ?",
            (owner_id, paper_id),
        )
        if row is None:
            raise PaperNotFound(f"no such paper: {paper_id}")
        return str(row["source_hash"])

    def _generation_exists(self, owner_id: str, paper_id: str, generation: int) -> bool:
        return (
            self._one(
                "SELECT 1 AS present FROM papers "
                "WHERE owner_id = ? AND paper_id = ? AND generation = ?",
                (owner_id, paper_id, generation),
            )
            is not None
        )

    def _replay_or_conflict(
        self,
        owner_id: str,
        existing: Row,
        paper_id: str,
        color: str,
        note: str | None,
        prepared: Sequence[_PreparedAnchor],
    ) -> HighlightRow:
        stored = [
            (str(row["anchor_id"]), canonical_json(json.loads(str(row["anchor_json"]))))
            for row in self._all(
                "SELECT anchor_id, anchor_json FROM anchors "
                "WHERE owner_id = ? AND highlight_id = ? ORDER BY ordinal",
                (owner_id, existing["highlight_id"]),
            )
        ]
        same = (
            existing["paper_id"] == paper_id
            and existing["color"] == color
            and existing["note"] == note
            and stored == [(p.anchor_id, p.canonical) for p in prepared]
        )
        if not same:
            raise HighlightConflict(
                f"highlight {existing['highlight_id']} already exists with a different body"
            )
        return _highlight_row(existing)

    def _select_highlights(
        self, owner_id: str, paper_id: str, generation: int | None, highlight_id: str | None
    ) -> list[HighlightWithAnchors]:
        if generation is not None:
            _check_generation("generation", generation)
        rows = self._all(
            """SELECT h.highlight_id, h.paper_id, h.color, h.note, h.created_generation,
                      h.created_at, h.updated_at,
                      a.anchor_id, a.ordinal, a.anchor_json,
                      r.generation AS r_generation, r.tier AS r_tier, r.state AS r_state,
                      r.score AS r_score, r.block_ids AS r_block_ids, r.reason AS r_reason,
                      r.resolver_version AS r_resolver_version, r.resolved_at AS r_resolved_at
                 FROM highlights h
                 LEFT JOIN anchors a
                   ON a.owner_id = h.owner_id AND a.highlight_id = h.highlight_id
                 LEFT JOIN anchor_resolutions r
                   ON r.owner_id = a.owner_id AND r.anchor_id = a.anchor_id
                  AND r.paper_id = h.paper_id AND r.generation = ?
                WHERE h.owner_id = ? AND h.paper_id = ?
                  AND (? IS NULL OR h.highlight_id = ?)
                ORDER BY h.created_at, h.highlight_id, a.ordinal""",
            (generation, owner_id, paper_id, highlight_id, highlight_id),
        )
        out: list[HighlightWithAnchors] = []
        anchors: list[AnchorRow] = []
        current: Row | None = None
        for row in rows:
            if current is None or row["highlight_id"] != current["highlight_id"]:
                if current is not None:
                    out.append(_with_anchors(current, anchors))
                current, anchors = row, []
            if row["anchor_id"] is not None:
                anchors.append(_anchor_row(row))
        if current is not None:
            out.append(_with_anchors(current, anchors))
        return out


# ── module-private helpers ───────────────────────────────────────────────────────────────────

_UPSERT_RESOLUTION: Final = (
    "INSERT INTO anchor_resolutions (owner_id, anchor_id, paper_id, generation, tier, state, "
    "score, block_ids, reason, resolver_version, resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) "
    "ON CONFLICT (owner_id, anchor_id, generation) DO UPDATE SET tier = excluded.tier, "
    "state = excluded.state, score = excluded.score, block_ids = excluded.block_ids, "
    "reason = excluded.reason, resolver_version = excluded.resolver_version, "
    "resolved_at = excluded.resolved_at"
)


def _resolution_params(
    owner_id: str, paper_id: str, items: Sequence[ResolutionIn], now: str
) -> list[tuple[Any, ...]]:
    return [
        (
            owner_id,
            r.anchor_id,
            paper_id,
            r.generation,
            r.tier,
            r.state,
            r.score,
            client_json(list(r.block_ids)),
            r.reason,
            r.resolver_version,
            now,
        )
        for r in items
    ]


def _highlight_row(row: Row) -> HighlightRow:
    return HighlightRow(
        highlight_id=str(row["highlight_id"]),
        paper_id=str(row["paper_id"]),
        color=str(row["color"]),
        note=None if row["note"] is None else str(row["note"]),
        created_generation=int(row["created_generation"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _with_anchors(row: Row, anchors: Sequence[AnchorRow]) -> HighlightWithAnchors:
    base = _highlight_row(row)
    return HighlightWithAnchors(
        highlight_id=base.highlight_id,
        paper_id=base.paper_id,
        color=base.color,
        note=base.note,
        created_generation=base.created_generation,
        created_at=base.created_at,
        updated_at=base.updated_at,
        anchors=tuple(anchors),
    )


def _anchor_row(row: Row) -> AnchorRow:
    resolution = None
    if row["r_generation"] is not None:
        resolution = ResolutionRow(
            generation=int(row["r_generation"]),
            tier=int(row["r_tier"]),
            state=str(row["r_state"]),
            block_ids=tuple(str(b) for b in json.loads(str(row["r_block_ids"]))),
            score=None if row["r_score"] is None else float(row["r_score"]),
            reason=None if row["r_reason"] is None else str(row["r_reason"]),
            resolver_version=str(row["r_resolver_version"]),
            resolved_at=str(row["r_resolved_at"]),
        )
    return AnchorRow(
        anchor_id=str(row["anchor_id"]),
        ordinal=int(row["ordinal"]),
        anchor=json.loads(str(row["anchor_json"])),
        resolution=resolution,
    )


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: object) -> bool:
    """A finite JSON number. An integer past float range (10**400) is not one: ``float()`` raises
    ``OverflowError`` on it, and no PDF-space coordinate or score is that large."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:
        return False


def _check_prefixed_id(field: str, value: object) -> None:
    if not isinstance(value, str) or PREFIXED_ID.fullmatch(value) is None:
        raise HighlightRejected(
            "validation_failed", f"{field} must match {PREFIXED_ID.pattern}, got {value!r}"
        )


def _check_color(color: object) -> None:
    if not isinstance(color, str) or not color.strip():
        raise HighlightRejected("validation_failed", "color must be a non-empty string")


def _is_sql_int(value: object, minimum: int) -> bool:
    """An int (not a bool) from ``minimum`` to ``SQLITE_INTEGER_MAX``: one SQLite can bind."""
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and minimum <= value <= SQLITE_INTEGER_MAX
    )


def _check_generation(field: str, value: object) -> None:
    if not _is_sql_int(value, 1):
        raise HighlightRejected(
            "validation_failed", f"{field} must be an integer from 1 to {SQLITE_INTEGER_MAX}"
        )


def _selectors_of(record: Mapping[str, Any], where: str) -> list[Mapping[str, Any]]:
    selectors = record.get("selectors")
    if not isinstance(selectors, list) or not all(
        isinstance(s, Mapping) and isinstance(s.get("type"), str) for s in selectors
    ):
        raise HighlightRejected(
            "validation_failed", f"{where}.selectors must be a list of objects with a type"
        )
    return list(selectors)


def _is_quad(value: object) -> bool:
    return isinstance(value, list) and len(value) == 4 and all(_is_number(v) for v in value)


def _prepare_anchor(
    raw: object,
    *,
    ordinal: int,
    paper_id: str,
    source_hash: str,
    require_complete: bool,
) -> _PreparedAnchor:
    """Checks one client Anchor record and derives the denormalised columns 0005 keeps beside it."""
    where = f"anchors[{ordinal}].anchor"
    if not isinstance(raw, Mapping):
        raise HighlightRejected("validation_failed", f"{where} must be an object")
    # contracts.md §2.4: "The server strips any `resolution` field from an incoming Anchor before
    # storing anchor_json. The T0 cache lives only in anchor_resolutions."
    record = {key: value for key, value in raw.items() if key != "resolution"}

    version = record.get("anchorVersion")
    if not _is_int(version) or version != 1:
        raise HighlightRejected("validation_failed", f"{where}.anchorVersion must be 1")
    anchor_id = record.get("id")
    if not isinstance(anchor_id, str) or not (
        BARE_UUID.fullmatch(anchor_id) or PREFIXED_ID.fullmatch(anchor_id)
    ):
        raise HighlightRejected(
            "validation_failed", f"{where}.id must be a UUID or a prefixed id, got {anchor_id!r}"
        )
    doc = record.get("doc")
    if not isinstance(doc, Mapping):
        raise HighlightRejected("validation_failed", f"{where}.doc must be an object")
    if doc.get("paperId") != paper_id:
        raise HighlightRejected(
            "anchor_mismatch", f"{where}.doc.paperId is {doc.get('paperId')!r}, not this paper"
        )
    if doc.get("pdfSha256") != source_hash:
        raise HighlightRejected(
            "anchor_mismatch",
            f"{where}.doc.pdfSha256 does not match this paper's source hash",
        )
    target_kind = record.get("targetKind")
    if not isinstance(target_kind, str) or not target_kind:
        raise HighlightRejected("validation_failed", f"{where}.targetKind must be a string")
    provenance = record.get("provenanceClass")
    if provenance not in PROVENANCE_CLASSES:
        raise HighlightRejected(
            "validation_failed",
            f"{where}.provenanceClass must be one of {sorted(PROVENANCE_CLASSES)}",
        )
    selectors = _selectors_of(record, where)

    quote = next(
        (
            s
            for s in selectors
            if s["type"] == "TextQuoteSelector" and isinstance(s.get("exact"), str) and s["exact"]
        ),
        None,
    )
    shape = next(
        (
            s
            for s in selectors
            if s["type"] == "ShapeSelector"
            and isinstance(s.get("quads"), list)
            and len(s["quads"]) >= 1
            and all(_is_quad(q) for q in s["quads"])
        ),
        None,
    )
    if require_complete and (quote is None or shape is None):
        missing = [
            name
            for name, found in (
                ("a TextQuoteSelector", quote),
                ("a ShapeSelector with >= 1 quad", shape),
            )
            if found is None
        ]
        raise HighlightRejected("anchor_incomplete", f"{where} lacks {' and '.join(missing)}")

    page_index: int | None = None
    page = next((s for s in selectors if s["type"] == "PageSelector"), None)
    for candidate in (
        page.get("index") if page else None,
        shape.get("pageIndex") if shape else None,
    ):
        if candidate is not None:
            if not _is_sql_int(candidate, 0):
                raise HighlightRejected(
                    "validation_failed",
                    f"{where}: a page index must be an integer from 0 to {SQLITE_INTEGER_MAX}",
                )
            page_index = int(candidate)
            break

    try:
        anchor_json = client_json(record)
        canonical = canonical_json(record)
    except (TypeError, ValueError) as exc:
        raise HighlightRejected("validation_failed", f"{where} is not plain JSON ({exc})") from exc
    return _PreparedAnchor(
        anchor_id=anchor_id,
        ordinal=ordinal,
        anchor_json=anchor_json,
        canonical=canonical,
        target_kind=target_kind,
        provenance_class=str(provenance),
        quote_exact=None if quote is None else str(quote["exact"]),
        page_index=page_index,
    )


def _check_resolution(item: object, where: str, *, anchor_ids: set[str]) -> ResolutionIn:
    if not isinstance(item, ResolutionIn):
        raise HighlightRejected("validation_failed", f"{where} must be a ResolutionIn")
    if item.anchor_id not in anchor_ids:
        raise HighlightRejected(
            "validation_failed", f"{where}.anchor_id {item.anchor_id!r} is not an anchor here"
        )
    _check_generation(f"{where}.generation", item.generation)
    if not _is_int(item.tier) or not 0 <= item.tier <= 6:
        raise HighlightRejected("validation_failed", f"{where}.tier must be an integer 0-6")
    if item.state not in RESOLUTION_STATES:
        raise HighlightRejected(
            "validation_failed", f"{where}.state must be one of {sorted(RESOLUTION_STATES)}"
        )
    if isinstance(item.block_ids, (str, bytes)) or not all(
        isinstance(b, str) for b in item.block_ids
    ):
        raise HighlightRejected("validation_failed", f"{where}.block_ids must be a list of strings")
    if item.score is not None and not (_is_number(item.score) and 0 <= item.score <= 1):
        raise HighlightRejected("validation_failed", f"{where}.score must be null or in [0, 1]")
    if item.reason is not None and not isinstance(item.reason, str):
        raise HighlightRejected("validation_failed", f"{where}.reason must be a string or null")
    if not isinstance(item.resolver_version, str) or not item.resolver_version:
        raise HighlightRejected("validation_failed", f"{where}.resolver_version must be a string")
    return item
