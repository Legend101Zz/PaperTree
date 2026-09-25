"""papertree_db — the SQLite data layer for PaperTree v2 (EPIC-00 F0.5; split by ADR-002 S0).

Two guarantees, and nothing else:

  1. The schema lives in ``infrastructure/migrations/*.sql`` and is applied forward-only by
     ``migrate.py``, the ONE runner (the TypeScript twin was deleted in the reader release's S0,
     before ``0005_reader_release.sql`` landed; ADR-002 §5, R5).
  2. Every query helper structurally requires an owner. Omitting it raises (and mypy
     rejects it); forging one raises. See ``database.py``'s module docstring.

``PaperTreeDb`` is ``database.DatabaseCore`` plus four mixins — ``library``, ``highlights``,
``ai``, ``canvas`` — each owned by one slice (contracts.md §1.1). Methods a slice has not built yet
raise ``NotImplementedError``; ``tests/test_contract_signatures.py`` pins every signature.

NOTE WHAT IS NOT EXPORTED: no ``sqlite3.Connection``, no ``execute``, no cursor and no
connection accessor. That is deliberate and it is gate 1 — but read gate 1 in
``database.py``'s docstring before relying on it: in Python the connection is merely
UNEXPORTED, and ``db._conn`` is one attribute lookup away. ``._conn`` outside ``papertree_db``
is a forbidden token and ``test_ownership.py`` greps for it.
"""

from .ai import RunGrant, UsageTotals
from .canvas import BoardRow, BoardSnapshot, EdgeRow, NodeRow, StaleVersion
from .database import (
    MAX_DERIVATION_DEPTH,
    VECTOR_DIMENSIONS,
    CreatedUser,
    DatabaseCore,
    PaperTreeDb,
    Row,
    open_database,
    to_vector_blob,
)
from .errors import (
    GenerationNotFound,
    HighlightConflict,
    HighlightRejectCode,
    HighlightRejected,
    MigrationError,
    OwnershipError,
    PaperNotFound,
)
from .highlights import (
    AnchorIn,
    AnchorRow,
    HighlightRow,
    HighlightWithAnchors,
    ResolutionIn,
    ResolutionRow,
)
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
    mint_owner,
    new_id,
)
from .library import LibraryRow
from .migrate import (
    AppliedMigration,
    Migration,
    MigrationResult,
    applied_migrations,
    backup_path_for,
    find_migrations_dir,
    load_migrations,
    migrate,
    split_statements,
)

__all__ = [
    "MAX_DERIVATION_DEPTH",
    "VECTOR_DIMENSIONS",
    "AnchorId",
    "AnchorIn",
    "AnchorRow",
    "AppliedMigration",
    "BlockId",
    "BoardRow",
    "BoardSnapshot",
    "CreatedUser",
    "DatabaseCore",
    "DerivationId",
    "EdgeRow",
    "Generation",
    "GenerationNotFound",
    "HighlightConflict",
    "HighlightId",
    "HighlightRejectCode",
    "HighlightRejected",
    "HighlightRow",
    "HighlightWithAnchors",
    "LibraryRow",
    "Migration",
    "MigrationError",
    "MigrationResult",
    "NodeRow",
    "OwnerId",
    "OwnershipError",
    "PageId",
    "PaperId",
    "PaperNotFound",
    "PaperTreeDb",
    "ResolutionIn",
    "ResolutionRow",
    "Row",
    "RunGrant",
    "StaleVersion",
    "UsageTotals",
    "applied_migrations",
    "backup_path_for",
    "find_migrations_dir",
    "generation",
    "load_migrations",
    "migrate",
    "mint_owner",
    "new_id",
    "open_database",
    "split_statements",
    "to_vector_blob",
]
