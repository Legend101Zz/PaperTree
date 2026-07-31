"""F1.3 - columns, flows and reading order. The feature that findings.md B5 exists about.

THREE MEASURED FAILURES THIS REPLACES

  B5.2  PyMuPDF `sort=True` orders blocks top-to-bottom, which on a two-column page ALTERNATES
        between columns. Measured L/R alternations on a single page: ResNet p4 **44**,
        PDF-to-Tree p2 39, seq2seq p5 38, BERT p2 25.
  B5.3  Paragraphs then accumulated across those alternations into single blocks spanning both
        columns - largest observed 4,673 characters.
  B5.1  Figures were emitted before their page's text because the image loop ran first.

The acceptance criterion is correspondingly absolute: *"No block from column B appears between
two blocks of column A."* Note what that forbids - not "few alternations", **none**.

WHY NOT RECURSIVE XY-CUT, WHICH IS THE OBVIOUS ANSWER

Classic XY-cut alternates horizontal and vertical cuts on whitespace valleys. On a two-column
page it has a specific and fatal failure: if the left column happens to have a paragraph gap at
the same y as a gap in the right column, a full-width horizontal valley exists, and cutting
there splits the page into two slabs. Each slab then splits into two columns, and the resulting
order is L1, R1, L2, R2 - **interleaved**, which is the exact defect being replaced, reached by
a more sophisticated route.

So columns are detected **globally, once per page**, and reading order is derived within them.
Horizontal structure is only ever used to place full-width elements, never to reorder a column.

HOW THE COLUMN SPLIT IS FOUND, AND WHY NOT BY WHITESPACE

Two simpler methods were prototyped against the corpus first and both failed:

  * **Zero-coverage gutters** (find x-ranges no line covers). `pdf-to-tree-acl2col.pdf` is a
    two-column ACL paper and this found **0 gutters on all 11 pages**, because at least one
    full-width element crosses the gutter on every page. Requiring *zero* straddlers means one
    table destroys the whole page's layout.
  * **Clustering line left-edges.** Better, but indented equations, list items and table cells
    all start their own cluster: ResNet p3 produced **5** clusters for a 2-column page.

What works is to allow a *small* number of straddlers. For each candidate x, count the lines
that strictly contain it, and pick the x that minimises that count subject to both sides holding
a real share of the page. A full-width figure then costs a few straddlers instead of vetoing the
split. Measured with a 12 % tolerance: ResNet 12/12 pages two-column, BERT 16/16, PDF-to-Tree
9/11, and the single-column papers stay single (SuperGLUE 29/29, Neural ODEs 17/18).
"""

from __future__ import annotations

import re
import statistics
from collections import Counter
from dataclasses import dataclass, field
from typing import Literal

from papertree_document_ir import BBox

from papertree_document_worker.figures import detect_figure_regions
from papertree_document_worker.pdf import Line, PageContent

__all__ = [
    "Column",
    "DocumentLayout",
    "FlowKind",
    "LayoutBlock",
    "PageLayout",
    "layout_document",
    "layout_page",
]

FlowKind = Literal["body", "caption", "footnote", "header", "footer", "margin"]
"""The six independent reading orders of `Page.flows`. Closed - the schema's `Flow` enum."""

# ── tunables, every one of them measured rather than guessed ───────────────────────────────

#: A candidate column split may be straddled by at most this share of the page's lines. Set
#: from the corpus: PDF-to-Tree's worst genuinely-two-column page straddles at 0.093.
MAX_STRADDLE_SHARE = 0.12
#: Each side of a split must hold at least this share, or a marginal indent looks like a column.
MIN_COLUMN_SHARE = 0.20
#: Below this many lines a page has no statistics worth doing; treat it as one column.
MIN_LINES_FOR_COLUMNS = 8
#: Search granularity for the split, in points. Finer than a gutter by an order of magnitude.
SPLIT_STEP_PT = 1.0
#: A line wider than this share of the content width is full-width: a barrier, not column text.
FULL_WIDTH_SHARE = 0.72
#: Header/footer bands, as a share of page height.
HEADER_BAND = 0.06
FOOTER_BAND = 0.94
#: A header/footer candidate must repeat on at least this share of pages to be furniture. One
#: page's top line is a heading; the same line on 8 pages is a running head.
RUNNING_HEAD_SHARE = 0.35
#: ...and a footnote must also be in the lower part of the page. Without this a small-face
#: caption or a sub/superscript run anywhere below the last full-size line would qualify - a
#: page whose body ends early (a figure page) has almost everything 'below the body'.
FOOTNOTE_MIN_PAGE_SHARE = 0.55
#: ...or it may sit in this bottom band, which counts as a footnote WITHOUT being below the
#: body. Needed for two-column pages: `resnet-cvpr-2col` sets its footnotes at page-share
#: 0.86-0.88 in the left column while the RIGHT column's body text runs lower still, so
#: "below the last body-size line" is false for a perfectly ordinary footnote. Columns are not
#: known here - flows are assigned before `detect_columns` runs on the body - so the page band
#: stands in for a per-column measurement.
FOOTNOTE_BAND = 0.82

_CAPTION_START = re.compile(r"^\s*(?:figure|fig\.?|table|algorithm|listing)\s*[0-9IVXivx]+[.:)\s]")
_PAGE_NUMBER = re.compile(r"^\s*[-–—]?\s*(?:[0-9]{1,4}|[ivxlcIVXLC]{1,7})\s*[-–—]?\s*$")
#: A section number occupying a whole line: `5`, `5.1`, `3.2.3`, `A.2`, `IV`. Deliberately the
#: same shape as `hierarchy._BARE_NUMBER`, which documents why it is needed: *"MuPDF frequently
#: returns the number and the title as separate spans on one line, and sometimes as separate
#: LINES."* Kept as its own pattern rather than imported, because `layout` must not depend on
#: `hierarchy` - the pipeline runs headings LAST, after this.
_SECTION_NUMBER_ONLY = re.compile(r"^\s*(?:\d+|[A-Z]|[IVXL]+)(?:\.\d+)*\s*[.)]?\s*$")
#: How much of the shorter line's height must overlap the other's for them to be one visual
#: line. 0.6 rather than something tighter because a number set in a smaller face than its
#: title still sits on the same baseline with a shorter band.
_BASELINE_OVERLAP_SHARE = 0.6
#: Digits, in any script, that a running head might carry. Used to blank them before comparing
#: one page's header with another's - "Preprint. Page 4" and "Preprint. Page 5" are one header.
_DIGITS = re.compile(r"\d+")


@dataclass(frozen=True, slots=True)
class Column:
    index: int
    x0: float
    x1: float

    def contains(self, band: BBox) -> bool:
        centre = (band[0] + band[2]) / 2
        return self.x0 <= centre < self.x1


@dataclass(frozen=True, slots=True)
class LayoutBlock:
    """A run of lines that belong together, already placed in a flow and a column."""

    lines: tuple[Line, ...]
    flow: FlowKind
    #: `None` for a full-width element, which belongs to no column and acts as a barrier.
    column: int | None
    bbox: BBox
    #: Position within `flow` on this page, dense from 0. This becomes `Block.order`.
    order: int = 0

    @property
    def is_full_width(self) -> bool:
        return self.column is None


@dataclass(slots=True)
class PageLayout:
    index: int
    columns: tuple[Column, ...]
    blocks: tuple[LayoutBlock, ...]

    @property
    def column_count(self) -> int:
        return len(self.columns)

    def in_flow(self, flow: FlowKind) -> list[LayoutBlock]:
        return [b for b in self.blocks if b.flow == flow]


@dataclass(slots=True)
class DocumentLayout:
    pages: tuple[PageLayout, ...]
    #: The running-head/foot strings that repeat across the document, for the record.
    furniture: tuple[str, ...] = field(default=())


# ── column detection ───────────────────────────────────────────────────────────────────────


def _best_split(bands: list[BBox], lo: float, hi: float) -> tuple[float, float] | None:
    """The x that fewest lines straddle, subject to both sides holding a real share.

    Returns `(x, straddle_share)` or `None` when no candidate keeps both sides populated.
    Linear scan at 1 pt: a gutter is 15-25 pt wide, so nothing is gained by going finer, and
    the whole page is only ~600 candidates.
    """
    total = len(bands)
    best: tuple[tuple[int, int], float, float] | None = None
    x = lo + SPLIT_STEP_PT
    while x < hi:
        straddle = left = right = 0
        for band in bands:
            if band[0] < x < band[2]:
                straddle += 1
            elif band[2] <= x:
                left += 1
            else:
                right += 1
        if left >= MIN_COLUMN_SHARE * total and right >= MIN_COLUMN_SHARE * total:
            # Fewest straddlers first; then the most balanced split, so a split that clips one
            # narrow indent off the edge loses to the real gutter.
            score = (straddle, -min(left, right))
            if best is None or score < best[0]:
                best = (score, x, straddle / total)
        x += SPLIT_STEP_PT
    return None if best is None else (best[1], best[2])


def detect_columns(lines: list[Line], page_width: float) -> tuple[Column, ...]:
    """One or more columns, from the line bands alone.

    Only ever splits into two here. Three-column layouts exist (PTUB does not seed one) and the
    honest position is that this returns two for them rather than pretending to a generality
    nothing in the corpus exercises - `EPIC-01-RESULT.md` records it as a known limit.
    """
    bands = [line.band for line in lines if line.band[2] - line.band[0] > 1.0]
    if len(bands) < MIN_LINES_FOR_COLUMNS:
        return (Column(0, 0.0, page_width),)
    lo = min(b[0] for b in bands)
    hi = max(b[2] for b in bands)
    split = _best_split(bands, lo, hi)
    if split is None or split[1] > MAX_STRADDLE_SHARE:
        return (Column(0, 0.0, page_width),)
    return (Column(0, 0.0, split[0]), Column(1, split[0], page_width))


# ── flow assignment ────────────────────────────────────────────────────────────────────────


def _furniture_key(text: str) -> str:
    """A running head compared with its page number blanked out."""
    return _DIGITS.sub("#", text.strip().casefold())


def _running_heads(pages: list[PageContent]) -> set[str]:
    """Strings that appear in the header or footer band of many pages.

    findings.md B6 lists what happens without this: ResNet's outline contained the arXiv margin
    stamp, author names and figure interior labels. A running head is only detectable across
    pages - on any single page it is indistinguishable from a heading - so it is computed once
    for the document and applied per page.
    """
    counts: Counter[str] = Counter()
    for page in pages:
        height = page.frame.height
        seen: set[str] = set()
        for line in page.lines:
            band = line.band
            if band[1] <= HEADER_BAND * height or band[3] >= FOOTER_BAND * height:
                key = _furniture_key(line.text)
                if key and len(key) <= 120:
                    seen.add(key)
        counts.update(seen)
    floor = max(2, int(RUNNING_HEAD_SHARE * len(pages)))
    return {key for key, count in counts.items() if count >= floor}


def _flow_for(
    line: Line, page: PageContent, heads: set[str], body_top: float, body_bottom: float
) -> FlowKind:
    band = line.band
    height = page.frame.height
    text = line.text.strip()

    # Rotated text is margin furniture, essentially always. This is what the arXiv stamp IS,
    # and findings.md B6 records it being promoted to a heading on every arXiv paper.
    if line.direction in ("ttb", "btt"):
        return "margin"
    if _PAGE_NUMBER.match(text) and (
        band[1] <= HEADER_BAND * height or band[3] >= FOOTER_BAND * height
    ):
        return "footer" if band[3] >= FOOTER_BAND * height else "header"
    if _furniture_key(text) in heads:
        return "header" if band[1] < height / 2 else "footer"
    if _CAPTION_START.match(text):
        return "caption"
    # A footnote sits BELOW THE BODY'S LAST LINE in a smaller face - which is what this always
    # said it tested and did not.
    #
    # The old test was `band[3] >= FOOTER_BAND * height`, i.e. the bottom 6 % of the page. Real
    # footnotes are nowhere near there. `attention-is-all-you-need` p0 sets its contribution note
    # and its affiliation footnotes at y 598-709 on a 792 pt page - below the abstract, far above
    # the footer band - so the rule never fired and gold's 2 footnotes were scored against 0
    # predicted. Same on the other two papers.
    #
    # `body_bottom` is the lowest point reached by text at body size on THIS page, so "below the
    # body" is measured rather than assumed from a page fraction. Footnote-sized lines cannot
    # contribute to it, being smaller than the body, so it cannot chase them down the page.
    small = bool(line.spans) and line.spans[0].size < body_top * 0.92
    below_body = band[1] >= body_bottom or band[1] >= FOOTNOTE_BAND * height
    if small and below_body and band[1] >= FOOTNOTE_MIN_PAGE_SHARE * height:
        return "footnote"
    return "body"


# ── block segmentation and ordering ────────────────────────────────────────────────────────


def _shares_a_baseline(previous: Line, current: Line) -> bool:
    """Whether two `Line`s are really one visual line that MuPDF returned separately."""
    overlap = min(previous.band[3], current.band[3]) - max(previous.band[1], current.band[1])
    height = min(previous.band[3] - previous.band[1], current.band[3] - current.band[1])
    return height > 0 and overlap / height > _BASELINE_OVERLAP_SHARE


def _continues_numbered_heading(previous: Line, current: Line) -> bool:
    """`5.1` and `Training Data and Batching`, returned as two lines on one baseline.

    MuPDF splits every numbered heading in this corpus at the tab between the number and the
    title, and `_same_block`'s indent rule then sees a 10 pt step and starts a new block. The
    result was measured against gold: on `attention-is-all-you-need` FIFTEEN section headings
    came out as a `heading` block holding only `"5.1"` plus a `paragraph` block holding the
    title. Element-detection F1 for `heading` was **0.00** - not because headings were missed,
    but because no predicted box had the shape of one.

    `hierarchy.py` already has a join for the same defect (its "B6 join", `_is_bare_number`),
    but it operates on BLOCKS: it builds a correct `Heading` out of the pair while leaving both
    blocks in the document, so the section view is right and the geometry is still wrong. This
    fixes the layer where the boundary is actually decided.

    Nothing is merged textually. The two lines join a single group and `text.py` renders them
    `"5.1\\nTraining Data and Batching"` - the glyph stream, unmutated, no synthetic separator,
    no `Repair`. `parse_section_number` sees the joined form because `hierarchy.py` reads a
    block as `" ".join(line.text ...)`.

    TWO GUARDS, BOTH LOAD-BEARING, both measured on this corpus:

      * the title must START WITH A LETTER. Without it `_SECTION_NUMBER_ONLY` matches table
        values - `attention` Table 3 holds `5.29` beside `24.9` on one baseline, and merging
        those would fuse two cells of a results table into one block.
      * the pair must share a baseline. `5.1` above an unrelated indented line is a different
        situation, already handled by the gap rule.
    """
    if not _SECTION_NUMBER_ONLY.match(previous.text.strip()):
        return False
    title = current.text.strip()
    return bool(title) and title[0].isalpha() and _shares_a_baseline(previous, current)


def _same_block(previous: Line, current: Line, line_gap: float) -> bool:
    """Whether `current` continues the paragraph `previous` belongs to.

    Three ways to be a new block, and each is a measured defect if omitted:
      * a vertical gap larger than the running line pitch - an actual paragraph break;
      * a font size change of more than 15 % - a heading or a caption starting;
      * a first-line indent - the typographic marker of a new paragraph in a LaTeX paper.

    ...and one way to be a continuation that all three would otherwise reject: a numbered
    heading whose number and title MuPDF returned as two lines on one baseline.
    """
    if _continues_numbered_heading(previous, current):
        return True
    gap = current.band[1] - previous.band[3]
    if gap > line_gap:
        return False
    if previous.spans and current.spans:
        before = previous.spans[0].size
        after = current.spans[0].size
        if before > 0 and abs(after - before) / before > 0.15:
            return False
    # An indent of more than half a line height starts a paragraph. Compared against the
    # PREVIOUS line's left edge, so a hanging indent (references) does not split every entry.
    return current.band[0] - previous.band[0] <= line_gap


def _group(lines: list[Line], line_gap: float) -> list[list[Line]]:
    """Group lines into blocks, STARTING A NEW BLOCK at every caption marker.

    A caption line must open its own block, because `is_caption_line` needs the `Figure N` /
    `Table 1` marker at position 0 and rule 22 needs `caption_of.from` to be a `caption` block.

    Measured before this: ResNet produced **4 caption blocks on a paper with ~12 captions**,
    because a caption that happened to sit within the paragraph pitch of the text above it was
    absorbed into that paragraph and its marker stopped being at position 0. That capped
    `figures.spec`'s ">=80% captioned" clause at a level no amount of linker tuning could reach -
    the captions were not missing, they were buried.

    A caption also ENDS at the next line that starts a new region, which `_same_block` already
    handles; only the opening needed forcing.
    """
    groups: list[list[Line]] = []
    for line in lines:
        starts_caption = _CAPTION_START.match(line.text.strip()) is not None
        if groups and not starts_caption and _same_block(groups[-1][-1], line, line_gap):
            groups[-1].append(line)
        else:
            groups.append([line])
    return groups


def _bounds(lines: list[Line]) -> BBox:
    bands = [line.band for line in lines]
    return [
        min(b[0] for b in bands),
        min(b[1] for b in bands),
        max(b[2] for b in bands),
        max(b[3] for b in bands),
    ]


def _order_body(
    groups: list[tuple[list[Line], int | None]], columns: tuple[Column, ...]
) -> list[tuple[list[Line], int | None]]:
    """Reading order over body groups: full-width elements are BARRIERS between column runs.

    This is the function the acceptance criterion is about. The page is cut into slabs at each
    full-width element; within a slab every group of column 0 is emitted before any group of
    column 1. A block from column B therefore cannot appear between two blocks of column A -
    not "rarely", not "usually": the ordering has no step that can interleave them.
    """
    if len(columns) < 2:
        return sorted(groups, key=lambda g: (_bounds(g[0])[1], _bounds(g[0])[0]))

    ordered: list[tuple[list[Line], int | None]] = []
    slab: list[tuple[list[Line], int | None]] = []

    def flush() -> None:
        for column in columns:
            for group in sorted(
                (g for g in slab if g[1] == column.index),
                key=lambda g: (_bounds(g[0])[1], _bounds(g[0])[0]),
            ):
                ordered.append(group)
        slab.clear()

    for group in sorted(groups, key=lambda g: (_bounds(g[0])[1], _bounds(g[0])[0])):
        if group[1] is None:
            flush()
            ordered.append(group)
        else:
            slab.append(group)
    flush()
    return ordered


def layout_page(page: PageContent, heads: set[str]) -> PageLayout:
    all_lines = page.lines
    if not all_lines:
        return PageLayout(index=page.index, columns=(Column(0, 0.0, page.frame.width),), blocks=())

    # FIGURE INTERIORS COME OUT FIRST. This is the ordering `figures.py`'s docstring justifies:
    # ResNet page 3's Figure 3 carries ~40 interior labels at 4.92 pt interleaved in y with both
    # columns' body text, and feeding them to paragraph segmentation shredded the page into 95
    # blocks against a true ~15. They are not body text and must leave the stream BEFORE columns
    # are assigned, not be reclassified afterwards.
    regions = detect_figure_regions(page)
    interior = {id(line) for region in regions for line in region.interior_lines}
    lines = [line for line in all_lines if id(line) not in interior]
    if not lines:
        return PageLayout(index=page.index, columns=(Column(0, 0.0, page.frame.width),), blocks=())

    sizes = [s.size for line in lines for s in line.spans if s.size > 0]
    body_size = statistics.median(sizes) if sizes else 10.0
    # The lowest point text at BODY SIZE reaches on this page - where "below the body" starts.
    # Measured rather than taken as a page fraction, and footnote-sized lines cannot contribute
    # to it (they are smaller than the body), so it cannot chase them down the page.
    full_size = [
        line.band[3] for line in lines if line.spans and line.spans[0].size >= body_size * 0.92
    ]
    body_bottom = max(full_size) if full_size else 0.0
    # The pitch that separates "next line of this paragraph" from "new paragraph". 1.6x the
    # dominant font size: single-spaced LaTeX body sets at ~1.2x, so this leaves headroom
    # without reaching the ~2x that separates paragraphs.
    line_gap = body_size * 1.6

    by_flow: dict[FlowKind, list[Line]] = {}
    for line in lines:
        by_flow.setdefault(_flow_for(line, page, heads, body_size, body_bottom), []).append(line)

    body = by_flow.get("body", [])
    columns = detect_columns(body, page.frame.width)
    content = [line.band for line in body]
    content_width = (max(b[2] for b in content) - min(b[0] for b in content)) if content else 1.0

    blocks: list[LayoutBlock] = []
    for flow, flow_lines in by_flow.items():
        flow_lines.sort(key=lambda line: (line.band[1], line.band[0]))
        if flow != "body":
            # Furniture has its own reading order and is never column-ordered: a running head
            # spans the page, and a caption belongs to its float, not to a column run.
            groups: list[tuple[list[Line], int | None]] = [
                (g, None) for g in _group(flow_lines, line_gap)
            ]
        else:
            # ORDER MATTERS, AND GETTING IT BACKWARDS IS A MEASURED BUG. Each LINE is assigned
            # to a column FIRST, and only then are lines grouped into paragraphs WITHIN a
            # column.
            #
            # Grouping first and assigning the group afterwards - the obvious arrangement, and
            # the one written here initially - fails on exactly the input this whole feature is
            # about: `_group` walks lines in (y, x) order, so on a two-column page consecutive
            # lines come from ALTERNATING columns, merge into one group, and that group's bbox
            # then spans the gutter and is classified full-width. Measured on ResNet: **46
            # false full-width blocks per page**, i.e. findings.md B5.3's both-columns blob
            # re-created by the code meant to prevent it.
            # A FULL-WIDTH BARRIER IS MEANINGLESS ON A SINGLE-COLUMN PAGE, and treating it as
            # meaningful is what shredded paragraphs there.
            #
            # `None` means "spans the columns, so it separates one column run from the next".
            # With one column there are no runs to separate - but the width test still fires,
            # because on a single-column page a NORMAL body line is by definition as wide as the
            # text block. Its paragraph's SHORT LAST LINE is not, so it fell into column 0 while
            # every line above it went to `None`, and the two were then grouped separately.
            #
            # Measured on `attention-is-all-you-need`: 13 gold paragraphs against 107 predicted
            # blocks, with the tail of nearly every paragraph broken off as its own block
            # ("the approach we take in our model.", "target tokens.", "(3.5 days)."). Reads as
            # aggressive segmentation; is actually a column partition applied where no columns
            # exist. `_order_body` already short-circuits on `len(columns) < 2` for the same
            # reason.
            single_column = len(columns) < 2
            per_column: dict[int | None, list[Line]] = {}
            for line in flow_lines:
                band = line.band
                if not single_column and band[2] - band[0] > FULL_WIDTH_SHARE * content_width:
                    key: int | None = None
                else:
                    found = next((c.index for c in columns if c.contains(band)), None)
                    key = found if found is not None else 0
                per_column.setdefault(key, []).append(line)

            assigned: list[tuple[list[Line], int | None]] = []
            for key, column_lines in per_column.items():
                for group in _group(column_lines, line_gap):
                    assigned.append((group, key))
            groups = _order_body(assigned, columns)
        for position, (group, column) in enumerate(groups):
            blocks.append(
                LayoutBlock(
                    lines=tuple(group),
                    flow=flow,
                    column=column,
                    bbox=_bounds(group),
                    order=position,
                )
            )

    return PageLayout(index=page.index, columns=columns, blocks=tuple(blocks))


def layout_document(pages: list[PageContent]) -> DocumentLayout:
    heads = _running_heads(pages)
    return DocumentLayout(
        pages=tuple(layout_page(page, heads) for page in pages),
        furniture=tuple(sorted(heads)),
    )
