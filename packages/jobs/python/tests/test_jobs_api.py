"""The surface around the durability spec: idempotent enqueue, and owner scoping.

findings.md §F is about papers and highlights, but a job is tenant data too — its payload
names a paper, its ``error`` can quote document content, and its progress says what a
tenant is doing right now. So the same gate applies here, and this file is where it is
checked. The fixtures are fully typed for the reason recorded in test_durability.py.
"""

from __future__ import annotations

import inspect
import sqlite3
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from papertree_db import OwnerId, OwnershipError, PaperTreeDb, open_database
from papertree_jobs import JobContext, JobRunner, JobStore

LIFECYCLE_METHODS = frozenset({"migrate", "close"})


@dataclass(frozen=True, slots=True)
class Two:
    store: JobStore
    alice: OwnerId
    bob: OwnerId
    db: PaperTreeDb


@pytest.fixture
def two(tmp_path: Path) -> Iterator[Two]:
    db = open_database(tmp_path / "papertree.sqlite")
    db.migrate()
    store = JobStore(tmp_path / "papertree.sqlite")
    try:
        yield Two(
            store=store,
            alice=db.create_user("alice@papertree.test"),
            bob=db.create_user("bob@papertree.test"),
            db=db,
        )
    finally:
        store.close()
        db.close()


def test_migrate_applies_0002_and_re_running_is_a_noop(tmp_path: Path) -> None:
    """F0.6 ships DDL, not a second runner: this is packages/db's migrate() applying it."""
    with JobStore(tmp_path / "fresh.sqlite") as store:
        result = store.migrate()
        assert result.head == (1, 2)
        assert result.applied == (1, 2)
        assert store.migrate().applied == ()


def test_enqueue_is_idempotent_per_owner(two: Two) -> None:
    first = two.store.enqueue(two.alice, "parse", "sha256:abc", {"n": 1})
    second = two.store.enqueue(two.alice, "parse", "sha256:abc", {"n": 2})
    assert first == second
    assert len(two.store.list_jobs(two.alice)) == 1
    # The retried enqueue did NOT overwrite the payload — the first one won.
    job = two.store.get_job(two.alice, first)
    assert job is not None and job.payload == {"n": 1}

    # …and the key is scoped to the owner, so Bob's identical key is Bob's own job.
    bobs = two.store.enqueue(two.bob, "parse", "sha256:abc", {"n": 3})
    assert bobs != first
    assert len(two.store.list_jobs(two.bob)) == 1


def test_one_owner_cannot_read_or_cancel_another_owners_job(two: Two) -> None:
    job_id = two.store.enqueue(two.alice, "parse", "private", {"paper": "secret"})
    assert two.store.get_job(two.bob, job_id) is None
    assert two.store.list_jobs(two.bob) == []
    assert two.store.list_steps(two.bob, job_id) == []
    assert two.store.request_cancel(two.bob, job_id) is False
    # Non-vacuous: the same three calls succeed for the owner.
    assert two.store.get_job(two.alice, job_id) is not None
    assert two.store.request_cancel(two.alice, job_id) is True


def test_a_forged_owner_raises(two: Two) -> None:
    with pytest.raises(OwnershipError):
        two.store.enqueue("usr_forged", "parse", "k", {})  # type: ignore[arg-type]
    with pytest.raises(OwnershipError):
        two.store.get_job("usr_forged", "job_x")  # type: ignore[arg-type]
    with pytest.raises(OwnershipError):
        # OwnerId's constructor is guarded: there is no `as` cast to smuggle one in with.
        OwnerId("usr_forged")


def test_an_owner_from_a_different_database_cannot_enqueue(two: Two, tmp_path: Path) -> None:
    """Gate 4, on THIS connection: ``jobs.owner_id`` really is an enforced FK to ``users``.

    Python's sqlite3 defaults ``PRAGMA foreign_keys`` OFF and it is per-connection, so
    packages/db asserting it says nothing about the job store's own connection. Here a
    genuinely minted OwnerId — real class, real users row, wrong database — is rejected by
    the constraint. Delete the PRAGMA line in store.py and this test goes green-to-red.
    """
    elsewhere = open_database(tmp_path / "other.sqlite")
    try:
        elsewhere.migrate()
        stranger = elsewhere.create_user("mallory@papertree.test")
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            two.store.enqueue(stranger, "parse", "k", {})
    finally:
        elsewhere.close()


def test_every_tenant_facing_store_method_takes_owner_first(two: Two) -> None:
    """A REFLECTION test, so a helper added in Epic 1 that forgets the owner fails here.

    The claim path is exempt and is underscored for exactly that reason: a worker drains
    every tenant's queue, so it cannot hold an OwnerId. See store.py's module docstring.
    """
    checked = 0
    for name, member in inspect.getmembers(JobStore, inspect.isfunction):
        if name.startswith("_") or name in LIFECYCLE_METHODS:
            continue
        params = list(inspect.signature(member).parameters)
        assert params[:2] == ["self", "owner"], f"JobStore.{name} does not take owner first"
        assert inspect.signature(member).parameters["owner"].annotation == "OwnerId"
        checked += 1
    # Guards against auditing nothing.
    assert checked >= 5, f"only {checked} methods audited"


def test_a_worker_is_handed_a_bare_string_not_an_owner(two: Two) -> None:
    """The privilege boundary: the handler must re-earn the owner against a users row."""
    seen: dict[str, object] = {}

    def handler(ctx: JobContext) -> None:
        seen["raw"] = ctx.owner_id
        seen["type"] = type(ctx.owner_id)
        # A bare string is worth nothing until papertree_db checks it against `users`.
        seen["authenticated"] = two.db.authenticate(ctx.owner_id)

    two.store.enqueue(two.alice, "parse", "k", {})
    final = JobRunner(two.store, {"parse": handler}).run_once()
    assert final is not None and final.state == "succeeded"
    assert seen["type"] is str
    assert seen["authenticated"] == two.alice
    with pytest.raises(OwnershipError):
        two.db.authenticate("usr_not_a_real_user")


def test_a_runner_only_claims_kinds_it_can_handle(two: Two) -> None:
    def handler(ctx: JobContext) -> None:
        ctx.step("noop", lambda: None)

    two.store.enqueue(two.alice, "audio", "k", {})
    assert JobRunner(two.store, {"parse": handler}).run_once() is None
    assert JobRunner(two.store, {}).run_once() is None
    final = JobRunner(two.store, {"audio": handler}).run_once()
    assert final is not None and final.state == "succeeded"


def test_concurrent_workers_never_claim_the_same_job_twice(two: Two, tmp_path: Path) -> None:
    """``_claim`` opens BEGIN IMMEDIATE *before* its SELECT. This is that claim, tested.

    THE SIZE IS CALIBRATED, NOT ARBITRARY. Deleting the BEGIN IMMEDIATE and leaving the
    SELECT-then-UPDATE in autocommit was measured at three sizes: with 4 workers and 8 jobs
    the broken version still PASSES (the window between the two statements is microseconds
    and never gets hit), so a small version of this test would be false coverage. At
    12 workers and 300 jobs the broken version runs ~70 jobs twice, every time. Do not
    shrink it: it stops testing anything.
    """
    workers, count = 12, 300
    expected = {two.store.enqueue(two.alice, "parse", f"job-{n}", {}) for n in range(count)}
    lock = threading.Lock()
    ran: list[str] = []
    start = threading.Barrier(workers)

    def drain() -> None:
        with JobStore(tmp_path / "papertree.sqlite") as store:

            def handler(ctx: JobContext) -> None:
                with lock:
                    ran.append(ctx.job_id)

            runner = JobRunner(store, {"parse": handler})
            start.wait()
            idle = 0
            while idle < 5:
                idle = 0 if runner.run_once() is not None else idle + 1

    threads = [threading.Thread(target=drain) for _ in range(workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
        assert not thread.is_alive()

    print(f"\n  {workers} concurrent workers drained {len(ran)} runs of {count} jobs")
    assert len(ran) == count, f"{len(ran) - len(set(ran))} jobs were claimed twice"
    assert set(ran) == expected


def test_progress_defaults_to_zero_and_is_written_by_the_handler(two: Two) -> None:
    def handler(ctx: JobContext) -> None:
        ctx.progress(3, 10, "page 3 of 10")

    job_id = two.store.enqueue(two.alice, "parse", "k", {})
    before = two.store.get_job(two.alice, job_id)
    assert before is not None
    assert (before.progress_done, before.progress_total, before.progress_note) == (0, 0, None)
    JobRunner(two.store, {"parse": handler}).run_once()
    after = two.store.get_job(two.alice, job_id)
    assert after is not None
    assert (after.progress_done, after.progress_total, after.progress_note) == (
        3,
        10,
        "page 3 of 10",
    )
