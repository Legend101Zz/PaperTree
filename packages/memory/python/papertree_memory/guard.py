"""The structural trust boundary (F3.8), and the measurements it is built on.

THE CLAIM THIS MODULE HAS TO MAKE TRUE
    EPIC-03 §3.2: *"The agent's database handle must be physically incapable of writing
    user-learning memory."* §13.4 gets that from Postgres for free —
    ``REVOKE ALL ON ALL TABLES IN SCHEMA trusted FROM papertree_agent``. SQLite has no roles,
    no ``GRANT`` and no ``REVOKE``, so the equivalent has to be assembled from what SQLite
    does have. It is two layers, and the second one is not optional.

LAYER 1 — ``file:<path>?mode=ro``
    Every INSERT / UPDATE / DELETE / CREATE / DROP against the MAIN database raises
    ``sqlite3.OperationalError: attempt to write a readonly database``. Measured on this
    workspace (SQLite 3.53.1, CPython 3.12.8) rather than taken from documentation.

LAYER 2 — ``conn.set_authorizer`` denying ``SQLITE_ATTACH``
    **Layer 1 alone has a hole, and it was reproduced here before this module was written.**
    A ``mode=ro`` connection can still run::

        ATTACH DATABASE '/tmp/side.db' AS evil;
        CREATE TABLE evil.x(a);
        INSERT INTO evil.x VALUES (1);

    All three succeed and ``/tmp/side.db`` appears on disk. ``mode=ro`` constrains the main
    database; it does not constrain the connection's ability to acquire a second, writable
    one. An implementation that stops at layer 1 has a hole that **no INSERT-only test can
    see**, which is why `security/injection.spec` asserts the ATTACH route by name and why
    `0003_memory.sql`'s header says so too.

    A SECOND ROUTE, MEASURED HERE AND NOT IN THE BRIEF: ``VACUUM INTO '<path>'`` also
    succeeds on a bare ``mode=ro`` connection and writes a **complete copy of the database**
    to an attacker-chosen path — a whole-library exfiltration primitive, not merely a scratch
    file. It is closed by the SAME ``SQLITE_ATTACH`` denial (``VACUUM INTO`` attaches the
    output file internally), and it is NOT closed by denying ``SQLITE_PRAGMA``: with only
    pragma denied it still ran and still produced the copy. That was measured both ways
    before this sentence was written, and `security/isolation.spec` asserts it by name.

WHAT LAYER 2 COSTS: nothing that matters. Measured on the real schema — a sqlite-vec KNN
    (``embedding MATCH ? AND k = ? AND paper_key = ?``) executes normally with the full deny
    set installed, as do ``GROUP BY``/``ORDER BY`` and the JSON1 functions. The only authorizer
    actions a read path triggers are ``SQLITE_READ`` (20), ``SQLITE_SELECT`` (21) and
    ``SQLITE_FUNCTION`` (31); none of the denied actions fires on a legitimate read.

WHAT THIS MODULE DOES **NOT** CLAIM, STATED BEFORE ANYONE HAS TO DISCOVER IT
    ``connection.set_authorizer(None)`` removes layer 2. So does opening a fresh
    ``sqlite3.connect(path)``. Both require executing arbitrary Python in this process, and
    **an adversary who can do that has already won by a route this package could never
    close** — they can import ``sqlite3`` themselves. The threat model F3.8 is written
    against is a *compromised model output driving a tool registry*: the model chooses which
    listed tool to call and with what arguments, and it cannot call anything that is not in
    the registry. This module's job is that **every route the registry can expose is
    read-only**, and that is what the tests assert.

    This is the same honest position ``papertree_db.database``'s gate 1 takes about ``_conn``:
    in TypeScript the connection is unreachable (``#db`` is an ES private field); in Python it
    is merely unexported. Pretending otherwise is how a reviewer stops looking.

WHY THE AGENT HANDLE NEEDS A FILE-BACKED DATABASE
    ``:memory:`` names a *fresh, private* database per connection — two connections to
    ``:memory:`` are two unrelated empty databases, and there is no read-only mode for one.
    The agent handle therefore cannot be pointed at an in-memory database, and
    :func:`open_guarded_read_only` refuses one loudly instead of silently handing back an
    empty world in which every "no rows" answer looks like a successful, correct read. Tests
    use ``tmp_path``.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import sqlite_vec  # type: ignore[import-untyped]

#: A result row. Same convention as ``papertree_db.Row``: keys mirror the columns exactly and
#: there is deliberately no rename layer. JSON columns arrive as ``str`` and stay that way.
Row = dict[str, Any]


def row_to_dict(cursor: sqlite3.Cursor, row: tuple[Any, ...]) -> Row:
    return {column[0]: value for column, value in zip(cursor.description, row, strict=True)}


#: Every authorizer action that is not "read something". Enumerated rather than expressed as
#: "not in {SELECT, READ, FUNCTION}" on purpose: an allowlist would silently deny a future
#: SQLite action code that is harmless, and a read path that starts failing after a SQLite
#: upgrade is a worse failure mode than a route that has to be added here deliberately.
#:
#: ``SQLITE_TRANSACTION`` is deliberately ABSENT. ``BEGIN`` confers no write capability on a
#: ``mode=ro`` connection, and denying it would break a legitimate consistent-snapshot read
#: for no security gain. That is a decision, not an omission.
DENIED_ACTIONS: Final[frozenset[int]] = frozenset(
    {
        # Writes to rows.
        sqlite3.SQLITE_INSERT,
        sqlite3.SQLITE_UPDATE,
        sqlite3.SQLITE_DELETE,
        # Schema changes. `DROP TABLE user_learning_memory` is a write to the trusted store by
        # another name, and `ALTER TABLE ... ADD COLUMN` would let a CHECK be side-stepped.
        sqlite3.SQLITE_CREATE_TABLE,
        sqlite3.SQLITE_DROP_TABLE,
        sqlite3.SQLITE_CREATE_INDEX,
        sqlite3.SQLITE_DROP_INDEX,
        sqlite3.SQLITE_CREATE_TRIGGER,
        sqlite3.SQLITE_DROP_TRIGGER,
        sqlite3.SQLITE_CREATE_VIEW,
        sqlite3.SQLITE_DROP_VIEW,
        sqlite3.SQLITE_CREATE_VTABLE,
        sqlite3.SQLITE_DROP_VTABLE,
        sqlite3.SQLITE_ALTER_TABLE,
        sqlite3.SQLITE_REINDEX,
        sqlite3.SQLITE_ANALYZE,
        # TEMP objects live in a SEPARATE database that mode=ro does NOT cover. Measured: a
        # bare mode=ro connection creates temp tables happily. They reach no user data, but
        # "the agent's handle cannot write" should not have an asterisk on it.
        sqlite3.SQLITE_CREATE_TEMP_TABLE,
        sqlite3.SQLITE_DROP_TEMP_TABLE,
        sqlite3.SQLITE_CREATE_TEMP_INDEX,
        sqlite3.SQLITE_DROP_TEMP_INDEX,
        sqlite3.SQLITE_CREATE_TEMP_TRIGGER,
        sqlite3.SQLITE_DROP_TEMP_TRIGGER,
        sqlite3.SQLITE_CREATE_TEMP_VIEW,
        sqlite3.SQLITE_DROP_TEMP_VIEW,
        # THE LOAD-BEARING TWO. See the module docstring: without these, mode=ro still gets
        # you a writable second database and a full-database copy at a path you choose.
        sqlite3.SQLITE_ATTACH,
        sqlite3.SQLITE_DETACH,
        # No pragma is needed after the handle is open — every one this package wants is set
        # before the authorizer is installed. Denying the whole class costs nothing (measured:
        # a read path never triggers action 19) and removes `PRAGMA writable_schema = ON`.
        sqlite3.SQLITE_PRAGMA,
    }
)

#: SQL functions denied by name. ``load_extension`` is the one that turns a read-only
#: connection into arbitrary native code; ``enable_load_extension(False)`` closes the C API
#: but not the SQL function, and the two are separate switches.
DENIED_FUNCTIONS: Final[frozenset[str]] = frozenset({"load_extension"})

#: The substrings SQLite puts in the message when a statement was refused BY A GUARD, as
#: opposed to failing for an ordinary reason. Used to classify probe results, so that a route
#: which merely errored ("no such table") is never counted as a route which was blocked.
#: Taken from observed messages: "not authorized", "not authorized to use function: X",
#: "authorization denied" (VACUUM INTO), "attempt to write a readonly database".
DENIAL_MARKERS: Final[tuple[str, ...]] = (
    "not authorized",
    "authorization denied",
    "readonly database",
)


def _authorizer(
    action: int,
    arg1: str | None,
    arg2: str | None,
    db_name: str | None,
    trigger_name: str | None,
) -> int:
    """Layer 2. Returns ``SQLITE_DENY`` for anything that is not a read.

    Signature is SQLite's, not ours: for ``SQLITE_FUNCTION`` the function name arrives in
    ``arg2`` and ``arg1`` is ``None`` — verified against this SQLite, because getting it the
    wrong way round produces a guard that silently never matches.
    """
    if action in DENIED_ACTIONS:
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_FUNCTION and arg2 in DENIED_FUNCTIONS:
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def open_guarded_read_only(database_path: str | Path) -> sqlite3.Connection:
    """Opens the ONLY kind of connection an agent tool is ever handed.

    ORDER MATTERS AND IS NOT INCIDENTAL:

      1. ``mode=ro`` in the URI — layer 1, and it must be the URI form; ``sqlite3.connect``
         on a plain path is read-write even if the file is read-only on disk.
      2. ``PRAGMA busy_timeout`` — set BEFORE the authorizer, because the authorizer denies
         ``SQLITE_PRAGMA``. A reader that does not wait raises "database is locked" the first
         time the privileged writer holds the write lock, which in this deployment is often.
      3. sqlite-vec loaded the same way ``papertree_db`` loads it, and
         ``enable_load_extension(False)`` immediately after — the extension is needed because
         ``block_vectors`` is a vec0 virtual table and a KNN query is a read the agent is
         supposed to be able to do.
      4. The authorizer installed LAST, so steps 2 and 3 are not fighting it.

    WAL: the writer sets ``journal_mode = WAL`` (``PaperTreeDb.__init__``), which is what makes
    a concurrent reader possible at all. Verified: a guarded reader opened while the writer is
    live reads normally AND sees commits made after it opened.
    """
    path = Path(database_path)
    if str(database_path) == ":memory:":
        raise ValueError(
            "the agent handle requires a FILE-backed database. ':memory:' names a fresh "
            "private database per connection, so a read-only handle onto one would see an "
            "empty schema and answer every read with 'no rows' — a wrong answer that looks "
            "exactly like a correct one. See guard.py's module docstring."
        )
    if not path.exists():
        raise FileNotFoundError(
            f"no database at {path}. A mode=ro connection cannot create one, and SQLite's own "
            "error for this ('unable to open database file') does not say which path it tried."
        )
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True, isolation_level=None)
    connection.row_factory = row_to_dict
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.enable_load_extension(True)
    sqlite_vec.load(connection)
    connection.enable_load_extension(False)
    connection.set_authorizer(_authorizer)
    return connection


# ── self-verification: the guard proves itself, in production and in tests ───────────────


@dataclass(frozen=True, slots=True)
class EscapeRoute:
    """One way out of a read-only connection, with the artefact it would leave behind."""

    #: Stable identifier. It is what the `memory_audit.detail` row records, so it is a name
    #: an alert can be written against rather than a message that may be reworded.
    name: str
    statement: str
    #: The file this statement would create if it succeeded. Checked after every probe:
    #: "the statement raised" and "the statement did nothing" are different claims, and only
    #: the second one is the property we want.
    artefact: Path | None


def escape_routes(scratch_dir: Path) -> tuple[EscapeRoute, ...]:
    """Every escape route this package knows about, as executable statements.

    PUBLIC ON PURPOSE. `security/isolation.spec` runs these exact statements against an
    ORDINARY read-write connection and asserts that none of them is refused there. Without
    that half, a probe suite proves only that a list of statements failed — and a list of
    statements with a typo in every one of them also fails. The non-vacuity of the whole
    security story rests on the same strings being run both sides of the boundary.
    """
    return (
        EscapeRoute(
            name="insert_user_learning",
            statement=(
                "INSERT INTO user_learning_memory (memory_id, owner_id, kind, content, "
                "trust_label, provenance, confidence, version, source_proposal_id, "
                "confirmed_at, confirmed_by, created_at, updated_at, reconfirm_due) "
                "VALUES ('mem_injected', 'x', 'preferred_depth', '{\"level\":\"expert\"}', "
                "'trusted', '{}', 1.0, 1, 'prp_x', 'now', 'user', 'now', 'now', 'later')"
            ),
            artefact=None,
        ),
        EscapeRoute(
            name="update_user_learning",
            statement='UPDATE user_learning_memory SET content = \'{"level":"expert"}\'',
            artefact=None,
        ),
        EscapeRoute(
            name="delete_user_learning",
            statement="DELETE FROM user_learning_memory",
            artefact=None,
        ),
        # The audit log is the control that would REVEAL a successful attack, so it is the
        # second thing an attacker goes for. Its append-only triggers are a third layer, but
        # they only fire on a connection that got as far as issuing the statement.
        EscapeRoute(
            name="delete_memory_audit",
            statement="DELETE FROM memory_audit",
            artefact=None,
        ),
        EscapeRoute(
            name="drop_user_learning",
            statement="DROP TABLE user_learning_memory",
            artefact=None,
        ),
        EscapeRoute(
            name="alter_user_learning",
            statement="ALTER TABLE user_learning_memory ADD COLUMN backdoor TEXT",
            artefact=None,
        ),
        EscapeRoute(
            name="create_temp_table",
            statement="CREATE TEMP TABLE escape_hatch (a TEXT)",
            artefact=None,
        ),
        EscapeRoute(
            name="pragma_writable_schema",
            statement="PRAGMA writable_schema = ON",
            artefact=None,
        ),
        EscapeRoute(
            name="load_extension_function",
            statement=f"SELECT load_extension('{scratch_dir / 'payload.so'}')",
            artefact=None,
        ),
        # THE TWO THAT LAYER 1 DOES NOT CLOSE. Both were reproduced on a bare mode=ro
        # connection on this workspace; see the module docstring.
        EscapeRoute(
            name="attach_writable_side_database",
            statement=f"ATTACH DATABASE '{scratch_dir / 'side.sqlite'}' AS evil",
            artefact=scratch_dir / "side.sqlite",
        ),
        EscapeRoute(
            name="vacuum_into",
            statement=f"VACUUM INTO '{scratch_dir / 'exfiltrated.sqlite'}'",
            artefact=scratch_dir / "exfiltrated.sqlite",
        ),
    )


@dataclass(frozen=True, slots=True)
class RouteProbe:
    """What happened when one escape route was executed against a guarded connection."""

    route: str
    statement: str
    #: True only if the statement raised AND the message names a guard (see
    #: :data:`DENIAL_MARKERS`). A statement that failed for an unrelated reason — a typo, a
    #: missing table — is NOT a denial, and recording it as one is precisely the vacuous
    #: green AGENTS.md §2 is about.
    denied: bool
    error: str | None
    #: True if the route left a file behind. A denial that still writes the file is not one.
    artefact_created: bool

    @property
    def escaped(self) -> bool:
        return not self.denied or self.artefact_created


def probe_escape_routes(
    connection: sqlite3.Connection, *, scratch_dir: Path
) -> tuple[RouteProbe, ...]:
    """Runs every known escape route against ``connection`` and reports what each one did.

    This is not only test scaffolding. It is callable in production — the intended use is a
    start-up assertion in the process that hands out agent handles, so that a SQLite upgrade,
    a dependency change or a refactor that drops the authorizer is caught by the service that
    depends on the guard rather than by an incident. §13.6(d): *"That condition should be
    structurally impossible; if it fires, a control has failed."* You cannot alert on a
    control you never evaluate.

    ``scratch_dir`` is REQUIRED and must be a real writable directory, because two of the
    routes are only meaningful if the target path is one the process could genuinely write.
    Pointing them at an unwritable path would produce a denial-looking failure that says
    nothing about the guard.
    """
    if not scratch_dir.is_dir():
        raise ValueError(f"scratch_dir must be an existing writable directory, got {scratch_dir}")
    probes: list[RouteProbe] = []
    for route in escape_routes(scratch_dir):
        error: str | None = None
        try:
            connection.execute(route.statement)
        except sqlite3.Error as exc:
            error = f"{type(exc).__name__}: {exc}"
        denied = error is not None and any(marker in error.lower() for marker in DENIAL_MARKERS)
        probes.append(
            RouteProbe(
                route=route.name,
                statement=route.statement,
                denied=denied,
                error=error,
                artefact_created=route.artefact is not None and route.artefact.exists(),
            )
        )
    return tuple(probes)


def assert_no_escape(probes: Sequence[RouteProbe]) -> None:
    """Raises :class:`~papertree_memory.errors.TrustBoundaryViolation` if any route got out.

    Separated from :func:`probe_escape_routes` so that a caller can record the full report
    before failing. A control failure that raises without leaving a report behind is a control
    failure nobody can diagnose.
    """
    from .errors import TrustBoundaryViolation

    escaped = [probe for probe in probes if probe.escaped]
    if escaped:
        names = ", ".join(probe.route for probe in escaped)
        raise TrustBoundaryViolation(
            names,
            "a read-only agent connection reached a write route. This is a control failure, "
            "not a caller error: §13.6(d)'s alert condition is supposed to be structurally "
            "impossible.",
        )
