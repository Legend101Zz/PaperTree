"""Helpers shared by ``database.py`` and the four feature mixins. Module-private.

They live here rather than in ``database.py`` because ``database.py`` imports the mixins to build
``PaperTreeDb``, so a mixin importing a helper back out of ``database.py`` would be an import
cycle that only works while nobody reorders the imports.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

#: A result row. Keys mirror the columns exactly; there is deliberately no rename layer.
Row = dict[str, Any]


def row_to_dict(cursor: sqlite3.Cursor, row: tuple[Any, ...]) -> Row:
    return {column[0]: value for column, value in zip(cursor.description, row, strict=True)}


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


#: Compact, separator-pinned JSON. Smaller rows, and — because the separators are fixed rather
#: than defaulted — the same bytes on every write, which matters for a store whose definition of
#: done includes "re-parsing produces byte-identical PaperIR".
def to_json(value: object) -> str:
    return json.dumps(value, separators=(",", ":"))


def opt_json(value: object) -> str | None:
    return None if value is None else to_json(value)


def client_json(value: object) -> str:
    """``to_json`` for CLIENT-SUPPLIED values (an Anchor record from a request body).

    ``allow_nan=False`` because Python would otherwise write a bare ``NaN``, which SQLite's
    ``json_valid`` CHECK rejects — a request body must be refused as a bad body before it gets
    that far, not surface as a constraint failure. Raises ``ValueError``/``TypeError``.
    """
    return json.dumps(value, separators=(",", ":"), allow_nan=False)


def canonical_json(value: object) -> str:
    """Key-sorted compact JSON, for comparing two JSON values for equality (idempotent creates)."""
    return json.dumps(value, separators=(",", ":"), sort_keys=True, allow_nan=False)
