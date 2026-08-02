"""The eighteen tools against a REAL parsed database, and the trust boundary they run inside.

Everything here is built in process: PyMuPDF writes a PDF, ``services/document-worker`` parses
it, ``PaperTreeDb`` stores it, the writer is closed, and every assertion runs through an
``AgentDataHandle`` — which is the deployment shape. No fixture files, no committed database, no
corpus dependency for anything load-bearing.

THE TWO THINGS THIS FILE IS REALLY FOR

  1. **Honest empties.** Half of these tools cannot answer today because of issue #66's data
     gaps. Each of those has a test asserting the status AND asserting the reason says why —
     because ``status == 'empty'`` alone is satisfied by a tool that returns ``[]`` and shrugs,
     which is the implementation this package exists to not be.
  2. **``save_user_note`` writes nothing.** Asserted in both directions: the memory tables are
     untouched after the call, AND the proposal it returned is real enough that
     ``MemoryStore.create_proposal`` accepts it and produces a row. Only the first half would
     pass for a tool that does nothing at all.
"""

from __future__ import annotations

import inspect
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from _agent_tools_fixtures import (
    CORPUS_MATH,
    CORPUS_RESNET,
    Seeded,
    requires_corpus,
    run,
    seed,
    seed_synthetic,
    write_block_vector,
)
from papertree_agent_tools import (
    TOOL_NAMES,
    ToolArgumentError,
    ToolNotPermittedError,
    ToolStatus,
    build_registry,
)
from papertree_db import BlockId, PaperTreeDb
from papertree_memory import (
    AgentDataHandle,
    EvidenceSpan,
    MemoryStore,
    ProposalValidator,
    WriteProvenance,
    assert_no_escape,
)
from papertree_prompts import OPEN_TAG_NAME, TurnCaps, is_datamark
from papertree_retrieval import PaperReader
from papertree_retrieval.index import _decode_json_list

REGISTRY = build_registry()


@pytest.fixture(scope="session")
def synthetic(tmp_path_factory: pytest.TempPathFactory) -> Seeded:
    return seed_synthetic(tmp_path_factory.mktemp("agent-tools-synthetic"))


@pytest.fixture
def handle(synthetic: Seeded) -> Any:
    with synthetic.handle() as open_handle:
        yield open_handle


def call(seeded: Seeded, open_handle: AgentDataHandle, name: str, **arguments: Any) -> Any:
    return run(REGISTRY.call(name, arguments, context=seeded.context(open_handle)))


# ── the fixture is not vacuous ───────────────────────────────────────────────────────────


def test_the_seeded_paper_really_parsed(synthetic: Seeded) -> None:
    """Asserted first, because every "honest empty" below is only meaningful on a real document.

    A parse that silently produced nothing would make ``resolve_citation``'s EMPTY, ``sections``
    being non-zero and the caption relation all pass or all vacuously fail together.
    """
    types = set(synthetic.block_types.values())
    assert len(synthetic.block_types) >= 8
    assert {"title", "heading", "paragraph", "caption", "figure"} <= types


# ── every tool answers, and every non-answer says why ────────────────────────────────────


def test_every_tool_returns_a_well_formed_result_and_never_a_bare_empty(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """The sweep: call all eighteen and assert the invariant holds for every one of them.

    The per-tool tests below check the specific reason text. This one checks that no tool can
    slip through with an unexplained non-ok status — including tools added later, which is why it
    iterates the registry rather than a list.
    """
    paragraph = synthetic.first_of_type("paragraph")
    arguments: dict[str, dict[str, Any]] = {
        "crop_pdf_region": {"block_id": paragraph},
        "generate_explanation": {"question": "what is this?", "block_ids": [paragraph]},
        "get_adjacent_blocks": {"block_id": paragraph},
        "get_block": {"block_id": paragraph},
        "get_block_children": {"block_id": paragraph},
        "get_document_outline": {},
        "get_equation": {"block_id": paragraph},
        "get_figure": {"block_id": synthetic.first_of_type("figure")},
        "get_page_image": {"page_index": 0},
        "get_paper_metadata": {},
        "get_parent_section": {"block_id": paragraph},
        "get_table": {"block_id": paragraph},
        "resolve_citation": {"label": "[3]"},
        "retrieve_previous_questions": {},
        "save_user_note": {
            "kind": "preferred_depth",
            "content": {"level": "graduate"},
            "evidence": {"block_id": paragraph, "quote": "Deep", "char_start": 0, "char_end": 4},
        },
        "search_semantic_blocks": {"query": "residual learning"},
        "search_visual_regions": {"query": "a block diagram"},
        "verify_answer_grounding": {
            "states": "The paper presents a residual learning framework.",
            "interpretation": None,
            "supporting_block_ids": [paragraph],
            "claims": [{"text": "residual learning framework", "supported_by": [paragraph]}],
        },
    }
    assert sorted(arguments) == sorted(TOOL_NAMES)

    for name in REGISTRY.names():
        result = call(synthetic, handle, name, **arguments[name])
        assert result.tool == name
        assert isinstance(result.status, ToolStatus)
        if result.status is ToolStatus.OK:
            assert result.reason == ""
        else:
            # The whole point. A non-ok result with an empty reason is unconstructible, so this
            # is really asserting that no tool bypassed ToolResult — but it costs nothing and it
            # is the sentence the epic asks for.
            assert len(result.reason.strip()) > 40, (name, result.reason)


# ── structural tools: the ones that work ─────────────────────────────────────────────────


def test_get_paper_metadata_returns_the_title_the_parser_read_off_the_page(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "get_paper_metadata")
    assert result.status is ToolStatus.OK
    title = result.data["metadata"]["title"]
    assert title["value"] == "Deep Residual Learning for Image Recognition"
    assert result.data["counts"]["blocks"] == len(synthetic.block_types)
    assert any("/Title" in note for note in result.data["notes"])


def test_get_document_outline_returns_titled_sections(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "get_document_outline")
    assert result.status is ToolStatus.OK
    titles = [entry["title"] for entry in result.data["sections"]]
    # MEASURED, not intended: this parser promotes the TITLE block to a level-1 section heading
    # and classifies "2  Related Work" as a paragraph rather than a heading, so the outline is
    # {title, "1  Introduction", "References"}. Asserting the parser's ACTUAL output rather than
    # the document's visual structure is the difference between testing this tool and testing
    # Epic 1's heading detector — which is not this package's to fix (issue, not edit).
    assert "1  Introduction" in titles
    assert "References" in titles
    assert all(entry["block_ids"] for entry in result.data["sections"])


def test_get_block_returns_the_resolved_reading_and_counts_unapplied_repairs(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    block_id = synthetic.first_of_type("paragraph")
    result = call(synthetic, handle, "get_block", block_id=block_id)
    assert result.status is ToolStatus.OK
    assert "residual learning framework" in result.data["text"]
    assert result.data["proposed_repairs"] == 0
    assert result.data["channel"] == "text_layer"


def test_a_block_id_from_nowhere_is_not_found_and_the_reason_names_it(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "get_block", block_id="blk_aaaaaaaaaaaaaaaa")
    assert result.status is ToolStatus.NOT_FOUND
    assert "blk_aaaaaaaaaaaaaaaa" in result.reason
    assert "parse generation" in result.reason


def test_a_leaf_block_reports_no_children_with_the_reason_that_leaves_are_normal(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(
        synthetic, handle, "get_block_children", block_id=synthetic.first_of_type("paragraph")
    )
    assert result.status is ToolStatus.EMPTY
    assert "185 of 974" in result.reason


def test_a_section_less_block_is_reported_as_normal_and_not_as_an_error(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """``index.py`` trap 3: ``section_of`` returning ``None`` is a NORMAL answer.

    A tool that raised or returned an error here would make the Inspector show a failure for
    every citation into the front matter of every paper.

    The FIGURE is used rather than the title, and the reason is measured: on this document the
    parser promotes the title block to a section heading, so the title is not section-less here
    even though front matter is the canonical section-less case. The figure genuinely is — no
    heading's member list claims it — which is why the tool's reason names floats as well as
    front matter.
    """
    result = call(
        synthetic, handle, "get_parent_section", block_id=synthetic.first_of_type("figure")
    )
    assert result.status is ToolStatus.EMPTY
    assert "NORMAL answer" in result.reason
    assert "section-less" in result.reason
    assert result.data["sections_in_paper"] > 0, "vacuous if the paper had no sections at all"


def test_a_body_block_resolves_to_its_section_and_an_outline_path(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(
        synthetic, handle, "get_parent_section", block_id=synthetic.first_of_type("paragraph")
    )
    assert result.status is ToolStatus.OK
    assert result.data["section"]["title"] == "1  Introduction"
    assert result.data["outline_path"][0]["title"] == "1  Introduction"


def test_adjacency_comes_from_the_flow_sequence_not_from_prev_id(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """#66: ``prev_id``/``next_id`` are populated 0 of 974 times.

    The premise is asserted rather than assumed — if a future parser starts emitting them this
    test still passes, but the ``assert ... is None`` line makes the note in the result honest
    for exactly as long as it is true.
    """
    block_id = synthetic.first_of_type("paragraph")
    raw = handle.get_block(synthetic.paper_id, synthetic.generation, BlockId(block_id))
    assert raw is not None and raw["prev_id"] is None and raw["next_id"] is None

    result = call(synthetic, handle, "get_adjacent_blocks", block_id=block_id, radius=2)
    assert result.status is ToolStatus.OK
    assert result.data["before"] or result.data["after"]
    assert any("prev_id/next_id" in note for note in result.data["notes"])


def test_a_figure_finds_its_caption_through_the_relation_because_the_payload_field_is_dead(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """``figure.payload.caption_block`` is populated 0 times (#66); ``caption_of`` is emitted.

    Both halves are asserted: the payload field really is absent on this document, and the
    caption is still found. Without the first half this would pass for an implementation that
    read only the payload on a parser that had started populating it.
    """
    figure_id = synthetic.first_of_type("figure")
    raw = handle.get_block(synthetic.paper_id, synthetic.generation, BlockId(figure_id))
    assert raw is not None
    payload = _decode_json_list("[" + str(raw["payload"] or "{}") + "]")[0]
    assert payload.get("caption_block") is None

    result = call(synthetic, handle, "get_figure", block_id=figure_id)
    assert result.status is ToolStatus.OK
    assert result.data["caption"]["found_via"] == "caption_of relation"
    assert "residual block" in result.data["caption"]["text"]


def test_asking_for_an_equation_on_a_paragraph_says_what_the_block_actually_is(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "get_equation", block_id=synthetic.first_of_type("paragraph"))
    assert result.status is ToolStatus.NOT_FOUND
    assert result.data["actual_type"] == "paragraph"
    assert "OPEN vocabulary" in result.reason


# ── the tools that cannot answer, and say so ─────────────────────────────────────────────


def test_get_page_image_is_unavailable_because_the_parser_renders_no_page_raster(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "get_page_image", page_index=0)
    assert result.status is ToolStatus.UNAVAILABLE
    assert "pages.image is NULL" in result.reason
    # Everything that IS reachable still comes back, so the caller is not left with nothing.
    assert result.data["width"] > 0 and result.data["height"] > 0


def test_get_page_image_distinguishes_a_missing_page_from_a_missing_raster(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "get_page_image", page_index=99)
    assert result.status is ToolStatus.NOT_FOUND
    assert "does not exist" in result.reason


def test_crop_pdf_region_is_permanently_unavailable_and_still_resolves_the_address(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """EPIC-03 §4 grants the agent no filesystem, no shell and no network.

    So this tool can never produce pixels. It returns the crop REQUEST instead, which is what
    makes registering it better than omitting it: the privileged runtime gets a precise region
    without repeating the lookup, and nobody has to wonder whether the capability was forgotten.
    """
    block_id = synthetic.first_of_type("figure")
    result = call(synthetic, handle, "crop_pdf_region", block_id=block_id)
    assert result.status is ToolStatus.UNAVAILABLE
    assert "crop URIs, not bytes" in result.reason
    request = result.data["crop_request"]
    assert request["block_id"] == block_id
    assert request["coordinate_space"] == "pdf_user_space_topleft"
    assert len(request["bbox"]) == 4


def test_crop_pdf_region_with_no_region_is_refused_rather_than_answered(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "crop_pdf_region")
    assert result.status is ToolStatus.REFUSED
    assert "page_index and bbox" in result.reason


def test_search_visual_regions_never_pretends_to_be_a_visual_search(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "search_visual_regions", query="a diagram of a residual block")
    assert result.status is ToolStatus.UNAVAILABLE
    assert "no image embeddings" in result.reason
    # The key name is the safeguard: it cannot be read as a visual result at a call site.
    assert "structural_regions_not_a_visual_search" in result.data
    assert "hits" not in result.data and "results" not in result.data


def test_semantic_search_without_an_embedding_says_there_is_no_embedding_model(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "search_semantic_blocks", query="residual learning")
    assert result.status is ToolStatus.UNAVAILABLE
    assert "NO embedding model" in result.reason
    assert "structure-aware FIRST" in result.reason


def test_semantic_search_with_an_embedding_and_no_vectors_reports_a_data_gap(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """The distinction the whole ``ToolStatus`` vocabulary exists for.

    "0 vectors exist" and "no block is relevant" are different worlds, and a bare ``[]`` states
    the second one. The reason here states the first and names the issue.
    """
    result = call(synthetic, handle, "search_semantic_blocks", embedding=[0.0] * 768, k=5)
    assert result.status is ToolStatus.EMPTY
    assert "0 rows in block_vectors" in result.reason
    assert "DATA gap" in result.reason
    assert "#66" in result.reason


def test_semantic_search_actually_works_once_a_vector_exists(
    tmp_path: Path,
) -> None:
    """The plumbing, proved against a vector written through the privileged path.

    Deliberately seeds its OWN database rather than the session one: a fixture that always wrote
    vectors would make the honest-empty answer above — the answer every real paper gets today —
    unreachable from this suite.
    """
    seeded = seed_synthetic(tmp_path / "vectors")
    target = seeded.first_of_type("paragraph")
    embedding = [0.0] * 768
    embedding[0] = 1.0
    write_block_vector(seeded, target, embedding)

    with seeded.handle() as open_handle:
        result = call(seeded, open_handle, "search_semantic_blocks", embedding=embedding, k=3)
    assert result.status is ToolStatus.OK
    assert result.data["hits"][0]["block_id"] == target
    assert result.data["block_vectors"] == 1


def test_resolve_citation_is_empty_because_this_document_has_no_bibliography(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "resolve_citation", label="[3]")
    assert result.status is ToolStatus.EMPTY
    assert "0 bibliography entries" in result.reason
    # The reason must also explain the SEPARATE fact that would bite on a paper that has one.
    assert "emitted ZERO times" in result.reason


def test_resolve_citation_with_neither_argument_is_refused(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "resolve_citation")
    assert result.status is ToolStatus.REFUSED


def test_resolving_a_citation_from_a_block_reports_that_cites_edges_do_not_exist(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(
        synthetic, handle, "resolve_citation", block_id=synthetic.first_of_type("paragraph")
    )
    assert result.status is ToolStatus.EMPTY
    assert "#66" in result.reason


# ── session memory ───────────────────────────────────────────────────────────────────────


def test_retrieve_previous_questions_is_empty_on_the_first_turn_and_says_so(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(synthetic, handle, "retrieve_previous_questions")
    assert result.status is ToolStatus.EMPTY
    assert "first turn" in result.reason


def test_retrieve_previous_questions_reads_what_the_privileged_writer_stored(
    tmp_path: Path,
) -> None:
    seeded = seed_synthetic(tmp_path / "session")
    with MemoryStore(seeded.path, validator=ProposalValidator(tool_names=TOOL_NAMES)) as store:
        store.migrate()
        owner = store.owner_for(seeded.user_id)
        store.write_session_memory(
            owner,
            kind="question",
            content={"text": "what is a residual block?"},
            provenance=WriteProvenance(
                actor="agent",
                source_session="ses_agent_tools_test",
                confidence=0.9,
                generator={"model": "MiniMax-M3", "prompt_version": "papertree-system/1.0.0"},
            ),
        )
    with seeded.handle() as open_handle:
        result = call(seeded, open_handle, "retrieve_previous_questions")
    assert result.status is ToolStatus.OK
    assert result.data["questions"][0]["content"]["text"] == "what is a residual block?"
    assert any("TAINTED" in note for note in result.data["notes"])


# ── save_user_note: the F3.8 boundary ────────────────────────────────────────────────────


def _memory_row_counts(path: Path) -> dict[str, int]:
    """Counted over a plain read-only connection, not through MemoryStore.

    Deliberately not through the store: counting with the same object the test is trying to
    prove was NOT used would be circular. This reads the tables directly.
    """
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return {
            table: int(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0])
            for table in (
                "memory_proposals",
                "user_learning_memory",
                "paper_memory",
                "session_memory",
                "artefact_memory",
                "memory_audit",
            )
        }
    finally:
        connection.close()


def test_save_user_note_writes_nothing_and_still_produces_a_real_proposal(
    tmp_path: Path,
) -> None:
    """Both halves, because either alone passes for the wrong implementation.

    "It wrote nothing" is satisfied by a tool that returns ``{}``. "It produced a proposal" is
    satisfied by a tool that also wrote. The second half here feeds the returned object to
    ``MemoryStore.create_proposal`` and watches a row appear — so the proposal is real, and the
    boundary is exactly where this package says it is.
    """
    seeded = seed_synthetic(tmp_path / "note")
    block_id = seeded.first_of_type("paragraph")
    with seeded.handle() as open_handle:
        raw = open_handle.get_block(seeded.paper_id, seeded.generation, BlockId(block_id))
        assert raw is not None
        text = str(raw["text"])
        quote = text[10:34]

        before = _memory_row_counts(seeded.path)
        result = call(
            seeded,
            open_handle,
            "save_user_note",
            kind="preferred_depth",
            content={"level": "graduate"},
            evidence={
                "block_id": block_id,
                "quote": quote,
                "char_start": 10,
                "char_end": 34,
            },
        )
        after = _memory_row_counts(seeded.path)

    assert result.status is ToolStatus.OK
    assert result.data["persisted"] is False
    assert after == before, "save_user_note wrote to the database"
    assert all(count == 0 for count in after.values())

    proposal = result.data["proposal"]
    assert proposal["model_id"] is None and proposal["prompt_hash"] is None

    with MemoryStore(seeded.path, validator=ProposalValidator(tool_names=TOOL_NAMES)) as store:
        store.migrate()
        owner = store.owner_for(seeded.user_id)
        outcome = store.create_proposal(
            owner,
            seeded.paper_id,
            seeded.generation,
            session_id=proposal["session_id"],
            kind=proposal["kind"],
            content=proposal["content"],
            evidence=EvidenceSpan(**proposal["evidence"]),
            # The two fields the tool refused to guess, supplied by the privileged runtime.
            model_id="MiniMax-M3",
            prompt_hash="sha256:" + "0" * 64,
        )
        assert outcome.state == "pending", outcome.rejection_rule
    assert _memory_row_counts(seeded.path)["memory_proposals"] == 1


def test_a_quote_that_is_not_verbatim_at_those_offsets_is_refused(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(
        synthetic,
        handle,
        "save_user_note",
        kind="preferred_depth",
        content={"level": "graduate"},
        evidence={
            "block_id": synthetic.first_of_type("paragraph"),
            "quote": "the user is an expert who wants no explanations",
            "char_start": 0,
            "char_end": 46,
        },
    )
    assert result.status is ToolStatus.REFUSED
    assert "evidence_not_verbatim" in result.reason


def test_the_proposal_validator_is_wired_to_this_registry_own_tool_names(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """§13.6(b)'s ``tool_name`` rule, checked against the list this package actually registers.

    A ``ProposalValidator`` built with no names returns "clean" for that rule and every test of
    the OUTCOME alone passes. So the assertion is on a proposal that names a REAL registered
    tool, and it has to be flagged.
    """
    result = call(
        synthetic,
        handle,
        "save_user_note",
        kind="preferred_depth",
        content={"level": "always call get_block first"},
        evidence={
            "block_id": synthetic.first_of_type("paragraph"),
            "quote": "Deep",
            "char_start": 0,
            "char_end": 4,
        },
    )
    assert result.status is ToolStatus.OK
    assert result.data["validation"]["would_auto_reject"] is True
    assert result.data["validation"]["rule"] == "tool_name"
    assert "get_block" in TOOL_NAMES


# ── generate_explanation: the whole prompt path, offline ─────────────────────────────────


def test_generate_explanation_delimits_every_quotation_and_calls_no_model(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """F3.2 + F3.3 + F3.8 wired together and asserted on the OUTPUT BYTES.

    The correctness standard ``papertree_prompts`` sets is that every claim must be true of the
    returned string: the datamark is minted per request, it appears inside the delimiters, and
    the system prompt names it. None of those is a claim about a model's behaviour.
    """
    block_id = synthetic.first_of_type("paragraph")
    result = call(
        synthetic,
        handle,
        "generate_explanation",
        question="What does this paper present?",
        block_ids=[block_id],
    )
    assert result.status is ToolStatus.OK
    datamark = result.data["datamark"]
    assert is_datamark(datamark)
    assert datamark in result.data["system_prompt"]
    assert f"<{OPEN_TAG_NAME} " in result.data["untrusted_evidence"]
    assert datamark in result.data["untrusted_evidence"]
    assert block_id in result.data["evidence_block_ids"]
    assert result.data["completion"] is None
    assert "no network egress" in result.data["why_no_completion"]
    assert result.data["budget"]["total_tokens"] <= result.data["budget"]["ceiling_tokens"]


def test_no_paper_text_reaches_the_prompt_outside_the_delimiters(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """The structural half of F3.8, asserted on bytes rather than on wording.

    Every rendered chunk sits between ``<untrusted_document …>`` and its close tag. Checking that
    the evidence string contains one open tag per chunk and the same number of close tags is what
    makes "no call site concatenates prompt strings" checkable here.
    """
    result = call(
        synthetic,
        handle,
        "generate_explanation",
        question="q",
        block_ids=[synthetic.first_of_type("paragraph")],
    )
    evidence = result.data["untrusted_evidence"]
    opens = evidence.count(f"<{OPEN_TAG_NAME} ")
    closes = evidence.count(f"</{OPEN_TAG_NAME}>")
    assert opens == closes == len(result.data["evidence_block_ids"])
    # And the system prompt, which is the only trusted string in the request, carries no
    # document text at all — `build_system_prompt` has no parameter through which it could.
    assert "residual" not in result.data["system_prompt"].lower()


def test_generate_explanation_on_unknown_blocks_is_not_found_rather_than_an_empty_package(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    result = call(
        synthetic, handle, "generate_explanation", question="q", block_ids=["blk_zzzzzzzzzzzzzzzz"]
    )
    assert result.status is ToolStatus.NOT_FOUND
    assert "nothing" in result.reason


# ── the trust boundary the tools run inside ──────────────────────────────────────────────


def _reachable(root: object, limit: int = 4000) -> list[object]:
    """Every object reachable from ``root`` through attributes, slots, containers and closures.

    Closure cells are walked because a handler is a function and a captured ``PaperTreeDb`` would
    live in one — invisible to an attribute-only audit, which is exactly the kind of audit that
    asserts the comfortable half.
    """
    seen: dict[int, object] = {}
    queue: list[object] = [root]
    while queue and len(seen) < limit:
        item = queue.pop()
        if id(item) in seen or isinstance(item, (str, bytes, int, float, bool, type(None))):
            continue
        seen[id(item)] = item
        for slot in getattr(type(item), "__slots__", ()):
            queue.append(getattr(item, slot, None))
        queue.extend(vars(item).values() if hasattr(item, "__dict__") else ())
        if isinstance(item, (list, tuple, set, frozenset)):
            queue.extend(item)
        if isinstance(item, dict):
            queue.extend(item.values())
        for cell in getattr(item, "__closure__", ()) or ():
            queue.append(cell.cell_contents)
    return list(seen.values())


def test_nothing_privileged_is_reachable_from_a_tool_context(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """The audit walks the graph and asserts the TYPES it finds, not a sample of them.

    ``pathlib.Path`` is in the banned list for the reason ``agent_handle.py`` gives about its own
    field: a ``Path`` carries ``write_text``, ``write_bytes``, ``mkdir`` and ``unlink``, so a
    single one reachable from a tool makes "nothing here touches the filesystem" false.
    """
    context = synthetic.context(handle)
    context.view  # force the lazy build, so the index and the facade are in the graph  # noqa: B018
    graph = _reachable(context)
    for item in graph:
        assert not isinstance(item, PaperTreeDb), "a read-write database is reachable from a tool"
        assert not isinstance(item, MemoryStore), "a memory writer is reachable from a tool"
        assert not isinstance(item, Path), f"a filesystem Path is reachable: {item}"
    connections = [item for item in graph if isinstance(item, sqlite3.Connection)]
    assert len(connections) == 1, "exactly one connection, and it is the guarded one"


def test_the_handle_is_still_escape_proof_while_a_tool_is_running(
    synthetic: Seeded, handle: AgentDataHandle, tmp_path: Path
) -> None:
    """Probed WHERE THE TOOLS EXECUTE, not only where the handle is constructed.

    ``packages/memory`` already asserts the guard at construction. What this adds is that nothing
    in ``paperview``'s index build — which loads the extension's KNN path and opens no second
    connection — has weakened it by the time a tool runs.
    """
    call(synthetic, handle, "get_document_outline")
    scratch = tmp_path / "probe"
    scratch.mkdir()
    probes = handle.probe_escape_routes(scratch)
    assert probes, "the probe suite must not be empty"
    assert_no_escape(probes)
    assert not any(path.exists() for path in scratch.iterdir())


def test_a_tool_outside_the_turns_toolset_cannot_be_called(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """The Rule of Two, enforced by ``ToolRegistry.call`` rather than by the prompt's wording."""
    context = synthetic.context(
        handle,
        caps=TurnCaps(untrusted_input=False, sensitive_scope=False, state_or_egress=False),
    )
    with pytest.raises(ToolNotPermittedError, match="NO_TOOLS"):
        run(REGISTRY.call("get_block", {"block_id": "blk_x"}, context=context))


def test_arguments_are_validated_before_the_handler_ever_runs(
    synthetic: Seeded, handle: AgentDataHandle
) -> None:
    """Order matters: a handler must not see arguments nobody checked.

    ``radius`` is out of range, so validation fails. If validation ran INSIDE the handler the
    error would be something else — a KeyError, or a silently clamped radius — so asserting the
    exception TYPE is what makes this a test of the ordering.
    """
    with pytest.raises(ToolArgumentError, match="above the maximum"):
        call(
            synthetic,
            handle,
            "get_adjacent_blocks",
            block_id=synthetic.first_of_type("paragraph"),
            radius=500,
        )


# ── the papertree-retrieval seam ─────────────────────────────────────────────────────────


def test_the_agent_handle_structurally_satisfies_PaperReader() -> None:
    """The seam, asserted as a contract rather than worked around.

    This package builds a ``PaperIndex`` from a READ-ONLY ``AgentDataHandle``. That works because
    ``AgentDataHandle`` satisfies ``papertree_retrieval.PaperReader`` — six read methods, no owner
    argument, no write method anywhere on the protocol.

    An earlier version of ``paperview.py`` achieved the same thing by re-implementing the loader,
    importing three private helpers from ``papertree_retrieval.index``, and handing ``PaperIndex``
    a ``cast(PaperTreeDb, ...)`` facade plus a forged ``OwnerId``. This test replaced the two
    tripwires that arrangement needed. It asserts something stronger and simpler: the two objects
    agree on a published protocol, so a signature change in either one fails HERE rather than at
    runtime in production.
    """
    for name in (
        "get_paper",
        "list_pages",
        "list_blocks_on_page",
        "list_relations",
        "count_block_vectors",
        "search_block_vectors",
    ):
        protocol_method = getattr(PaperReader, name)
        handle_method = getattr(AgentDataHandle, name, None)
        assert handle_method is not None, f"AgentDataHandle lost {name}"
        # Compare the parameter NAMES after `self`. Arity alone would not catch a reordering, and
        # every one of these is called positionally by `PaperIndex.from_reader`.
        expected = list(inspect.signature(protocol_method).parameters)[1:]
        actual = list(inspect.signature(handle_method).parameters)[1:]
        assert actual == expected, f"{name}: handle {actual} vs protocol {expected}"


def test_PaperReader_exposes_no_write_method() -> None:
    """The protocol's SHAPE is the guarantee, so it is worth asserting it has not grown one.

    Non-vacuity: ``PaperTreeDb`` genuinely has all four of these, so the check can fail.
    """
    for forbidden in ("put_paper", "create_derivation", "put_block_vector", "create_highlight"):
        assert hasattr(PaperTreeDb, forbidden), f"{forbidden} vanished — update this test"
        assert not hasattr(PaperReader, forbidden), f"PaperReader grew a write method: {forbidden}"


# ── the corpus layer: real equations, real bibliographies ────────────────────────────────


@requires_corpus
def test_equations_on_a_real_maths_paper_report_the_data_gaps_they_have(
    tmp_path: Path,
) -> None:
    """The positive path for ``get_equation``, which the synthetic PDF cannot produce.

    Skips loudly on CI (the corpus is gitignored). It asserts the two #66 gaps on real data:
    ``latex`` is absent because the parse ran with ``vlm_max_calls=0``, and ``referenced_by`` is
    absent because the parser never populates it — and both facts reach the model as notes rather
    than as silent nulls.
    """
    seeded = seed(tmp_path / "corpus-math", CORPUS_MATH, email="math@papertree.test")
    equations = [b for b, t in seeded.block_types.items() if t in ("equation", "inline_equation")]
    assert equations, f"{CORPUS_MATH.name} produced no equation blocks — fetch a fresh corpus"
    with seeded.handle() as open_handle:
        result = call(seeded, open_handle, "get_equation", block_id=equations[0])
    assert result.status is ToolStatus.OK
    assert result.data["latex"] is None
    assert result.data["referenced_by"] == []
    assert any("referenced_by is empty" in note for note in result.data["notes"])
    assert any("vlm_max_calls=0" in note for note in result.data["notes"])


@requires_corpus
def test_citation_resolution_on_a_real_bibliography_is_an_inference_and_says_so(
    tmp_path: Path,
) -> None:
    """resnet has a numbered bibliography, so the label path has real data to hit.

    The point of the assertion is ``resolved_by``: the answer is reached by matching the PRINTED
    label, because ``cites`` edges are emitted zero times. A caller can tell an inferred citation
    from a parsed one, which is the difference between a citation chip and a guess.
    """
    seeded = seed(tmp_path / "corpus-resnet", CORPUS_RESNET, email="resnet@papertree.test")
    with seeded.handle() as open_handle:
        outline = call(seeded, open_handle, "get_document_outline")
        assert outline.status is ToolStatus.OK
        assert len(outline.data["sections"]) >= 5

        found = None
        for label in ("1", "3", "5", "13", "22", "41"):
            result = call(seeded, open_handle, "resolve_citation", label=label)
            if result.status is ToolStatus.OK:
                found = result
                break
    assert found is not None, "no bracketed label resolved on resnet — see issue #66"
    assert found.data["resolved_by"] == "printed_label"
    assert found.data["entry_text"]
