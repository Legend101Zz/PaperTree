"""Every rule in `normalise.py`, and the three cases it must refuse to touch."""

from __future__ import annotations

from typing import Any

import pytest
from papertree_evaluation.normalise import CANONICAL_FLOW, normalise_gold


def _page(*regions: dict[str, Any], paper: str = "p", index: int = 0) -> dict[str, Any]:
    return {
        "paper_id": paper,
        "page": index,
        "page_size": {"width": 612, "height": 792},
        "regions": list(regions),
    }


def _region(gold_id: str, kind: str, flow: str, **over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "gold_id": gold_id,
        "type": kind,
        "flow": flow,
        "bbox": [100.0, 100.0, 200.0, 120.0],
        "reading_order": None,
        "parent": None,
        "text": "",
        "continues_from": None,
        "continues_to": None,
    }
    return {**base, **over}


class TestFlowFromType:
    def test_sticky_dropdown_drift_is_corrected(self) -> None:
        """The observed defect: a `title` left on the previous region's `caption` flow."""
        result = normalise_gold([_page(_region("r00", "title", "caption"))])
        assert result.pages[0]["regions"][0]["flow"] == "body"
        assert [r.rule for r in result.repairs] == [
            "flow-contradicts-type",
            "reading-order-renumber",
        ]

    def test_page_number_leaves_the_body_flow(self) -> None:
        """10 of 14 page numbers arrived as `body`, each stealing a rank from a real region."""
        result = normalise_gold([_page(_region("r00", "page_number", "body", reading_order=0))])
        region = result.pages[0]["regions"][0]
        assert region["flow"] == "footer"
        assert region["reading_order"] is None

    def test_footnote_left_on_body_is_the_costly_one(self) -> None:
        result = normalise_gold([_page(_region("r00", "footnote", "body", reading_order=0))])
        assert result.pages[0]["regions"][0]["flow"] == "footnote"

    @pytest.mark.parametrize("kind,flow", sorted(CANONICAL_FLOW.items()))
    def test_canonical_pairs_are_left_alone(self, kind: str, flow: str) -> None:
        result = normalise_gold([_page(_region("r00", kind, flow))])
        assert [r for r in result.repairs if r.rule == "flow-contradicts-type"] == []

    def test_unknown_type_is_not_invented_a_flow(self) -> None:
        result = normalise_gold([_page(_region("r00", "sonnet", "margin"))])
        assert result.pages[0]["regions"][0]["flow"] == "margin"


class TestCaptionRetyping:
    @pytest.mark.parametrize(
        "text",
        [
            "Figure 2: (left) Scaled Dot-Product Attention.",
            "Table 1. Architectures for ImageNet.",
            "Fig. 5: something",
            "Algorithm 3. Reverse-mode derivative",
            "  figure 10:  leading space and lowercase",
        ],
    )
    def test_float_typed_onto_its_own_caption_is_retyped(self, text: str) -> None:
        result = normalise_gold(
            [_page(_region("r00", "figure", "caption"))],
            region_text={("p", 0, "r00"): text},
        )
        assert result.pages[0]["regions"][0]["type"] == "caption"
        assert result.pages[0]["regions"][0]["flow"] == "caption"

    def test_a_paragraph_that_merely_mentions_a_figure_is_not_a_caption(self) -> None:
        """neural-odes p7 r97, verbatim. The missing punctuation after the number is the tell.

        Retyping this would delete a real paragraph from the gold and invent a caption that is
        not on the page - a corruption that no downstream check would catch.
        """
        result = normalise_gold(
            [_page(_region("r00", "figure", "caption"))],
            region_text={("p", 0, "r00"): "Figure 8 shows examples of spiral reconstructions"},
        )
        assert result.pages[0]["regions"][0]["type"] == "figure"

    def test_paragraphs_are_never_retyped_even_when_they_open_with_a_marker(self) -> None:
        result = normalise_gold(
            [_page(_region("r00", "paragraph", "body"))],
            region_text={("p", 0, "r00"): "Figure 2: this looks exactly like a caption"},
        )
        assert result.pages[0]["regions"][0]["type"] == "paragraph"

    def test_without_text_the_rule_does_not_fire(self) -> None:
        result = normalise_gold([_page(_region("r00", "figure", "caption"))])
        assert result.pages[0]["regions"][0]["type"] == "figure"

    def test_swallowed_caption_is_warned_not_repaired(self) -> None:
        """resnet p4 r202: the box opens with axis labels, so the caption is inside the figure."""
        result = normalise_gold(
            [_page(_region("r00", "figure", "body"))],
            region_text={("p", 0, "r00"): "( ) ( ) Figure 4. Training on ImageNet."},
        )
        assert result.pages[0]["regions"][0]["type"] == "figure"
        assert result.warnings_by_kind()["caption-absorbed-into-float"] == 1


class TestReadingOrderRenumber:
    def test_draw_order_becomes_reading_order(self) -> None:
        result = normalise_gold(
            [
                _page(
                    _region("r00", "title", "caption"),
                    _region("r01", "page_number", "body", reading_order=0),
                    _region("r02", "paragraph", "caption"),
                )
            ]
        )
        by_id = {r["gold_id"]: r for r in result.pages[0]["regions"]}
        assert by_id["r00"]["reading_order"] == 0
        assert by_id["r01"]["reading_order"] is None
        assert by_id["r02"]["reading_order"] == 1

    def test_ranks_are_contiguous_from_zero(self) -> None:
        page = _page(*(_region(f"r{i:02d}", "paragraph", "caption") for i in range(5)))
        result = normalise_gold([page])
        ranks = sorted(r["reading_order"] for r in result.pages[0]["regions"])
        assert ranks == [0, 1, 2, 3, 4]

    def test_gold_ids_sort_lexically_in_draw_order(self) -> None:
        """`annotate.py` zero-pads to two digits, so `r09` < `r10` lexically as well."""
        page = _page(*(_region(f"r{i:02d}", "paragraph", "body") for i in (9, 10, 11)))
        result = normalise_gold([page])
        assert [
            r["reading_order"]
            for r in sorted(result.pages[0]["regions"], key=lambda r: r["gold_id"])
        ] == [0, 1, 2]

    def test_an_already_correct_page_produces_no_repairs(self) -> None:
        result = normalise_gold(
            [
                _page(
                    _region("r00", "paragraph", "body", reading_order=0),
                    _region("r01", "caption", "caption"),
                    _region("r02", "paragraph", "body", reading_order=1),
                )
            ]
        )
        assert result.repairs == []


class TestWarningsThatAreNotRepairs:
    def test_whole_page_box_is_flagged(self) -> None:
        result = normalise_gold(
            [_page(_region("r00", "citation", "body", bbox=[102.0, 66.0, 523.0, 726.0]))]
        )
        assert result.warnings_by_kind()["whole-page-box"] == 1

    def test_an_ordinary_region_is_not_flagged(self) -> None:
        result = normalise_gold([_page(_region("r00", "paragraph", "body"))])
        assert "whole-page-box" not in result.warnings_by_kind()

    def test_captions_without_parents_are_reported_once_per_page(self) -> None:
        result = normalise_gold(
            [
                _page(
                    _region("r00", "caption", "caption"),
                    _region("r01", "caption", "caption"),
                )
            ]
        )
        assert result.warnings_by_kind()["caption-without-parent"] == 1

    def test_a_linked_caption_is_not_reported(self) -> None:
        result = normalise_gold([_page(_region("r00", "caption", "caption", parent="r01"))])
        assert "caption-without-parent" not in result.warnings_by_kind()


def test_input_pages_are_not_mutated() -> None:
    """The caller keeps the raw gold - the metrics are reported both ways."""
    page = _page(_region("r00", "page_number", "body", reading_order=0))
    normalise_gold([page])
    assert page["regions"][0]["flow"] == "body"
    assert page["regions"][0]["reading_order"] == 0


def test_every_gold_type_has_a_canonical_flow() -> None:
    """The annotator ships this table into the browser; a missing key is a silent no-op there.

    `syncFlow()` guards with `if (canonical && ...)`, so a type absent from `CANONICAL_FLOW`
    leaves the flow select on whatever the previous region set - reintroducing exactly the sticky
    behaviour that put 55 wrong flows in the first annotation pass.
    """
    from papertree_evaluation.annotate import GOLD_TYPES

    missing = [name for name in GOLD_TYPES if name not in CANONICAL_FLOW]
    assert missing == []


def test_canonical_flows_are_all_valid_options() -> None:
    """Every derived flow must be selectable in the `#flow` control, or the assignment no-ops."""
    selectable = {"body", "caption", "footnote", "header", "footer", "margin", "float"}
    assert set(CANONICAL_FLOW.values()) <= selectable
