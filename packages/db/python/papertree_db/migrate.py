"""Forward-only migration runner — the Python twin of ``packages/db/src/migrate.ts``.

Both runners read the SAME directory of plain ``.sql`` files, so the two languages cannot
end up on different schemas. The only duplicated thing is this bookkeeping; the checksums
recorded by either runner are byte-identical, which ``test_migrations.py`` asserts.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from .errors import MigrationError

MIGRATION_FILENAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")

# A bare ';' split cuts `CREATE TRIGGER ... BEGIN ... END;` in half, so statements are
# separated by an explicit delimiter line. Must match STATEMENT_SEPARATOR in migrate.ts.
STATEMENT_SEPARATOR = re.compile(r"^\s*--;;\s*$", re.MULTILINE)

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


def migrate(conn: sqlite3.Connection, directory: Path | None = None) -> MigrationResult:
    """Applies every unapplied migration in order, each in its own transaction.

    Re-running is a no-op. An already-applied migration whose file has since changed is an
    ERROR, not a silent skip: forward-only means the file is immutable once shipped.
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

    applied: list[int] = []
    for migration in migrations:
        if migration.version in already:
            continue
        conn.execute("BEGIN")
        try:
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

    return MigrationResult(applied=tuple(applied), head=tuple(m.version for m in migrations))
