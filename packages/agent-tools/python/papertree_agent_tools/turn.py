"""The tool-calling loop, as SHIPPED code. Until #76 the only complete one lived in a test.

WHY THIS FILE EXISTS, STATED AS THE DEFECT IT CLOSES

``tests/test_runtime_swappable.py``'s ``ChatCompletionsRuntime`` was a complete turn loop —
messages, ``tool_calls``, dispatch, append, repeat — and it was the ONLY one in the repository.
Nothing a user could reach ran it. That is `findings.md` §A's failure class in its purest form: a
capability that is exercised by a test and by nothing else reports green forever while the product
cannot do the thing.

So the loop moves here and the test's copy STAYS. Neither is a duplicate of the other's job: the
test's version is written from scratch, in the test file, to demonstrate that a second runtime can
be written at all (F3.4's "<100 lines" claim, which is only checkable by swapping). This one is
what ``services/api``'s ``POST /papers/{id}/ask`` drives.

WHERE IT IS NOT, AND WHY

  * NOT in ``provider.py``. Its docstring is explicit: *"Driving a conversation … is the RUNTIME's
    job, and the runtime is the part that is supposed to be swappable in under 100 lines. Putting
    the loop here would move the swappable part into the unswappable file."*
  * NOT in ``runtime.py``. ``test_runtime_swappable.py`` counts that file's executable lines and
    fails over 100. Measured: ``runtime.py`` is **54** and :class:`ChatCompletionsTurn` is **65**,
    so appending would make it 119 — either a red test or a raised bound, and the bound IS F3.4's
    acceptance criterion. ``tests/test_turn_loop.py`` counts this class instead and fails over
    100, exactly as ``test_runtime_swappable.py`` counts its own 37-line alternative runtime. The
    property is preserved rather than moved. (The module as a whole is 126 lines; the extra 61 are
    the result dataclasses and the argument decoder, which are not the loop.)

WHAT IT BINDS TO — the same two functions any runtime binds to: ``tool_definitions`` and
``dispatch``. Nothing here imports an agent framework, and the registry does not know this file
exists.

EVERY MODEL-SIDE FAULT COMES BACK AS A TOOL MESSAGE, NEVER AS A TRACEBACK

``registry.py`` raises ``UnknownToolError`` for a name it does not have and
``ToolNotPermittedError`` for a name outside the turn's toolset, and says why: *"the runtime
adapter is the layer that knows how to tell that particular model about it."* ``schema.py`` says
the same of ``ToolArgumentError``: *"The runtime adapter is supposed to catch this by its own name
and hand the model back a message it can correct from."* This is that layer. A model that
hallucinates a tool name, calls one it was not given, emits arguments that are not JSON, or omits a
required argument gets a ``refused`` ``ToolResult`` in the tool slot and corrects itself on the
next step. Raising instead would turn a recoverable model mistake into a 500 for the reader.

**``ToolArgumentError`` was NOT in that list until a live model found it.** The first real run of
``tests/test_live_provider.py`` had MiniMax-M3 call ``verify_answer_grounding`` without ``claims``;
the turn died with ``ToolArgumentError: /claims: is required and was not supplied`` instead of
telling the model what it had missed. Nine scripted tests were green at the time. That is the
whole argument for the live test existing: a scripted transport only sends the mistakes its author
thought of, and *omitting a required argument* was not one of them.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

from papertree_agent_tools.provider import MiniMaxProvider
from papertree_agent_tools.registry import (
    ToolContext,
    ToolNotPermittedError,
    ToolRegistry,
    UnknownToolError,
)
from papertree_agent_tools.results import ToolResult, ToolStatus
from papertree_agent_tools.runtime import dispatch, tool_definitions
from papertree_agent_tools.schema import ToolArgumentError

__all__ = [
    "DEFAULT_MAX_STEPS",
    "DEFAULT_MAX_TOKENS",
    "ChatCompletionsTurn",
    "DispatchedCall",
    "TurnDidNotFinish",
    "TurnOutcome",
    "strip_reasoning_envelope",
]

#: MiniMax-M3 is a reasoning model and puts its chain of thought in ``<think>…</think>`` INSIDE
#: ``message.content``, before the answer. Measured on a live call, 2026-08-04:
#:
#:     '<think>The user is asking what this paper presents. … Let me cite the specific block.
#:      </think>\n\n{"claims": [ … ]}'
#:
#: So a caller that asks for JSON and calls ``json.loads`` on ``Completion.text`` gets
#: ``Expecting value: line 1 column 1``. It is not in ``provider.py`` because it is not part of the
#: OpenAI wire shape — ``content`` is a string and this is what one model puts in it — and
#: ``_completion_from`` deliberately decodes the ENVELOPE and interprets nothing.
_THINK_OPEN: Final = "<think>"
_THINK_CLOSE: Final = "</think>"

#: Six model calls per turn. Enough for a read, a follow-up read and an answer with room to spare;
#: small enough that a model looping on one tool costs six calls rather than a bill. A turn that
#: hits it RAISES — see :class:`TurnDidNotFinish`.
DEFAULT_MAX_STEPS: Final = 6

#: DOUBLE ``provider.complete``'s 2048, and the reason is measured rather than cautious.
#:
#: A reasoning model spends output tokens on ``<think>`` BEFORE it writes anything the caller
#: keeps, and this turn's reply is a whole JSON answer — a live MiniMax-M3 reply on the synthetic
#: paper was ~600 characters of reasoning followed by ~2,100 characters of JSON. At 2048 tokens
#: that lands close enough to the ceiling to truncate intermittently, which presents as
#: ``JSONDecodeError: Expecting value: line 1 column 1`` on roughly one run in four and looks like
#: a model that cannot follow instructions.
#:
#: The ceiling is not the whole fix. Truncation is DETECTED (``finish_reason == "length"``) and
#: raised, because a budget can always be exceeded and half a JSON object is a failed generation —
#: EPIC-03 §4, *"Failed generations are never persisted as content."*
DEFAULT_MAX_TOKENS: Final = 4096


class TurnDidNotFinish(RuntimeError):
    """The step budget ran out before the model stopped asking for tools.

    Raised rather than returning the last partial text, for the reason ``ProviderError`` gives:
    EPIC-03 §4's *"Failed generations are never persisted as content."* The last assistant message
    of an unfinished turn reads like an answer and is not one.
    """


@dataclass(frozen=True, slots=True)
class DispatchedCall:
    """One tool the model actually called, and what came back."""

    tool: str
    status: ToolStatus

    def as_dict(self) -> dict[str, Any]:
        return {"tool": self.tool, "status": self.status.value}


@dataclass(frozen=True, slots=True)
class TurnOutcome:
    """What one finished turn produced. ``calls`` is the evidence that tools were used at all.

    Carried rather than discarded because "the loop dispatched zero tools" and "the loop worked"
    are indistinguishable from the final text alone — and a suite that asserts only on the text
    passes for a stub that returns a canned answer. ``tests/test_live_provider.py`` asserts
    ``dispatched >= 1`` for exactly that reason.
    """

    text: str
    calls: tuple[DispatchedCall, ...]
    steps: int
    model: str
    input_tokens: int
    output_tokens: int

    @property
    def dispatched(self) -> int:
        return len(self.calls)


class ChatCompletionsTurn:
    """One grounded turn against an OpenAI-compatible endpoint. No framework, no inheritance."""

    __slots__ = ("_max_steps", "_max_tokens", "_provider", "_registry")

    def __init__(
        self,
        registry: ToolRegistry,
        provider: MiniMaxProvider,
        *,
        max_steps: int = DEFAULT_MAX_STEPS,
        max_tokens: int = DEFAULT_MAX_TOKENS,
    ) -> None:
        self._registry = registry
        self._provider = provider
        self._max_steps = max_steps
        self._max_tokens = max_tokens

    async def run(
        self, *, system_prompt: str, user_message: str, context: ToolContext
    ) -> TurnOutcome:
        """Drive the conversation until the model answers without asking for a tool."""
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]
        tools = tool_definitions(self._registry, context=context)
        calls: list[DispatchedCall] = []
        model, prompt_tokens, completion_tokens = "", 0, 0

        for step in range(1, self._max_steps + 1):
            completion = self._provider.complete(messages, tools=tools, max_tokens=self._max_tokens)
            model = completion.model or model
            prompt_tokens += completion.input_tokens
            completion_tokens += completion.output_tokens
            if completion.finish_reason == "length":
                # A reply cut off at the token ceiling. Returning it would hand the caller half a
                # JSON object, and half a JSON object that happens to parse is worse still.
                raise TurnDidNotFinish(
                    f"the model hit the {self._max_tokens}-token output ceiling at step {step} "
                    f"(finish_reason='length') and its reply is truncated. Nothing is returned: a "
                    "truncated generation is a failed one (EPIC-03 §4)."
                )
            if not completion.wants_tools:
                return TurnOutcome(
                    text=completion.text,
                    calls=tuple(calls),
                    steps=step,
                    model=model,
                    input_tokens=prompt_tokens,
                    output_tokens=completion_tokens,
                )
            messages.append(
                {"role": "assistant", "content": None, "tool_calls": list(completion.tool_calls)}
            )
            for call in completion.tool_calls:
                result = await self._one(call, context)
                calls.append(DispatchedCall(result.tool, result.status))
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(call.get("id", "")),
                        "content": json.dumps(result.as_dict()),
                    }
                )

        raise TurnDidNotFinish(
            f"the model still wanted tools after {self._max_steps} steps; it called "
            f"{[c.tool for c in calls]}. Nothing is returned: an unfinished turn's last message "
            "reads like an answer and is not one."
        )

    async def _one(self, call: Mapping[str, Any], context: ToolContext) -> ToolResult:
        """One tool call, with every model-side fault converted into a ``refused`` result."""
        function = call.get("function")
        function = function if isinstance(function, Mapping) else {}
        name = str(function.get("name") or "")
        arguments = _decode_arguments(function.get("arguments"))
        if arguments is None:
            return _refused(name, "its `arguments` were not a JSON object; re-send them as one")
        try:
            return await dispatch(self._registry, name, arguments, context=context)
        except (UnknownToolError, ToolNotPermittedError, ToolArgumentError) as exc:
            return _refused(name, str(exc))


def _decode_arguments(raw: object) -> Mapping[str, Any] | None:
    """The provider sends arguments as a JSON STRING. ``None`` means "the model got it wrong".

    A no-argument tool is legitimately sent as ``""``, ``null`` or ``{}`` depending on the model,
    and eight of the eighteen tools take no arguments — so all three decode to ``{}`` rather than
    to a refusal the model cannot act on.
    """
    if isinstance(raw, Mapping):
        return raw
    if raw is None:
        return {}
    if not isinstance(raw, str):
        return None
    if not raw.strip():
        return {}
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return decoded if isinstance(decoded, Mapping) else None


def strip_reasoning_envelope(text: str) -> str:
    """A reply with its ``<think>…</think>`` prefix removed. Everything after it is UNTOUCHED.

    This is unwrapping, not repairing: the bytes the model committed to as its answer are returned
    exactly as sent. The distinction matters because ``services/api``'s ``/ask`` refuses to patch a
    malformed answer into shape, and a helper that "cleaned up" model output would be that patch
    under another name.

    An unterminated ``<think>`` is left alone rather than truncated at the end of the string: a
    reply that is all reasoning and no answer must fail to decode, because it IS a failure.
    """
    stripped = text.lstrip()
    if not stripped.startswith(_THINK_OPEN):
        return text
    end = stripped.find(_THINK_CLOSE)
    return text if end < 0 else stripped[end + len(_THINK_CLOSE) :].lstrip()


def _refused(name: str, why: str) -> ToolResult:
    return ToolResult(
        tool=name or "(unnamed)",
        status=ToolStatus.REFUSED,
        data={},
        reason=f"{name or 'that tool'} was not called: {why}.",
    )
