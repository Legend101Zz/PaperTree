"""v0.3 (#348): the words that go beside a picture: its caption and the paragraph that first
mentions it (``image_context``), and the image anchor they start from (``image_anchor``).

Two layers, as AGENTS.md §4 asks. On every push: the committed resnet fixture (a hand-checked parse
that has both ``caption_of`` edges and no ``references`` edge at all), with ``references`` edges
ADDED to prove the edge rule. Behind the corpus: a real parse of ``resnet-cvpr-2col.pdf``, where
the parser's own gaps show (Figure 2's caption is a body paragraph with no edge) and the selection
must still find Figure 2's words. The corpus tests SKIP LOUDLY (reason names the fetch script); an
all-skipped run would be a pass that measured nothing.
"""

from __future__ import annotations

import copy
import glob
import re
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from api_support import load_fixture
from papertree_api import evidence, image_anchor, image_context
from papertree_api.image_anchor import image_box
from papertree_db import PaperId, PaperTreeDb, generation, new_id
from papertree_document_worker.pipeline import ParserConfig, parse_document
from papertree_retrieval import PaperIndex

CORPUS_DIR = Path(__file__).resolve().parents[4] / "research" / "benchmarks" / "corpus"
FETCH_SCRIPT = "./research/benchmarks/fetch_corpus.sh"
RESNET_PDF = CORPUS_DIR / "resnet-cvpr-2col.pdf"
requires_corpus = pytest.mark.skipif(
    not (glob.glob(str(CORPUS_DIR / "*.pdf")) and RESNET_PDF.exists()),
    reason=(
        f"the corpus PDFs are gitignored and absent here: fetch them with `{FETCH_SCRIPT}`. The "
        "fixture-backed tests in this module run everywhere; this layer measures a REAL parse."
    ),
)

DATAMARK = "^7f3a91c2"
#: The committed fixture: Figure 1 (page 0) and Figure 2 (page 1), each with a caption_of edge.
FIG1, CAP1 = "blk_3pzzcn4luvb5qmpc", "blk_j3bfq7irmxg62uh5"
FIG2, CAP2 = "blk_vd6i5hijwlkso3vs", "blk_5mol5rifo7auwfaj"
#: Body paragraphs of the fixture that name "Fig. 2": doc_order 19 (page 1), 36, 38, 39 (page 2).
FIRST_MENTION_OF_FIG2 = "blk_7qvf2ybocr37gwjf"


def anchor(
    page: int, box: tuple[float, float, float, float], kind: str = "figure_region", **extra: Any
) -> dict[str, Any]:
    """A minimal image anchor: PageSelector, one-quad ShapeSelector, BlockSelector if given."""
    selectors: list[dict[str, Any]] = [
        {"type": "PageSelector", "index": page},
        {
            "type": "ShapeSelector",
            "pageIndex": page,
            "quads": [list(box)],
            "polygons": [],
            "pageWidth": 612,
            "pageHeight": 792,
            "rotation": 0,
            "userUnit": 1,
            "cropBox": [0, 0, 612, 792],
        },
    ]
    if "block_id" in extra:
        selectors.insert(0, {"type": "BlockSelector", "blockId": extra["block_id"]})
    return {"anchorVersion": 1, "targetKind": kind, "selectors": selectors}


def index_of(document: dict[str, Any], scratch: Path) -> PaperIndex:
    db = PaperTreeDb(str(scratch / "context.sqlite"))
    db.migrate()
    owner = db.create_user("owner@example.test").owner
    db.put_paper(owner, document)
    return PaperIndex.load(db, owner, PaperId(document["paper_id"]), generation(1))


@pytest.fixture
def fixture_index(tmp_path: Path) -> PaperIndex:
    return index_of(load_fixture("resnet-cvpr-2col"), tmp_path)


# ── the anchor ───────────────────────────────────────────────────────────────────────────────


def test_an_image_anchor_is_a_page_and_one_rectangle() -> None:
    assert image_box(anchor(1, (98.0, 78.0, 232.0, 156.0))) == (1, (98.0, 78.0, 232.0, 156.0))
    assert image_anchor.block_id_of(anchor(1, (1, 2, 3, 4), block_id=FIG2)) == FIG2
    assert image_anchor.block_id_of(anchor(1, (1, 2, 3, 4))) is None


@pytest.mark.parametrize(
    "bad",
    [
        {"targetKind": "text"},  # not an image kind
        {"selectors": []},  # no shape
        {"quads": []},  # no rectangle
        {"quads": [[1, 2, 3, 4], [5, 6, 7, 8]]},  # two
        {"quads": [[10, 10, 10, 50]]},  # no area
        {"quads": [[1, 2, 3, "4"]]},  # not numbers
        {"quads": [[1, 2, 3]]},  # not four
        {"quads": [[10, 10, 1e308, 1e308]]},  # finite, absurd: refused where it is written
        {"quads": [[10, 10, float("inf"), 50]]},  # not finite
        {"quads": [[10, 10, float("nan"), 50]]},
        {"quads": [[-1e7, 10, 50, 50]]},  # beyond the bound on the low side too
        {"quads": [[10, 10, 10**400, 50]]},  # an int too big for a float: no OverflowError
    ],
)
def test_anything_else_is_not_an_image_anchor(bad: dict[str, Any]) -> None:
    record = anchor(0, (1.0, 2.0, 30.0, 40.0))
    if "targetKind" in bad:
        record["targetKind"] = bad["targetKind"]
    if "selectors" in bad:
        record["selectors"] = bad["selectors"]
    if "quads" in bad:
        record["selectors"][1]["quads"] = bad["quads"]
    with pytest.raises(ValueError, match="anchor"):
        image_box(record)


def test_the_page_selector_and_the_shape_must_name_the_same_page() -> None:
    record = anchor(0, (1.0, 2.0, 30.0, 40.0))
    record["selectors"][0]["index"] = 3
    with pytest.raises(ValueError, match="PageSelector"):
        image_box(record)


# ── the float, its caption and its first mention (fixture) ───────────────────────────────────


def test_a_figure_anchor_names_its_float_and_gets_the_caption_by_edge(
    fixture_index: PaperIndex,
) -> None:
    context = image_context.image_context(
        fixture_index, anchor(1, (98.0, 78.0, 232.0, 156.0), "figure", block_id=FIG2)
    )
    assert (context.float_id, context.float_type, context.caption_id) == (FIG2, "figure", CAP2)
    assert context.label == "Figure 2"
    assert context.caption_text is None  # the whole block is the caption
    assert context.nearby_ids == ()


def test_the_first_mention_without_an_edge_is_the_first_body_paragraph_naming_the_label(
    fixture_index: PaperIndex,
) -> None:
    """The fixture has no ``references`` edge: the printed label finds the mention, and it is the
    LOWEST doc_order paragraph that says "Fig. 2" (never "Fig. 20", never the caption)."""
    context = image_context.image_context(
        fixture_index, anchor(1, (98.0, 78.0, 232.0, 156.0), "figure", block_id=FIG2)
    )
    assert context.mention_id == FIRST_MENTION_OF_FIG2
    block = fixture_index.block(FIRST_MENTION_OF_FIG2)
    assert block is not None and block.doc_order == 19
    naming = [
        b.doc_order
        for i in fixture_index.reading_order
        if (b := fixture_index.block(i)) is not None
        and b.type == "paragraph"
        and re.search(r"\bFig\. ?2(?![0-9a-z])", b.text)
        and b.doc_order is not None
    ]
    assert min(naming) == 19 and len(naming) > 1  # there ARE later mentions; the first is chosen


def test_references_edges_win_and_the_lowest_doc_order_source_is_the_first_mention(
    tmp_path: Path,
) -> None:
    """Edges are authoritative: with ``references`` edges into Figure 2 from a late paragraph, an
    early one, a caption and a footnote, the early PARAGRAPH is the mention (not the earliest by
    list position, not the caption, not the footnote)."""
    document = copy.deepcopy(load_fixture("resnet-cvpr-2col"))
    blocks = {b["block_id"]: b for b in document["blocks"]}
    paragraphs = sorted(
        (b for b in blocks.values() if b["type"] == "paragraph" and b.get("doc_order") is not None),
        key=lambda b: b["doc_order"],
    )
    plain = [b for b in paragraphs if not re.search(r"Fig", b["text"])]
    early, late = plain[2], plain[-1]  # neither names a figure: only the edge can pick them
    assert early["doc_order"] < late["doc_order"]
    assert early["doc_order"] != 19  # the label rule would pick 19: the edge must beat it
    footnote = next(b for b in blocks.values() if b["type"] == "footnote")
    for source in (late, footnote, blocks[CAP2], early):  # list order: the early one LAST
        document["relations"].append(
            {
                "type": "references",
                "from": source["block_id"],
                "to": FIG2,
                "confidence": 1.0,
                "provenance": "test",
            }
        )
    index = index_of(document, tmp_path)
    context = image_context.image_context(
        index, anchor(1, (98.0, 78.0, 232.0, 156.0), "figure", block_id=FIG2)
    )
    assert context.mention_id == early["block_id"]


def test_a_free_rectangle_inside_a_float_is_that_floats_context(fixture_index: PaperIndex) -> None:
    inside = image_context.image_context(fixture_index, anchor(1, (110.0, 90.0, 200.0, 140.0)))
    assert (inside.float_id, inside.caption_id, inside.mention_id) == (
        FIG2,
        CAP2,
        FIRST_MENTION_OF_FIG2,
    )
    # A rectangle that only brushes the float is not "of" it (under half inside, centre outside).
    brushing = image_context.image_context(fixture_index, anchor(1, (225.0, 70.0, 420.0, 90.0)))
    assert brushing.float_id is None


def test_a_rectangle_in_no_float_gets_the_nearest_text_blocks(fixture_index: PaperIndex) -> None:
    context = image_context.image_context(fixture_index, anchor(1, (60.0, 400.0, 280.0, 470.0)))
    assert context.float_id is None and context.caption_id is None and context.mention_id is None
    assert 1 <= len(context.nearby_ids) <= image_context.MAX_NEARBY
    for block_id in context.nearby_ids:
        block = fixture_index.block(block_id)
        assert block is not None and block.page_index == 1 and block.text.strip()
    assert list(context.nearby_ids) == sorted(context.nearby_ids, key=fixture_index.rank)
    # The nearest block to the box really is among them.
    box = (60.0, 400.0, 280.0, 470.0)
    on_page = [
        (image_context._gap(box, b.bbox), i)
        for i in fixture_index.reading_order
        if (b := fixture_index.block(i)) is not None
        and b.page_index == 1
        and b.type in image_context.NEARBY_TYPES
        and b.text.strip()
    ]
    assert min(on_page)[1] in context.nearby_ids


def test_the_seed_puts_the_caption_first_then_the_mention_each_labelled_and_marked(
    fixture_index: PaperIndex,
) -> None:
    context = image_context.image_context(
        fixture_index, anchor(1, (98.0, 78.0, 232.0, 156.0), "figure", block_id=FIG2)
    )
    seed = image_context.plan_image_seed(fixture_index, context, datamark=DATAMARK)
    assert seed.block_ids == (CAP2, FIRST_MENTION_OF_FIG2)
    labels = [label for _block, label, _text in seed.passages]
    assert labels[0].endswith("the figure's caption") and "p. 2" in labels[0]
    assert labels[1].endswith("where the paper first mentions the figure")
    for _block, _label, text in seed.passages:
        assert text.startswith(DATAMARK) and text.rstrip().endswith(DATAMARK)  # boundary marks
    assert seed.page_label == "p. 2" and seed.quote == ""
    caption = fixture_index.block(CAP2)
    assert caption is not None and "Residual learning" in seed.passages[0][2]
    # `paper: off` keeps the figure's own caption and drops every paragraph of the paper.
    off = image_context.plan_image_seed(
        fixture_index, context, datamark=DATAMARK, include_mention=False
    )
    assert off.block_ids == (CAP2,)


def test_a_selected_paragraph_rides_first_and_is_not_repeated(fixture_index: PaperIndex) -> None:
    context = image_context.image_context(
        fixture_index, anchor(1, (98.0, 78.0, 232.0, 156.0), "figure", block_id=FIG2)
    )
    text_anchor = {
        "targetKind": "text",
        "selectors": [{"type": "BlockSelector", "blockId": FIRST_MENTION_OF_FIG2}],
    }
    chosen = evidence.plan_seed(fixture_index, text_anchor, datamark=DATAMARK)
    seed = image_context.plan_image_seed(
        fixture_index, context, datamark=DATAMARK, with_text=chosen
    )
    assert seed.block_ids[0] == chosen.block_ids[0] == FIRST_MENTION_OF_FIG2
    assert seed.block_ids.count(FIRST_MENTION_OF_FIG2) == 1
    assert CAP2 in seed.block_ids and seed.quote == chosen.quote


def test_cut_ends_on_a_sentence_when_one_is_in_reach() -> None:
    text = "First sentence here. " * 30
    cut = image_context.cut(text, 300)
    assert len(cut) <= 300 and cut.endswith(".")
    assert image_context.cut("short words", 300) == "short words"
    assert image_context.cut("word " * 100, 50).endswith(" …")


# ── a REAL parse (corpus) ────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def real_index() -> Iterator[PaperIndex]:
    """``resnet-cvpr-2col.pdf`` parsed by the real pipeline and loaded as the API would."""
    with tempfile.TemporaryDirectory() as scratch:
        root = Path(scratch)
        paper_id = new_id("ppr")
        result = parse_document(
            RESNET_PDF, paper_id=paper_id, asset_root=root / "assets", config=ParserConfig()
        )
        document = result.paper.model_dump(mode="json", by_alias=True, exclude_unset=True)
        yield index_of(document, root)


@requires_corpus
def test_real_parse_figure_one_has_its_caption_by_edge_and_its_lowest_doc_order_mention(
    real_index: PaperIndex,
) -> None:
    """Figure 1 (page 0): the parser emits ``caption_of`` and several ``references`` edges. The
    mention is the lowest doc_order PROSE source among them (a footnote also points at Figure 5
    in this parse, which proves the prose filter is needed there; for Figure 1 it is the order)."""
    box = (309.0, 224.0, 545.0, 302.0)
    context = image_context.image_context(real_index, anchor(0, box))
    assert context.float_type == "figure" and context.page_index == 0
    caption = real_index.block(context.caption_id or "")
    assert caption is not None and caption.text.startswith("Figure 1.")
    assert context.label == "Figure 1"
    sources = [
        real_index.block(r.from_block)
        for r in real_index.relations_to(context.float_id or "")
        if r.type == "references"
    ]
    prose = [b for b in sources if b is not None and b.type in image_context.PROSE_TYPES]
    assert len(prose) >= 2, "this parse has at least two references edges into Figure 1"
    expected = min(prose, key=lambda b: (b.doc_order is None, b.doc_order or 0))
    assert context.mention_id == expected.block_id
    assert expected.doc_order == min(b.doc_order for b in prose if b.doc_order is not None)


@requires_corpus
def test_real_parse_figure_two_is_found_although_the_parser_gave_it_no_edges(
    real_index: PaperIndex,
) -> None:
    """Measured 2026-11-20: Figure 2's caption is a BODY PARAGRAPH ("identity F(x)+x / Figure 2.
    Residual learning: a building block.") with no ``caption_of`` edge, and no ``references`` edge
    points at its float. The selection still returns Figure 2's caption words and the first body
    paragraph that names it, found by the printed label."""
    box = (129.0, 85.0, 204.0, 154.0)
    context = image_context.image_context(real_index, anchor(1, box))
    assert context.float_type == "figure" and context.page_index == 1
    assert context.label == "Figure 2"
    assert context.caption_text is not None
    assert context.caption_text.startswith("Figure 2. Residual learning")
    assert not [r for r in real_index.relations_to(context.float_id or "")]  # still no edges
    mention = real_index.block(context.mention_id or "")
    assert mention is not None and mention.type == "paragraph" and mention.doc_order is not None
    assert re.search(r"\bFig(?:ure|\.)\s*2(?![0-9a-z])", mention.text)
    earlier = [
        b
        for i in real_index.reading_order
        if (b := real_index.block(i)) is not None
        and b.type == "paragraph"
        and b.doc_order is not None
        and b.doc_order < mention.doc_order
        and re.search(r"\bFig(?:ure|\.)\s*2(?![0-9a-z])", b.text)
        and i != context.caption_id
    ]
    assert earlier == []  # nothing earlier in the body names Figure 2
    seed = image_context.plan_image_seed(real_index, context, datamark=DATAMARK)
    assert seed.block_ids[:2] == (context.caption_id, context.mention_id)
    assert seed.passages[0][2].count("Residual") == 1 and "Figure 2." in seed.passages[0][2]
    assert image_context.image_caption_line(real_index, context).startswith("Figure 2.")
