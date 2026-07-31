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


class TestSingleColumnHasNoFullWidthBarrier:
    """A short last line must stay with its paragraph when the page has one column.

    `per_column` routes lines wider than `FULL_WIDTH_SHARE * content_width` to the `None`
    barrier bucket. On a single-column page a NORMAL body line is by definition that wide and its
    paragraph's short last line is not, so the tail of nearly every paragraph was grouped apart
    from its body - 13 gold paragraphs against 107 predicted blocks on `attention`.
    """

    @staticmethod
    def _page_lines() -> list[Line]:
        full = [
            _line(f"a full width body line number {i}", 108.0, 505.0, y0, y0 + 9.0)
            for i, y0 in enumerate((146.0, 158.0, 170.0, 182.0))
        ]
        return [*full, _line("the approach we take in our model.", 108.0, 248.0, 194.0, 203.0)]

    def test_the_short_last_line_joins_the_paragraph(self) -> None:
        from papertree_document_worker.layout import Column, _order_body

        columns = (Column(0, 0.0, 612.0),)
        lines = self._page_lines()
        content_width = max(line.band[2] for line in lines) - min(line.band[0] for line in lines)

        # Mirrors `layout_page`'s body path with a single column.
        per_column: dict[int | None, list[Line]] = {}
        for line in lines:
            per_column.setdefault(0 if len(columns) < 2 else None, []).append(line)
        assigned = [(g, k) for k, ls in per_column.items() for g in _group(ls, 15.9)]

        assert content_width > 0
        assert len(_order_body(assigned, columns)) == 1

    def test_two_columns_still_get_a_barrier(self) -> None:
        """The barrier is real when there ARE column runs to separate - ADR-001 depends on it."""
        from papertree_document_worker.layout import FULL_WIDTH_SHARE

        # A line spanning both columns of a 612 pt page is wider than the share of the content.
        assert 54.0 + FULL_WIDTH_SHARE * (542.0 - 54.0) < 542.0


class TestEquationBlockMerge:
    """A display equation is one block, because the region knows its extent and layout does not.

    Layout runs before equation detection and segments a display equation with prose rules, so
    MuPDF's numerator / denominator / relation-symbol lines each became their own block: 17 gold
    equations against **66 predicted** on `neural-odes` p14.
    """

    @staticmethod
    def _region(lines: list[Line]) -> object:
        from papertree_document_worker.equations import EquationRegion

        bands = [line.band for line in lines]
        return EquationRegion(
            lines=tuple(lines),
            bbox=[
                min(b[0] for b in bands),
                min(b[1] for b in bands),
                max(b[2] for b in bands),
                max(b[3] for b in bands),
            ],
            number=None,
            score=1.0,
        )

    @staticmethod
    def _layout(lines: list[Line], order: int) -> object:
        from papertree_document_worker.layout import LayoutBlock, _bounds

        return LayoutBlock(
            lines=tuple(lines), flow="body", column=0, bbox=_bounds(lines), order=order
        )

    def test_fragments_of_one_region_become_one_block(self) -> None:
        from papertree_document_worker.pipeline import _merge_equation_blocks

        top = _line("dht+1", 266.0, 291.0, 223.0, 231.0)
        bottom = _line("dht =", 266.0, 291.0, 231.0, 238.0)
        merged = _merge_equation_blocks(
            (self._layout([top], 0), self._layout([bottom], 1)),  # type: ignore[arg-type]
            [self._region([top, bottom])],
        )
        assert len(merged) == 1
        assert merged[0].bbox == [266.0, 223.0, 291.0, 238.0]

    def test_the_merged_box_covers_every_line_it_holds(self) -> None:
        """Not `region.bbox` — `assemble.py` rebuilds the polygon from lines and would disagree."""
        from papertree_document_worker.pipeline import _merge_equation_blocks

        left = _line("a =", 100.0, 150.0, 200.0, 210.0)
        right = _line("b", 400.0, 430.0, 200.0, 210.0)
        merged = _merge_equation_blocks(
            (self._layout([left], 0), self._layout([right], 1)),  # type: ignore[arg-type]
            [self._region([left, right])],
        )
        assert merged[0].bbox == [100.0, 200.0, 430.0, 210.0]

    def test_blocks_in_no_region_pass_through_untouched(self) -> None:
        from papertree_document_worker.pipeline import _merge_equation_blocks

        prose = self._layout([_line("Ordinary prose.", 100.0, 400.0, 300.0, 310.0)], 0)
        assert _merge_equation_blocks((prose,), []) == [prose]  # type: ignore[arg-type]

    def test_two_regions_stay_two_blocks(self) -> None:
        """The boundary that the removed band-absorption rule destroyed."""
        from papertree_document_worker.pipeline import _merge_equation_blocks

        first = _line("a = b", 200.0, 300.0, 100.0, 110.0)
        second = _line("c = d", 200.0, 300.0, 140.0, 150.0)
        merged = _merge_equation_blocks(
            (self._layout([first], 0), self._layout([second], 1)),  # type: ignore[arg-type]
            [self._region([first]), self._region([second])],
        )
        assert len(merged) == 2

    def test_a_block_straddling_two_regions_is_not_merged(self) -> None:
        from papertree_document_worker.pipeline import _merge_equation_blocks

        a = _line("a", 200.0, 300.0, 100.0, 110.0)
        b = _line("b", 200.0, 300.0, 140.0, 150.0)
        straddler = self._layout([a, b], 0)
        merged = _merge_equation_blocks(
            (straddler,),  # type: ignore[arg-type]
            [self._region([a]), self._region([b])],
        )
        assert merged == [straddler]


class TestFootnoteFlow:
    """A footnote is below the body in a smaller face — which the old test claimed and did not do.

    It required `band[3] >= FOOTER_BAND * height`, the bottom 6 % of the page. Real footnotes are
    nowhere near there: `attention` p0 sets its contribution note at y 598-709 on a 792 pt page.
    The rule never fired, and every gold footnote scored against zero predicted.
    """

    HEIGHT = 792.0

    @staticmethod
    def _flow(y0: float, size: float, body_size: float, body_bottom: float) -> str:
        from types import SimpleNamespace

        from papertree_document_worker.layout import _flow_for

        line = Line(
            bbox=[108.0, y0, 400.0, y0 + 8.0],
            direction="ltr",
            spans=(_span("a footnote about something", 108.0, 400.0, y0, y0 + 8.0, size),),
        )
        # `_flow_for` reads only `page.frame.height`. A stub says that, where a fabricated
        # `PageContent` would say "this test needs a page" and then need six more fields.
        page = SimpleNamespace(frame=SimpleNamespace(height=792.0))
        return _flow_for(line, page, set(), body_size, body_bottom)  # type: ignore[arg-type]

    def test_a_footnote_far_above_the_footer_band_is_found(self) -> None:
        """`attention` p0: y 598 on a 792 pt page, body ends at 576."""
        assert self._flow(598.0, 8.0, 10.0, 576.0) == "footnote"

    def test_a_two_column_footnote_is_found_though_the_body_runs_lower(self) -> None:
        """`resnet` p0: the note is at y 694 while the OTHER column's text reaches 718."""
        assert self._flow(694.0, 8.0, 10.0, 718.0) == "footnote"

    def test_body_sized_text_low_on_the_page_is_not_a_footnote(self) -> None:
        assert self._flow(700.0, 10.0, 10.0, 600.0) == "body"

    def test_small_text_high_on_the_page_is_not_a_footnote(self) -> None:
        """A superscript or a small caption mid-page must not qualify."""
        assert self._flow(200.0, 8.0, 10.0, 100.0) == "body"


class TestBoldStartsABlock:
    """A change of WEIGHT starts a block, exactly as a change of size does.

    The size rule assumes a heading is set larger than its body. `resnet-cvpr-2col` sets its
    section headings BOLD AT BODY SIZE, so nothing fired and page 2 produced one block reading
    "3. Deep Residual Learning 3.1. Residual Learning Let us consider..." — two headings and a
    paragraph. `hierarchy.py` could not have recovered them: by the time it runs, the heading is
    no longer a block.
    """

    BOLD = 1 << 4

    @staticmethod
    def _weighted(text: str, y0: float, flags: int) -> Line:
        span = _span(text, 50.0, 286.0, y0, y0 + 9.0)
        return Line(
            bbox=[50.0, y0, 286.0, y0 + 9.0],
            direction="ltr",
            spans=(
                Span(
                    text=text,
                    bbox=span.bbox,
                    size=span.size,
                    font=span.font,
                    flags=flags,
                    color=0,
                    origin=span.origin,
                    ascender=span.ascender,
                    descender=span.descender,
                    direction="ltr",
                    chars=(),
                ),
            ),
        )

    def test_a_bold_heading_leaves_the_paragraph_above_it(self) -> None:
        groups = _group(
            [
                self._weighted("way networks have not demonstrated gains", 100.0, 0),
                self._weighted("3. Deep Residual Learning", 110.0, self.BOLD),
            ],
            15.9,
        )
        assert len(groups) == 2

    def test_the_paragraph_below_it_is_also_separate(self) -> None:
        groups = _group(
            [
                self._weighted("3.1. Residual Learning", 100.0, self.BOLD),
                self._weighted("Let us consider H(x) as an underlying", 110.0, 0),
            ],
            15.9,
        )
        assert len(groups) == 2

    def test_a_run_of_body_text_is_not_split(self) -> None:
        groups = _group(
            [self._weighted(f"body line {i}", 100.0 + i * 10, 0) for i in range(4)], 15.9
        )
        assert len(groups) == 1

    def test_weight_is_judged_by_text_volume_not_the_first_span(self) -> None:
        """A paragraph opening with a bold run-in word must not start a block on every one."""
        from papertree_document_worker.layout import _is_bold_line

        bold_word = _span("Note.", 50.0, 70.0, 100.0, 109.0)
        rest = _span(" the rest of a long ordinary sentence", 70.0, 286.0, 100.0, 109.0)
        line = Line(
            bbox=[50.0, 100.0, 286.0, 109.0],
            direction="ltr",
            spans=(
                Span(
                    text=bold_word.text,
                    bbox=bold_word.bbox,
                    size=bold_word.size,
                    font="Times",
                    flags=self.BOLD,
                    color=0,
                    origin=bold_word.origin,
                    ascender=bold_word.ascender,
                    descender=0.0,
                    direction="ltr",
                    chars=(),
                ),
                rest,
            ),
        )
        assert _is_bold_line(line) is False
