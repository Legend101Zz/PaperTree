"""`references.py` — the bibliography, and the two years that must not be believed."""

from __future__ import annotations

from typing import Any

import pytest
from papertree_document_worker.references import (
    classify_reference_entries,
    extract_references,
)


def _assembled(kind: str, text: str, y0: float, page: int = 0) -> Any:
    from papertree_document_worker.assemble import AssembledBlock

    return AssembledBlock(
        type=kind,
        page_index=page,
        flow="body",
        line_bands=[[100.0, y0, 500.0, y0 + 10.0]],
        text=text,
    )


ENTRY = "Kaiming He, Xiangyu Zhang. Deep residual learning. In CVPR, pages 770-778, 2016."


class TestClassify:
    def test_prose_after_the_references_heading_becomes_an_entry(self) -> None:
        blocks = [_assembled("heading", "References", 100), _assembled("paragraph", ENTRY, 120)]
        assert [r.block.text for r in classify_reference_entries(blocks)] == [ENTRY]

    @pytest.mark.parametrize(
        "heading", ["References", "Bibliography", "7 References", "references"]
    )
    def test_the_heading_is_recognised_in_its_usual_forms(self, heading: str) -> None:
        blocks = [_assembled("heading", heading, 100), _assembled("paragraph", ENTRY, 120)]
        assert len(classify_reference_entries(blocks)) == 1

    def test_prose_before_the_heading_is_untouched(self) -> None:
        blocks = [_assembled("paragraph", ENTRY, 80), _assembled("heading", "References", 100)]
        assert classify_reference_entries(blocks) == []

    def test_an_appendix_closes_the_sweep(self) -> None:
        blocks = [
            _assembled("heading", "References", 100),
            _assembled("paragraph", ENTRY, 120),
            _assembled("heading", "A Appendix", 140),
            _assembled("paragraph", "Appendix prose that is quite long indeed.", 160),
        ]
        assert [r.block.text for r in classify_reference_entries(blocks)] == [ENTRY]

    def test_a_stray_fragment_is_not_an_entry(self) -> None:
        blocks = [_assembled("heading", "References", 100), _assembled("paragraph", "12", 120)]
        assert classify_reference_entries(blocks) == []

    def test_a_stronger_detector_is_not_overruled(self) -> None:
        blocks = [
            _assembled("heading", "References", 100),
            _assembled("caption", "Figure 9: a figure in the appendix", 120),
        ]
        assert classify_reference_entries(blocks) == []


def _serialised(text: str, block_id: str = "blk_aaaaaaaaaaaaaaaa") -> dict[str, Any]:
    return {
        "type": "reference_entry",
        "block_id": block_id,
        "text": text,
        "page_index": 0,
        "bbox": [100.0, 100.0, 500.0, 110.0],
    }


class TestExtract:
    def test_every_record_cites_its_block(self) -> None:
        records = extract_references([_serialised(ENTRY)])
        assert records[0]["reference_entry_block_id"] == "blk_aaaaaaaaaaaaaaaa"

    def test_the_year_is_read(self) -> None:
        assert extract_references([_serialised(ENTRY)])[0]["year"] == 2016

    def test_the_arxiv_id_is_read(self) -> None:
        text = "Ashish Vaswani. Attention is all you need. arXiv preprint arXiv:1706.03762, 2017."
        assert extract_references([_serialised(text)])[0]["arxiv_id"] == "1706.03762"

    def test_an_arxiv_identifier_is_not_read_as_a_year(self) -> None:
        """`arXiv:2005.14165` yields a verbatim, correctly-placed, simply wrong `2005`.

        `metadata.py` carries the same trap and the same guard; nothing in the schema catches it
        and nothing downstream would question the value.
        """
        text = "Tom Brown. Language models are few-shot learners. arXiv:2005.14165, 2020."
        record = extract_references([_serialised(text)])[0]
        assert record["year"] == 2020

    def test_the_last_year_wins_over_a_volume_number(self) -> None:
        text = "P. Marcus. Building a large corpus. Computational linguistics, 19(2):313-330, 1993."
        assert extract_references([_serialised(text)])[0]["year"] == 1993

    def test_no_year_is_null_rather_than_guessed(self) -> None:
        assert "year" not in extract_references([_serialised("A. Author. A title. A venue.")])[0]

    def test_title_and_authors_are_left_null_on_purpose(self) -> None:
        """A plausible author list is worse than none - it looks populated and nothing flags it."""
        record = extract_references([_serialised(ENTRY)])[0]
        assert "title" not in record
        assert "authors" not in record

    def test_non_reference_blocks_are_ignored(self) -> None:
        assert extract_references([{**_serialised(ENTRY), "type": "paragraph"}]) == []
