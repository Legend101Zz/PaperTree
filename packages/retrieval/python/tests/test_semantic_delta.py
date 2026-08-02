"""The structural-vs-semantic measurement EPIC-03 §4 demands — and its honest scope.

    "Retrieval is structure-aware first, semantic second. Measure the delta before adding vector
     search — do not assume embeddings help."

NOT AN ACCEPTANCE CRITERION. `retrieval/expansion.spec` and `retrieval/budget.spec` are the two
criteria and they live in `test_expansion.py` and `test_budget.py`. This file exists because the
epic gives an instruction — measure the delta — that no criterion covers, and an instruction
nobody executed is indistinguishable from one nobody read.

═══ WHAT IS MEASURED, AND WHAT IS NOT, STATED BEFORE ANY NUMBER APPEARS ═══════════════════════

MEASURED HERE: the plumbing. With deterministic synthetic vectors in `block_vectors`,

    * does the semantic rung fire at all;
    * does it add blocks the six structural rungs did NOT reach — i.e. is it capable of
      contributing, or is it always a subset of what structure already found;
    * does it leave the structural result byte-identical, so turning it on cannot silently
      reorder or displace structurally-grounded evidence;
    * is its own ordering stable across runs, including under sqlite-vec distance ties.

**NOT MEASURED, HERE OR ANYWHERE IN THIS REPOSITORY: whether real embeddings improve retrieval
quality.** There is no embedding model here. Epic 0 computes none — `put_block_vector`'s docstring
says so in as many words — and producing real vectors needs either a network call or a new runtime
dependency, both of which this package refuses. The vectors below are SHA-256 expansions of block
ids: reproducible, uniformly distributed, and semantically meaningless by construction. A number
derived from them says something about the query path and nothing whatever about relevance.

Scoring the real delta needs two things that do not exist: an embedding model, and a labelled
question set. EPIC-03 §7 records that the second is missing too — the "120 Tier C questions"
appear in four prose documents and zero data files. So the honest verdict for F3.2's semantic half
is NOT MEASURED, and it is reported as NOT MEASURED rather than rounded up. Epic 1 rounded four
PARTIALs to MET and the correction cost more than the honesty would have (AGENTS.md §2).

WHAT THAT MEANS FOR THE DESIGN. Precisely because the delta is unknown, the semantic rung is
opt-in through a required argument, is last in the ladder, gets the smallest budget of the seven
components, and cannot displace a structurally-reached block. Those are the choices you make when
you do not know whether something helps — not the choices you make once you have measured that it
does.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from _retrieval_corpus import CORPUS_PAPER, requires_corpus
from _retrieval_fixtures import (
    ParsedPaper,
    corpus_paper,
    deterministic_embedding,
    vectorised_paper,
)
from papertree_db import BlockId, PaperTreeDb
from papertree_retrieval import (
    DEFAULT_EXPANSION_POLICY,
    ExpansionPolicy,
    PaperIndex,
    SemanticQuery,
    Stage,
    expand,
)


@pytest.fixture(scope="module")
def paper() -> ParsedPaper:
    """Its OWN database — see `_retrieval_fixtures.vectorised_paper` for why that matters."""
    return vectorised_paper()


@pytest.fixture(scope="module")
def index(paper: ParsedPaper) -> PaperIndex:
    return PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)


def _block_type(index: PaperIndex, block_id: str) -> str:
    block = index.block(block_id)
    assert block is not None
    return block.type


def _first_of_type(index: PaperIndex, block_type: str) -> str:
    return next(b for b in index.reading_order if _block_type(index, b) == block_type)


def _query_for(block_id: str, k: int) -> SemanticQuery:
    """A query that is EXACTLY one stored block's vector, so its nearest neighbour is that block.

    Deliberate: it makes the expected top hit a fact about the fixture rather than a guess, which
    is what lets the assertions below be about the retrieval path instead of about whether some
    random vector happened to land near something.
    """
    return SemanticQuery(
        embedding=deterministic_embedding(block_id), k=k, model="synthetic/sha256-expansion"
    )


def test_the_semantic_rung_does_not_run_unless_the_caller_asks(index: PaperIndex) -> None:
    """Vectors exist and are still not consulted. The opt-in is real, not documentation.

    `expand`'s `semantic` parameter has no default, so this is not a matter of remembering to pass
    `None` — a call site that says nothing about vector search does not compile.
    """
    assert index.vector_count > 0

    caption = _first_of_type(index, "caption")
    structural = expand(index, [caption], DEFAULT_EXPANSION_POLICY, None)

    assert structural.semantic_requested is False
    assert structural.by_stage(Stage.SEMANTIC) == ()
    # ...and it still reports how many vectors it declined to use, so "found nothing" and
    # "there was nothing to find" stay distinguishable in the result itself.
    assert structural.vector_count == index.vector_count


def test_the_semantic_rung_adds_blocks_the_structural_rungs_did_not_reach(
    index: PaperIndex,
) -> None:
    """THE DELTA MEASUREMENT — of the query path, and of nothing else.

    The query is the stored vector of a block the structural ladder does not reach from this
    selection, so the rung has something real to contribute. Asserted, not assumed: the target is
    first checked to be absent from the structural result.

    Prints the counts so a reader of the test log sees the actual delta for this run. THOSE NUMBERS
    ARE ABOUT SYNTHETIC VECTORS. See the module docstring before quoting any of them.
    """
    caption = _first_of_type(index, "caption")
    structural = expand(index, [caption], DEFAULT_EXPANSION_POLICY, None)
    structural_ids = set(structural.block_ids)

    unreached = [b for b in index.reading_order if b not in structural_ids]
    assert unreached, "the structural ladder reached every block; nothing left to measure"
    target = unreached[0]

    combined = expand(index, [caption], DEFAULT_EXPANSION_POLICY, _query_for(target, k=8))
    semantic_hits = combined.by_stage(Stage.SEMANTIC)
    added = [hit.block_id for hit in semantic_hits]

    print(
        f"\n[retrieval] structural-only vs structural+semantic (SYNTHETIC vectors, "
        f"{index.vector_count} stored, {len(index)} blocks): "
        f"structural={len(structural.block_ids)} combined={len(combined.block_ids)} "
        f"added_by_semantic={len(added)} overlap_with_structural=0 by construction. "
        f"REAL-MODEL DELTA: NOT MEASURED — no embedding model exists in this repository."
    )

    assert combined.semantic_requested is True
    assert added, "the semantic rung fired and contributed nothing; it is not wired up"
    assert target in added
    assert not (set(added) & structural_ids)
    assert all(hit.distance is not None for hit in semantic_hits)
    assert semantic_hits[0].block_id == target
    assert semantic_hits[0].distance == pytest.approx(0.0, abs=1e-4)


def test_turning_semantic_on_leaves_the_structural_result_byte_identical(
    index: PaperIndex,
) -> None:
    """Semantic is additive. It cannot reorder, replace or displace structurally-grounded evidence.

    This is the property that makes "structure-aware first" true of the OUTPUT and not just of the
    source order: the first N entries of the combined expansion are the structural expansion,
    entry for entry, reason for reason.
    """
    caption = _first_of_type(index, "caption")
    target = _first_of_type(index, "reference_entry")

    structural = expand(index, [caption], DEFAULT_EXPANSION_POLICY, None)
    combined = expand(index, [caption], DEFAULT_EXPANSION_POLICY, _query_for(target, k=8))

    prefix = combined.blocks[: len(structural.blocks)]
    assert prefix == structural.blocks
    assert all(block.stage is Stage.SEMANTIC for block in combined.blocks[len(structural.blocks) :])
    assert combined.selection == structural.selection


def test_the_semantic_ordering_is_deterministic(index: PaperIndex) -> None:
    """Same query, same hits, same order — including where sqlite-vec returns tied distances.

    vec0 returns rows in distance order and says nothing about ties, and ties are not hypothetical:
    two blocks carrying identical embeddings sit at the same distance from everything. The index
    re-sorts by `(distance, reading-order rank, block id)`, so the result cannot depend on the
    order the virtual table happened to emit.
    """
    caption = _first_of_type(index, "caption")
    target = _first_of_type(index, "reference_entry")
    query = _query_for(target, k=8)

    runs = [expand(index, [caption], DEFAULT_EXPANSION_POLICY, query) for _ in range(3)]
    assert runs[0] == runs[1] == runs[2]

    distances = [hit.distance for hit in runs[0].by_stage(Stage.SEMANTIC)]
    assert distances == sorted(d for d in distances if d is not None)


def test_the_semantic_limit_is_a_cap_on_NEW_hits_and_the_overflow_is_recorded(
    index: PaperIndex,
) -> None:
    """`semantic_limit=1` yields exactly one new block, and the rest are recorded as capped.

    Over-fetch-then-trim rather than fetch-exactly-k: KNN does not know which blocks the structural
    rungs already claimed, so asking for k and discarding the overlap would return a number of new
    hits that depends on how much the structure happened to overlap. "1 semantic hit" has to mean
    one.
    """
    caption = _first_of_type(index, "caption")
    target = _first_of_type(index, "reference_entry")
    policy = ExpansionPolicy(semantic_limit=1)

    expansion = expand(index, [caption], policy, _query_for(target, k=8))
    assert len(expansion.by_stage(Stage.SEMANTIC)) == 1
    capped = dict(expansion.capped)
    assert capped.get(Stage.SEMANTIC, 0) >= 1, expansion.capped


def test_a_vector_whose_block_has_vanished_is_dropped_rather_than_returned(
    paper: ParsedPaper, tmp_path: Path
) -> None:
    """A vector can outlive its block; handing back an unresolvable id is worse than fewer hits.

    Nothing cascades `block_vectors` on a re-parse, so a stale row is a real possibility rather
    than a defensive fantasy.

    Run against a FILE COPY of the fixture database, not the fixture itself. Writing a stray vector
    into the shared database would make `test_the_semantic_rung_does_not_run_unless_the_caller_asks`
    pass or fail depending on which test pytest ran first — a result that depends on execution
    order is the same defect as a result that depends on hash order. A copy costs one `shutil.copy`
    and no re-parse.
    """
    copied = tmp_path / "papertree.sqlite"
    shutil.copy(paper.database_path, copied)
    database = PaperTreeDb(str(copied))
    owner = database.owner_for(paper.user_id)

    ghost = BlockId("blk_thisblockdoesnotexist")
    database.put_block_vector(
        owner,
        paper.paper_id,
        paper.generation,
        ghost,
        "synthetic/sha256-expansion",
        deterministic_embedding(str(ghost)),
    )
    index = PaperIndex.load(database, owner, paper.paper_id, paper.generation)

    assert index.block(str(ghost)) is None
    hits = index.search_vectors(deterministic_embedding(str(ghost)), k=4)
    assert hits, "the KNN returned nothing at all; the fixture is wrong, not the filter"
    assert str(ghost) not in [block_id for block_id, _distance in hits]
    database.close()


@requires_corpus
def test_the_delta_on_a_real_paper_is_reported_and_is_still_about_synthetic_vectors() -> None:
    """The same measurement at 974-block scale. SKIPS ON CI — the corpus is gitignored.

    Scale changes what the plumbing test can show: on a 10-block paper the structural ladder
    reaches most of the document, so "semantic added something" is nearly free. On resnet it
    reaches a few dozen of 974, and the semantic rung is choosing from hundreds. The delta printed
    below is therefore a meaningful measurement OF THE QUERY PATH at realistic cardinality — and
    still says nothing about relevance, because the vectors are still SHA-256 of block ids.
    """
    paper = corpus_paper(CORPUS_PAPER)
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)

    with_text = [
        block_id
        for block_id in index.reading_order
        if (block := index.block(block_id)) is not None and len(block.text) > 200
    ]
    assert len(with_text) > 20
    for block_id in with_text:
        paper.db.put_block_vector(
            paper.owner,
            paper.paper_id,
            paper.generation,
            BlockId(block_id),
            "synthetic/sha256-expansion",
            deterministic_embedding(block_id),
        )
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    assert index.vector_count == len(with_text)

    selection = with_text[0]
    structural = expand(index, [selection], DEFAULT_EXPANSION_POLICY, None)
    structural_ids = set(structural.block_ids)
    target = next(b for b in with_text if b not in structural_ids)
    combined = expand(index, [selection], DEFAULT_EXPANSION_POLICY, _query_for(target, k=8))
    added = [hit.block_id for hit in combined.by_stage(Stage.SEMANTIC)]

    print(
        f"\n[retrieval] corpus delta (SYNTHETIC vectors): blocks={len(index)} "
        f"vectors={index.vector_count} structural={len(structural.block_ids)} "
        f"combined={len(combined.block_ids)} added_by_semantic={len(added)}. "
        f"REAL-MODEL DELTA: NOT MEASURED."
    )
    assert added
    assert not (set(added) & structural_ids)
    assert combined.blocks[: len(structural.blocks)] == structural.blocks
