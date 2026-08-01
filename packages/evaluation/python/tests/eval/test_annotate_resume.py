"""The annotator's reopen path — the difference between a 45-minute pass and a redrawn benchmark.

`is_vector` and `parent` were added to the tool AFTER the first annotation pass, so the committed
gold has neither: 34 figures with no `is_vector`, and 51 floats against 1 drawn caption. Both
fields are what §4.1's vector-figure recall and caption association are computed from, and
neither is recoverable after the fact — inferring a caption's float from proximity scores the
parser's own caption heuristic against a copy of itself.

Collecting them meant reopening gold that already exists, and the tool could only ever *download*.
Without a load path the only way to add two fields is to redraw all 249 regions by hand, which is
the entire annotation budget spent again. These tests guard the pieces that make the reopen work;
the drawing itself is browser behaviour and is verified by hand.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from papertree_evaluation.annotate import AnnotationTask, build_annotator
from papertree_evaluation.normalise import normalise_gold


@pytest.fixture
def annotator_html(tmp_path: Path) -> str:
    task = AnnotationTask(
        paper="attention-is-all-you-need",
        page_index=0,
        image_path=tmp_path / "p0.png",
        width_pt=612.0,
        height_pt=792.0,
    )
    return build_annotator([task], tmp_path / "annotate.html").read_text(encoding="utf-8")


class TestTheToolCanReopenItsOwnOutput:
    def test_a_file_input_for_previous_gold_is_present(self, annotator_html: str) -> None:
        assert 'id="loadgold"' in annotator_html
        assert 'type="file"' in annotator_html

    def test_the_editor_exists_for_the_two_retrofit_fields(self, annotator_html: str) -> None:
        assert 'id="editvector"' in annotator_html
        assert 'id="editparent"' in annotator_html

    def test_unfilled_regions_can_be_found_without_hunting(self, annotator_html: str) -> None:
        """`next unfilled` plus an amber class: "what is left" is answerable by scrolling."""
        assert 'id="jump"' in annotator_html
        assert ".box.needs" in annotator_html

    def test_restored_boxes_are_placed_from_the_page_size_not_the_image(
        self, annotator_html: str
    ) -> None:
        """Percentage-of-page placement, so a box cannot land before `naturalWidth` is known.

        Positioning restored boxes through the image's pixel metrics is the obvious approach and
        it is wrong: `clientWidth` is 0 until the image loads, and a box placed then goes silently
        to the wrong coordinates with nothing to reveal it.
        """
        assert "placeRestored" in annotator_html
        assert "dataset.width" in annotator_html

    def test_ids_continue_the_global_sequence_rather_than_restarting(
        self, annotator_html: str
    ) -> None:
        """Gold ids run r00–r248 across all 18 pages, not per page. A reopen that restarts at r00
        mints ids that collide with the ones already in the file."""
        assert "nextId = Math.max(nextId, n + 1)" in annotator_html

    def test_only_is_vector_and_parent_are_editable_on_a_reopen(self, annotator_html: str) -> None:
        """A second pass that can retype a region is a second pass that can rewrite the benchmark.

        Type, flow, bbox and reading_order are what the annotator actually drew; the editor is
        deliberately limited to the two fields the first pass could not collect.
        """
        assert "if (region.type !== 'figure' && region.type !== 'caption') return;" in (
            annotator_html
        )

    def test_pages_absent_from_the_bundle_are_kept_rather_than_dropped(
        self, annotator_html: str
    ) -> None:
        """Reopening a 3-paper bundle with 12-paper gold must not silently delete nine papers."""
        assert "orphaned" in annotator_html


class TestTheRetrofitFieldsSurviveScoring:
    """Whatever the tool collects has to reach the metrics unchanged."""

    REGIONS: list[dict[str, Any]] = [
        {
            "gold_id": "r00",
            "type": "figure",
            "flow": "body",
            "bbox": [10.0, 10.0, 200.0, 120.0],
            "reading_order": 0,
            "parent": None,
            "is_vector": True,
            "text": "",
            "continues_from": None,
            "continues_to": None,
        },
        {
            "gold_id": "r01",
            "type": "caption",
            "flow": "caption",
            "bbox": [10.0, 125.0, 200.0, 140.0],
            "reading_order": None,
            "parent": "r00",
            "is_vector": None,
            "text": "Figure 4. Training on ImageNet.",
            "continues_from": None,
            "continues_to": None,
        },
    ]
    PAGE: dict[str, Any] = {
        "paper_id": "resnet-cvpr-2col",
        "page": 4,
        "page_size": {"width": 612, "height": 792},
        "regions": REGIONS,
    }

    def test_is_vector_reaches_the_metrics(self) -> None:
        pages = normalise_gold([self.PAGE]).pages
        figure = next(r for r in pages[0]["regions"] if r["gold_id"] == "r00")
        assert figure["is_vector"] is True

    def test_the_caption_link_reaches_the_metrics(self) -> None:
        pages = normalise_gold([self.PAGE]).pages
        caption = next(r for r in pages[0]["regions"] if r["gold_id"] == "r01")
        assert caption["parent"] == "r00"

    def test_normalising_does_not_invent_either_field(self) -> None:
        """Both are null on the committed gold and must STAY null rather than be guessed.

        A normaliser that helpfully filled `parent` in from proximity would be scoring the
        parser's caption heuristic against a reimplementation of itself.
        """
        blank = dict(self.PAGE)
        blank["regions"] = [
            {**region, "is_vector": None, "parent": None} for region in self.PAGE["regions"]
        ]
        pages = normalise_gold([blank]).pages
        assert all(r.get("is_vector") is None for r in pages[0]["regions"])
        assert all(r.get("parent") is None for r in pages[0]["regions"])
