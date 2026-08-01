"""The agent handle READS correctly — the half a security suite alone never checks.

``AgentDataHandle`` duplicates about eighty lines of SELECT rather than wrapping a
``PaperTreeDb``, because wrapping one would mean the agent's object graph contains a writable
connection and the boundary would be made of method visibility. ``agent_handle.py`` says so at
length. The cost of that decision is DRIFT: two spellings of the same query against the same
STRICT schema, one used by the API and one used by the agent, which can diverge silently and
hand the agent different data than the rest of the system sees.

This file is the mitigation, and it is the reason ``agent_handle.py`` can point at a test
instead of at a promise. Every read on the handle is asserted to agree ROW FOR ROW with its
``PaperTreeDb`` counterpart on a genuinely parsed document.

IT IS ALSO WHAT KEEPS `security/injection.spec` FROM BEING VACUOUS. A guard that broke reading
as well as writing would pass every "the attack wrote nothing" assertion in this package —
"nothing happened" is what both a working boundary and a broken handle look like. The claim
being defended is *"the guard costs no functionality"*, and it is asserted here rather than
asserted in a docstring.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from _memory_fixtures import SeededDatabase, SeededPaper, seed_benign_database
from papertree_db import BlockId, PaperTreeDb
from papertree_memory import AgentDataHandle


@pytest.fixture(scope="module")
def benign(tmp_path_factory: pytest.TempPathFactory) -> SeededDatabase:
    return seed_benign_database(tmp_path_factory.mktemp("reads"))


@pytest.fixture
def paper(benign: SeededDatabase) -> SeededPaper:
    return benign.papers["benign"]


@pytest.fixture
def handle(benign: SeededDatabase) -> Iterator[AgentDataHandle]:
    agent = AgentDataHandle(benign.path, benign.user_id)
    yield agent
    agent.close()


@pytest.fixture
def database(benign: SeededDatabase) -> Iterator[PaperTreeDb]:
    db = PaperTreeDb(benign.path)
    yield db
    db.close()


def test_every_document_read_agrees_with_papertree_db_row_for_row(
    handle: AgentDataHandle, database: PaperTreeDb, benign: SeededDatabase, paper: SeededPaper
) -> None:
    """The drift check. Both sides run on the same file at the same instant."""
    owner = database.owner_for(benign.user_id)
    paper_id, gen = paper.paper_id, paper.generation

    assert handle.get_paper(paper_id, gen) == database.get_paper(owner, paper_id, gen)
    assert handle.list_pages(paper_id, gen) == database.list_pages(owner, paper_id, gen)
    assert handle.list_blocks_in_doc_order(paper_id, gen) == database.list_blocks_in_doc_order(
        owner, paper_id, gen
    )
    assert handle.list_relations(paper_id, gen) == database.list_relations(owner, paper_id, gen)
    assert handle.count_blocks(paper_id, gen) == database.count_blocks(owner, paper_id, gen)
    for page in handle.list_pages(paper_id, gen):
        index = int(page["page_index"])
        assert handle.list_blocks_on_page(paper_id, gen, index) == database.list_blocks_on_page(
            owner, paper_id, gen, index
        )

    # Non-vacuous: the parsed document is not empty, so "both returned []" is not what agreed.
    assert handle.count_blocks(paper_id, gen) > 0
    assert handle.list_pages(paper_id, gen) != []


def test_a_single_block_read_agrees_and_json_columns_arrive_as_strings(
    handle: AgentDataHandle, database: PaperTreeDb, benign: SeededDatabase, paper: SeededPaper
) -> None:
    """``polygon``/``provenance``/``spans`` are TEXT columns and both sides must say so.

    A handle that helpfully parsed them would look identical in a smoke test and hand the
    prompt builder a dict where the rest of the system has a string — the shape mismatch would
    surface as a TypeError deep in Epic 3's prompt construction, far from here.
    """
    owner = database.owner_for(benign.user_id)
    blocks = handle.list_blocks_on_page(paper.paper_id, paper.generation, 0)
    assert blocks

    block_id = BlockId(str(blocks[0]["block_id"]))
    mine = handle.get_block(paper.paper_id, paper.generation, block_id)
    theirs = database.get_block(owner, paper.paper_id, paper.generation, block_id)
    assert mine == theirs
    assert mine is not None
    assert isinstance(mine["polygon"], str)
    assert isinstance(mine["provenance"], str)
    assert handle.get_block(paper.paper_id, paper.generation, BlockId("blk_nope")) is None


def test_doc_order_covers_only_top_level_body_blocks(
    handle: AgentDataHandle, paper: SeededPaper
) -> None:
    """AGENTS.md §4's trap, asserted on real parser output rather than taken on trust.

    ``doc_order`` is present on EXACTLY the top-level ``flow == 'body'`` blocks. The synthetic
    paper deliberately carries a caption, which has none — so ``ORDER BY doc_order ?? 0`` would
    place it at position 0, ahead of the title. This asserts the handle's doc-order list is the
    body spine and that the caption is reachable only through the per-page read.
    """
    doc_order = handle.list_blocks_in_doc_order(paper.paper_id, paper.generation)
    on_page = handle.list_blocks_on_page(paper.paper_id, paper.generation, 0)

    assert doc_order, "no body blocks at all — the trap this test is about is unreachable"
    assert all(block["doc_order"] is not None for block in doc_order)
    assert all(block["flow"] == "body" for block in doc_order)
    assert all(block["parent_id"] is None for block in doc_order)

    without = [block for block in on_page if block["doc_order"] is None]
    assert without, (
        "the parsed document has no block lacking doc_order, so this test cannot show that "
        "such blocks exist and are excluded — the fixture needs a caption or a footnote"
    )
    doc_order_ids = {block["block_id"] for block in doc_order}
    assert not doc_order_ids & {block["block_id"] for block in without}


def test_vector_search_written_through_papertree_db_is_found_through_the_handle(
    handle: AgentDataHandle, database: PaperTreeDb, benign: SeededDatabase, paper: SeededPaper
) -> None:
    """The partition-name agreement, which nothing else would catch.

    ``block_vectors`` is a vec0 table with no ``owner_id`` column: ownership is carried by the
    partition key ``owner/paper@generation``, and that string is built independently in
    ``papertree_db.database._paper_key`` and ``AgentDataHandle._paper_key``. If the two
    spellings ever diverge, KNN through the handle returns ZERO HITS — not an error — and
    retrieval silently degrades to nothing. This is the only test that can see that.

    It also confirms the measurement ``guard.py`` relies on: a sqlite-vec KNN executes normally
    with the full authorizer deny set installed.
    """
    owner = database.owner_for(benign.user_id)
    blocks = handle.list_blocks_on_page(paper.paper_id, paper.generation, 0)
    block_id = BlockId(str(blocks[0]["block_id"]))

    embedding = [0.0] * 768
    embedding[7] = 1.0
    database.put_block_vector(
        owner, paper.paper_id, paper.generation, block_id, "test-model", embedding
    )

    assert handle.count_block_vectors(paper.paper_id, paper.generation) == 1
    hits = handle.search_block_vectors(paper.paper_id, paper.generation, embedding, 5)
    assert [hit["block_id"] for hit in hits] == [block_id]
    assert hits == database.search_block_vectors(
        owner, paper.paper_id, paper.generation, embedding, 5
    )


def test_the_handle_sees_writes_committed_after_it_opened(
    handle: AgentDataHandle, database: PaperTreeDb, benign: SeededDatabase, paper: SeededPaper
) -> None:
    """WAL concurrency, asserted because the whole two-object design depends on it.

    The privileged writer and the agent's reader are two connections on one file. If the reader
    held a snapshot from the moment it opened, an agent would answer questions about a paper as
    it was when the session started — which would look like a caching bug and be a boundary
    design flaw.
    """
    owner = database.owner_for(benign.user_id)
    before = handle.count_block_vectors(paper.paper_id, paper.generation)
    blocks = handle.list_blocks_on_page(paper.paper_id, paper.generation, 0)
    later = BlockId(str(blocks[-1]["block_id"]))
    embedding = [0.0] * 768
    embedding[11] = 1.0
    database.put_block_vector(
        owner, paper.paper_id, paper.generation, later, "test-model", embedding
    )
    assert handle.count_block_vectors(paper.paper_id, paper.generation) == before + 1


def test_the_memory_reads_return_nothing_before_anything_is_written(
    handle: AgentDataHandle, paper: SeededPaper
) -> None:
    """The empty case, so that a later "the attack wrote nothing" assertion has a baseline.

    These four are the memory surface the tool registry gets. They are all owner-bound and all
    read-only; the assertion here is only that they execute and return an empty list rather
    than raising, because a guard that broke them would make every emptiness assertion in
    `security/injection.spec` unfalsifiable.
    """
    assert handle.list_paper_memory(paper.paper_id, paper.generation) == []
    assert handle.list_artefact_memory(paper.paper_id, paper.generation) == []
    assert handle.list_session_memory("ses_nothing_here") == []
    assert handle.list_user_learning_memory() == []
