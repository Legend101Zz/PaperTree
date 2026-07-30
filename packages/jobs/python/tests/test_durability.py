"""jobs/durability.spec — the named acceptance test for EPIC-00 F0.6.

  "A job killed mid-step resumes at THAT step, not from the start. A failed step retries
   with backoff then dead-letters. Cancellation is honoured within one step."

THE CRASH IS A REAL CRASH. ``test_a_job_killed_mid_step_resumes_at_that_step`` starts a
separate OS process, waits until it is provably inside step 2, and sends it SIGKILL. Not an
exception, not a mock, not a monkeypatched failure — SIGKILL, which cannot be caught, so no
``finally``, no ``atexit``, no context-manager ``__exit__`` and no ``ROLLBACK`` in this
package's code gets to run. A test that raises an exception to "simulate" a crash proves
only that the cleanup path works, which is the path a crash does not take.

The evidence is a side-effect log the worker appends to once per step INVOCATION, so a step
that ran twice is visible as a duplicate line rather than inferred from state.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from papertree_db import OwnerId, PaperTreeDb, open_database
from papertree_jobs import Cancelled, Job, JobContext, JobRunner, JobStore, backoff_delay

WORKER = Path(__file__).resolve().parent / "durability_worker.py"
LEASE_SECONDS = 0.5


@dataclass(frozen=True, slots=True)
class Env:
    """Fully typed on purpose. packages/db/python/tests learned the hard way that an

    unannotated fixture makes every downstream value ``Any``, which silently turns the
    strictness assertions in these suites into no-ops. Do not un-type this.
    """

    db: Path
    log: Path
    sentinel: Path
    block: Path
    store: JobStore
    owner: OwnerId
    paper_db: PaperTreeDb


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    db = tmp_path / "papertree.sqlite"
    paper_db = open_database(db)
    paper_db.migrate()
    created = paper_db.create_user("worker-tests@papertree.test")
    store = JobStore(db)
    # Owner handles are per-connection: `store` has its own, so it mints its own.
    owner = store.owner_for(created.user_id)
    try:
        yield Env(
            db=db,
            log=tmp_path / "side-effects.log",
            sentinel=tmp_path / "sentinel",
            block=tmp_path / "block",
            store=store,
            owner=owner,
            paper_db=paper_db,
        )
    finally:
        store.close()
        paper_db.close()


def _spawn(env: Env) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [sys.executable, str(WORKER)],
        env={
            **os.environ,
            "PT_JOBS_DB": str(env.db),
            "PT_JOBS_LOG": str(env.log),
            "PT_JOBS_SENTINEL": str(env.sentinel),
            "PT_JOBS_BLOCK": str(env.block),
            "PT_JOBS_LEASE": str(LEASE_SECONDS),
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _wait_for_file(path: Path, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if path.exists():
            return
        time.sleep(0.01)
    raise AssertionError(f"{path.name} never appeared within {timeout}s")


def _log_lines(env: Env) -> list[str]:
    if not env.log.exists():
        return []
    return env.log.read_text(encoding="utf-8").split()


def _ledger(env: Env, job_id: str) -> list[str]:
    return [
        f"{s.step_index}:{s.step_name}={s.state}@attempt{s.attempt}"
        for s in env.store.list_steps(env.owner, job_id)
    ]


# ── the crash ────────────────────────────────────────────────────────────────────────


def test_a_job_killed_mid_step_resumes_at_that_step(env: Env) -> None:
    env.block.write_text("held", encoding="utf-8")
    job_id = env.store.enqueue(
        env.owner,
        "demo",
        "resume-me",
        {"steps": ["extract", "layout", "embed"], "block_at": "layout"},
        max_attempts=5,
    )

    victim = _spawn(env)
    try:
        _wait_for_file(env.sentinel)

        # PROGRESS IS READABLE FROM ANOTHER PROCESS WHILE THE JOB RUNS. This is the parent
        # process reading a job the child is in the middle of.
        mid = env.store.get_job(env.owner, job_id)
        assert mid is not None
        assert mid.state == "running"
        assert (mid.progress_done, mid.progress_total, mid.progress_note) == (1, 3, "extract")
        assert _ledger(env, job_id) == ["0:extract=succeeded@attempt1", "1:layout=running@attempt1"]
        print(
            f"\n  mid-flight (from the parent process): {mid.state} "
            f"{mid.progress_done}/{mid.progress_total} note={mid.progress_note!r}"
        )
        print(f"  ledger before the kill:  {_ledger(env, job_id)}")
        print(f"  side effects before:     {_log_lines(env)}")

        os.kill(victim.pid, signal.SIGKILL)
        assert victim.wait(timeout=10) == -signal.SIGKILL, "the child must die BY SIGKILL"
    finally:
        if victim.poll() is None:  # pragma: no cover - only on an assertion above
            victim.kill()
            victim.wait(timeout=10)

    assert _log_lines(env) == ["extract", "layout"]

    # The lease outlives the process it was granted to; the job is reclaimable once it
    # expires. Nothing had to notice the crash.
    killed = env.store.get_job(env.owner, job_id)
    assert killed is not None and killed.state == "running"
    assert killed.lease_expires_at is not None
    time.sleep(max(0.0, killed.lease_expires_at - time.time()) + 0.05)

    env.block.unlink()  # release the second run's `layout`
    survivor = _spawn(env)
    stdout, stderr = survivor.communicate(timeout=30)
    assert survivor.returncode == 0, stderr

    final = env.store.get_job(env.owner, job_id)
    assert final is not None
    print(f"  fresh process said:      {stdout.strip()}")
    print(f"  side effects after:      {_log_lines(env)}")
    print(f"  ledger after:            {_ledger(env, job_id)}")
    print(
        f"  final: {final.state} attempt={final.attempt} "
        f"progress={final.progress_done}/{final.progress_total}"
    )

    # THE ASSERTION THE SPEC IS NAMED FOR: `extract` appears ONCE (it had committed its
    # checkpoint, so it was not redone), `layout` appears TWICE (it was interrupted, so it
    # resumed at that step), `embed` appears once. Resumed at THAT step, not from the start.
    assert _log_lines(env) == ["extract", "layout", "layout", "embed"]
    assert final.state == "succeeded"
    assert final.attempt == 2
    assert (final.progress_done, final.progress_total) == (3, 3)
    assert _ledger(env, job_id) == [
        "0:extract=succeeded@attempt1",  # attempt1: written by the process that died
        "1:layout=succeeded@attempt2",
        "2:embed=succeeded@attempt2",
    ]


def test_a_committed_step_is_never_re_run_even_when_the_job_is(env: Env) -> None:
    """Idempotency, isolated from the crash: the step name IS the idempotency key.

    Here the job fails AFTER a step has committed, so the retry replays the whole handler.
    The committed step must not fire its side effect a second time.
    """
    calls: list[str] = []
    fail = {"still": True}

    def handler(ctx: JobContext) -> None:
        ctx.step("charge", lambda: calls.append("charge"))
        if fail["still"]:
            raise RuntimeError("downstream exploded after the charge committed")
        ctx.step("receipt", lambda: calls.append("receipt"))

    store = env.store
    job_id = store.enqueue(env.owner, "billing", "once-only", {}, max_attempts=3)
    runner = JobRunner(store, {"billing": handler}, backoff_base=0.01, backoff_factor=2.0)

    first = runner.run_once()
    assert first is not None and first.state == "pending"
    assert calls == ["charge"]

    fail["still"] = False
    second = _drain(runner)
    assert second is not None and second.state == "succeeded"
    assert calls == ["charge", "receipt"], "the committed step must not have re-run"
    assert [s.step_name for s in store.list_steps(env.owner, job_id)] == ["charge", "receipt"]


# ── retry, backoff, dead-letter ──────────────────────────────────────────────────────


def test_backoff_delays_actually_grow_and_are_capped() -> None:
    delays = [backoff_delay(n, base=0.5, factor=3.0, cap=100.0) for n in range(1, 6)]
    assert delays == [0.5, 1.5, 4.5, 13.5, 40.5]
    assert all(b > a for a, b in zip(delays, delays[1:], strict=False))
    assert backoff_delay(20, base=0.5, factor=3.0, cap=100.0) == 100.0
    with pytest.raises(ValueError):
        backoff_delay(0)


def test_a_failing_step_retries_with_growing_backoff_then_dead_letters(env: Env) -> None:
    attempts: list[int] = []

    def explode() -> None:
        raise RuntimeError("step 'boom' cannot succeed")

    def handler(ctx: JobContext) -> None:
        attempts.append(ctx.attempt)
        ctx.step("boom", explode)

    job_id = env.store.enqueue(env.owner, "flaky", "always-fails", {}, max_attempts=3)
    runner = JobRunner(
        env.store, {"flaky": handler}, backoff_base=0.05, backoff_factor=3.0, backoff_cap=10.0
    )

    scheduled: list[float] = []
    states: list[str] = []
    for _ in range(3):
        job = _drain(runner)
        assert job is not None
        states.append(job.state)
        if job.state == "pending":
            scheduled.append(round(job.run_after - time.time(), 3))

    print(f"\n  attempts observed by the handler: {attempts}")
    print(f"  states after each attempt:       {states}")
    print(f"  next-retry delay in seconds:     {scheduled}")

    assert attempts == [1, 2, 3]
    assert states == ["pending", "pending", "dead_letter"]
    # The delays GREW. (Measured, not asserted against the pure function: this is the value
    # that was actually written to run_after.)
    assert len(scheduled) == 2
    assert scheduled[1] > scheduled[0]
    assert scheduled[0] == pytest.approx(0.05, abs=0.03)
    assert scheduled[1] == pytest.approx(0.15, abs=0.03)

    dead = env.store.get_job(env.owner, job_id)
    assert dead is not None
    assert dead.state == "dead_letter"
    assert dead.error is not None and "cannot succeed" in dead.error
    steps = env.store.list_steps(env.owner, job_id)
    assert [(s.step_name, s.state, s.attempt) for s in steps] == [("boom", "failed", 3)]

    # A dead-lettered job is terminal: it is not claimed again, ever.
    time.sleep(0.2)
    assert runner.run_once() is None


def test_a_job_that_kills_its_worker_every_time_dead_letters_instead_of_looping(
    env: Env, tmp_path: Path
) -> None:
    """THE POISON PILL. 0002_jobs.sql claims incrementing `attempt` on the CLAIM is what

    stops "a job that reliably kills its worker retrying for ever". On its own it does not:
    incrementing only COUNTS the attempts, and the claim query had no retry-budget
    predicate, so an adversarial review drove `attempt` to 8 against `max_attempts=3` with
    a step that calls os._exit() — a job that kills every worker in the pool, for ever.

    Nothing in this test raises an exception, which is the point: the exception path always
    dead-lettered correctly. This is the CRASH path, which is the one F0.6 exists for.
    """
    worker = tmp_path / "suicide.py"
    worker.write_text(
        "import os, sys\n"
        "from papertree_jobs import JobStore, JobRunner\n"
        "def handler(ctx):\n"
        "    ctx.step('boom', lambda: os._exit(9))\n"
        "with JobStore(sys.argv[1]) as s:\n"
        "    JobRunner(s, {'poison': handler}, lease_seconds=0.2).run_once()\n",
        encoding="utf-8",
    )
    job_id = env.store.enqueue(env.owner, "poison", "kill-me", {}, max_attempts=3)

    observed: list[tuple[int, str]] = []
    for _ in range(6):
        subprocess.run([sys.executable, str(worker), str(env.db)], capture_output=True, check=False)
        job = env.store.get_job(env.owner, job_id)
        assert job is not None
        observed.append((job.attempt, job.state))
        time.sleep(0.25)

    print(f"\n  (attempt, state) after each worker death: {observed}")
    final = env.store.get_job(env.owner, job_id)
    assert final is not None
    assert final.attempt == 3, "the retry budget must bound crashes, not just exceptions"
    assert final.state == "dead_letter"
    assert final.error is not None and "retry budget is exhausted" in final.error
    assert final.is_terminal


def test_a_superseded_worker_cannot_clobber_the_worker_that_replaced_it(env: Env) -> None:
    """LEASE FENCING. A lease says when the NEXT worker may steal the job; it says nothing

    to the old one. A step longer than the lease that never calls ``ctx.progress()`` —
    nothing forces a handler to — had two processes running the same body and BOTH writing
    a terminal state onto the same row. The duplicate side effect is inherent to a lease
    and is documented; the state clobber is not, and this is the fence for it.

    Simulated in-process by letting the lease expire and having a second runner claim.
    """
    from papertree_jobs import LeaseLost

    assert LeaseLost is not None  # imported for the reader; the fence is asserted below
    job_id = env.store.enqueue(env.owner, "slow", "fenced", {}, max_attempts=5)
    stolen_by: list[str] = []
    finished_body: list[str] = []

    def worker_b(_ctx: JobContext) -> None:
        stolen_by.append("worker-B")

    def worker_a(ctx: JobContext) -> None:
        def body() -> str:
            time.sleep(0.35)  # outlive worker-A's 0.2s lease, without calling progress()
            JobRunner(
                env.store, {"slow": worker_b}, worker_id="worker-B", lease_seconds=5.0
            ).run_once()
            finished_body.append("worker-A")
            return "A's result"

        ctx.step("render", body)
        raise AssertionError("unreachable: the fence must raise before the handler continues")

    outcome = JobRunner(
        env.store, {"slow": worker_a}, worker_id="worker-A", lease_seconds=0.2
    ).run_once()

    assert stolen_by == ["worker-B"], "worker B must have re-claimed the expired lease"
    assert finished_body == ["worker-A"], "worker A really did finish its body — that is the race"
    assert outcome is not None
    steps = env.store.list_steps(env.owner, job_id)
    print(f"\n  final state after the steal: {outcome.state} (worker B's, not worker A's)")
    print(f"  ledger: {[(s.step_name, s.state, s.attempt) for s in steps]}")

    # Worker A wrote NOTHING after losing the lease: not the checkpoint, not a terminal
    # state, not a reschedule. The job's state is worker B's.
    assert outcome.state == "succeeded"
    assert outcome.lease_owner is None
    assert [(s.step_name, s.state) for s in steps] == [("render", "running")]


def test_a_superseded_worker_whose_body_throws_cannot_undo_a_committed_checkpoint(
    env: Env,
) -> None:
    """THE FAILURE PATH'S HALF OF THE FENCE (#24). The test above covers the success path.

    ``ctx.step`` fences before ``_finish_step`` — the comment there says why: once the
    lease is gone another worker owns the job and is redoing the work, so writing our
    checkpoint would overwrite theirs. The ``except`` branch four lines above it did not
    fence, and ``_fail_step``'s UPDATE was keyed on ``(job_id, step_name)`` alone. So a
    superseded worker whose body happened to THROW could write ``state='failed'`` over the
    live worker's committed ``succeeded``.

    That is not merely a wrong status. ``ctx.step``'s ``recorded.state == 'succeeded'``
    early-return is the only thing standing between a retry and a second side effect, so
    demoting the row to ``failed`` re-arms the exact bug the checkpoint exists to prevent.
    The last assertion here is that consequence, not the status: the render body must run
    twice (once superseded, once live), never three times.

    Same in-process construction as the test above — worker A's lease expires inside its
    step body, worker B re-claims — with two additions: B commits the checkpoint for the
    *same* step name, and A's body then raises.
    """
    job_id = env.store.enqueue(env.owner, "slow", "fenced-failure", {}, max_attempts=5)
    render_bodies_run: list[str] = []
    claims: list[str] = []
    live_fails_once = {"still": True}

    def live_body() -> str:
        render_bodies_run.append("live")
        return "the live worker's render"

    def live_handler(ctx: JobContext) -> None:
        claims.append(f"attempt{ctx.attempt}")
        ctx.step("render", live_body)
        if live_fails_once["still"]:
            # B's JOB fails after its STEP committed, so the job is rescheduled rather than
            # left terminal — which is what lets a third worker claim it and demonstrate
            # whether the checkpoint survived.
            live_fails_once["still"] = False
            raise RuntimeError("the live worker's job failed after render had committed")

    def superseded_body() -> str:
        render_bodies_run.append("superseded")
        time.sleep(0.35)  # outlive worker-A's 0.2s lease, without calling progress()
        JobRunner(
            env.store,
            {"slow": live_handler},
            worker_id="worker-B",
            lease_seconds=5.0,
            backoff_base=0.01,
            backoff_factor=2.0,
        ).run_once()
        raise RuntimeError("worker A's body exploded after worker B committed the checkpoint")

    def superseded_handler(ctx: JobContext) -> None:
        ctx.step("render", superseded_body)

    JobRunner(
        env.store, {"slow": superseded_handler}, worker_id="worker-A", lease_seconds=0.2
    ).run_once()

    after_the_race = env.store.list_steps(env.owner, job_id)
    print(f"\n  render bodies run so far: {render_bodies_run}")
    print(
        f"  ledger after A threw:     {[(s.step_name, s.state, s.error) for s in after_the_race]}"
    )

    # Worker A wrote NOTHING after losing the lease — including on the way out through the
    # exception handler. The checkpoint on disk is worker B's.
    assert [(s.step_name, s.state) for s in after_the_race] == [("render", "succeeded")]
    assert after_the_race[0].result == "the live worker's render"
    assert after_the_race[0].error is None, "worker A's exception must not be recorded here"

    # THE CONSEQUENCE. B's job was rescheduled, so a third worker claims it and replays the
    # handler. `render` already committed, so its body must not fire again.
    resumed = _drain(
        JobRunner(env.store, {"slow": live_handler}, worker_id="worker-C", lease_seconds=5.0)
    )
    assert resumed is not None
    print(f"  handler claims:           {claims}")
    print(f"  render bodies in the end:  {render_bodies_run}")
    assert resumed.state == "succeeded"
    assert render_bodies_run == ["superseded", "live"], "a committed step must never re-run"
    final_steps = env.store.list_steps(env.owner, job_id)
    assert [(s.step_name, s.state) for s in final_steps] == [("render", "succeeded")]


# ── cancellation ─────────────────────────────────────────────────────────────────────


def test_cancellation_is_honoured_within_one_step_not_at_the_end_of_the_job(env: Env) -> None:
    """Cancelled from THIS process while another process is inside step 1 of 3.

    The step that was already running finishes (nothing can interrupt arbitrary Python
    mid-call, and pretending otherwise would be a lie). Step 2 never starts. That is the
    difference between "within one step" and "at the end of the job".
    """
    env.block.write_text("held", encoding="utf-8")
    job_id = env.store.enqueue(
        env.owner,
        "demo",
        "cancel-me",
        {"steps": ["first", "second", "third"], "block_at": "first"},
        max_attempts=3,
    )

    worker = _spawn(env)
    try:
        _wait_for_file(env.sentinel)
        assert env.store.request_cancel(env.owner, job_id) is True
        env.block.unlink()  # let `first` finish; `second` must never begin
        stdout, stderr = worker.communicate(timeout=30)
        assert worker.returncode == 0, stderr
    finally:
        if worker.poll() is None:  # pragma: no cover
            worker.kill()
            worker.wait(timeout=10)

    final = env.store.get_job(env.owner, job_id)
    assert final is not None
    print(f"\n  worker said:     {stdout.strip()}")
    print(f"  side effects:    {_log_lines(env)}   (2 of 3 steps never ran)")
    print(f"  ledger:          {_ledger(env, job_id)}")

    assert final.state == "cancelled"
    assert final.cancel_requested is True
    assert _log_lines(env) == ["first"]
    assert _ledger(env, job_id) == ["0:first=succeeded@attempt1"]
    # Cancelled is terminal: it is not retried and not re-claimed.
    assert final.is_terminal


def test_a_pending_job_is_cancelled_outright_and_never_claimed(env: Env) -> None:
    def handler(ctx: JobContext) -> None:  # pragma: no cover - must never be called
        raise AssertionError("a cancelled job must not run")

    job_id = env.store.enqueue(env.owner, "demo", "never-runs", {"steps": []})
    assert env.store.request_cancel(env.owner, job_id) is True
    runner = JobRunner(env.store, {"demo": handler})
    assert runner.run_once() is None
    job = env.store.get_job(env.owner, job_id)
    assert job is not None and job.state == "cancelled"
    # A second cancel of a terminal job is a no-op that says so.
    assert env.store.request_cancel(env.owner, job_id) is False


def test_check_cancelled_lets_a_long_step_bail_out_mid_body(env: Env) -> None:
    """The finer-grained knob, for a step too long to wait a whole step boundary."""
    seen: list[str] = []

    def handler(ctx: JobContext) -> None:
        def long_body() -> None:
            for page in range(100):
                if ctx.cancelled():
                    raise Cancelled("stopped between pages")
                seen.append(f"page{page}")
                if page == 2:
                    env.store.request_cancel(env.owner, ctx.job_id)

        ctx.step("render", long_body)

    job_id = env.store.enqueue(env.owner, "demo", "bail-out", {})
    final = JobRunner(env.store, {"demo": handler}).run_once()
    assert final is not None and final.state == "cancelled"
    assert seen == ["page0", "page1", "page2"]
    steps = env.store.list_steps(env.owner, job_id)
    assert [(s.step_name, s.state) for s in steps] == [("render", "running")]


def _drain(runner: JobRunner, timeout: float = 10.0) -> Job | None:
    """Polls until a job is due (backoff means 'due' is a moment in the future)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = runner.run_once()
        if job is not None:
            return job
        time.sleep(0.01)
    return None
