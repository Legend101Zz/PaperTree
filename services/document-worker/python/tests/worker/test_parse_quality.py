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
