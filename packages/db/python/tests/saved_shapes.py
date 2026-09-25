"""Databases built from fixtures in the two shapes 0005 must migrate (ADR-002 §6, contracts.md §1).

The judge measured 0005 on backup copies of two real data roots (the architecture evidence's
``judge-evidence/migrate_probe.py``). Neither root can be committed — they hold other people's
uploads — so these builders reproduce the SHAPE of each, re-derived from the copies rather than
quoted (see the S0 db report):

  demo      schema 0001-0004; 3 users, 2 promoted papers (two users uploaded the same PDF), 2
            succeeded parse jobs with 4 steps, 7 sessions, and ONE legacy highlight whose one
            anchor is tier 1 on a block, with no offsets, no quote, no hash and the PLACEHOLDER
            polygon ``[[0,0],[1,0],[1,1],[0,1]]`` bbox ``0,0,1,1`` the 0001 route wrote.
  baseline  schema 0001-0004; 1 user, 1 promoted paper, 6 sessions, and 2 parse jobs: one
            succeeded, one DEAD-LETTERED on G7 after 3 attempts for a paper that has NO
            ``paper_owners`` row (the DDPM upload), payload ``source_hash`` without its prefix.

The papers are the committed ``resnet-cvpr-2col`` fixture written through ``put_paper`` — the same
call the parse job's persist step makes — so the blocks, pages and geometry 0005 reads while
converting the legacy anchor are a real producer's, not ones this file invented. (The demo root's
own papers are the same PDF: its ``source_hash`` is the fixture's, ``sha256:1e0651b6…``.)

Everything the 0001 shape needs and ``PaperTreeDb`` no longer writes (legacy highlights and
anchors, jobs, steps, sessions) is inserted with raw SQL on a connection this module opens itself.
It never touches ``PaperTreeDb``'s connection (``._conn`` is a forbidden token outside the package).
"""

from __future__ import annotations

import copy
import json
import secrets
import shutil
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

import sqlite_vec  # type: ignore[import-untyped]
from papertree_db import PaperId, find_migrations_dir, generation, open_database

MIGRATIONS_DIR: Final = find_migrations_dir()
FIXTURE_FILE: Final = (
    Path(__file__).resolve().parents[3]
    / "document-ir"
    / "fixtures"
    / "resnet-cvpr-2col.paperir.json"
)
#: A REAL ``captureAnchor()`` record over the same fixture (see its ``_provenance`` block).
CAPTURE_ANCHOR_FILE: Final = Path(__file__).resolve().parent / "data" / "capture_anchor_resnet.json"

#: The fixture's "Microsoft Research" affiliation block on page 0 — the demo root's one legacy
#: highlight is on the same line of the same PDF (ADR-002 §S9's walk opens it painted there).
LEGACY_BLOCK: Final = "blk_5zsa4uze7d6kq6zl"
LEGACY_HIGHLIGHT: Final = "hl_01KZB6YSJFXME0QN4XF4JAW9E9"
LEGACY_ANCHOR: Final = "anc_01KZB6YSJGNJ007KERYG4EEXS0"
LEGACY_RESOLVED_AT: Final = "2026-08-06T09:37:32.752375+00:00"
PLACEHOLDER_POLYGON: Final = "[[0,0],[1,0],[1,1],[0,1]]"

#: The tables the judge's probe counted, plus the two identity tables 0004 added.
COUNTED: Final = (
    "users",
    "paper_owners",
    "papers",
    "paper_promotions",
    "pages",
    "blocks",
    "relations",
    "highlights",
    "anchors",
    "jobs",
    "job_steps",
    "sessions",
    "user_credentials",
    "derivations",
)


def load_fixture_paper() -> dict[str, Any]:
    document: dict[str, Any] = json.loads(FIXTURE_FILE.read_text(encoding="utf-8"))
    return document


def load_capture_anchor() -> dict[str, Any]:
    anchor: dict[str, Any] = json.loads(CAPTURE_ANCHOR_FILE.read_text(encoding="utf-8"))["anchor"]
    return anchor


def migrations_through(version: int, into: Path) -> Path:
    """A migrations directory holding only ``0001``..``version`` — the schema of an older release.

    The files are byte copies, so their checksums equal the real ones and a later ``migrate`` with
    the full directory applies only what is missing.
    """
    into.mkdir(parents=True, exist_ok=True)
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if int(path.name[:4]) <= version:
            shutil.copyfile(path, into / path.name)
    return into


def raw_connect(file: Path) -> sqlite3.Connection:
    """What the judge's probe opened: autocommit, foreign keys ON, sqlite-vec loaded (the papers
    AFTER DELETE trigger touches the vec0 table)."""
    conn = sqlite3.connect(file, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {t: int(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]) for t in COUNTED}


@dataclass(slots=True)
class Shape:
    name: str
    file: Path
    #: label -> user_id
    users: dict[str, str]
    #: (user_id, paper_id) of every promoted paper
    promoted: list[tuple[str, str]]
    #: (user_id, paper_id) -> the parse job that produced it (latest_job_id after 0005)
    jobs: dict[tuple[str, str], str]
    #: The fixture paper's own id. Its papers row can take the committed capture anchor verbatim.
    capture_paper: tuple[str, str]
    source_hash: str
    #: demo only: (user_id, paper_id) of the one legacy highlight.
    legacy: tuple[str, str] | None = None
    #: baseline only: (user_id, paper_id, job_id, bare_hex_hash, job_created_at) of the dead letter.
    ghost: tuple[str, str, str, str, str] | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def _paper_as(document: dict[str, Any], paper_id: str, gen: int = 1) -> dict[str, Any]:
    clone = copy.deepcopy(document)
    clone["paper_id"] = paper_id
    clone["generation"] = gen
    return clone


def _put_promoted(file: Path, migrations: Path, user_id: str, document: dict[str, Any]) -> None:
    with open_database(file, migrations) as db:
        owner = db.owner_for(user_id)
        db.put_paper(owner, document)
        db.promote_generation(owner, PaperId(document["paper_id"]), generation(1))


def _insert_job(
    conn: sqlite3.Connection,
    *,
    job_id: str,
    user_id: str,
    paper_id: str,
    source_hash_hex: str,
    state: str,
    attempt: int,
    created_at: str,
    steps: list[tuple[str, str]],
    error: str | None = None,
) -> None:
    payload = json.dumps(
        {
            "paper_id": paper_id,
            "source_path": f"uploads/{paper_id}.pdf",
            "source_hash": source_hash_hex,
        },
        separators=(",", ":"),
    )
    conn.execute(
        "INSERT INTO jobs (job_id, owner_id, kind, idempotency_key, payload, state, attempt, "
        "max_attempts, run_after, error, created_at, updated_at) "
        "VALUES (?, ?, 'parse', ?, ?, ?, ?, 3, 0, ?, ?, ?)",
        (
            job_id,
            user_id,
            f"parse:{source_hash_hex}:{paper_id}",
            payload,
            state,
            attempt,
            error,
            created_at,
            created_at,
        ),
    )
    for index, (name, step_state) in enumerate(steps):
        conn.execute(
            "INSERT INTO job_steps (job_id, owner_id, step_name, step_index, state, attempt, "
            "started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (job_id, user_id, name, index, step_state, attempt, created_at, created_at),
        )


def _insert_sessions(conn: sqlite3.Connection, user_id: str, n: int) -> None:
    for _ in range(n):
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)",
            (
                secrets.token_hex(32),
                user_id,
                "2026-08-06T09:00:00+00:00",
                "2026-08-07T09:00:00+00:00",
            ),
        )


def _new_file(tmp_path: Path, name: str) -> tuple[Path, Path]:
    migrations = migrations_through(4, tmp_path / f"{name}-migrations-0001-0004")
    file = tmp_path / f"{name}.sqlite"
    with open_database(file, migrations) as db:
        assert db.migrate().head == (1, 2, 3, 4)
    return file, migrations


def build_demo_shape(tmp_path: Path) -> Shape:
    file, migrations = _new_file(tmp_path, "demo")
    document = load_fixture_paper()
    source_hash = str(document["source_hash"])
    hex_hash = source_hash.removeprefix("sha256:")
    with open_database(file, migrations) as db:
        users = {label: db.create_user(f"{label}@papertree.test").user_id for label in "abc"}
    paper_a = "ppr_" + "0" * 22 + "DEMA"
    paper_b = str(document["paper_id"])  # the fixture's own id
    _put_promoted(file, migrations, users["a"], _paper_as(document, paper_a))
    _put_promoted(file, migrations, users["b"], _paper_as(document, paper_b))

    conn = raw_connect(file)
    try:
        jobs = {
            (users["a"], paper_a): "job_01KZ6J5XXP2ZR02YXRFA35QV3Z",
            (users["b"], paper_b): "job_01KZB64BQD6FGD7K4NVSJD8DP4",
        }
        for (user_id, paper_id), job_id in jobs.items():
            _insert_job(
                conn,
                job_id=job_id,
                user_id=user_id,
                paper_id=paper_id,
                source_hash_hex=hex_hash,
                state="succeeded",
                attempt=1,
                created_at="2026-08-04T14:17:28.758559+00:00",
                steps=[("parse", "succeeded"), ("persist", "succeeded")],
            )
        for label, n in (("a", 3), ("b", 3), ("c", 1)):
            _insert_sessions(conn, users[label], n)
        # THE LEGACY ROW, in exactly the shape the 0001 route wrote it (see the module docstring).
        conn.execute(
            "INSERT INTO highlights (highlight_id, owner_id, paper_id, generation, color, note, "
            "created_at, updated_at) VALUES (?, ?, ?, 1, 'amber', 'walk-proof', ?, ?)",
            (LEGACY_HIGHLIGHT, users["b"], paper_b, LEGACY_RESOLVED_AT, LEGACY_RESOLVED_AT),
        )
        conn.execute(
            "INSERT INTO anchors (anchor_id, owner_id, highlight_id, paper_id, generation, "
            "block_id, tier, polygon, bbox_x0, bbox_y0, bbox_x1, bbox_y1, resolved_at) "
            "VALUES (?, ?, ?, ?, 1, ?, 1, ?, 0, 0, 1, 1, ?)",
            (
                LEGACY_ANCHOR,
                users["b"],
                LEGACY_HIGHLIGHT,
                paper_b,
                LEGACY_BLOCK,
                PLACEHOLDER_POLYGON,
                LEGACY_RESOLVED_AT,
            ),
        )
    finally:
        conn.close()
    return Shape(
        name="demo",
        file=file,
        users=users,
        promoted=[(users["a"], paper_a), (users["b"], paper_b)],
        jobs=jobs,
        capture_paper=(users["b"], paper_b),
        source_hash=source_hash,
        legacy=(users["b"], paper_b),
    )


def build_baseline_shape(tmp_path: Path) -> Shape:
    file, migrations = _new_file(tmp_path, "baseline")
    document = load_fixture_paper()
    source_hash = str(document["source_hash"])
    with open_database(file, migrations) as db:
        user_id = db.create_user("walker@papertree.test").user_id
    paper = str(document["paper_id"])
    _put_promoted(file, migrations, user_id, _paper_as(document, paper))

    ghost_paper = "ppr_" + "0" * 22 + "DEAD"
    ghost_hash = "ae" * 32
    ghost_job = "job_01M3CHW40H95VY90AC9130SRQ8"
    ghost_created = "2026-09-25T15:10:21.201076+00:00"
    good_job = "job_01M3CHYVRDV25P0ZWV0M2NNKD7"
    conn = raw_connect(file)
    try:
        _insert_job(
            conn,
            job_id=ghost_job,
            user_id=user_id,
            paper_id=ghost_paper,
            source_hash_hex=ghost_hash,
            state="dead_letter",
            attempt=3,
            created_at=ghost_created,
            steps=[("parse", "failed")],
            error="SemanticValidationError: PaperIR failed semantic validation: 3 error(s), "
            "first is G7 at blocks[15].polygon",
        )
        _insert_job(
            conn,
            job_id=good_job,
            user_id=user_id,
            paper_id=paper,
            source_hash_hex=source_hash.removeprefix("sha256:"),
            state="succeeded",
            attempt=1,
            created_at="2026-09-25T15:11:51.053020+00:00",
            steps=[("parse", "succeeded"), ("persist", "succeeded")],
        )
        _insert_sessions(conn, user_id, 6)
    finally:
        conn.close()
    return Shape(
        name="baseline",
        file=file,
        users={"walker": user_id},
        promoted=[(user_id, paper)],
        jobs={(user_id, paper): good_job, (user_id, ghost_paper): ghost_job},
        capture_paper=(user_id, paper),
        source_hash=source_hash,
        ghost=(user_id, ghost_paper, ghost_job, ghost_hash, ghost_created),
    )


BUILDERS: Final = {"demo": build_demo_shape, "baseline": build_baseline_shape}
