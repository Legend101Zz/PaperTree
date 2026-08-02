"""papertree_retrieval — structure-aware retrieval (F3.2) and evidence assembly (F3.3).

    index      -> PaperIndex.load(db, owner, paper_id, generation)
    expand     -> expand(index, selection, policy, semantic) -> Expansion
    assemble   -> assemble_evidence(expansion, policy, estimator) -> EvidencePackage

Two acceptance criteria live here: ``retrieval/expansion.spec`` (``tests/test_expansion.py``) and
``retrieval/budget.spec`` (``tests/test_budget.py``).

═══ THE ONE IDEA ══════════════════════════════════════════════════════════════════════════════

THE PARSE TREE IS THE INDEX. A research paper already carries, in its own structure, most of what
a retriever is normally asked to rediscover statistically: an equation belongs to the paragraph
that introduces it, a caption belongs to its figure, a citation marker belongs to a bibliography
entry, a paragraph belongs to a section that has a title and a place in an outline. Epic 1 spent
an entire epic extracting exactly those edges into ``blocks``, ``relations`` and
``papers.sections``. Embedding all of it into one 768-dimensional space and asking for nearest
neighbours throws that work away and then approximates it.

So EPIC-03 §4 is a rule, not a preference: **"Retrieval is structure-aware first, semantic second.
Measure the delta before adding vector search — do not assume embeddings help."** This package is
arranged so the rule is CHECKABLE:

  * six structural rungs run with no embeddings in the database at all, and a test asserts a full
    expansion while ``count_block_vectors`` is 0;
  * the semantic rung is opt-in through a REQUIRED ``semantic`` argument that may be ``None``,
    so no caller reaches vector search by forgetting a keyword;
  * ``Expansion.vector_count`` reports how many vectors existed, so "semantic found nothing" and
    "there was nothing to search" are different answers rather than the same empty list.

═══ WHAT IS NOT MEASURED, STATED PLAINLY ══════════════════════════════════════════════════════

**THE REAL-MODEL SEMANTIC DELTA IS NOT MEASURED.** There is no embedding model in this repository.
Epic 0 computes no embeddings (``put_block_vector``'s own docstring says so), producing real ones
needs a network call or a new runtime dependency, and this package takes neither. What
``tests/test_semantic_delta.py`` measures is the PLUMBING, against deterministic synthetic vectors
the test writes itself: does the rung fire, does it add blocks the structural rungs missed, is the
ordering stable across runs. Whether real embeddings would help a real question is unmeasured and
is reported as unmeasured. A number invented for it would be the defect AGENTS.md §2 exists to
name.

**THE TOKEN COUNT IS AN ESTIMATE, AND THE CEILING IS AN UPPER-BOUND CLAIM.** MiniMax publishes no
tokenizer and ``tiktoken`` is a different model's vocabulary, so ``budget.py`` implements a
documented conservative estimator instead and states its safety margin and the exact class of
string that defeats it. ``TOKENIZER_AGNOSTIC_ESTIMATOR`` is the configuration whose bound is a
theorem; ``DEFAULT_TOKEN_ESTIMATOR`` is a stated 2x calibration over English prose. Read the first
sixty lines of ``budget.py`` before quoting "8,100 tokens" at anyone.

═══ THREE PaperIR FACTS THIS PACKAGE IS BUILT AROUND ══════════════════════════════════════════

Every one of these is measured on the corpus, and each would have produced a plausible-looking
retriever that returned wrong or empty results:

  1. ``doc_order`` is present on EXACTLY the top-level ``body`` blocks — 207 of resnet's 974 — so
     ``sorted(key=lambda b: b.doc_order or 0)`` collapses 767 captions, footnotes and table cells
     onto position 0. Reading order is rebuilt from per-page flows plus parent/child descent.
  2. ``prev_id``/``next_id`` are NEVER populated by the parser that exists: 0 of 974 on resnet,
     0 of 626 on neural-odes. An adjacency rung built on them would be dead code that passed its
     unit test. They are honoured as an override; the working path is the flow sequence.
  3. ``Relation.type`` and ``Block.type`` are OPEN vocabularies. ``is_known_relation_type`` is used
     here as a SORT KEY and never as a filter, so a relation type invented by a future parser is
     followed and returned rather than dropped. And of the 12 known types, the parser emits three
     — ``caption_of``, ``continues_on_next_page``, ``continues_in_next_column`` — which is why the
     relation rung walks edges in both directions and the citation rung has a documented label
     fallback rather than being permanently unreachable.

═══ USAGE ═════════════════════════════════════════════════════════════════════════════════════

    from papertree_retrieval import (
        DEFAULT_BUDGET_POLICY, DEFAULT_EXPANSION_POLICY, DEFAULT_TOKEN_ESTIMATOR,
        PaperIndex, assemble_evidence, expand,
    )

    index = PaperIndex.load(db, owner, paper_id, generation)
    expansion = expand(index, [block_id], DEFAULT_EXPANSION_POLICY, None)
    package = assemble_evidence(expansion, DEFAULT_BUDGET_POLICY, DEFAULT_TOKEN_ESTIMATOR)

    prompt_text = package.render()          # what goes to the model
    package.truncation                      # what did not, and why — data, not a log line
    package.block_ids                       # what every answer must cite from

Determinism is an acceptance criterion, not a nicety: identical input produces byte-identical
output ordering, in a fresh process, with hash randomisation on — asserted by running the
expansion in two subprocesses under two different ``PYTHONHASHSEED`` values. No set's iteration
order ever reaches a result: sets appear only as membership tests, and the one set comprehension
in the package (``index.py``'s page list) is consumed by ``sorted()`` on the same line.
"""

from __future__ import annotations

from papertree_retrieval.budget import (
    DEFAULT_BUDGET_POLICY,
    DEFAULT_TOKEN_ESTIMATOR,
    EVIDENCE_CEILING_TOKENS,
    TEXT_TRUNCATION_MARKER,
    TOKENIZER_AGNOSTIC_ESTIMATOR,
    AtomTokenEstimator,
    BudgetPolicy,
    Component,
    ComponentUsage,
    EvidenceItem,
    EvidencePackage,
    TokenEstimator,
    TruncationReason,
    TruncationRecord,
    assemble_evidence,
)
from papertree_retrieval.expansion import (
    CITATION_RELATION_TYPES,
    DEFAULT_EXPANSION_POLICY,
    DEFAULT_REGION_TYPES,
    KNOWN_RELATION_ORDER,
    RELATED_RELATION_TYPES,
    STAGE_ORDER,
    Expansion,
    ExpansionPolicy,
    RegionRequest,
    RetrievedBlock,
    SemanticQuery,
    Stage,
    expand,
)
from papertree_retrieval.index import (
    FLOW_READING_ORDER,
    IndexedBlock,
    IndexedReference,
    IndexedRelation,
    IndexedSection,
    PaperIndex,
    PaperReader,
)

__all__ = [
    "CITATION_RELATION_TYPES",
    "DEFAULT_BUDGET_POLICY",
    "DEFAULT_EXPANSION_POLICY",
    "DEFAULT_REGION_TYPES",
    "DEFAULT_TOKEN_ESTIMATOR",
    "EVIDENCE_CEILING_TOKENS",
    "FLOW_READING_ORDER",
    "KNOWN_RELATION_ORDER",
    "RELATED_RELATION_TYPES",
    "STAGE_ORDER",
    "TEXT_TRUNCATION_MARKER",
    "TOKENIZER_AGNOSTIC_ESTIMATOR",
    "AtomTokenEstimator",
    "BudgetPolicy",
    "Component",
    "ComponentUsage",
    "EvidenceItem",
    "EvidencePackage",
    "Expansion",
    "ExpansionPolicy",
    "IndexedBlock",
    "IndexedReference",
    "IndexedRelation",
    "IndexedSection",
    "PaperIndex",
    "PaperReader",
    "RegionRequest",
    "RetrievedBlock",
    "SemanticQuery",
    "Stage",
    "TokenEstimator",
    "TruncationReason",
    "TruncationRecord",
    "assemble_evidence",
    "expand",
]
