"""The topic suggestion model run (v0.2 S2b2, #242; GAP-A1 D2): ONE short Flash call per paper.

    GET /papers/{id}/topic ──▶ topic_suggestion.offer_topic ──▶ run_topic ──POST /v1/runs──▶ agent
                                                                    └── ai_runs row (kind 'topic')

Unlike a thread run this is not a browser stream: the caller waits for one short JSON answer and
gets a `TopicSuggestion` or None. None is the answer to everything that is not a clean suggestion
(not configured, the daily cap, the agent down, a bad answer), never an error to the person: a
suggestion is an offer, and not having one costs nothing.

WHY IT IS ONE CALL PER PAPER, NOT PER READ. A run row of kind `topic` is written BEFORE the agent is
asked, and a paper that has any such row is not asked again (`may_run`), except after
`agent_unavailable` (the agent never started, so nothing was spent). The stored suggestion
(`paper_topics`, status `suggested`) is what later reads return, so the model is reached at most
once per paper however many times the page loads, and a rejected suggestion is never re-asked.
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

from papertree_db import LibraryRow, PaperId, TopicRow, TopicSuggestion, new_id
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
#: The agent's deadline plus this is how long the API waits for the whole stream.
WAIT_GRACE_SECONDS: Final = 10.0
#: A run that ended with one of these may be tried again: the agent never started (nothing spent).
RETRY_AFTER: Final = frozenset({"agent_unavailable"})

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
    held = {topic.name.casefold(): topic for topic in topics}
    match = held.get(answer.topic_name.casefold())
    if match is not None:
        return TopicSuggestion(match.topic_id, None, "model", model_id)
    if not answer.is_new:
        return None
    return TopicSuggestion(None, answer.topic_name, "model", model_id)


def topic_question(category: str | None, topics: list[TopicRow]) -> str:
    """The run's `question`: the category and the person's topic names (the agent reads it back)."""
    names = [topic.name for topic in topics[:TOPICS_SHOWN]]
    return (
        f"Category: {category or 'none'}\n"
        f"Existing topics: {json.dumps(names, ensure_ascii=False, separators=(',', ':'))}"
    )


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
    """What a topic run needs beyond the caller: settings, agent client and index cache."""

    settings: Settings
    client: runs.AgentClient
    index_cache: PaperIndexCache


def may_run(call: Caller, paper_id: str) -> bool:
    """Whether the paper may be asked about now: never asked, or the last try never started."""
    latest = call.db.latest_run(call.db_owner, PaperId(paper_id), kind="topic")
    if latest is None:
        return True
    if latest["status"] == "running":
        return normalise_time(latest["expires_at"]) <= normalise_time(datetime.now(UTC))
    return latest["status"] == "error" and latest["error_code"] in RETRY_AFTER


async def run_topic(
    call: Caller,
    row: LibraryRow,
    topics: Callable[[], list[TopicRow]],
    deps: TopicRunDeps,
) -> TopicSuggestion | None:
    """Asks the model for a topic for this paper; None for anything but a clean suggestion.

    Args:
        call: The authenticated request (owner isolation: the run is the caller's).
        row: The paper's library row; it must have a promoted generation.
        topics: LAZY read of the person's topics (called once, only when the run happens).
        deps: Settings, agent client and index cache.

    Returns:
        A `source='model'` suggestion, or None (not configured, the daily cap, a run in flight or
        already made, the agent unreachable, a failed run, or an answer that does not validate).
    """
    settings, db, owner = deps.settings, call.db, call.db_owner
    if not settings.agent_secret or row.generation is None or not may_run(call, row.paper_id):
        return None
    try:
        runs.require_budget(db, owner, settings)
    except ApiError:
        return None  # the cap applies to this call too: no suggestion, never an error
    mine = topics()
    try:
        index = evidence.load_index(
            deps.index_cache, db, owner, call.user_id, row.paper_id, row.generation
        )
    except KeyError:
        return None
    run_id, datamark = new_id("run"), mint_datamark()
    token, token_sha256 = runs.mint_run_token()
    started = time.monotonic()
    db.create_run(
        owner,
        run_id=run_id,
        paper_id=PaperId(row.paper_id),
        generation=row.generation,
        kind="topic",
        thread_id=None,
        message_id=None,
        token_sha256=token_sha256,
        datamark=datamark,
        expires_at=runs.token_expiry("topic"),
        code_path=runs.CODE_PATHS["topic"],
        request_id=None,
        prompt_version=runs.PROMPT_VERSIONS["topic"],
    )
    body = AgentRunRequest(
        run_id=run_id,
        request_id=new_id("req"),
        kind="topic",
        prompt_version=runs.PROMPT_VERSIONS["topic"],
        tool=AgentToolAccess(
            base_url=f"{settings.api_internal_url}/internal/agent/runs/{run_id}", token=token
        ),
        datamark=datamark,
        paper=AgentPaper(
            title=runs.paper_title(db, owner, row.paper_id, row.generation),
            page_count=row.page_count,
            generation=row.generation,
        ),
        seed=AgentSeed(quote=abstract_excerpt(index), page_label="", section=None, passages=[]),
        question=topic_question(row.arxiv_category, mine),
        history=None,
        limits=runs.LIMITS["topic"],
    )
    log_event(
        "run.start",
        run_id=run_id,
        paper_id=row.paper_id,
        user_ref=user_ref(call.user_id),
        kind="topic",
        code_path=runs.CODE_PATHS["topic"],
        provider=runs.PROVIDER,
    )
    try:
        return await _finish(call, row, mine, deps, body, started)
    except Exception as exc:  # a suggestion is an offer: whatever breaks, the person sees none
        log_event("run.topic_failed", level="error", run_id=run_id, error_type=type(exc).__name__)
        db.finish_run(owner, run_id, status="error", error_code="internal")
        return None


async def _finish(
    call: Caller,
    row: LibraryRow,
    mine: list[TopicRow],
    deps: TopicRunDeps,
    body: AgentRunRequest,
    started: float,
) -> TopicSuggestion | None:
    """Asks the agent, records the run with its usage, and checks the answer."""
    db, owner, run_id = call.db, call.db_owner, body.run_id
    outcome = await _ask(deps.client, body)
    model, done = outcome.model, outcome.done

    def elapsed() -> int:
        return max(0, int((time.monotonic() - started) * 1000))

    if done is None:
        code = "internal" if outcome.reached else "agent_unavailable"
        db.finish_run(owner, run_id, status="error", error_code=code, latency_ms=elapsed())
        return None
    suggestion = (
        parse_answer(done.final_text, mine, model or runs.MODEL)
        if done.status == "complete"
        else None
    )
    totals = done.usage_totals
    db.finish_run(
        owner,
        run_id,
        status="done" if suggestion is not None else "error",
        provider=runs.PROVIDER,
        model=model,
        agent_sdk=None,
        stop_reason=done.stop_reason,
        error_code=None
        if suggestion is not None
        else (done.error.code if done.error is not None else "internal"),
        retries=done.retries,
        tool_calls=done.tool_calls,
        latency_ms=elapsed(),
        input_tokens=totals.input,
        output_tokens=totals.output,
        cache_read_tokens=totals.cache_read,
        cache_write_tokens=totals.cache_write,
        reasoning_tokens=totals.reasoning,
        cost_usd_est=totals.cost_usd_est,
    )
    log_event(
        "run.done",
        run_id=run_id,
        paper_id=row.paper_id,
        user_ref=user_ref(call.user_id),
        kind="topic",
        provider=runs.PROVIDER,
        model=model,
        input_tokens=totals.input,
        output_tokens=totals.output,
        cost_usd_est=totals.cost_usd_est,
        error_code=None if suggestion is not None else "no_suggestion",
    )
    return suggestion


@dataclass(slots=True)
class _Outcome:
    """What one asked run came to: whether the agent was reached, its model, and its `done`."""

    reached: bool = False
    model: str | None = None
    done: AgentDone | None = None


async def _ask(client: runs.AgentClient, body: AgentRunRequest) -> _Outcome:
    """Sends the run and reads its stream to `done` (or to a failure, which is not raised)."""
    outcome = _Outcome()
    stream: runs.AgentStream | None = None
    try:
        async with asyncio.timeout(body.limits.deadline_ms / 1000 + WAIT_GRACE_SECONDS):
            stream = await client.open(body, request_id=body.request_id)
            outcome.reached = True
            async for _event, frame in stream.frames():
                if isinstance(frame, AgentRun):
                    outcome.model = frame.model.removeprefix(runs.MODEL_PREFIX)
                elif isinstance(frame, AgentDone):
                    outcome.done = frame
                    break
    except (runs.AgentUnavailable, TimeoutError, runs.AgentProtocolError, OSError) as exc:
        log_event(
            "run.topic_failed", level="warning", run_id=body.run_id, error_type=type(exc).__name__
        )
    finally:
        if stream is not None:
            await stream.aclose()
    return outcome
