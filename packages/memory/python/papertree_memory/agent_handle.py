"""``AgentDataHandle`` — the only handle a tool ever receives, and everything it can do.

WHAT THIS CLASS IS
    The Python stand-in for §13.4's ``papertree_agent`` database role. Everything the ~20
    tools of F3.4 need to read, and nothing else: no writer, no ``PaperTreeDb``, no
    ``MemoryStore``, no callback into a privileged object, no path back. Its capability set is
    the union of "SELECT" and nothing.

WHY IT DOES NOT WRAP ``PaperTreeDb``
    ``PaperTreeDb`` opens read-WRITE. Wrapping one and exposing only its read methods gives an
    object whose ``__slots__`` contain a live writable connection, which is a boundary made of
    method visibility — exactly the "application code" gate §13.7 rec. 2 says the trust
    boundary must not be. So this class opens its own connection through
    :func:`~papertree_memory.guard.open_guarded_read_only` and duplicates about eighty lines
    of SELECT.

    That duplication is a real cost and it is the point: **the two objects must not share a
    connection, because sharing one is the whole vulnerability.** The mitigation for drift is
    that both sides are the same SQL against the same STRICT schema, and
    ``test_agent_handle_reads.py`` asserts each read here agrees row-for-row with its
    ``PaperTreeDb`` counterpart on a real parsed document — so a schema change that breaks one
    and not the other fails a test rather than silently returning different data to the agent
    than to the API.

WHY THE OWNER IS BOUND AT CONSTRUCTION AND IS NOT A PARAMETER
    ``papertree_db``'s convention is ``owner: OwnerId`` first on every data method, and this
    class deliberately goes one step further: the owner is fixed when the handle is built and
    no method takes one. A tool cannot name another tenant even by accident, because there is
    no argument in which to name one. ``OwnerId`` could not have been reused anyway — it is a
    per-CONNECTION handle (``ids.py``: a handle minted by one connection means nothing on
    another), and this connection is not the one that minted it.

    ``user_id`` is therefore what the constructor takes, and — exactly as with
    ``PaperTreeDb.owner_for`` — **this performs no authentication**. It checks that a ``users``
    row exists and nothing more. The caller is the trust boundary for identity; this class is
    the trust boundary for capability. Handing it a user id straight off a request is
    findings.md §F1 and no gate here can stop it.

WHAT IS REACHABLE FROM THIS OBJECT, STATED PLAINLY
    ``handle._reader`` is one attribute lookup from the ``sqlite3.Connection``, exactly as
    ``db._conn`` is in ``papertree_db`` — Python cannot prevent that and this package does not
    claim to. The difference is what reaching it gets you: a ``mode=ro`` connection with an
    authorizer, on which every write, every DDL, ``ATTACH`` and ``VACUUM INTO`` are refused.
    Reaching the connection is not a capability; it is the same nothing, one step earlier.

    The one thing reaching it DOES allow is ``set_authorizer(None)``, which restores ``ATTACH``.
    That requires executing arbitrary Python in this process, at which point the adversary can
    ``import sqlite3`` and skip the handle entirely. See ``guard.py`` for the threat model this
    is sized against; `security/isolation.spec` walks the whole reachable object graph
    (including closure cells) and asserts what is and is not in it, rather than asserting the
    comfortable half.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from pathlib import Path
from types import TracebackType
from typing import Any, final

from papertree_db import BlockId, Generation, OwnershipError, PaperId, to_vector_blob

from .guard import RouteProbe, Row, open_guarded_read_only, probe_escape_routes


@final
class AgentDataHandle:
    """Read-only, owner-bound, and structurally incapable of writing anything.

    ``__slots__`` is not decoration. It means the set of attributes is fixed and enumerable,
    so `security/isolation.spec`'s audit of the reachable surface is exhaustive rather than a
    sample: a future field cannot be added without appearing in that list and being seen.
    """

    __slots__ = ("_database_path", "_owner_user_id", "_reader")

    #: Annotated, not assigned — an annotation is legal alongside ``__slots__`` and it is the
    #: only place a reader can see that ``_reader`` is a guarded connection and not a store.
    _reader: sqlite3.Connection
    _owner_user_id: str
    #: A ``str``, NOT a ``pathlib.Path``, and that is a security decision rather than a style
    #: one. A ``Path`` carries ``write_text``, ``write_bytes``, ``open``, ``mkdir`` and
    #: ``unlink``; storing one would mean the sentence "nothing reachable from this handle can
    #: touch the filesystem" was simply false, and `security/isolation.spec` asserts that
    #: sentence by walking the object graph and checking the TYPES it finds. A string is inert.
    _database_path: str

    def __init__(self, database_path: str | Path, user_id: str) -> None:
        """Opens a guarded read-only connection and binds it to one already-verified user.

        Both arguments are required and positional. There is no third argument and no
        classmethod that supplies a connection, so there is no construction path that could
        hand this object a writable one.
        """
        reader = open_guarded_read_only(database_path)
        row = reader.execute("SELECT user_id FROM users WHERE user_id = ?", (user_id,)).fetchone()
        if row is None:
            reader.close()
            raise OwnershipError(
                f"no such user: {user_id}. An agent handle is bound to a user at construction, "
                "so there is no later point at which this could be checked."
            )
        self._reader = reader
        self._owner_user_id = user_id
        self._database_path = str(database_path)

    # ── lifecycle ────────────────────────────────────────────────────────────────────

    @property
    def owner_user_id(self) -> str:
        """The user this handle reads as. Public data (§13.4 / ``ids.py``), not a credential.

        Exposed because the privileged runtime has to correlate a denied tool call with an
        audit row, and it needs the owner to write one.
        """
        return self._owner_user_id

    @property
    def database_path(self) -> str:
        """The file this handle reads, as a plain string.

        Exposed so a denial can say which database it was on. Returns ``str`` and not ``Path``
        for the reason given on ``_database_path``: handing a caller a ``Path`` hands it
        ``write_bytes``, and this object is supposed to hand out no such thing.
        """
        return self._database_path

    def close(self) -> None:
        self._reader.close()

    def __enter__(self) -> AgentDataHandle:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    # ── document reads (F3.4's tool registry reads through these) ────────────────────

    def get_paper(self, paper_id: PaperId, generation: Generation) -> Row | None:
        """One paper generation. ``sections`` and ``references_json`` arrive as JSON STRINGS.

        They are columns on ``papers``, not tables, and this method does not parse them: the
        agent's prompt builder needs the raw text to datamark it (§13.6(a)), and a helpful
        ``json.loads`` here would hand a caller a nested structure it then has to re-serialise
        before delimiting it.
        """
        return self._one(
            "SELECT * FROM papers WHERE owner_id = ? AND paper_id = ? AND generation = ?",
            (self._owner_user_id, paper_id, generation),
        )

    def list_pages(self, paper_id: PaperId, generation: Generation) -> list[Row]:
        return self._all(
            "SELECT * FROM pages WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "ORDER BY page_index",
            (self._owner_user_id, paper_id, generation),
        )

    def get_block(self, paper_id: PaperId, generation: Generation, block_id: BlockId) -> Row | None:
        return self._one(
            "SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "AND block_id = ?",
            (self._owner_user_id, paper_id, generation, block_id),
        )

    def list_blocks_in_doc_order(self, paper_id: PaperId, generation: Generation) -> list[Row]:
        """Top-level ``flow == 'body'`` blocks only — and that is not a bug in this method.

        ``doc_order`` is present on EXACTLY those blocks. It is absent on captions, footnotes,
        furniture and every nested block, so this list is the body spine and nothing else.
        AGENTS.md §4 names ``ORDER BY doc_order ?? 0`` as a thing that will bite you: it
        collapses every caption, footnote and table cell to position 0. Callers that need
        reading order over ALL blocks must build it from :meth:`list_blocks_on_page` per page
        per flow plus parent/child descent, which is why that method orders by
        ``flow, "order"`` and not by ``doc_order``.
        """
        return self._all(
            "SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "AND doc_order IS NOT NULL ORDER BY doc_order",
            (self._owner_user_id, paper_id, generation),
        )

    def list_blocks_on_page(
        self, paper_id: PaperId, generation: Generation, page_index: int
    ) -> list[Row]:
        """Every block on one page, ordered by flow then in-flow ``order``.

        ``Page.flows`` is not stored; this is what it is reconstructed from. Nested blocks are
        included — the caller filters on ``parent_id IS NULL`` to get the top level.
        """
        return self._all(
            "SELECT * FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            'AND page_index = ? ORDER BY flow, "order"',
            (self._owner_user_id, paper_id, generation, page_index),
        )

    def count_blocks(self, paper_id: PaperId, generation: Generation) -> int:
        row = self._one(
            "SELECT count(*) AS n FROM blocks WHERE owner_id = ? AND paper_id = ? "
            "AND generation = ?",
            (self._owner_user_id, paper_id, generation),
        )
        return 0 if row is None else int(row["n"])

    def list_relations(self, paper_id: PaperId, generation: Generation) -> list[Row]:
        """Every relation, including types this codebase has never heard of.

        ``Relation.type`` is an OPEN vocabulary — any string matching
        ``^[a-z][a-z0-9_]{0,63}$`` is valid. There is no filter here and there must not be
        one: an unknown relation type is PRESERVED and ignored, never dropped.
        ``is_known_relation_type()`` is a hint for a renderer, never a WHERE clause.
        """
        return self._all(
            "SELECT * FROM relations WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "ORDER BY type, from_block, to_block",
            (self._owner_user_id, paper_id, generation),
        )

    def search_block_vectors(
        self,
        paper_id: PaperId,
        generation: Generation,
        query: Sequence[float],
        k: int,
    ) -> list[Row]:
        """KNN within ONE owner's paper generation. Returns ``block_id`` and ``distance``.

        ``block_vectors`` is a vec0 virtual table: it takes no foreign keys and has no
        ``owner_id`` column, so ownership is carried by the partition key
        ``owner/paper@generation``. This handle can only build a partition name from the user
        it was bound to, so a search cannot visit another owner's partition — the same
        mechanism ``PaperTreeDb.search_block_vectors`` uses, for the same reason.

        Measured: this query runs unchanged with the full authorizer deny set installed. The
        guard costs no retrieval functionality.
        """
        return self._all(
            "SELECT block_id, distance FROM block_vectors "
            "WHERE embedding MATCH ? AND k = ? AND paper_key = ?",
            (to_vector_blob(query), k, self._paper_key(paper_id, generation)),
        )

    def count_block_vectors(self, paper_id: PaperId, generation: Generation) -> int:
        row = self._one(
            "SELECT count(*) AS n FROM block_vectors WHERE paper_key = ?",
            (self._paper_key(paper_id, generation),),
        )
        return 0 if row is None else int(row["n"])

    # ── memory reads ─────────────────────────────────────────────────────────────────

    def list_paper_memory(
        self, paper_id: PaperId, generation: Generation, kind: str | None = None
    ) -> list[Row]:
        """PAPER memory for one generation. Trust label ``untrusted``, always.

        Scoped to ``(owner, paper, generation)`` and not to ``paper_id``, because a re-parse
        produces generation N+1 whose block ids may differ and a summary citing generation 1's
        blocks is not valid for generation 2.
        """
        if kind is None:
            return self._all(
                "SELECT * FROM paper_memory WHERE owner_id = ? AND paper_id = ? "
                "AND generation = ? ORDER BY created_at",
                (self._owner_user_id, paper_id, generation),
            )
        return self._all(
            "SELECT * FROM paper_memory WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "AND kind = ? ORDER BY created_at",
            (self._owner_user_id, paper_id, generation, kind),
        )

    def list_session_memory(self, session_id: str) -> list[Row]:
        """SESSION memory for one conversation. Trust label ``tainted``, and sticky.

        Expired rows are NOT filtered here. `expires_at` is enforced by
        :meth:`~papertree_memory.store.MemoryStore.purge_expired_session_memory`, which is a
        write and therefore not something this handle can do; filtering here as well would
        make an unpurged database look purged and hide the fact that the purge never ran.
        """
        return self._all(
            "SELECT * FROM session_memory WHERE owner_id = ? AND session_id = ? "
            "ORDER BY created_at",
            (self._owner_user_id, session_id),
        )

    def list_artefact_memory(
        self, paper_id: PaperId, generation: Generation, kind: str | None = None
    ) -> list[Row]:
        """ARTEFACT memory. Trust label ``derived_untrusted``: model output about a PDF.

        §13.5 rule 1: ``status`` is a column and never a body string. This method does not
        filter on it — a failed artefact must stay visible so the caller can retry it, which
        is findings.md C7's defect (a failure persisted as content, blocking retry forever).
        """
        if kind is None:
            return self._all(
                "SELECT * FROM artefact_memory WHERE owner_id = ? AND paper_id = ? "
                "AND generation = ? ORDER BY created_at",
                (self._owner_user_id, paper_id, generation),
            )
        return self._all(
            "SELECT * FROM artefact_memory WHERE owner_id = ? AND paper_id = ? "
            "AND generation = ? AND kind = ? ORDER BY created_at",
            (self._owner_user_id, paper_id, generation, kind),
        )

    def list_user_learning_memory(self) -> list[Row]:
        """USER LEARNING memory, READ ONLY — and read access is deliberate, not an oversight.

        §13.4's grants are ``GRANT SELECT ON trusted.user_memory TO papertree_agent`` with the
        comment "read only, forever", and §13.1's diagram has the arrow ``UL -->|read-only| P``.
        The agent is supposed to know the user prefers graduate-level explanations; what it
        must never do is decide that for them. There is no write counterpart to this method
        anywhere on this class, and the connection underneath would refuse one.
        """
        return self._all(
            "SELECT * FROM user_learning_memory WHERE owner_id = ? ORDER BY kind, created_at",
            (self._owner_user_id,),
        )

    # ── self-verification ────────────────────────────────────────────────────────────

    def probe_escape_routes(self, scratch_dir: Path) -> tuple[RouteProbe, ...]:
        """Runs every known escape route against this handle's connection.

        Exposed on the handle because the object that has to prove it is harmless is the
        object that was handed out. The report is data — the caller decides whether to log it,
        assert on it or feed it to
        :meth:`~papertree_memory.store.MemoryStore.record_denied_routes`.
        """
        return probe_escape_routes(self._reader, scratch_dir=scratch_dir)

    # ── internals ────────────────────────────────────────────────────────────────────

    def _paper_key(self, paper_id: PaperId, generation: Generation) -> str:
        """The ``block_vectors`` partition name. Owner-first, and built only from the bound user.

        Must stay byte-identical to ``papertree_db.database._paper_key``; the vectors are
        written by that module and read here, and a partition name that disagrees returns zero
        hits rather than an error. ``test_agent_handle_reads.py`` asserts a vector written
        through ``PaperTreeDb`` is found through this handle, which is what makes the two
        spellings checkable rather than merely adjacent.
        """
        return f"{self._owner_user_id}/{paper_id}@{generation}"

    def _one(self, sql: str, params: tuple[Any, ...]) -> Row | None:
        row: Row | None = self._reader.execute(sql, params).fetchone()
        return row

    def _all(self, sql: str, params: tuple[Any, ...]) -> list[Row]:
        rows: list[Row] = self._reader.execute(sql, params).fetchall()
        return rows
