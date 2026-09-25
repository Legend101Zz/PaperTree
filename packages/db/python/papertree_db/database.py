"""PaperTreeDb — the core of the SQLite data layer, and the class that assembles the mixins.

THE SPLIT (contracts.md §1.1, S0). ``PaperTreeDb`` is ``DatabaseCore`` plus four feature mixins,
each owned by one later slice (slice-plan.md §3), so call sites keep ``db.<method>``:

  * ``database.py``   this module: the connection, owner minting, ``transaction()``, and the
                      parse-derived tables (papers, pages, blocks, relations, derivations, vectors).
  * ``library.py``    S1 — the library listing and upload registration.
  * ``highlights.py`` S0 -> S4 — highlights, anchors, the per-generation resolution cache.
  * ``ai.py``         S5 — threads, messages, runs, citations, summaries.
  * ``canvas.py``     S7 — boards, nodes, edges.

The mixins hold no state (``__slots__ = ()``) and reach the connection only through the members
this class defines; for the type checker they subclass ``DatabaseCore``, at runtime ``object``.

THE OWNERSHIP MECHANISM, expressed in the two things Python can enforce:

  1. THE CONNECTION IS PRIVATE BY CONVENTION, AND THAT IS THE HONEST WORDING. ``_conn`` is
     not exported from ``papertree_db`` and there is no accessor, so no SQL exists outside
     this package in any code anyone writes on purpose. It is NOT unreachable: ``db._conn``
     is an ordinary attribute lookup and hands back a live ``sqlite3.Connection``, which
     restores exactly the capability findings.md §F describes — an unscoped query, and an
     unscoped cross-tenant UPDATE, at a call site. Python cannot make that impossible. (The
     deleted TypeScript twin could: ``#db`` was an ES private field.) ``_conn`` is a FORBIDDEN
     TOKEN outside this package: ``test_ownership.py`` parses every consumer package for the
     attribute ``._conn`` and fails if one appears.
  2. EVERY DATA METHOD TAKES ``owner: OwnerId`` FIRST. Omitting it is a ``TypeError`` at
     runtime and ``call-arg`` under mypy; passing a ``str`` is ``arg-type`` under mypy and
     ``OwnershipError`` at runtime, because ``_resolve`` refuses anything but a handle THIS
     connection minted. (``run_grant`` is the one documented exception: a run token is the
     credential, contracts.md §1.1.)
  3. ``OwnerId`` IS AN UNGUESSABLE PER-CONNECTION HANDLE, NOT A USER ID (ids.py). This is the
     second design and the first one was WRONG: it kept a set of minted USER IDS, so naming a
     tenant's user id was enough, and an adversarial review reproduced findings.md §F1 through
     it three separate ways — see ids.py's docstring, which lists them. A ``user_id`` is public:
     it appears in URLs, logs and emails. The handle is 32 CSPRNG bytes that appear nowhere at
     all, so a forged ``OwnerId`` — however it was built — holds a string no connection has
     heard of.
  4. THE SCHEMA CARRIES THE OWNER IN EVERY FOREIGN KEY, so a cross-tenant row cannot be
     INSERTed and every join key is owner-qualified. That gate lives in the .sql.

WHAT NONE OF THE FOUR GATES DOES: authenticate anybody. ``owner_for`` checks that a ``users``
row exists and nothing more — see its docstring. The caller is the trust boundary.

The acceptance criterion for Python is "raises". Both halves are tested: ``test_typing.py``
carries ``# type: ignore[...]`` comments on the illegal calls, which — because
``warn_unused_ignores`` is on under ``mypy --strict`` — fail the typecheck if the call ever
becomes legal.
"""

from __future__ import annotations

import sqlite3
import struct
from collections.abc import Iterable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import Any, Final, Self

import sqlite_vec  # type: ignore[import-untyped]

from ._support import Row, now_iso, opt_json, row_to_dict, to_json
from .ai import AiMixin
from .canvas import CanvasMixin
from .errors import OwnershipError
from .highlights import HighlightsMixin
from .ids import (
    BlockId,
    DerivationId,
    Generation,
    OwnerId,
    PaperId,
    mint_owner,
    new_id,
)
from .ids import (
    generation as brand_generation,
)
from .library import LibraryMixin
from .migrate import MigrationResult, migrate

__all__ = [
    "MAX_DERIVATION_DEPTH",
    "VECTOR_DIMENSIONS",
    "CreatedUser",
    "DatabaseCore",
    "PaperTreeDb",
    "Row",
    "open_database",
    "to_vector_blob",
]

#: Embedding width declared by ``block_vectors`` in 0001_core.sql.
VECTOR_DIMENSIONS: Final = 768

#: Hard cap on derivation-tree traversal. findings.md §F3: "no depth or cycle guard".
MAX_DERIVATION_DEPTH: Final = 64


def to_vector_blob(values: Sequence[float]) -> bytes:
    """Packs an embedding into the little-endian float32 blob sqlite-vec expects."""
    if len(values) != VECTOR_DIMENSIONS:
        raise ValueError(f"embedding must have {VECTOR_DIMENSIONS} dimensions, got {len(values)}")
    return struct.pack(f"<{len(values)}f", *values)


@dataclass(frozen=True, slots=True)
class CreatedUser:
    """What ``create_user`` returns. The mirror of TypeScript's ``{ userId, owner }``.

    ``user_id`` is public data — it appears in URLs, logs and emails. ``owner`` is a bearer
    credential for this connection. They are returned together and must be treated apart.
    """

    user_id: str
    owner: OwnerId


class DatabaseCore:
    """The connection, owner minting, ``transaction()`` and the parse-derived tables.

    Not used directly: ``PaperTreeDb`` below is this class plus the four feature mixins. It holds
    ALL of the instance state (the mixins declare ``__slots__ = ()``), so there is still exactly
    one place a connection lives.
    """

    __slots__ = ("_conn", "_handles", "_migrations_dir")

    def __init__(self, filename: str | Path = ":memory:", migrations_dir: Path | None = None):
        conn = sqlite3.connect(str(filename), isolation_level=None)
        conn.row_factory = row_to_dict
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
        # handle -> user_id, for the handles THIS connection minted. See `_resolve`: the handle
        # is unguessable, which is what makes a forged OwnerId worthless rather than merely
        # awkward to build. Bounded by the number of authentications.
        self._handles: dict[str, str] = {}

    # ── lifecycle ────────────────────────────────────────────────────────────────────

    def migrate(self) -> MigrationResult:
        return migrate(self._conn, self._migrations_dir)

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    # ── owner minting ────────────────────────────────────────────────────────────────

    def create_user(self, email: str) -> CreatedUser:
        """Creates a user and returns both their ``user_id`` and an owner handle for them."""
        user_id = new_id("usr")
        self._conn.execute(
            "INSERT INTO users (user_id, email, created_at) VALUES (?, ?, ?)",
            (user_id, email, now_iso()),
        )
        return CreatedUser(user_id=user_id, owner=self._mint(user_id))

    def owner_for(self, user_id: str) -> OwnerId:
        """Turns an ALREADY-VERIFIED user id into an owner handle.

        THIS PERFORMS NO AUTHENTICATION, and it was called ``authenticate`` until an adversarial
        review pointed out that the name asserted the opposite of what the body does. All it
        checks is that a ``users`` row exists; "no auth beyond a users table" is a stated
        non-goal of Epic 0, so that is the intended contract, but it must be stated rather than
        implied by a method name.

        THE CALLER IS THE TRUST BOUNDARY. Passing a user id taken from a request — a path
        parameter, a header, a cookie the caller has not verified — is findings.md §F1, and no
        gate in this package can stop it: gate 3 makes a user id worthless to code that holds
        only an owner handle, which is precisely the code inside a request handler. Code that
        can reach ``owner_for`` is inside the trust boundary by construction, so keep the mint
        out of the handler and hand the handler its one handle.
        """
        row = self._conn.execute(
            "SELECT user_id FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row is None:
            raise OwnershipError(f"no such user: {user_id}")
        return self._mint(user_id)

    def _mint(self, user_id: str) -> OwnerId:
        """Issues an unguessable handle for a user id that has just been proven to exist."""
        handle, owner = mint_owner()
        self._handles[handle] = user_id
        return owner

    # ── transactions ─────────────────────────────────────────────────────────────────

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """ONE ``BEGIN IMMEDIATE … COMMIT`` around the block; ``ROLLBACK`` if it raises.

        The connection is in autocommit (``isolation_level=None``) outside this, so a single
        statement needs no transaction and every multi-row write must use one (contracts.md
        §1.1). ``IMMEDIATE`` takes the write lock at ``BEGIN`` rather than at the first write, so
        two processes (the API and the worker share this file) cannot both read and then both try
        to upgrade — the loser waits at ``BEGIN`` instead of failing mid-way with ``SQLITE_BUSY``.

        NESTING IS A SAVEPOINT. Inside an open transaction the block runs as ``SAVEPOINT`` /
        ``RELEASE``, and an exception rolls back to the savepoint only, then propagates. So a
        caller can group several methods that each use ``transaction()`` into one atomic unit —
        ``PUT …/highlights/resolutions`` does — and each still protects itself when called alone.
        """
        conn = self._conn
        if conn.in_transaction:
            conn.execute("SAVEPOINT papertree_nested")
            try:
                yield
            except BaseException:
                if conn.in_transaction:
                    conn.execute("ROLLBACK TO papertree_nested")
                    conn.execute("RELEASE papertree_nested")
                raise
            conn.execute("RELEASE papertree_nested")
            return
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            # SQLite rolls some errors back by itself (SQLITE_FULL, SQLITE_IOERR, …); a second
            # ROLLBACK would then raise and mask the error that matters.
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")

    # ── papers ───────────────────────────────────────────────────────────────────────

    def put_paper(self, owner: OwnerId, paper: Mapping[str, Any]) -> None:
        """Writes one PaperIR generation in ONE ``transaction()`` with prepared statements.

        ``paper`` is the PaperIR document as plain JSON data — i.e. what
        ``papertree_document_ir`` produces, via ``model_dump(mode="json")``. Validating it
        is document-ir's job; this package's job is to store it without losing anything.
        """
        owner_id = self._resolve(owner)
        now = now_iso()
        gen = brand_generation(int(paper["generation"]))
        paper_id = str(paper["paper_id"])
        parser = paper["parser"]

        with self.transaction():
            self._conn.execute(
                "INSERT OR IGNORE INTO paper_owners (paper_id, owner_id, source_hash, created_at) "
                "VALUES (?, ?, ?, ?)",
                (paper_id, owner_id, paper["source_hash"], now),
            )
            bound = self._conn.execute(
                "SELECT owner_id FROM paper_owners WHERE paper_id = ?", (paper_id,)
            ).fetchone()
            if bound is not None and bound["owner_id"] != owner_id:
                raise OwnershipError(f"paper {paper_id} belongs to another owner")

            self._conn.execute(
                """INSERT INTO papers (owner_id, paper_id, generation, source_hash, ir_version,
                     coordinate_space, parser_name, parser_version, parser_config_hash,
                     parser_profile, parsed_at, status, partial_reason, metadata, sections,
                     references_json, confidence, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    owner_id,
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
                    to_json(paper["metadata"]),
                    to_json(paper["sections"]),
                    to_json(paper["references"]),
                    to_json(paper["confidence"]),
                    now,
                ),
            )
            self._conn.executemany(
                """INSERT INTO pages (owner_id, paper_id, generation, page_id, page_index, width,
                     height, rotation, user_unit, crop_box, media_box, image, has_text_layer,
                     is_scanned, confidence)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                _page_params(owner_id, paper_id, gen, paper["pages"]),
            )
            self._conn.executemany(
                """INSERT INTO blocks (owner_id, paper_id, generation, block_id, page_index, type,
                     flow, "order", doc_order, parent_id, prev_id, next_id, child_ids, polygon,
                     bbox_x0, bbox_y0, bbox_x1, bbox_y1, text, text_normalised, content_hash,
                     spans, payload, source, confidence, provenance, repairs, alternatives)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                _block_params(owner_id, paper_id, gen, paper["blocks"]),
            )
            self._conn.executemany(
                """INSERT INTO relations (owner_id, paper_id, generation, type, from_block,
                     to_block, confidence, provenance)
                   VALUES (?,?,?,?,?,?,?,?)""",
                _relation_params(owner_id, paper_id, gen, paper["relations"]),
            )

    def get_paper(self, owner: OwnerId, paper_id: PaperId, generation: Generation) -> Row | None:
        owner_id = self._resolve(owner)
        return self._one(
            "SELECT * FROM papers WHERE owner_id = ? AND paper_id = ? AND generation = ?",
            (owner_id, paper_id, generation),
        )

    def list_papers(self, owner: OwnerId) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM papers WHERE owner_id = ? ORDER BY created_at DESC, generation DESC",
            (owner_id,),
        )

    def list_generations(self, owner: OwnerId, paper_id: PaperId) -> list[int]:
        owner_id = self._resolve(owner)
        rows = self._all(
            "SELECT generation FROM papers WHERE owner_id = ? AND paper_id = ? ORDER BY generation",
            (owner_id, paper_id),
        )
        return [int(r["generation"]) for r in rows]

    def promote_generation(self, owner: OwnerId, paper_id: PaperId, generation: Generation) -> None:
        """D13/R13: promotion is mutable state, so it lives here, not in the PaperIR doc."""
        owner_id = self._resolve(owner)
        self._conn.execute(
            "INSERT INTO paper_promotions (owner_id, paper_id, generation, promoted_at) "
            "VALUES (?,?,?,?) ON CONFLICT (owner_id, paper_id) DO UPDATE SET "
            "generation = excluded.generation, promoted_at = excluded.promoted_at",
            (owner_id, paper_id, generation, now_iso()),
        )

    def promoted_generation(self, owner: OwnerId, paper_id: PaperId) -> int | None:
        owner_id = self._resolve(owner)
        row = self._one(
            "SELECT generation FROM paper_promotions WHERE owner_id = ? AND paper_id = ?",
            (owner_id, paper_id),
        )
        return None if row is None else int(row["generation"])

    def delete_paper(self, owner: OwnerId, paper_id: PaperId) -> int:
        owner_id = self._resolve(owner)
        cursor = self._conn.execute(
            "DELETE FROM paper_owners WHERE owner_id = ? AND paper_id = ?",
            (owner_id, paper_id),
        )
        return cursor.rowcount

    # ── pages / blocks / relations ───────────────────────────────────────────────────

    def list_pages(self, owner: OwnerId, paper_id: PaperId, generation: Generation) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM pages WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "ORDER BY page_index",
            (owner_id, paper_id, generation),
        )

    def get_block(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation, block_id: BlockId
    ) -> Row | None:
        owner_id = self._resolve(owner)
        return self._one(
            "SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "AND block_id = ?",
            (owner_id, paper_id, generation, block_id),
        )

    def list_blocks_in_doc_order(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation
    ) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "AND doc_order IS NOT NULL ORDER BY doc_order",
            (owner_id, paper_id, generation),
        )

    def list_blocks_on_page(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation, page_index: int
    ) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            'AND page_index = ? ORDER BY flow, "order"',
            (owner_id, paper_id, generation, page_index),
        )

    def count_blocks(self, owner: OwnerId, paper_id: PaperId, generation: Generation) -> int:
        owner_id = self._resolve(owner)
        row = self._one(
            "SELECT count(*) AS n FROM blocks WHERE owner_id = ? AND paper_id = ? "
            "AND generation = ?",
            (owner_id, paper_id, generation),
        )
        return 0 if row is None else int(row["n"])

    def list_relations(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation
    ) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM relations WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "ORDER BY type, from_block, to_block",
            (owner_id, paper_id, generation),
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
        owner_id = self._resolve(owner)
        derivation_id = new_id("drv")
        self._conn.execute(
            """INSERT INTO derivations (derivation_id, owner_id, paper_id, generation,
                 parent_derivation_id, kind, author_kind, model_id, prompt_hash, content,
                 derived_from, created_at)
               VALUES (?,?,?,?,?,?,'model',?,?,?,?,?)""",
            (
                derivation_id,
                owner_id,
                paper_id,
                generation,
                parent_derivation_id,
                kind,
                model_id,
                prompt_hash,
                to_json(content),
                to_json(list(derived_from)),
                now_iso(),
            ),
        )
        return DerivationId(derivation_id)

    def get_derivation(self, owner: OwnerId, derivation_id: DerivationId) -> Row | None:
        owner_id = self._resolve(owner)
        return self._one(
            "SELECT * FROM derivations WHERE owner_id = ? AND derivation_id = ?",
            (owner_id, derivation_id),
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
        owner_id = self._resolve(owner)
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
            (owner_id, root_id, owner_id, max_depth, owner_id),
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
        owner_id = self._resolve(owner)
        blob = to_vector_blob(embedding)
        partition = _paper_key(owner_id, paper_id, generation)
        vec_key = f"{partition}#{block_id}"
        with self.transaction():
            # vec0 has no UPSERT; delete-then-insert is the supported replace.
            self._conn.execute("DELETE FROM block_vectors WHERE vec_key = ?", (vec_key,))
            self._conn.execute(
                "INSERT INTO block_vectors (paper_key, vec_key, block_id, model, embedding) "
                "VALUES (?,?,?,?,?)",
                (partition, vec_key, block_id, model, blob),
            )

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
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT block_id, distance FROM block_vectors "
            "WHERE embedding MATCH ? AND k = ? AND paper_key = ?",
            (to_vector_blob(query), k, _paper_key(owner_id, paper_id, generation)),
        )

    def count_block_vectors(self, owner: OwnerId, paper_id: PaperId, generation: Generation) -> int:
        owner_id = self._resolve(owner)
        row = self._one(
            "SELECT count(*) AS n FROM block_vectors WHERE paper_key = ?",
            (_paper_key(owner_id, paper_id, generation),),
        )
        return 0 if row is None else int(row["n"])

    # ── internals ────────────────────────────────────────────────────────────────────

    def _resolve(self, owner: OwnerId) -> str:
        """Turns an owner HANDLE into the ``user_id`` every statement binds.

        Refuses unless THIS connection minted the handle. The handle is 32 bytes of CSPRNG
        output that appears nowhere in the database, a URL, a log line or an email, so a caller
        cannot forge a value it cannot guess. That is what closes the three forgeries recorded in
        ids.py's docstring — importing ``_MINT``, importing ``_mint_owner``, and mutating a
        ``copy.copy`` — all of which produced an object holding a string the caller chose, and
        none of which can produce one this dict has heard of.
        """
        if not isinstance(owner, OwnerId):
            raise OwnershipError(
                f"expected an OwnerId minted by this connection, got {type(owner).__name__}"
            )
        user_id = self._handles.get(owner.handle)
        if user_id is None:
            raise OwnershipError(
                "that value was not minted by this connection. An OwnerId is an opaque handle "
                "returned by create_user() or owner_for(); constructing one around a user id — "
                "or any other string — does not make it one."
            )
        return user_id

    def _one(self, sql: str, params: tuple[Any, ...]) -> Row | None:
        row = self._conn.execute(sql, params).fetchone()
        return None if row is None else row

    def _all(self, sql: str, params: tuple[Any, ...]) -> list[Row]:
        return list(self._conn.execute(sql, params).fetchall())


class PaperTreeDb(LibraryMixin, HighlightsMixin, AiMixin, CanvasMixin, DatabaseCore):
    """The only way to reach the SQLite connection, and therefore the only place SQL is.

    ``DatabaseCore`` plus the four feature mixins (see the module docstring for who owns which).
    No state of its own: ``__slots__ = ()`` here and in every mixin, so the instance has exactly
    ``DatabaseCore``'s three slots and no ``__dict__`` to attach a connection accessor to.
    """

    __slots__ = ()


def open_database(
    filename: str | Path = ":memory:", migrations_dir: Path | None = None
) -> PaperTreeDb:
    """Opens a PaperTree database. Does NOT migrate — call ``migrate()`` explicitly."""
    return PaperTreeDb(filename, migrations_dir)


def _paper_key(owner_id: str, paper_id: PaperId, generation: Generation) -> str:
    """The ``block_vectors`` partition name. Owner-first, and module-private."""
    return f"{owner_id}/{paper_id}@{generation}"


def _page_params(
    owner_id: str, paper_id: str, gen: Generation, pages: Iterable[Mapping[str, Any]]
) -> Iterator[tuple[Any, ...]]:
    return (
        (
            owner_id,
            paper_id,
            gen,
            page["page_id"],
            page["index"],
            page["width"],
            page["height"],
            page["rotation"],
            page["user_unit"],
            to_json(page["crop_box"]),
            to_json(page["media_box"]),
            None if page["image"] is None else to_json(page["image"]),
            1 if page["has_text_layer"] else 0,
            1 if page["is_scanned"] else 0,
            page["confidence"],
        )
        for page in pages
    )


def _block_params(
    owner_id: str, paper_id: str, gen: Generation, blocks: Iterable[Mapping[str, Any]]
) -> Iterator[tuple[Any, ...]]:
    # A GENERATOR, not a list: sqlite3.executemany consumes it lazily, so a 30k-block paper
    # never materialises 30k marshalled tuples alongside the 30k source dicts.
    return (
        (
            owner_id,
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
            opt_json(block.get("child_ids")),
            to_json(block["polygon"]),
            block["bbox"][0],
            block["bbox"][1],
            block["bbox"][2],
            block["bbox"][3],
            block.get("text"),
            block.get("text_normalised"),
            block.get("content_hash"),
            opt_json(block.get("spans")),
            opt_json(block.get("payload")),
            block["source"],
            block["confidence"],
            to_json(block["provenance"]),
            opt_json(block.get("repairs")),
            opt_json(block.get("alternatives")),
        )
        for block in blocks
    )


def _relation_params(
    owner_id: str, paper_id: str, gen: Generation, relations: Iterable[Mapping[str, Any]]
) -> Iterator[tuple[Any, ...]]:
    return (
        (
            owner_id,
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
