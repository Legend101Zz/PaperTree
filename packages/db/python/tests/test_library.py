"""``papertree_db.library`` — S1 owns this file and the module (slice-plan.md §3).

S0 committed ``test_list_library_one_row_per_paper`` (contracts.md §9) as a STRICT xfail on the
stub; it raised ``NotImplementedError`` until S1, and its marker is deleted with the stub.

Jobs are inserted as RAW rows here (the shape ``packages/jobs`` writes), not through ``JobStore``:
this package sits below ``papertree_jobs`` and its tests do not import it.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from papertree_db import (
    OwnerId,
    OwnershipError,
    PaperId,
    PaperNotFound,
    PaperTreeDb,
    generation,
    open_database,
)

from .fixtures import make_paper
from .saved_shapes import build_baseline_shape, load_fixture_paper

HASH_A = "sha256:" + "a" * 64
HASH_B = "sha256:" + "b" * 64
PAPER_A = PaperId("ppr_AAAAAAAAAAAAAAAAAAAAAAAAAA")
PAPER_B = PaperId("ppr_BBBBBBBBBBBBBBBBBBBBBBBBBB")


def test_list_library_one_row_per_paper(tmp_path: Path) -> None:
    """N4: one row per GENERATION today. After 0005: one row per ``paper_owners`` row — the
    promoted paper once although it has two generations, and the dead-lettered upload once
    although it has no generation at all."""
    shape = build_baseline_shape(tmp_path)
    assert shape.ghost is not None
    user_id, paper_id = shape.promoted[0]
    with open_database(shape.file) as db:
        db.migrate()
        owner = db.owner_for(user_id)
        document = load_fixture_paper()
        document["generation"] = 2
        db.put_paper(owner, document)
        db.promote_generation(owner, PaperId(paper_id), generation(2))

        rows = db.list_library(owner)

    by_paper = {row.paper_id: row for row in rows}
    assert len(rows) == len(by_paper) == 2
    assert by_paper[paper_id].generation == 2
    ghost = by_paper[shape.ghost[1]]
    assert ghost.generation is None and ghost.job_state == "dead_letter"


@dataclass(frozen=True, slots=True)
class Env:
    db: PaperTreeDb
    raw: sqlite3.Connection
    user_id: str
    owner: OwnerId
    other_id: str
    other: OwnerId


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    file = tmp_path / "library.sqlite"
    db = open_database(file)
    db.migrate()
    user = db.create_user("reader@papertree.test")
    other = db.create_user("other@papertree.test")
    raw = sqlite3.connect(str(file), isolation_level=None)
    raw.execute("PRAGMA foreign_keys = ON")
    try:
        yield Env(db, raw, user.user_id, user.owner, other.user_id, other.owner)
    finally:
        raw.close()
        db.close()


def _job(
    env: Env,
    job_id: str,
    paper_id: str,
    *,
    state: str,
    created_at: str,
    generation_: int | None = 1,
    attempt_seq: int | None = 1,
    steps: tuple[tuple[str, str], ...] = (),
    error: str | None = None,
    user_id: str | None = None,
) -> None:
    payload: dict[str, object] = {"paper_id": paper_id, "source_path": "x", "source_hash": "h"}
    if generation_ is not None:
        payload["generation"] = generation_
    if attempt_seq is not None:
        payload["attempt_seq"] = attempt_seq
    owner_id = user_id or env.user_id
    env.raw.execute(
        "INSERT INTO jobs (job_id, owner_id, kind, idempotency_key, payload, state, attempt, "
        "max_attempts, run_after, error, created_at, updated_at) "
        "VALUES (?, ?, 'parse', ?, ?, ?, 1, 3, 0, ?, ?, ?)",
        (job_id, owner_id, job_id, json.dumps(payload), state, error, created_at, created_at),
    )
    for index, (name, step_state) in enumerate(steps):
        env.raw.execute(
            "INSERT INTO job_steps (job_id, owner_id, step_name, step_index, state, attempt, "
            "started_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
            (job_id, owner_id, name, index, step_state, created_at),
        )


# ── register_upload / set_latest_job ──────────────────────────────────────────────────────


def test_register_upload_creates_the_row_and_a_reupload_updates_it(env: Env) -> None:
    env.db.register_upload(env.owner, PAPER_A, HASH_A, "yolo.pdf", 5_300_000, 10)
    row = env.db.owned_paper(env.owner, PAPER_A)
    assert row is not None
    assert (row["original_filename"], row["byte_size"], row["page_count"]) == (
        "yolo.pdf",
        5_300_000,
        10,
    )
    created = row["created_at"]

    # The same bytes under another name: the name follows the latest upload; a count PyMuPDF
    # could not measure this time does not erase the one it measured before.
    env.db.register_upload(env.owner, PAPER_A, HASH_A, "renamed.pdf", 5_300_000, None)
    again = env.db.owned_paper(env.owner, PAPER_A)
    assert again is not None
    assert (again["original_filename"], again["page_count"], again["created_at"]) == (
        "renamed.pdf",
        10,
        created,
    )


def test_register_upload_refuses_another_owners_paper_id_and_a_second_id_for_one_hash(
    env: Env,
) -> None:
    env.db.register_upload(env.owner, PAPER_A, HASH_A, "a.pdf", 10, 1)
    with pytest.raises(OwnershipError):
        env.db.register_upload(env.other, PAPER_A, HASH_A, "a.pdf", 10, 1)
    with pytest.raises(ValueError, match="another paper id"):
        env.db.register_upload(env.owner, PAPER_B, HASH_A, "b.pdf", 10, 1)
    with pytest.raises(ValueError, match="different source_hash"):
        env.db.register_upload(env.owner, PAPER_A, HASH_B, "a.pdf", 10, 1)
    # Nothing of the refused calls was written.
    assert env.db.owned_paper(env.other, PAPER_A) is None
    assert env.db.owned_paper(env.owner, PAPER_B) is None


@pytest.mark.parametrize("bad", [-1, 2**63, True])
def test_register_upload_bounds_its_integers(env: Env, bad: int) -> None:
    with pytest.raises(ValueError, match="byte_size"):
        env.db.register_upload(env.owner, PAPER_A, HASH_A, "a.pdf", bad, 1)
    with pytest.raises(ValueError, match="page_count"):
        env.db.register_upload(env.owner, PAPER_A, HASH_A, "a.pdf", 1, bad)
    assert env.db.owned_paper(env.owner, PAPER_A) is None


def test_set_latest_job_is_owner_scoped(env: Env) -> None:
    env.db.register_upload(env.owner, PAPER_A, HASH_A, "a.pdf", 10, 1)
    env.db.set_latest_job(env.owner, PAPER_A, "job_1")
    row = env.db.owned_paper(env.owner, PAPER_A)
    assert row is not None and row["latest_job_id"] == "job_1"
    with pytest.raises(PaperNotFound):
        env.db.set_latest_job(env.other, PAPER_A, "job_2")
    with pytest.raises(PaperNotFound):
        env.db.set_latest_job(env.owner, PAPER_B, "job_2")
    row = env.db.owned_paper(env.owner, PAPER_A)
    assert row is not None and row["latest_job_id"] == "job_1"


# ── next_generation ─────────────────────────────────────────────────────────────────────────


def test_next_generation_counts_stored_generations_and_parse_jobs(env: Env) -> None:
    assert env.db.next_generation(env.owner, PAPER_A) == 1
    env.db.put_paper(env.owner, make_paper(PAPER_A, HASH_A, 1, 3))
    assert env.db.next_generation(env.owner, PAPER_A) == 2
    # A re-parse of generation 2 that dead-lettered BEFORE it persisted still used the number:
    # handing out 2 again would collide with that job's idempotency key.
    _job(
        env,
        "job_g2",
        PAPER_A,
        state="dead_letter",
        created_at="2026-09-26T00:00:01Z",
        generation_=2,
    )
    assert env.db.next_generation(env.owner, PAPER_A) == 3
    # Another owner's jobs and papers, and this owner's other papers, are not counted.
    _job(
        env,
        "job_other",
        PAPER_A,
        state="pending",
        created_at="2026-09-26T00:00:02Z",
        generation_=9,
        user_id=env.other_id,
    )
    _job(env, "job_b", PAPER_B, state="pending", created_at="2026-09-26T00:00:03Z", generation_=7)
    assert env.db.next_generation(env.owner, PAPER_A) == 3
    assert env.db.next_generation(env.other, PAPER_B) == 1


def test_a_pre_s1_payload_without_a_generation_parsed_generation_1(env: Env) -> None:
    _job(
        env,
        "job_old",
        PAPER_A,
        state="dead_letter",
        created_at="2026-08-01T00:00:00Z",
        generation_=None,
    )
    assert env.db.next_generation(env.owner, PAPER_A) == 2


# ── list_library / library_row ──────────────────────────────────────────────────────────────


def test_list_library_lists_every_state_newest_first_with_its_job(env: Env) -> None:
    # Three uploads, created in this order: ready (promoted, 2 highlights' worth of state is
    # tested below), reading (running at persist), failed (dead-lettered at parse).
    for paper_id, name in ((PAPER_A, "ready.pdf"), (PAPER_B, "reading.pdf")):
        env.db.register_upload(
            env.owner, paper_id, "sha256:" + paper_id[-1].lower() * 64, name, 1, 2
        )
    ghost = PaperId("ppr_CCCCCCCCCCCCCCCCCCCCCCCCCC")
    env.db.register_upload(env.owner, ghost, "sha256:" + "c" * 64, "garbage.pdf", 34, None)

    document = make_paper(PAPER_A, "sha256:" + "a" * 64, 1, 3, page_count=2)
    document["metadata"] = {
        "title": {"value": "Durable Parsing", "source_block_id": None, "confidence": 1.0},
        "authors": [{"value": "Ada Lovelace"}, {"value": ""}, {"name": "not a value"}],
    }
    env.db.put_paper(env.owner, document)
    env.db.promote_generation(env.owner, PAPER_A, generation(1))
    _job(
        env,
        "job_a",
        PAPER_A,
        state="succeeded",
        created_at="2026-09-26T00:00:01Z",
        steps=(("parse", "succeeded"), ("persist", "succeeded"), ("promote", "succeeded")),
    )
    _job(
        env,
        "job_b",
        PAPER_B,
        state="running",
        created_at="2026-09-26T00:00:02Z",
        steps=(("parse", "succeeded"), ("persist", "running")),
    )
    _job(
        env,
        "job_c",
        ghost,
        state="dead_letter",
        created_at="2026-09-26T00:00:03Z",
        attempt_seq=2,
        steps=(("parse", "failed"),),
        error="[pdf_unreadable] FileDataError: Failed to open stream",
    )
    for paper_id, job_id in ((PAPER_A, "job_a"), (PAPER_B, "job_b"), (ghost, "job_c")):
        env.db.set_latest_job(env.owner, paper_id, job_id)

    rows = env.db.list_library(env.owner)

    assert [row.paper_id for row in rows] == [ghost, PAPER_B, PAPER_A]
    failed, reading, ready = rows
    assert (ready.generation, ready.paper_status) == (1, "complete")
    assert ready.parser_version == document["parser"]["version"]
    assert (ready.title, ready.authors) == ("Durable Parsing", ("Ada Lovelace",))
    assert (ready.job_state, ready.job_steps_done, ready.job_open_step) == ("succeeded", 3, None)
    assert (reading.generation, reading.title, reading.authors) == (None, None, ())
    assert (reading.job_state, reading.job_steps_done, reading.job_open_step) == (
        "running",
        1,
        "persist",
    )
    assert (failed.job_state, failed.job_open_step, failed.page_count) == (
        "dead_letter",
        "parse",
        None,
    )
    assert failed.job_error == "[pdf_unreadable] FileDataError: Failed to open stream"
    assert (failed.job_generation, failed.job_attempt_seq) == (1, 2)
    assert failed.original_filename == "garbage.pdf" and failed.byte_size == 34

    # Another owner sees none of it, and library_row agrees with the list row for row.
    assert env.db.list_library(env.other) == []
    assert env.db.library_row(env.other, PAPER_A) is None
    assert [env.db.library_row(env.owner, PaperId(row.paper_id)) for row in rows] == rows


def test_the_page_count_falls_back_to_the_promoted_generation(env: Env) -> None:
    """A paper written by `put_paper` alone (a pre-S1 parse, or `api_support.seed_paper`) has no
    upload columns; the library still knows its page count from the promoted generation."""
    env.db.put_paper(env.owner, make_paper(PAPER_A, HASH_A, 1, 3, page_count=4))
    (unpromoted,) = env.db.list_library(env.owner)
    assert (unpromoted.page_count, unpromoted.generation, unpromoted.latest_job_id) == (
        None,
        None,
        None,
    )
    env.db.promote_generation(env.owner, PAPER_A, generation(1))
    (row,) = env.db.list_library(env.owner)
    assert (row.page_count, row.original_filename, row.job_state) == (4, None, None)


def test_without_latest_job_id_the_newest_parse_job_is_shown(env: Env) -> None:
    """The moment between an upload's enqueue and its `set_latest_job`, and 0005 rows."""
    env.db.register_upload(env.owner, PAPER_A, HASH_A, "a.pdf", 1, 1)
    _job(env, "job_old", PAPER_A, state="dead_letter", created_at="2026-09-26T00:00:01Z")
    _job(env, "job_new", PAPER_A, state="pending", created_at="2026-09-26T00:00:02Z", attempt_seq=2)
    _job(env, "job_elsewhere", PAPER_B, state="running", created_at="2026-09-26T00:00:03Z")
    (row,) = env.db.list_library(env.owner)
    assert (row.latest_job_id, row.job_state, row.job_attempt_seq) == ("job_new", "pending", 2)


def test_highlight_count_counts_this_papers_highlights(env: Env) -> None:
    env.db.put_paper(env.owner, make_paper(PAPER_A, HASH_A, 1, 3))
    for index in range(2):
        env.raw.execute(
            "INSERT INTO highlights (highlight_id, owner_id, paper_id, color, note, "
            "created_generation, created_at, updated_at) VALUES (?, ?, ?, 'amber', NULL, 1, ?, ?)",
            (
                f"hl_{index:026d}",
                env.user_id,
                PAPER_A,
                "2026-09-26T00:00:00Z",
                "2026-09-26T00:00:00Z",
            ),
        )
    (row,) = env.db.list_library(env.owner)
    assert row.highlight_count == 2


# ── asset_grant ─────────────────────────────────────────────────────────────────────────────


def test_asset_grant_names_the_owning_user_and_nothing_for_an_unknown_paper(env: Env) -> None:
    env.db.register_upload(env.owner, PAPER_A, HASH_A, "a.pdf", 1, 1)
    assert env.db.asset_grant(PAPER_A) == env.user_id
    assert env.db.asset_grant(PAPER_B) is None
    env.db.delete_paper(env.owner, PAPER_A)
    assert env.db.asset_grant(PAPER_A) is None
