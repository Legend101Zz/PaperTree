"""S9-1: the API and the worker start at the same instant on a FRESH data root.

Both open the new SQLite file, switch it to WAL and migrate it. Before the fix one of them died
with ``sqlite3.OperationalError: database is locked`` on ``PRAGMA journal_mode = WAL``.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
from pathlib import Path

import pytest
from papertree_db import open_database

_CHILD = textwrap.dedent(
    """
    import sys, time
    from papertree_db import open_database
    path, go_at = sys.argv[1], float(sys.argv[2])
    while time.time() < go_at:
        pass
    db = open_database(path)
    try:
        db.migrate()
    finally:
        db.close()
    """
)


@pytest.mark.parametrize("attempt", range(20))
def test_two_processes_open_and_migrate_a_fresh_file_at_once(tmp_path: Path, attempt: int) -> None:
    import time

    target = tmp_path / f"fresh-{attempt}" / "papertree.sqlite"
    target.parent.mkdir()
    go_at = time.time() + 1.5
    procs = [
        subprocess.Popen(
            [sys.executable, "-c", _CHILD, str(target), str(go_at)],
            stderr=subprocess.PIPE,
            text=True,
        )
        for _ in range(3)
    ]
    outputs = [(p.wait(timeout=60), p.stderr.read() if p.stderr else "") for p in procs]
    assert all(code == 0 for code, _ in outputs), outputs
    db = open_database(target)
    try:
        assert db.migrate().applied == ()  # already fully migrated, exactly once
    finally:
        db.close()
