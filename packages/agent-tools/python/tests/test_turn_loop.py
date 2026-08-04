"""The SHIPPED tool-calling loop (#76). Its sibling ``test_runtime_swappable.py`` keeps its own.

Two loops now exist and neither is redundant:

  * ``test_runtime_swappable.py::ChatCompletionsRuntime`` is written from scratch INSIDE that test
    file, to demonstrate that a second runtime can be written at all — F3.4's "<100 lines", which
    is only checkable by swapping. It is 37 executable lines and stays exactly where it is.
  * ``papertree_agent_tools.turn.ChatCompletionsTurn`` is the one a user reaches, through
    ``services/api``'s ``POST /papers/{id}/ask``. It is the same protocol plus the three things a
    shipped loop needs and a demonstration does not: a step budget that raises rather than
    returning a half-finished answer, model-side faults converted into tool messages, and a
    record of which tools were actually dispatched.

**No test in this file opens a socket.** The transport is a scripted callable, exactly as in
``test_runtime_swappable.py``, and ``MiniMaxProvider`` reads no environment variable at import.
"""

from __future__ import annotations

import ast
import inspect
import json
import threading
from collections.abc import Mapping, Sequence
from typing import Any

import pytest
from _agent_tools_fixtures import Seeded, run, seed_synthetic
from papertree_agent_tools import (
    DEFAULT_MAX_TOKENS,
    ChatCompletionsTurn,
    MiniMaxProvider,
    ProviderSettings,
    ToolStatus,
    TurnDidNotFinish,
    build_registry,
    strip_reasoning_envelope,
)
from papertree_agent_tools import turn as turn_module

# The real `dispatch`, taken from the module that DEFINES it. `turn.py` imports it and does not
# re-export it, so reading `turn_module.dispatch` is an `attr-defined` error under strict mypy;
# `monkeypatch.setattr(turn_module, "dispatch", …)` below still patches the name the loop calls,
# because `turn.py` bound it at import time.
from papertree_agent_tools.runtime import dispatch as real_dispatch

REGISTRY = build_registry()


class ScriptedTransport:
    """Returns queued responses and records every request. No network, by construction."""

    def __init__(self, responses: Sequence[Mapping[str, Any]]) -> None:
        self.responses = list(responses)
        self.requests: list[dict[str, Any]] = []

    def __call__(self, url: str, body: bytes, headers: Mapping[str, str], timeout: float) -> bytes:
        self.requests.append({"url": url, "body": json.loads(body)})
        return json.dumps(self.responses.pop(0)).encode("utf-8")


class _ThreadRecordingTransport(ScriptedTransport):
    """A ``ScriptedTransport`` that also records WHICH THREAD each model call was made on.

    The transport is the innermost point of ``provider.complete``, so its thread is the thread the
    blocking ``urlopen`` would have run on in production.
    """

    def __init__(self, responses: Sequence[Mapping[str, Any]]) -> None:
        super().__init__(responses)
        self.threads: list[int] = []

    def __call__(self, url: str, body: bytes, headers: Mapping[str, str], timeout: float) -> bytes:
        self.threads.append(threading.get_ident())
        return super().__call__(url, body, headers, timeout)


def _text(text: str) -> dict[str, Any]:
    return {
        "model": "MiniMax-M3",
        "choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": text}}],
        "usage": {"prompt_tokens": 7, "completion_tokens": 2},
    }


def _tool_call(name: str, arguments: Any, *, call_id: str = "call_1") -> dict[str, Any]:
    return {
        "model": "MiniMax-M3",
        "choices": [
            {
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {"name": name, "arguments": arguments},
                        }
                    ],
                },
            }
        ],
        "usage": {"prompt_tokens": 13, "completion_tokens": 4},
    }


@pytest.fixture(scope="session")
def synthetic(tmp_path_factory: pytest.TempPathFactory) -> Seeded:
    return seed_synthetic(tmp_path_factory.mktemp("agent-tools-turn"))


def _turn(transport: ScriptedTransport, *, max_steps: int = 6) -> ChatCompletionsTurn:
    return ChatCompletionsTurn(
        REGISTRY, MiniMaxProvider(ProviderSettings(api_key="k"), transport), max_steps=max_steps
    )


# ── the loop ─────────────────────────────────────────────────────────────────────────────


def test_the_shipped_loop_dispatches_a_real_tool_and_returns_the_final_text(
    synthetic: Seeded,
) -> None:
    """The whole protocol, against a real parsed database.

    Both halves are asserted: the tool was DISPATCHED (against a stub that returns the second
    canned response having called nothing, ``calls`` would be empty and the text identical) and
    the tool's real output went back as a ``tool`` message rather than as prose.
    """
    block_id = synthetic.first_of_type("paragraph")
    transport = ScriptedTransport(
        [_tool_call("get_block", json.dumps({"block_id": block_id})), _text("the answer")]
    )
    with synthetic.handle() as handle:
        outcome = run(
            _turn(transport).run(
                system_prompt="be grounded",
                user_message="what is this?",
                context=synthetic.context(handle),
            )
        )

    assert outcome.text == "the answer"
    assert outcome.dispatched == 1
    assert outcome.calls[0].tool == "get_block"
    assert outcome.calls[0].status is ToolStatus.OK
    assert outcome.steps == 2
    assert outcome.model == "MiniMax-M3"
    # Tokens accumulate ACROSS steps; a loop that reported only the last call would say 7/2.
    assert (outcome.input_tokens, outcome.output_tokens) == (20, 6)

    delivered = json.loads(transport.requests[1]["body"]["messages"][-1]["content"])
    assert delivered["status"] == "ok"
    assert "residual learning framework" in delivered["data"]["text"]


def test_the_transcript_carries_the_assistant_turn_before_the_tool_result(
    synthetic: Seeded,
) -> None:
    """OpenAI's protocol requires the assistant message that REQUESTED the call to precede it.

    Skipping it produces a 400 from the real endpoint and nothing from a scripted one, which is
    why it is asserted here rather than discovered against a live model.
    """
    block_id = synthetic.first_of_type("paragraph")
    transport = ScriptedTransport(
        [_tool_call("get_block", json.dumps({"block_id": block_id})), _text("x")]
    )
    with synthetic.handle() as handle:
        run(
            _turn(transport).run(
                system_prompt="s", user_message="q", context=synthetic.context(handle)
            )
        )
    roles = [m["role"] for m in transport.requests[1]["body"]["messages"]]
    assert roles == ["system", "user", "assistant", "tool"]


def test_a_hallucinated_tool_name_comes_back_as_a_refusal_not_a_traceback(
    synthetic: Seeded,
) -> None:
    """``registry.py``: the runtime adapter is the layer that tells the model about this.

    A 500 for the reader is the wrong answer to a mistake the model can correct on the next step.
    """
    transport = ScriptedTransport([_tool_call("summarise_paper", "{}"), _text("recovered")])
    with synthetic.handle() as handle:
        outcome = run(
            _turn(transport).run(
                system_prompt="s", user_message="q", context=synthetic.context(handle)
            )
        )
    assert outcome.text == "recovered"
    assert outcome.calls[0].status is ToolStatus.REFUSED
    delivered = json.loads(transport.requests[1]["body"]["messages"][-1]["content"])
    assert "is not a registered tool" in delivered["reason"]


def test_arguments_that_are_not_json_come_back_as_a_refusal(synthetic: Seeded) -> None:
    transport = ScriptedTransport([_tool_call("get_block", "{block_id: oops"), _text("recovered")])
    with synthetic.handle() as handle:
        outcome = run(
            _turn(transport).run(
                system_prompt="s", user_message="q", context=synthetic.context(handle)
            )
        )
    assert outcome.calls[0].status is ToolStatus.REFUSED
    delivered = json.loads(transport.requests[1]["body"]["messages"][-1]["content"])
    assert "not a JSON object" in delivered["reason"]


def test_a_missing_required_argument_comes_back_as_a_refusal(synthetic: Seeded) -> None:
    """FOUND BY THE LIVE MODEL, NOT BY ME. See ``turn.py``'s header for the transcript.

    MiniMax-M3 called ``verify_answer_grounding`` without ``claims`` on the first real run, and
    the loop died with ``ToolArgumentError`` while nine scripted tests were green. ``schema.py``
    had already written down whose job this is: *"The runtime adapter is supposed to catch this by
    its own name and hand the model back a message it can correct from."*
    """
    transport = ScriptedTransport(
        [
            _tool_call(
                "verify_answer_grounding",
                json.dumps(
                    {"states": "x", "interpretation": None, "supporting_block_ids": ["blk_a"]}
                ),
            ),
            _text("recovered"),
        ]
    )
    with synthetic.handle() as handle:
        outcome = run(
            _turn(transport).run(
                system_prompt="s", user_message="q", context=synthetic.context(handle)
            )
        )
    assert outcome.text == "recovered"
    assert outcome.calls[0].status is ToolStatus.REFUSED
    delivered = json.loads(transport.requests[1]["body"]["messages"][-1]["content"])
    assert "/claims: is required and was not supplied" in delivered["reason"]


def test_a_no_argument_tool_is_callable_however_the_model_spells_empty(synthetic: Seeded) -> None:
    """Eight of the eighteen tools take no arguments, and models spell that three ways.

    ``""``, ``null`` and ``"{}"`` must all reach the handler. Refusing two of the three would
    make a third of the registry intermittently unreachable, which is invisible in a stub.
    """
    for spelling in ("", None, "{}"):
        transport = ScriptedTransport(
            [_tool_call("get_paper_metadata", spelling), _text("answered")]
        )
        with synthetic.handle() as handle:
            outcome = run(
                _turn(transport).run(
                    system_prompt="s", user_message="q", context=synthetic.context(handle)
                )
            )
        assert outcome.calls[0].status is ToolStatus.OK, spelling


def test_a_reply_truncated_at_the_token_ceiling_raises_rather_than_being_returned(
    synthetic: Seeded,
) -> None:
    """`finish_reason == "length"` means the reply is cut off mid-sentence — or mid-JSON.

    FOUND LIVE, like the one above: with the provider's default 2048 output tokens, MiniMax-M3's
    `<think>` block plus a full JSON answer intermittently overran, and the caller saw
    `JSONDecodeError: Expecting value: line 1 column 1` — a message that blames the model for
    something the budget did. The ceiling was raised AND the truncation is now detected, because a
    ceiling can always be exceeded and half an answer must never be presented as a whole one.
    """
    truncated = _text('{"states": "the paper prese')
    truncated["choices"][0]["finish_reason"] = "length"
    transport = ScriptedTransport([truncated])
    with (
        synthetic.handle() as handle,
        pytest.raises(TurnDidNotFinish, match="finish_reason='length'"),
    ):
        run(
            _turn(transport).run(
                system_prompt="s", user_message="q", context=synthetic.context(handle)
            )
        )


def test_the_loop_asks_for_more_output_tokens_than_the_providers_default(
    synthetic: Seeded,
) -> None:
    """The number is asserted ON THE WIRE, not read off a constant.

    A default that is set and never sent is exactly the "metric that is never called" failure
    AGENTS.md §2 records: it reads as configured and does nothing.
    """
    transport = ScriptedTransport([_text("x")])
    with synthetic.handle() as handle:
        run(
            _turn(transport).run(
                system_prompt="s", user_message="q", context=synthetic.context(handle)
            )
        )
    assert transport.requests[0]["body"]["max_tokens"] == DEFAULT_MAX_TOKENS == 4096


def test_a_reasoning_models_think_block_is_unwrapped_and_the_answer_is_untouched() -> None:
    """MiniMax-M3 puts its chain of thought in `message.content`. Measured, not anticipated.

    The three cases that matter: a normal reply is unwrapped, a reply with no envelope is returned
    byte-for-byte, and an UNTERMINATED `<think>` is left alone rather than truncated — a reply that
    is all reasoning and no answer must fail to decode, because it is a failure.
    """
    assert strip_reasoning_envelope('<think>reasoning here</think>\n\n{"a": 1}') == '{"a": 1}'
    assert strip_reasoning_envelope('{"a": 1}') == '{"a": 1}'
    assert strip_reasoning_envelope("<think>never closed") == "<think>never closed"
    # The answer's own bytes are never rewritten — only the packaging in front of them is removed.
    assert strip_reasoning_envelope('<think>x</think>  {"b": "<think>"}') == '{"b": "<think>"}'


def test_a_model_that_never_stops_asking_raises_rather_than_returning_a_half_answer(
    synthetic: Seeded,
) -> None:
    """EPIC-03 §4: *"Failed generations are never persisted as content."*

    The last assistant message of an unfinished turn reads like an answer. Returning it is how v1
    came to store ``"_Failed to generate summary: …_"`` as a page summary.
    """
    block_id = synthetic.first_of_type("paragraph")
    call = _tool_call("get_block", json.dumps({"block_id": block_id}))
    transport = ScriptedTransport([call, call])
    with (
        synthetic.handle() as handle,
        pytest.raises(TurnDidNotFinish, match="after 2 steps"),
    ):
        run(
            _turn(transport, max_steps=2).run(
                system_prompt="s", user_message="q", context=synthetic.context(handle)
            )
        )


def test_a_turn_that_needs_no_tool_still_answers(synthetic: Seeded) -> None:
    """``dispatched == 0`` is a legitimate outcome, and the number is REPORTED rather than hidden.

    That is what lets ``test_live_provider.py`` assert ``>= 1`` and mean something by it.
    """
    transport = ScriptedTransport([_text("no lookup needed")])
    with synthetic.handle() as handle:
        outcome = run(
            _turn(transport).run(
                system_prompt="s", user_message="q", context=synthetic.context(handle)
            )
        )
    assert (outcome.text, outcome.dispatched, outcome.steps) == ("no lookup needed", 0, 1)


# ── the one blocking call in an all-async chain ──────────────────────────────────────────


def test_the_model_call_happens_off_the_event_loop_thread(synthetic: Seeded) -> None:
    """``provider.complete`` is SYNCHRONOUS, and this turn is awaited by an ``async def`` route.

    ``provider.py:181`` is ``urllib.request.urlopen`` — a blocking socket read, for as long as
    ``timeout_seconds``. ``services/api``'s ``deps.py`` made every dependency and every route
    ``async`` on purpose (sqlite connections are thread-bound), so ``POST /ask`` runs ON the event
    loop thread; calling the model from there stops the whole service — every other reader's page
    fetch included — for the length of up to ``DEFAULT_MAX_STEPS`` model calls.

    deps.py's header accepts blocking the loop for sqlite and says why: *"the reads are
    milliseconds"*. A model call is seconds. That argument does not extend to this one, so the
    provider call is handed to the default executor and the loop stays free.

    ASSERTED ON THE THREAD ID, NOT ON A CLOCK. ``run()`` is ``asyncio.run``, which drives the loop
    on THIS thread, so the transport recording a different id is exactly the property, with no
    sleep to make it flaky. Watched failing before the fix: ``complete`` called inline recorded
    this thread and the assertion read ``assert 8758964480 not in [8758964480]``.
    """
    transport = _ThreadRecordingTransport([_text("answered")])
    with synthetic.handle() as handle:
        run(
            _turn(transport).run(
                system_prompt="s", user_message="q", context=synthetic.context(handle)
            )
        )

    assert transport.threads, "the transport was never called"
    assert threading.get_ident() not in transport.threads, (
        "provider.complete ran on the event loop thread; a blocking urlopen there stalls every "
        "other request the service is serving"
    )


def test_tool_dispatch_stays_on_the_event_loop_thread(
    synthetic: Seeded, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The COMPLEMENT of the test above, and the reason the fix is one call and not a policy.

    ONLY the provider call moves. Tool dispatch must NOT: it reads through ``AgentDataHandle``'s
    sqlite connection, and ``sqlite3`` objects belong to the thread that created them — the exact
    ``ProgrammingError`` ``deps.py``'s header quotes from ``app.py:271``. A well-meaning "run the
    whole loop in a thread" would reintroduce that bug, and intermittently, because a threadpool
    only sometimes hands back a different worker. So the boundary is pinned by a test rather than
    described in a comment.

    Recorded by wrapping the ``dispatch`` the loop actually calls — ``turn.py`` binds it at import,
    so patching the module attribute is patching the real edge.
    """
    dispatch_threads: list[int] = []

    async def recording(*args: Any, **kwargs: Any) -> Any:
        dispatch_threads.append(threading.get_ident())
        return await real_dispatch(*args, **kwargs)

    monkeypatch.setattr(turn_module, "dispatch", recording)

    block_id = synthetic.first_of_type("paragraph")
    transport = _ThreadRecordingTransport(
        [_tool_call("get_block", json.dumps({"block_id": block_id})), _text("done")]
    )
    with synthetic.handle() as handle:
        outcome = run(
            _turn(transport).run(
                system_prompt="s", user_message="q", context=synthetic.context(handle)
            )
        )

    assert outcome.dispatched == 1
    assert dispatch_threads == [threading.get_ident()], (
        f"tool dispatch left the event loop thread: {dispatch_threads} vs "
        f"{threading.get_ident()}; sqlite connections are bound to their creating thread"
    )


# ── the swappability bound, preserved rather than moved ──────────────────────────────────


def _executable_lines(source: str) -> int:
    """``test_runtime_swappable.py``'s counter, re-derived here rather than imported.

    Importing it would make one test file depend on another's private helper; re-deriving means
    the two would have to be wrong in the same way. Same rule: no blanks, no comments, no
    docstrings, found with ``ast`` rather than by a heuristic.
    """
    tree = ast.parse(source)
    doc_lines: set[int] = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
            and node.end_lineno is not None
        ):
            doc_lines.update(range(node.lineno, node.end_lineno + 1))
    return sum(
        1
        for number, line in enumerate(source.splitlines(), start=1)
        if line.strip() and not line.strip().startswith("#") and number not in doc_lines
    )


def test_the_shipped_loop_is_under_one_hundred_executable_lines() -> None:
    """F3.4's bound applies to the loop that ships, not only to the one written in a test.

    Counted on the CLASS, which is the unit ``test_runtime_swappable.py`` counts for its own
    alternative runtime (37 lines). The module around it carries the result dataclasses and the
    argument decoder, which are not the loop.
    """
    count = _executable_lines(inspect.getsource(turn_module.ChatCompletionsTurn))
    assert count < 100, f"ChatCompletionsTurn is {count} executable lines"


def test_the_shipped_loop_imports_no_agent_framework() -> None:
    """The registry's whole claim is that nothing framework-shaped reaches it.

    A shipped loop is the most likely place for that to erode, because a framework is genuinely
    convenient here. Asserted on the module's import statements rather than on prose.
    """
    tree = ast.parse(inspect.getsource(turn_module))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            imported.add(node.module.split(".")[0])
    # An ALLOWLIST OF STDLIB MODULES, not a count. `asyncio` and `functools` were added for the
    # executor hand-off above; both are stdlib, which is what `pyproject.toml`'s "Stdlib only by
    # design" promises, and neither is framework-shaped. The guard is unchanged in kind: any
    # third-party name — `pydantic_ai`, `langchain`, `openai` — still fails it, and `pyproject`'s
    # dependency list is separately gated by `uv sync --locked`.
    assert imported <= {
        "__future__",
        "asyncio",
        "collections",
        "dataclasses",
        "functools",
        "json",
        "typing",
    } | {"papertree_agent_tools"}, sorted(imported)
