"""A FAKE agent that REPLAYS ``contracts/agent/fixtures/*.sse`` — the API's half of the two-sided
contract (contracts.md §0: "the agent's tests assert that it EMITS the fixtures, and the API's
FakeAgent REPLAYS them").

WHAT IS REAL AND WHAT IS REPLAYED, SAID UP FRONT

Real: the frames' order, events, fields and framing (``event:``/``data:``/``: ping``) are the
fixture's, byte for byte, except the values below. Every request the API sends is parsed by the
pydantic ``AgentRunRequest`` AND ``run-request.schema.json`` (``contract_errors`` records a
refusal, and tests assert it is empty). When a fixture says the agent used a tool
(``status {phase: "tool"}``), this fake CALLS that tool on the API's ``tool.base_url`` with the run
token it was given — so the run-token path, the handle assignment and the 16-request cap run for
real inside every replay.

Replaced, and why:
  * ``run.run_id`` is the request's (the fixture's is a recording's);
  * the ``[bN]`` handles in the text and in ``done`` are REMAPPED to the handles this run was
    actually shown (the seed's, then the tools'): fixture ``bK`` becomes the K-th handle the fake
    saw. A handle the run was never shown stays as recorded, which is how "an unknown marker is
    dropped" is exercised. ``done.markers``/``handles_seen`` are recomputed from the result;
  * a ``Script`` may replace the answer text (``final_text``), hold after N text frames until the
    API sends ``DELETE`` (cancel), end the stream without ``done`` (a killed agent), stall, or
    patch ``done`` (e.g. ``upstream_unavailable``) — each a behaviour the §3.3 table names.

One core (``FakeAgent``) serves two front ends: ``transport()`` (an in-process
``httpx.MockTransport`` for ``create_app(agent_transport=...)``) and ``fake_agent_server.py`` (a
real local server on a scratch port, for the acceptance run over real HTTP).
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from jsonschema_lite import validate
from papertree_api.schemas import AgentRunRequest
from pydantic import ValidationError

REPO = Path(__file__).resolve().parents[4]
AGENT_CONTRACTS = REPO / "contracts" / "agent"
FIXTURE_DIR = AGENT_CONTRACTS / "fixtures"
RUN_REQUEST_SCHEMA: dict[str, Any] = json.loads(
    (AGENT_CONTRACTS / "run-request.schema.json").read_text(encoding="utf-8")
)
SECRET_HEADER = "x-papertree-agent-secret"
MARKER = re.compile(r"\[(b\d+(?:\s*,\s*b\d+)*)\]")
HANDLE = re.compile(r"\bb(\d+)\b")
_TAG = re.compile(r"</?untrusted_document[^>]*>")
_SPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class Frame:
    """One fixture frame, or a ``: ping`` comment (``event is None``)."""

    event: str | None
    data: dict[str, Any] | None


def load_fixture(name: str) -> list[Frame]:
    text = (FIXTURE_DIR / f"{name}.sse").read_text(encoding="utf-8")
    frames: list[Frame] = []
    for block in text.rstrip("\n").split("\n\n"):
        if block.startswith(":"):
            frames.append(Frame(None, None))
            continue
        event_line, data_line = block.split("\n")
        frames.append(Frame(event_line[len("event: ") :], json.loads(data_line[len("data: ") :])))
    return frames


def markers_in(text: str) -> list[str]:
    out: dict[str, None] = {}
    for match in MARKER.finditer(text):
        for handle in match.group(1).split(","):
            out.setdefault(handle.strip(), None)
    return list(out)


@dataclass
class RunContext:
    """What the fake has been shown in one run."""

    body: dict[str, Any]
    #: Real handles, in the order the fake first saw them (seed passages first).
    seen: list[str] = field(default_factory=list)
    #: handle -> the text shown for it, datamarks and wrapper removed.
    texts: dict[str, str] = field(default_factory=dict)
    #: (tool, status) per tool request this run made.
    tool_log: list[tuple[str, int]] = field(default_factory=list)
    #: Handles whose section the fake has already read (it reads a new one each time).
    sectioned: set[str] = field(default_factory=set)

    def unread_section(self) -> str:
        for handle in self.seen:
            if handle not in self.sectioned:
                return handle
        return self.seen[-1] if self.seen else "b1"

    def see(self, handle: str, text: str | None = None) -> None:
        if handle not in self.seen:
            self.seen.append(handle)
        if text is not None and handle not in self.texts:
            self.texts[handle] = text


@dataclass
class Script:
    fixture: str
    #: Call the tools the fixture's `status {phase: tool}` frames name.
    call_tools: bool = True
    #: Answer the POST with this status and no stream (a pre-stream refusal).
    status: int = 200
    #: Replace the answer: the text frames become this text, in chunks.
    final_text: Callable[[RunContext], str] | None = None
    #: After N text frames, wait for the API's DELETE, then end `aborted` with the text so far.
    hold_after_text: int | None = None
    #: After N text frames, end the stream without `done` (the agent process was killed).
    drop_after_text: int | None = None
    #: After N text frames, go silent (no frame, no ping) for this many seconds.
    stall_after_text: int | None = None
    stall_seconds: float = 3600.0
    #: Fields to override in `done` (after the remap).
    done_patch: Mapping[str, Any] | None = None
    #: Extra tool requests before the answer: (tool, params), e.g. to exhaust the cap.
    extra_tools: tuple[tuple[str, dict[str, Any]], ...] = ()
    #: Seconds to wait before each text frame (a slow model; the persistence cadence test).
    text_delay: float = 0.0


def _plain(text: str, datamark: str) -> str:
    return _SPACE.sub(" ", _TAG.sub(" ", text.replace(datamark, " "))).strip()


class FakeAgent:
    def __init__(
        self,
        scripts: Script | Iterable[Script],
        *,
        secret: str,
        tools: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.scripts: list[Script] = [scripts] if isinstance(scripts, Script) else list(scripts)
        assert self.scripts, "a FakeAgent needs at least one script"
        self.secret = secret
        self.tools = tools
        self.requests: list[dict[str, Any]] = []
        self.headers: list[dict[str, str]] = []
        self.deletes: list[str] = []
        self.contract_errors: list[str] = []
        self.contexts: list[RunContext] = []
        self._cancel: dict[str, asyncio.Event] = {}
        self._live: set[str] = set()

    # ── what the API calls ───────────────────────────────────────────────────────────────

    def _next_script(self) -> Script:
        return self.scripts.pop(0) if len(self.scripts) > 1 else self.scripts[0]

    def healthz(self) -> dict[str, Any]:
        return {
            "ok": True,
            "sdk": "pi-coding-agent@0.87.1",
            "pi_ai": "0.87.1",
            "model": "minimax/MiniMax-M3",
            "key_present": False,
            "wiring_ok": True,
            "active_runs": len(self._live),
            "fake": True,
        }

    def start(
        self, headers: Mapping[str, str], content: bytes
    ) -> tuple[int, dict[str, Any] | AsyncIterator[bytes]]:
        """``POST /v1/runs``: ``(status, JSON body | SSE byte stream)``."""
        lowered = {k.lower(): v for k, v in headers.items()}
        self.headers.append(lowered)
        if lowered.get(SECRET_HEADER) != self.secret:
            return 401, {"detail": "bad agent secret", "code": "provider_auth"}
        body: dict[str, Any] = json.loads(content)
        self.requests.append(body)
        try:
            AgentRunRequest.model_validate(body)
        except ValidationError as exc:
            self.contract_errors.append(f"pydantic: {exc.errors()[:2]}")
        self.contract_errors.extend(f"schema: {e}" for e in validate(body, RUN_REQUEST_SCHEMA))
        if not lowered.get("x-request-id", "").startswith("req_"):
            self.contract_errors.append("no X-Request-Id forwarded")
        script = self._next_script()
        if script.status != 200:
            return script.status, {"detail": "refused by the fake", "code": "busy"}
        run_id = str(body["run_id"])
        self._cancel[run_id] = asyncio.Event()
        self._live.add(run_id)
        return 200, self._replay(body, script)

    def cancel(self, run_id: str) -> int:
        """``DELETE /v1/runs/{run_id}``: 204 (idempotent), 404 for a run it never started."""
        self.deletes.append(run_id)
        event = self._cancel.get(run_id)
        if event is None:
            return 404
        event.set()
        return 204

    def transport(self) -> httpx.MockTransport:
        """The in-process front end, for ``create_app(agent_transport=...)``."""

        async def handle(request: httpx.Request) -> httpx.Response:
            path = request.url.path
            if request.method == "GET" and path == "/healthz":
                return httpx.Response(200, json=self.healthz())
            if request.method == "DELETE" and path.startswith("/v1/runs/"):
                return httpx.Response(self.cancel(path.rsplit("/", 1)[-1]))
            if request.method == "POST" and path == "/v1/runs":
                status, answer = self.start(dict(request.headers), await request.aread())
                if isinstance(answer, dict):
                    return httpx.Response(status, json=answer)
                return httpx.Response(
                    200, headers={"content-type": "text/event-stream"}, content=answer
                )
            return httpx.Response(404, json={"detail": "no such route"})

        return httpx.MockTransport(handle)

    # ── the replay ───────────────────────────────────────────────────────────────────────

    async def _replay(self, body: dict[str, Any], script: Script) -> AsyncIterator[bytes]:
        run_id = str(body["run_id"])
        context = RunContext(body=body)
        self.contexts.append(context)
        datamark = str(body["datamark"])
        for passage in (body.get("seed") or {}).get("passages", []):
            context.see(str(passage["handle"]), _plain(str(passage["text"]), datamark))
        frames = load_fixture(script.fixture)
        mapping: dict[str, str] | None = None
        text_frames = 0
        sent_text = ""
        replacement: str | None = None
        try:
            for tool, params in script.extra_tools:
                await self._call_tool(context, tool, params)
            for frame in frames:
                if frame.event is None:
                    yield b": ping\n\n"
                    continue
                data = dict(frame.data or {})
                event = frame.event
                if event == "run":
                    data["run_id"] = run_id
                elif event == "status" and data.get("phase") == "tool" and script.call_tools:
                    await self._fixture_tool(context, data)
                elif event == "text":
                    if mapping is None:
                        mapping = await self._mapping(context, frames)
                    if script.final_text is not None:
                        if replacement is not None:
                            continue  # the replaced answer was sent whole at the first frame
                        replacement = script.final_text(context)
                        for chunk in _chunks(replacement):
                            sent_text += chunk
                            yield _frame("text", {"delta": chunk})
                        text_frames += 1
                    else:
                        delta = _remap(str(data["delta"]), mapping)
                        sent_text += delta
                        data["delta"] = delta
                        if script.text_delay:
                            await asyncio.sleep(script.text_delay)
                        yield _frame(event, data)
                        text_frames += 1
                    if script.drop_after_text is not None and text_frames >= script.drop_after_text:
                        return  # the stream ends with no `done`: the agent died
                    if (
                        script.stall_after_text is not None
                        and text_frames >= script.stall_after_text
                    ):
                        await asyncio.sleep(script.stall_seconds)
                    if script.hold_after_text is not None and text_frames >= script.hold_after_text:
                        await asyncio.wait_for(self._cancel[run_id].wait(), 60)
                        yield _frame("done", self._aborted_done(context, sent_text))
                        return
                    continue
                elif event == "done":
                    if mapping is None:
                        mapping = await self._mapping(context, frames)
                    final = (
                        replacement
                        if replacement is not None
                        else _remap(str(data["final_text"]), mapping)
                    )
                    data["final_text"] = final
                    data["markers"] = markers_in(final)
                    data["handles_seen"] = list(context.seen)
                    if script.done_patch:
                        data.update(script.done_patch)
                    if self._cancel[run_id].is_set():
                        data = self._aborted_done(context, sent_text)
                yield _frame(event, data)
        finally:
            self._live.discard(run_id)

    def _aborted_done(self, context: RunContext, text: str) -> dict[str, Any]:
        """``aborted-partial``'s ``done``, with this run's text (spike-verify must-fix 5: the
        entries are the ones from BEFORE this prompt)."""
        template = next(f for f in load_fixture("aborted-partial") if f.event == "done")
        data = dict(template.data or {})
        history = context.body.get("history") or {}
        data.update(
            final_text=text,
            markers=markers_in(text),
            handles_seen=list(context.seen),
            entries=list(history.get("entries", [])),
        )
        return data

    async def _mapping(self, context: RunContext, frames: list[Frame]) -> dict[str, str]:
        """Fixture handle -> real handle: fixture ``bK`` is the K-th handle this run has seen.
        When the fixture cites more handles than the run has shown, more are fetched (one
        ``get_section`` or ``get_outline`` at a time, while the cap allows)."""
        wanted: set[int] = set()
        for frame in frames:
            if frame.event in ("text", "done") and frame.data is not None:
                source = frame.data.get("delta") or frame.data.get("final_text") or ""
                for handle in markers_in(str(source)):
                    wanted.add(int(handle[1:]))
        need = max(wanted, default=0)
        if len(context.seen) < need and not context.seen:
            await self._call_tool(context, "get_outline", {})
        attempts = 0
        while len(context.seen) < need and attempts < 6:
            attempts += 1
            if (
                await self._call_tool(context, "get_section", {"handle": context.unread_section()})
                == 429
            ):
                break
        return {f"b{k}": context.seen[k - 1] for k in sorted(wanted) if k - 1 < len(context.seen)}

    async def _fixture_tool(self, context: RunContext, status: Mapping[str, Any]) -> None:
        tool = str(status.get("tool") or "")
        label = str(status.get("label") or "")
        if tool == "search_passages":
            query = label.split("·", 1)[-1].strip() or "method"
            await self._call_tool(context, tool, {"q": query, "limit": 4})
        elif tool == "get_section":
            await self._call_tool(context, tool, {"handle": context.unread_section()})
        elif tool == "get_passage":
            await self._call_tool(
                context, tool, {"handle": context.seen[-1] if context.seen else "b1"}
            )
        elif tool == "get_outline":
            await self._call_tool(context, tool, {})

    async def _call_tool(self, context: RunContext, tool: str, params: dict[str, Any]) -> int:
        base = str(context.body["tool"]["base_url"])
        token = str(context.body["tool"]["token"])
        query: dict[str, Any] = {}
        if tool == "get_outline":
            path = "/outline"
        elif tool == "get_section":
            context.sectioned.add(str(params["handle"]))
            path = f"/sections/{params['handle']}"
            if params.get("cursor"):
                query["cursor"] = params["cursor"]
        elif tool == "get_passage":
            path = f"/passages/{params['handle']}"
        else:
            path = "/search"
            query = {"q": params["q"], "limit": params.get("limit", 8)}
        async with httpx.AsyncClient(transport=self.tools, trust_env=False, timeout=30) as client:
            response = await client.get(
                base + path, params=query, headers={"Authorization": f"Bearer {token}"}
            )
        context.tool_log.append((tool, response.status_code))
        if response.status_code == 200:
            result = response.json()
            datamark = str(context.body["datamark"])
            chunks = re.split(r"(?m)^\[(b\d+)\] ", str(result["text"]))
            # Each chunk is "(p. … · type)\n<untrusted_document …>\n…body…"; the body is what the
            # model reads as the block's text, so the header line is not part of it.
            texts = {
                chunks[i]: chunks[i + 1].split("\n", 1)[-1] for i in range(1, len(chunks) - 1, 2)
            }
            for handle in result["handles"]:
                context.see(str(handle), _plain(texts.get(handle, ""), datamark) or None)
        return response.status_code


def _frame(event: str, data: Mapping[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


def _chunks(text: str, size: int = 40) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)] or [""]


def _remap(text: str, mapping: Mapping[str, str]) -> str:
    def swap(match: re.Match[str]) -> str:
        inner = ", ".join(mapping.get(h.strip(), h.strip()) for h in match.group(1).split(","))
        return f"[{inner}]"

    return MARKER.sub(swap, text)
