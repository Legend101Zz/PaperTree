"""``capture_citation`` (contracts.md §3.4, §6): the whole-block Anchor every AI citation is.

On the three committed fixture parses (real parser output, 199 hand-checked blocks, the same set
the TypeScript resolver's conformance vectors use), EVERY text-bearing block is cited once and the
record is checked field by field against what §6 says a citation carries. The JSON Schema and the
API's pydantic ``AnchorV1`` hold the same records in ``services/api``'s ``test_citations.py``.
"""

from __future__ import annotations

from typing import Any

import pytest
from _fixtures import FIXTURE_SLUGS, load_paper
from papertree_anchoring import (
    CITATION_CLIENT,
    api_text_stream_id,
    capture_citation,
    index_document,
)


def test_the_api_text_stream_id_is_the_contract_form() -> None:
    assert api_text_stream_id("ppr_X", 2, "1.0.0") == "api/ppr_X/g2/1.0.0"


@pytest.mark.parametrize("slug", FIXTURE_SLUGS)
def test_every_text_block_cites_as_a_whole_block_source_anchor(slug: str) -> None:
    paper = load_paper(slug)
    stream_id = api_text_stream_id(paper.paper_id, paper.generation, paper.parser.version)
    doc = index_document(paper, stream_id)
    cited = 0
    for indexed in doc.blocks:
        if not indexed.text.strip():
            continue
        block = indexed.block
        anchor = capture_citation(
            doc, block.block_id, citation_id=f"cit_{cited:026d}", at="2026-09-26T05:00:00.000Z"
        )
        cited += 1
        assert anchor["targetKind"] == "citation"
        assert anchor["provenanceClass"] == "source", "a citation targets the PAPER's text"
        assert anchor["doc"] == {
            "paperId": paper.paper_id,
            "pdfSha256": paper.source_hash,
            "parserVersion": paper.parser.version,
            "textStreamId": stream_id,
        }
        assert anchor["created"] == {
            "mode": "source",
            "at": "2026-09-26T05:00:00.000Z",
            "client": CITATION_CLIENT,
        }
        by_type: dict[str, Any] = {s["type"]: s for s in anchor["selectors"]}
        assert by_type["BlockSelector"]["blockId"] == block.block_id
        assert by_type["BlockSelector"]["blockTextHash"] == (block.content_hash or "")
        assert by_type["TextQuoteSelector"]["exact"] == indexed.text, "the WHOLE block"
        assert by_type["PageSelector"]["index"] == block.page_index
        if "ShapeSelector" in by_type:
            assert by_type["ShapeSelector"]["quads"], "a painted citation has at least one quad"
            assert by_type["ShapeSelector"]["pageIndex"] == block.page_index
        if doc.section_containing(block.block_id) is not None:
            assert by_type["SectionPathSelector"]["path"], "a sectioned block carries its path"
    print(f"\n[citations] {slug}: {cited} text blocks cited")
    assert cited > 20
