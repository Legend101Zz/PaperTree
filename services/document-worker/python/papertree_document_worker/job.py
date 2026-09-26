"""The parse as a DURABLE, RESUMABLE job: ``parse`` -> ``persist`` -> ``promote`` (contracts §2.2).

findings.md C1 is the defect this module exists for: generation ran **inside the HTTP request**,
and findings.md H2 measured even the deterministic path at ~10 s for a 75-page paper. So the upload
route enqueues, and a worker runs this handler.

THE JOB CONTRACT (contracts.md §2.2, "Worker job contract")

    payload   {paper_id, source_path, source_hash, generation, attempt_seq}
    key       parse:{source_hash}:{paper_id}:g{generation}:a{attempt_seq}
    steps     parse    the PDF -> a validated PaperIR document, staged as JSON on disk
              persist  the staged document -> the database, as generation N
              promote  generation N becomes the one readers get, if the STORED N validates;
                       then the staged JSON is deleted (it grew forever before: §R17)

Each step is a ``ctx.step``: its body runs ONCE PER JOB, EVER, and a worker killed between two
steps resumes at the next one (``packages/jobs``). That is what makes promotion durable: before the
reader release it ran in the worker LOOP after the job had already finished, so a worker killed
there left a parsed, stored, succeeded paper that nobody could open, and nothing would ever retry
it. It is a step now, so a restart finishes it.

WHAT MAKES EACH STEP SAFE TO RE-RUN, because a kill can land INSIDE a body too (after its side
effect committed, before its checkpoint did):

    parse    rewrites the same staging file and the same crops (deterministic parser, same bytes)
    persist  finds generation N already stored and keeps it (``put_paper`` is one transaction, so
             a stored N is a whole N)
    promote  ``promote_generation`` is an upsert; deleting a missing staging file is a no-op

THE WRITES ARE FENCED ON THE LEASE, INSIDE THEIR TRANSACTION. ``packages/jobs`` checks the lease
before and after a step body, never during it, so a body that was already running when its worker
lost the job (superseded after a stall, or its paper deleted: ``DELETE /papers/{id}`` removes the
paper's jobs first) would still write before the next check noticed. For persist that would be
worse than a duplicate: ``put_paper`` INSERTs a missing ``paper_owners`` row, so it would
RESURRECT a deleted paper. So persist and promote write inside a ``transaction()`` whose first
statement asks the job store whether this worker still holds the lease (``ctx.holds_lease``). The
``BEGIN IMMEDIATE`` holds the file's write lock, so no other process can take the job or delete it
between that answer and the commit, and a WAL read on the job store's connection sees every commit
before it.

ERROR CODES (``JobErrorCode``, contracts.md §2.2): a failure the parser cannot get past is raised
as ``JobFailed(code)`` and dead-letters on THAT attempt; retrying a PDF PyMuPDF cannot open spent
~11 s of backoff at base to reach the same answer (S1 report §1). A file PyMuPDF opens and then
cannot read (a page tree it cannot count, a user password) is ``pdf_unreadable`` too, once
``unreadable_reason`` has confirmed it is the file (S1 review MF1 / should-fix 2). ``timeout`` is
written by the job store itself (a worker that died on every attempt). Anything unclassified is
retried and reads as ``internal``.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from papertree_db import OwnerId, PaperId, PaperTreeDb, generation
from papertree_document_ir.validate import SemanticValidationError
from papertree_jobs import JobContext, JobFailed, JobObserver, JobRunner, JobStore, LeaseLost
from pydantic import ValidationError

from papertree_document_worker.assemble import PARSER_VERSION
from papertree_document_worker.pdf import pymupdf
from papertree_document_worker.pipeline import ParserConfig, parse_document

__all__ = [
    "ERROR_CODES",
    "PARSE_KIND",
    "PARSE_STEPS",
    "PARSER_VERSION",
    "ParseJobDeps",
    "StoredVerifier",
    "build_runner",
    "enqueue_parse",
    "make_parse_handler",
    "parse_idempotency_key",
    "payload_generation",
    "staging_path",
    "unreadable_reason",
]

#: The job kind. One string, used by the enqueuer and the runner registration alike.
PARSE_KIND: Final = "parse"
#: The steps, in order (contracts.md §2.2). ``LibraryPaper.job.total`` is their count.
PARSE_STEPS: Final = ("parse", "persist", "promote")
#: The codes a parse job's ``jobs.error`` can carry (``[code] message``), §2.2's ``error_code``.
ERROR_CODES: Final = ("pdf_unreadable", "validation_failed", "timeout", "internal")

#: Checks the STORED generation before it is promoted; raises if it is not servable. Given the
#: database, the owner handle minted on it, the paper and the generation.
StoredVerifier = Callable[[PaperTreeDb, OwnerId, PaperId, int], None]


@dataclass(slots=True)
class ParseJobDeps:
    """Everything the handler needs that is not in the payload.

    Passed in rather than imported, so a test can point the whole thing at a tmpdir and an
    in-memory database without monkeypatching.
    """

    database: PaperTreeDb
    #: Where rendered crops go. MUST be outside the repository - see crops.py.
    asset_root: Path
    #: Where the parsed document JSON is staged between the parse and persist steps.
    staging_root: Path
    config: ParserConfig | None = None
    #: The promote step's validation of what was STORED. The parse already validated the document
    #: it produced (``assert_valid_paper``); this checks what readers will actually be served,
    #: which is the stored rows recomposed. ``papertree_api.worker`` passes the ``/ir``
    #: recomposition plus the same validator. None: only the stored row's existence and its match
    #: with the parse's own summary are checked.
    verify_stored: StoredVerifier | None = None


def parse_idempotency_key(
    source_hash: str, paper_id: str, generation: int, attempt_seq: int
) -> str:
    """contracts.md §2.2: ``parse:{source_hash}:{paper_id}:g{generation}:a{attempt_seq}``.

    The generation and attempt are IN the key, which is what lets a dead-lettered upload be retried
    at all: with ``parse:{source_hash}:{paper_id}`` (before S1) the same bytes always mapped to the
    same job, so re-uploading a dead-lettered PDF handed back the dead job and nothing ever parsed
    it again (S1 report §1).
    """
    return f"{PARSE_KIND}:{source_hash}:{paper_id}:g{generation}:a{attempt_seq}"


def payload_generation(payload: Any) -> tuple[int, int]:
    """``(generation, attempt_seq)`` of a parse payload. A pre-S1 payload has neither: it parsed
    generation 1 (the worker's hard-coded value then), on its first attempt."""
    values: list[int] = []
    for key in ("generation", "attempt_seq"):
        value = payload.get(key, 1) if isinstance(payload, dict) else 1
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise JobFailed("internal", f"the job payload's {key} is not a positive integer")
        values.append(value)
    return values[0], values[1]


def staging_path(staging_root: Path, paper_id: str, generation: int, job_id: str) -> Path:
    """Where one job stages its document: per job, so a retry or a re-parse never reads another
    job's half-written file. ``DELETE /papers/{id}`` removes ``<paper_id>.*`` here."""
    return staging_root / f"{paper_id}.g{generation}.{job_id}.paperir.json"


def enqueue_parse(
    store: JobStore,
    owner: OwnerId,
    *,
    paper_id: str,
    source_path: str,
    source_hash: str,
    generation: int = 1,
    attempt_seq: int = 1,
) -> str:
    """Enqueue one parse, idempotently (``parse_idempotency_key``).

    `owner` MUST come from `JobStore.owner_for()`, not from `PaperTreeDb.owner_for()`. An
    `OwnerId` is an opaque PER-CONNECTION handle, so a handle minted by a `PaperTreeDb` is
    rejected by a `JobStore` even when both are open on the same file:

        OwnershipError: that value was not minted by this JobStore.

    The handler bridges the two sides through `ctx.owner_id`, a bare string it re-authenticates
    against the database with `PaperTreeDb.owner_for()`; the payload never carries an owner.
    `JobStore.enqueue` reads the unique index inside the same IMMEDIATE transaction as the insert,
    so two concurrent enqueues of one key produce one job rather than a race.
    """
    return store.enqueue(
        owner,
        PARSE_KIND,
        parse_idempotency_key(source_hash, paper_id, generation, attempt_seq),
        {
            "paper_id": paper_id,
            "source_path": source_path,
            "source_hash": source_hash,
            "generation": generation,
            "attempt_seq": attempt_seq,
        },
    )


def _describe(exc: BaseException) -> str:
    text = str(exc).strip() or "(no message)"
    return f"{type(exc).__name__}: {text}"[:2000]


def unreadable_reason(source_path: str) -> str | None:
    """Why PyMuPDF cannot READ this file at all, or None when it can (or when that cannot be told).

    Asked only after the parse raised something unclassified, so the happy path never pays for a
    second open. PyMuPDF refuses some files only AFTER opening them, with a bare built-in error the
    parser cannot tell from its own bugs (S1 review MF1 and should-fix 2, probe in the report):

        a page tree it cannot walk   page_count -> RuntimeError('code=7: Invalid number of pages')
        a USER-password PDF          needs_pass 1; any page -> ValueError('document closed or ...')

    Both are the bytes, not the parser: every attempt fails the same way, so they are
    `pdf_unreadable` on attempt 1. A file that opens, needs no password and counts its pages is
    readable, and whatever the parser raised on it stays `internal` (retried): a parser bug must
    never be reported to the user as their file's fault. The file is opened the way
    `SourceDocument` opens it (the bytes, as a stream).
    """
    try:
        data = Path(source_path).read_bytes()
    except OSError:
        return None  # not a statement about the PDF; the parser's own error stands
    try:
        document = pymupdf.open(stream=data, filetype="pdf")
    except (RuntimeError, ValueError) as exc:
        return _describe(exc)
    try:
        if document.needs_pass:
            return "the PDF needs a password to open"
        int(document.page_count)
    except (RuntimeError, ValueError) as exc:
        return _describe(exc)
    finally:
        document.close()
    return None


def _write_atomically(path: Path, text: str) -> None:
    """Staged JSON is written whole or not at all: a worker killed mid-write must not leave a
    truncated document for the resumed persist step to choke on."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".tmp")
    partial.write_text(text, encoding="utf-8")
    os.replace(partial, path)


def _fenced(ctx: JobContext) -> None:
    """Inside a ``transaction()``: refuse to write unless this worker still holds the job."""
    if not ctx.holds_lease():
        raise LeaseLost(f"job {ctx.job_id} was re-claimed or deleted; nothing written")


def make_parse_handler(deps: ParseJobDeps) -> Any:
    """Build the handler `JobRunner` will call. Three steps, each resumable."""

    def handle(ctx: JobContext) -> None:
        payload = ctx.payload
        paper_id = PaperId(str(payload["paper_id"]))
        source_path = str(payload["source_path"])
        gen, _attempt_seq = payload_generation(payload)
        staged = staging_path(deps.staging_root, paper_id, gen, ctx.job_id)
        total = len(PARSE_STEPS)

        def do_parse() -> dict[str, Any]:
            try:
                result = parse_document(
                    source_path,
                    paper_id=paper_id,
                    asset_root=deps.asset_root,
                    config=deps.config,
                    generation=gen,
                )
            except FileNotFoundError as exc:
                raise JobFailed(
                    "internal", f"the uploaded file is missing: {_describe(exc)}"
                ) from exc
            except (pymupdf.FileDataError, pymupdf.EmptyFileError) as exc:
                # PyMuPDF could not read the bytes. Deterministic: the same on every attempt.
                raise JobFailed("pdf_unreadable", _describe(exc)) from exc
            except (SemanticValidationError, ValidationError) as exc:
                # The parser produced a document the IR validator refuses. Also deterministic.
                raise JobFailed("validation_failed", _describe(exc)) from exc
            except Exception as exc:
                # Unclassified. Is it the FILE? (see `unreadable_reason`) Otherwise it is re-raised
                # as it was: retried with backoff, and `internal` if it never goes away.
                reason = unreadable_reason(source_path)
                if reason is None:
                    raise
                raised = _describe(exc)
                raise JobFailed(
                    "pdf_unreadable",
                    reason if reason == raised else f"{reason} (the parse raised {raised})",
                ) from exc
            # The DOCUMENT goes to disk; only a summary becomes the step result. A step result
            # is stored as JSON and handed back on resume, and a 3,000-block document is not a
            # checkpoint value - it is the output.
            _write_atomically(
                staged,
                json.dumps(
                    result.paper.model_dump(mode="json", by_alias=True, exclude_unset=True),
                    ensure_ascii=False,
                ),
            )
            return {
                "generation": gen,
                "blocks": len(result.paper.blocks),
                "pages": result.page_count,
                "status": result.paper.status,
                "crops": result.crops_written,
                "parser_version": result.paper.parser.version,
                "staged": staged.name,
            }

        summary = ctx.step("parse", do_parse)
        # Publishes progress AND renews the lease. Between steps, not only at the end: a parse
        # that outlives its lease is a job another worker takes over mid-flight.
        ctx.progress(1, total, f"parsed {summary['pages']} pages, {summary['blocks']} blocks")

        def do_persist() -> dict[str, Any]:
            # `owner_for` turns the job's bare owner_id string into a handle on THIS connection.
            # It performs NO authentication - it checks a users row exists - and the caller (the
            # route that enqueued) is the trust boundary, which is why the payload carries none.
            owner = deps.database.owner_for(ctx.owner_id)
            with deps.database.transaction():
                _fenced(ctx)
                stored = deps.database.get_paper(owner, paper_id, generation(gen))
                if stored is None:
                    try:
                        text = staged.read_text(encoding="utf-8")
                    except FileNotFoundError as exc:
                        raise JobFailed(
                            "internal",
                            f"the staged document {staged.name} is gone; retry to parse again",
                        ) from exc
                    document = json.loads(text)
                    deps.database.put_paper(owner, document)
                    outcome = "stored"
                else:
                    # A previous attempt's put_paper COMMITTED and it died before this step's
                    # checkpoint did. put_paper is one transaction, so what is there is whole.
                    outcome = "already stored"
            return {
                "paper_id": paper_id,
                "generation": gen,
                "parser_version": (stored or {}).get("parser_version", summary["parser_version"]),
                "outcome": outcome,
            }

        written = ctx.step("persist", do_persist)
        ctx.progress(2, total, f"stored {written['paper_id']} generation {written['generation']}")

        def do_promote() -> dict[str, Any]:
            owner = deps.database.owner_for(ctx.owner_id)
            stored = deps.database.get_paper(owner, paper_id, generation(gen))
            if stored is None:
                ctx.check_lease()  # a deleted paper takes its generations with it
                raise JobFailed("internal", f"generation {gen} of {paper_id} is not stored")
            # PROMOTE ONLY A VALIDATED GENERATION (contracts.md §2.2): what is checked is the
            # STORED generation, i.e. what `/ir` will serve, not only the document the parse held.
            if deps.verify_stored is not None:
                try:
                    deps.verify_stored(deps.database, owner, paper_id, gen)
                except Exception as exc:
                    raise JobFailed(
                        "validation_failed",
                        f"stored generation {gen} does not validate: {_describe(exc)}",
                    ) from exc
            # What THIS job stored must be what THIS job parsed. (A generation an earlier attempt
            # stored, "already stored", was that attempt's parse; the verifier above judges it.)
            blocks = deps.database.count_blocks(owner, paper_id, generation(gen))
            if written["outcome"] == "stored" and (
                stored["status"] != summary["status"] or blocks != summary["blocks"]
            ):
                raise JobFailed(
                    "validation_failed",
                    f"stored generation {gen} is not the parsed one: status {stored['status']} "
                    f"and {blocks} blocks, parsed {summary['status']} and {summary['blocks']}",
                )
            with deps.database.transaction():
                _fenced(ctx)
                current = deps.database.promoted_generation(owner, paper_id)
                # Never replace a NEWER promoted generation with an older one (a retry of an old
                # generation that finished after a re-parse did).
                promoted = current is None or current <= gen
                if promoted:
                    deps.database.promote_generation(owner, paper_id, generation(gen))
            staged.unlink(missing_ok=True)
            return {
                "paper_id": paper_id,
                "generation": gen,
                "parser_version": stored["parser_version"],
                "promoted": promoted,
                "kept": gen if promoted else current,
            }

        promoted = ctx.step("promote", do_promote)
        ctx.progress(
            3,
            total,
            f"generation {promoted['kept']} is the one readers get"
            + ("" if promoted["promoted"] else f" (generation {gen} is stored, not promoted)"),
        )

    return handle


def build_runner(
    store: JobStore,
    deps: ParseJobDeps,
    *,
    observer: JobObserver | None = None,
    lease_seconds: float | None = None,
) -> JobRunner:
    """A runner with the parse handler registered. `run_once()` returns None when idle."""
    handlers = {PARSE_KIND: make_parse_handler(deps)}
    if lease_seconds is None:
        return JobRunner(store, handlers, observer=observer)
    return JobRunner(store, handlers, observer=observer, lease_seconds=lease_seconds)
