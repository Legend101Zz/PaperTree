"""contracts.md §3.4: ``[bN]`` markers in ``final_text`` become citations (handle -> block, page,
whole-block Anchor), and a summary's bullets are split. No verdict is computed or stored on a
citation (v0.3, #351): the mapping is all the web's source line needs.

Pinned on a real parse (the committed ``resnet-cvpr-2col`` fixture, the document a stored
generation holds).
"""

from __future__ import annotations

from collections.abc import Mapping

import pytest
from api_support import load_fixture
from papertree_anchoring import IndexedDocument, api_text_stream_id, index_document
from papertree_api.evidence import CitationMinter, cite_answer, cite_summary, split_bullets
from papertree_db import new_id
from papertree_document_ir import Paper


@pytest.fixture(scope="module")
def resnet() -> IndexedDocument:
    paper = Paper.model_validate(load_fixture("resnet-cvpr-2col"))
    return index_document(
        paper, api_text_stream_id(paper.paper_id, paper.generation, paper.parser.version)
    )


def _minter(document: IndexedDocument, handles: Mapping[str, str]) -> CitationMinter:
    return CitationMinter(run_id="run_claims", handles=handles, document=document, new_id=new_id)


def _handles(document: IndexedDocument) -> dict[str, str]:
    paragraphs = [b for b in document.blocks if b.block.type == "paragraph" and len(b.text) > 200]
    return {"b1": paragraphs[3].block.block_id, "b2": paragraphs[8].block.block_id}


def test_one_citation_per_distinct_known_marker_in_order_of_first_appearance(
    resnet: IndexedDocument,
) -> None:
    handles = _handles(resnet)
    minter = _minter(resnet, handles)
    citations = cite_answer("Claim [b2]. More [b1, b2]. Unknown [b999].", minter)
    assert [(c.marker, c.ordinal, c.block_id) for c in citations] == [
        ("b2", 0, handles["b2"]),
        ("b1", 1, handles["b1"]),
    ]
    assert minter.dropped == ["b999"]
    for citation in citations:
        assert citation.anchor["id"] == citation.citation_id
        assert citation.page_index == resnet.by_id[citation.block_id].block.page_index
        assert set(citation.wire()) == {"citation_id", "ordinal", "marker", "page_index", "anchor"}


def test_a_marker_after_the_full_stop_still_maps_to_its_handle(resnet: IndexedDocument) -> None:
    minter = _minter(resnet, _handles(resnet))
    assert [c.marker for c in cite_answer("Claim one. [b1] Claim two. [b2]", minter)] == [
        "b1",
        "b2",
    ]


def test_a_summary_bullet_without_a_valid_marker_has_no_citation(resnet: IndexedDocument) -> None:
    minter = _minter(resnet, _handles(resnet))
    bullets = cite_summary("- With one [b1].\n- Without any.\n- Unknown [b9].", minter)
    assert [(b.text, [c.marker for c in b.citations]) for b in bullets] == [
        ("With one [b1].", ["b1"]),
        ("Without any.", []),
        ("Unknown [b9].", []),
    ]


def test_bullets_split_per_dash_and_a_marker_only_line_belongs_to_the_bullet_before() -> None:
    assert split_bullets("- Bullet one.\n[b1]\n- Bullet two [b2].") == [
        "Bullet one. [b1]",
        "Bullet two [b2].",
    ]
    assert split_bullets("Plain line one.\nPlain line two.") == [
        "Plain line one.",
        "Plain line two.",
    ]
