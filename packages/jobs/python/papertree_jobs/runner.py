"""``JobRunner`` and ``JobContext`` — the ~100 lines of control flow that make it durable.

A handler is an ordinary function. It receives a ``JobContext`` and calls ``ctx.step(name,
fn)`` for each unit of work it wants checkpointed. There is no decorator, no registry
import side effect, no DSL and no scheduler: the durability comes from the ``job_steps``
row, not from anything clever here.
"""

from __future__ import annotations

import os
import socket
import time
from collections.abc import Callable, Mapping
from typing import Any

from .model import (
    DEFAULT_BACKOFF_BASE_SECONDS,
    DEFAULT_BACKOFF_CAP_SECONDS,
    DEFAULT_BACKOFF_FACTOR,
    DEFAULT_LEASE_SECONDS,
    Cancelled,
    Job,
    JobFailed,
    LeaseLost,
    RunOutcome,
    StepOutcome,
    backoff_delay,
    coded_error,
)
from .store import JobStore

#: A handler runs one job. It returns nothing: results belong to steps, which are durable.
Handler = Callable[["JobContext"], None]


class JobObserver:
    """What a runner reports while it works: the seam for logs and for tests. Every method is a
    no-op here; subclass and override what you need.

    WHY A SEAM AND NOT LOG LINES IN THIS PACKAGE. What a job's events look like on stdout is the
    deployment's business (services/api's worker writes contracts.md §8's JSON lines), and a test
    that needs a deterministic moment between two steps — to SIGKILL a worker exactly there —
    needs the same hook a logger does. One seam serves both.

    AN OBSERVER CANNOT BREAK A JOB. Every call is guarded: an exception from an observer is
    counted on the runner (``observer_errors``) and otherwise ignored, because a logging failure
    (a closed stdout, a full disk) that failed or retried a parse would turn an observability
    problem into a data problem. ``step_started`` runs BEFORE the step's row is written, and it
    may block: that is how a test holds a worker at a step boundary.
    """

    def claimed(self, job: Job) -> None:
        """A job was claimed under a lease (``job.attempt`` is already this attempt's number)."""

    def step_started(self, job: Job, name: str) -> None:
        """A step whose checkpoint has NOT committed is about to run its body."""

    def step_finished(
        self,
        job: Job,
        name: str,
        *,
        outcome: StepOutcome,
        ms: float,
        result: Any,
        error: str | None,
    ) -> None:
        """A ``ctx.step`` call ended. ``resumed``: its checkpoint had committed on an earlier
        attempt, the body did not run, and ``result`` is the recorded one."""

    def finished(self, job: Job, *, outcome: RunOutcome) -> None:
        """``run_once`` is returning. ``job`` is the row as it now stands (the claimed snapshot
        when the row is gone)."""


#: The observer a runner uses when none is given.
SILENT = JobObserver()


def pid_is_alive(pid: int) -> bool:
    """Whether a process with this pid exists on this host (signal 0 probes without sending).

    ``PermissionError`` means it exists but belongs to another user: alive. Only a definite
    ``ProcessLookupError`` is dead, so a doubtful answer errs toward waiting out the lease.
    A pid too large for the OS to be asked about (``OverflowError``: a hand-made worker id such as
    ``host:99999999999999999999``) is doubt too; before, it escaped and killed the worker.
    """
    if pid <= 0:
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:  # PermissionError included: the process exists, it is not ours
        return True
    except OverflowError:  # no such pid can exist, so it is not a worker of ours: leave it
        return True
    return True


class JobContext:
    """What a handler is given. Its only powers are: checkpoint, report, and check.

    ``owner_id`` is a bare ``str`` on purpose — see ``store.py``'s module docstring. To
    touch tenant data the handler must call ``PaperTreeDb.authenticate(ctx.owner_id)``,
    which fails unless the ``users`` row is really there.
    """

    __slots__ = ("_job", "_lease_seconds", "_notify", "_store", "_worker_id")

    def __init__(
        self,
        store: JobStore,
        job: Job,
        lease_seconds: float,
        worker_id: str,
        notify: _Notify | None = None,
    ) -> None:
        self._store = store
        self._job = job
        self._lease_seconds = lease_seconds
        self._worker_id = worker_id
        self._notify = notify if notify is not None else _Notify(SILENT)

    @property
    def job_id(self) -> str:
        return self._job.job_id

    @property
    def owner_id(self) -> str:
        return self._job.owner_id

    @property
    def attempt(self) -> int:
        """1 on the first run. A resumed job sees a higher number, and may branch on it."""
        return self._job.attempt

    @property
    def payload(self) -> Any:
        return self._job.payload

    def step(self, name: str, fn: Callable[[], Any]) -> Any:
        """Runs ``fn`` once per job, ever, and returns its recorded result.

        The return type is ``Any`` and that is honest, not lazy: on the first run you get
        whatever ``fn`` returned, and on a resume you get whatever ``json.loads`` made of
        it. Claiming a narrower type would be claiming a round-trip that does not happen.

        ``name`` is the step's identity — reuse one within a job and you have declared the
        two calls to be the same step.
        """
        self.check_cancelled()
        recorded = self._store._step_record(self._job.job_id, name)
        if recorded is not None and recorded.state == "succeeded":
            # The side effect already committed. Re-running it is the bug this exists to
            # prevent, so the body is never called.
            self._notify.step_finished(
                self._job, name, outcome="resumed", ms=0.0, result=recorded.result, error=None
            )
            return recorded.result
        self.check_lease()
        self._notify.step_started(self._job, name)
        self._store._begin_step(self._job, name)
        started = time.perf_counter()
        try:
            result = fn()
        except Cancelled:
            raise
        except Exception as exc:
            # FENCE BEFORE THE FAILURE WRITE, for the same reason as the checkpoint below
            # and with more at stake (#24). If the lease expired while the body ran, the
            # worker that took over may already have re-run this step and committed
            # `succeeded`; writing our `failed` over it would demote a committed
            # checkpoint back to a re-runnable one. check_lease() raises LeaseLost, which
            # run_once() answers by writing nothing at all — the right outcome for a
            # worker that has been superseded, whether its body succeeded or threw.
            self.check_lease()
            error = _describe(exc)
            self._store._fail_step(self._job.job_id, name, error, self._worker_id)
            self._notify.step_finished(
                self._job, name, outcome="failed", ms=_ms_since(started), result=None, error=error
            )
            raise
        # FENCE BEFORE THE CHECKPOINT. If the lease expired while the body ran, another
        # worker now owns this job and is redoing the work; writing our checkpoint (and,
        # later, our terminal state) would overwrite theirs. See model.LeaseLost.
        self.check_lease()
        self._store._finish_step(self._job.job_id, name, result)
        self._notify.step_finished(
            self._job, name, outcome="succeeded", ms=_ms_since(started), result=result, error=None
        )
        return result

    def progress(self, done: int, total: int, note: str | None = None) -> None:
        """Publishes progress AND renews the lease. Readable from any other process."""
        self._store._set_progress(
            self._job.job_id, done, total, note, self._lease_seconds, self._worker_id
        )

    def holds_lease(self) -> bool:
        """False once another worker has taken this job — poll it inside a very long step."""
        return self._store._holds_lease(self._job.job_id, self._worker_id)

    def check_lease(self) -> None:
        if not self.holds_lease():
            raise LeaseLost(
                f"job {self._job.job_id} was re-claimed by another worker; "
                f"{self._worker_id} no longer holds the lease"
            )

    def cancelled(self) -> bool:
        """Poll this inside a long step to honour cancellation faster than per-step."""
        return self._store._cancel_requested(self._job.job_id)

    def check_cancelled(self) -> None:
        if self.cancelled():
            raise Cancelled(f"job {self._job.job_id} was cancelled")


class JobRunner:
    """Claims jobs of the kinds it has handlers for, and runs them.

    Stateless across jobs: everything it needs is in the two tables, so a fresh process
    picks up exactly where a dead one stopped.
    """

    def __init__(
        self,
        store: JobStore,
        handlers: Mapping[str, Handler],
        *,
        worker_id: str | None = None,
        lease_seconds: float = DEFAULT_LEASE_SECONDS,
        backoff_base: float = DEFAULT_BACKOFF_BASE_SECONDS,
        backoff_factor: float = DEFAULT_BACKOFF_FACTOR,
        backoff_cap: float = DEFAULT_BACKOFF_CAP_SECONDS,
        observer: JobObserver | None = None,
    ) -> None:
        self._store = store
        self._handlers = dict(handlers)
        self._worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
        self._lease_seconds = lease_seconds
        self._backoff_base = backoff_base
        self._backoff_factor = backoff_factor
        self._backoff_cap = backoff_cap
        self._notify = _Notify(observer if observer is not None else SILENT)

    @property
    def worker_id(self) -> str:
        return self._worker_id

    @property
    def observer_errors(self) -> int:
        """How many observer calls raised (and were ignored). See ``JobObserver``."""
        return self._notify.errors

    def release_dead_local_workers(self) -> list[str]:
        """Makes the jobs of DEAD workers on this host claimable now, not a lease from now.

        Call it when a worker starts (and when it is idle): a worker SIGKILLed between two steps
        then resumes at the next step as soon as a worker runs again, instead of after its lease.
        See ``JobStore._expire_dead_leases`` for exactly what is and is not touched.
        """
        return self._store._expire_dead_leases(socket.gethostname(), pid_is_alive)

    def run_once(self) -> Job | None:
        """Claims at most one job, runs it to a conclusion, returns its final state.

        Returns ``None`` when nothing is due. Every exit path below leaves the job in a
        terminal state or back in ``pending`` with a future ``run_after`` — there is no
        path that leaves it ``running`` except the process dying, which is what the lease
        is for.
        """
        job = self._store._claim(self._worker_id, tuple(self._handlers), self._lease_seconds)
        if job is None:
            return None
        self._notify.claimed(job)
        if job.cancel_requested:
            # Either cancelled while pending-and-due, or cancelled while running under a
            # worker that then died. Both land here; neither runs the handler.
            self._store._finalise(job.job_id, "cancelled", job.error, self._worker_id)
            return self._done(job, "cancelled")

        context = JobContext(self._store, job, self._lease_seconds, self._worker_id, self._notify)
        outcome: RunOutcome
        try:
            self._handlers[job.kind](context)
        except LeaseLost:
            # We were superseded mid-job. The worker that took it is running it now, so we
            # write NOTHING — not a terminal state, not a reschedule. Abandoning silently is
            # the whole point of the fence; the alternative is clobbering the live worker.
            return self._done(job, "superseded")
        except Cancelled as exc:
            self._store._finalise(job.job_id, "cancelled", str(exc), self._worker_id)
            outcome = "cancelled"
        except Exception as exc:
            error = _describe(exc)
            # A classified, non-retryable failure (`JobFailed(retryable=False)`) is as final on
            # this attempt as on the last: retrying it is spending backoff on a known answer.
            final = isinstance(exc, JobFailed) and not exc.retryable
            if final or job.attempt >= job.max_attempts:
                self._store._finalise(job.job_id, "dead_letter", error, self._worker_id)
                outcome = "dead_letter"
            else:
                self._store._reschedule(
                    job.job_id,
                    backoff_delay(
                        job.attempt,
                        base=self._backoff_base,
                        factor=self._backoff_factor,
                        cap=self._backoff_cap,
                    ),
                    error,
                    self._worker_id,
                )
                outcome = "retry"
        else:
            self._store._finalise(job.job_id, "succeeded", None, self._worker_id)
            outcome = "succeeded"
        return self._done(job, outcome)

    def _done(self, claimed: Job, outcome: RunOutcome) -> Job | None:
        """The row as it now stands, reported to the observer. ``None`` only when the row is
        GONE (its paper was deleted while it ran): the caller then has no job to report."""
        final = self._store._read(claimed.job_id)
        if final is None:
            self._notify.finished(claimed, outcome="gone")
        else:
            self._notify.finished(final, outcome=outcome)
        return final


# There is deliberately NO run_forever(). The loop is four lines (see the usage example in
# __init__.py and the real one in tests/durability_worker.py) and every caller wants a
# different stop condition — SIGTERM for the worker, drain-and-exit for a CLI, a deadline
# for a test. Shipping one that none of them could use is how this repo accumulated 1,698
# lines nobody imports (findings.md §A).


class _Notify:
    """Calls an observer and never lets it raise into the job (see ``JobObserver``)."""

    __slots__ = ("_observer", "errors")

    def __init__(self, observer: JobObserver) -> None:
        self._observer = observer
        self.errors = 0

    def claimed(self, job: Job) -> None:
        try:
            self._observer.claimed(job)
        except Exception:
            self.errors += 1

    def step_started(self, job: Job, name: str) -> None:
        try:
            self._observer.step_started(job, name)
        except Exception:
            self.errors += 1

    def step_finished(
        self,
        job: Job,
        name: str,
        *,
        outcome: StepOutcome,
        ms: float,
        result: Any,
        error: str | None,
    ) -> None:
        try:
            self._observer.step_finished(
                job, name, outcome=outcome, ms=ms, result=result, error=error
            )
        except Exception:
            self.errors += 1

    def finished(self, job: Job, *, outcome: RunOutcome) -> None:
        try:
            self._observer.finished(job, outcome=outcome)
        except Exception:
            self.errors += 1


def _ms_since(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 1)


def _describe(exc: BaseException) -> str:
    """The stored error text. A classified failure is ``[<code>] <message>`` (``coded_error``),
    so the code survives into ``jobs.error`` and ``job_steps.error``; anything else is
    ``<Type>: <text>`` as before."""
    if isinstance(exc, JobFailed):
        return coded_error(exc.code, exc.message)
    return f"{type(exc).__name__}: {exc}"
