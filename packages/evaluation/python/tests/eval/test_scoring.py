"""`scoring.py`, with the order trap pinned first.

`metrics.reading_order_accuracy` reads POSITIONS IN THE PREDICTED LIST, not a rank field. If
`blocks_to_regions` ever stops sorting, every reading-order number in the result document becomes
a measurement of array insertion order that still looks like a plausible score. That is the one
failure here with no visible symptom, so it gets the most tests.
"""

from __future__ import annotations

from typing import Any

from papertree_evaluation.scoring import (
    _caption_links,
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

    def test_an_all_raster_paper_is_complete_gold_not_missing_gold(self) -> None:
        """#86. `is_vector: false` on every figure is an ANSWER, not an absence.

        The guard tested `any(r.get("is_vector"))` — truthiness — so a paper whose figures are
        all raster made that `any()` false and the metric was declared not evaluable over gold
        that fully supports it, while printing "the annotator tool did not collect it". Measured
        on the 2026-08-02 gold: a3c (0 vector / 5 raster) and bert (0 / 2) both did, and all 55
        gold figures across all six papers carry an explicit `is_vector`.

        WATCH IT FAIL: change `is not None` back to truthiness in `score_paper` and this goes
        red, as does `test_an_all_raster_paper_reports_no_vector_gold_rather_than_zero` below.
        """
        gold = [
            _page(
                _gold("g0", "figure", [0, 0, 100, 20], order=0, is_vector=False),
                _gold("g1", "figure", [0, 40, 100, 60], order=1, is_vector=False),
            )
        ]
        assert (
            "vector_figure_recall" not in score_paper("a", "p", {"blocks": []}, gold).not_evaluable
        )

    def test_a_present_but_empty_parent_does_not_read_as_absent(self) -> None:
        """The sibling guard on the same line, which #86 asked to be made to read alike.

        Harmless today — a `parent` is a `gold_id` and 39 of 39 gold captions carry one — and
        one empty-string annotation away from the `is_vector` bug.
        """
        gold = [_page(_gold("g0", "caption", [0, 0, 100, 20], order=0, parent=""))]
        assert (
            "caption_association" not in score_paper("a", "p", {"blocks": []}, gold).not_evaluable
        )


class TestVectorRecallIsOverFiguresNotOverPages:
    """§4.1: *"Recall over gold figures with `is_vector: true`"* — over FIGURES.

    It was a mean of per-page rates that folded in every page with no vector gold as a 0.0,
    because `metrics.vector_figure_recall` returned `0.0` rather than `None` there and
    `score_paper`'s `if page_vector is not None` guard could therefore never fire.
    """

    #: A perfect parser: it finds the one vector figure that exists. Page 1 has no vector gold.
    DOCUMENT = {"blocks": [_block("f", "figure", [0, 0, 100, 20], page=0, doc_order=0)]}
    GOLD = [
        _page(_gold("g0", "figure", [0, 0, 100, 20], order=0, is_vector=True), index=0),
        _page(_gold("g1", "paragraph", [0, 0, 100, 20], order=0), index=1),
        _page(_gold("g2", "paragraph", [0, 0, 100, 20], order=0), index=2),
    ]

    def test_a_page_with_no_vector_gold_is_absent_from_the_mean_not_a_zero(self) -> None:
        """WATCH IT FAIL: make `metrics.vector_figure_recall` return 0.0 for empty vector gold
        and this reads 0.333 — a perfect parser scored at a third, which is what
        `attention-is-all-you-need` was doing on the real gold (printed 0.167, ceiling 0.333)."""
        score = score_paper("a", "p", self.DOCUMENT, self.GOLD)
        assert score.vector_recall == [1.0]
        assert score.mean_vector_recall == 1.0

    def test_the_headline_pools_over_figures(self) -> None:
        score = score_paper("a", "p", self.DOCUMENT, self.GOLD)
        assert (score.vector_matched, score.vector_gold) == (1, 1)
        assert score.vector_recall_pooled == 1.0

    def test_pooling_and_averaging_disagree_when_vector_gold_is_concentrated(self) -> None:
        """The reason both are printed. One page holds three vector figures and the parser finds
        one of them; another holds one and the parser finds it. Pooled is 2/4; the mean of the
        rates is (0.333 + 1.0) / 2."""
        document = {
            "blocks": [
                _block("a", "figure", [0, 0, 100, 20], page=0, doc_order=0),
                _block("b", "figure", [0, 0, 100, 20], page=1, doc_order=0),
            ]
        }
        gold = [
            _page(
                _gold("g0", "figure", [0, 0, 100, 20], order=0, is_vector=True),
                _gold("g1", "figure", [0, 100, 100, 120], order=1, is_vector=True),
                _gold("g2", "figure", [0, 200, 100, 220], order=2, is_vector=True),
                index=0,
            ),
            _page(_gold("g3", "figure", [0, 0, 100, 20], order=0, is_vector=True), index=1),
        ]
        score = score_paper("a", "p", document, gold)
        assert score.vector_recall_pooled == 0.5
        assert score.mean_vector_recall == (1 / 3 + 1.0) / 2

    def test_no_vector_gold_anywhere_is_none_rather_than_zero(self) -> None:
        """A zero is a claim about the parser. An all-raster paper is not making one."""
        gold = [_page(_gold("g0", "figure", [0, 0, 100, 20], order=0, is_vector=False))]
        score = score_paper("a", "p", {"blocks": []}, gold)
        assert score.vector_recall_pooled is None
        assert score.mean_vector_recall is None


def test_a_metric_is_a_number_or_a_reason_and_never_both() -> None:
    """#86's second half: `a3c` printed `vector fig recall 0.000` AND
    `vector_figure_recall: NOT EVALUABLE` three lines apart, for the same adapter on the same
    paper. Two sections of one report must not disagree about whether a number exists.

    THIS TEST DOES NOT EXERCISE `render_report`'s `not in score.not_evaluable` GUARDS, AND
    SAYING SO IS THE POINT. I wrote it first as "drop those guards and watch this go red", ran
    the mutation, and it stayed green — a test asserting nothing, which is the exact defect
    `AGENTS.md` §2 is about. The reason is that the two conditions are **coupled by
    construction** once #86 is fixed:

      * `not_evaluable["vector_figure_recall"]` fires only when NO gold region carries the
        `is_vector` key at all — in which case no region is `is_vector: true`, so `vector_gold`
        is 0 and `vector_recall_pooled` is already `None`;
      * `not_evaluable["caption_association"]` fires only when no region carries `parent` — in
        which case there are no gold links and `caption_links_gold` is already 0.

    So the guards in `render_report` are unreachable belt-and-braces, kept because they state
    the invariant where a future change to what triggers `not_evaluable` would otherwise
    silently reintroduce the contradiction. What actually *closed* the a3c contradiction is
    the pair of fixes above it, and the reachable guard for those is
    `test_an_all_raster_paper_reports_no_vector_gold_rather_than_zero` below plus
    `TestNotEvaluable::test_an_all_raster_paper_is_complete_gold_not_missing_gold` — both of
    which DO go red under the truthiness mutation.

    What this asserts is the invariant itself, over four gold shapes: no report ever carries a
    metric's value line and its NOT EVALUABLE line at once.
    """
    shapes = {
        "nothing collected": [_gold("g0", "figure", [0, 0, 100, 20], order=0)],
        "all raster": [_gold("g0", "figure", [0, 0, 100, 20], order=0, is_vector=False)],
        "vector present": [_gold("g0", "figure", [0, 0, 100, 20], order=0, is_vector=True)],
        "captions linked": [
            _gold("g0", "figure", [0, 0, 100, 20], order=0, is_vector=True),
            _gold("g1", "caption", [0, 30, 100, 40], order=1, parent="g0"),
        ],
    }
    labels = {"vector_figure_recall": "vector fig recall", "caption_association": "caption links"}
    for name, regions in shapes.items():
        score = score_paper("a", "p", {"blocks": []}, [_page(*regions)])
        report = render_report([score])
        for metric, label in labels.items():
            if metric in score.not_evaluable:
                assert f"{metric}: NOT EVALUABLE" in report, name
                assert label not in report, f"{name}: {label} has a value while {metric} is not"


def test_an_all_raster_paper_reports_no_vector_gold_rather_than_zero() -> None:
    """The line a3c and bert should print: evaluable, and there is nothing vector to recall."""
    gold = [
        _page(
            _gold("g0", "figure", [0, 0, 100, 20], order=0, is_vector=False),
            _gold("g1", "figure", [0, 40, 100, 60], order=1, is_vector=False),
        )
    ]
    report = render_report([score_paper("a", "p", {"blocks": []}, gold)])
    assert "no vector gold on these pages" in report
    assert "vector_figure_recall: NOT EVALUABLE" not in report


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


class TestCaptionAssociationCrossesTwoIdSpaces:
    """The join that would silently score a PERFECT parser at zero.

    Gold links are `(caption gold_id, parent gold_id)`; the parser's are
    `(caption block_id, float block_id)`. Different namespaces for the same page. Comparing them
    directly finds no intersection at all, and the report would read 0 correct with no hint that
    the metric — not the parser — was broken.
    """

    FIGURE: dict[str, Any] = {"bbox": [10.0, 10.0, 200.0, 120.0], "type": "figure"}
    CAPTION: dict[str, Any] = {"bbox": [10.0, 125.0, 200.0, 140.0], "type": "caption"}

    @classmethod
    def _page(cls) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
        predicted: list[dict[str, Any]] = [
            {**cls.FIGURE, "block_id": "blk_fig"},
            {**cls.CAPTION, "block_id": "blk_cap"},
        ]
        gold: list[dict[str, Any]] = [
            {**cls.FIGURE, "gold_id": "r00", "parent": None},
            {**cls.CAPTION, "gold_id": "r01", "parent": "r00"},
        ]
        document: dict[str, Any] = {
            "relations": [{"type": "caption_of", "from": "blk_cap", "to": "blk_fig"}],
        }
        return document, predicted, gold

    def test_a_correct_link_is_recognised_across_the_namespaces(self) -> None:
        document, predicted, gold = self._page()
        links, gold_links = _caption_links(document, predicted, gold)
        assert links == [("r01", "r00")]
        assert gold_links == [("r01", "r00")]

    def test_a_link_to_the_wrong_float_is_a_false_link(self) -> None:
        """Worse than no link: confidently wrong, and everything downstream believes it."""
        document, predicted, gold = self._page()
        other: dict[str, Any] = {"bbox": [220.0, 10.0, 400.0, 120.0], "type": "figure"}
        predicted.append({**other, "block_id": "blk_other"})
        gold.append({**other, "gold_id": "r02", "parent": None})
        document["relations"] = [{"type": "caption_of", "from": "blk_cap", "to": "blk_other"}]
        links, gold_links = _caption_links(document, predicted, gold)
        assert links == [("r01", "r02")]
        assert set(links) & set(gold_links) == set()

    def test_an_unmatched_caption_drops_the_link_rather_than_failing_it(self) -> None:
        """A caption boxed too differently to match is a DETECTION failure.

        The `caption` row's F1 already counts it. Counting it here too reports one defect as two
        and makes the linking heuristic look worse than it is.
        """
        document, predicted, gold = self._page()
        predicted[1] = {**predicted[1], "bbox": [400.0, 600.0, 500.0, 620.0]}
        links, _ = _caption_links(document, predicted, gold)
        assert links == []

    def test_relations_of_other_types_are_ignored(self) -> None:
        document, predicted, gold = self._page()
        document["relations"] = [{"type": "references", "from": "blk_cap", "to": "blk_fig"}]
        links, _ = _caption_links(document, predicted, gold)
        assert links == []


# ── declared convention gaps (issue #55) ───────────────────────────────────────────────────
#
# The `citation` row scores 0.00 on four of the six annotated papers and reads as a detection
# failure. It is not one: gold boxes a whole reference page as ONE `citation` region (measured
# 421-505 pt wide and up to 749 pt tall on the four pages that carry one) while the parser emits
# one `reference_entry` per entry, which is what `ANNOTATION_GUIDE.md` asks an annotator for and
# what `Span.role`'s vocabulary and semantic rule 23 mean by the two words.
#
# DECLARING A GAP MUST NOT BE ABLE TO IMPROVE A SCORE BY ITSELF, which is what `substantiated`
# is for and what the second test here pins.


class TestConventionGaps:
    def _paper(self, predicted: list[dict[str, Any]]) -> Any:
        gold = [_gold("g0", "citation", [0, 0, 400, 600], order=0)]
        document = {"blocks": predicted, "relations": []}
        return score_paper("a", "p", document, [{"paper_id": "p", "page": 0, "regions": gold}])

    def test_reference_entries_inside_the_gold_box_substantiate_the_gap(self) -> None:
        """Three `reference_entry` blocks inside the one gold `citation` region. The type still
        scores 0.00 - they are a different type at a different granularity - and the gap now
        carries the evidence that says which failure it is."""
        blocks = [
            _block(f"b{i}", "reference_entry", [10, 10 + i * 20, 390, 25 + i * 20])
            for i in range(3)
        ]
        score = self._paper(blocks)
        gap = score.convention_gaps["citation"]
        assert (gap.gold_regions, gap.substantiated, gap.substitute_blocks) == (1, 1, 3)
        assert gap.is_substantiated
        assert score.by_type["citation"].f1 == 0.0, "the §4.1 row is untouched by a declaration"

    def test_an_unsubstantiated_gap_stays_in_the_average(self) -> None:
        """THE GUARD THAT MAKES THE DECLARATION HONEST. The parser put nothing inside the gold
        region, so `citation` is a plain miss and writing its name in a dict must not excuse it.

        Two scored types here, `citation` (0.0) and `paragraph` (1.0). With the gap excluded the
        macro would be 1.000; unsubstantiated, it stays 0.500."""
        gold = [
            _gold("g0", "citation", [0, 0, 400, 600], order=0),
            _gold("g1", "paragraph", [420, 0, 500, 100], order=1),
        ]
        document = {"blocks": [_block("b0", "paragraph", [420, 0, 500, 100])], "relations": []}
        score = score_paper("a", "p", document, [{"paper_id": "p", "page": 0, "regions": gold}])
        gap = score.convention_gaps["citation"]
        assert (gap.gold_regions, gap.substantiated) == (1, 0)
        assert not gap.is_substantiated
        assert score.macro_f1 == 0.5
        assert score.macro_f1_excluding_convention_gaps == 0.5, (
            "an unsubstantiated gap must not leave the mean"
        )

    def test_a_substantiated_gap_leaves_the_secondary_average_and_not_the_headline(self) -> None:
        """`macro_f1` is §4.1's and does not move. The excl-gap figure is the decomposition."""
        gold = [
            _gold("g0", "citation", [0, 0, 400, 600], order=0),
            _gold("g1", "paragraph", [420, 0, 500, 100], order=1),
        ]
        document = {
            "blocks": [
                _block("b0", "paragraph", [420, 0, 500, 100]),
                _block("b1", "reference_entry", [10, 10, 390, 25]),
            ],
            "relations": [],
        }
        score = score_paper("a", "p", document, [{"paper_id": "p", "page": 0, "regions": gold}])
        assert score.macro_f1 == 0.5, "§4.1's headline must be untouched"
        assert score.macro_f1_excluding_convention_gaps == 1.0

    def test_a_substitute_block_outside_the_gold_region_does_not_count(self) -> None:
        """Containment, not presence-on-the-page. A `reference_entry` elsewhere on the page says
        nothing about whether the parser covered the region gold drew."""
        blocks = [_block("b0", "reference_entry", [500, 700, 600, 750])]
        gap = self._paper(blocks).convention_gaps["citation"]
        assert (gap.substantiated, gap.substitute_blocks) == (0, 0)

    def test_a_paper_with_no_gold_of_the_type_declares_no_gap(self) -> None:
        """`a3c-algorithmheavy` has no gold `citation`. An empty gap entry there would print a
        disagreement about a type nobody annotated."""
        gold = [_gold("g0", "paragraph", [0, 0, 100, 100], order=0)]
        document = {"blocks": [_block("b0", "paragraph", [0, 0, 100, 100])], "relations": []}
        score = score_paper("a", "p", document, [{"paper_id": "p", "page": 0, "regions": gold}])
        assert score.convention_gaps == {}


def test_the_report_prints_a_gap_with_its_evidence_and_never_a_bare_second_headline() -> None:
    """Both halves matter. A gap line with no counts is an assertion; an excl-gap number with no
    gap line is a second headline someone will quote as if it were §4.1's."""
    gold = [
        _gold("g0", "citation", [0, 0, 400, 600], order=0),
        _gold("g1", "paragraph", [420, 0, 500, 100], order=1),
    ]
    document = {
        "blocks": [
            _block("b0", "paragraph", [420, 0, 500, 100]),
            _block("b1", "reference_entry", [10, 10, 390, 25]),
        ],
        "relations": [],
    }
    score = score_paper("a", "p", document, [{"paper_id": "p", "page": 0, "regions": gold}])
    report = render_report([score])
    assert "convention gap" in report
    assert "citation: substantiated" in report
    assert "reference_entry block(s)" in report
    assert "MACRO F1 excl. gap" in report
    assert "NOT §4.1's metric" in report

    unsubstantiated = score_paper(
        "a",
        "p",
        {"blocks": [_block("b0", "paragraph", [420, 0, 500, 100])], "relations": []},
        [{"paper_id": "p", "page": 0, "regions": gold}],
    )
    bare = render_report([unsubstantiated])
    assert "citation: NOT substantiated" in bare
    assert "MACRO F1 excl. gap" not in bare, (
        "nothing was substantiated, so there is no second average to print"
    )
