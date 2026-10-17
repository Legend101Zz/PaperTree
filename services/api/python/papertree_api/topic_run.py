"""The topic suggestion model run (v0.2 S2b2, #242; GAP-A1 D2): ONE short Flash call per paper.

    GET /papers/{id}/topic ──▶ topic_suggestion.offer_topic ──▶ start_topic_run ──▶ (returns now)
                                                                   └─ background task: POST /v1/runs
                                                                      ──▶ agent ──▶ ai_runs row +
                                                                      the stored suggestion

WHY IN THE BACKGROUND. The model may take up to 40 s (30 s deadline + 10 s grace) when MiniMax
stalls, and the first topic read is the library's Table. So the first read answers `status: none`
at once and a task the app owns (`TopicRunDeps.tasks`) finishes the call and stores the offer; the
next read returns it. The task has its own database connection and settles its `ai_runs` row on
every ending, including a cancellation (`aborted`, retried later) and any crash (`internal`).

None of this is an error to the person: not configured, the daily cap, a bad answer, a failed
request are all "no suggestion", and a suggestion is an offer, never a shelving.

WHY IT IS ONE CALL PER PAPER, NOT PER READ. The `topic` run row is written (with the guard and the
cap check, no `await` between them) BEFORE the task starts, and a paper that has one is not asked
again (`may_run`), except after `agent_unavailable` / `aborted` (nothing known to be spent) or,
for a request the agent REFUSED (`bad_request`), once a topic has been created. This is a
single-process guard: a second API process would not see the row in time (v0.2 runs one).

The answer is checked twice, by the agent (zod, `services/agent/src/topic.ts`, which sees at most
the first topics) and here (`parse_answer`, on the person's full list); change the rules in both.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final

from papertree_db import LibraryRow, PaperId, PaperTreeDb, TopicRow, TopicSuggestion, new_id
from papertree_db.ai import normalise_time
from papertree_prompts import mint_datamark
from papertree_retrieval import PaperIndexCache
from pydantic import BaseModel, ConfigDict, StrictBool, StrictStr, ValidationError, field_validator

from . import agent_client as runs
from . import evidence
from .deps import Caller
from .errors import ApiError
from .logging import log_event, user_ref
from .schemas import (
    AgentDone,
    AgentPaper,
    AgentRun,
    AgentRunRequest,
    AgentSeed,
    AgentToolAccess,
)
from .settings import Settings

#: The longest topic name (papertree_db.TOPIC_NAME_MAX) and reason the model may write.
NAME_MAX: Final = 60
REASON_MAX: Final = 200
#: The abstract excerpt put in front of the model, in characters (a few hundred tokens).
ABSTRACT_MAX_CHARS: Final = 1200
#: At most this many of the person's topic names are shown to the model.
TOPICS_SHOWN: Final = 30
#: The longest `question` we build; the wire allows 2,000 (`AgentRunRequest.question`).
QUESTION_BUDGET: Final = 1900
#: The agent's deadline plus this is how long the API waits for the whole stream.
WAIT_GRACE_SECONDS: Final = 10.0
#: A run that ended with one of these may be tried again: the agent never started (nothing spent).
RETRY_AFTER: Final = frozenset({"agent_unavailable"})
#: ...but not sooner than this after the last try ended, so a down agent costs a row a minute.
RETRY_COOLDOWN_SECONDS: Final = 60.0
#: The agent refused the request itself: asked again only once the person's topics have changed.
REFUSED: Final = "bad_request"

_WHITESPACE: Final = re.compile(r"\s+")
_FENCE: Final = re.compile(r"^```[a-zA-Z]*\s*([\s\S]*?)\s*```$")


class TopicAnswer(BaseModel):
    """The model's one JSON object. Strict: a missing or extra key or a wrong type is no answer."""

    model_config = ConfigDict(extra="forbid", strict=True)

    topic_name: StrictStr
    is_new: StrictBool
    reason: StrictStr

    @field_validator("topic_name")
    @classmethod
    def _name(cls, value: str) -> str:
        name = _WHITESPACE.sub(" ", value).strip()
        if not name or len(name) > NAME_MAX:
            raise ValueError(f"a topic name of 1 to {NAME_MAX} characters")
        return name

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        reason = _WHITESPACE.sub(" ", value).strip()
        if not reason:
            raise ValueError("a reason")
        return reason[:REASON_MAX]


def parse_answer(text: str, topics: list[TopicRow], model_id: str) -> TopicSuggestion | None:
    """The model's final text as an offer, checked against the person's REAL topics.

    The agent has already checked the answer against the names it was shown; this is the
    authoritative check, on the full list.

    Args:
        text: The agent's `done.final_text` (one JSON object, perhaps in a Markdown fence).
        topics: Every topic the person has.
        model_id: The model that answered (stored as `source_detail`).

    Returns:
        A `source='model'` suggestion naming an existing topic (`is_new: false`, or a "new" name
        the person already has, which is that topic) or proposing a new name; None when the text is
        not exactly `{topic_name, is_new, reason}` or names a topic the person does not have while
        saying it is not new.
    """
    fenced = _FENCE.match(text.strip())
    try:
        answer = TopicAnswer.model_validate_json((fenced.group(1) if fenced else text).strip())
    except ValidationError:
        return None
    # Names are compared as the model was shown them (`clean_name`), not as stored.
    held = {clean_name(topic.name).casefold(): topic for topic in topics}
    match = held.get(clean_name(answer.topic_name).casefold())
    if match is not None:
        return TopicSuggestion(match.topic_id, None, "model", model_id)
    if not answer.is_new:
        return None
    return TopicSuggestion(None, answer.topic_name, "model", model_id)


def clean_name(name: str) -> str:
    """A topic name as the model is shown it: one line, no control or line/paragraph separators.

    The agent reads the topic list back from one line of `question` (`parseTopicInput`), so a
    U+2028 in a name would make it refuse the whole run. Same helper the repo uses for paper text
    outside the datamarked wrapper; also strips datamark look-alikes.
    """
    return evidence.header_text(name, limit=NAME_MAX)


def topic_question(category: str | None, topics: list[TopicRow]) -> str:
    """The run's `question`: the category and the person's topic names (the agent reads it back).

    The wire caps `question` at 2,000 characters and a name may be 60 characters with JSON
    escapes, so the list is TRIMMED deterministically: names in shelf order, at most
    `TOPICS_SHOWN`, stopping before the line would pass `QUESTION_BUDGET`. A topic not shown can
    still be the answer: `parse_answer` checks the person's full list.
    """
    head = f"Category: {category or 'none'}\nExisting topics: "
    names: list[str] = []
    for topic in topics[:TOPICS_SHOWN]:
        name = clean_name(topic.name)
        trial = json.dumps([*names, name], ensure_ascii=False, separators=(",", ":"))
        if len(head) + len(trial) > QUESTION_BUDGET:
            break
        names.append(name)
    return head + json.dumps(names, ensure_ascii=False, separators=(",", ":"))


def abstract_excerpt(index: Any) -> str:
    """The paper's abstract as one header-safe line, at most `ABSTRACT_MAX_CHARS` characters.

    Args:
        index: The paper's `PaperIndex`.

    Returns:
        The text of its `abstract` blocks in reading order; "" when the parse found none.
    """
    parts: list[str] = []
    for block_id in index.reading_order:
        block = index.block(block_id)
        if block is not None and block.type == "abstract" and block.text:
            parts.append(block.text)
    return evidence.header_text(" ".join(parts), limit=ABSTRACT_MAX_CHARS)


@dataclass(frozen=True, slots=True)
class TopicRunDeps:
    """What a topic run needs beyond the caller.

    `tasks` is the app's set of background topic runs (held so the event loop keeps them alive).
    """

    settings: Settings
    client: runs.AgentClient
    index_cache: PaperIndexCache
    tasks: set[asyncio.Task[None]]


def may_run(call: Caller, paper_id: str, topics: list[TopicRow]) -> bool:
    """Whether the paper may be asked about now.

    Yes if it never was; if the last try never started (`agent_unavailable`) or was cut off
    (`aborted`: a shutdown, nothing is known of the spend); if a run is `running` but past its
    expiry; or if the agent REFUSED the last request and a topic has been created since (the
    request would differ). Everything else is final: one call per paper.
    """
    latest = call.db.latest_run(call.db_owner, PaperId(paper_id), kind="topic")
    if latest is None:
        return True
    if latest["status"] == "running":
        return normalise_time(latest["expires_at"]) <= normalise_time(datetime.now(UTC))
    if latest["status"] == "aborted":
        return True
    if latest["status"] != "error":
        return False
    if latest["error_code"] == REFUSED:
        started = normalise_time(latest["started_at"])
        return any(normalise_time(t.created_at) > started for t in topics)
    if latest["error_code"] not in RETRY_AFTER:
        return False
    ended = datetime.fromisoformat(normalise_time(latest["finished_at"] or latest["started_at"]))
    return (datetime.now(UTC) - ended).total_seconds() >= RETRY_COOLDOWN_SECONDS


@dataclass(frozen=True, slots=True)
class _Prepared:
    """A topic run ready to start: its request and the person's full topic list."""

    body: AgentRunRequest
    datamark: str
    token_sha256: str
    topics: list[TopicRow]


def _prepare(
    call: Caller, row: LibraryRow, mine: list[TopicRow], deps: TopicRunDeps
) -> _Prepared | None:
    """Builds and validates the request BEFORE any row is written (nothing to settle if it fails).

    Returns:
        The prepared run, or None when the paper's index is missing.
    """
    assert row.generation is not None
    try:
        index = evidence.load_index(
            deps.index_cache, call.db, call.db_owner, call.user_id, row.paper_id, row.generation
        )
    except KeyError:
        return None
    run_id, datamark = new_id("run"), mint_datamark()
    token, token_sha256 = runs.mint_run_token()
    body = AgentRunRequest(
        run_id=run_id,
        request_id=new_id("req"),
        kind="topic",
        prompt_version=runs.PROMPT_VERSIONS["topic"],
        tool=AgentToolAccess(
            base_url=f"{deps.settings.api_internal_url}/internal/agent/runs/{run_id}", token=token
        ),
        datamark=datamark,
        paper=AgentPaper(
            title=runs.paper_title(call.db, call.db_owner, row.paper_id, row.generation),
            page_count=row.page_count,
            generation=row.generation,
        ),
        seed=AgentSeed(quote=abstract_excerpt(index), page_label="", section=None, passages=[]),
        question=topic_question(row.arxiv_category, mine),
        history=None,
        limits=runs.LIMITS["topic"],
    )
    return _Prepared(body, datamark, token_sha256, mine)


def start_topic_run(
    call: Caller,
    row: LibraryRow,
    topics: Callable[[], list[TopicRow]],
    deps: TopicRunDeps,
) -> bool:
    """Starts the paper's one topic run in the BACKGROUND; True when one was started.

    Nothing here waits for the model: the first read returns `status: none` at once, the run is a
    task the app owns (`deps.tasks`), and it stores the suggestion when it finishes, so the next
    read finds it. The guard (`may_run`), the cap, the request and the `ai_runs` row are all done
    here with no `await` between them, so concurrent first reads in this process start one run.
    (A second API process would not see the row in time: v0.2 runs one.) Any failure here is
    "no suggestion", never an error to the person.

    Args:
        call: The authenticated request (owner isolation: the run is the caller's).
        row: The paper's library row; it must have a promoted generation.
        topics: LAZY read of the person's topics (once, only when a run is possible).
        deps: Settings, agent client, index cache and the task set.

    Returns:
        Whether a run was started (not configured, the daily cap, a run made or in flight, and
        any failure to prepare it all give False).
    """
    settings, db, owner = deps.settings, call.db, call.db_owner
    if not settings.agent_secret or row.generation is None:
        return False
    mine = topics()
    if not may_run(call, row.paper_id, mine):
        return False
    try:
        runs.require_budget(db, owner, settings)
    except ApiError:
        return False  # the cap applies to this call too: no suggestion, never an error
    try:
        prepared = _prepare(call, row, mine, deps)
        if prepared is None:
            return False
        db.create_run(
            owner,
            run_id=prepared.body.run_id,
            paper_id=PaperId(row.paper_id),
            generation=row.generation,
            kind="topic",
            thread_id=None,
            message_id=None,
            token_sha256=prepared.token_sha256,
            datamark=prepared.datamark,
            expires_at=runs.token_expiry("topic"),
            code_path=runs.CODE_PATHS["topic"],
            request_id=None,
            prompt_version=runs.PROMPT_VERSIONS["topic"],
        )
    except Exception as exc:  # nothing was written before create_run, so nothing is stuck
        log_event(
            "run.topic_failed", level="error", paper_id=row.paper_id, error_type=type(exc).__name__
        )
        return False
    log_event(
        "run.start",
        run_id=prepared.body.run_id,
        paper_id=row.paper_id,
        user_ref=user_ref(call.user_id),
        kind="topic",
        code_path=runs.CODE_PATHS["topic"],
        provider=runs.PROVIDER,
    )
    task = asyncio.get_running_loop().create_task(
        _settle(deps, call.user_id, row.paper_id, prepared, time.monotonic())
    )
    deps.tasks.add(task)
    task.add_done_callback(deps.tasks.discard)
    return True


@dataclass(slots=True)
class _Outcome:
    """What one asked run came to: its model, its `done`, and why there is none."""

    model: str | None = None
    done: AgentDone | None = None
    #: The `ai_runs.error_code` when there is no `done`.
    code: str = "internal"


async def _ask(client: runs.AgentClient, body: AgentRunRequest) -> _Outcome:
    """Sends the run and reads its stream to `done` (or to a failure, which is not raised)."""
    outcome = _Outcome()
    stream: runs.AgentStream | None = None
    try:
        async with asyncio.timeout(body.limits.deadline_ms / 1000 + WAIT_GRACE_SECONDS):
            stream = await client.open(body, request_id=body.request_id)
            async for _event, frame in stream.frames():
                if isinstance(frame, AgentRun):
                    outcome.model = frame.model.removeprefix(runs.MODEL_PREFIX)
                elif isinstance(frame, AgentDone):
                    outcome.done = frame
                    break
    except runs.AgentUnavailable as exc:
        # A pre-stream refusal: the agent never started. A 4xx is the agent's "no" to THIS request.
        outcome.code = REFUSED if exc.permanent else "agent_unavailable"
        log_event("run.topic_failed", level="warning", run_id=body.run_id, error_code=outcome.code)
    except (TimeoutError, runs.AgentProtocolError, OSError) as exc:
        # The agent may have started and spent: never "unavailable" (that is asked again).
        log_event(
            "run.topic_failed", level="warning", run_id=body.run_id, error_type=type(exc).__name__
        )
    finally:
        if stream is not None:
            await stream.aclose()
    return outcome


async def _settle(
    deps: TopicRunDeps, user_id: str, paper_id: str, prepared: _Prepared, started: float
) -> None:
    """The background half: asks the agent, settles the run row, stores the suggestion.

    Runs on its own database connection (the request's is closed by now). A cancellation (the
    server stopping) settles the row `aborted` and is re-raised; any other failure settles it
    `error`/`internal`. Either way the row is never left `running`.
    """
    body = prepared.body
    db = PaperTreeDb(deps.settings.database_file)
    owner = db.owner_for(user_id)

    def elapsed() -> int:
        return max(0, int((time.monotonic() - started) * 1000))

    try:
        outcome = await _ask(deps.client, body)
        _record(db, owner, paper_id, prepared, outcome, elapsed())
    except asyncio.CancelledError:
        db.finish_run(
            owner, body.run_id, status="aborted", error_code="aborted", latency_ms=elapsed()
        )
        raise
    except Exception as exc:  # a suggestion is an offer: whatever breaks, the person sees none
        log_event(
            "run.topic_failed", level="error", run_id=body.run_id, error_type=type(exc).__name__
        )
        db.finish_run(
            owner, body.run_id, status="error", error_code="internal", latency_ms=elapsed()
        )
    finally:
        db.close()


def _record(
    db: PaperTreeDb,
    owner: Any,
    paper_id: str,
    prepared: _Prepared,
    outcome: _Outcome,
    latency_ms: int,
) -> None:
    """Settles the run row with its usage and stores the offer if the answer validates."""
    run_id, done = prepared.body.run_id, outcome.done
    if done is None:
        db.finish_run(owner, run_id, status="error", error_code=outcome.code, latency_ms=latency_ms)
        return
    suggestion = (
        parse_answer(done.final_text, prepared.topics, outcome.model or runs.MODEL)
        if done.status == "complete"
        else None
    )
    totals = done.usage_totals
    error = None if suggestion is not None else (done.error.code if done.error else "internal")
    db.finish_run(
        owner,
        run_id,
        status="done" if suggestion is not None else "error",
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
    if suggestion is not None:
        db.record_suggestion(owner, PaperId(paper_id), suggestion)  # idempotent: a row wins
    log_event(
        "run.done",
        run_id=run_id,
        paper_id=paper_id,
        kind="topic",
        provider=runs.PROVIDER,
        model=outcome.model,
        input_tokens=totals.input,
        output_tokens=totals.output,
        cost_usd_est=totals.cost_usd_est,
        error_code=error,
    )
