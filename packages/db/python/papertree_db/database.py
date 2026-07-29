"""PaperTreeDb — the Python twin of ``packages/db/src/database.ts``.

THE OWNERSHIP MECHANISM (the full argument is in the TypeScript header; this is the same
design, expressed in the two things Python can enforce):

  1. THE CONNECTION IS PRIVATE. ``_conn`` is not exported from ``papertree_db`` and there
     is no accessor. No SQL exists outside this module, so no SQL outside this module can
     forget a WHERE clause.
  2. EVERY DATA METHOD TAKES ``owner: OwnerId`` FIRST. Omitting it is a ``TypeError`` at
     runtime and ``call-arg`` under mypy; passing a ``str`` is ``arg-type`` under mypy and
     ``OwnershipError`` at runtime, because ``_require_owner`` checks that the value is an
     ``OwnerId`` THIS connection minted.
  3. ``OwnerId`` HAS A GUARDED CONSTRUCTOR (ids.py). ``OwnerId("usr_x")`` raises. Python has
     no ``as`` cast, so unlike TypeScript there is no escape hatch to close.
  4. THE SCHEMA CARRIES THE OWNER IN EVERY FOREIGN KEY, so a cross-tenant row cannot be
     INSERTed and every join key is owner-qualified. That gate lives in the .sql and is
     shared with the TypeScript side by construction.

The acceptance criterion for Python is "raises". Both halves are tested: ``test_typing.py``
carries ``# type: ignore[...]`` comments on the illegal calls, which — because
``warn_unused_ignores`` is on under ``mypy --strict`` — fail the typecheck if the call ever
becomes legal, exactly as ``@ts-expect-error`` does on the TypeScript side.
"""

from __future__ import annotations

import json
import sqlite3
import struct
from collections.abc import Iterable, Iterator, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from types import TracebackType
from typing import Any, Final

import sqlite_vec  # type: ignore[import-untyped]

from .errors import OwnershipError
from .ids import (
    AnchorId,
    BlockId,
    DerivationId,
    Generation,
    HighlightId,
    OwnerId,
    PaperId,
    _mint_owner,
    new_id,
)
from .ids import (
    generation as brand_generation,
)
from .migrate import MigrationResult, migrate

#: Embedding width declared by ``block_vectors`` in 0001_core.sql.
VECTOR_DIMENSIONS: Final = 768

#: Hard cap on derivation-tree traversal. findings.md §F3: "no depth or cycle guard".
MAX_DERIVATION_DEPTH: Final = 64

#: A result row. Keys mirror the columns exactly; there is deliberately no rename layer.
Row = dict[str, Any]


def _row_to_dict(cursor: sqlite3.Cursor, row: tuple[Any, ...]) -> Row:
    return {column[0]: value for column, value in zip(cursor.description, row, strict=True)}


def to_vector_blob(values: Sequence[float]) -> bytes:
    """Packs an embedding into the little-endian float32 blob sqlite-vec expects."""
    if len(values) != VECTOR_DIMENSIONS:
        raise ValueError(f"embedding must have {VECTOR_DIMENSIONS} dimensions, got {len(values)}")
    return struct.pack(f"<{len(values)}f", *values)


class PaperTreeDb:
    """The only way to reach the SQLite connection, and therefore the only place SQL is."""

    __slots__ = ("_conn", "_migrations_dir", "_minted")

    def __init__(self, filename: str | Path = ":memory:", migrations_dir: Path | None = None):
        conn = sqlite3.connect(str(filename), isolation_level=None)
        conn.row_factory = _row_to_dict
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        # foreign_keys is PER-CONNECTION, never persisted, and Python's sqlite3 defaults it
        # OFF. Gate 4 of the ownership mechanism is inert without this line.
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        self._conn = conn
        self._migrations_dir = migrations_dir
        # Owner ids minted by THIS connection.
        self._minted: set[str] = set()

    # ── lifecycle ────────────────────────────────────────────────────────────────────

    def migrate(self) -> MigrationResult:
        return migrate(self._conn, self._migrations_dir)

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> PaperTreeDb:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    # ── owner minting ────────────────────────────────────────────────────────────────

    def create_user(self, email: str) -> OwnerId:
        user_id = new_id("usr")
        self._conn.execute(
            "INSERT INTO users (user_id, email, created_at) VALUES (?, ?, ?)",
            (user_id, email, _now()),
        )
        self._minted.add(user_id)
        return _mint_owner(user_id)

    def authenticate(self, user_id: str) -> OwnerId:
        """The ONLY function that turns a string into an ``OwnerId``, and it checks first."""
        row = self._conn.execute(
            "SELECT user_id FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row is None:
            raise OwnershipError(f"no such user: {user_id}")
        self._minted.add(user_id)
        return _mint_owner(user_id)

    # ── papers ───────────────────────────────────────────────────────────────────────

    def put_paper(self, owner: OwnerId, paper: Mapping[str, Any]) -> None:
        """Writes one PaperIR generation in a single transaction with prepared statements.

        ``paper`` is the PaperIR document as plain JSON data — i.e. what
        ``papertree_document_ir`` produces, via ``model_dump(mode="json")``. Validating it
        is document-ir's job; this package's job is to store it without losing anything.
        """
        self._require_owner(owner)
        now = _now()
        gen = brand_generation(int(paper["generation"]))
        paper_id = str(paper["paper_id"])
        parser = paper["parser"]

        self._conn.execute("BEGIN")
        try:
            self._conn.execute(
                "INSERT OR IGNORE INTO paper_owners (paper_id, owner_id, source_hash, created_at) "
                "VALUES (?, ?, ?, ?)",
                (paper_id, owner.value, paper["source_hash"], now),
            )
            bound = self._conn.execute(
                "SELECT owner_id FROM paper_owners WHERE paper_id = ?", (paper_id,)
            ).fetchone()
            if bound is not None and bound["owner_id"] != owner.value:
                raise OwnershipError(f"paper {paper_id} belongs to another owner")

            self._conn.execute(
                """INSERT INTO papers (owner_id, paper_id, generation, source_hash, ir_version,
                     coordinate_space, parser_name, parser_version, parser_config_hash,
                     parser_profile, parsed_at, status, partial_reason, metadata, sections,
                     references_json, confidence, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    owner.value,
                    paper_id,
                    gen,
                    paper["source_hash"],
                    paper["ir_version"],
                    paper["coordinate_space"],
                    parser["name"],
                    parser["version"],
                    parser["config_hash"],
                    parser.get("profile"),
                    parser["parsed_at"],
                    paper["status"],
                    paper["partial_reason"],
                    _json(paper["metadata"]),
                    _json(paper["sections"]),
                    _json(paper["references"]),
                    _json(paper["confidence"]),
                    now,
                ),
            )
            self._conn.executemany(
                """INSERT INTO pages (owner_id, paper_id, generation, page_id, page_index, width,
                     height, rotation, user_unit, crop_box, media_box, image, has_text_layer,
                     is_scanned, confidence)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                _page_params(owner, paper_id, gen, paper["pages"]),
            )
            self._conn.executemany(
                """INSERT INTO blocks (owner_id, paper_id, generation, block_id, page_index, type,
                     flow, "order", doc_order, parent_id, prev_id, next_id, child_ids, polygon,
                     bbox_x0, bbox_y0, bbox_x1, bbox_y1, text, text_normalised, content_hash,
                     spans, payload, source, confidence, provenance, repairs, alternatives)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                _block_params(owner, paper_id, gen, paper["blocks"]),
            )
            self._conn.executemany(
                """INSERT INTO relations (owner_id, paper_id, generation, type, from_block,
                     to_block, confidence, provenance)
                   VALUES (?,?,?,?,?,?,?,?)""",
                _relation_params(owner, paper_id, gen, paper["relations"]),
            )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")

    def get_paper(self, owner: OwnerId, paper_id: PaperId, generation: Generation) -> Row | None:
        self._require_owner(owner)
        return self._one(
            "SELECT * FROM papers WHERE owner_id = ? AND paper_id = ? AND generation = ?",
            (owner.value, paper_id, generation),
        )

    def list_papers(self, owner: OwnerId) -> list[Row]:
        self._require_owner(owner)
        return self._all(
            "SELECT * FROM papers WHERE owner_id = ? ORDER BY created_at DESC, generation DESC",
            (owner.value,),
        )

    def list_generations(self, owner: OwnerId, paper_id: PaperId) -> list[int]:
        self._require_owner(owner)
        rows = self._all(
            "SELECT generation FROM papers WHERE owner_id = ? AND paper_id = ? ORDER BY generation",
            (owner.value, paper_id),
        )
        return [int(r["generation"]) for r in rows]

    def promote_generation(self, owner: OwnerId, paper_id: PaperId, generation: Generation) -> None:
        """D13/R13: promotion is mutable state, so it lives here, not in the PaperIR doc."""
        self._require_owner(owner)
        self._conn.execute(
            "INSERT INTO paper_promotions (owner_id, paper_id, generation, promoted_at) "
            "VALUES (?,?,?,?) ON CONFLICT (owner_id, paper_id) DO UPDATE SET "
            "generation = excluded.generation, promoted_at = excluded.promoted_at",
            (owner.value, paper_id, generation, _now()),
        )

    def promoted_generation(self, owner: OwnerId, paper_id: PaperId) -> int | None:
        self._require_owner(owner)
        row = self._one(
            "SELECT generation FROM paper_promotions WHERE owner_id = ? AND paper_id = ?",
            (owner.value, paper_id),
        )
        return None if row is None else int(row["generation"])

    def delete_paper(self, owner: OwnerId, paper_id: PaperId) -> int:
        self._require_owner(owner)
        cursor = self._conn.execute(
            "DELETE FROM paper_owners WHERE owner_id = ? AND paper_id = ?",
            (owner.value, paper_id),
        )
        return cursor.rowcount

    # ── pages / blocks / relations ───────────────────────────────────────────────────

    def list_pages(self, owner: OwnerId, paper_id: PaperId, generation: Generation) -> list[Row]:
        self._require_owner(owner)
        return self._all(
            "SELECT * FROM pages WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "ORDER BY page_index",
            (owner.value, paper_id, generation),
        )

    def get_block(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation, block_id: BlockId
    ) -> Row | None:
        self._require_owner(owner)
        return self._one(
            "SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "AND block_id = ?",
            (owner.value, paper_id, generation, block_id),
        )

    def list_blocks_in_doc_order(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation
    ) -> list[Row]:
        self._require_owner(owner)
        return self._all(
            "SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "AND doc_order IS NOT NULL ORDER BY doc_order",
            (owner.value, paper_id, generation),
        )

    def list_blocks_on_page(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation, page_index: int
    ) -> list[Row]:
        self._require_owner(owner)
        return self._all(
            "SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            'AND page_index = ? ORDER BY flow, "order"',
            (owner.value, paper_id, generation, page_index),
        )

    def count_blocks(self, owner: OwnerId, paper_id: PaperId, generation: Generation) -> int:
        self._require_owner(owner)
        row = self._one(
            "SELECT count(*) AS n FROM blocks WHERE owner_id = ? AND paper_id = ? "
            "AND generation = ?",
            (owner.value, paper_id, generation),
        )
        return 0 if row is None else int(row["n"])

    def list_relations(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation
    ) -> list[Row]:
        self._require_owner(owner)
        return self._all(
            "SELECT * FROM relations WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "ORDER BY type, from_block, to_block",
            (owner.value, paper_id, generation),
        )

    # ── highlights + anchors ─────────────────────────────────────────────────────────

    def create_highlight(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: Generation,
        color: str,
        note: str | None = None,
    ) -> HighlightId:
        self._require_owner(owner)
        highlight_id = new_id("hl")
        now = _now()
        self._conn.execute(
            "INSERT INTO highlights (highlight_id, owner_id, paper_id, generation, color, note, "
            "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (highlight_id, owner.value, paper_id, generation, color, note, now, now),
        )
        return HighlightId(highlight_id)

    def get_highlight(self, owner: OwnerId, highlight_id: HighlightId) -> Row | None:
        self._require_owner(owner)
        return self._one(
            "SELECT * FROM highlights WHERE owner_id = ? AND highlight_id = ?",
            (owner.value, highlight_id),
        )

    def list_highlights(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation
    ) -> list[Row]:
        self._require_owner(owner)
        return self._all(
            "SELECT * FROM highlights WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "ORDER BY created_at",
            (owner.value, paper_id, generation),
        )

    def update_highlight_note(
        self, owner: OwnerId, highlight_id: HighlightId, note: str | None
    ) -> int:
        """The write findings.md §F1 got wrong: update by id alone, no owner filter."""
        self._require_owner(owner)
        cursor = self._conn.execute(
            "UPDATE highlights SET note = ?, updated_at = ? "
            "WHERE owner_id = ? AND highlight_id = ?",
            (note, _now(), owner.value, highlight_id),
        )
        return cursor.rowcount

    def delete_highlight(self, owner: OwnerId, highlight_id: HighlightId) -> int:
        self._require_owner(owner)
        cursor = self._conn.execute(
            "DELETE FROM highlights WHERE owner_id = ? AND highlight_id = ?",
            (owner.value, highlight_id),
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
        self._require_owner(owner)
        anchor_id = new_id("anc")
        self._conn.execute(
            """INSERT INTO anchors (anchor_id, owner_id, highlight_id, paper_id, generation,
                 block_id, tier, char_start, char_end, text_quote, quote_prefix, quote_suffix,
                 content_hash, polygon, bbox_x0, bbox_y0, bbox_x1, bbox_y1, resolved_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                anchor_id,
                owner.value,
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
                _json([list(point) for point in polygon]),
                bbox[0],
                bbox[1],
                bbox[2],
                bbox[3],
                _now(),
            ),
        )
        return AnchorId(anchor_id)

    def list_anchors(self, owner: OwnerId, highlight_id: HighlightId) -> list[Row]:
        self._require_owner(owner)
        return self._all(
            "SELECT * FROM anchors WHERE owner_id = ? AND highlight_id = ? "
            "ORDER BY tier, anchor_id",
            (owner.value, highlight_id),
        )

    def resolve_highlights(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation
    ) -> list[Row]:
        """THE MULTI-TABLE JOIN, with the owner predicate on EVERY joined table.

        findings.md §F3 is the version of this query that filters the root only. Note the
        join keys themselves carry owner_id, so ``anchors -> blocks`` cannot straddle two
        owners even if a predicate were dropped.
        """
        self._require_owner(owner)
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
            (owner.value, owner.value, paper_id, generation),
        )

    # ── derivations ──────────────────────────────────────────────────────────────────

    def create_derivation(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: Generation,
        kind: str,
        model_id: str,
        prompt_hash: str,
        content: object,
        derived_from: Sequence[BlockId],
        parent_derivation_id: DerivationId | None = None,
    ) -> DerivationId:
        self._require_owner(owner)
        derivation_id = new_id("drv")
        self._conn.execute(
            """INSERT INTO derivations (derivation_id, owner_id, paper_id, generation,
                 parent_derivation_id, kind, author_kind, model_id, prompt_hash, content,
                 derived_from, created_at)
               VALUES (?,?,?,?,?,?,'model',?,?,?,?,?)""",
            (
                derivation_id,
                owner.value,
                paper_id,
                generation,
                parent_derivation_id,
                kind,
                model_id,
                prompt_hash,
                _json(content),
                _json(list(derived_from)),
                _now(),
            ),
        )
        return DerivationId(derivation_id)

    def get_derivation(self, owner: OwnerId, derivation_id: DerivationId) -> Row | None:
        self._require_owner(owner)
        return self._one(
            "SELECT * FROM derivations WHERE owner_id = ? AND derivation_id = ?",
            (owner.value, derivation_id),
        )

    def derivation_tree(
        self,
        owner: OwnerId,
        root_id: DerivationId,
        max_depth: int = MAX_DERIVATION_DEPTH,
    ) -> list[Row]:
        """Walks a derivation tree downward, owner-filtered at EVERY level and depth-bounded.

        findings.md §F3 verbatim: "Ownership is checked only at the root. There is also no
        depth or cycle guard." Both are addressed: the owner predicate is repeated inside
        the recursive term, and ``depth`` bounds the walk.
        """
        self._require_owner(owner)
        return self._all(
            """WITH RECURSIVE tree(derivation_id, depth) AS (
                 SELECT d.derivation_id, 0
                   FROM derivations d
                  WHERE d.owner_id = ? AND d.derivation_id = ?
                 UNION ALL
                 SELECT c.derivation_id, tree.depth + 1
                   FROM derivations c
                   JOIN tree ON c.parent_derivation_id = tree.derivation_id
                  WHERE c.owner_id = ? AND tree.depth + 1 <= ?
               )
               SELECT d.*, tree.depth AS depth
                 FROM derivations d
                 JOIN tree ON tree.derivation_id = d.derivation_id
                WHERE d.owner_id = ?
                ORDER BY tree.depth, d.created_at""",
            (owner.value, root_id, owner.value, max_depth, owner.value),
        )

    # ── block_vectors (sqlite-vec) ───────────────────────────────────────────────────

    def put_block_vector(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: Generation,
        block_id: BlockId,
        model: str,
        embedding: Sequence[float],
    ) -> None:
        """Epic 0 computes NO embeddings. This path exists so Epic 3 inherits a proven table."""
        self._require_owner(owner)
        blob = to_vector_blob(embedding)
        partition = _paper_key(owner, paper_id, generation)
        vec_key = f"{partition}#{block_id}"
        self._conn.execute("BEGIN")
        try:
            # vec0 has no UPSERT; delete-then-insert is the supported replace.
            self._conn.execute("DELETE FROM block_vectors WHERE vec_key = ?", (vec_key,))
            self._conn.execute(
                "INSERT INTO block_vectors (paper_key, vec_key, block_id, model, embedding) "
                "VALUES (?,?,?,?,?)",
                (partition, vec_key, block_id, model, blob),
            )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")

    def search_block_vectors(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: Generation,
        query: Sequence[float],
        k: int,
    ) -> list[Row]:
        """KNN within ONE owner's paper generation.

        A vec0 table takes no foreign keys and has no owner_id column, so ownership is
        carried by the PARTITION KEY ``owner/paper@generation``. The partition name can
        only be built by ``_paper_key``, which requires an ``OwnerId``, so a search never
        visits another owner's partition.
        """
        self._require_owner(owner)
        return self._all(
            "SELECT block_id, distance FROM block_vectors "
            "WHERE embedding MATCH ? AND k = ? AND paper_key = ?",
            (to_vector_blob(query), k, _paper_key(owner, paper_id, generation)),
        )

    def count_block_vectors(self, owner: OwnerId, paper_id: PaperId, generation: Generation) -> int:
        self._require_owner(owner)
        row = self._one(
            "SELECT count(*) AS n FROM block_vectors WHERE paper_key = ?",
            (_paper_key(owner, paper_id, generation),),
        )
        return 0 if row is None else int(row["n"])

    # ── internals ────────────────────────────────────────────────────────────────────

    def _require_owner(self, owner: OwnerId) -> None:
        # `owner.value` is itself a gate (ids.py): it raises on an instance whose guarded
        # constructor was bypassed with `object.__new__`, so the `in self._minted` check
        # below is never reached with a forged value.
        if not isinstance(owner, OwnerId) or owner.value not in self._minted:
            raise OwnershipError(
                f"{owner!r} was not minted by this connection. An OwnerId comes from "
                f"create_user() or authenticate(); nothing else produces one."
            )

    def _one(self, sql: str, params: tuple[Any, ...]) -> Row | None:
        row = self._conn.execute(sql, params).fetchone()
        return None if row is None else row

    def _all(self, sql: str, params: tuple[Any, ...]) -> list[Row]:
        return list(self._conn.execute(sql, params).fetchall())


def open_database(
    filename: str | Path = ":memory:", migrations_dir: Path | None = None
) -> PaperTreeDb:
    """Opens a PaperTree database. Does NOT migrate — call ``migrate()`` explicitly."""
    return PaperTreeDb(filename, migrations_dir)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _paper_key(owner: OwnerId, paper_id: PaperId, generation: Generation) -> str:
    """The ``block_vectors`` partition name. Owner-first, and module-private."""
    return f"{owner.value}/{paper_id}@{generation}"


def _page_params(
    owner: OwnerId, paper_id: str, gen: Generation, pages: Iterable[Mapping[str, Any]]
) -> Iterator[tuple[Any, ...]]:
    return (
        (
            owner.value,
            paper_id,
            gen,
            page["page_id"],
            page["index"],
            page["width"],
            page["height"],
            page["rotation"],
            page["user_unit"],
            _json(page["crop_box"]),
            _json(page["media_box"]),
            None if page["image"] is None else _json(page["image"]),
            1 if page["has_text_layer"] else 0,
            1 if page["is_scanned"] else 0,
            page["confidence"],
        )
        for page in pages
    )


def _block_params(
    owner: OwnerId, paper_id: str, gen: Generation, blocks: Iterable[Mapping[str, Any]]
) -> Iterator[tuple[Any, ...]]:
    # A GENERATOR, not a list: sqlite3.executemany consumes it lazily, so a 30k-block paper
    # never materialises 30k marshalled tuples alongside the 30k source dicts.
    return (
        (
            owner.value,
            paper_id,
            gen,
            block["block_id"],
            block["page_index"],
            block["type"],
            block["flow"],
            block["order"],
            block.get("doc_order"),
            block.get("parent_id"),
            block.get("prev_id"),
            block.get("next_id"),
            _opt_json(block.get("child_ids")),
            _json(block["polygon"]),
            block["bbox"][0],
            block["bbox"][1],
            block["bbox"][2],
            block["bbox"][3],
            block.get("text"),
            block.get("text_normalised"),
            block.get("content_hash"),
            _opt_json(block.get("spans")),
            _opt_json(block.get("payload")),
            block["source"],
            block["confidence"],
            _json(block["provenance"]),
            _opt_json(block.get("repairs")),
            _opt_json(block.get("alternatives")),
        )
        for block in blocks
    )


def _relation_params(
    owner: OwnerId, paper_id: str, gen: Generation, relations: Iterable[Mapping[str, Any]]
) -> Iterator[tuple[Any, ...]]:
    return (
        (
            owner.value,
            paper_id,
            gen,
            relation["type"],
            relation["from"],
            relation["to"],
            relation["confidence"],
            relation["provenance"],
        )
        for relation in relations
    )


#: Compact, separator-pinned JSON. Smaller rows, and — because the separators are fixed
#: rather than defaulted — the same bytes on every write, which matters for a store whose
#: definition of done includes "re-parsing produces byte-identical PaperIR".
def _json(value: object) -> str:
    return json.dumps(value, separators=(",", ":"))


def _opt_json(value: object) -> str | None:
    return None if value is None else _json(value)
