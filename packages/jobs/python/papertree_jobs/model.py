"""Value types and the backoff curve for :mod:`papertree_jobs`.

Everything here is data or arithmetic. The SQL is in ``store.py`` and the control flow is
in ``runner.py``; splitting them that way is what keeps the runtime under 400 lines.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final, Literal

#: See the state diagram at the top of infrastructure/migrations/0002_jobs.sql.
JobState = Literal["pending", "running", "succeeded", "cancelled", "dead_letter"]
StepState = Literal["running", "succeeded", "failed"]

TERMINAL_STATES: Final[frozenset[str]] = frozenset({"succeeded", "cancelled", "dead_letter"})

DEFAULT_MAX_ATTEMPTS: Final = 3
DEFAULT_BACKOFF_BASE_SECONDS: Final = 1.0
DEFAULT_BACKOFF_FACTOR: Final = 4.0
DEFAULT_BACKOFF_CAP_SECONDS: Final = 300.0
#: How long a claim is held before another worker may steal the job. It must exceed the
#: longest step, or a slow step gets its job re-claimed underneath it. ``ctx.progress()``
#: extends the lease, which is how a genuinely long step declares that it is still alive.
DEFAULT_LEASE_SECONDS: Final = 60.0


class JobError(Exception):
    """Base class for everything this package raises."""


class Cancelled(JobError):
    """Raised inside a handler when cancellation was requested. Not a failure: no retry."""


class LeaseLost(JobError):
    """Raised when this worker's lease expired and another worker took the job.

    THE FENCING TOKEN. A lease alone is not enough: it tells the next worker when it may
    steal the job, but it tells the OLD worker nothing. An adversarial review ran a single
    step longer than the lease with no ``ctx.progress()`` call — which nothing forces a
    handler to make — and got two processes executing the same step body concurrently and
    both writing ``succeeded`` onto the same row. The duplicate side effect is inherent to
    a lease; the state clobber is not. ``lease_owner`` is now checked before every
    checkpoint, progress publish and finalisation, so a worker that has been superseded
    abandons quietly instead of overwriting the state of the worker that replaced it.
    """


@dataclass(frozen=True, slots=True)
class Job:
    """One row of ``jobs``. Frozen: this is a snapshot, not a live handle."""

    job_id: str
    owner_id: str
    kind: str
    idempotency_key: str
    payload: Any
    state: JobState
    cancel_requested: bool
    attempt: int
    max_attempts: int
    run_after: float
    lease_owner: str | None
    lease_expires_at: float | None
    progress_done: int
    progress_total: int
    progress_note: str | None
    error: str | None
    created_at: str
    updated_at: str

    @property
    def is_terminal(self) -> bool:
        return self.state in TERMINAL_STATES


@dataclass(frozen=True, slots=True)
class StepRecord:
    """One row of ``job_steps`` — a checkpoint, and the job's readable progress ledger."""

    job_id: str
    step_name: str
    step_index: int
    state: StepState
    attempt: int
    result: Any
    error: str | None
    started_at: str
    finished_at: str | None


def backoff_delay(
    attempt: int,
    *,
    base: float = DEFAULT_BACKOFF_BASE_SECONDS,
    factor: float = DEFAULT_BACKOFF_FACTOR,
    cap: float = DEFAULT_BACKOFF_CAP_SECONDS,
) -> float:
    """Seconds to wait before retrying, after ``attempt`` has just failed (1-based).

    Exponential and capped. Deliberately WITHOUT jitter: this runner claims one job at a
    time from a single-writer SQLite file, so there is no thundering herd to smear, and a
    deterministic curve is one a test can assert on rather than sample.
    """
    if attempt < 1:
        raise ValueError(f"attempt must be >= 1, got {attempt}")
    return min(cap, base * (factor ** (attempt - 1)))
