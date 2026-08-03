"""F3.4's provider layer: MiniMax over the OpenAI-compatible shape, standard library only.

WHY urllib AND NOT AN SDK
    ``services/document-worker/python/papertree_document_worker/vlm.py`` already does exactly
    this against MiniMax and its docstring records the reasoning: *"the endpoint is
    [protocol]-compatible, so this needs no SDK — stdlib ``urllib`` only, which keeps the epic's
    new-dependency count at one"*. The same holds here and the constraint is harder: this
    package's whole justification is that the runtime stays swappable, and a package that pulls
    ``openai`` in to talk to a chat-completions endpoint has made the provider a dependency of
    the registry.

    Note the ONE difference from ``vlm.py``, because getting it wrong produces a 404 with an
    unhelpful body: ``vlm.py`` targets MiniMax's **Anthropic-compatible** endpoint
    (``/anthropic/v1/messages``, ``x-api-key`` + ``anthropic-version``, content blocks).
    ``archive/v1-api/papertree_api/config.py`` (v1, #75) documents the **OpenAI-compatible** one
    (``llm_base_url = "https://api.minimax.io/v1"`` → ``/chat/completions``,
    ``Authorization: Bearer``, ``messages[].content`` as a string or a content-part array). Both
    are real, both are MiniMax, and they are not the same wire format. This module implements the
    second, because that is the one ``config.py`` names and the one Pydantic AI's OpenAI model
    speaks.

WHY ``vision_model`` IS A SEPARATE SETTING WHEN THE VALUES ARE CURRENTLY EQUAL
    ``config.py`` says it and ``vlm.py`` says it, and it is worth saying a third time because the
    failure is silent: **only MiniMax-M3 accepts an image block.** M2.7 / M2.5 / M2.1 / M2 are
    text-and-tool-calls only, and a text model *will accept a vision call's shape and answer
    anyway* — confidently, plausibly, and about nothing. The previous default,
    ``deepseek/deepseek-v3.2``, was exactly such a model.

    So the two are separate settings, and this module goes one step further than ``config.py``
    can: :meth:`MiniMaxProvider.complete_with_image` REFUSES a vision model that is not on
    :data:`KNOWN_VISION_MODELS`, rather than sending the request. Someone downgrading
    ``llm_model`` for cost is a plausible, reviewable change; someone downgrading it and getting
    silent nonsense out of the figure-description path six weeks later is the failure this
    refusal converts into a loud one. ``allow_unverified_vision_model=True`` is the deliberate
    escape hatch, and it has to be typed out at the call site.

NO NETWORK IN TESTS, BY CONSTRUCTION
    :class:`Transport` is a Protocol and :class:`MiniMaxProvider` takes one. The default is
    :class:`UrllibTransport`; the tests pass a recorder that returns canned bytes and asserts on
    the request. There is no module-level client, no ``requests.Session`` singleton and no
    environment-variable read at import time, so a test cannot reach the network by forgetting to
    patch something.

WHAT THIS MODULE DOES NOT DO
    It does not run a tool-calling loop. Driving a conversation — parse the tool calls, dispatch
    them, append the results, call again — is the RUNTIME's job, and the runtime is the part that
    is supposed to be swappable in under 100 lines. Putting the loop here would move the
    swappable part into the unswappable file. ``tests/test_runtime_swappable.py`` writes that loop
    from scratch to prove the boundary is real.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final, Protocol

__all__ = [
    "DEFAULT_BASE_URL",
    "DEFAULT_MODEL",
    "DEFAULT_VISION_MODEL",
    "KNOWN_VISION_MODELS",
    "Completion",
    "MiniMaxProvider",
    "ProviderError",
    "ProviderSettings",
    "Transport",
    "UrllibTransport",
    "VisionModelUnverified",
]

#: v1's values, mirrored rather than imported. v1 lived at ``apps/api`` and was never a member of
#: this uv workspace (root ``pyproject.toml`` says so and why), so importing from it was not
#: possible; #75 archived it to ``archive/v1-api/papertree_api/config.py``, which may not be
#: imported OR read (``archive/README.md``). The duplication is real and is why these are named
#: constants — one place to change per side, and ``tests/test_runtime_swappable.py`` asserts the
#: values still match the ones documented in that file.
#:
#: THERE ARE TWO OTHER LIVE COPIES OF THESE VALUES, AND THAT IS A RULING, NOT AN OVERSIGHT (#88).
#:
#:   services/document-worker/python/papertree_document_worker/vlm.py      DEFAULT_MODEL,
#:                                                                         DEFAULT_BASE_URL
#:   services/document-worker/python/papertree_document_worker/pipeline.py ParserConfig.vlm_model
#:
#: #88 asked whether ``services/document-worker`` should instead depend on
#: ``papertree-agent-tools`` and import them. **It should not.** Two reasons, in order of weight:
#:
#:   1. ``pipeline.py``'s ``vlm_model`` is a CONFIG DEFAULT that feeds ``parser_config_hash``
#:      (``ParserConfig.as_dict`` -> ``config_hash_for`` -> ``ParserInfo.config_hash`` ->
#:      ``papers.parser_config_hash``). A default that moves when an unrelated package upgrades
#:      would silently change every parse's config hash — and that hash is the thing that makes
#:      "re-parsing is a no-op" checkable. Two runs disagreeing on it are not comparable at all.
#:      Measured: with ``vlm_max_calls > 0`` the hash DOES move when ``vlm_model`` moves; with the
#:      default ``vlm_max_calls == 0`` ``as_dict`` masks it to ``None`` and the hash does not. So
#:      the hazard is live in exactly the runs where the constant is used. That is a hazard, not a
#:      tidiness win.
#:   2. ``services/document-worker``'s dependency set is ``document-ir`` + ``db`` + ``jobs`` +
#:      ``pymupdf``. ``vlm.py``'s own comment — "Anthropic-compatible, so no SDK and no new
#:      dependency" — is a deliberate refusal, and adding ``agent-tools`` for three string
#:      literals is a real architectural cost against it.
#:
#: The endpoints differ anyway: this module speaks the OPENAI-compatible shape
#: (``/v1`` -> ``/chat/completions``) and ``vlm.py`` speaks the ANTHROPIC-compatible one
#: (``/anthropic/v1/messages``). Only the MODEL NAME is genuinely the same string.
#:
#: So the duplication STAYS and is DECLARED, in both directions: this comment points at the two
#: copies, each copy points back here, and ``tests/test_runtime_swappable.py``'s
#: ``KNOWN_CONSTANT_COPIES`` ledger fails if a THIRD copy appears or if a listed one stops
#: carrying a constant. Declared duplication that a test watches is not drift.
DEFAULT_BASE_URL: Final = "https://api.minimax.io/v1"
DEFAULT_MODEL: Final = "MiniMax-M3"
DEFAULT_VISION_MODEL: Final = "MiniMax-M3"

#: The models measured to actually accept an image block. Everything else returns confident
#: nonsense for a vision call rather than an error — see the module docstring.
KNOWN_VISION_MODELS: Final[frozenset[str]] = frozenset({"MiniMax-M3"})

DEFAULT_TIMEOUT_SECONDS: Final = 120.0


class ProviderError(RuntimeError):
    """The provider call failed. Callers degrade; they never persist a partial generation.

    EPIC-03 §4: *"Failed generations are never persisted as content."* The current v1 code stores
    ``"_Failed to generate summary: …_"`` as a page summary and never retries it. Raising here —
    rather than returning a string that reads like an answer — is what makes that impossible to
    do by accident at the call site.
    """


class VisionModelUnverified(ProviderError):
    """A vision call was aimed at a model not known to accept an image block."""


@dataclass(frozen=True, slots=True)
class ProviderSettings:
    """The four settings v1's ``config.py`` documented, as one object. See #75, #88."""

    api_key: str = ""
    model: str = DEFAULT_MODEL
    #: Separate from :attr:`model` even when equal. See the module docstring.
    vision_model: str = DEFAULT_VISION_MODEL
    base_url: str = DEFAULT_BASE_URL
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    @property
    def available(self) -> bool:
        """Whether a call could be made at all. Callers check this and degrade, never crash."""
        return bool(self.api_key)

    @property
    def chat_completions_url(self) -> str:
        return f"{self.base_url.rstrip('/')}/chat/completions"


class Transport(Protocol):
    """How bytes get to the endpoint. The seam that keeps the network out of the test suite."""

    def __call__(
        self, url: str, body: bytes, headers: Mapping[str, str], timeout: float
    ) -> bytes: ...


@dataclass(frozen=True, slots=True)
class UrllibTransport:
    """The real one. Standard library, no session, no retry.

    No retry ON PURPOSE: a retry policy belongs to the durable job runner
    (``papertree_jobs``, which already has backoff, attempt counts and a lease), and a second
    one here would multiply with it — three attempts inside three attempts is nine calls and a
    bill nobody predicted.
    """

    def __call__(self, url: str, body: bytes, headers: Mapping[str, str], timeout: float) -> bytes:
        request = urllib.request.Request(url, data=body, headers=dict(headers))
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload: bytes = response.read()
                return payload
        except urllib.error.HTTPError as exc:  # pragma: no cover - needs a live endpoint
            raise ProviderError(f"{exc.code} from {url}: {exc.read()[:400]!r}") from exc
        except OSError as exc:  # pragma: no cover - network
            raise ProviderError(f"{type(exc).__name__}: {exc}") from exc


@dataclass(frozen=True, slots=True)
class Completion:
    """One model reply, reduced to what a runtime needs to drive the next turn."""

    text: str
    #: Raw tool calls, in the provider's own shape. NOT normalised here: the runtime adapter
    #: knows which framework it is feeding, and a normalisation in this module would be a second
    #: schema that every adapter then has to translate back out of.
    tool_calls: tuple[Mapping[str, Any], ...] = ()
    finish_reason: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""

    @property
    def wants_tools(self) -> bool:
        return bool(self.tool_calls)


@dataclass(frozen=True, slots=True)
class MiniMaxProvider:
    """OpenAI-compatible chat completions against MiniMax. Stdlib only; transport injectable."""

    settings: ProviderSettings = field(default_factory=ProviderSettings)
    transport: Transport = field(default_factory=UrllibTransport)

    @property
    def available(self) -> bool:
        return self.settings.available

    def complete(
        self,
        messages: Sequence[Mapping[str, Any]],
        *,
        tools: Sequence[Mapping[str, Any]] = (),
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> Completion:
        """One chat-completions call.

        ``temperature`` defaults to 0.0. A grounded reader that answers a question two different
        ways on two runs cannot have its citations checked against a fixed expectation, and
        F3.5's verifier is deterministic — a non-deterministic generator behind a deterministic
        checker means an intermittently red suite that nobody can reproduce.
        """
        if not self.settings.available:
            raise ProviderError(
                "no llm_api_key is set. The provider is unavailable rather than broken; "
                "callers check `.available` and degrade (see vlm.py's VlmClient, same shape)."
            )
        body: dict[str, Any] = {
            "model": self.settings.model,
            "messages": list(messages),
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            body["tools"] = list(tools)
            body["tool_choice"] = "auto"
        return self._post(body)

    def complete_with_image(
        self,
        messages: Sequence[Mapping[str, Any]],
        *,
        max_tokens: int = 1024,
        allow_unverified_vision_model: bool = False,
    ) -> Completion:
        """A call carrying an image content part. Refuses a model not known to accept one.

        The refusal is the point. See the module docstring: a text model accepts this request's
        shape and answers confidently about nothing, so the failure it prevents leaves no trace
        in a log.
        """
        model = self.settings.vision_model
        if model not in KNOWN_VISION_MODELS and not allow_unverified_vision_model:
            raise VisionModelUnverified(
                f"vision_model={model!r} is not in {sorted(KNOWN_VISION_MODELS)}. Only MiniMax-M3 "
                "accepts an image block; M2.x accepts this request's SHAPE and returns confident "
                "nonsense. Pass allow_unverified_vision_model=True to override deliberately."
            )
        if not self.settings.available:
            raise ProviderError("no llm_api_key is set")
        return self._post(
            {
                "model": model,
                "messages": list(messages),
                "temperature": 0.0,
                "max_tokens": max_tokens,
            }
        )

    # ── internals ────────────────────────────────────────────────────────────────────────

    def _post(self, body: Mapping[str, Any]) -> Completion:
        raw = self.transport(
            self.settings.chat_completions_url,
            json.dumps(body).encode("utf-8"),
            {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.settings.api_key}",
            },
            self.settings.timeout_seconds,
        )
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProviderError(f"response was not JSON: {raw[:200]!r}") from exc
        return _completion_from(payload, fallback_model=str(body.get("model", "")))


def _completion_from(payload: Any, *, fallback_model: str) -> Completion:
    """Decodes the OpenAI-compatible response defensively.

    Every field is read with a default. A provider that adds a field must not break this, and a
    provider that OMITS one must not produce a ``KeyError`` in the middle of a turn — the caller
    can act on an empty completion and cannot act on a traceback.
    """
    if not isinstance(payload, Mapping):
        raise ProviderError(f"expected a JSON object, got {type(payload).__name__}")
    choices = payload.get("choices") or []
    message: Mapping[str, Any] = {}
    finish = ""
    if choices and isinstance(choices[0], Mapping):
        first = choices[0]
        finish = str(first.get("finish_reason") or "")
        candidate = first.get("message")
        message = candidate if isinstance(candidate, Mapping) else {}
    usage = payload.get("usage") or {}
    tool_calls = tuple(
        call for call in (message.get("tool_calls") or ()) if isinstance(call, Mapping)
    )
    return Completion(
        text=str(message.get("content") or ""),
        tool_calls=tool_calls,
        finish_reason=finish,
        input_tokens=int(usage.get("prompt_tokens", 0)) if isinstance(usage, Mapping) else 0,
        output_tokens=int(usage.get("completion_tokens", 0)) if isinstance(usage, Mapping) else 0,
        model=str(payload.get("model") or fallback_model),
    )
