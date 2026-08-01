"""F3.1 — the plain tool registry this project owns. ``name -> JSON Schema -> async callable``.

THE HARD RULE THIS MODULE IS THE ANSWER TO
    EPIC-03 §4, verbatim: *"The ~20 tools live in a **plain registry the project owns**; Pydantic
    AI merely adapts it. The runtime must stay swappable in <100 lines."*

    A registry that satisfies that sentence has one property: **nothing in it imports, mentions
    or is shaped by any agent framework.** This module imports ``papertree_memory``,
    ``papertree_prompts`` and the standard library. It knows nothing about Pydantic AI, OpenAI
    function-calling, MCP, or tool-call ids. The adapter that does know is ``runtime.py``, it is
    under 100 lines, and ``tests/test_runtime_swappable.py`` writes a SECOND adapter from scratch
    and drives this same registry with it — because "swappable" is a claim you can only check by
    swapping.

THREE DESIGN DECISIONS, EACH BECAUSE OF SOMETHING MEASURED IN THIS REPO

1. **Arguments are validated BEFORE the callable runs, by a validator that rejects schemas it
   cannot enforce.** ``schema.py`` explains the trap at length; the short version is that a
   partial validator's failure mode is silently ignoring the keyword you were relying on, which
   is AGENTS.md §2's "a green test may assert less than it appears to" wearing a different hat.
   Validation happens in :meth:`ToolRegistry.call`, so there is no path to a handler that skips
   it — a handler is not reachable except through ``call``.

2. **The Rule of Two is enforced HERE, not in review.** ``papertree_prompts.caps`` makes the
   forbidden capability triple unconstructible and maps every legal triple to a ``Toolset`` NAME,
   explicitly leaving the resolution of names to real tools to this package ("The tool registry
   is ``packages/agent-tools``' to own"). So every :class:`ToolSpec` declares which toolsets may
   call it, and :meth:`ToolRegistry.call` refuses one that is not in the turn's toolset. The
   system prompt tells the model that anything outside its toolset "is ABSENT, not withheld";
   this is what makes that sentence true rather than a promise.

3. **The context a tool receives carries an ``AgentDataHandle`` and coordinates, and nothing
   else.** No ``PaperTreeDb``, no ``MemoryStore``, no ``pathlib.Path`` (a ``Path`` carries
   ``write_bytes`` — ``agent_handle.py`` makes the same argument about its own field), no
   callback into privileged code, no network client. ``tests/test_tools.py`` walks the reachable
   object graph, including ``__slots__`` and closure cells, and asserts the types it finds; and
   it runs ``probe_escape_routes`` against the handle inside a live tool call, so the guarantee
   is checked where the tools actually execute rather than only where the handle is built.

WHY HANDLERS ARE ``async`` WHEN NOTHING IN THEM AWAITS
    ``sqlite3`` is synchronous and every handler here is a few SELECTs. The signature is
    ``async`` because the runtime that drives it is, and because the alternative — a sync
    registry with an async shim per adapter — puts the ``asyncio`` boundary in the swappable
    layer, which is the layer that is supposed to be cheap to rewrite. Making it async now costs
    one keyword; making it async later costs every adapter and every test.

    The honest consequence, stated rather than discovered: a tool call BLOCKS the event loop for
    the duration of its SELECTs. On the largest corpus paper a full :func:`load_paper_view` is
    974 rows and ~60 KB of text, done once per turn. If this ever runs under a server handling
    concurrent turns, the fix is ``asyncio.to_thread`` at the ``call`` boundary — one line, in
    this file — not a redesign.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Final, final

from papertree_db import Generation, PaperId
from papertree_memory import AgentDataHandle
from papertree_prompts import Toolset, TurnCaps, toolset_for

from papertree_agent_tools.paperview import PaperView, load_paper_view
from papertree_agent_tools.results import ToolResult
from papertree_agent_tools.schema import check_schema, validate_arguments

__all__ = [
    "READ_ONLY_TOOLSETS",
    "ToolContext",
    "ToolHandler",
    "ToolNotPermittedError",
    "ToolRegistry",
    "ToolSpec",
    "UnknownToolError",
]


@final
class ToolContext:
    """Everything a tool may receive: a read-only handle, and which paper/session/turn it is.

    NOT a dataclass, because it caches :attr:`view` and a frozen dataclass cannot. Everything
    else about it is frozen in effect: the five inputs are exposed as read-only properties and
    ``__slots__`` fixes the attribute set, so ``tests/test_tools.py``'s audit of the reachable
    surface is exhaustive rather than a sample — the same argument ``AgentDataHandle`` makes for
    its own ``__slots__``.

    THE PAPER AND GENERATION ARE BOUND HERE AND ARE NOT TOOL ARGUMENTS. Same reason the handle
    binds its user at construction: a single-paper turn's tools cannot name another paper because
    there is no argument in which to name one. A cross-paper turn is a different ``TurnCaps``
    (``sensitive_scope=True``) and a different toolset, which is exactly §13.6(e) Attack 2's
    stopping point.
    """

    __slots__ = ("_caps", "_generation", "_handle", "_paper_id", "_session_id", "_view")

    _handle: AgentDataHandle
    _paper_id: PaperId
    _generation: Generation
    _session_id: str
    _caps: TurnCaps
    _view: PaperView | None

    def __init__(
        self,
        handle: AgentDataHandle,
        *,
        paper_id: PaperId,
        generation: Generation,
        session_id: str,
        caps: TurnCaps,
    ) -> None:
        self._handle = handle
        self._paper_id = paper_id
        self._generation = generation
        self._session_id = session_id
        self._caps = caps
        self._view = None

    @property
    def handle(self) -> AgentDataHandle:
        return self._handle

    @property
    def paper_id(self) -> PaperId:
        return self._paper_id

    @property
    def generation(self) -> Generation:
        return self._generation

    @property
    def session_id(self) -> str:
        return self._session_id

    @property
    def caps(self) -> TurnCaps:
        return self._caps

    @property
    def toolset(self) -> Toolset:
        """The turn's toolset, resolved from its capability triple. Total — see ``caps.py``."""
        return toolset_for(self._caps)

    @property
    def view(self) -> PaperView:
        """The indexed paper, built once per turn. See ``paperview.py`` on why it is cached here.

        Raises ``KeyError`` if the paper generation does not exist for this handle's user. That
        propagates out of :meth:`ToolRegistry.call` rather than becoming a ``not_found`` result,
        because it is a fault in the TURN's construction — the runtime chose the paper, not the
        model — and a per-tool "not found" would let a mis-addressed turn look like an empty one.
        """
        if self._view is None:
            self._view = load_paper_view(self._handle, self._paper_id, self._generation)
        return self._view


#: The signature every tool has. Deliberately ``Mapping`` in and :class:`ToolResult` out: a
#: handler cannot mutate the arguments it was given, and it cannot return a bare ``dict`` that
#: skips ``ToolResult``'s "a non-ok answer must say why" invariant.
ToolHandler = Callable[[ToolContext, Mapping[str, Any]], Awaitable[ToolResult]]

#: The two toolsets a read-only single-paper tool belongs to. Every tool in ``tools.py`` uses
#: this: they are all reads, and reads are legal both in the ordinary reading turn
#: ``(T, F, F)`` and in the cross-paper comparison turn ``(T, T, F)``. A tool that wrote would
#: need ``WRITE_SINGLE_PAPER_NO_LIBRARY`` — and there is no such tool here, because the handle
#: cannot write. That absence is F3.8's boundary showing through the type system.
READ_ONLY_TOOLSETS: Final[frozenset[Toolset]] = frozenset(
    {Toolset.READ_ONLY_SINGLE_PAPER, Toolset.READ_ONLY_MULTI_PAPER}
)


class UnknownToolError(KeyError):
    """A tool name that is not registered.

    Raised, not returned. A model naming a tool it was never given is a runtime-level fault —
    the tool list it was handed did not contain the name — and the runtime adapter is the layer
    that knows how to tell that particular model about it. Returning a ``ToolResult`` would
    require inventing a ``tool`` field for a tool that does not exist.
    """


class ToolNotPermittedError(PermissionError):
    """A registered tool that this turn's toolset does not include.

    Distinct from :class:`UnknownToolError` because the two need different audit rows: an unknown
    name is a confused model, a non-permitted name is an attempted capability escalation and
    §13.6(d) wants those counted separately.
    """


@dataclass(frozen=True, slots=True)
class ToolSpec:
    """One tool: its name, the schema its arguments must satisfy, and the callable.

    ``parameters`` is checked by :func:`~papertree_agent_tools.schema.check_schema` in
    :meth:`ToolRegistry.register`, so an unenforceable schema cannot reach a running system.
    """

    name: str
    #: Shown to the model verbatim. Written for a model, not for a human reader: it says what the
    #: tool returns AND what it returns when it cannot answer, because a model that does not know
    #: a tool can come back empty will keep calling it.
    description: str
    parameters: Mapping[str, Any]
    handler: ToolHandler
    toolsets: frozenset[Toolset] = READ_ONLY_TOOLSETS
    #: True when the result can contain text extracted from the PDF. The runtime MUST route such
    #: a result through ``render_untrusted`` before it enters a prompt. Declared per tool rather
    #: than inferred, so "does this carry attacker-controlled bytes" is an answer the registry
    #: can be queried for instead of a judgement each adapter re-makes.
    returns_paper_text: bool = False
    #: True when the tool is known to be unable to answer today because of a DATA gap rather than
    #: a code gap (issue #66). Introspectable so ``EPIC-03-RESULT.md`` can be generated from the
    #: registry instead of hand-maintained beside it.
    data_gap: str = ""


@final
class ToolRegistry:
    """A plain, ordered, introspectable ``name -> ToolSpec`` map. No framework anywhere in it."""

    __slots__ = ("_specs",)

    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}

    # ── construction ─────────────────────────────────────────────────────────────────────

    def register(self, spec: ToolSpec) -> ToolSpec:
        """Adds a tool. Validates its schema now, so an unenforceable one never runs.

        Refuses a duplicate name loudly. Two tools under one name is a silent
        last-registration-wins, and the losing tool becomes unreachable code — this repo's
        single most-repeated defect (findings.md §A).
        """
        if spec.name in self._specs:
            raise ValueError(
                f"{spec.name} is already registered. Silent replacement would make one of the "
                "two implementations unreachable, which is findings.md §A's failure."
            )
        if not spec.description.strip():
            raise ValueError(
                f"{spec.name} has no description. The description is what the model reads to "
                "decide whether to call it; an empty one is a tool that gets called at random."
            )
        check_schema(spec.parameters, where=f"{spec.name}.parameters")
        if spec.parameters.get("type") != "object":
            raise ValueError(
                f"{spec.name}: an argument schema must be `{{'type': 'object', ...}}` — every "
                "tool-calling wire format sends arguments as a JSON object."
            )
        if not spec.toolsets:
            raise ValueError(
                f"{spec.name} belongs to no toolset, so no turn could ever call it. A tool that "
                "is unreachable by construction should be deleted, not registered."
            )
        self._specs[spec.name] = spec
        return spec

    # ── introspection ────────────────────────────────────────────────────────────────────

    def names(self) -> tuple[str, ...]:
        """Every registered name, sorted. Sorted rather than insertion-ordered so that two
        processes hand a model the same tool list in the same order — a prompt whose tool list
        permutes between runs is a prompt whose cache never hits and whose diffs are noise."""
        return tuple(sorted(self._specs))

    def spec(self, name: str) -> ToolSpec:
        try:
            return self._specs[name]
        except KeyError as exc:
            raise UnknownToolError(
                f"{name!r} is not a registered tool. Registered: {list(self.names())}"
            ) from exc

    def schema(self, name: str) -> Mapping[str, Any]:
        """One tool's argument schema, exactly as the model will be shown it."""
        return self.spec(name).parameters

    def specs(self) -> tuple[ToolSpec, ...]:
        return tuple(self._specs[name] for name in self.names())

    def for_toolset(self, toolset: Toolset) -> tuple[str, ...]:
        """The names a turn holding ``toolset`` may call. The list the model is handed."""
        return tuple(name for name in self.names() if toolset in self._specs[name].toolsets)

    def __contains__(self, name: object) -> bool:
        return isinstance(name, str) and name in self._specs

    def __len__(self) -> int:
        return len(self._specs)

    # ── dispatch ─────────────────────────────────────────────────────────────────────────

    async def call(
        self, name: str, arguments: Mapping[str, Any], *, context: ToolContext
    ) -> ToolResult:
        """The ONLY way to run a tool. Toolset check, then schema check, then the callable.

        The order matters: a turn that may not call a tool at all should not have its arguments
        parsed, because parsing a rejected call's arguments is how an error message tells an
        attacker the shape of a tool they were not given.
        """
        spec = self.spec(name)
        if context.toolset not in spec.toolsets:
            raise ToolNotPermittedError(
                f"{name} is not in toolset {context.toolset.value} (this turn's capability "
                f"triple is {context.caps.triple}). It is available to "
                f"{sorted(t.value for t in spec.toolsets)}."
            )
        validated = validate_arguments(name, spec.parameters, arguments)
        return await spec.handler(context, validated)
