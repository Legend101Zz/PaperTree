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

from collections.abc import Callable
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
#: A rule at least this share of the group's widest stroke is a HEAVY rule. See `_heavy_flags`.
#:
#: Measured stroke widths across the corpus's structural rules: gpt3 {0.797, 0.498}, superglue
#: {0.797, 0.498}, bert {0.873, 0.545, 0.398}, attention {0.996, 0.797, 0.398, 0.299}, a3c
#: {0.996, 0.797, 0.398, 0.379}. Every page is bimodal and the modes are 1.6-2.2x apart, so 0.75
#: sits in empty space on all of them rather than being tuned to one.
HEAVY_RULE_SHARE = 0.75
#: Horizontal gap between cells, as a multiple of the row's median character advance.
COLUMN_GAP_RATIO = 1.8

# ---------------------------------------------------------------------------------------------
# THE BORDERLESS PATH: tables with fewer than two rules, found by column alignment instead.
#
# `MIN_RULES = 2` is right for booktabs and it silently drops a real and common shape. a3c p18 -
# the Atari results table, ~50 rows - draws exactly ONE rule (486 pt, under the header) across
# 510 text lines, so the rule path rejects it and the whole table stays unclaimed. The cost is
# not a missing table: the loose numerals are then read by the font/weight heading rule, and
# **165 of a3c's 193 headings are table values** like '570.2' and '3332.3'. gpt3 p22/p44 do the
# same for 126 of its 181. `hierarchy.spec` says in as many words that no table cell may be
# classified as a heading, so this is an acceptance clause failing one layer below where it shows.
#
# Suppressing numerals in `hierarchy.py` would hide the symptom and leave the cells
# unaddressable, which is the requirement F1.6 exists for. The table has to be claimed.
#
# WHAT SEPARATES A TABLE FROM PROSE. Not the gaps - justified prose stretches inter-word spaces
# and any single line can look multi-column. What prose does NOT do is put those gaps in the SAME
# PLACE on line after line. So the test is column x-positions REPEATING down a run of rows, which
# is the "column/row whitespace alignment" F1.6 asks for.
# ---------------------------------------------------------------------------------------------

#: A row must split into at least this many cells to be a candidate table row.
MIN_TABULAR_COLUMNS = 3
#: ...and that many columns must recur, at the same x, across the run.
MIN_SHARED_COLUMNS = 3
#: Two cells start "the same column" when their left edges agree within this. Measured against
#: the corpus: a3c p18's columns land within 1.5 pt of each other down 50 rows, while a prose
#: paragraph's second word starts somewhere different on every line.
COLUMN_ALIGN_TOL_PT = 3.5
#: A run needs this many aligned rows. Three is a figure legend or an author grid; a table that
#: is worth claiming as a table has more. Deliberately conservative - a false table costs more
#: than a missed one, because it makes real prose unaddressable.
MIN_ALIGNED_ROWS = 5
#: A row this much taller than the run's median is a paragraph that happened to line up, not a
#: table row. Guards the boundary where a table meets the prose above and below it.
ROW_HEIGHT_TOLERANCE = 1.8


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


def _heavy_flags(rules: list[Drawing]) -> dict[int, bool]:
    """Which rules are `\\toprule`/`\\bottomrule` weight rather than `\\midrule` weight.

    THE DISCRIMINATOR #51 ASKED FOR, AND IT IS BOOKTABS' OWN SEMANTICS RATHER THAN A STATISTIC.

    `\\heavyrulewidth` is 0.08em and `\\lightrulewidth` is 0.05em, so a booktabs table's stroke
    widths are bimodal by construction: the rules that OPEN and CLOSE a table are heavy, and
    every rule inside it is light. That is a fact about the generator, not a property measured
    off this corpus and hoped to generalise.

    Four discriminators were measured before this one and every one of them failed to separate,
    which is why the issue says "this needs a discriminator nobody has found yet":

      * gap / row-pitch      - FALSE 4.0-37.5 vs GENUINE 3.5-30.0, overlapping
      * rule-spacing CV      - FALSE 0.373-1.546 vs GENUINE 0.271-1.136, overlapping AND
                               BACKWARDS: gpt3 p52/p59/p60 carry 18/18/24 rules at the three
                               MOST EVEN spacings in the corpus
      * group height + column count - kills genuine a3c p12/p13 and gpt3 p27
      * prose share inside the group - FALSE 0.763-0.941 vs GENUINE 0.080-0.979, overlapping

    All four are scalar summaries of the group. The weight is not a summary; it is the typesetter
    saying where the table ends.

    THE SIGNAL IS ONLY READ WHEN IT CARRIES INFORMATION. A table drawn with `\\hline` throughout
    has ONE stroke width, every rule is trivially "heavy", and closing a group at the second one
    would cut every such table into pairs. So a page whose structural rules are all one width
    gets `{}` back and the grouping falls through to the pre-existing behaviour unchanged.
    """
    if not rules:
        return {}
    widest = max(r.width for r in rules)
    if widest <= 0:
        return {}
    flags = {id(r): r.width >= HEAVY_RULE_SHARE * widest for r in rules}
    return flags if not all(flags.values()) else {}


def _group_rules(rules: list[Drawing]) -> list[list[Drawing]]:
    """Rules that share an x-range and are vertically reachable form one table.

    A HEAVY RULE CLOSES ITS GROUP, and that is what stops `MAX_RULE_GAP_PT`'s transitive chain
    from swallowing a page. `\\bottomrule` is where the table ends; the next heavy rule is the
    next table's `\\toprule`, not a continuation.

    Measured on gpt3 p50-p60 - the stack of boxed qualitative examples #51 names - the rules run
    `heavy, light, heavy | heavy, light, heavy | ...`: four to six independent booktabs tables
    whose only separator IS that weight pattern. Chaining them produced ONE region spanning
    `[72.0, 81.4, 540.0, 691.8]`, the whole text block, against 6 gold figures and 6 gold
    captions with a best same-type IoU of 0.000 for all twelve.

    A heavy rule that OPENS a group does not close it - that is the `\\toprule` - so the guard is
    on appending to a group that already has a rule in it.
    """
    heavy = _heavy_flags(rules)
    groups: list[list[Drawing]] = []
    closed: set[int] = set()
    for rule in sorted(rules, key=lambda r: r.bbox[1]):
        for index, group in enumerate(groups):
            last = group[-1]
            if index in closed:
                continue
            if (
                _x_overlap_share(last.bbox, rule.bbox) >= RULE_X_OVERLAP_SHARE
                and rule.bbox[1] - last.bbox[3] <= MAX_RULE_GAP_PT
            ):
                group.append(rule)
                if heavy.get(id(rule)):
                    closed.add(index)
                break
        else:
            groups.append([rule])
    return groups


def _split_row(lines: list[Line]) -> tuple[tuple[BBox, str], ...]:
    """One visual row of text -> its cells, split on horizontal whitespace.

    Borderless splitting, because booktabs draws no vertical rules. The gap threshold scales with
    the row's own character advance so a wide-set header row and a tight numeric row both work.

    SPLIT PER LINE, THEN MERGED, and that ordering matters. An earlier draft sorted every span in
    the row by x and concatenated, which silently welded spans from DIFFERENT lines together with
    no separator: a3c produced a cell reading `'Onewayofpropagatingrewardsfasterisbyusingn-'`,
    text that appears nowhere in the page's glyph stream. `ingest/source-authenticity.spec`
    caught it - which is the whole reason that lint exists, since the result is a plausible
    string that no validator would question.

    A cell spanning several lines now joins them with U+000A, the same convention
    `build_block_text` uses, so cell text stays reconstructible line by line.
    """
    per_line = [_split_line(line) for line in lines]
    return _merge_columns([cells for cells in per_line if cells])


def _split_line(line: Line) -> list[tuple[BBox, str]]:
    """One LINE -> its cells. Never crosses a line boundary."""
    pieces = [(list(span.bbox), span.text) for span in line.spans if span.text.strip()]
    if not pieces:
        return []
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
            cells.append((current_box, current_text))
            current_box, current_text = list(box), text
        else:
            current_box = [
                min(current_box[0], box[0]),
                min(current_box[1], box[1]),
                max(current_box[2], box[2]),
                max(current_box[3], box[3]),
            ]
            current_text += text
    cells.append((current_box, current_text))
    return cells


def _merge_columns(per_line: list[list[tuple[BBox, str]]]) -> tuple[tuple[BBox, str], ...]:
    """Stack each line's cells into columns by x-overlap, joining wrapped text with U+000A."""
    if not per_line:
        return ()
    columns: list[tuple[BBox, list[str]]] = [(box, [text]) for box, text in per_line[0]]
    for cells in per_line[1:]:
        for box, text in cells:
            for index, (existing_box, texts) in enumerate(columns):
                overlap = min(existing_box[2], box[2]) - max(existing_box[0], box[0])
                if overlap > 0:
                    texts.append(text)
                    columns[index] = (
                        [
                            min(existing_box[0], box[0]),
                            min(existing_box[1], box[1]),
                            max(existing_box[2], box[2]),
                            max(existing_box[3], box[3]),
                        ],
                        texts,
                    )
                    break
            else:
                columns.append((box, [text]))
    columns.sort(key=lambda c: c[0][0])
    return tuple((box, "\n".join(texts)) for box, texts in columns)


def _visual_rows(lines: list[Line]) -> list[list[Line]]:
    """Text lines grouped into visual rows by their vertical band."""
    rows: list[list[Line]] = []
    for line in sorted(lines, key=lambda line: (line.band[1], line.band[0])):
        if rows and abs(line.band[1] - rows[-1][0].band[1]) <= (line.band[3] - line.band[1]) * 0.6:
            rows[-1].append(line)
        else:
            rows.append([line])
    return rows


def _row_box(row: list[Line]) -> BBox:
    bands = [line.band for line in row]
    return [
        min(b[0] for b in bands),
        min(b[1] for b in bands),
        max(b[2] for b in bands),
        max(b[3] for b in bands),
    ]


#: A cell's left edge, right edge and centre. A column is aligned on ONE of these, and which one
#: is a typesetting choice the parser does not get to assume.
#:
#: The first version tested left edges only and found **zero** tables on a3c p18 - 58 rows that
#: split cleanly into 7-9 cells each. Numeric columns are centred or right-aligned, so their left
#: edges move with the width of the number: `570.2` and `76108.0` share a column and start 8 pt
#: apart. Testing all three costs nothing and is the difference between finding that table and
#: not.
def _left(box: BBox) -> float:
    return box[0]


def _right(box: BBox) -> float:
    return box[2]


def _centre(box: BBox) -> float:
    return (box[0] + box[2]) / 2


_ANCHORS: tuple[Callable[[BBox], float], ...] = (_left, _right, _centre)


def _shared_columns(runs: list[tuple[tuple[BBox, str], ...]]) -> int:
    """How many column positions recur across EVERY row of a candidate run.

    The discriminator between a table and prose that happens to have wide gaps. A column counts
    only if every row in the run has a cell agreeing with it, on the same anchor, within
    `COLUMN_ALIGN_TOL_PT` - one row breaking the pattern disqualifies that column, because a
    table's whole point is that the columns hold.
    """
    if not runs:
        return 0
    best = 0
    for anchor in _ANCHORS:
        shared = 0
        for anchor_box, _ in runs[0]:
            at = anchor(anchor_box)
            if all(
                any(abs(anchor(box) - at) <= COLUMN_ALIGN_TOL_PT for box, _ in row)
                for row in runs[1:]
            ):
                shared += 1
        best = max(best, shared)
    return best


def _aligned_regions(page: PageContent, claimed: list[TableRegion]) -> list[TableRegion]:
    """Borderless tables: runs of rows whose columns land at the same x, line after line.

    Runs already covered by a ruled region are skipped rather than merged - the rule path has
    better boundaries when it applies, and `pipeline._dedupe_tables` should not have to arbitrate
    between two descriptions of one table.
    """
    rows = _visual_rows(list(page.lines))
    split = [(_row_box(row), _split_row(row)) for row in rows]

    regions: list[TableRegion] = []
    index = 0
    while index < len(split):
        if len(split[index][1]) < MIN_TABULAR_COLUMNS:
            index += 1
            continue
        heights = [split[index][0][3] - split[index][0][1]]
        end = index + 1
        while end < len(split) and len(split[end][1]) >= MIN_TABULAR_COLUMNS:
            height = split[end][0][3] - split[end][0][1]
            if height > ROW_HEIGHT_TOLERANCE * median(heights):
                break
            heights.append(height)
            end += 1

        # Rows a ruled region already describes are DROPPED from the run, not merely counted.
        #
        # Emitting them twice is not a cosmetic duplicate: `assign_ids` hashes page, position,
        # type and text prefix, so the second copy of a cell gets the SAME id and the build dies
        # with "4650 blocks produced 4640 ids". gpt3 p62 does exactly this - its two rules bracket
        # the header only, so the aligned run legitimately starts inside the ruled region and
        # continues 60 rows past it.
        window = [
            (box, cells)
            for box, cells in split[index:end]
            if not any(
                _x_overlap_share(box, r.bbox) > 0.5 and _covered_share(box, r.bbox) >= 0.5
                for r in claimed
            )
        ]
        if len(window) >= MIN_ALIGNED_ROWS and (
            _shared_columns([cells for _, cells in window]) >= MIN_SHARED_COLUMNS
        ):
            regions.append(
                TableRegion(
                    bbox=[
                        min(b[0] for b, _ in window),
                        min(b[1] for b, _ in window),
                        max(b[2] for b, _ in window),
                        max(b[3] for b, _ in window),
                    ],
                    rows=[TableRow(bbox=b, cells=cells) for b, cells in window],
                    rule_count=0,
                )
            )
            index = end
        else:
            index += 1
    return regions


def _covered_share(inner: BBox, outer: BBox) -> float:
    """How much of `inner`'s HEIGHT the claimed region already accounts for.

    Was "do they overlap at all", and that discarded the largest table in the corpus. gpt3 p62
    draws two rules around its HEADER only - the ruled region is y=101..132, three rows - while
    the body runs 60 more rows below it. Any-overlap made the whole aligned run redundant to a
    31 pt header, so 93 of that page's values stayed loose and became headings.
    """
    height = inner[3] - inner[1]
    if height <= 0:
        return 0.0
    return max(0.0, min(inner[3], outer[3]) - max(inner[1], outer[1])) / height


#: An aligned run is redundant only when a ruled region already covers this much of it. Below
#: that the two are describing different parts of the page and both are kept.
REDUNDANT_SHARE = 0.6


def detect_tables(page: PageContent, column_width: float) -> list[TableRegion]:
    """Table regions on one page, with rows and cells.

    `column_width` scales the rule-width test, so a two-column paper's narrow tables are found
    without a one-column paper's fraction bars being admitted.
    """
    candidates = [d for d in page.drawings if not d.is_clip and _is_horizontal_rule(d)]
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

    # The borderless path runs SECOND and defers to what the rules already claimed, so a booktabs
    # table is described once, by the detector with the better boundaries.
    regions.extend(_aligned_regions(page, regions))
    return regions
