"""papertree_db — the SQLite data layer for PaperTree v2 (EPIC-00 F0.5), Python twin.

Two guarantees, and nothing else:

  1. The schema lives in ``infrastructure/migrations/*.sql`` and is applied forward-only by
     a runner in each language reading that one directory, so Python and TypeScript cannot
     drift onto different schemas.
  2. Every query helper structurally requires an owner. Omitting it raises (and mypy
     rejects it); forging one raises. See ``database.py``'s module docstring.

NOTE WHAT IS NOT EXPORTED: no ``sqlite3.Connection``, no ``execute``, no cursor and no
connection accessor. That is deliberate and it is gate 1.
"""

from .database import (
    MAX_DERIVATION_DEPTH,
    VECTOR_DIMENSIONS,
    PaperTreeDb,
    Row,
    open_database,
    to_vector_blob,
)
from .errors import MigrationError, OwnershipError
from .ids import (
    AnchorId,
    BlockId,
    DerivationId,
    Generation,
    HighlightId,
    OwnerId,
    PageId,
    PaperId,
    generation,
    new_id,
)
from .migrate import (
    AppliedMigration,
    Migration,
    MigrationResult,
    applied_migrations,
    find_migrations_dir,
    load_migrations,
    migrate,
    split_statements,
)

__all__ = [
    "MAX_DERIVATION_DEPTH",
    "VECTOR_DIMENSIONS",
    "AnchorId",
    "AppliedMigration",
    "BlockId",
    "DerivationId",
    "Generation",
    "HighlightId",
    "Migration",
    "MigrationError",
    "MigrationResult",
    "OwnerId",
    "OwnershipError",
    "PageId",
    "PaperId",
    "PaperTreeDb",
    "Row",
    "applied_migrations",
    "find_migrations_dir",
    "generation",
    "load_migrations",
    "migrate",
    "new_id",
    "open_database",
    "split_statements",
    "to_vector_blob",
]
