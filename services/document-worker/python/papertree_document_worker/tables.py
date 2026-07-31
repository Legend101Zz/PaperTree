"""F1.6 - table regions, rows and ADDRESSABLE cells.

WHY CELLS AND NOT JUST TEXT. findings.md H2: Docling is the only candidate that recovered tables
with addressable cells (342 on ResNet, 222 on Attention) and both PaperTree extractors scored
**0**. "Addressable" is the requirement, not "extracted": a citation has to be able to point at
*this cell*, which means the cell is a block with its own id and its own geometry.

THE CORPUS IS BOOKTABS, AND THAT DECIDES THE ALGORITHM

Measured across the corpus: ML papers use `booktabs`, which draws **horizontal rules only** -
`\\toprule`, `\\midrule`, `\\bottomrule` - and no vertical rules at all. superglue p3 has 25
horizontal rules and 0 vertical; p1 is the one page with any verticals (12).

So a vertical-ruling-based table finder would score zero on this corpus. Rows come from the
rules; **columns come from whitespace alignment**, which is the borderless case the epic asks
for anyway and is the only case that actually occurs here.

THE TRAP: `\\frac` BARS ARE ALSO THIN HORIZONTAL FILLS

neural-odes p2 carries rules at widths 396.0, 396.0 (Table 1's top and mid rules) alongside
10.1, 20.9, 9.4 and 9.4 - the last four are **fraction bars in display equations**. A detector
that takes every thin horizontal fill turns every `\\frac` into a one-row table.

Width separates them cleanly and nothing else needs to: a table rule spans its column
(`MIN_RULE_WIDTH_SHARE` of it), a fraction bar spans a numerator.

`payload.html` IS DELIBERATELY NOT EMITTED

Semantic rule **32b** is Tier B and assigned to Epic 1: `table.payload.html`, when present, must
be the library's deterministic serialisation of `grid` - "a derived field nobody checks is a
second representation that drifts. If Epic 1 does not want to own the serialiser, it must DROP
THE FIELD instead."

The serialiser would have to live in `packages/document-ir` to be *the library's*, and Epic 1
may not edit that package. So the field is dropped. `grid` is the addressable representation and
the one PaperTree actually needs; an HTML string is a rendering concern.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median

from papertree_document_ir import BBox

from papertree_document_worker.pdf import Drawing, Line, PageContent

__all__ = ["TableRegion", "TableRow", "detect_tables"]

#: A rule must span at least this share of the widest rule in its group to be structural. Set
#: from the corpus: booktabs rules are 370-396 pt where fraction bars are 9-21 pt, so anything
#: in between is unoccupied and the threshold is not delicate.
MIN_RULE_WIDTH_SHARE = 0.40
#: ...and at least this many points wide in absolute terms, so a narrow column of a two-column
#: paper cannot admit a fraction bar by having a small "widest rule".
MIN_RULE_WIDTH_PT = 60.0
#: Rules within this vertical distance belong to one table. A booktabs table's toprule and
#: bottomrule are the full table height apart, so this is generous on purpose and the grouping
#: is by x-overlap first.
MAX_RULE_GAP_PT = 420.0
#: Two rules belong to the same table only if their x-ranges overlap by this share.
RULE_X_OVERLAP_SHARE = 0.6
#: A table needs at least two rules - booktabs always draws toprule and bottomrule.
MIN_RULES = 2
#: Horizontal gap between cells, as a multiple of the row's median character advance.
COLUMN_GAP_RATIO = 1.8


@dataclass(frozen=True, slots=True)
class TableRow:
    bbox: BBox
    #: One entry per detected column. A cell may be empty - booktabs tables have gaps - and an
    #: empty cell is still ADDRESSABLE, so it is kept rather than dropped.
    cells: tuple[tuple[BBox, str], ...]


@dataclass(slots=True)
class TableRegion:
    bbox: BBox
    rows: list[TableRow] = field(default_factory=list)
    rule_count: int = 0

    @property
    def column_count(self) -> int:
        return max((len(row.cells) for row in self.rows), default=0)

    @property
    def cell_count(self) -> int:
        return sum(len(row.cells) for row in self.rows)


def _is_horizontal_rule(drawing: Drawing) -> bool:
    width = drawing.bbox[2] - drawing.bbox[0]
    height = drawing.bbox[3] - drawing.bbox[1]
    return height <= 2.5 and width >= 8 * max(height, 0.1)


def _x_overlap_share(a: BBox, b: BBox) -> float:
    lo = max(a[0], b[0])
    hi = min(a[2], b[2])
    smaller = min(a[2] - a[0], b[2] - b[0])
    return (hi - lo) / smaller if smaller > 0 else 0.0


def _group_rules(rules: list[Drawing]) -> list[list[Drawing]]:
    """Rules that share an x-range and are vertically reachable form one table."""
    groups: list[list[Drawing]] = []
    for rule in sorted(rules, key=lambda r: r.bbox[1]):
        for group in groups:
            last = group[-1]
            if (
                _x_overlap_share(last.bbox, rule.bbox) >= RULE_X_OVERLAP_SHARE
                and rule.bbox[1] - last.bbox[3] <= MAX_RULE_GAP_PT
            ):
                group.append(rule)
                break
        else:
            groups.append([rule])
    return groups


def _split_row(lines: list[Line]) -> tuple[tuple[BBox, str], ...]:
    """One visual row of text -> its cells, split on horizontal whitespace.

    Borderless splitting, because booktabs draws no vertical rules. The gap threshold scales with
    the row's own character advance so a wide-set header row and a tight numeric row both work.
    """
    pieces: list[tuple[BBox, str]] = []
    for line in lines:
        for span in line.spans:
            if span.text.strip():
                pieces.append((list(span.bbox), span.text))
    if not pieces:
        return ()
    pieces.sort(key=lambda p: p[0][0])

    advances = [
        (box[2] - box[0]) / max(len(text), 1) for box, text in pieces if (box[2] - box[0]) > 0
    ]
    threshold = COLUMN_GAP_RATIO * (median(advances) if advances else 3.0)

    cells: list[tuple[BBox, str]] = []
    current_box = list(pieces[0][0])
    current_text = pieces[0][1]
    for box, text in pieces[1:]:
        if box[0] - current_box[2] > threshold:
            cells.append((current_box, current_text.strip()))
            current_box, current_text = list(box), text
        else:
            current_box = [
                min(current_box[0], box[0]),
                min(current_box[1], box[1]),
                max(current_box[2], box[2]),
                max(current_box[3], box[3]),
            ]
            current_text += text
    cells.append((current_box, current_text.strip()))
    return tuple(cells)


def detect_tables(page: PageContent, column_width: float) -> list[TableRegion]:
    """Table regions on one page, with rows and cells.

    `column_width` scales the rule-width test, so a two-column paper's narrow tables are found
    without a one-column paper's fraction bars being admitted.
    """
    candidates = [d for d in page.drawings if not d.is_clip and _is_horizontal_rule(d)]
    if not candidates:
        return []

    floor = max(MIN_RULE_WIDTH_PT, MIN_RULE_WIDTH_SHARE * column_width)
    structural = [d for d in candidates if (d.bbox[2] - d.bbox[0]) >= floor]

    regions: list[TableRegion] = []
    for group in _group_rules(structural):
        if len(group) < MIN_RULES:
            continue
        box: BBox = [
            min(r.bbox[0] for r in group),
            min(r.bbox[1] for r in group),
            max(r.bbox[2] for r in group),
            max(r.bbox[3] for r in group),
        ]
        inside = [
            line
            for line in page.lines
            if box[1] - 2 <= (line.band[1] + line.band[3]) / 2 <= box[3] + 2
            and _x_overlap_share(line.band, box) > 0.5
        ]
        if not inside:
            continue

        # Group lines into visual rows by y, then split each row on whitespace.
        inside.sort(key=lambda line: (line.band[1], line.band[0]))
        rows: list[list[Line]] = []
        for line in inside:
            if (
                rows
                and abs(line.band[1] - rows[-1][0].band[1]) <= (line.band[3] - line.band[1]) * 0.6
            ):
                rows[-1].append(line)
            else:
                rows.append([line])

        built: list[TableRow] = []
        for row_lines in rows:
            cells = _split_row(row_lines)
            if not cells:
                continue
            bands = [line.band for line in row_lines]
            built.append(
                TableRow(
                    bbox=[
                        min(b[0] for b in bands),
                        min(b[1] for b in bands),
                        max(b[2] for b in bands),
                        max(b[3] for b in bands),
                    ],
                    cells=cells,
                )
            )
        if built:
            regions.append(TableRegion(bbox=box, rows=built, rule_count=len(group)))
    return regions
