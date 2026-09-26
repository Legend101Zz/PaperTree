"""The library as the web sees it (contracts.md §2.2): `LibraryPaper`, `JobSummary`, `JobStatus`,
and which parse job an upload, a retry or a re-parse gets.

`papertree_db.library` reads the rows; this module DERIVES what the contract says is derived:

    processing   the promoted generation decides first: `ready`, or `partial` when its
                 `papers.status` is `partial` — even while a re-parse runs (§2.2: the paper
                 "stays `ready`, and `job` shows the re-parse"). With nothing promoted, the
                 latest parse job decides: pending -> `queued`, running -> `reading`, any other
                 end -> `failed`. No job at all yet (the instant between an upload's
                 registration and its enqueue) is `queued`.
    title        `metadata.title.value` of the promoted generation, else the original filename
                 without `.pdf`, else the paper id (§2.2: `/Title` was empty in 4 of 4 papers);
                 on one line (YOLO's title block carries its own line break).
    job.step     the step it is in (running) or stopped at (dead-lettered); null otherwise.
    job.done     committed steps (all three once it succeeded); `job.total` is three.
    error_code   the code of `jobs.error` (`[code] message`, `papertree_jobs.JobFailed`); an
                 uncoded error (a pre-S1 row) is `internal`. The text itself never leaves the DB
                 and the worker's log.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final, cast, get_args

from papertree_db import LibraryRow, OwnerId, PaperId, PaperTreeDb
from papertree_document_worker.job import PARSE_KIND, PARSE_STEPS, enqueue_parse, payload_generation
from papertree_jobs import Job, JobStore, StepRecord, error_code

from .schemas import (
    JobErrorCode,
    JobState,
    JobStatus,
    JobStepName,
    JobStepStatus,
    JobSummary,
    LibraryPaper,
    Processing,
)

_ERROR_CODES: Final = frozenset(get_args(JobErrorCode))
_STEP_NAMES: Final = frozenset(get_args(JobStepName))
#: A parse job still running or waiting to: a re-parse now would be a second parse of one paper.
BUSY_STATES: Final = frozenset({"pending", "running"})


def job_error_code(error: str | None) -> JobErrorCode | None:
    if error is None:
        return None
    code = error_code(error)
    return cast(JobErrorCode, code) if code in _ERROR_CODES else "internal"


def processing(row: LibraryRow) -> Processing:
    if row.generation is not None:
        return "partial" if row.paper_status == "partial" else "ready"
    if row.job_state in (None, "pending"):
        return "queued"
    if row.job_state == "running":
        return "reading"
    # dead_letter; cancelled (nothing in this release cancels a parse); or a job that succeeded
    # with nothing promoted, which the three-step job cannot do (promote is its last step) and a
    # pre-S1 row could: in every case the paper cannot be read, and a re-parse is the way out.
    return "failed"


def _one_line(text: str | None) -> str:
    """A title block's own line breaks and runs of spaces, as one line (a card shows one). The
    characters are kept as parsed, ligatures included."""
    return " ".join((text or "").split())


def title_for(row: LibraryRow) -> str:
    title = _one_line(row.title)
    if title:
        return title
    name = _one_line(row.original_filename)
    if name.lower().endswith(".pdf"):
        name = name[:-4].rstrip()
    return name or row.paper_id


def _step(row: LibraryRow) -> JobStepName | None:
    if row.job_state == "running":
        if row.job_open_step in _STEP_NAMES:
            return cast(JobStepName, row.job_open_step)
        # Claimed, and its next step has not written its row yet.
        return PARSE_STEPS[min(row.job_steps_done, len(PARSE_STEPS) - 1)]
    if row.job_state == "dead_letter" and row.job_open_step in _STEP_NAMES:
        return cast(JobStepName, row.job_open_step)
    return None


def job_summary(row: LibraryRow) -> JobSummary | None:
    if row.latest_job_id is None or row.job_state is None:
        return None
    total = len(PARSE_STEPS)
    done = total if row.job_state == "succeeded" else min(row.job_steps_done, total)
    return JobSummary(
        job_id=row.latest_job_id,
        kind="parse",
        state=cast(JobState, row.job_state),
        step=_step(row),
        done=done,
        total=total,
        attempt=row.job_attempt or 0,
        max_attempts=row.job_max_attempts or 0,
        error_code=job_error_code(row.job_error),
    )


def _instant(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("z", "Z"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _updated_at(row: LibraryRow) -> str:
    """The latest of the upload, the job's last write and the promotion, as stored (the wire model
    formats it)."""
    candidates: list[tuple[datetime, str]] = []
    for value in (row.created_at, row.job_updated_at, row.promoted_at):
        instant = _instant(value)
        if value is not None and instant is not None:
            candidates.append((instant, value))
    return max(candidates)[1] if candidates else row.created_at


def library_paper(row: LibraryRow) -> LibraryPaper:
    return LibraryPaper(
        paper_id=row.paper_id,
        title=title_for(row),
        authors=list(row.authors),
        original_filename=row.original_filename,
        source_hash=row.source_hash,
        page_count=row.page_count,
        processing=processing(row),
        job=job_summary(row),
        generation=row.generation,
        parser_version=row.parser_version,
        highlight_count=row.highlight_count,
        created_at=row.created_at,
        updated_at=_updated_at(row),
    )


def job_status(job: Job, steps: list[StepRecord]) -> JobStatus:
    """`GET /jobs/{job_id}`: the pre-release shape, plus `error_code`, minus the raw `error`.
    `owner_id` is on the Job dataclass and is DELIBERATELY not here (#74)."""
    return JobStatus(
        job_id=job.job_id,
        kind="parse",
        state=job.state,
        attempt=job.attempt,
        max_attempts=job.max_attempts,
        progress_done=job.progress_done,
        progress_total=job.progress_total,
        progress_note=job.progress_note,
        error_code=job_error_code(job.error),
        is_terminal=job.is_terminal,
        created_at=job.created_at,
        updated_at=job.updated_at,
        steps=[
            JobStepStatus(
                name=cast(JobStepName, step.step_name), index=step.step_index, state=step.state
            )
            for step in steps
            if step.step_name in _STEP_NAMES
        ],
    )


# ── which job an upload / a retry / a re-parse gets ──────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Enqueued:
    job_id: str
    #: None when an existing job was handed back rather than one enqueued.
    generation: int | None
    #: False when an existing job was returned (the same bytes, a job still live or finished).
    created: bool


def parse_jobs(store: JobStore, owner: OwnerId, paper_id: str) -> list[Job]:
    """Every parse job of one paper, newest first."""
    return store.list_jobs(owner, kind=PARSE_KIND, payload={"paper_id": paper_id})


def enqueue(
    store: JobStore,
    owner: OwnerId,
    *,
    paper_id: str,
    source_path: str,
    source_hash: str,
    generation: int,
    attempt_seq: int,
) -> Enqueued:
    before = {job.job_id for job in parse_jobs(store, owner, paper_id)}
    job_id = enqueue_parse(
        store,
        owner,
        paper_id=paper_id,
        source_path=source_path,
        source_hash=source_hash,
        generation=generation,
        attempt_seq=attempt_seq,
    )
    return Enqueued(job_id=job_id, generation=generation, created=job_id not in before)


def next_attempt(job: Job) -> tuple[int, int]:
    """`(generation, attempt_seq)` for another try at the generation `job` failed to parse."""
    gen, attempt_seq = payload_generation(job.payload)
    return gen, attempt_seq + 1


def plan_upload(
    db: PaperTreeDb, db_owner: OwnerId, latest: Job | None, paper_id: str
) -> tuple[int, int] | None:
    """For an upload of bytes that are this paper: the `(generation, attempt_seq)` of the job to
    create, or None to hand back `latest`.

    §2.2: "If the latest job for these bytes is `dead_letter`, a **new** job is created." A job
    that is queued, reading or done is the answer to this upload too (`created: false`). Cancelled
    is treated as dead-lettered: it will not produce a generation either.
    """
    if latest is None:
        return db.next_generation(db_owner, PaperId(paper_id)), 1
    if latest.state in ("dead_letter", "cancelled"):
        return next_attempt(latest)
    return None
