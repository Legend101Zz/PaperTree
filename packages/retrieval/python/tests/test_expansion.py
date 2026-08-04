"""ACCEPTANCE CRITERION `retrieval/expansion.spec` (EPIC-03 F3.2).

    "Structure-aware expansion returns the parent section, adjacent blocks and related
     equation/figure for a selection — deterministically."

Every assertion here runs against PaperIR that `services/document-worker` really produced from a
PDF and that `papertree_db` really stored. There is no hand-written block graph anywhere in this
file, because a hand-written graph asserts that the retriever matches the author's idea of the
schema, and the author's idea of the schema is the thing that has been wrong three times in this
repo (AGENTS.md §2). Two of this package's design decisions exist ONLY because a real parse
contradicted the spec-shaped assumption: `prev_id`/`next_id` are never emitted, and only four of
the twelve relation types are — `caption_of`, the two `continues_*`, and, since #66, `cites`.

THE DETERMINISM HALF IS THE HALF THAT IS EASY TO FAKE. Running `expand` twice inside one process
and comparing proves almost nothing: Python interns short strings, a dict built the same way
twice iterates the same way twice, and a set ordered by `hash(str)` is stable for the whole life
of ONE process because `PYTHONHASHSEED` is fixed at interpreter start. A set-ordered result would
therefore pass a run-it-twice test, pass CI, and disagree between two production workers. So the
determinism assertion here runs the expansion in TWO FRESH SUBPROCESSES under two different
`PYTHONHASHSEED` values and compares those against each other and against this process.

WHAT IS COVERED WHERE:

    here (always runs)     every rung, on a synthetic two-page PDF built in process
    corpus (local only)    the same guarantees on a 12-page, 974-block, two-column real paper
    NOT covered anywhere   whether the RESULT is a good retrieval. There is no labelled question
                           set (EPIC-03 §7: the 120 Tier C questions do not exist), so this file
                           asserts structure and determinism and claims nothing about quality.
"""

from __future__ import annotations

import json
import subprocess
import sys

import pytest
from _retrieval_corpus import CORPUS_PAPER, requires_corpus
from _retrieval_fixtures import (
    UNKNOWN_RELATION_TYPE,
    ParsedPaper,
    augmented_paper,
    corpus_paper,
    pre_citation_paper,
)
from _retrieval_fixtures import synthetic_paper as _synthetic_paper
from papertree_retrieval import (
    DEFAULT_EXPANSION_POLICY,
    ExpansionPolicy,
    IndexedBlock,
    PaperIndex,
    Stage,
    expand,
)


@pytest.fixture(scope="module")
def paper() -> ParsedPaper:
    """The UNAUGMENTED parse. Every acceptance assertion uses this one."""
    return _synthetic_paper()


@pytest.fixture(scope="module")
def index(paper: ParsedPaper) -> PaperIndex:
    return PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)


def _only(index: PaperIndex, block_type: str) -> str:
    ids = [b for b in index.reading_order if _type_of(index, b) == block_type]
    assert ids, f"the parse produced no {block_type} block; this fixture has drifted"
    return ids[0]


def _type_of(index: PaperIndex, block_id: str) -> str:
    block = index.block(block_id)
    assert block is not None
    return block.type


# ── the criterion ────────────────────────────────────────────────────────────────────────────


def test_expansion_returns_parent_section_adjacent_blocks_and_related_figure(
    index: PaperIndex,
) -> None:
    """THE ACCEPTANCE CRITERION, on unaugmented parser output.

    The selection is the figure caption, chosen because it is the one block for which all three
    demands are answerable from what the parser actually emits:

        parent section       `papers.sections` puts the caption in section "1  Introduction"
        adjacent blocks      per-page flow order gives the equation before and "2  Method" after
        related figure       a REAL `caption_of` relation, provenance "geometric+numbering"

    Each of the three is asserted by REASON as well as by presence, so a block that arrived
    through some other rung cannot satisfy the criterion by coincidence.
    """
    caption = _only(index, "caption")
    expansion = expand(index, [caption], DEFAULT_EXPANSION_POLICY, None)

    by_reason = {block.reason: block for block in expansion.blocks}

    section_heading = by_reason["section-heading"]
    assert section_heading.type == "heading"
    assert section_heading.text == "1  Introduction"

    assert by_reason["adjacent:-1"].type == "equation"
    assert by_reason["adjacent:+1"].type == "heading"
    assert by_reason["adjacent:+1"].text == "2  Method"

    related = expansion.by_stage(Stage.RELATED)
    assert [block.type for block in related] == ["figure"]
    assert related[0].reason == f"caption_of->{caption}"

    # ...and the region-crop rung offered a crop for the figure it just found.
    assert [region.type for region in expansion.regions] == ["equation", "figure"]


def test_the_related_figure_edge_was_produced_by_the_parser_not_by_this_test(
    paper: ParsedPaper,
) -> None:
    """Guards the test above from becoming vacuous if the fixture ever starts authoring relations.

    The criterion is only interesting if the `caption_of` edge is real. This asserts it against the
    stored document: every relation, with the parser's own provenance string. If somebody later
    adds an authored edge to the unaugmented fixture, this fails.

    MOVED BY #66, TWICE. The `("cites", "printed_label")` row came with the citation half — the
    paragraph says "See also He et al. [1]" and page 2 prints "[1] K. He, ...". The
    `("references", "caption-label")` row comes with the float half: the same paragraph says
    "Figure 1 below" and the caption printed on that page is "Figure 1". Both are the parser's.
    An authored edge would carry `provenance: "authored-by-test"`, so the guard still
    distinguishes them, and it is now strictly stronger than when it was written.
    """
    relations = paper.document["relations"]
    assert sorted((r["type"], r["provenance"]) for r in relations) == [
        ("caption_of", "geometric+numbering"),
        ("cites", "printed_label"),
        ("references", "caption-label"),
    ]


# ── determinism ──────────────────────────────────────────────────────────────────────────────


def test_expansion_is_byte_identical_when_repeated_on_a_freshly_loaded_index(
    paper: ParsedPaper, index: PaperIndex
) -> None:
    """Same input, same output — including from an index built a second time from the database.

    Reloading matters: an ordering that came from the order rows arrived in, or from a dict built
    during the first load, would survive `expand(index, ...)` twice and die here.
    """
    caption = _only(index, "caption")
    first = expand(index, [caption], DEFAULT_EXPANSION_POLICY, None)
    second = expand(index, [caption], DEFAULT_EXPANSION_POLICY, None)
    reloaded = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    third = expand(reloaded, [caption], DEFAULT_EXPANSION_POLICY, None)

    assert first == second
    assert first == third
    assert first.blocks == third.blocks
    assert first.regions == third.regions


def test_selection_order_does_not_change_the_result(index: PaperIndex) -> None:
    """`expand` sorts the selection into reading order, so the caller's order is not an input."""
    caption = _only(index, "caption")
    paragraph = _only(index, "paragraph")
    forwards = expand(index, [paragraph, caption], DEFAULT_EXPANSION_POLICY, None)
    backwards = expand(index, [caption, paragraph], DEFAULT_EXPANSION_POLICY, None)
    duplicated = expand(
        index, [caption, paragraph, caption, paragraph], DEFAULT_EXPANSION_POLICY, None
    )
    assert forwards == backwards
    assert forwards == duplicated


_SUBPROCESS_PROGRAM = """
import json, sys
from papertree_db import PaperTreeDb, PaperId, generation
from papertree_retrieval import DEFAULT_EXPANSION_POLICY, PaperIndex, expand

database_path, user_id, paper_id, block_id = sys.argv[1:5]
db = PaperTreeDb(database_path)
owner = db.owner_for(user_id)
index = PaperIndex.load(db, owner, PaperId(paper_id), generation(1))
expansion = expand(index, [block_id], DEFAULT_EXPANSION_POLICY, None)
print(json.dumps([[b.block_id, b.stage.value, b.reason] for b in expansion.blocks]))
"""


def _expansion_in_subprocess(paper: ParsedPaper, block_id: str, hash_seed: str) -> object:
    """Runs the expansion in a fresh interpreter under an explicit `PYTHONHASHSEED`.

    `sys.executable` is the venv interpreter by absolute path, so a minimal environment is enough
    and is what is passed: everything this reads comes from its own prefix. The environment is
    minimal rather than inherited so that nothing about THIS process — least of all its hash seed —
    leaks into the child and quietly makes the two runs agree for the wrong reason.
    """
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            _SUBPROCESS_PROGRAM,
            str(paper.database_path),
            paper.user_id,
            str(paper.paper_id),
            block_id,
        ],
        capture_output=True,
        text=True,
        check=False,
        env={"PYTHONHASHSEED": hash_seed, "PATH": "/usr/bin:/bin"},
    )
    assert completed.returncode == 0, (
        f"the child interpreter failed (PYTHONHASHSEED={hash_seed}); this test measures nothing "
        f"unless it runs.\nstdout: {completed.stdout}\nstderr: {completed.stderr}"
    )
    return json.loads(completed.stdout)


def test_ordering_is_identical_in_fresh_processes_under_different_hash_seeds(
    paper: ParsedPaper, index: PaperIndex
) -> None:
    """The determinism assertion that a run-it-twice test cannot make.

    `str.__hash__` is randomised per interpreter (PYTHONHASHSEED is unset by default), so a result
    whose order came from iterating a `set` or an unsorted `dict` of block ids is STABLE within one
    process and DIFFERENT between two. This runs the same expansion in two fresh interpreters under
    two different explicit seeds and compares both against each other and against this process.

    Capable of failing for the reason it claims, and that was verified by doing it rather than by
    assuming it: changing `_adjacent`'s loop to `for block_id, reason in set(targets)` makes THIS
    test the only failure in the package — 1 failed, all others green. The run-it-twice test above
    passes with that bug in place, which is the whole reason this one exists.
    """
    caption = _only(index, "caption")
    in_process = [
        [block.block_id, block.stage.value, block.reason]
        for block in expand(index, [caption], DEFAULT_EXPANSION_POLICY, None).blocks
    ]
    seed_zero = _expansion_in_subprocess(paper, caption, "0")
    seed_other = _expansion_in_subprocess(paper, caption, "987654321")

    assert seed_zero == seed_other
    assert seed_zero == in_process


# ── "structure-aware first, semantic second" ─────────────────────────────────────────────────


def test_the_structural_ladder_returns_a_full_expansion_with_zero_embeddings(
    index: PaperIndex,
) -> None:
    """EPIC-03 §4's rule, asserted rather than described.

    `count_block_vectors` is 0 on this paper — Epic 0 computes no embeddings and this fixture
    stores none. If any structural rung had grown a dependency on the vector table, this would
    return a stunted expansion instead of the five distinct rungs asserted below.
    """
    assert index.vector_count == 0

    caption = _only(index, "caption")
    expansion = expand(index, [caption], DEFAULT_EXPANSION_POLICY, None)

    assert expansion.vector_count == 0
    assert expansion.semantic_requested is False
    assert expansion.by_stage(Stage.SEMANTIC) == ()
    stages = {block.stage for block in expansion.blocks}
    assert stages == {Stage.SELECTION, Stage.STRUCTURE, Stage.ADJACENT, Stage.RELATED}
    assert len(expansion.blocks) >= 6


def test_the_reading_order_is_not_built_from_doc_order(index: PaperIndex) -> None:
    """The AGENTS.md trap, demonstrated on real parser output and then shown to be avoided.

    `doc_order` is present on EXACTLY the top-level blocks whose flow is `body`. This paper's
    running head and page numbers land in the `header` and `footer` flows and carry none, which is
    what makes the trap reproducible on CI without a table.

    Three halves, and the middle one is what stops this being decorative:

      1. THE TRAP IS REACHABLE HERE — some block has no `doc_order`.
      2. THE TRAP IS REAL — `sorted(key=lambda b: b.doc_order or 0)` crushes every one of those
         blocks into the first few positions of the document, ahead of body text they follow by
         several pages. Asserted, not assumed.
      3. THE INDEX DOES NOT FALL IN — the real reading order puts page 2's furniture after all of
         page 1's body, and puts each page's running head before that page's title/body, which is
         where a reader meets them.
    """
    without_doc_order = [
        block_id for block_id in index.reading_order if _block(index, block_id).doc_order is None
    ]
    assert len(without_doc_order) >= 4, (
        f"expected the running head and page numbers to carry no doc_order, got "
        f"{len(without_doc_order)} such blocks; the fixture no longer exercises the trap"
    )

    collapsed = sorted(
        index.reading_order,
        key=lambda block_id: (_block(index, block_id).doc_order or 0, block_id),
    )
    positions = [collapsed.index(block_id) for block_id in without_doc_order]
    assert max(positions) <= len(without_doc_order), (
        f"the collapsed sort was expected to crush every doc_order-less block into the first "
        f"{len(without_doc_order) + 1} positions; got positions {sorted(positions)}"
    )

    last_page = max(_block(index, b).page_index for b in index.reading_order)
    late_furniture = [b for b in without_doc_order if _block(index, b).page_index == last_page]
    assert late_furniture
    first_page_body = [
        b
        for b in index.reading_order
        if _block(index, b).page_index == 0 and _block(index, b).flow == "body"
    ]
    assert index.reading_order.index(late_furniture[0]) > index.reading_order.index(
        first_page_body[-1]
    ), "the real reading order put page 2's furniture before page 1's body"

    head = next(b for b in index.reading_order if _block(index, b).flow == "header")
    assert index.reading_order.index(head) < index.reading_order.index(first_page_body[0]), (
        "FLOW_READING_ORDER puts the running head before the body of its own page"
    )


def _block(index: PaperIndex, block_id: str) -> IndexedBlock:
    block = index.block(block_id)
    assert block is not None
    return block


def test_a_block_reachable_by_two_rungs_is_attributed_to_the_earlier_one(index: PaperIndex) -> None:
    """First rung wins, so "why is this block in my prompt" has exactly one answer.

    The equation is both the caption's immediate predecessor and a member of the caption's section.
    Under the default policy it is claimed by ADJACENT (the section-sibling step defers to the
    adjacency reservation); with the adjacency radius at 0 the same block is claimed by STRUCTURE.
    Either way it appears ONCE, which is the property the budget assembler depends on — a block
    counted twice would be charged twice against the ceiling.
    """
    caption = _only(index, "caption")
    equation = _only(index, "equation")

    default = expand(index, [caption], DEFAULT_EXPANSION_POLICY, None)
    assert [b.block_id for b in default.blocks].count(equation) == 1
    assert next(b for b in default.blocks if b.block_id == equation).stage is Stage.ADJACENT

    no_adjacency = expand(index, [caption], ExpansionPolicy(adjacent_radius=0), None)
    assert [b.block_id for b in no_adjacency.blocks].count(equation) == 1
    assert next(b for b in no_adjacency.blocks if b.block_id == equation).stage is Stage.STRUCTURE


# ── the open relation vocabulary, and the citation rung ──────────────────────────────────────


def test_an_unknown_relation_type_is_followed_and_reaches_the_caller_named() -> None:
    """DESIGN.md D2: an unknown relation type is PRESERVED, never dropped.

    USES THE AUGMENTED FIXTURE. The parser emits three relation types and none of them is unknown,
    so this edge is authored by `_retrieval_fixtures.augmented_paper` — stated here rather than
    left for a reader to discover. What is being tested is this package's handling, not the
    parser's output.

    The policy zeroes the adjacency radius and the section-sibling limit, so the relation rung is
    the ONLY rung that can reach the equation and the figure. Under the default policy the equation
    is the paragraph's immediate neighbour and is claimed by ADJACENT first — correct behaviour
    (one block, one reason) but it would make this assertion about the relation rung vacuous.
    """
    paper = augmented_paper()
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    paragraph = _only(index, "paragraph")
    isolating = ExpansionPolicy(adjacent_radius=0, section_sibling_limit=0)

    expansion = expand(index, [paragraph], isolating, None)
    reasons = [block.reason for block in expansion.by_stage(Stage.RELATED)]

    assert any(reason.startswith(f"{UNKNOWN_RELATION_TYPE}->") for reason in reasons), reasons
    assert any(reason.startswith("explains->") for reason in reasons), reasons
    # Known types rank before unknown ones, and that ordering is part of the determinism claim.
    assert reasons.index(next(r for r in reasons if r.startswith("explains->"))) < reasons.index(
        next(r for r in reasons if r.startswith(UNKNOWN_RELATION_TYPE))
    )


def test_an_unknown_relation_type_can_be_switched_off_but_is_on_by_default() -> None:
    """The opt-out exists; the default is to preserve. A caller that drops data has to say so."""
    paper = augmented_paper()
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    paragraph = _only(index, "paragraph")

    policy = ExpansionPolicy(follow_unknown_relation_types=False)
    reasons = [
        block.reason for block in expand(index, [paragraph], policy, None).by_stage(Stage.RELATED)
    ]
    assert not any(reason.startswith(UNKNOWN_RELATION_TYPE) for reason in reasons)
    assert DEFAULT_EXPANSION_POLICY.follow_unknown_relation_types is True


def test_a_cites_edge_resolves_the_reference_entry(index: PaperIndex) -> None:
    """The edge-driven citation path, on UNAUGMENTED parser output.

    MOVED BY #66. This used to need `augmented_paper()` because the parser emitted no `cites` at
    all; the edge is now the parser's own, so the path is exercised by real output and the reason
    string says `cites->` rather than `cited-label:`. That difference is the whole point: a
    consumer must be able to tell a PARSED citation from an INFERRED one.
    """
    paragraph = _only(index, "paragraph")

    citations = expand(index, [paragraph], DEFAULT_EXPANSION_POLICY, None).by_stage(Stage.CITATIONS)
    assert [block.type for block in citations] == ["reference_entry"]
    assert citations[0].reason.startswith("cites->")
    assert citations[0].text.startswith("[1] K. He")


def test_a_bracketed_marker_resolves_the_reference_entry_with_no_relation_at_all() -> None:
    """The documented fallback, on a document with the `cites` edges stripped out.

    MOVED BY #66, AND NOT BY LOOSENING ANYTHING. This used to run on the plain fixture, because
    the parser emitted no `cites` and the fallback was the only route. It now runs on
    `pre_citation_paper()` — the same parse with `cites` removed, which is the shape of EVERY
    paper stored before #66, since relations are written at parse time. On the plain fixture the
    real edge claims the entry first (`_Accumulator` is first-claim-wins) and this path would
    never execute, so moving the test is what keeps it from silently ceasing to test anything —
    findings.md §A's failure arriving by improvement rather than by neglect.
    """
    paper = pre_citation_paper()
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    paragraph = _only(index, "paragraph")
    citations = expand(index, [paragraph], DEFAULT_EXPANSION_POLICY, None).by_stage(Stage.CITATIONS)

    assert [block.type for block in citations] == ["reference_entry"]
    assert citations[0].reason == "cited-label:[1]"
    assert citations[0].text.startswith("[1] K. He")


def test_the_label_fallback_can_be_switched_off() -> None:
    """Inference is a policy, and switching it off leaves nothing — proving the fallback is what
    produced the hit above, rather than something else that happened to be there.

    On the same pre-#66 document, for the same reason: with a real `cites` edge present, switching
    the inference off leaves the EDGE, and this assertion would be about the wrong mechanism.
    """
    paper = pre_citation_paper()
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)
    paragraph = _only(index, "paragraph")
    policy = ExpansionPolicy(infer_citation_labels=False)
    assert expand(index, [paragraph], policy, None).by_stage(Stage.CITATIONS) == ()


def test_switching_the_label_fallback_off_leaves_the_parsed_edge(index: PaperIndex) -> None:
    """The other side of the pair, which only became askable with #66.

    `infer_citation_labels=False` must disable the INFERENCE and nothing else. On parser output
    that carries a real edge the rung still returns the entry, labelled as parsed.
    """
    paragraph = _only(index, "paragraph")
    policy = ExpansionPolicy(infer_citation_labels=False)
    citations = expand(index, [paragraph], policy, None).by_stage(Stage.CITATIONS)
    assert [block.type for block in citations] == ["reference_entry"]
    assert citations[0].reason.startswith("cites->")


# ── the answers that are supposed to be empty ────────────────────────────────────────────────


def test_front_matter_has_no_section_and_that_is_a_normal_answer(index: PaperIndex) -> None:
    """`section_of` returning None is the IR's design, not a lookup failure.

    Title, authors, affiliation and abstract are deliberately section-less. A parent-section
    lookup that treated None as an error would raise on the first block of every paper.
    """
    title = _only(index, "title")
    assert index.section_of(title) is None

    expansion = expand(index, [title], DEFAULT_EXPANSION_POLICY, None)
    assert expansion.by_stage(Stage.STRUCTURE) == ()
    assert expansion.by_stage(Stage.ADJACENT) != ()


def test_section_siblings_are_retrieved_when_the_adjacency_radius_is_zero(
    index: PaperIndex,
) -> None:
    """Exercises the section-sibling step, which the default radius leaves nothing for here.

    On this two-page paper a radius of 2 already covers the whole of section 1, so the siblings
    are all claimed by the adjacency rung (deliberately — see `expand`). Dropping the radius to 0
    hands them back and proves the step works rather than merely existing.
    """
    caption = _only(index, "caption")
    policy = ExpansionPolicy(adjacent_radius=0)
    expansion = expand(index, [caption], policy, None)

    reasons = [block.reason for block in expansion.by_stage(Stage.STRUCTURE)]
    assert expansion.by_stage(Stage.ADJACENT) == ()
    assert reasons.count("section-sibling") >= 2
    assert "section-heading" in reasons


def test_expand_refuses_an_empty_selection_and_an_entirely_unknown_one(index: PaperIndex) -> None:
    """Both failures are loud. An empty expansion looks, to a model, like an empty paper."""
    with pytest.raises(ValueError, match="at least one block"):
        expand(index, [], DEFAULT_EXPANSION_POLICY, None)
    with pytest.raises(KeyError):
        expand(index, ["blk_doesnotexist0000"], DEFAULT_EXPANSION_POLICY, None)


def test_a_negative_policy_bound_is_rejected_at_construction() -> None:
    with pytest.raises(ValueError, match="adjacent_radius must be >= 0"):
        ExpansionPolicy(adjacent_radius=-1)


# ── the corpus layer: local only, and it says so when it skips ───────────────────────────────


@requires_corpus
def test_expansion_on_a_real_two_column_paper() -> None:
    """The same guarantees on resnet-cvpr-2col: 12 pages, 974 blocks, 14 sections, 53 references.

    SKIPS ON CI — `research/benchmarks/corpus/*.pdf` is gitignored. Everything asserted here is
    also asserted on the synthetic paper above; this adds scale, nesting (755 blocks with a
    parent), two columns, and continuation relations that the synthetic paper has none of.
    """
    paper = corpus_paper(CORPUS_PAPER)
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)

    assert len(index) > 500
    assert len(index.sections) > 5
    assert index.vector_count == 0

    captions = [b for b in index.reading_order if _type_of(index, b) == "caption"]
    assert captions, "resnet has 11 captions; the parse has changed"

    # A caption whose `caption_of` edge the parser really produced.
    with_edge = [c for c in captions if index.relations_from(c)]
    assert with_edge, "resnet yields 7 caption_of relations; none survived into the index"
    caption = with_edge[0]

    expansion = expand(index, [caption], DEFAULT_EXPANSION_POLICY, None)
    related_types = {block.type for block in expansion.by_stage(Stage.RELATED)}
    assert related_types & {"figure", "table"}, related_types
    assert expansion.by_stage(Stage.ADJACENT) != ()
    assert expand(index, [caption], DEFAULT_EXPANSION_POLICY, None) == expansion


@requires_corpus
def test_a_nested_table_cell_resolves_to_its_table_and_its_section() -> None:
    """Nesting, which the synthetic paper has none of: resnet has 580 table cells under 175 rows.

    The parent chain and the section lookup both have to descend through the nesting — a cell's
    section is the section its TABLE sits in, and a cell's neighbours are the other cells, not the
    paragraph after the table. Sorting by `doc_order or 0` would have put all 580 at position 0.
    """
    paper = corpus_paper(CORPUS_PAPER)
    index = PaperIndex.load(paper.db, paper.owner, paper.paper_id, paper.generation)

    cells = [b for b in index.reading_order if _type_of(index, b) == "table_cell"]
    assert len(cells) > 100, f"expected hundreds of table cells, got {len(cells)}"
    cell = cells[len(cells) // 2]

    parents = index.parents(cell, DEFAULT_EXPANSION_POLICY.parent_depth)
    assert parents, "a table cell with no parent chain means nesting was lost"
    assert index.top_level_ancestor(cell) != cell

    expansion = expand(index, [cell], DEFAULT_EXPANSION_POLICY, None)
    parent_reasons = [
        block.reason
        for block in expansion.by_stage(Stage.STRUCTURE)
        if block.reason.startswith("parent:")
    ]
    assert parent_reasons == ["parent:1", "parent:2"][: len(parent_reasons)]
    assert parent_reasons

    neighbours = expansion.by_stage(Stage.ADJACENT)
    assert neighbours, "a table cell in the middle of a row has neighbours"
    assert all(block.type in {"table_cell", "table_row"} for block in neighbours), [
        block.type for block in neighbours
    ]
