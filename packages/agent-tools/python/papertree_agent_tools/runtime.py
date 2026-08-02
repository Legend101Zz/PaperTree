"""F3.4's runtime adapter. Under 100 lines of code, and that is an asserted number.

EPIC-03 §4: *"The ~20 tools live in a plain registry the project owns; Pydantic AI merely adapts
it. **The runtime must stay swappable in <100 lines.**"* This module is the demonstration.
``tests/test_runtime_swappable.py`` counts this file's executable lines and fails over 100, and
then writes a SECOND, completely different adapter and drives the same registry with it — because
a swappability claim is only checkable by swapping.

WHY PYDANTIC AI IS NOT A DEPENDENCY, AND IS IMPORTED LAZILY INSTEAD
    ``uv sync --locked --all-packages`` is a CI gate. ``packages/evaluation``'s pyproject records
    the measurement: one ``docling>=2.0`` line took the workspace lock from 22 packages to 100+,
    because uv locks a dependency group whether or not it installs it — so a lock that moves is a
    failed build for everyone. ``pydantic-ai`` pulls pydantic, griffe, httpx, httpcore, anyio,
    typing-inspection, eval-type-backport and a provider SDK per backend; it is the same shape of
    change.

    So this follows the established pattern rather than inventing one:
    ``papertree_evaluation.adapters.DoclingAdapter`` reports ``available`` from the ENVIRONMENT
    and returns a structured ``unavailable`` outcome — naming the variable to set — instead of
    crashing, and its module docstring is explicit that *"an adapter that was never INSTALLED has
    not failed at anything"*. :class:`PydanticAiAdapter` is the same object with a different
    subject: ``importlib.util.find_spec`` at call time, never an import at module scope.
"""

from __future__ import annotations

import importlib.util
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final

from papertree_agent_tools.registry import ToolContext, ToolRegistry
from papertree_agent_tools.results import ToolResult

__all__ = ["MODULE_NAME", "AdapterStatus", "PydanticAiAdapter", "dispatch", "tool_definitions"]

MODULE_NAME: Final = "pydantic_ai"


@dataclass(frozen=True, slots=True)
class AdapterStatus:
    """Whether a runtime can be built here, and — when not — exactly what is missing."""

    available: bool
    reason: str


def tool_definitions(registry: ToolRegistry, *, context: ToolContext) -> list[dict[str, Any]]:
    """The turn's tools in the OpenAI function-calling wire shape.

    That shape is not a preference: MiniMax's OpenAI-compatible endpoint takes it (``provider.py``)
    and Pydantic AI's OpenAI model emits it, so one function serves both and neither framework
    leaks into ``registry.py``. Filtered by the turn's toolset, so a tool outside it is ABSENT
    from the list rather than refused on call — which is what the system prompt promises the
    model in ``build_system_prompt``.
    """
    return [
        {
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": dict(spec.parameters),
            },
        }
        for spec in registry.specs()
        if context.toolset in spec.toolsets
    ]


async def dispatch(
    registry: ToolRegistry, name: str, arguments: Mapping[str, Any], *, context: ToolContext
) -> ToolResult:
    """One tool call. The whole of what an adapter has to route through."""
    return await registry.call(name, arguments, context=context)


@dataclass(frozen=True, slots=True)
class PydanticAiAdapter:
    """Reports itself UNAVAILABLE when ``pydantic_ai`` is absent. It never crashes on import."""

    registry: ToolRegistry

    @property
    def status(self) -> AdapterStatus:
        """Environment, not capability — the distinction ``adapters.py`` insists on."""
        if importlib.util.find_spec(MODULE_NAME) is None:
            return AdapterStatus(
                False,
                f"{MODULE_NAME} is not installed. It is deliberately NOT a dependency of "
                "papertree-agent-tools: `uv sync --locked --all-packages` is a CI gate and "
                "packages/evaluation records what one such line did to the lock (22 packages "
                "to 100+). Install it into an opt-in environment, or use any adapter that "
                "speaks tool_definitions() + dispatch() — that pair is the whole interface.",
            )
        return AdapterStatus(True, "")

    @property
    def available(self) -> bool:
        return self.status.available

    def build(self, *, model: str, system_prompt: str) -> Any:
        """Builds a ``pydantic_ai.Agent`` over this registry. Imports INSIDE the method.

        Raises ``RuntimeError`` carrying :attr:`status`'s reason when the module is absent, so
        the failure names the fix instead of surfacing as ``ModuleNotFoundError`` three frames
        deeper. Returns ``Any`` because the return type lives in a package that is not a
        dependency; annotating it would need the import this method exists to avoid.
        """
        status = self.status
        if not status.available:
            raise RuntimeError(status.reason)
        agent_module = importlib.import_module(MODULE_NAME)
        return agent_module.Agent(model, system_prompt=system_prompt)
