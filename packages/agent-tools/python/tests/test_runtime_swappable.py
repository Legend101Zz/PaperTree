"""F3.4: the runtime is swappable in under 100 lines, and here is the swap.

EPIC-03 §4: *"The ~20 tools live in a plain registry the project owns; Pydantic AI merely adapts
it. **The runtime must stay swappable in <100 lines.**"*

A claim like that is only checkable by doing it, so this file does two things a line-count
assertion alone would not:

  1. it counts ``runtime.py``'s executable lines and fails over 100 — the shipped adapter;
  2. it WRITES A SECOND ADAPTER, from scratch, in this file, and drives the same registry
     through a complete two-step tool-calling turn with it against a real parsed database. The
     second adapter's own executable lines are counted too. If the registry had grown a
     framework-shaped dependency, that loop could not have been written in twenty lines.

The provider is exercised with an injected transport. **No test in this file opens a socket** —
the transport is a scripted callable, and ``MiniMaxProvider`` has no module-level client and
reads no environment variable at import time, so there is no way to reach the network by
forgetting to patch something.
"""

from __future__ import annotations

import ast
import inspect
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest
from _agent_tools_fixtures import Seeded, run, seed_synthetic
from papertree_agent_tools import (
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    DEFAULT_VISION_MODEL,
    KNOWN_VISION_MODELS,
    Completion,
    MiniMaxProvider,
    ProviderError,
    ProviderSettings,
    PydanticAiAdapter,
    ToolContext,
    ToolRegistry,
    ToolStatus,
    VisionModelUnverified,
    build_registry,
    dispatch,
    tool_definitions,
)
from papertree_agent_tools import runtime as runtime_module
from papertree_prompts import Toolset

REPO = Path(__file__).resolve().parents[4]
REGISTRY = build_registry()


# ── counting executable lines ────────────────────────────────────────────────────────────


def executable_lines(source: str) -> int:
    """Lines that are neither blank, nor comments, nor inside a docstring.

    Docstring ranges are found with ``ast`` rather than by a heuristic, because "under 100 lines"
    is a claim about CODE and a rule that counted prose would be trivially gamed in both
    directions — by deleting documentation, or by writing the whole adapter on one line.
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


def test_the_shipped_adapter_is_under_one_hundred_executable_lines() -> None:
    """The epic's number, asserted rather than asserted-in-prose.

    FAILED ON PURPOSE ONCE: with the bound temporarily set to ``< 20`` this failed and printed
    the real count, which is how the ``executable_lines`` helper was confirmed to be counting
    code rather than the module docstring.
    """
    count = executable_lines(Path(runtime_module.__file__).read_text(encoding="utf-8"))
    assert count < 100, f"runtime.py is {count} executable lines"


# ── the shipped adapter reports itself unavailable rather than crashing ──────────────────


def test_pydantic_ai_is_genuinely_not_installed_which_is_this_tests_premise() -> None:
    """Without this, the next two tests would pass on an environment where it IS installed —
    for a completely different reason — and stop testing the degradation path."""
    import importlib.util

    assert importlib.util.find_spec("pydantic_ai") is None


def test_the_adapter_reports_unavailable_with_the_reason_and_the_fix() -> None:
    """The ``DoclingAdapter`` shape: ``available`` is about the ENVIRONMENT, not the capability.

    ``adapters.py``: *"an adapter that was never INSTALLED has not failed at anything."* The
    reason names the lock measurement, because "why isn't this a dependency" is the first
    question anyone asks and the answer is not obvious.
    """
    adapter = PydanticAiAdapter(REGISTRY)
    assert adapter.available is False
    reason = adapter.status.reason
    assert "pydantic_ai is not installed" in reason
    assert "uv sync --locked --all-packages" in reason
    assert "22 packages" in reason
    assert "tool_definitions() + dispatch()" in reason


def test_building_the_adapter_raises_with_the_fix_rather_than_a_module_not_found() -> None:
    adapter = PydanticAiAdapter(REGISTRY)
    with pytest.raises(RuntimeError, match="not installed"):
        adapter.build(model="MiniMax-M3", system_prompt="x")


def test_importing_the_package_does_not_import_pydantic_ai() -> None:
    """The lazy import is inside ``build``/``status``, so merely importing must not touch it."""
    import subprocess
    import sys

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys, papertree_agent_tools; print('pydantic_ai' in sys.modules)",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "False"


# ── the wire shape the registry hands any runtime ────────────────────────────────────────


@pytest.fixture(scope="session")
def synthetic(tmp_path_factory: pytest.TempPathFactory) -> Seeded:
    return seed_synthetic(tmp_path_factory.mktemp("agent-tools-runtime"))


def test_tool_definitions_are_the_openai_function_calling_shape(synthetic: Seeded) -> None:
    with synthetic.handle() as handle:
        definitions = tool_definitions(REGISTRY, context=synthetic.context(handle))
    assert len(definitions) == len(REGISTRY)
    for definition in definitions:
        assert definition["type"] == "function"
        function = definition["function"]
        assert set(function) == {"name", "description", "parameters"}
        assert function["parameters"]["type"] == "object"
    assert [d["function"]["name"] for d in definitions] == list(REGISTRY.names())


def test_tool_definitions_are_filtered_by_the_turns_toolset(synthetic: Seeded) -> None:
    """A tool outside the turn is ABSENT from the list, not refused on call.

    That is precisely what ``build_system_prompt`` tells the model — "anything outside it is
    ABSENT, not withheld: it is not in your tool list and there is no way to call it" — and a
    prompt that says so while the list says otherwise is a lie the model will discover.
    """
    from papertree_prompts import TurnCaps

    with synthetic.handle() as handle:
        context = synthetic.context(
            handle,
            caps=TurnCaps(untrusted_input=False, sensitive_scope=True, state_or_egress=True),
        )
        assert context.toolset is Toolset.PRIVILEGED_NO_DOCUMENT_TEXT
        assert tool_definitions(REGISTRY, context=context) == []


# ── the provider ─────────────────────────────────────────────────────────────────────────


class RecordingTransport:
    """A scripted transport. Returns queued responses and records every request."""

    def __init__(self, responses: Sequence[Mapping[str, Any]]) -> None:
        self.responses = list(responses)
        self.requests: list[dict[str, Any]] = []

    def __call__(self, url: str, body: bytes, headers: Mapping[str, str], timeout: float) -> bytes:
        self.requests.append(
            {"url": url, "body": json.loads(body), "headers": dict(headers), "timeout": timeout}
        )
        return json.dumps(self.responses.pop(0)).encode("utf-8")


def _text_response(text: str) -> dict[str, Any]:
    return {
        "model": "MiniMax-M3",
        "choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": text}}],
        "usage": {"prompt_tokens": 11, "completion_tokens": 3},
    }


def _tool_call_response(name: str, arguments: Mapping[str, Any]) -> dict[str, Any]:
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
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": name, "arguments": json.dumps(arguments)},
                        }
                    ],
                },
            }
        ],
        "usage": {"prompt_tokens": 20, "completion_tokens": 8},
    }


def test_the_provider_targets_the_openai_compatible_endpoint_with_a_bearer_token() -> None:
    transport = RecordingTransport([_text_response("hello")])
    provider = MiniMaxProvider(ProviderSettings(api_key="k"), transport)
    completion = provider.complete([{"role": "user", "content": "hi"}])

    request = transport.requests[0]
    assert request["url"] == "https://api.minimax.io/v1/chat/completions"
    assert request["headers"]["Authorization"] == "Bearer k"
    assert request["body"]["model"] == "MiniMax-M3"
    # Zero, so a deterministic verifier is not sitting behind a non-deterministic generator.
    assert request["body"]["temperature"] == 0.0
    assert completion == Completion(
        text="hello",
        tool_calls=(),
        finish_reason="stop",
        input_tokens=11,
        output_tokens=3,
        model="MiniMax-M3",
    )


def test_tools_are_sent_only_when_there_are_tools(synthetic: Seeded) -> None:
    transport = RecordingTransport([_text_response("a"), _text_response("b")])
    provider = MiniMaxProvider(ProviderSettings(api_key="k"), transport)
    provider.complete([{"role": "user", "content": "hi"}])
    assert "tools" not in transport.requests[0]["body"]

    with synthetic.handle() as handle:
        definitions = tool_definitions(REGISTRY, context=synthetic.context(handle))
    provider.complete([{"role": "user", "content": "hi"}], tools=definitions)
    assert len(transport.requests[1]["body"]["tools"]) == len(REGISTRY)
    assert transport.requests[1]["body"]["tool_choice"] == "auto"


def test_a_provider_with_no_api_key_is_unavailable_and_raises_rather_than_returning_prose() -> None:
    """EPIC-03 §4: *"Failed generations are never persisted as content."*

    v1 stored ``"_Failed to generate summary: …_"`` as a page summary and never retried it.
    Raising is what makes writing that string impossible at the call site.
    """
    provider = MiniMaxProvider(ProviderSettings(api_key=""), RecordingTransport([]))
    assert provider.available is False
    with pytest.raises(ProviderError, match="no llm_api_key"):
        provider.complete([{"role": "user", "content": "hi"}])


def test_a_vision_call_at_a_text_model_is_refused_before_it_is_sent() -> None:
    """The silent failure this refusal converts into a loud one.

    M2.x accepts a vision request's SHAPE and answers confidently about nothing, so a downgrade
    of ``llm_model`` for cost leaves no trace in a log. The transport is asserted to have
    received nothing, which is what "before it is sent" means.
    """
    transport = RecordingTransport([_text_response("nonsense")])
    provider = MiniMaxProvider(
        ProviderSettings(api_key="k", model="MiniMax-M2.5", vision_model="MiniMax-M2.5"),
        transport,
    )
    with pytest.raises(VisionModelUnverified, match="confident"):
        provider.complete_with_image([{"role": "user", "content": []}])
    assert transport.requests == []

    provider.complete_with_image(
        [{"role": "user", "content": []}], allow_unverified_vision_model=True
    )
    assert transport.requests[0]["body"]["model"] == "MiniMax-M2.5"


def test_the_vision_model_setting_is_separate_from_the_model_setting() -> None:
    settings = ProviderSettings(api_key="k", model="MiniMax-M2.5")
    assert settings.model == "MiniMax-M2.5"
    assert settings.vision_model == DEFAULT_VISION_MODEL == "MiniMax-M3"
    assert sorted(KNOWN_VISION_MODELS) == ["MiniMax-M3"]


#: Files outside ``packages/agent-tools`` that write a provider constant out as a literal, with the
#: issue that owns each. A LEDGER, enforced in both directions like ``reachable.spec``'s: a NEW copy
#: fails, and a listed file that no longer carries one must be delisted so the ledger cannot outlive
#: the debt. Session A found these while replacing the cross-tree read against v1 and did not fix
#: them — ``services/document-worker/**`` is Session B's exclusive path (AGENTS.md §1).
#:
#: **#88 IS NOW DECIDED, AND THE DECISION IS THAT THESE TWO ENTRIES ARE PERMANENT.** The ruling:
#: ``services/document-worker`` does NOT depend on ``papertree-agent-tools``; the duplication stays
#: and is DECLARED with a pointer at each of the three sites. The deciding reason is that
#: ``pipeline.py``'s ``vlm_model`` is a config default feeding ``parser_config_hash``, so an
#: imported default would silently move every parse's config hash on an unrelated package upgrade.
#: Written out beside the constants in ``papertree_agent_tools/provider.py``.
#:
#: So this ledger is no longer provisional, and what it means changed with the ruling: the entries
#: are not a debt awaiting repayment, they are the declaration itself. Both assertions below stand
#: unweakened and both still matter — a THIRD copy is still a defect, and a listed file that stops
#: carrying a constant must still be delisted rather than left to rot.
KNOWN_CONSTANT_COPIES: tuple[tuple[str, str], ...] = (
    ("services/document-worker/python/papertree_document_worker/vlm.py", "#88"),
    ("services/document-worker/python/papertree_document_worker/pipeline.py", "#88"),
)


def test_the_provider_constants_have_no_new_live_definition() -> None:
    """What replaced the drift check against ``apps/api``, and why the replacement is different.

    Until #75 this test read ``apps/api/papertree_api/config.py`` and compared its ``llm_model`` /
    ``llm_vision_model`` / ``llm_base_url`` against the constants below, because v1 sat outside
    this uv workspace and the values were duplicated. Duplication that nothing checks drifts.

    v1 is now ``archive/``, and ``archive/README.md`` forbids importing from it or depending on it.
    A test that reads it would make it load-bearing, which is precisely what that file rules out —
    so the old assertion was removed rather than re-pointed. It was watched failing first
    (``.../apps/api/papertree_api/config.py is gone``); the removal is recorded in #75's PR.

    Its premise went with it: there is one live definition now. So this asserts what still holds —
    that no *new* second definition appears inside the gated tree.

    It is a ledger rather than a ban because whether ``services/document-worker`` ought to import
    these from here was a real architectural question this test had no standing to decide. **It has
    since been decided, in #88: it should not**, because ``pipeline.py``'s ``vlm_model`` is a config
    default that feeds ``parser_config_hash`` and an imported default would move every parse's
    config hash on an unrelated package upgrade. The duplication is therefore declared rather than
    removed, with a pointer at each of the three sites, and the ledger below is that declaration's
    enforcement rather than a placeholder for it. See ``KNOWN_CONSTANT_COPIES``.
    """
    gated = sorted(
        path
        for root in ("packages", "services")
        for path in (REPO / root).rglob("*.py")
        if path.name != "provider.py" and "/tests/" not in path.as_posix()
    )
    assert len(gated) > 50, f"the scan found only {len(gated)} files; it is not scanning the repo"

    ledger = {path for path, _ in KNOWN_CONSTANT_COPIES}
    carries: set[str] = set()
    fresh: dict[str, list[str]] = {}

    for constant in (DEFAULT_MODEL, DEFAULT_VISION_MODEL, DEFAULT_BASE_URL):
        for path in gated:
            rel = path.relative_to(REPO).as_posix()
            if f'"{constant}"' not in path.read_text(encoding="utf-8"):
                continue
            carries.add(rel)
            if rel not in ledger:
                fresh.setdefault(rel, []).append(constant)

    assert fresh == {}, (
        f"a provider constant is written out afresh in {sorted(fresh)}. Import it from "
        f"papertree_agent_tools, or add it to KNOWN_CONSTANT_COPIES with the issue that owns it."
    )
    assert sorted(ledger - carries) == [], (
        f"{sorted(ledger - carries)} no longer carries a provider constant - delete those lines "
        f"from KNOWN_CONSTANT_COPIES. A ledger may not outlive its debt."
    )


def test_a_response_missing_every_optional_field_does_not_crash_a_turn() -> None:
    """A caller can act on an empty completion and cannot act on a traceback."""
    transport = RecordingTransport([{}])
    provider = MiniMaxProvider(ProviderSettings(api_key="k"), transport)
    completion = provider.complete([{"role": "user", "content": "hi"}])
    assert completion.text == ""
    assert completion.tool_calls == ()
    assert completion.model == "MiniMax-M3"


# ── THE SWAP: a second runtime, written here, driving the same registry ──────────────────


class ChatCompletionsRuntime:
    """A complete alternative runtime. No framework, no inheritance, no registry changes.

    This is the demonstration the epic asks for. It speaks the OpenAI tool-calling protocol
    directly against :class:`MiniMaxProvider`, and everything it needs from this package is two
    functions — ``tool_definitions`` and ``dispatch``. That is the entire surface a runtime binds
    to, which is why replacing one costs twenty lines rather than a refactor.
    """

    def __init__(self, registry: ToolRegistry, provider: MiniMaxProvider) -> None:
        self.registry = registry
        self.provider = provider
        self.calls: list[tuple[str, ToolStatus]] = []

    async def turn(
        self, question: str, context: ToolContext, *, system_prompt: str, max_steps: int = 4
    ) -> str:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question},
        ]
        tools = tool_definitions(self.registry, context=context)
        for _ in range(max_steps):
            completion = self.provider.complete(messages, tools=tools)
            if not completion.wants_tools:
                return completion.text
            messages.append(
                {"role": "assistant", "content": None, "tool_calls": list(completion.tool_calls)}
            )
            for call in completion.tool_calls:
                function = call["function"]
                result = await dispatch(
                    self.registry,
                    function["name"],
                    json.loads(function["arguments"]),
                    context=context,
                )
                self.calls.append((result.tool, result.status))
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call["id"],
                        "content": json.dumps(result.as_dict()),
                    }
                )
        raise RuntimeError(f"the model did not finish within {max_steps} steps")


def test_a_second_runtime_written_from_scratch_drives_the_same_registry(
    synthetic: Seeded,
) -> None:
    """The swap, end to end, against a real parsed database.

    The scripted model asks for ``get_block``, receives the real tool result, and answers. Both
    the tool call and the final answer are asserted, so a runtime that dispatched nothing and
    returned the second canned response would fail.
    """
    block_id = synthetic.first_of_type("paragraph")
    transport = RecordingTransport(
        [
            _tool_call_response("get_block", {"block_id": block_id}),
            _text_response("The paper presents a residual learning framework."),
        ]
    )
    provider = MiniMaxProvider(ProviderSettings(api_key="k"), transport)
    alternative = ChatCompletionsRuntime(REGISTRY, provider)

    with synthetic.handle() as handle:
        context = synthetic.context(handle)
        answer = run(alternative.turn("what is this?", context, system_prompt="be grounded"))

    assert answer == "The paper presents a residual learning framework."
    assert alternative.calls == [("get_block", ToolStatus.OK)]
    # The tool's real output went back to the model as a tool message, not as prose.
    tool_message = json.loads(transport.requests[1]["body"]["messages"][-1]["content"])
    assert tool_message["status"] == "ok"
    assert "residual learning framework" in tool_message["data"]["text"]


def test_the_second_runtime_is_itself_under_one_hundred_lines() -> None:
    """The claim is "swappable in <100 lines", so the swap gets counted too.

    Counting only the shipped adapter would measure how tersely THIS adapter was written; it
    would say nothing about whether a different one could be written at all.
    """
    count = executable_lines(inspect.getsource(ChatCompletionsRuntime))
    assert count < 100, f"the alternative runtime is {count} executable lines"


def test_an_alternative_runtime_gets_the_honest_unavailable_results_too(
    synthetic: Seeded,
) -> None:
    """A swapped runtime inherits the honesty, because the honesty lives in ``ToolResult``.

    If "say why you cannot answer" were an adapter's job, every new adapter would have to
    re-implement it and the first one to forget would ship a model a bare ``[]``.
    """
    transport = RecordingTransport(
        [
            _tool_call_response("search_semantic_blocks", {"query": "residual learning"}),
            _text_response("I cannot search semantically; there is no embedding model."),
        ]
    )
    alternative = ChatCompletionsRuntime(
        REGISTRY, MiniMaxProvider(ProviderSettings(api_key="k"), transport)
    )
    with synthetic.handle() as handle:
        run(alternative.turn("find X", synthetic.context(handle), system_prompt="s"))

    assert alternative.calls == [("search_semantic_blocks", ToolStatus.UNAVAILABLE)]
    delivered = json.loads(transport.requests[1]["body"]["messages"][-1]["content"])
    assert delivered["status"] == "unavailable"
    assert "NO embedding model" in delivered["reason"]
