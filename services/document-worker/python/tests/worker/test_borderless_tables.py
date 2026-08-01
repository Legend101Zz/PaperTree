"""The borderless table path — and the heading defect it exists to fix.

`hierarchy.spec` says *"No figure label, table cell, author line or arXiv stamp is classified as
a heading."* It was failing, badly, and one layer below where it showed: **165 of a3c's 193
headings and 126 of gpt3's 181 were numeral-only table values** — `'570.2'`, `'3.66'`, `'DQN'`.

The cause was not `hierarchy.py`. a3c p18 — the Atari results table, ~50 rows — draws exactly ONE
horizontal rule, and `MIN_RULES = 2` rejected it, so `tables.py` never claimed the table, the
cells stayed loose on the page, and the font/weight heading rule took bold numerals for section
titles. A containment check confirmed it: 0 of the offending headings sat inside any detected
table region.

Suppressing numerals in `hierarchy.py` would have hidden the symptom and left the cells
unaddressable — which is the one thing F1.6 exists to deliver.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import cast

import pytest
from papertree_document_worker.pdf import Line, PageContent, Span
from papertree_document_worker.tables import (
    MIN_ALIGNED_ROWS,
    TableRegion,
    _aligned_regions,
    _shared_columns,
)


def _span(text: str, x0: float, y0: float, x1: float, y1: float, size: float = 9.0) -> Span:
    """A span whose `line_band` equals its bbox — the same construction `test_split_lines` uses."""
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


def _line(cells: list[tuple[float, str]], y: float, height: float = 8.0) -> Line:
    """One visual row: (x, text) pairs on a shared baseline, spaced far enough apart to split."""
    spans = [_span(text, x, y, x + 6.0 * len(text), y + height) for x, text in cells]
    return Line(
        bbox=[cells[0][0], y, spans[-1].bbox[2], y + height],
        direction="ltr",
        spans=tuple(spans),
    )


def _page(lines: list[Line]) -> PageContent:
    """Only `lines` is read by `_aligned_regions`; the rest is the minimum PageContent needs."""
    return cast(
        PageContent,
        SimpleNamespace(lines=tuple(lines), drawings=(), images=(), index=0),
    )


def _numeric_table(rows: int = 8) -> PageContent:
    """A right-aligned numeric table — the shape a3c p18 actually has."""
    lines = [_line([(50.0, "Game"), (150.0, "DQN"), (250.0, "A3C")], 100.0)]
    for index in range(rows):
        lines.append(
            _line(
                [(50.0, f"Alien{index}"), (150.0, f"{570 + index}.2"), (250.0, f"{81 + index}.5")],
                110.0 + index * 10,
            )
        )
    return _page(lines)


class TestAlignmentFindsWhatRulesMiss:
    def test_a_run_of_aligned_rows_becomes_a_table(self) -> None:
        regions = _aligned_regions(_numeric_table(), [])
        assert len(regions) == 1
        assert regions[0].rule_count == 0, "found by alignment, not by rules"
        assert regions[0].column_count == 3

    def test_every_cell_is_addressable(self) -> None:
        """F1.6's actual requirement: cells with their own geometry, not just extracted text."""
        region = _aligned_regions(_numeric_table(), [])[0]
        assert region.cell_count == 27
        assert all(len(box) == 4 for row in region.rows for box, _ in row.cells)

    def test_a_short_run_is_not_a_table(self) -> None:
        """A false table makes real prose unaddressable, so the bar is deliberately high."""
        assert _aligned_regions(_numeric_table(rows=MIN_ALIGNED_ROWS - 3), []) == []


class TestColumnsAreNotAlwaysLeftAligned:
    """The bug that made the first version find nothing on a3c p18.

    Testing left edges only found **zero** tables across 58 rows that split cleanly into 7-9
    cells each. Numeric columns are centred or right-aligned, so their left edges move with the
    width of the number: `570.2` and `76108.0` share a column and start 8 pt apart.
    """

    @staticmethod
    def _rows(align: str) -> list[tuple[tuple[list[float], str], ...]]:
        out: list[tuple[tuple[list[float], str], ...]] = []
        for width in (10.0, 40.0, 25.0):
            left = {"left": 100.0, "right": 200.0 - width, "centre": 150.0 - width / 2}[align]
            out.append((([left, 0.0, left + width, 8.0], "a"),))
        return out

    @pytest.mark.parametrize("align", ["left", "right", "centre"])
    def test_all_three_alignments_are_recognised(self, align: str) -> None:
        assert _shared_columns(self._rows(align)) == 1

    def test_arbitrary_positions_are_not_a_column(self) -> None:
        rows: list[tuple[tuple[list[float], str], ...]] = [
            (([x, 0.0, x + 10.0, 8.0], "a"),) for x in (100.0, 137.0, 172.0)
        ]
        assert _shared_columns(rows) == 0


def test_rows_a_ruled_table_already_holds_are_dropped_not_duplicated() -> None:
    """gpt3 p62 verbatim, and it was a crash rather than a cosmetic duplicate.

    Its two rules bracket the HEADER only, so the aligned run legitimately begins inside the
    ruled region and continues 60 rows past it. Emitting the overlap twice gave two cells the
    same page, position, type and text - and `assign_ids` hashes exactly those, so the build
    died with "4650 blocks produced 4640 ids".
    """
    page = _numeric_table()
    header = TableRegion(bbox=[40.0, 96.0, 300.0, 112.0], rows=[], rule_count=2)
    regions = _aligned_regions(page, [header])
    assert regions, "the body below the ruled header is still a table"
    tops = [row.bbox[1] for row in regions[0].rows]
    assert min(tops) >= 110.0, "the header row the ruled region already holds is not re-emitted"


def test_prose_is_never_claimed() -> None:
    """Justified prose stretches inter-word gaps; what it does not do is repeat them at one x."""
    lines = [
        _line(
            [(72.0, "the"), (140.0 + index * 9, "quick"), (260.0 - index * 7, "fox")],
            100.0 + index * 12,
        )
        for index in range(9)
    ]
    assert _aligned_regions(_page(lines), []) == []
