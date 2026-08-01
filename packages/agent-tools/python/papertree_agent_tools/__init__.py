"""papertree_agent_tools — F3.1 (tool registry), F3.4 (agent runtime), F3.5 (answer + verifier).

    registry   ToolRegistry: name -> JSON Schema -> async callable. Owned here, framework-free.
    tools      the eighteen tools EPIC-03 F3.1 names, over a READ-ONLY AgentDataHandle.
    answer     the grounded-answer contract; the Python twin of the Inspector's types.ts.
    grounding  verify_grounding: deterministic, offline, flags unsupported claims.
    provider   MiniMax over the OpenAI-compatible shape, stdlib urllib, injectable transport.
    runtime    the Pydantic AI adapter — lazy, reports UNAVAILABLE, under 100 lines.

═══ THE ONE IDEA ══════════════════════════════════════════════════════════════════════════════

**THE REGISTRY IS THE PRODUCT; THE RUNTIME IS A DETAIL.** EPIC-03 §4: *"The ~20 tools live in a
plain registry the project owns; Pydantic AI merely adapts it. The runtime must stay swappable in
<100 lines."*

Everything below follows from taking that literally. ``registry.py`` and ``tools.py`` import the
standard library, ``papertree_db``, ``papertree_memory``, ``papertree_retrieval``,
``papertree_document_ir`` and ``papertree_prompts`` — and no agent framework, no HTTP client, no
model SDK, at any depth. ``runtime.py`` is the only file that knows an agent framework exists, it
is **54 executable lines** (measured by ``tests/test_runtime_swappable.py``, which counts them
and fails over 100), and that same test writes a SECOND adapter from scratch — 37 executable
lines — and drives this registry to a finished two-step tool-calling turn with it against a real
parsed database. A swappability claim is checkable only by swapping.

═══ WHAT IS NOT A DEPENDENCY, AND THE MEASUREMENT BEHIND IT ═══════════════════════════════════

**No pydantic-ai. No jsonschema. No httpx. No openai.** ``uv sync --locked --all-packages`` is a
CI gate, and ``packages/evaluation``'s pyproject records what one line does: ``docling>=2.0`` took
the workspace lock from 22 packages to 100+, because uv locks a dependency group whether or not it
installs it. So this package follows the pattern that repo already established rather than
inventing one:

  * the Pydantic AI adapter does ``importlib.util.find_spec`` at CALL time and reports itself
    ``unavailable`` with the reason, exactly like ``papertree_evaluation.adapters.DoclingAdapter``
    — whose own docstring insists that *"an adapter that was never INSTALLED has not failed at
    anything"*;
  * the provider speaks HTTP through stdlib ``urllib``, exactly like
    ``services/document-worker``'s ``vlm.py`` already does against MiniMax;
  * argument validation is a 14-keyword JSON Schema subset in ``schema.py``, which REJECTS a
    schema keyword it cannot enforce at registration time rather than ignoring it at call time.

═══ THE TRUST BOUNDARY, WHICH IS STRUCTURAL AND NOT POLITE ════════════════════════════════════

A tool receives a :class:`~papertree_agent_tools.registry.ToolContext`: an ``AgentDataHandle``
plus which paper, generation and session it is. Nothing else — no ``PaperTreeDb``, no
``MemoryStore``, no ``pathlib.Path`` (a ``Path`` carries ``write_bytes``), no callback into
privileged code, no network client. The handle opens ``file:…?mode=ro`` with an sqlite3
authorizer denying INSERT/UPDATE/DELETE/DDL/**ATTACH**; ``papertree_memory.guard``'s docstring
records why the second layer is not optional (a bare ``mode=ro`` connection can ``ATTACH`` a
writable database, and ``VACUUM INTO`` copies the whole library to a path of the attacker's
choosing — both measured on this workspace).

So ``save_user_note`` **cannot** write, and does not try: it returns a PROPOSAL object, already
checked against both gates ``MemoryStore.create_proposal`` will apply, which the privileged
runtime persists after the user confirms it. ``tests/test_tools.py`` asserts the call leaves
``memory_proposals``, ``user_learning_memory`` and ``memory_audit`` all empty, and then feeds the
returned proposal to ``MemoryStore`` and watches a row appear — because "it did not write" and
"it produced something real" are two claims, and asserting only the first would pass for a tool
that does nothing at all.

═══ HONESTY ABOUT THE DATA, WHICH IS THIS PACKAGE'S MAIN DESIGN CONSTRAINT ════════════════════

Issue #66 measured the corpus on 2026-08-02: ``prev_id``/``next_id`` populated 0 of 974 times;
``cites``, ``references``, ``defines``, ``explains``, ``result_of`` and ``parent_of`` emitted
ZERO times; ``equation.payload.referenced_by`` and ``figure.payload.caption_block`` never
populated; and no embeddings anywhere.

``resolve_citation`` and ``search_semantic_blocks`` therefore return nothing on every real paper
today. **Every empty answer in this package carries a required, non-empty reason** —
``ToolResult`` refuses to construct without one — and the reason distinguishes "there are none"
from "the parser does not emit these". A bare ``[]`` would tell a model "I looked and found none",
and the model would write "this equation is not referenced anywhere in the paper": a fabrication
manufactured by an honest-looking empty list.

═══ WHAT THIS PACKAGE DOES NOT DO, STATED BEFORE ANYONE HAS TO FIND OUT ═══════════════════════

  * **No answer is scored.** EPIC-03 §7 records that the 120 Tier C questions ``qa/grounding.spec``
    evaluates against DO NOT EXIST — "Tier C" appears in four prose documents and zero data files.
    The verifier's threshold is a judgement between three measured coverages, not a calibration,
    and ``grounding.py`` says so in the file rather than in a result document.
  * **The verifier is lexical.** It catches fabricated vocabulary and fabricated numbers. It
    cannot see negation, comparator swaps or causal inversion, and it flags correct paraphrases.
    ``supported`` means "necessary condition met", never "true".
  * **``crop_pdf_region`` and ``search_visual_regions`` can never work from here.** They are
    registered, callable and permanently ``unavailable`` with the reason, because omitting them
    would leave nobody able to tell "considered and impossible" from "forgotten".
  * **No ``Anchor`` is minted.** ``@papertree/anchoring`` is TypeScript-only, so
    ``SourceRegion`` carries the address an anchor would be minted from and the anchor is minted
    on the client. A Python consumer that stores one and re-parses is storing a bare block id.
  * **``PaperIndex`` has no read-only constructor.** ``paperview.py`` documents the cast and the
    three private imports that work around it. The right fix belongs to ``papertree-retrieval``,
    which this package does not own.

═══ USAGE ═════════════════════════════════════════════════════════════════════════════════════

    registry = build_registry()                        # once per process
    with AgentDataHandle(db_path, user_id) as handle:  # once per turn
        context = ToolContext(
            handle,
            paper_id=paper_id,
            generation=generation(1),
            session_id="ses_…",
            caps=TurnCaps(untrusted_input=True, sensitive_scope=False, state_or_egress=False),
        )
        tools = tool_definitions(registry, context=context)   # OpenAI wire shape
        result = await registry.call("get_block", {"block_id": block_id}, context=context)
        result.status, result.reason, result.data
"""

from __future__ import annotations

from papertree_agent_tools.answer import (
    ANSWER_SCHEMA,
    CITATION_TARGET_TYPES,
    UNVERIFIED_REASON,
    AnswerContractError,
    GroundedAnswer,
    SourceRegion,
    VerifiedClaim,
    answer_from_mapping,
    target_type_for_block_type,
)
from papertree_agent_tools.grounding import (
    DEFAULT_COVERAGE_THRESHOLD,
    STOPWORDS,
    ClaimEvidence,
    claim_coverage,
    content_tokens,
    verify_grounding,
)
from papertree_agent_tools.paperview import PaperView, load_paper_view
from papertree_agent_tools.provider import (
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    DEFAULT_VISION_MODEL,
    KNOWN_VISION_MODELS,
    Completion,
    MiniMaxProvider,
    ProviderError,
    ProviderSettings,
    Transport,
    UrllibTransport,
    VisionModelUnverified,
)
from papertree_agent_tools.registry import (
    READ_ONLY_TOOLSETS,
    ToolContext,
    ToolHandler,
    ToolNotPermittedError,
    ToolRegistry,
    ToolSpec,
    UnknownToolError,
)
from papertree_agent_tools.results import ToolResult, ToolStatus
from papertree_agent_tools.runtime import (
    AdapterStatus,
    PydanticAiAdapter,
    dispatch,
    tool_definitions,
)
from papertree_agent_tools.schema import (
    ANNOTATION_KEYWORDS,
    CONSTRAINT_KEYWORDS,
    SchemaError,
    ToolArgumentError,
    check_schema,
    validate_arguments,
)
from papertree_agent_tools.tools import TOOL_NAMES, build_registry

__all__ = [
    "ANNOTATION_KEYWORDS",
    "ANSWER_SCHEMA",
    "CITATION_TARGET_TYPES",
    "CONSTRAINT_KEYWORDS",
    "DEFAULT_BASE_URL",
    "DEFAULT_COVERAGE_THRESHOLD",
    "DEFAULT_MODEL",
    "DEFAULT_VISION_MODEL",
    "KNOWN_VISION_MODELS",
    "READ_ONLY_TOOLSETS",
    "STOPWORDS",
    "TOOL_NAMES",
    "UNVERIFIED_REASON",
    "AdapterStatus",
    "AnswerContractError",
    "ClaimEvidence",
    "Completion",
    "GroundedAnswer",
    "MiniMaxProvider",
    "PaperView",
    "ProviderError",
    "ProviderSettings",
    "PydanticAiAdapter",
    "SchemaError",
    "SourceRegion",
    "ToolArgumentError",
    "ToolContext",
    "ToolHandler",
    "ToolNotPermittedError",
    "ToolRegistry",
    "ToolResult",
    "ToolSpec",
    "ToolStatus",
    "Transport",
    "UnknownToolError",
    "UrllibTransport",
    "VerifiedClaim",
    "VisionModelUnverified",
    "answer_from_mapping",
    "build_registry",
    "check_schema",
    "claim_coverage",
    "content_tokens",
    "dispatch",
    "load_paper_view",
    "target_type_for_block_type",
    "tool_definitions",
    "validate_arguments",
    "verify_grounding",
]
