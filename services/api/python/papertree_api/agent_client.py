"""The API side of the agent broker (contracts.md §3.4): one run, `POST /v1/runs` to `done`.

    browser ──POST /papers/{id}/threads──▶ API ──POST /v1/runs (SSE)──▶ agent ──▶ MiniMax
            ◀──────── SSE §2.6 ─────────── API ◀──── SSE §3.2 ─────────  agent
                                           API ◀─ GET /internal/agent/runs/{run}/… (run token)

WHAT THIS MODULE OWNS

  * ``AgentClient``: ``httpx.AsyncClient`` streaming to ``PAPERTREE_AGENT_URL/v1/runs`` with
    ``X-PaperTree-Agent-Secret`` and ``X-Request-Id``. Timeouts: connect 2 s (a refused or silent
    agent is ``agent_unavailable`` BEFORE any SSE byte), read ``idle_ms + 5 s``, and a total
    deadline of ``deadline_ms + 10 s``. ``trust_env=False``: the agent is on loopback and a
    developer's ``HTTP_PROXY`` must not route it.
  * ``RunBroker``: reads the agent's frames in a task of its own, forwards the browser events,
    writes ``ai_messages.content`` at most every 500 ms while text streams, retries EXACTLY ONCE
    when the agent reports ``upstream_unavailable`` before any text reached the browser, and on
    ``done`` mints the citations (``evidence.py``), persists the message, citations, the run's
    usage and the thread's Pi entries, then emits ``citations``, ``usage``, ``done``.

WHY THE READER IS ITS OWN TASK. A browser that closes the tab cancels the response; the run must
still end on the record. So the SSE generator only drains a queue (with a ``: ping`` every 10 s),
and on disconnect it asks the broker to cancel: the broker sends ``DELETE /v1/runs/{id}`` and keeps
reading until the agent's ``done`` (``aborted``, with whatever text there was), which it persists
like any other ending. ``POST /runs/{id}/cancel`` does the same through the same path.

WHAT IS MEASURED HERE, NOT QUOTED FROM THE AGENT. ``first_text_ms`` and ``latency_ms`` on
``ai_runs`` are the API's own, from the moment the route accepted the request, so they include the
seed, the agent start and the network: the reader's wait, not the model's. ``tool_calls`` and the
token counts are the agent's (``done``); ``retries`` is the agent's plus this module's one.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
import time
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Literal

import httpx
from papertree_db import PaperId, PaperTreeDb, new_id
from papertree_db.ai import CitationIn
from papertree_retrieval import PaperIndexCache
from pydantic import ValidationError
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from . import evidence
from .errors import ApiError, ErrorCode, RunErrorCode
from .logging import log_event, user_ref
from .middleware import REQUEST_ID_HEADER
from .schemas import (
    AgentDone,
    AgentLimits,
    AgentRun,
    AgentRunRequest,
    AgentStatus,
    AgentText,
    AgentUsage,
    Wire,
    parse_agent_event,
)
from .settings import Settings
from .wiretime import now_wire

AGENT_SECRET_HEADER: Final = "X-PaperTree-Agent-Secret"
CONNECT_SECONDS: Final = 2.0
READ_GRACE_SECONDS: Final = 5.0
TOTAL_GRACE_SECONDS: Final = 10.0
#: contracts.md §0: a comment heartbeat every 10 s on the browser stream.
HEARTBEAT_SECONDS: Final = 10.0
#: contracts.md §2.6: content is written at most every 500 ms while streaming.
PERSIST_EVERY_SECONDS: Final = 0.5
#: contracts.md §3.4: ``expires_at = now + deadline + 30 s``.
TOKEN_GRACE_SECONDS: Final = 30
#: The one API-level retry's pause (the agent's own retry pauses are its own).
RETRY_DELAY_SECONDS: Final = 1.0
MAX_STATUS_LABEL: Final = 120

PROVIDER: Final = "minimax"
MODEL: Final = "MiniMax-M3"
UNKNOWN_SDK: Final = "unknown"

RunKind = Literal["explain", "ask", "summary"]

PROMPT_VERSIONS: Final[dict[RunKind, Literal["explain-v1", "ask-v1", "summary-v1"]]] = {
    "explain": "explain-v1",
    "ask": "ask-v1",
    "summary": "summary-v1",
}

#: contracts.md §8 `ai_runs.code_path` literals.
CODE_PATHS: Final[dict[RunKind, str]] = {
    "explain": "api.threads.explain>agent.v1.runs>pi.createAgentSession>minimax.anthropic-messages",
    "ask": "api.threads.ask>agent.v1.runs>pi.createAgentSession>minimax.anthropic-messages",
    "summary": "api.summary>agent.v1.runs>pi.createAgentSession>minimax.anthropic-messages",
}

#: contracts.md §3.2 "Limits by kind".
LIMITS: Final[dict[RunKind, AgentLimits]] = {
    "explain": AgentLimits(
        deadline_ms=45_000,
        idle_ms=20_000,
        max_tool_calls=8,
        max_turns=6,
        max_output_tokens=4096,
        max_retries=1,
    ),
    "ask": AgentLimits(
        deadline_ms=60_000,
        idle_ms=20_000,
        max_tool_calls=8,
        max_turns=6,
        max_output_tokens=4096,
        max_retries=1,
    ),
    "summary": AgentLimits(
        deadline_ms=90_000,
        idle_ms=20_000,
        max_tool_calls=12,
        max_turns=6,
        max_output_tokens=6144,
        max_retries=1,
    ),
}

#: What the reader is told, per code (and whether Retry is offered, contracts.md §3.3). One table,
#: used for the live ``done`` and for a message read back later, so the two always agree; the
#: agent's own ``message`` is not forwarded (it is another process's text).
ERROR_TEXT: Final[dict[str, tuple[str, bool]]] = {
    "provider_auth": ("The AI provider rejected this service's API key.", False),
    "rate_limited": ("The AI provider is limiting requests right now. Try again shortly.", True),
    "quota": ("The AI provider account has run out of quota.", False),
    "upstream_unavailable": ("The AI provider is not responding. Try again.", True),
    "timeout": ("The model stopped responding, so this answer is incomplete.", True),
    "aborted": ("The answer was stopped.", True),
    "bad_request": ("The AI provider refused this request.", False),
    "tool_failed": ("Reading the paper failed while answering. Try again.", True),
    "tool_budget_exhausted": (
        "The question needed more of the paper than one answer may read. Try a narrower question.",
        False,
    ),
    "output_truncated": ("The answer reached its length limit, so it is incomplete.", True),
    "agent_unavailable": ("The AI service stopped responding. Try again.", True),
    "internal": ("Something went wrong while answering.", False),
}


def error_wire(code: str | None) -> dict[str, Any] | None:
    """``{code, retryable, message}`` for a stored or live error code; None for no error."""
    if code is None:
        return None
    message, retryable = ERROR_TEXT.get(code, ERROR_TEXT["internal"])
    return {
        "code": code if code in ERROR_TEXT else "internal",
        "retryable": retryable,
        "message": message,
    }


def sse(event: str, data: Mapping[str, Any] | Wire) -> bytes:
    """contracts.md §0: ``event: <name>\\ndata: <one-line JSON>\\n\\n``."""
    payload = data.model_dump_json() if isinstance(data, Wire) else _dumps(data)
    return f"event: {event}\ndata: {payload}\n\n".encode()


def _dumps(data: Mapping[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def mint_run_token() -> tuple[str, str]:
    """``(token, sha256 hex)``: the token goes to the agent once; only its hash is stored."""
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode("ascii")).hexdigest()


def token_expiry(kind: RunKind, *, now: datetime | None = None) -> str:
    moment = now or datetime.now(UTC)
    return (
        moment + timedelta(milliseconds=LIMITS[kind].deadline_ms, seconds=TOKEN_GRACE_SECONDS)
    ).isoformat()


# ── the HTTP client ──────────────────────────────────────────────────────────────────────────


class AgentUnavailable(Exception):
    """The agent could not be reached, or refused the run before streaming (pre-stream)."""

    def __init__(self, code: ErrorCode, detail: str) -> None:
        super().__init__(detail)
        self.code: ErrorCode = code
        self.detail = detail


class AgentProtocolError(Exception):
    """A frame that is not the §3.2 contract. Its text is ours, never the agent's."""


@dataclass
class AgentStream:
    client: httpx.AsyncClient
    response: httpx.Response

    async def frames(self) -> AsyncIterator[tuple[str, Wire | None]]:
        """``(event, model)`` per frame, and ``("ping", None)`` per ``: ping`` comment: a
        heartbeat is activity, and the broker's idle timer must see it."""
        event: str | None = None
        data: list[str] = []
        async for line in self.response.aiter_lines():
            if line == "":
                if event is not None:
                    try:
                        yield event, parse_agent_event(event, "\n".join(data))
                    except (KeyError, ValidationError) as exc:
                        raise AgentProtocolError(f"a {event!r} frame is not the contract") from exc
                event, data = None, []
                continue
            if line.startswith(":"):
                yield "ping", None
                continue
            name, _, value = line.partition(":")
            value = value[1:] if value.startswith(" ") else value
            if name == "event":
                event = value
            elif name == "data":
                data.append(value)

    async def aclose(self) -> None:
        await self.response.aclose()
        await self.client.aclose()


class AgentClient:
    def __init__(
        self, base_url: str, secret: str, *, transport: httpx.AsyncBaseTransport | None
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.secret = secret
        self.transport = transport

    def _client(self, timeout: httpx.Timeout) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=timeout, transport=self.transport, trust_env=False)

    async def open(self, body: AgentRunRequest, *, request_id: str | None) -> AgentStream:
        """Sends the run and returns once the agent answered 200 with its headers. Anything else
        is ``AgentUnavailable`` (with the §2.9 code the route answers), before any SSE byte."""
        limits = body.limits
        timeout = httpx.Timeout(
            connect=CONNECT_SECONDS,
            read=limits.idle_ms / 1000 + READ_GRACE_SECONDS,
            write=CONNECT_SECONDS * 5,
            pool=CONNECT_SECONDS,
        )
        client = self._client(timeout)
        headers = {
            AGENT_SECRET_HEADER: self.secret,
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        if request_id:
            headers[REQUEST_ID_HEADER] = request_id
        request = client.build_request(
            "POST", f"{self.base_url}/v1/runs", content=body.model_dump_json(), headers=headers
        )
        try:
            response = await client.send(request, stream=True)
        except httpx.HTTPError as exc:
            await client.aclose()
            raise AgentUnavailable(
                "agent_unavailable", "The AI service is not reachable. Try again in a moment."
            ) from exc
        if response.status_code == 200:
            return AgentStream(client, response)
        status = response.status_code
        await response.aclose()
        await client.aclose()
        if status in (401, 403):
            raise AgentUnavailable(
                "not_configured", "The AI service refused this server's credentials."
            )
        if status == 409:
            raise AgentUnavailable("busy", "This conversation is already answering.")
        raise AgentUnavailable("agent_unavailable", "The AI service could not start this answer.")

    async def cancel(self, run_id: str, *, request_id: str | None) -> int | None:
        """``DELETE /v1/runs/{run_id}``; the status, or None when the agent is unreachable."""
        headers = {AGENT_SECRET_HEADER: self.secret}
        if request_id:
            headers[REQUEST_ID_HEADER] = request_id
        try:
            async with self._client(httpx.Timeout(CONNECT_SECONDS)) as client:
                response = await client.delete(f"{self.base_url}/v1/runs/{run_id}", headers=headers)
            return response.status_code
        except httpx.HTTPError:
            return None


# ── one run ──────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class RunSpec:
    """Everything a run needs after the route has written its rows."""

    user_id: str
    paper_id: str
    generation: int
    kind: RunKind
    run_id: str
    thread_id: str | None
    user_message_id: str | None
    #: The assistant message (``ai_messages``) for a thread run; for a summary, the id the browser
    #: events carry for the run's output (no ``ai_messages`` row: a summary is a derivation).
    message_id: str
    request_id: str | None
    body: AgentRunRequest
    #: The monotonic time the route accepted the request, for ``first_text_ms``/``latency_ms``.
    accepted_at: float


@dataclass
class _Broken:
    """A stream that ended without ``done``."""

    code: RunErrorCode


@dataclass
class _Usage:
    input: int = 0
    output: int = 0
    cache_read: int = 0
    cache_write: int = 0
    reasoning: int | None = None
    cost_usd_est: float = 0.0
    seen: bool = False

    def add(self, usage: AgentUsage) -> None:
        self.seen = True
        self.input += usage.input
        self.output += usage.output
        self.cache_read += usage.cache_read
        self.cache_write += usage.cache_write
        if usage.reasoning is not None:
            self.reasoning = (self.reasoning or 0) + usage.reasoning
        self.cost_usd_est += usage.cost_usd_est


@dataclass
class RunBroker:
    spec: RunSpec
    settings: Settings
    client: AgentClient
    index_cache: PaperIndexCache
    documents: evidence.DocumentCache
    registry: dict[str, RunBroker]
    queue: asyncio.Queue[bytes | None] = field(default_factory=asyncio.Queue)
    stream: AgentStream | None = None
    buffer: str = ""
    text_sent: bool = False
    cancelled: bool = False
    finished: bool = False
    sdk: str = UNKNOWN_SDK
    first_text_ms: int | None = None
    api_retries: int = 0
    usage: _Usage = field(default_factory=_Usage)
    _task: asyncio.Task[None] | None = None
    _cancel_task: asyncio.Task[None] | None = None
    _last_write: float = 0.0

    # ── lifecycle ────────────────────────────────────────────────────────────────────────

    async def open(self) -> None:
        """Pre-stream: ``AgentUnavailable`` propagates to the route, which answers JSON."""
        self.stream = await self.client.open(self.spec.body, request_id=self.spec.request_id)

    def start(self) -> None:
        self.registry[self.spec.run_id] = self
        self.queue.put_nowait(
            sse(
                "run",
                {
                    "run_id": self.spec.run_id,
                    "thread_id": self.spec.thread_id,
                    "user_message_id": self.spec.user_message_id,
                    "message_id": self.spec.message_id,
                    "generation": self.spec.generation,
                },
            )
        )
        self._task = asyncio.create_task(self._pump(), name=f"run {self.spec.run_id}")

    async def events(self) -> AsyncIterator[bytes]:
        """The browser stream: the queued events, a ``: ping`` every 10 s of silence."""
        try:
            while True:
                try:
                    item = await asyncio.wait_for(self.queue.get(), HEARTBEAT_SECONDS)
                except TimeoutError:
                    yield b": ping\n\n"
                    continue
                if item is None:
                    return
                yield item
        finally:
            if not self.finished:
                # The browser went away mid-answer (contracts.md §2.5: a disconnect cancels).
                self.request_cancel()

    def request_cancel(self) -> None:
        """The USER cancelled (``POST /runs/{id}/cancel``, or the browser went away): the run
        ends ``aborted``. Propagates ``DELETE`` once and keeps reading to the agent's ``done``."""
        if self.cancelled or self.finished:
            return
        self.cancelled = True
        self._stop_agent()

    def _stop_agent(self) -> None:
        """Tell the agent to stop (``DELETE /v1/runs/{id}``), once, without deciding WHY: a user
        cancel, a timeout and a protocol error all stop it, and only the first is an abort."""
        if self._cancel_task is not None or self.finished:
            return
        self._cancel_task = asyncio.create_task(
            self._send_cancel(), name=f"cancel {self.spec.run_id}"
        )

    async def _send_cancel(self) -> None:
        status = await self.client.cancel(self.spec.run_id, request_id=self.spec.request_id)
        log_event(
            "run.cancel",
            run_id=self.spec.run_id,
            request_id=self.spec.request_id,
            status=status,
        )

    # ── the reader ───────────────────────────────────────────────────────────────────────

    async def _pump(self) -> None:
        db = PaperTreeDb(self.settings.database_file)
        try:
            owner = db.owner_for(self.spec.user_id)
            outcome = await self._read_until_done(db, owner)
            await self._finalize(db, owner, outcome)
        except Exception as exc:  # the run must still end on the record
            log_event(
                "run.error",
                level="error",
                run_id=self.spec.run_id,
                error_type=type(exc).__name__,
                error_code="internal",
            )
            try:
                owner = db.owner_for(self.spec.user_id)
                await self._finalize(db, owner, _Broken("internal"))
            except Exception as again:
                log_event(
                    "run.error",
                    level="error",
                    run_id=self.spec.run_id,
                    error_type=type(again).__name__,
                    error_code="persist_failed",
                )
                self._emit_done("error", error_wire("internal"))
        finally:
            self.finished = True
            self.registry.pop(self.spec.run_id, None)
            if self.stream is not None:
                await self.stream.aclose()
            db.close()
            self.queue.put_nowait(None)

    async def _read_until_done(self, db: PaperTreeDb, owner: Any) -> AgentDone | _Broken:
        while True:
            outcome = await self._read_one_stream(db, owner)
            retry = (
                isinstance(outcome, AgentDone)
                and outcome.status == "error"
                and outcome.error is not None
                and outcome.error.code == "upstream_unavailable"
                and not self.text_sent
                and not self.cancelled
                and self.api_retries < 1
            )
            if not retry:
                return outcome
            self.api_retries += 1
            self.queue.put_nowait(
                sse(
                    "status",
                    {
                        "phase": "retrying",
                        "label": "The model service is busy; trying again",
                        "attempt": self.api_retries,
                        "delay_ms": int(RETRY_DELAY_SECONDS * 1000),
                    },
                )
            )
            log_event("run.retry", run_id=self.spec.run_id, error_code="upstream_unavailable")
            if self.stream is not None:
                await self.stream.aclose()
                self.stream = None
            await asyncio.sleep(RETRY_DELAY_SECONDS)
            db.extend_run(
                owner,
                self.spec.run_id,
                expires_at=token_expiry(self.spec.kind),
                retries=self.api_retries,
            )
            try:
                await self.open()
            except AgentUnavailable:
                return _Broken("agent_unavailable")

    async def _read_one_stream(self, db: PaperTreeDb, owner: Any) -> AgentDone | _Broken:
        assert self.stream is not None
        loop = asyncio.get_running_loop()
        limits = self.spec.body.limits
        deadline = loop.time() + limits.deadline_ms / 1000 + TOTAL_GRACE_SECONDS
        # The idle timeout is enforced HERE, not only by httpx's read timeout: a transport that
        # does not implement read timeouts (an in-process one) would otherwise wait for the whole
        # deadline. Any frame, a `: ping` included, resets it (§3.2: a ping every 5 s).
        idle = limits.idle_ms / 1000 + READ_GRACE_SECONDS
        frames = self.stream.frames()
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                self._stop_agent()
                return _Broken("timeout")
            try:
                event, data = await asyncio.wait_for(anext(frames), min(remaining, idle))
            except StopAsyncIteration:
                return _Broken("aborted" if self.cancelled else "agent_unavailable")
            except (TimeoutError, httpx.TimeoutException):
                self._stop_agent()
                return _Broken("timeout")
            except AgentProtocolError:
                log_event("run.protocol_error", level="error", run_id=self.spec.run_id)
                self._stop_agent()
                return _Broken("internal")
            except httpx.HTTPError:
                return _Broken("aborted" if self.cancelled else "agent_unavailable")
            if data is None:
                continue  # a heartbeat
            if isinstance(data, AgentRun):
                if data.run_id != self.spec.run_id:
                    log_event("run.protocol_error", level="error", run_id=self.spec.run_id)
                    self._stop_agent()
                    return _Broken("internal")
                self.sdk = data.sdk
            elif isinstance(data, AgentStatus):
                status: dict[str, Any] = {"phase": data.phase}
                if data.label:
                    status["label"] = data.label[:MAX_STATUS_LABEL]
                if data.attempt is not None:
                    status["attempt"] = data.attempt
                if data.delay_ms is not None:
                    status["delay_ms"] = data.delay_ms
                self.queue.put_nowait(sse("status", status))
            elif isinstance(data, AgentText):
                self._on_text(db, owner, data.delta)
            elif isinstance(data, AgentUsage):
                self.usage.add(data)
            elif isinstance(data, AgentDone):
                return data
            else:  # pragma: no cover - AGENT_EVENTS names exactly these five
                raise AgentProtocolError(event)

    def _on_text(self, db: PaperTreeDb, owner: Any, delta: str) -> None:
        if not delta:
            return
        if self.first_text_ms is None:
            self.first_text_ms = self._elapsed_ms()
        self.buffer += delta
        self.text_sent = True
        self.queue.put_nowait(sse("text", {"delta": delta}))
        now = time.monotonic()
        if self.spec.kind != "summary" and now - self._last_write >= PERSIST_EVERY_SECONDS:
            db.update_message(owner, self.spec.message_id, content=self.buffer)
            self._last_write = now

    def _elapsed_ms(self) -> int:
        return max(0, int((time.monotonic() - self.spec.accepted_at) * 1000))

    # ── the end ──────────────────────────────────────────────────────────────────────────

    async def _finalize(self, db: PaperTreeDb, owner: Any, outcome: AgentDone | _Broken) -> None:
        spec = self.spec
        if isinstance(outcome, AgentDone):
            final_text = outcome.final_text or self.buffer
            status: str = outcome.status
            error_code: str | None = outcome.error.code if outcome.error else None
            stop_reason = outcome.stop_reason
            usage = outcome.usage_totals
            tokens: dict[str, Any] = {
                "input_tokens": usage.input,
                "output_tokens": usage.output,
                "cache_read_tokens": usage.cache_read,
                "cache_write_tokens": usage.cache_write,
                "reasoning_tokens": usage.reasoning,
                "cost_usd_est": usage.cost_usd_est,
            }
            tool_calls, agent_retries = outcome.tool_calls, outcome.retries
            entries: list[dict[str, Any]] | None = outcome.entries
            if status in ("error", "aborted") and not outcome.final_text and not entries:
                entries = None  # keep the thread's stored state: nothing to resume from here
            if outcome.markers and set(outcome.markers) != set(evidence.markers_in(final_text)):
                log_event("run.markers_mismatch", level="warning", run_id=spec.run_id)
        else:
            final_text = self.buffer
            error_code = "aborted" if self.cancelled else outcome.code
            status = "aborted" if self.cancelled else ("partial" if final_text else "error")
            stop_reason = None
            u = self.usage
            tokens = (
                {
                    "input_tokens": u.input,
                    "output_tokens": u.output,
                    "cache_read_tokens": u.cache_read,
                    "cache_write_tokens": u.cache_write,
                    "reasoning_tokens": u.reasoning,
                    "cost_usd_est": u.cost_usd_est,
                }
                if u.seen
                else {}
            )
            tool_calls, agent_retries, entries = 0, 0, None

        handles = db.run_handles(owner, spec.run_id)
        document = self.documents.get(db, owner, spec.user_id, spec.paper_id, spec.generation)
        try:
            index = evidence.load_index(
                self.index_cache, db, owner, spec.user_id, spec.paper_id, spec.generation
            )
            texts = {
                block_id: block.text
                for block_id in handles.values()
                if (block := index.block(block_id)) is not None
            }
        except KeyError:
            texts = {}
        minter = evidence.CitationMinter(
            run_id=spec.run_id, handles=handles, document=document, texts=texts, new_id=new_id
        )
        summary: dict[str, Any] | None = None
        if spec.kind == "summary":
            bullets = evidence.cite_summary(final_text, minter) if final_text else []
            citations = [c for bullet in bullets for c in bullet.citations]
            # contracts.md §3.4: partial when a bullet has no valid marker. The verifier's verdict
            # is each bullet's `supported`; it does not make the summary partial.
            complete = bool(bullets) and all(b.citations for b in bullets)
            if status == "complete" and not complete:
                status = "partial"
            summary = {
                "generation": spec.generation,
                "model": MODEL,
                "prompt_version": PROMPT_VERSIONS["summary"],
                "created_at": now_wire(),
                "status": "complete" if status == "complete" else "partial",
                "bullets": [
                    {
                        "text": b.text,
                        "citations": [c.wire() for c in b.citations],
                        "supported": b.supported,
                    }
                    for b in bullets
                ],
            }
        else:
            citations = evidence.cite_answer(final_text, minter) if final_text else []

        run_status = {
            "complete": "done",
            "partial": "done",
            "error": "error",
            "aborted": "aborted",
        }[status]
        if isinstance(outcome, _Broken) and run_status == "done":
            run_status = "error"  # the stream broke: the partial text is kept, the run failed
        latency_ms = self._elapsed_ms()
        with db.transaction():
            if spec.thread_id is not None:
                db.update_message(
                    owner,
                    spec.message_id,
                    content=final_text,
                    status=status,
                    error_code=error_code,
                    completed_at=datetime.now(UTC).isoformat(),
                )
                db.put_citations(
                    owner,
                    spec.message_id,
                    [
                        CitationIn(
                            citation_id=c.citation_id,
                            ordinal=c.ordinal,
                            marker=c.marker,
                            anchor=c.anchor,
                            generation=spec.generation,
                            block_id=c.block_id,
                            page_index=c.page_index,
                            supported=c.supported,
                        )
                        for c in citations
                    ],
                )
                if entries is not None:
                    db.set_agent_state(owner, spec.thread_id, entries)
            if summary is not None and citations and status in ("complete", "partial"):
                db.put_summary(
                    owner,
                    PaperId(spec.paper_id),
                    spec.generation,
                    prompt_hash=PROMPT_VERSIONS["summary"],
                    model_id=MODEL,
                    content=summary,
                    derived_from=[c.block_id for c in citations],
                )
            db.finish_run(
                owner,
                spec.run_id,
                status=run_status,
                provider=PROVIDER,
                model=MODEL,
                agent_sdk=self.sdk,
                stop_reason=stop_reason,
                error_code=error_code,
                retries=agent_retries + self.api_retries,
                tool_calls=tool_calls,
                first_text_ms=self.first_text_ms,
                latency_ms=latency_ms,
                **tokens,
            )
        run = db.get_run(owner, spec.run_id)
        log_event(
            "run.done",
            run_id=spec.run_id,
            request_id=spec.request_id,
            paper_id=spec.paper_id,
            user_ref=user_ref(spec.user_id),
            kind=spec.kind,
            error_code=error_code,
            code_path=CODE_PATHS[spec.kind],
            provider=PROVIDER,
            model=MODEL,
            stop_reason=stop_reason,
            input_tokens=tokens.get("input_tokens"),
            output_tokens=tokens.get("output_tokens"),
            cost_usd_est=tokens.get("cost_usd_est"),
            retries=agent_retries + self.api_retries,
            tool_calls=tool_calls,
            first_text_ms=self.first_text_ms,
            ms=latency_ms,
        )
        self.queue.put_nowait(sse("citations", {"items": [c.wire() for c in citations]}))
        if run is not None:
            self.queue.put_nowait(sse("usage", run_summary(run)))
        self.finished = True
        self._emit_done(status, error_wire(error_code) if status != "complete" else None)

    def _emit_done(self, status: str, error: dict[str, Any] | None) -> None:
        self.queue.put_nowait(
            sse("done", {"status": status, "error": error, "message_id": self.spec.message_id})
        )


def run_summary(run: Mapping[str, Any]) -> dict[str, Any]:
    """contracts.md §2.5 ``RunSummary`` from an ``ai_runs`` row."""
    return {
        "run_id": run["run_id"],
        "model": run["model"] or MODEL,
        "provider": run["provider"] or PROVIDER,
        "agent_sdk": run["agent_sdk"] or UNKNOWN_SDK,
        "input_tokens": run["input_tokens"],
        "output_tokens": run["output_tokens"],
        "cache_read_tokens": run["cache_read_tokens"],
        "reasoning_tokens": run["reasoning_tokens"],
        "cost_usd_est": run["cost_usd_est"],
        "first_text_ms": run["first_text_ms"],
        "latency_ms": run["latency_ms"],
        "retries": int(run["retries"] or 0),
        "tool_calls": int(run["tool_calls"] or 0),
    }


class RunStreamResponse(StreamingResponse):
    """The browser's SSE response for one run.

    Starlette ends a streaming response on disconnect by CANCELLING it; whether the body
    generator's ``finally`` then runs promptly depends on when the event loop finalises an
    abandoned async generator. So the cancel is wired HERE, around the whole response: however
    the response ends before the run finished (a closed tab, a dropped connection), the broker is
    told, and it propagates ``DELETE /v1/runs/{id}`` and persists what the agent returns.
    """

    def __init__(self, broker: RunBroker) -> None:
        super().__init__(
            broker.events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
        self.broker = broker

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            if not self.broker.finished:
                self.broker.request_cancel()


# ── what every run route does before its first SSE byte ──────────────────────────────────────


def require_configured(settings: Settings) -> None:
    """503 ``not_configured`` without ``PAPERTREE_AGENT_SECRET`` (contracts.md §7): checked before
    anything is written, so a server with no AI still serves the reader and every highlight."""
    if not settings.agent_secret:
        raise ApiError(
            "not_configured",
            "AI explanations are not configured on this server (PAPERTREE_AGENT_SECRET is unset).",
        )


def require_budget(db: PaperTreeDb, owner: Any, settings: Settings) -> None:
    """429 ``budget_exhausted`` once the rolling-24 h estimated spend reaches the daily budget
    (contracts.md §3.4). A run still streaming has no cost yet, so this is a cap on FINISHED
    spend: concurrent runs started together can overshoot it by one run each."""
    since = (datetime.now(UTC) - timedelta(hours=24)).isoformat()
    spent = db.cost_since(owner, since)
    if spent >= settings.daily_budget_usd:
        raise ApiError(
            "budget_exhausted",
            f"Today's AI budget (${usd(settings.daily_budget_usd)}) is used up. "
            "It frees up as the last 24 hours roll over.",
        )


def usd(amount: float) -> str:
    """Dollars as a reader should see them: cents, or more digits for a sub-cent budget (a
    `$0.007` budget printed as `$0.01` states a limit that is not the one enforced)."""
    if amount >= 0.1 or amount == 0:
        return f"{amount:.2f}"
    return f"{amount:.6f}".rstrip("0")


def paper_title(db: PaperTreeDb, owner: Any, paper_id: str, generation: int) -> str:
    """The run request's ``paper.title``: the parse's ``metadata.title.value``, else the upload's
    file name, else the paper id; header-safe, because it is paper text the model reads."""
    row = db.get_paper(owner, PaperId(paper_id), generation)  # type: ignore[arg-type]
    title: str | None = None
    if row is not None:
        try:
            metadata = json.loads(row["metadata"] or "{}")
        except ValueError:
            metadata = {}
        value = (metadata.get("title") or {}).get("value") if isinstance(metadata, dict) else None
        title = value if isinstance(value, str) and value.strip() else None
    if title is None:
        owned = db.owned_paper(owner, PaperId(paper_id))
        filename = owned.get("original_filename") if owned else None
        if isinstance(filename, str) and filename.strip():
            title = filename[:-4] if filename.lower().endswith(".pdf") else filename
    return evidence.header_text(title or paper_id, limit=200)


async def launch(
    broker: RunBroker,
    *,
    db: PaperTreeDb,
    owner: Any,
    on_refused: Any = None,
) -> RunStreamResponse:
    """Opens the agent stream (pre-stream errors become the route's JSON answer, after the rows
    the run wrote are removed by ``on_refused``) and returns the browser's SSE response."""
    spec = broker.spec
    try:
        await broker.open()
    except AgentUnavailable as exc:
        if on_refused is not None:
            on_refused()
        db.finish_run(
            owner,
            spec.run_id,
            status="error",
            error_code=exc.code,
            latency_ms=max(0, int((time.monotonic() - spec.accepted_at) * 1000)),
        )
        log_event(
            "run.refused",
            level="warning",
            run_id=spec.run_id,
            request_id=spec.request_id,
            error_code=exc.code,
        )
        raise ApiError(exc.code, exc.detail, retryable=exc.code != "not_configured") from exc
    log_event(
        "run.start",
        run_id=spec.run_id,
        request_id=spec.request_id,
        paper_id=spec.paper_id,
        user_ref=user_ref(spec.user_id),
        kind=spec.kind,
        code_path=CODE_PATHS[spec.kind],
        provider=PROVIDER,
        model=MODEL,
    )
    broker.start()
    return RunStreamResponse(broker)
