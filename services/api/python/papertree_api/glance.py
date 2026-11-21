"""The spread's "At a glance" sheet (v0.3 #337; design V3-AI-NOTES §5).

ONE Flash run per paper, started in the background when the paper is added, cached, and read back
by `GET /papers/{id}/glance`.

    GET /papers  (a ready paper with no sheet) ──▶ start_glance_run ──▶ (returns now)
    GET /papers/{id}/glance                    ──▶     │
                                                       └─ background task: POST /v1/runs
                                                          ──▶ agent ──▶ ai_runs row + paper_glance

WHY IN THE BACKGROUND, AND WHY THE SAME SHAPE AS `topic_run`. The model reads a digest of about
6,000 tokens and writes a sheet of about 400 words, which takes up to a minute. Nothing waits for
it: the run is a task the app owns (`GlanceRunDeps.tasks`), it has its own database connection, it
settles its `ai_runs` row on every ending, and the first read says `making`. The row is written
(with the guard and the cap check, no `await` between them) BEFORE the task starts, so a paper that
has one is not asked again: one call per paper and generation, except after `agent_unavailable` or
`aborted` (nothing known to be spent). Single-process guard, like the topic's.

NOTHING IS A GATE. Not configured, the daily cap, a bad answer and a failed request all mean "no
sheet": the spread shows the abstract alone. The cap is the same one every run keeps
(`agent_client.require_budget`, which counts this kind's in-flight reserve too).

THE SHEET. The model's one JSON object is checked twice, by the agent (zod, `services/agent/src/
glance.ts`) and here (`parse_answer`, the authority): change the rules in both. The caps are the
design's. A text over its cap is TRIMMED to it on a word boundary (a `$…$` maths span counts as part
of one word and is never cut), a list over its cap is cut, and a missing or extra key, a value or a
term over its bound, fewer than five terms, or a cite that is not a handle is no answer. What is
STORED is never the model's raw text: it is the sheet with every cap applied and every block's cited
handle resolved to the PAGE it is on (the `p. 3 ›` link). A handle the run was not given resolves to
no page, so the block has no link: a model cannot point the reader at a page it invented.
"""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final

from papertree_db import LibraryRow, PaperId, PaperTreeDb, new_id
from papertree_db.ai import normalise_time
from papertree_prompts import mint_datamark
from papertree_retrieval import PaperIndexCache
from pydantic import (
    BaseModel,
    ConfigDict,
    StrictStr,
    ValidationError,
    field_validator,
    model_validator,
)

from . import agent_client as runs
from . import evidence
from .deps import Caller
from .errors import ApiError
from .logging import log_event, user_ref
from .schemas import AgentDone, AgentPaper, AgentRunRequest, AgentToolAccess
from .settings import Settings
from .topic_run import REFUSED, RETRY_AFTER, RETRY_COOLDOWN_SECONDS, RunOutcome, ask_run

#: The design's caps (V3-AI-NOTES §5), in WORDS unless said. The agent's `glance.ts` says the same.
GIST_WORDS: Final = 20
BLOCK_WORDS: Final = 30
READ_FIRST_WORDS: Final = 30
MEASURES_WORDS: Final = 8
VALUE_CHARS: Final = 12
MAX_NUMBERS: Final = 2
TERM_CHARS: Final = 40
GLOSS_WORDS: Final = 14
WORDS_COUNT: Final = 5

#: The fixed `question` of a glance run (the agent's `GLANCE_QUESTION`).
QUESTION: Final = "Write this paper's at-a-glance sheet."
#: The log line of a failed glance run (`topic_run.ask_run` writes it).
LOG_EVENT: Final = "run.glance_failed"
#: At most this many papers are started by ONE read of the library (a library added before this
#: existed is caught up a couple at a time, never as a burst).
STARTS_PER_LIBRARY_READ: Final = 2

_WHITESPACE: Final = re.compile(r"\s+")
_WORD: Final = re.compile(r"(?:\$[^$\n]+\$|[^\s$]|\$)+")
_TRAILING: Final = re.compile(r"[,;:\s]+$")
_SENTENCE_END: Final = re.compile(r"[.!?]$")
_FENCE: Final = re.compile(r"^```[a-zA-Z]*\s*([\s\S]*?)\s*```$")
_HANDLE: Final = re.compile(r"^b[0-9]+$")


def word_count(text: str) -> int:
    """How many words `text` has, a `$…$` maths span counting as part of one word.

    Args:
        text: Any string.

    Returns:
        The count.
    """
    return len(_WORD.findall(text))


def trim_words(text: str, limit: int) -> str:
    """`text` with whitespace collapsed and, past `limit` words, cut after the last that fits.

    A cut text ends in "…" (a trailing comma, semicolon or colon goes first; a text that ends a
    sentence where it is cut keeps its full stop and gets no ellipsis). A maths span is never cut:
    it is part of one word.

    Args:
        text: The model's text.
        limit: The cap, in words.

    Returns:
        The text; the collapsed string itself when it fits.
    """
    flat = _WHITESPACE.sub(" ", text).strip()
    matches = list(_WORD.finditer(flat))
    if len(matches) <= limit:
        return flat
    if limit < 1:
        return ""
    cut = _TRAILING.sub("", flat[: matches[limit - 1].end()])
    return cut if _SENTENCE_END.search(cut) else f"{cut}…"


def _words(value: str, limit: int) -> str:
    """`value` trimmed to `limit` words; a text with no words in it is no answer."""
    trimmed = trim_words(value, limit)
    if not trimmed:
        raise ValueError("some words")
    return trimmed


def _handle(value: str | None) -> str | None:
    if value is not None and not _HANDLE.match(value):
        raise ValueError("a handle like b3")
    return value


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class _Block(_Strict):
    text: StrictStr
    cite: StrictStr | None  # required, nullable: "no passage says this" is said, not implied

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return _words(value, BLOCK_WORDS)

    @field_validator("cite")
    @classmethod
    def _cite(cls, value: str | None) -> str | None:
        return _handle(value)


class _Number(_Strict):
    value: StrictStr
    measures: StrictStr

    @field_validator("value")
    @classmethod
    def _value(cls, value: str) -> str:
        flat = _WHITESPACE.sub(" ", value).strip()
        if not flat or len(flat) > VALUE_CHARS:
            raise ValueError(f"a value of 1 to {VALUE_CHARS} characters")
        return flat

    @field_validator("measures")
    @classmethod
    def _measures(cls, value: str) -> str:
        return _words(value, MEASURES_WORDS)


class _Term(_Strict):
    term: StrictStr
    gloss: StrictStr

    @field_validator("term")
    @classmethod
    def _term(cls, value: str) -> str:
        flat = _WHITESPACE.sub(" ", value).strip()
        if not flat or len(flat) > TERM_CHARS:
            raise ValueError(f"a term of 1 to {TERM_CHARS} characters")
        return flat

    @field_validator("gloss")
    @classmethod
    def _gloss(cls, value: str) -> str:
        return _words(value, GLOSS_WORDS)


class _Results(_Strict):
    numbers: list[_Number]
    note: StrictStr | None
    cite: StrictStr | None

    @field_validator("numbers")
    @classmethod
    def _numbers(cls, value: list[_Number]) -> list[_Number]:
        return value[:MAX_NUMBERS]  # the model orders them by importance

    @field_validator("note")
    @classmethod
    def _note(cls, value: str | None) -> str | None:
        return None if value is None else _words(value, BLOCK_WORDS)

    @field_validator("cite")
    @classmethod
    def _cite(cls, value: str | None) -> str | None:
        return _handle(value)

    @model_validator(mode="after")
    def _says_something(self) -> _Results:
        if not self.numbers and self.note is None:
            raise ValueError("a number or a note")
        return self


class GlanceAnswer(_Strict):
    """The model's one JSON object. Strict: a missing or extra key or a wrong type is no answer."""

    gist: StrictStr
    problem: _Block
    idea: _Block
    how: _Block
    results: _Results
    limits: _Block
    read_first: StrictStr
    words: list[_Term]

    @field_validator("gist")
    @classmethod
    def _gist(cls, value: str) -> str:
        return _words(value, GIST_WORDS)

    @field_validator("read_first")
    @classmethod
    def _read_first(cls, value: str) -> str:
        return _words(value, READ_FIRST_WORDS)

    @field_validator("words")
    @classmethod
    def _terms(cls, value: list[_Term]) -> list[_Term]:
        if len(value) < WORDS_COUNT:
            raise ValueError(f"{WORDS_COUNT} terms")
        return value[:WORDS_COUNT]


def parse_answer(text: str) -> GlanceAnswer | None:
    """The model's final text as a sheet, every cap applied.

    Args:
        text: The agent's `done.final_text` (one JSON object, perhaps in a Markdown fence).

    Returns:
        The answer, or None when the text is not exactly the sheet's shape: not one JSON object, a
        key missing or extra, a text empty, a value or term over its bound, fewer than five terms,
        Results with neither a number nor a note, a `cite` that is not a handle or null.
    """
    fenced = _FENCE.match(text.strip())
    try:
        return GlanceAnswer.model_validate_json((fenced.group(1) if fenced else text).strip())
    except (ValidationError, ValueError):
        return None


def sheet_content(answer: GlanceAnswer, pages: dict[str, int]) -> dict[str, Any]:
    """The sheet as it is stored and served (`schemas.Glance` without `model` and `generation`).

    Args:
        answer: A validated answer.
        pages: `handle -> page` (1-based) for the handles the run was given. A cite not in it (a
            handle the model invented, or a block the parse no longer has) has no page.

    Returns:
        The content dict: every block has `page`, the page its cited passage is on, or None.
    """

    def block(item: _Block) -> dict[str, Any]:
        return {"text": item.text, "page": pages.get(item.cite) if item.cite else None}

    results = answer.results
    return {
        "gist": answer.gist,
        "problem": block(answer.problem),
        "idea": block(answer.idea),
        "how": block(answer.how),
        "results": {
            "numbers": [{"value": n.value, "measures": n.measures} for n in results.numbers],
            "note": results.note,
            "page": pages.get(results.cite) if results.cite else None,
        },
        "limits": block(answer.limits),
        "read_first": answer.read_first,
        "words": [{"term": w.term, "gloss": w.gloss} for w in answer.words],
    }


def page_map(db: PaperTreeDb, owner: Any, run_id: str, index: Any | None) -> dict[str, int]:
    """`handle -> page` (1-based) for every handle the run was issued.

    Args:
        db: The data layer.
        owner: The run's owner.
        run_id: The glance run.
        index: The paper's `PaperIndex`, or None when it cannot be loaded (then no block links).

    Returns:
        The map; a handle whose block is not in the index is left out.
    """
    if index is None:
        return {}
    pages: dict[str, int] = {}
    for handle, block_id in db.run_handles(owner, run_id).items():
        block = index.block(block_id)
        if block is not None:
            pages[handle] = block.page_index + 1
    return pages


# ── starting the run ─────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class GlanceRunDeps:
    """What a glance run needs beyond the caller.

    `tasks` is the app's set of background runs (held so the event loop keeps them alive); the
    topic run's set is the same one.
    """

    settings: Settings
    client: runs.AgentClient
    index_cache: PaperIndexCache
    tasks: set[asyncio.Task[None]]


def may_run(call: Caller, paper_id: str, generation: int) -> bool:
    """Whether the paper's sheet may be asked for now.

    Yes if it never was; if the last try never started (`agent_unavailable`, after a cooldown) or
    was cut off (`aborted`: a shutdown, nothing known of the spend); or if a run is `running` but
    past its expiry. Everything else is final: one call per paper and generation.
    """
    latest = call.db.latest_run(
        call.db_owner, PaperId(paper_id), kind="glance", generation=generation
    )
    if latest is None:
        return True
    if latest["status"] == "running":
        return normalise_time(latest["expires_at"]) <= normalise_time(datetime.now(UTC))
    if latest["status"] == "aborted":
        return True
    if latest["status"] != "error" or latest["error_code"] == REFUSED:
        return False
    if latest["error_code"] not in RETRY_AFTER:
        return False
    ended = datetime.fromisoformat(normalise_time(latest["finished_at"] or latest["started_at"]))
    return (datetime.now(UTC) - ended).total_seconds() >= RETRY_COOLDOWN_SECONDS


def is_making(call: Caller, paper_id: str, generation: int) -> bool:
    """Whether a glance run of this paper and generation is running now, and not past its expiry."""
    latest = call.db.latest_run(
        call.db_owner, PaperId(paper_id), kind="glance", generation=generation
    )
    return (
        latest is not None
        and latest["status"] == "running"
        and normalise_time(latest["expires_at"]) > normalise_time(datetime.now(UTC))
    )


def start_glance_run(call: Caller, row: LibraryRow, deps: GlanceRunDeps) -> bool:
    """Starts the paper's one glance run in the BACKGROUND; True when one was started.

    Nothing here waits for the model. The guard (`may_run`), the cap, the request, the handles and
    the `ai_runs` row are all done here with no `await` between them, so concurrent first reads in
    this process start one run. Any failure here is "no sheet", never an error to the person.

    Args:
        call: The authenticated request (owner isolation: the run is the caller's).
        row: The paper's library row; it must have a promoted generation.
        deps: Settings, agent client, index cache and the task set.

    Returns:
        Whether a run was started (not configured, no cached sheet need, the daily cap, a run made
        or in flight, and any failure to prepare it all give False).
    """
    settings, db, owner = deps.settings, call.db, call.db_owner
    if not settings.agent_secret or row.generation is None:
        return False
    generation = row.generation
    if db.get_glance(owner, PaperId(row.paper_id), generation, runs.PROMPT_VERSIONS["glance"]):
        return False
    if not may_run(call, row.paper_id, generation):
        return False
    try:
        runs.require_budget(db, owner, settings)
    except ApiError:
        return False  # the cap applies to this run too: no sheet, never an error
    run_id: str | None = None
    try:
        index = evidence.load_index(
            deps.index_cache, db, owner, call.user_id, row.paper_id, generation
        )
        run_id, datamark = new_id("run"), mint_datamark()
        token, token_sha256 = runs.mint_run_token()
        plan = evidence.plan_digest(index, datamark=datamark)
        with db.transaction():
            db.create_run(
                owner,
                run_id=run_id,
                paper_id=PaperId(row.paper_id),
                generation=generation,
                kind="glance",
                thread_id=None,
                message_id=None,
                token_sha256=token_sha256,
                datamark=datamark,
                expires_at=runs.token_expiry("glance"),
                code_path=runs.CODE_PATHS["glance"],
                request_id=None,
                prompt_version=runs.PROMPT_VERSIONS["glance"],
            )
            handles = db.assign_run_handles(owner, run_id, generation, plan.block_ids)
        body = AgentRunRequest(
            run_id=run_id,
            request_id=new_id("req"),
            kind="glance",
            prompt_version=runs.PROMPT_VERSIONS["glance"],
            tool=AgentToolAccess(
                base_url=f"{settings.api_internal_url}/internal/agent/runs/{run_id}", token=token
            ),
            datamark=datamark,
            paper=AgentPaper(
                title=runs.paper_title(db, owner, row.paper_id, generation),
                page_count=row.page_count,
                generation=generation,
            ),
            seed=plan.to_wire(handles),
            question=QUESTION,
            history=None,
            limits=runs.LIMITS["glance"],
        )
    except KeyError:
        return False  # the parse is not in the index (yet): nothing was written
    except Exception as exc:
        log_event(LOG_EVENT, level="error", paper_id=row.paper_id, error_type=type(exc).__name__)
        # A run row written before the failure must not stay `running` for its expiry.
        _end_if_started(db, owner, run_id)
        return False
    log_event(
        "run.start",
        run_id=body.run_id,
        paper_id=row.paper_id,
        user_ref=user_ref(call.user_id),
        kind="glance",
        code_path=runs.CODE_PATHS["glance"],
        provider=runs.PROVIDER,
    )
    task = asyncio.get_running_loop().create_task(
        _settle(deps, call.user_id, row.paper_id, generation, body, time.monotonic())
    )
    deps.tasks.add(task)
    task.add_done_callback(deps.tasks.discard)
    return True


def _end_if_started(db: PaperTreeDb, owner: Any, run_id: str | None) -> None:
    if run_id is not None:
        db.finish_run(owner, run_id, status="error", error_code="internal", latency_ms=0)


async def _settle(
    deps: GlanceRunDeps,
    user_id: str,
    paper_id: str,
    generation: int,
    body: AgentRunRequest,
    started: float,
) -> None:
    """The background half: asks the agent, settles the run row, stores the sheet.

    Runs on its own database connection (the request's is closed by now). A cancellation (the
    server stopping) settles the row `aborted` and is re-raised; any other failure settles it
    `error`/`internal`. Either way the row is never left `running`.
    """
    db = PaperTreeDb(deps.settings.database_file)
    owner = db.owner_for(user_id)

    def elapsed() -> int:
        return max(0, int((time.monotonic() - started) * 1000))

    try:
        outcome = await ask_run(deps.client, body, event=LOG_EVENT)
        _record(db, owner, deps, user_id, paper_id, generation, body, outcome, elapsed())
    except asyncio.CancelledError:
        db.finish_run(
            owner, body.run_id, status="aborted", error_code="aborted", latency_ms=elapsed()
        )
        raise
    except Exception as exc:  # a sheet is a convenience: whatever breaks, the person sees none
        log_event(LOG_EVENT, level="error", run_id=body.run_id, error_type=type(exc).__name__)
        db.finish_run(
            owner, body.run_id, status="error", error_code="internal", latency_ms=elapsed()
        )
    finally:
        db.close()


def _record(
    db: PaperTreeDb,
    owner: Any,
    deps: GlanceRunDeps,
    user_id: str,
    paper_id: str,
    generation: int,
    body: AgentRunRequest,
    outcome: RunOutcome,
    latency_ms: int,
) -> None:
    """Settles the run row with its usage and stores the sheet if the answer validates."""
    done: AgentDone | None = outcome.done
    if done is None:
        db.finish_run(
            owner, body.run_id, status="error", error_code=outcome.code, latency_ms=latency_ms
        )
        return
    answer = parse_answer(done.final_text) if done.status == "complete" else None
    stored = False
    model = outcome.model or runs.MODEL
    if answer is not None:
        try:
            index = evidence.load_index(deps.index_cache, db, owner, user_id, paper_id, generation)
        except KeyError:
            index = None
        content = sheet_content(answer, page_map(db, owner, body.run_id, index))
        db.put_glance(
            owner,
            PaperId(paper_id),
            generation,
            runs.PROMPT_VERSIONS["glance"],
            model=model,
            content=content,
            run_id=body.run_id,
        )
        stored = True
    totals = done.usage_totals
    error = None if stored else (done.error.code if done.error else "internal")
    db.finish_run(
        owner,
        body.run_id,
        status="done" if stored else "error",
        provider=runs.PROVIDER,
        model=outcome.model,
        agent_sdk=None,
        stop_reason=done.stop_reason,
        error_code=error,
        retries=done.retries,
        tool_calls=done.tool_calls,
        latency_ms=latency_ms,
        input_tokens=totals.input,
        output_tokens=totals.output,
        cache_read_tokens=totals.cache_read,
        cache_write_tokens=totals.cache_write,
        reasoning_tokens=totals.reasoning,
        cost_usd_est=totals.cost_usd_est,
    )
    log_event(
        "run.done",
        run_id=body.run_id,
        paper_id=paper_id,
        kind="glance",
        provider=runs.PROVIDER,
        model=outcome.model,
        input_tokens=totals.input,
        output_tokens=totals.output,
        cost_usd_est=totals.cost_usd_est,
        error_code=error,
    )


# ── reading it ───────────────────────────────────────────────────────────────────────────────


def glance_status(call: Caller, row: LibraryRow, deps: GlanceRunDeps) -> dict[str, Any]:
    """The paper's sheet state, starting the run when there is no sheet and none is coming.

    Args:
        call: The authenticated request.
        row: The paper's library row.
        deps: Settings, agent client, index cache and the task set.

    Returns:
        `{state, glance}` (`schemas.GlanceStatus`): `ready` with the sheet; `making` when a run is
        in flight (or was just started); `none` when there is no sheet and none is coming.
    """
    generation = row.generation
    if generation is None:
        return {"state": "none", "glance": None}
    runs.sweep_orphans(call.db)
    cached = call.db.get_glance(
        call.db_owner, PaperId(row.paper_id), generation, runs.PROMPT_VERSIONS["glance"]
    )
    if cached is not None:
        return {
            "state": "ready",
            "glance": {**cached["content"], "model": cached["model"], "generation": generation},
        }
    if is_making(call, row.paper_id, generation) or start_glance_run(call, row, deps):
        return {"state": "making", "glance": None}
    return {"state": "none", "glance": None}


def start_missing(call: Caller, rows: list[LibraryRow], deps: GlanceRunDeps) -> int:
    """Starts the sheets a library read finds missing, at most `STARTS_PER_LIBRARY_READ` of them.

    A paper that has just been read in is caught by the next library read, which the library page
    makes while a paper is still being read; so a sheet is made when the paper is ADDED, before
    anyone opens its book.

    Args:
        call: The authenticated request.
        rows: The caller's library rows, newest first.
        deps: Settings, agent client, index cache and the task set.

    Returns:
        How many runs were started.
    """
    if not deps.settings.agent_secret:
        return 0
    started = 0
    for row in rows:
        if started >= STARTS_PER_LIBRARY_READ:
            break
        if row.generation is None or row.paper_status is None:
            continue
        if start_glance_run(call, row, deps):
            started += 1
    return started
