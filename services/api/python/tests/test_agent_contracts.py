"""`contracts/agent/`: the recorded agent streams, held to the §3.2 contract from three sides.

    framing     every fixture is exactly `event: <name>\\ndata: <one-line JSON>\\n\\n` frames and
                `: ping\\n\\n` heartbeats, nothing else
    pydantic    every `data` parses through `schemas.parse_agent_event` — the models S5's
                FakeAgent replays the fixtures through
    the schema  every frame validates against the HAND-WRITTEN `run-events.schema.json`
                (`jsonschema_lite`, since no validator is locked; the web side uses ajv)
    semantics   what a schema cannot say: the deltas ARE the final text, the markers ARE the
                regex over it, the usage totals ARE the sum of the usage events, a tool call
                never follows text, one heartbeat per 5 s, and each fixture is the case it names

and the `run-request-*.json` examples against `run-request.schema.json` and `AgentRunRequest`.
"""

from __future__ import annotations

import copy
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from jsonschema_lite import validate
from papertree_api import contracts
from papertree_api.schemas import AgentDone, AgentRunRequest, ToolResult, parse_agent_event
from pydantic import ValidationError

AGENT = Path(__file__).resolve().parents[4] / "contracts" / "agent"
FIXTURES = sorted((AGENT / "fixtures").glob("*.sse"))
EVENTS_SCHEMA: dict[str, Any] = json.loads((AGENT / "run-events.schema.json").read_text("utf-8"))
REQUEST_SCHEMA: dict[str, Any] = json.loads((AGENT / "run-request.schema.json").read_text("utf-8"))
TOOLS_SCHEMA: dict[str, Any] = json.loads((AGENT / "internal-tools.schema.json").read_text("utf-8"))

#: contracts.md §0: the eight recorded streams.
NAMES = {
    "explain-ok",
    "followup-ok",
    "summary-ok",
    "tool-budget",
    "stall-timeout",
    "auth-error",
    "aborted-partial",
    "upstream-503-retry-ok",
}
#: fixture -> (done.status, done.error.code or None).
OUTCOME = {
    "explain-ok": ("complete", None),
    "followup-ok": ("complete", None),
    "summary-ok": ("complete", None),
    "tool-budget": ("error", "tool_budget_exhausted"),
    "stall-timeout": ("partial", "timeout"),
    "auth-error": ("error", "provider_auth"),
    "aborted-partial": ("aborted", "aborted"),
    "upstream-503-retry-ok": ("complete", None),
}
#: contracts.md §3.2, verbatim.
MARKER = re.compile(r"\[(b\d+(?:\s*,\s*b\d+)*)\]")


@dataclass(frozen=True)
class Frame:
    event: str
    data: dict[str, Any]
    raw: str


def read_frames(path: Path) -> tuple[list[Frame], int]:
    """(frames, heartbeats). Fails on anything that is not the §3.2 framing."""
    text = path.read_text(encoding="utf-8")
    assert "\r" not in text, "CR in a stream: §0 framing is LF"
    assert text.endswith("\n\n"), "a stream ends with a complete frame"
    frames: list[Frame] = []
    pings = 0
    for block in text[:-2].split("\n\n"):
        if block == ": ping":
            pings += 1
            continue
        lines = block.split("\n")
        assert len(lines) == 2, f"a frame is two lines, got {lines!r}"
        event_line, data_line = lines
        assert event_line.startswith("event: ") and data_line.startswith("data: "), lines
        raw = data_line[len("data: ") :]
        data = json.loads(raw)
        assert isinstance(data, dict), raw
        frames.append(Frame(event_line[len("event: ") :], data, raw))
    return frames, pings


def test_the_eight_fixtures_exist() -> None:
    assert {path.stem for path in FIXTURES} == NAMES


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_a_fixture_is_a_contract_stream(path: Path) -> None:
    frames, pings = read_frames(path)
    for frame in frames:
        parse_agent_event(frame.event, frame.raw)  # the FakeAgent's parse
        problems = validate({"event": frame.event, "data": frame.data}, EVENTS_SCHEMA)
        assert not problems, (frame.event, problems)

    events = [frame.event for frame in frames]
    assert events[0] == "run" and events.count("run") == 1
    assert events[-1] == "done" and events.count("done") == 1
    done = frames[-1].data
    AgentDone.model_validate(done, strict=False)

    # The deltas are the final text; `text` carries only the FINAL assistant message, so no tool
    # step comes after the first delta.
    texts = [f.data["delta"] for f in frames if f.event == "text"]
    assert "".join(texts) == done["final_text"]
    if texts:
        first_text = events.index("text")
        assert not [f for f in frames[first_text:] if f.data.get("phase") == "tool"]
    assert (done["first_text_ms"] is None) == (not texts)
    if done["first_text_ms"] is not None:
        assert done["first_text_ms"] <= done["latency_ms"]

    # markers: the §3.2 regex over final_text, deduplicated, first-seen; all issued in this run.
    expected: list[str] = []
    for group in MARKER.findall(done["final_text"]):
        for handle in re.split(r"\s*,\s*", group):
            if handle not in expected:
                expected.append(handle)
    assert done["markers"] == expected
    assert set(done["markers"]) <= set(done["handles_seen"])

    # usage_totals: the sum of the per-message usage events.
    usages = [f.data for f in frames if f.event == "usage"]
    totals = done["usage_totals"]
    for key in ("input", "output", "cache_read", "cache_write"):
        assert totals[key] == sum(u[key] for u in usages), key
    if any(u["reasoning"] is None for u in usages):
        assert totals["reasoning"] is None
    else:
        assert totals["reasoning"] == sum(u["reasoning"] for u in usages)
    assert math.isclose(
        totals["cost_usd_est"], sum(u["cost_usd_est"] for u in usages), abs_tol=1e-9
    )

    phases = [f.data["phase"] for f in frames if f.event == "status"]
    assert done["tool_calls"] == phases.count("tool")
    assert done["retries"] == phases.count("retrying")
    # A `: ping` every 5 s (§3.2).
    assert pings == done["latency_ms"] // 5000, (pings, done["latency_ms"])

    status, code = OUTCOME[path.stem]
    assert done["status"] == status
    assert (done["error"] or {}).get("code") == code
    if status in {"complete", "partial"}:
        assert done["final_text"]
    if status in {"error", "aborted"} and not done["final_text"]:
        # Pre-prompt entries, so a cancelled task is not resumed (spike-verify must-fix 5). Every
        # such fixture is a thread's first turn, where "before this prompt" is empty.
        assert done["entries"] == []


def test_the_summary_fixture_cites_every_bullet() -> None:
    """§3.4: a bullet without a valid marker is `supported: false` and makes the summary
    `partial`. The recorded happy path must therefore cite every bullet."""
    frames, _ = read_frames(AGENT / "fixtures" / "summary-ok.sse")
    bullets = [line for line in frames[-1].data["final_text"].split("\n") if line.strip()]
    assert len(bullets) >= 5
    for bullet in bullets:
        assert bullet.startswith("- ") and MARKER.search(bullet), bullet


def test_the_retry_fixture_retries_before_any_text() -> None:
    """§3.4: exactly one retry, only when `upstream_unavailable` comes before any text."""
    frames, _ = read_frames(AGENT / "fixtures" / "upstream-503-retry-ok.sse")
    events = [(f.event, f.data.get("phase")) for f in frames]
    assert events.index(("status", "retrying")) < events.index(("text", None))


def test_a_broken_frame_fails_both_checkers() -> None:
    """Non-vacuity: the two checkers above refuse what they should."""
    frames, _ = read_frames(AGENT / "fixtures" / "explain-ok.sse")
    done = frames[-1].data
    broken: list[tuple[str, dict[str, Any]]] = []
    missing = copy.deepcopy(done)
    del missing["final_text"]
    broken.append(("done", missing))
    broken.append(("done", {**copy.deepcopy(done), "error": None, "status": "error"}))
    broken.append(("done", {**copy.deepcopy(done), "markers": ["b1", "b1"]}))
    broken.append(("status", {"phase": "tool", "tool": "read_file"}))
    broken.append(("status", {"phase": "thinking", "extra": 1}))
    broken.append(("usage", {**frames[3].data, "input": -1}))
    broken.append(("run", {"run_id": "run_short", "model": "minimax/MiniMax-M3", "sdk": "x"}))
    for event, data in broken:
        assert validate({"event": event, "data": data}, EVENTS_SCHEMA), (event, data)
    for event, data in broken:
        if data.get("markers") == ["b1", "b1"]:
            continue  # uniqueness is the schema's and the semantic test's, not the model's
        with pytest.raises(ValidationError):
            parse_agent_event(event, json.dumps(data))
    with pytest.raises(KeyError):
        parse_agent_event("citations", "{}")  # a browser event, not an agent event


_RUN = {"run_id": "run_01K62ZX4Y6C0G6Y7T3N2E6Q9VB", "model": "minimax/MiniMax-M3"}
_USAGE = {"input": 1, "output": 1, "cache_read": 0, "cache_write": 0, "cost_usd_est": 0.0}

#: Frames on the edge of §3.2, valid and not. The lesson of S0 review M1: two checkers that
#: disagree let one side's records through to the other (the model took `null` where the schema
#: said "omit"), so the answer is compared, not only the refusals.
EDGE_FRAMES: list[tuple[str, dict[str, Any]]] = [
    ("status", {"phase": "tool", "label": "Reading p. 4"}),
    # WATCHED FAILING: the model took an empty label the schema refuses (`minLength: 1`).
    ("status", {"phase": "tool", "label": ""}),
    ("status", {"phase": "tool", "tool": "get_outline"}),
    ("status", {"phase": "tool", "tool": None}),
    ("status", {"phase": "tool", "tool": "read_file"}),
    ("status", {"phase": "retrying", "attempt": 1, "delay_ms": 0}),
    ("status", {"phase": "retrying", "attempt": 0}),
    ("status", {"phase": "retrying", "attempt": None}),
    ("status", {"phase": "retrying", "delay_ms": -1}),
    ("status", {"phase": "resting"}),
    ("text", {"delta": ""}),
    ("text", {"delta": None}),
    ("usage", {**_USAGE, "reasoning": None}),
    ("usage", {**_USAGE, "reasoning": 7}),
    ("usage", _USAGE),
    ("usage", {**_USAGE, "reasoning": None, "cost_usd_est": -1}),
    ("usage", {**_USAGE, "reasoning": None, "input": 1.5}),
    ("usage", {**_USAGE, "reasoning": None, "input": "1"}),
    ("run", {**_RUN, "sdk": "pi-coding-agent@0.87.1"}),
    ("run", {**_RUN, "sdk": "pi-coding-agent"}),
    ("run", {**_RUN, "run_id": "run_short", "sdk": "pi-coding-agent@0.87.1"}),
]


@pytest.mark.parametrize(
    ("event", "data"), EDGE_FRAMES, ids=[str(i) for i in range(len(EDGE_FRAMES))]
)
def test_the_model_and_the_hand_schema_give_one_answer_frame_by_frame(
    event: str, data: dict[str, Any]
) -> None:
    by_schema = not validate({"event": event, "data": data}, EVENTS_SCHEMA)
    try:
        parse_agent_event(event, json.dumps(data))
        by_model = True
    except ValidationError:
        by_model = False
    assert by_model == by_schema, f"model {by_model}, schema {by_schema}: {event} {data}"


@pytest.mark.parametrize("name", ["explain", "followup", "summary"])
def test_the_run_request_examples(name: str) -> None:
    body = json.loads((AGENT / "examples" / f"run-request-{name}.json").read_text("utf-8"))
    assert not validate(body, REQUEST_SCHEMA)
    AgentRunRequest.model_validate_json(json.dumps(body))
    # Each example is the request whose stream is recorded in the fixture of the same case.
    frames, _ = read_frames(AGENT / "fixtures" / f"{name}-ok.sse")
    assert frames[0].data["run_id"] == body["run_id"]
    assert body["tool"]["base_url"].endswith(body["run_id"])


def test_the_followup_resumes_the_explain_turn() -> None:
    """A follow-up's `history.entries` is the thread's state as of its last COMPLETED turn: the
    `entries` the explain run's `done` handed back."""
    explain, _ = read_frames(AGENT / "fixtures" / "explain-ok.sse")
    followup = json.loads((AGENT / "examples" / "run-request-followup.json").read_text("utf-8"))
    assert followup["history"]["entries"] == explain[-1].data["entries"]
    frames, _ = read_frames(AGENT / "fixtures" / "followup-ok.sse")
    assert (
        frames[-1].data["entries"][: len(followup["history"]["entries"])]
        == (followup["history"]["entries"])
    )


def test_the_request_rules_are_in_both_checkers() -> None:
    summary = json.loads((AGENT / "examples" / "run-request-summary.json").read_text("utf-8"))
    explain = json.loads((AGENT / "examples" / "run-request-explain.json").read_text("utf-8"))
    for bad in (
        {**summary, "seed": explain["seed"]},  # a summary run has no seed
        {**explain, "seed": None},  # an explain run needs one
        {**explain, "datamark": "^XYZ"},
        {**explain, "question": ""},
        {**explain, "tool": {**explain["tool"], "token": "short"}},
    ):
        assert validate(bad, REQUEST_SCHEMA), bad
        with pytest.raises(ValidationError):
            AgentRunRequest.model_validate_json(json.dumps(bad))


def test_the_internal_tool_result_is_one_shape_on_both_sides() -> None:
    hand = TOOLS_SCHEMA["$defs"]["ToolResult"]
    exported = contracts.render("internal")["$defs"]["ToolResult"]
    assert set(hand["properties"]) == set(exported["properties"])
    # §4 `next_cursor?: string|null`: the agent takes it absent, and the API always SENDS it (null
    # when the tool does not page), which the exported response schema says by requiring it.
    assert set(exported["required"]) == set(hand["required"]) | {"next_cursor"}
    sample = {"text": "[b3] (p. 2 · 2. Unified Detection · paragraph) …", "handles": ["b3"]}
    assert not validate(sample, TOOLS_SCHEMA, "#/$defs/ToolResult")
    ToolResult.model_validate_json(json.dumps(sample))
    sent = ToolResult.model_validate_json(json.dumps(sample)).model_dump(mode="json")
    assert sent == {**sample, "next_cursor": None}
    assert not validate(sent, contracts.render("internal"), "#/$defs/ToolResult")
    assert not validate(sent, TOOLS_SCHEMA, "#/$defs/ToolResult")
    for bad in ({"text": "x"}, {"text": "x", "handles": ["3"]}, {**sample, "extra": 1}):
        assert validate(bad, TOOLS_SCHEMA, "#/$defs/ToolResult"), bad
        with pytest.raises(ValidationError):
            ToolResult.model_validate_json(json.dumps(bad))
    for params, ok in (
        ({"handle": "b3"}, True),
        ({"handle": "b3", "cursor": "c2"}, True),
        ({"handle": "3"}, False),
        ({}, False),
    ):
        assert (not validate(params, TOOLS_SCHEMA, "#/$defs/GetSectionParams")) is ok, params
    assert validate({"query": "x", "limit": 9}, TOOLS_SCHEMA, "#/$defs/SearchPassagesParams")
