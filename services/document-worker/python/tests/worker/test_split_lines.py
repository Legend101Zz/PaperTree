"""One visual line that MuPDF returned as two: numbered headings, and their geometry.

Both defects were found by scoring against PTUB gold, and both were invisible without it. The
heading split produced a `heading` block holding `"5.1"` and a `paragraph` holding the title -
fifteen times on `attention-is-all-you-need` alone - which reads as perfectly ordinary output
until something asks whether a predicted heading box has the shape of a real one. It did not:
element-detection F1 for `heading` was 0.00 while headings were being "found".
"""

from __future__ import annotations

import pytest
from papertree_document_ir.geometry import union_of_line_rects
from papertree_document_worker.assemble import _coalesce_baselines
from papertree_document_worker.layout import _continues_numbered_heading, _group
from papertree_document_worker.pdf import Line, Span


def _span(text: str, x0: float, x1: float, y0: float, y1: float, size: float = 9.96) -> Span:
    """A span whose `line_band` is exactly `[x0, y0, x1, y1]`, so tests state geometry directly.

    `line_band` is `[bbox.x0, origin.y - ascender*size, bbox.x1, origin.y - descender*size]`, so
    putting the origin on the bottom edge with `descender = 0` and `ascender = height/size`
    makes the band and the box coincide.
    """
    return Span(
        text=text,
        bbox=[x0, y0, x1, y1],
        size=size,
        font="Times",
        flags=0,
        color=0,
        origin=[x0, y1],
        ascender=(y1 - y0) / size,
        descender=0.0,
        direction="ltr",
        chars=(),
    )


def _line(text: str, x0: float, x1: float, y0: float = 353.5, y1: float = 362.5) -> Line:
    return Line(bbox=[x0, y0, x1, y1], direction="ltr", spans=(_span(text, x0, x1, y0, y1),))


class TestNumberedHeadingJoin:
    @pytest.mark.parametrize("number", ["5", "5.1", "3.2.3", "A", "A.2", "IV"])
    def test_a_number_joins_the_title_beside_it(self, number: str) -> None:
        assert _continues_numbered_heading(
            _line(number, 108.0, 120.5), _line("Training Data and Batching", 130.4, 249.5)
        )

    def test_a_table_value_does_not_swallow_the_cell_beside_it(self) -> None:
        """`attention` Table 3 holds `5.29` beside `24.9` on one baseline.

        `5.29` matches the section-number shape exactly, so without the letter guard this would
        fuse two cells of a results table into a single block.
        """
        assert not _continues_numbered_heading(
            _line("5.29", 108.0, 125.0), _line("24.9", 140.0, 158.0)
        )

    def test_a_different_baseline_is_not_a_join(self) -> None:
        assert not _continues_numbered_heading(
            _line("5.1", 108.0, 120.5), _line("Training Data", 130.4, 249.5, y0=380.0, y1=389.0)
        )

    def test_prose_before_a_capitalised_line_is_not_a_join(self) -> None:
        assert not _continues_numbered_heading(
            _line("in our model.", 108.0, 200.0), _line("Training", 210.0, 260.0)
        )

    def test_the_pair_lands_in_one_group(self) -> None:
        groups = _group([_line("5.1", 108.0, 120.5), _line("Optimizer", 130.4, 174.0)], 15.9)
        assert len(groups) == 1
        assert [line.text for line in groups[0]] == ["5.1", "Optimizer"]

    def test_no_synthetic_separator_is_introduced(self) -> None:
        """The join is at the GROUP level precisely so no glyph is invented.

        `Line` is frozen and `Line.text` is the raw glyph stream. Merging two lines into one
        would need a space that is in no content stream, which is a text mutation and would owe
        a recorded `Repair`. Grouping them instead lets `text.py` join with a newline, and
        `hierarchy.py` reads a block as `" ".join(line.text ...)` anyway.
        """
        groups = _group([_line("5.1", 108.0, 120.5), _line("Optimizer", 130.4, 174.0)], 15.9)
        assert "".join(line.text for line in groups[0]) == "5.1Optimizer"


class TestCoalesceBaselines:
    def test_a_tab_becomes_one_rect(self) -> None:
        bands = [[108.0, 353.5, 120.5, 362.5], [130.4, 353.5, 249.5, 362.5]]
        assert _coalesce_baselines(bands) == [[108.0, 353.5, 249.5, 362.5]]

    def test_the_number_survives_the_polygon(self) -> None:
        """The end-to-end symptom: without coalescing the largest ring wins and drops `5.1`."""
        bands = [[108.0, 353.5, 120.5, 362.5], [130.4, 353.5, 249.5, 362.5]]
        assert len(union_of_line_rects(bands, vertical_gap_tolerance=5.0)) == 2
        assert len(union_of_line_rects(_coalesce_baselines(bands), vertical_gap_tolerance=5.0)) == 1

    def test_a_wrapped_continuation_is_not_a_tab(self) -> None:
        """`neural-odes` p16, verbatim: a code listing wraps back to the left margin.

        Merging these widened the block's origin onto another block's and the two collided on
        `block_id` - same page, same type, same anchor, same eight-codepoint prefix.
        """
        bands = [[248.3, 304.8, 364.6, 313.5], [152.6, 305.5, 181.8, 313.5]]
        # Two bands out, not one - and in (y0, x0) order, so the 304.8 band leads.
        assert _coalesce_baselines(bands) == [
            [248.3, 304.8, 364.6, 313.5],
            [152.6, 305.5, 181.8, 313.5],
        ]

    def test_a_far_neighbour_on_the_same_baseline_is_not_a_tab(self) -> None:
        bands = [[108.0, 353.5, 120.5, 362.5], [320.0, 353.5, 400.0, 362.5]]
        assert len(_coalesce_baselines(bands)) == 2

    def test_stacked_lines_are_untouched(self) -> None:
        bands = [[108.0, 340.0, 500.0, 349.0], [108.0, 353.5, 400.0, 362.5]]
        assert _coalesce_baselines(bands) == [
            [108.0, 340.0, 500.0, 349.0],
            [108.0, 353.5, 400.0, 362.5],
        ]

    def test_two_columns_on_one_row_stay_apart(self) -> None:
        """A gutter is not a tab, and ADR-001 commitment 2 depends on it staying that way."""
        bands = [[54.0, 353.5, 290.0, 362.5], [306.0, 353.5, 542.0, 362.5]]
        assert len(_coalesce_baselines(bands)) == 2

    def test_empty_input(self) -> None:
        assert _coalesce_baselines([]) == []
