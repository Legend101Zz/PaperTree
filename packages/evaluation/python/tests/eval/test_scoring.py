"""`scoring.py`, with the order trap pinned first.

`metrics.reading_order_accuracy` reads POSITIONS IN THE PREDICTED LIST, not a rank field. If
`blocks_to_regions` ever stops sorting, every reading-order number in the result document becomes
a measurement of array insertion order that still looks like a plausible score. That is the one
failure here with no visible symptom, so it gets the most tests.
"""

from __future__ import annotations

from typing import Any

from papertree_evaluation.scoring import (
    blocks_to_regions,
    render_report,
    sanity_check_overlap,
    score_paper,
)


def _block(
    block_id: str, kind: str, box: list[float], *, page: int = 0, doc_order: int | None = None
) -> dict[str, Any]:
    return {
        "block_id": block_id,
        "type": kind,
        "flow": "body",
        "bbox": box,
        "page_index": page,
        "doc_order": doc_order,
    }


def _gold(
    gold_id: str, kind: str, box: list[float], *, order: int | None = None, **over: Any
) -> dict[str, Any]:
    return {"gold_id": gold_id, "type": kind, "bbox": box, "reading_order": order, **over}


def _page(*regions: dict[str, Any], paper: str = "p", index: int = 0) -> dict[str, Any]:
    return {
        "paper_id": paper,
        "page": index,
        "page_size": {"width": 612, "height": 792},
        "regions": list(regions),
    }


class TestBlocksToRegions:
    def test_sorted_by_doc_order_not_storage_order(self) -> None:
        document = {
            "blocks": [
                _block("c", "paragraph", [0, 200, 100, 220], doc_order=2),
                _block("a", "paragraph", [0, 0, 100, 20], doc_order=0),
                _block("b", "paragraph", [0, 100, 100, 120], doc_order=1),
            ]
        }
        assert [r["block_id"] for r in blocks_to_regions(document, 0)] == ["a", "b", "c"]

    def test_blocks_without_doc_order_sort_last_by_geometry(self) -> None:
        document = {
            "blocks": [
                _block("furniture", "page_number", [0, 700, 20, 710]),
                _block("body", "paragraph", [0, 100, 100, 120], doc_order=5),
            ]
        }
        assert [r["block_id"] for r in blocks_to_regions(document, 0)] == ["body", "furniture"]

    def test_other_pages_are_excluded(self) -> None:
        document = {
            "blocks": [
                _block("p0", "paragraph", [0, 0, 10, 10], page=0, doc_order=0),
                _block("p1", "paragraph", [0, 0, 10, 10], page=1, doc_order=1),
            ]
        }
        assert [r["block_id"] for r in blocks_to_regions(document, 1)] == ["p1"]

    def test_blocks_without_a_bbox_are_dropped(self) -> None:
        document = {"blocks": [{"block_id": "x", "type": "paragraph", "page_index": 0}]}
        assert blocks_to_regions(document, 0) == []


class TestReadingOrderIsNotStorageOrder:
    #: Three regions the parser gets RIGHT, stored backwards. A scorer that trusts array order
    #: reports 0.00 here; one that sorts reports 1.00.
    DOCUMENT = {
        "blocks": [
            _block("third", "paragraph", [0, 200, 100, 220], doc_order=2),
            _block("second", "paragraph", [0, 100, 100, 120], doc_order=1),
            _block("first", "paragraph", [0, 0, 100, 20], doc_order=0),
        ]
    }
    GOLD = [
        _page(
            _gold("g0", "paragraph", [0, 0, 100, 20], order=0),
            _gold("g1", "paragraph", [0, 100, 100, 120], order=1),
            _gold("g2", "paragraph", [0, 200, 100, 220], order=2),
        )
    ]

    def test_correct_order_scores_one_despite_reversed_storage(self) -> None:
        score = score_paper("a", "p", self.DOCUMENT, self.GOLD)
        assert score.mean_reading_order == 1.0

    def test_a_genuinely_wrong_order_still_scores_zero(self) -> None:
        document = {
            "blocks": [
                _block("first", "paragraph", [0, 0, 100, 20], doc_order=2),
                _block("second", "paragraph", [0, 100, 100, 120], doc_order=1),
                _block("third", "paragraph", [0, 200, 100, 220], doc_order=0),
            ]
        }
        assert score_paper("a", "p", document, self.GOLD).mean_reading_order == 0.0


class TestPooling:
    def test_counts_pool_across_pages(self) -> None:
        document = {
            "blocks": [
                _block("a", "paragraph", [0, 0, 100, 20], page=0, doc_order=0),
                _block("b", "paragraph", [0, 0, 100, 20], page=1, doc_order=0),
            ]
        }
        gold = [
            _page(_gold("g0", "paragraph", [0, 0, 100, 20], order=0), index=0),
            _page(_gold("g1", "paragraph", [0, 0, 100, 20], order=0), index=1),
        ]
        score = score_paper("a", "p", document, gold)
        assert (score.by_type["paragraph"].matched, score.by_type["paragraph"].gold) == (2, 2)

    def test_a_block_cannot_satisfy_gold_on_another_page(self) -> None:
        """The reason matching runs per page and only the COUNTS pool."""
        document = {"blocks": [_block("a", "figure", [0, 0, 100, 20], page=0, doc_order=0)]}
        gold = [
            _page(index=0),
            _page(_gold("g1", "figure", [0, 0, 100, 20], order=0), index=1),
        ]
        assert score_paper("a", "p", document, gold).by_type["figure"].matched == 0

    def test_macro_f1_ignores_types_gold_never_uses(self) -> None:
        """Else a parser lowers its own score by emitting a type nobody asked for."""
        document = {
            "blocks": [
                _block("a", "paragraph", [0, 0, 100, 20], doc_order=0),
                _block("b", "table_cell", [0, 300, 10, 310], doc_order=1),
            ]
        }
        gold = [_page(_gold("g0", "paragraph", [0, 0, 100, 20], order=0))]
        score = score_paper("a", "p", document, gold)
        assert score.macro_f1 == 1.0
        assert score.predicted_only_types == {"table_cell"}


class TestNotEvaluable:
    GOLD = [_page(_gold("g0", "figure", [0, 0, 100, 20], order=0))]

    def test_caption_association_reports_why_rather_than_zero(self) -> None:
        score = score_paper("a", "p", {"blocks": []}, self.GOLD)
        assert "parent" in score.not_evaluable["caption_association"]

    def test_vector_recall_reports_why_rather_than_zero(self) -> None:
        score = score_paper("a", "p", {"blocks": []}, self.GOLD)
        assert "is_vector" in score.not_evaluable["vector_figure_recall"]

    def test_gold_carrying_the_fields_makes_them_evaluable(self) -> None:
        gold = [_page(_gold("g0", "figure", [0, 0, 100, 20], order=0, is_vector=True, parent="g1"))]
        assert score_paper("a", "p", {"blocks": []}, gold).not_evaluable == {}


class TestSanityCheckOverlap:
    def test_an_aligned_frame_reports_full_overlap(self) -> None:
        document = {"blocks": [_block("a", "paragraph", [0, 0, 100, 20], doc_order=0)]}
        gold = [_page(_gold("g0", "heading", [10, 5, 90, 15], order=0))]
        # Types disagree, geometry does not - exactly what this check must distinguish.
        assert sanity_check_overlap(document, gold) == (1, 1)

    def test_a_flipped_frame_reports_no_overlap(self) -> None:
        """A y-flip is the failure mode this exists to name; it reads 0.00 like a dead parser."""
        document = {"blocks": [_block("a", "paragraph", [0, 772, 100, 792], doc_order=0)]}
        gold = [_page(_gold("g0", "paragraph", [0, 0, 100, 20], order=0))]
        assert sanity_check_overlap(document, gold) == (0, 1)


def test_render_report_names_the_unevaluable_metrics() -> None:
    gold = [_page(_gold("g0", "paragraph", [0, 0, 100, 20], order=0))]
    report = render_report([score_paper("a", "p", {"blocks": []}, gold)])
    assert "NOT EVALUABLE" in report
    assert "MACRO F1" in report


class TestNearMisses:
    """Right place, wrong shape — the distinction the headline F1 cannot express."""

    def test_a_near_miss_is_counted_not_matched(self) -> None:
        """`attention`'s title, to scale: gold drew it 31 pt tall, the parser boxes 16 pt.

        IoU came to 0.474 against a 0.5 bar, so it scored as a total miss while being detected
        correctly. Reporting that as a detection failure sends the next person to fix the wrong
        thing.
        """
        document = {"blocks": [_block("t", "title", [211, 150, 400, 166], doc_order=0)]}
        gold = [_page(_gold("g0", "title", [208, 138, 408, 169], order=0))]
        score = score_paper("a", "p", document, gold)
        assert score.by_type["title"].matched == 0
        assert score.near_misses["title"] == 1

    def test_a_real_match_is_not_a_near_miss(self) -> None:
        document = {"blocks": [_block("t", "title", [208, 138, 408, 169], doc_order=0)]}
        gold = [_page(_gold("g0", "title", [208, 138, 408, 169], order=0))]
        score = score_paper("a", "p", document, gold)
        assert score.by_type["title"].matched == 1
        assert score.near_misses == {}

    def test_a_genuine_miss_is_not_a_near_miss(self) -> None:
        document = {"blocks": [_block("t", "title", [0, 700, 50, 720], doc_order=0)]}
        gold = [_page(_gold("g0", "title", [208, 138, 408, 169], order=0))]
        assert score_paper("a", "p", document, gold).near_misses == {}

    def test_the_wrong_type_in_the_right_place_is_not_a_near_miss(self) -> None:
        """Near-miss is about BOXING, so the type still has to agree."""
        document = {"blocks": [_block("t", "paragraph", [211, 150, 400, 166], doc_order=0)]}
        gold = [_page(_gold("g0", "title", [208, 138, 408, 169], order=0))]
        assert score_paper("a", "p", document, gold).near_misses == {}

    def test_the_headline_threshold_is_untouched(self) -> None:
        """§4.1 fixes IoU >= 0.5. Moving a bar after seeing results is how a benchmark dies."""
        from papertree_evaluation.metrics import IOU_MATCH

        assert IOU_MATCH == 0.5


class TestDoclingCoordinateConversion:
    """The conversion the bridge does, pinned here because getting it wrong is invisible.

    Docling's `BoundingBox` carries a `coord_origin` that is TOPLEFT or BOTTOMLEFT depending on
    the backend, and under BOTTOMLEFT its `t` is the LARGER number. Converting with the wrong
    assumption yields boxes that are plausible, land on the wrong half of the page, and score
    0.00 everywhere — indistinguishable from a parser that found nothing.
    """

    @staticmethod
    def _convert(top: float, bottom: float, origin: str, height: float = 792.0) -> list[float]:
        """The bridge's arithmetic, extracted. The bridge itself runs in a separate venv."""
        if "BOTTOMLEFT" in origin:
            top, bottom = height - top, height - bottom
        if bottom < top:
            top, bottom = bottom, top
        return [top, bottom]

    def test_topleft_passes_through(self) -> None:
        assert self._convert(107.0, 120.0, "TOPLEFT") == [107.0, 120.0]

    def test_bottomleft_is_flipped_about_the_page_height(self) -> None:
        """ResNet's title: `t=685, b=672` from the bottom is `top=107, bottom=120` from the top."""
        assert self._convert(685.0, 672.0, "COORDORIGIN.BOTTOMLEFT") == [107.0, 120.0]

    def test_the_result_is_always_ordered(self) -> None:
        assert self._convert(120.0, 107.0, "TOPLEFT") == [107.0, 120.0]
