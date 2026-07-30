"""``JobRunner`` and ``JobContext`` — the ~100 lines of control flow that make it durable.

A handler is an ordinary function. It receives a ``JobContext`` and calls ``ctx.step(name,
fn)`` for each unit of work it wants checkpointed. There is no decorator, no registry
import side effect, no DSL and no scheduler: the durability comes from the ``job_steps``
row, not from anything clever here.
"""

from __future__ import annotations

import os
import socket
from collections.abc import Callable, Mapping
from typing import Any

from .model import (
    DEFAULT_BACKOFF_BASE_SECONDS,
    DEFAULT_BACKOFF_CAP_SECONDS,
    DEFAULT_BACKOFF_FACTOR,
    DEFAULT_LEASE_SECONDS,
    Cancelled,
    Job,
    LeaseLost,
    backoff_delay,
)
from .store import JobStore

#: A handler runs one job. It returns nothing: results belong to steps, which are durable.
Handler = Callable[["JobContext"], None]


class JobContext:
    """What a handler is given. Its only powers are: checkpoint, report, and check.

    ``owner_id`` is a bare ``str`` on purpose — see ``store.py``'s module docstring. To
    touch tenant data the handler must call ``PaperTreeDb.authenticate(ctx.owner_id)``,
    which fails unless the ``users`` row is really there.
    """

    __slots__ = ("_job", "_lease_seconds", "_store", "_worker_id")

    def __init__(self, store: JobStore, job: Job, lease_seconds: float, worker_id: str) -> None:
        self._store = store
        self._job = job
        self._lease_seconds = lease_seconds
        self._worker_id = worker_id

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
            return recorded.result
        self.check_lease()
        self._store._begin_step(self._job, name)
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
            self._store._fail_step(self._job.job_id, name, _describe(exc), self._worker_id)
            raise
        # FENCE BEFORE THE CHECKPOINT. If the lease expired while the body ran, another
        # worker now owns this job and is redoing the work; writing our checkpoint (and,
        # later, our terminal state) would overwrite theirs. See model.LeaseLost.
        self.check_lease()
        self._store._finish_step(self._job.job_id, name, result)
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
    ) -> None:
        self._store = store
        self._handlers = dict(handlers)
        self._worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
        self._lease_seconds = lease_seconds
        self._backoff_base = backoff_base
        self._backoff_factor = backoff_factor
        self._backoff_cap = backoff_cap

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
        if job.cancel_requested:
            # Either cancelled while pending-and-due, or cancelled while running under a
            # worker that then died. Both land here; neither runs the handler.
            self._store._finalise(job.job_id, "cancelled", job.error, self._worker_id)
            return self._store._read(job.job_id)

        context = JobContext(self._store, job, self._lease_seconds, self._worker_id)
        try:
            self._handlers[job.kind](context)
        except LeaseLost:
            # We were superseded mid-job. The worker that took it is running it now, so we
            # write NOTHING — not a terminal state, not a reschedule. Abandoning silently is
            # the whole point of the fence; the alternative is clobbering the live worker.
            return self._store._read(job.job_id)
        except Cancelled as exc:
            self._store._finalise(job.job_id, "cancelled", str(exc), self._worker_id)
        except Exception as exc:
            error = _describe(exc)
            if job.attempt >= job.max_attempts:
                self._store._finalise(job.job_id, "dead_letter", error, self._worker_id)
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
        else:
            self._store._finalise(job.job_id, "succeeded", None, self._worker_id)
        return self._store._read(job.job_id)


# There is deliberately NO run_forever(). The loop is four lines (see the usage example in
# __init__.py and the real one in tests/durability_worker.py) and every caller wants a
# different stop condition — SIGTERM for the worker, drain-and-exit for a CLI, a deadline
# for a test. Shipping one that none of them could use is how this repo accumulated 1,698
# lines nobody imports (findings.md §A).


def _describe(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"
