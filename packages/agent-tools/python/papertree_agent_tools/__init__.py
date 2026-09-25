"""papertree_agent_tools — the answer contract, the grounding verifier, the read-only paper view.

    answer     the grounded-answer contract: ``GroundedAnswer``, ``VerifiedClaim``, ``SourceRegion``
    grounding  ``verify_grounding``: deterministic, offline; FLAGS unsupported claims, drops none
    paperview  ``load_paper_view``: one paper generation through the read-only ``AgentDataHandle``
    schema     a 14-keyword JSON Schema subset, used by ``packages/evaluation``'s scorer

WHAT LEFT THIS PACKAGE, AND WHY (reader release, ADR-002 §3.4, slice-plan §R R10)

The Python agent loop is gone: ``turn.py`` (the chat-completions tool loop), ``provider.py`` (the
OpenAI-compatible MiniMax client), ``runtime.py`` (the Pydantic AI adapter), ``registry.py`` and
``tools.py`` (the eighteen-tool registry, six of whose tools could never return data), and
``results.py``. The owner ruled that AI runs through the Pi SDK in ``services/agent`` (Node), which
calls MiniMax and reads the paper through four tools the API serves at
``/internal/agent/runs/{run_id}/…``. So there is ONE MiniMax client in the repository, and it is not
here. The model-facing corpus counts ``tools.py`` carried ("974 blocks", #120) went with it.

WHAT STAYED, AND WHO CALLS IT

  * ``verify_grounding`` runs on EVERY answer the API brokers: ``services/api``'s ``evidence.py``
    splits the agent's final text into claims, maps each claim's ``[bN]`` markers to the blocks the
    run was shown, and asks this verifier whether the claim's vocabulary is in those blocks. The
    verdict becomes ``Citation.supported``; the verifier's REASONS (which name the missing words)
    are not shown to the reader.
  * ``answer`` is the verifier's input and output type, and ``packages/evaluation``'s grounding
    scorer reads it.
  * ``schema`` is that scorer's argument checker.
  * ``paperview`` is the read-only way to hold one paper generation through ``AgentDataHandle``.

═══ WHAT THE VERIFIER CAN AND CANNOT DO — unchanged, and still the honest position ═══════════

**It is lexical.** It catches fabricated vocabulary and fabricated numbers. It cannot see negation,
comparator swaps or causal inversion, and it flags correct paraphrases. ``supported`` means
"necessary condition met", never "true". ``grounding.py``'s docstring carries the measurements.
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
    answer_to_wire,
    camel_case,
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
from papertree_agent_tools.schema import (
    ANNOTATION_KEYWORDS,
    CONSTRAINT_KEYWORDS,
    SchemaError,
    ToolArgumentError,
    check_schema,
    validate_arguments,
)

__all__ = [
    "ANNOTATION_KEYWORDS",
    "ANSWER_SCHEMA",
    "CITATION_TARGET_TYPES",
    "CONSTRAINT_KEYWORDS",
    "DEFAULT_COVERAGE_THRESHOLD",
    "STOPWORDS",
    "UNVERIFIED_REASON",
    "AnswerContractError",
    "ClaimEvidence",
    "GroundedAnswer",
    "PaperView",
    "SchemaError",
    "SourceRegion",
    "ToolArgumentError",
    "VerifiedClaim",
    "answer_from_mapping",
    "answer_to_wire",
    "camel_case",
    "check_schema",
    "claim_coverage",
    "content_tokens",
    "load_paper_view",
    "target_type_for_block_type",
    "validate_arguments",
    "verify_grounding",
]
