"""S2 (#141) measured quality rules, each on a case built with the defect's own shape.

Every rule here was found and measured on real papers (`research/benchmarks/READER-RELEASE-
PARSER.md` has the numbers; `test_fresh_papers.py` holds the real-parse assertions, gated on
`./research/benchmarks/fresh/fetch_fresh.sh`). These build the shape in process so CI - which has
neither the corpus nor the fresh set - still runs every rule (`AGENTS.md` §4).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from papertree_document_ir.validate import validate_paper
from papertree_document_worker.assemble import AssembledBlock
from papertree_document_worker.pdf import pymupdf
from papertree_document_worker.pipeline import parse_document

PAPER_ID = "ppr_0123456789ABCDEFGHJKMNP0TV"
W, H = 612.0, 792.0
LEFT, RIGHT = 54.0, 318.0  # the two column origins of a letter two-column page
MEASURE = 240.0  # column width


def _line(seed: str, width: float, size: float = 10.0) -> str:
    """Words starting with `seed` filling `width` points of Helvetica to within a glyph - a
    justified line reaches the measure, and the paragraph cues require a first line that does."""
    text = seed
    for index in range(200):
        candidate = f"{text} w{index}"
        if pymupdf.get_text_length(candidate, fontname="helv", fontsize=size) > width:
            break
        text = candidate
    while pymupdf.get_text_length(text + "i", fontname="helv", fontsize=size) <= width:
        text += "i"
    return text


def _column(page: Any, x: float, top: float, seed: str, lines: int) -> float:
    """`lines` full lines of prose from `top`, the last one short. Returns the next baseline."""
    y = top
    for index in range(lines):
        text = _line(f"{seed}{index}", MEASURE) if index < lines - 1 else f"{seed} ends."
        page.insert_text((x, y), text, fontsize=10, fontname="helv")
        y += 12
    return y


def _save(document: Any, path: Path) -> Path:
    document.save(str(path))
    document.close()
    return path


def _parse(path: Path, tmp_path: Path) -> Any:
    paper = parse_document(path, paper_id=PAPER_ID, asset_root=tmp_path).paper
    assert validate_paper(paper).ok
    return paper


def _containing(paper: Any, needle: str) -> Any:
    return next((b for b in paper.blocks if needle in (b.text or "")), None)


# ── numbered Title-Case headings are headings; author lines on the title page are not ────────


@pytest.fixture(scope="module")
def title_case_headings(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """YOLO's shape: CVPR sets `2. Unified Detection` and `2.1. Network Design` in bold Title
    Case - every word capitalised, no function word - which the author-line guard took for a
    list of names. Page 0 carries the shape that guard exists for: an author line whose
    superscript marker reads as a section number (`1 Alice Smith Bob Jones`). And a stray `2`
    (a page number) sits right above `3. Related Work`, which the bare-number join used to take
    as the heading, swallowing the real one."""
    document = pymupdf.open()
    page = document.new_page(width=W, height=H)
    page.insert_text((150, 80), "A Paper Title Set Large", fontsize=18, fontname="hebo")
    page.insert_text((200, 110), "1 Alice Smith Bob Jones", fontsize=10, fontname="hebo")
    _column(page, LEFT, 160, "front", 30)
    page = document.new_page(width=W, height=H)
    page.insert_text((LEFT, 80), "2. Unified Detection", fontsize=12, fontname="hebo")
    y = _column(page, LEFT, 100, "unified", 8)
    page.insert_text((LEFT, y + 10), "2.1. Network Design", fontsize=11, fontname="hebo")
    y = _column(page, LEFT, y + 30, "network", 8)
    page.insert_text((LEFT, y + 30), "2", fontsize=10, fontname="helv")
    page.insert_text((LEFT, y + 52), "3. Related Work", fontsize=12, fontname="hebo")
    _column(page, LEFT, y + 72, "related", 8)
    return _save(document, tmp_path_factory.mktemp("headings") / "headings.pdf")


def test_numbered_title_case_headings_are_headings(
    title_case_headings: Path, tmp_path: Path
) -> None:
    paper = _parse(title_case_headings, tmp_path)
    for heading in ("2. Unified Detection", "2.1. Network Design", "3. Related Work"):
        block = _containing(paper, heading)
        assert block is not None and block.type == "heading", (heading, block and block.type)
    stray = next(b for b in paper.blocks if (b.text or "").strip() == "2")
    assert stray.type != "heading"


def test_an_author_line_on_the_title_page_is_still_not_a_heading(
    title_case_headings: Path, tmp_path: Path
) -> None:
    paper = _parse(title_case_headings, tmp_path)
    author = _containing(paper, "Alice Smith")
    assert author is not None and author.type != "heading"


# ── the reference sweep reads in reading order ──────────────────────────────────────────────


def _text_block(kind: str, text: str, x: float, y: float, column: int) -> AssembledBlock:
    return AssembledBlock(
        type=kind,
        page_index=0,
        flow="body",
        line_bands=[[x, y, x + 240.0, y + 10.0]],
        text=text,
        column=column,
    )


def test_the_reference_sweep_follows_reading_order_not_height() -> None:
    """A two-column page in reading order: the left column's bibliography, then the right
    column's appendix head at the top of the page. Sorted by height, the appendix head (y 80)
    comes before the second entry (y 400) and closes the sweep early."""
    from papertree_document_worker.references import classify_reference_entries

    blocks = [
        _text_block("heading", "References", 54, 60, 0),
        _text_block("paragraph", "[1] A. Author. A first cited paper. In Proc. 2019.", 54, 100, 0),
        _text_block("paragraph", "[2] B. Author. A second cited paper. In Proc. 2020.", 54, 400, 0),
        _text_block("heading", "A Appendix", 318, 80, 1),
        _text_block("paragraph", "The appendix explains the dataset in more detail.", 318, 100, 1),
    ]
    retyped = {(r.block.text or "")[:3] for r in classify_reference_entries(blocks)}
    assert retyped == {"[1]", "[2]"}


@pytest.fixture(scope="module")
def run_in_leads(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Two bold RUN-IN leads (`\\paragraph{}`), each opening its paragraph's first line: one as a
    single MuPDF line (bold then regular spans - ResNet's `Exploring Over 1000 layers. We ...`),
    one as two lines on one baseline (BERT's bold `MNLI` then `Multi-Genre Natural ...`)."""
    document = pymupdf.open()
    page = document.new_page(width=W, height=H)
    y = _column(page, LEFT, 80, "before", 6) + 14
    lead = "Plain Network."
    page.insert_text((LEFT, y), lead, fontsize=10, fontname="hebo")
    x = LEFT + pymupdf.get_text_length(lead + " ", fontname="hebo", fontsize=10)
    page.insert_text((x, y), _line("plain", MEASURE - (x - LEFT)), fontsize=10, fontname="helv")
    y = _column(page, LEFT, y + 12, "plainrest", 4) + 14
    # A bold section head directly above the second lead, at body size and pitch: the head must
    # stay a heading and the lead must open its own paragraph (superglue p5's `3.4 Tools for Model
    # Analysis` above `Analyzing Linguistic and World Knowledge in Models` + `GLUE includes ...`).
    page.insert_text((LEFT, y), "4.1 Task Descriptions", fontsize=10, fontname="hebo")
    y += 12
    page.insert_text((LEFT, y), "MNLI", fontsize=10, fontname="hebo")
    # 0.1 pt lower, so the lead's band top is the higher one and it sorts first - as BERT's does.
    # Base-14 Helvetica's ascender is taller than Helvetica-Bold's, which would otherwise reverse
    # the pair (`layout._continues_run_in_lead` records that limit).
    page.insert_text(
        (LEFT + 40, y + 0.1), _line("mnli", MEASURE - 40), fontsize=10, fontname="helv"
    )
    _column(page, LEFT, y + 12, "mnlirest", 4)
    return _save(document, tmp_path_factory.mktemp("runin") / "runin.pdf")


def test_a_run_in_lead_is_its_paragraphs_first_line_not_a_heading(
    run_in_leads: Path, tmp_path: Path
) -> None:
    paper = _parse(run_in_leads, tmp_path)
    for lead, rest in (("Plain Network.", "plainrest0"), ("MNLI", "mnlirest0")):
        block = _containing(paper, lead)
        assert block is not None and block.type != "heading", (lead, block and block.type)
        assert rest in (block.text or ""), f"{lead!r} was cut off from its own paragraph"
    head = _containing(paper, "4.1 Task Descriptions")
    assert head is not None and head.type == "heading"
    assert "MNLI" not in (head.text or "")


# ── numeric-only text is never a heading, and is not prose either ───────────────────────────


@pytest.fixture(scope="module")
def numbers_between_paragraphs(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Page 2 of a paper: a bold table value standing alone (YOLO's `66.4`), a larger one (`830`),
    a regular-face value directly above a bold row (YOLO p5's `21`, which the bare-number join
    married to the row), and a real split section number with its title."""
    document = pymupdf.open()
    _column(document.new_page(width=W, height=H), LEFT, 80, "first", 20)
    page = document.new_page(width=W, height=H)
    y = _column(page, LEFT, 80, "alpha", 6) + 20
    page.insert_text((LEFT, y), "66.4", fontsize=10, fontname="hebo")
    y = _column(page, LEFT, y + 24, "bravo", 6) + 20
    page.insert_text((LEFT, y), "830", fontsize=12, fontname="hebo")
    y = _column(page, LEFT, y + 24, "charlie", 6) + 20
    page.insert_text((LEFT, y), "21", fontsize=10, fontname="helv")
    page.insert_text((LEFT, y + 14), "Real Time Detectors", fontsize=10, fontname="hebo")
    y = _column(page, LEFT, y + 38, "delta", 6) + 20
    page.insert_text((LEFT, y), "3", fontsize=12, fontname="hebo")
    page.insert_text((LEFT, y + 16), "Method Overview", fontsize=12, fontname="hebo")
    _column(page, LEFT, y + 36, "echo", 6)
    return _save(document, tmp_path_factory.mktemp("numeric") / "numeric.pdf")


def test_a_number_is_never_a_heading(numbers_between_paragraphs: Path, tmp_path: Path) -> None:
    paper = _parse(numbers_between_paragraphs, tmp_path)
    by_text = {(b.text or "").strip(): b for b in paper.blocks}
    for number in ("66.4", "830", "21"):
        assert number in by_text, f"{number} is not its own block"
        assert by_text[number].type != "heading", number
    # Not prose either: a block with no letters is kept, with its text, as `unknown`.
    assert by_text["66.4"].type == by_text["830"].type == "unknown"
    # ...and a real numbered head is untouched.
    head = _containing(paper, "Method Overview")
    assert head is not None and head.type == "heading"


# ── an abstract ends at the first heading or at its column's foot ──────────────────────────


def _title_page(page: Any) -> None:
    page.insert_text((190, 72), "A Paper Title Set Large", fontsize=18, fontname="hebo")
    page.insert_text((240, 100), "Alice Smith and Bob Jones", fontsize=10, fontname="helv")
    page.insert_text((245, 114), "University of Somewhere", fontsize=10, fontname="helv")


@pytest.fixture(scope="module")
def abstract_beside_the_introduction(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """YOLO's and SBERT's page 0: `Abstract`, the abstract and `1. Introduction` in the left
    column, and the introduction's continuation in the right column, level with the abstract.
    Sorted by height, the right column's paragraphs sat between `Abstract` and the next heading
    and were typed `abstract`; and `_band_rows` put [`Abstract`, the tall right-column paragraph]
    in one "row" below the authors, which typed that paragraph `affiliation`."""
    document = pymupdf.open()
    page = document.new_page(width=W, height=H)
    _title_page(page)
    page.insert_text((LEFT + 90, 150), "Abstract", fontsize=12, fontname="hebo")
    _column(page, LEFT, 168, "abstr", 14)
    page.insert_text((LEFT, 372), "1. Introduction", fontsize=12, fontname="hebo")
    _column(page, LEFT, 392, "introleft", 24)
    y = _column(page, RIGHT, 150, "rightone", 8)
    y = _column(page, RIGHT, y + 26, "righttwo", 8)
    _column(page, RIGHT, y + 26, "rightthree", 24)
    return _save(document, tmp_path_factory.mktemp("abstract") / "abstract.pdf")


def test_the_other_column_beside_an_abstract_is_body(
    abstract_beside_the_introduction: Path, tmp_path: Path
) -> None:
    paper = _parse(abstract_beside_the_introduction, tmp_path)
    abstract = _containing(paper, "abstr0")
    assert abstract is not None and abstract.type == "abstract"
    for seed in ("rightone0", "righttwo0", "introleft0"):
        block = _containing(paper, seed)
        assert block is not None and block.type == "paragraph", (seed, block and block.type)


@pytest.fixture(scope="module")
def abstract_at_a_column_foot(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """The abstract fills the left column to its foot and the right column opens with prose, not
    a heading. In reading order the next block is that prose - and "until the next heading" alone
    would run the abstract into it: the column boundary ends an abstract as a heading does."""
    document = pymupdf.open()
    page = document.new_page(width=W, height=H)
    _title_page(page)
    page.insert_text((LEFT + 90, 150), "Abstract", fontsize=12, fontname="hebo")
    _column(page, LEFT, 168, "abstr", 46)
    y = _column(page, RIGHT, 150, "spill", 8)
    page.insert_text((RIGHT, y + 20), "1. Introduction", fontsize=12, fontname="hebo")
    _column(page, RIGHT, y + 40, "introright", 30)
    return _save(document, tmp_path_factory.mktemp("abstract-foot") / "abstract-foot.pdf")


def test_an_abstract_ends_at_its_columns_foot(
    abstract_at_a_column_foot: Path, tmp_path: Path
) -> None:
    paper = _parse(abstract_at_a_column_foot, tmp_path)
    abstract = _containing(paper, "abstr0")
    assert abstract is not None and abstract.type == "abstract"
    spill = _containing(paper, "spill0")
    assert spill is not None and spill.type == "paragraph", spill and spill.type


@pytest.fixture(scope="module")
def abstract_well_below_its_heading(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """ACL's `Abstract` heading has a larger space-below than the abstract's own internal gaps:
    sbert measures 15.3 pt and attention 16.9 pt, beyond the 15 pt bound that ends an abstract
    at a footnote. Here the abstract starts about 18 pt below its heading."""
    document = pymupdf.open()
    page = document.new_page(width=W, height=H)
    _title_page(page)
    page.insert_text((LEFT + 90, 150), "Abstract", fontsize=12, fontname="hebo")
    _column(page, LEFT, 183, "abstr", 12)
    page.insert_text((LEFT, 350), "1. Introduction", fontsize=12, fontname="hebo")
    _column(page, LEFT, 370, "introleft", 28)
    _column(page, RIGHT, 150, "introright", 40)
    return _save(document, tmp_path_factory.mktemp("abstract-gap") / "abstract-gap.pdf")


def test_an_abstract_may_start_a_headings_space_below_it(
    abstract_well_below_its_heading: Path, tmp_path: Path
) -> None:
    paper = _parse(abstract_well_below_its_heading, tmp_path)
    heading = _containing(paper, "Abstract")
    abstract = _containing(paper, "abstr0")
    assert heading is not None and abstract is not None
    gap = min(y for _, y in abstract.polygon) - max(y for _, y in heading.polygon)
    assert gap > 15.0, f"the fixture must exceed ABSTRACT_MAX_GAP_PT, measured {gap:.1f} pt"
    assert abstract.type == "abstract"


# ── a float is read where it stands, not where it was emitted ──────────────────────────────


def _png() -> bytes:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 16, 16))
    pixmap.set_rect(pixmap.irect, (20, 120, 200))
    return bytes(pixmap.tobytes("png"))


def _booktabs(page: Any, x: float, top: float) -> float:
    """A three-rule-free booktabs table of 4 x 3 numeric cells from `top`; returns its bottom."""
    bottom = top + 70
    page.draw_line((x, top), (x + MEASURE, top), width=0.8)
    page.draw_line((x, bottom), (x + MEASURE, bottom), width=0.8)
    for row, y in enumerate((top + 15, top + 32, top + 49, top + 63)):
        for column, cx in enumerate((x + 4, x + 90, x + 170)):
            page.insert_text((cx, y), f"t{row}{column} {10 * row + column}.5", fontsize=9)
    return bottom


@pytest.fixture(scope="module")
def floats_mid_column(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Page 2 of a two-column paper: a raster figure in the middle of the LEFT column, a booktabs
    table in the middle of the RIGHT column, prose above and below each; page 3 opens with a
    figure spanning both columns above two columns of prose. Emitted order put every table
    before its page's text and every figure after it."""
    document = pymupdf.open()
    _column(document.new_page(width=W, height=H), LEFT, 80, "first", 20)
    page = document.new_page(width=W, height=H)
    y = _column(page, LEFT, 80, "leftabove", 14)
    page.insert_image(pymupdf.Rect(LEFT, y + 6, LEFT + MEASURE, y + 150), stream=_png())
    _column(page, LEFT, y + 176, "leftbelow", 20)
    y = _column(page, RIGHT, 80, "rightabove", 14)
    bottom = _booktabs(page, RIGHT, y + 6)
    _column(page, RIGHT, bottom + 26, "rightbelow", 20)
    page = document.new_page(width=W, height=H)
    page.insert_image(pymupdf.Rect(LEFT, 72, RIGHT + MEASURE, 260), stream=_png())
    _column(page, LEFT, 290, "spanleft", 30)
    _column(page, RIGHT, 290, "spanright", 30)
    # ...and one spanning both columns at the FOOT of a page, below both: read after both, not
    # between them.
    page = document.new_page(width=W, height=H)
    _column(page, LEFT, 80, "footleft", 26)
    _column(page, RIGHT, 80, "footright", 26)
    page.insert_image(pymupdf.Rect(LEFT, 440, RIGHT + MEASURE, 700), stream=_png())
    return _save(document, tmp_path_factory.mktemp("floats") / "floats.pdf")


def _body_order(paper: Any, page_index: int) -> list[Any]:
    by_id = {b.block_id: b for b in paper.blocks}
    flows = dict(paper.pages[page_index].flows)
    return [by_id[i] for i in flows.get("body") or []]


def test_a_float_is_read_where_it_stands(floats_mid_column: Path, tmp_path: Path) -> None:
    paper = _parse(floats_mid_column, tmp_path)
    order = _body_order(paper, 1)
    kinds = [b.type for b in order]
    assert "figure" in kinds and "table" in kinds, kinds

    def at(seed: str) -> int:
        return next(i for i, b in enumerate(order) if seed in (b.text or ""))

    figure, table = kinds.index("figure"), kinds.index("table")
    assert at("leftabove0") < figure < at("leftbelow0"), kinds
    assert at("rightabove0") < table < at("rightbelow0"), kinds
    # A float spanning the columns at the top of a page is read before both of them.
    spanning = _body_order(paper, 2)
    assert spanning[0].type == "figure", [b.type for b in spanning]
    foot = _body_order(paper, 3)
    assert foot[-1].type == "figure", [(b.type, (b.text or "")[:12]) for b in foot]


# ── the title page reads title, authors, then the columns ─────────────────────────────────


@pytest.fixture(scope="module")
def title_right_of_the_split(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """YOLO's page 0: a centred title and author line narrower than a full-width line, whose
    centre falls a few points right of the column split - so each went to column 1 and was read
    after the whole left column. Page 1 holds the opposite case the rule must NOT touch: a wide
    line crossing the split in mid-page (a display equation) between two columns of prose."""
    document = pymupdf.open()
    page = document.new_page(width=W, height=H)
    title = "A Title Set Right Of Centre"
    width = pymupdf.get_text_length(title, fontname="hebo", fontsize=18)
    page.insert_text((330 - width / 2, 80), title, fontsize=18, fontname="hebo")
    authors = "Alice Smith and Bob Jones"
    width = pymupdf.get_text_length(authors, fontname="helv", fontsize=10)
    page.insert_text((330 - width / 2, 110), authors, fontsize=10, fontname="helv")
    page.insert_text((LEFT + 90, 150), "Abstract", fontsize=12, fontname="hebo")
    _column(page, LEFT, 168, "leftcol", 40)
    _column(page, RIGHT, 150, "rightcol", 40)
    page = document.new_page(width=W, height=H)
    _column(page, LEFT, 80, "lefttop", 20)
    _column(page, RIGHT, 80, "righttop", 20)
    page.insert_text((200, 340), "x = y + z  (1)  crossing the split", fontsize=10)
    _column(page, LEFT, 370, "leftbottom", 20)
    _column(page, RIGHT, 370, "rightbottom", 20)
    return _save(document, tmp_path_factory.mktemp("title") / "title.pdf")


def test_the_title_is_read_first(title_right_of_the_split: Path, tmp_path: Path) -> None:
    paper = _parse(title_right_of_the_split, tmp_path)
    order = _body_order(paper, 0)
    assert order[0].type == "title", [(b.type, (b.text or "")[:20]) for b in order[:4]]
    assert "A Title Set Right Of Centre" in (order[0].text or "")

    def at(page: list[Any], seed: str) -> int:
        return next(i for i, b in enumerate(page) if seed in (b.text or ""))

    assert at(order, "Alice Smith") < at(order, "leftcol0") < at(order, "rightcol0")
    # Mid-page, a line crossing the split keeps the centre rule: it is not a barrier, so the left
    # column is read to its foot before the right column starts.
    middle = _body_order(paper, 1)
    assert at(middle, "leftbottom0") < at(middle, "righttop0")


# ── KNOWN DEFECT: text level with a table in the other column leaves the document ────────


@pytest.fixture(scope="module")
def table_beside_prose(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A booktabs table in the left column, and a short right-column paragraph set entirely
    within the table's height. The paragraph is its own layout block (a clear gap above and
    below), which is the shape that lost its text: every one of its lines was "claimed" by a
    table in the other column, so the block was skipped as already emitted - and it never was."""
    document = pymupdf.open()
    page = document.new_page(width=W, height=H)
    _column(page, LEFT, 80, "lefttop", 12)
    top, bottom = 240.0, 310.0
    page.draw_line((LEFT, top), (LEFT + MEASURE, top), width=0.8)
    page.draw_line((LEFT, bottom), (LEFT + MEASURE, bottom), width=0.8)
    for row, y in enumerate((255.0, 272.0, 289.0, 303.0)):
        for column, x in enumerate((LEFT + 4, LEFT + 90, LEFT + 170)):
            page.insert_text(
                (x, y), f"c{row}{column} {10 * row + column}.5", fontsize=9, fontname="helv"
            )
    _column(page, LEFT, 340, "leftbottom", 14)
    _column(page, RIGHT, 80, "righttop", 10)
    _column(page, RIGHT, 262, "beside", 3)
    _column(page, RIGHT, 360, "rightbottom", 12)
    return _save(document, tmp_path_factory.mktemp("claim") / "claim.pdf")


@pytest.mark.xfail(
    strict=True,
    reason=(
        "known defect, not fixed in S2 (#141): a table claims every line level with it at any x, "
        "so a block of the OTHER column wholly within its height is skipped as 'already emitted "
        "as table cells'. Three narrower claims were measured and each also released the table's "
        "own undetected columns as body fragments (22-24 metrics worse); see "
        "research/benchmarks/READER-RELEASE-PARSER.md. Strict, so a fix must remove this marker."
    ),
)
def test_text_level_with_a_table_in_the_other_column_is_kept(
    table_beside_prose: Path, tmp_path: Path
) -> None:
    paper = _parse(table_beside_prose, tmp_path)
    assert [b for b in paper.blocks if b.type == "table"], "the synthetic table was not detected"
    beside = _containing(paper, "beside0")
    assert beside is not None, "the right-column paragraph beside the table left the document"
    assert beside.type == "paragraph" and "beside ends." in (beside.text or "")
    # ...and the table's own text is still a table's, not prose.
    cell = _containing(paper, "c11")
    assert cell is not None and cell.type == "table_cell"


# ── one printed paragraph is one block: first-line indent and paragraph skip ───────────────

INDENT = 12.0  # CVPR's \parindent at 10 pt (YOLO: all 23 indented lines on its pp1-2)


def _paragraph(page: Any, x: float, top: float, seed: str, lines: int, indent: float) -> float:
    """One justified paragraph: an indented first line reaching the measure, full lines, a short
    last line. Returns the baseline after it."""
    y = top
    for index in range(lines):
        if index == 0:
            text, at = _line(f"{seed}{index}", MEASURE - indent), x + indent
        elif index < lines - 1:
            text, at = _line(f"{seed}{index}", MEASURE), x
        else:
            text, at = f"{seed} ends.", x
        page.insert_text((at, y), text, fontsize=10, fontname="helv")
        y += 12
    return y


@pytest.fixture(scope="module")
def printed_paragraphs(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Page 2 of a paper. LEFT column, CVPR style: three paragraphs marked only by a 12 pt
    first-line indent, at the running 12 pt pitch - no extra space between them. RIGHT column,
    NeurIPS style: three unindented paragraphs marked only by a 6 pt paragraph skip, then a
    hanging list whose indented lines are NOT first lines, and a paragraph whose line after a
    short one continues flush left (no indent, no skip: not a new paragraph) and which holds a
    short piece set in from the margin."""
    document = pymupdf.open()
    _column(document.new_page(width=W, height=H), LEFT, 80, "first", 20)
    page = document.new_page(width=W, height=H)
    y = 80.0
    for seed in ("alpha", "bravo", "charlie"):
        y = _paragraph(page, LEFT, y, seed, 7, INDENT)
    y = 80.0
    for seed in ("delta", "echo", "foxtrot"):
        y = _paragraph(page, RIGHT, y, seed, 6, 0.0) + 6
    for item in range(3):
        page.insert_text((RIGHT, y), _line(f"item{item}", MEASURE), fontsize=10, fontname="helv")
        y += 12
        for hang in range(2):  # a hanging indent HOLDS: two continuation lines per item
            page.insert_text(
                (RIGHT + INDENT, y),
                _line(f"hang{item}{hang}", MEASURE - INDENT),
                fontsize=10,
                fontname="helv",
            )
            y += 12
    y += 6
    page.insert_text((RIGHT, y), _line("golf0", MEASURE), fontsize=10, fontname="helv")
    page.insert_text((RIGHT, y + 12), "golf short line.", fontsize=10, fontname="helv")
    page.insert_text((RIGHT, y + 24), _line("golfcont", MEASURE), fontsize=10, fontname="helv")
    # A SHORT piece set in from the margin (what a same-baseline fragment looks like) is no
    # first line: a paragraph's first line in justified text runs to the right margin.
    page.insert_text((RIGHT + INDENT, y + 36), "golf piece", fontsize=10, fontname="helv")
    page.insert_text((RIGHT, y + 48), _line("golfmore", MEASURE), fontsize=10, fontname="helv")
    page.insert_text((RIGHT, y + 60), "golf ends.", fontsize=10, fontname="helv")
    return _save(document, tmp_path_factory.mktemp("paragraphs") / "paragraphs.pdf")


def test_each_printed_paragraph_is_its_own_block(printed_paragraphs: Path, tmp_path: Path) -> None:
    paper = _parse(printed_paragraphs, tmp_path)
    for seed in ("alpha", "bravo", "charlie", "delta", "echo", "foxtrot"):
        block = _containing(paper, f"{seed}0")
        assert block is not None, seed
        text = block.text or ""
        # The whole paragraph, and nothing of its neighbours.
        assert f"{seed} ends." in text, (seed, text[-60:])
        others = {"alpha", "bravo", "charlie", "delta", "echo", "foxtrot"} - {seed}
        assert not any(f"{o}0" in text for o in others), (seed, text[:80])
        assert block.type == "paragraph", (seed, block.type)


def test_an_indent_that_holds_or_a_flush_continuation_is_not_a_new_paragraph(
    printed_paragraphs: Path, tmp_path: Path
) -> None:
    paper = _parse(printed_paragraphs, tmp_path)
    listing = _containing(paper, "item0")
    assert listing is not None and "hang21" in (listing.text or ""), "the hanging list was split"
    golf = _containing(paper, "golf0")
    assert golf is not None and "golf ends." in (golf.text or ""), "a flush continuation split"


@pytest.fixture(scope="module")
def split_paragraph_beside_a_table(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A booktabs table in the left column; in the right column one block of two paragraphs, the
    second opened only by its first-line indent and lying WHOLLY within the table's height. The
    table claims every line level with it, and a block whose lines are all claimed is skipped -
    so splitting the block into its paragraphs made the second one vanish (a3c p2, bert p6,
    resnet p5 and sbert p4 lost 52 lines of prose that way before runs)."""
    document = pymupdf.open()
    _column(document.new_page(width=W, height=H), LEFT, 80, "first", 20)
    page = document.new_page(width=W, height=H)
    _column(page, LEFT, 80, "lefttop", 16)
    bottom = _booktabs(page, LEFT, 296)
    _column(page, LEFT, bottom + 30, "leftbottom", 20)
    _column(page, RIGHT, 80, "righttop", 12)
    y = _paragraph(page, RIGHT, 250, "above", 4, 0.0)
    _paragraph(page, RIGHT, y, "levelwith", 5, INDENT)
    _column(page, RIGHT, 440, "rightbottom", 20)
    return _save(document, tmp_path_factory.mktemp("split-table") / "split-table.pdf")


def test_splitting_a_paragraph_off_beside_a_table_keeps_its_text(
    split_paragraph_beside_a_table: Path, tmp_path: Path
) -> None:
    paper = _parse(split_paragraph_beside_a_table, tmp_path)
    assert [b for b in paper.blocks if b.type == "table"], "the synthetic table was not detected"
    above, level = _containing(paper, "above0"), _containing(paper, "levelwith0")
    assert above is not None and level is not None, "a paragraph beside the table left the document"
    assert "levelwith ends." in (level.text or "")
    assert level.block_id != above.block_id, "the two paragraphs were not split"


# ── a caption is never a figure's interior ──────────────────────────────────────────────────


@pytest.fixture(scope="module")
def raster_over_its_caption(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """DDPM p0's shape: a raster whose PLACEMENT rectangle runs past its visible content, down
    over its own caption line (arXiv 2006.11239v2 places a 348-661 x 468-782 image whose pixels
    end near y 704; `Figure 1: Generated samples ...` sits at y 711-721). Everything inside a
    figure region is claimed as its interior text, so the caption left the document."""
    document = pymupdf.open()
    page = document.new_page(width=W, height=H)
    _column(page, 72, 80, "prose", 12)
    page.insert_image(pymupdf.Rect(72, 250, 540, 560), stream=_png())
    page.insert_text(
        (120, 530), "Figure 1: Samples drawn inside the placement.", fontsize=10, fontname="helv"
    )
    _column(page, 72, 600, "after", 10)
    return _save(document, tmp_path_factory.mktemp("figcap") / "figcap.pdf")


def test_a_caption_inside_a_raster_placement_is_kept(
    raster_over_its_caption: Path, tmp_path: Path
) -> None:
    paper = _parse(raster_over_its_caption, tmp_path)
    caption = _containing(paper, "Figure 1: Samples drawn inside the placement.")
    assert caption is not None, "the caption left the document"
    assert caption.type == "caption"
    figures = {b.block_id for b in paper.blocks if b.type == "figure"}
    assert any(
        r.type == "caption_of" and r.from_ == caption.block_id and r.to in figures
        for r in paper.relations
    ), "the caption is not linked to its figure"


# ── a sentence that names a figure is not its caption ──────────────────────────────────────


def test_a_sentence_opening_with_a_figure_label_is_not_a_caption() -> None:
    """`Figure 4 shows the breakdown ...` opens a PARAGRAPH on yolo p5 once paragraphs are split,
    and the caption opener accepted a label followed by any whitespace: 18 prose paragraphs across
    the 14 papers were typed `caption` (10 before splitting). A caption set without punctuation
    starts its title with a capital; a sentence that names a figure goes on in lower case."""
    from papertree_document_worker.figures import is_caption_line

    for sentence in (
        "Figure 4 shows the breakdown of each error type",
        "Table 3 summarizes the results",
        "Fig. 2 compares both models",
    ):
        assert is_caption_line(sentence) is None, sentence
    for caption in (
        "Figure 4: Error Analysis",
        "Figure 4. Error Analysis",
        "Table 1: Real-Time Systems",
        "Fig. 3. Architecture",
        "Figure G.2: Formatted dataset example",
        "Figure 2 Results on the development set",
        "Table 2 (top) and Table 3 (bottom)",
    ):
        assert is_caption_line(caption) is not None, caption
