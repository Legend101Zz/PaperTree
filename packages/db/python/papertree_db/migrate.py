"""Forward-only migration runner — the ONE runner for ``infrastructure/migrations/*.sql``.

There was a TypeScript twin reading the same directory; it was deleted in the reader release's S0
(ADR-002 §5, R5) because it had no importer and doubled every schema change, and it went BEFORE
``0005_reader_release.sql`` landed so that no second runner ever applied 0005.

THE PRE-MIGRATION BACKUP (contracts.md §6.1, ADR-002 §6.1). Some migrations rebuild tables that
hold user data — 0005 rebuilds ``highlights`` and ``anchors``. Migrations are forward-only, so the
only rollback is a copy of the file taken BEFORE they run: when a version in
``BACKUP_BEFORE_VERSIONS`` is pending on a database that already has an earlier schema, the whole
database is copied with the SQLite backup API to ``<db>.pre-NNNN.bak`` first. A brand-new database
(nothing applied yet) and an in-memory one are not backed up — there is nothing to lose, and
nowhere beside ``:memory:`` to put it.

TWO PROCESSES MIGRATE THE SAME FILE. The API and the worker both call ``migrate()`` at start. So the
decision "0005 is pending, back up" and the copy are made while this runner holds the database's
write lock (``BEGIN IMMEDIATE`` on a second connection: SQLite's backup API hangs when run on the
connection that holds the lock itself), and each migration re-reads the record inside its own
``BEGIN IMMEDIATE`` before applying. Without that, a process acting on a stale read copied the
MIGRATED database over the pre-0005 backup — the only rollback, lost silently — and then crashed
applying 0005 twice (S0 review, S1).
"""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from .errors import MigrationError

MIGRATION_FILENAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")

# A bare ';' split cuts `CREATE TRIGGER ... BEGIN ... END;` in half, so statements are
# separated by an explicit delimiter line.
STATEMENT_SEPARATOR = re.compile(r"^\s*--;;\s*$", re.MULTILINE)

#: Versions that rebuild user-owned tables, and so are preceded by a backup of the whole file.
BACKUP_BEFORE_VERSIONS: Final = frozenset({5})

#: How long a starting runner waits for the write lock while ANOTHER runner backs up or migrates
#: the same file. SQLite's default (5 s) is shorter than copying a large database can take, and a
#: runner that gives up there fails its start ("database is locked") instead of waiting its turn.
LOCK_WAIT_SECONDS: Final = 60.0

_RECORD_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT"""


@dataclass(frozen=True, slots=True)
class Migration:
    version: int
    name: str
    checksum: str
    statements: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AppliedMigration:
    version: int
    name: str
    checksum: str
    applied_at: str


@dataclass(frozen=True, slots=True)
class MigrationResult:
    #: Versions applied by THIS call. Empty on a re-run — the no-op assertion.
    applied: tuple[int, ...]
    #: Every version now recorded in the database, ascending.
    head: tuple[int, ...]
    #: Backups THIS call wrote before applying (``<db>.pre-NNNN.bak``). Empty on a re-run.
    backups: tuple[Path, ...] = ()


def find_migrations_dir(start_from: Path | None = None) -> Path:
    """Walks up looking for ``infrastructure/migrations``.

    Resolving by walking rather than by a fixed ``../../..`` keeps this runner and the
    TypeScript one agreeing on one directory even though their sources sit at different
    depths in the tree.
    """
    directory = (start_from or Path(__file__).resolve().parent).resolve()
    while True:
        candidate = directory / "infrastructure" / "migrations"
        if candidate.is_dir():
            return candidate
        if directory.parent == directory:
            raise MigrationError(f"no infrastructure/migrations directory above {start_from}")
        directory = directory.parent


def split_statements(sql: str) -> tuple[str, ...]:
    parts = (part.strip() for part in STATEMENT_SEPARATOR.split(sql))
    return tuple(part for part in parts if part and not _is_comment_only(part))


def _is_comment_only(statement: str) -> bool:
    return all(not line.strip() or line.strip().startswith("--") for line in statement.split("\n"))


def load_migrations(directory: Path | None = None) -> tuple[Migration, ...]:
    directory = directory or find_migrations_dir()
    migrations: list[Migration] = []
    seen: set[int] = set()
    for path in sorted(directory.iterdir()):
        match = MIGRATION_FILENAME.match(path.name)
        if match is None:
            if path.suffix == ".sql":
                raise MigrationError(f"migration filename must be NNNN_name.sql, got {path.name}")
            continue
        version = int(match.group(1))
        if version in seen:
            raise MigrationError(f"duplicate migration version {version}")
        seen.add(version)
        sql = path.read_text(encoding="utf-8")
        migrations.append(
            Migration(
                version=version,
                name=match.group(2),
                checksum="sha256:" + hashlib.sha256(sql.encode("utf-8")).hexdigest(),
                statements=split_statements(sql),
            )
        )
    if not migrations:
        raise MigrationError(f"no migrations found in {directory}")
    return tuple(sorted(migrations, key=lambda m: m.version))


def applied_migrations(conn: sqlite3.Connection) -> tuple[AppliedMigration, ...]:
    """Reads the record table. Works on a bare connection or one with a row_factory set."""
    conn.execute(_RECORD_TABLE)
    previous = conn.row_factory
    conn.row_factory = None
    try:
        rows = conn.execute(
            "SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version"
        ).fetchall()
    finally:
        conn.row_factory = previous
    return tuple(AppliedMigration(int(r[0]), str(r[1]), str(r[2]), str(r[3])) for r in rows)


def backup_path_for(database_file: Path, version: int) -> Path:
    """``papertree.sqlite`` -> ``papertree.sqlite.pre-0005.bak``."""
    return database_file.with_name(f"{database_file.name}.pre-{version:04d}.bak")


def _main_database_file(conn: sqlite3.Connection) -> Path | None:
    """The file behind ``main``, or None for ``:memory:`` / a temporary database."""
    previous = conn.row_factory
    conn.row_factory = None
    try:
        rows = conn.execute("PRAGMA database_list").fetchall()
    finally:
        conn.row_factory = previous
    for _seq, name, file in rows:
        if name == "main":
            return Path(file) if file else None
    return None


def _recorded(conn: sqlite3.Connection) -> dict[int, str]:
    """``{version: checksum}`` of the record table, read on ``conn`` whatever its row factory."""
    previous = conn.row_factory
    conn.row_factory = None
    try:
        rows = conn.execute("SELECT version, checksum FROM schema_migrations").fetchall()
    finally:
        conn.row_factory = previous
    return {int(version): str(checksum) for version, checksum in rows}


def _backup(conn: sqlite3.Connection, target: Path) -> None:
    """A consistent copy of the whole database through the SQLite backup API.

    Written to ``<target>.tmp`` and renamed into place, so a crash mid-copy never leaves a
    truncated file wearing the name of a backup. The caller holds the write lock (see
    :func:`_backups_before`), so no second runner is ever writing the same ``.tmp``.
    """
    partial = target.with_name(target.name + ".tmp")
    partial.unlink(missing_ok=True)
    copy = sqlite3.connect(partial)
    try:
        conn.backup(copy)
    finally:
        copy.close()
    os.replace(partial, target)


def _backups_before(
    conn: sqlite3.Connection, migrations: tuple[Migration, ...]
) -> tuple[Path, ...]:
    """Writes ``<db>.pre-NNNN.bak`` for each due version, deciding UNDER the write lock.

    ``guard`` is a second connection holding ``BEGIN IMMEDIATE``: while it does, no other process
    can commit a migration, so the record it reads is the database the copy is taken of. A version
    another runner applied since this one first looked is no longer pending, and is not copied.
    """
    database_file = _main_database_file(conn)
    if database_file is None:
        return ()
    guard = sqlite3.connect(database_file, isolation_level=None, timeout=LOCK_WAIT_SECONDS)
    try:
        guard.execute("BEGIN IMMEDIATE")
        try:
            recorded = _recorded(guard)
            pending = {m.version for m in migrations} - set(recorded)
            due = sorted(BACKUP_BEFORE_VERSIONS & pending) if recorded else []
            backups: list[Path] = []
            for version in due:
                target = backup_path_for(database_file, version)
                _backup(conn, target)
                backups.append(target)
        finally:
            guard.execute("ROLLBACK")  # it only held the lock; it wrote nothing
    finally:
        guard.close()
    return tuple(backups)


def migrate(conn: sqlite3.Connection, directory: Path | None = None) -> MigrationResult:
    """Applies every unapplied migration in order, each in ONE transaction of its own.

    Re-running is a no-op. An already-applied migration whose file has since changed is an
    ERROR, not a silent skip: forward-only means the file is immutable once shipped. Before a
    pending version in ``BACKUP_BEFORE_VERSIONS`` touches a database that already holds an
    earlier schema, the file is backed up (see the module docstring). Safe against a second
    process migrating the same file at the same time: whatever that process applied first is
    skipped here, not applied twice, and never copied as if it were the pre-migration state.
    """
    migrations = load_migrations(directory)
    already = {m.version: m for m in applied_migrations(conn)}

    for migration in migrations:
        prior = already.get(migration.version)
        if prior is not None and prior.checksum != migration.checksum:
            raise MigrationError(
                f"migration {migration.version} ({migration.name}) has changed since it was "
                f"applied: recorded {prior.checksum}, on disk {migration.checksum}. "
                f"Migrations are forward-only; add a new numbered file instead of editing "
                f"this one."
            )

    pending = [m.version for m in migrations if m.version not in already]
    backups: tuple[Path, ...] = ()
    if already and BACKUP_BEFORE_VERSIONS.intersection(pending):
        backups = _backups_before(conn, migrations)

    applied: list[int] = []
    for migration in migrations:
        if migration.version in already:
            continue
        conn.execute("BEGIN IMMEDIATE")
        try:
            done_elsewhere = _recorded(conn).get(migration.version)
            if done_elsewhere is not None:
                # Another runner (the API or the worker, started together) applied it since this
                # one read the record. Same forward-only rule as above for what it recorded.
                if done_elsewhere != migration.checksum:
                    raise MigrationError(
                        f"migration {migration.version} ({migration.name}) was applied by another "
                        f"runner with checksum {done_elsewhere}, but the file on disk is "
                        f"{migration.checksum}"
                    )
                conn.execute("COMMIT")
                continue
            for statement in migration.statements:
                conn.execute(statement)
            conn.execute(
                "INSERT INTO schema_migrations (version, name, checksum, applied_at) "
                "VALUES (?, ?, ?, ?)",
                (
                    migration.version,
                    migration.name,
                    migration.checksum,
                    datetime.now(UTC).isoformat(),
                ),
            )
        except Exception:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")
        applied.append(migration.version)

    return MigrationResult(
        applied=tuple(applied),
        head=tuple(m.version for m in migrations),
        backups=backups,
    )
