"""#51's discriminator: a booktabs table ends where a HEAVY rule ends it.

`tables._group_rules` chained rules transitively while each was within `MAX_RULE_GAP_PT` (420 pt)
of the last, so gpt3 p50-p60 - a stack of boxed qualitative examples, each its own booktabs table
- collapsed into ONE region spanning `[72.0, 81.4, 540.0, 691.8]`, the whole text block, against
6 gold figures and 6 gold captions with a best same-type IoU of **0.000** for all twelve.

#51 records four discriminators measured and rejected before this one, and this module does not
re-derive them:

  * gap / row-pitch                 FALSE 4.0-37.5 vs GENUINE 3.5-30.0        overlapping
  * rule-spacing coefficient of variation
                                    FALSE 0.373-1.546 vs GENUINE 0.271-1.136  overlapping, and
                                    BACKWARDS - gpt3 p52/p59/p60 carry the most EVEN spacings
  * group height + column count     kills genuine a3c p12/p13 and gpt3 p27
  * prose share inside the group    FALSE 0.763-0.941 vs GENUINE 0.080-0.979  overlapping

A fifth was measured while writing this and also fails, recorded here so it is not tried again:
**the share of the group's rows that split into more than one cell.** FALSE 0.200-1.000 against
GENUINE 0.125-1.000 at >=2 cells, and 0.000-0.500 against 0.000-1.000 at >=3. a3c p13's genuine
table sits at 0.125, below every false group.

What separates them is not a statistic over the group at all. `\\heavyrulewidth` is 0.08em and
`\\lightrulewidth` is 0.05em: the rules that OPEN and CLOSE a booktabs table are heavy and every
rule inside it is light. Measured stroke widths, corpus-wide - gpt3 {0.797, 0.498}, superglue
{0.797, 0.498}, bert {0.873, 0.545, 0.398}, attention {0.996, 0.797, 0.398, 0.299}, a3c {0.996,
0.797, 0.398, 0.379} - every page bimodal, the modes 1.6-2.2x apart.

WHAT THIS MODULE DOES NOT EXERCISE. It does not test that the split IMPROVES the gold score;
`packages/evaluation/python/tests/eval/test_corpus_gold.py` owns that and holds the numbers to
equality. It tests only the grouping invariant and the two corpus shapes the invariant predicts.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from _corpus_manifest import CORPUS_DIR as CORPUS
from _corpus_manifest import requires_corpus
from papertree_document_worker.figures import is_caption_line
from papertree_document_worker.layout import layout_page
from papertree_document_worker.pdf import Drawing, SourceDocument
from papertree_document_worker.tables import (
    MIN_RULE_WIDTH_PT,
    MIN_RULE_WIDTH_SHARE,
    _group_rules,
    _is_horizontal_rule,
    detect_tables,
)

HEAVY = 0.797
LIGHT = 0.498


def _rule(y: float, width: float, x0: float = 72.0, x1: float = 540.0) -> Drawing:
    """One structural horizontal rule at `y`, `width` pt of stroke.

    `bbox` is zero-height because that is what MuPDF reports for a stroked line: every rule on
    every corpus page measured `h=0.00`, and the thickness lives in `width`, not in the rect.
    """
    return Drawing(
        bbox=[x0, y, x1, y],
        kind="s",
        stroke_opacity=1.0,
        fill_opacity=1.0,
        width=width,
        item_count=1,
        is_clip=False,
    )


def test_a_heavy_rule_closes_its_group_so_stacked_tables_stay_apart() -> None:
    """Two booktabs tables stacked with no gap cue: `H L H | H L H` is two tables, not one.

    This is gpt3 p59's exact shape at its exact coordinates. Under the old grouping all six
    rules were within `MAX_RULE_GAP_PT` of their predecessor and shared one x-range, so they
    chained into a single 611 pt region.

    MUTATION THAT TURNS THIS RED: delete `if heavy.get(id(rule)): closed.add(index)` from
    `_group_rules`. Watched: 1 group of 6 instead of 2 of 3.
    """
    rules = [
        _rule(80.6, HEAVY),
        _rule(135.6, LIGHT),
        _rule(150.7, HEAVY),
        _rule(194.8, HEAVY),
        _rule(259.7, LIGHT),
        _rule(274.8, HEAVY),
    ]
    groups = _group_rules(rules)
    assert [len(g) for g in groups] == [3, 3]
    assert [round(g[0].bbox[1], 1) for g in groups] == [80.6, 194.8]


def test_a_heavy_rule_that_opens_a_group_does_not_also_close_it() -> None:
    """`\\toprule` is heavy too. If a heavy rule closed on arrival, every table would be a
    one-rule group, `MIN_RULES` would drop it, and the corpus would lose every ruled table.

    MUTATION THAT TURNS THIS RED: close the group in the `else` arm too, so a heavy rule that
    STARTS a group closes it on arrival. Watched: 3 groups of 1, and `MIN_RULES` then drops all
    three - the same mutation also reds `test_genuine_tables_keep_every_rule_they_started_with`
    and the gpt3 p59 case.

    A mutation that does NOT turn it red, recorded so it is not mistaken for coverage: swapping
    the order of `group.append(rule)` and the `closed.add(index)` beside it. `closed` is only
    read at the top of the next iteration, so the two orderings are the same program.
    """
    groups = _group_rules([_rule(100.0, HEAVY), _rule(140.0, LIGHT), _rule(200.0, HEAVY)])
    assert [len(g) for g in groups] == [3]


def test_a_uniform_weight_page_is_grouped_exactly_as_before() -> None:
    """`\\hline` draws every rule at one width. There is then no heavy/light distinction to
    read, and closing on "heavy" would cut such a table into pairs.

    `_heavy_flags` returns `{}` for that page and the grouping falls through unchanged.

    MUTATION THAT TURNS THIS RED: drop the `if not all(flags.values())` guard from
    `_heavy_flags`. Watched: 3 groups of 2 instead of 1 group of 6.
    """
    groups = _group_rules([_rule(100.0 + 40 * i, 0.6) for i in range(6)])
    assert [len(g) for g in groups] == [6]


def test_the_split_is_driven_by_weight_and_not_by_the_gap() -> None:
    """The same six rules at the same y, with the weights flattened to light, stay one group.

    Anti-vacuity guard: without it `test_a_heavy_rule_closes_its_group...` would still pass if
    the implementation split on the y-gaps instead - which is the pitch discriminator #51 already
    measured and rejected.
    """
    ys = [80.6, 135.6, 150.7, 194.8, 259.7, 274.8]
    assert [len(g) for g in _group_rules([_rule(y, LIGHT) for y in ys])] == [6]


# ---------------------------------------------------------------------------------------------
# Caption openers. `[0-9]+|[IVXivx]+` could not match an APPENDIX label, so gpt3's 24 appendix
# figure captions fell through to the heading rule. See `figures._CAPTION_START`.
# ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Figure G.2: Formatted dataset example for ANLI R2", ("figure", "G.2")),
        ("Figure S3: supplementary", ("figure", "S3")),
        ("Figure A.1. An appendix figure", ("figure", "A.1")),
        ("Figure 3: the plain form still wins", ("figure", "3")),
        ("Table 1. also unchanged", ("table", "1")),
        ("Figure IV. roman still parses", ("figure", "IV")),
        # A bare capital is not a label: every alternative requires a digit.
        ("Figure S shows the layout", None),
        ("Figures are discussed below", None),
        ("The figure above", None),
    ],
)
def test_caption_openers_accept_appendix_labels_without_accepting_prose(
    text: str, expected: tuple[str, str] | None
) -> None:
    """MUTATION THAT TURNS THIS RED: restore `([0-9]+|[IVXivx]+)` in `_CAPTION_START`. Watched:
    the three appendix rows return None. The two negative rows are what stop the fix from being
    "match anything after the word Figure"."""
    assert is_caption_line(text) == expected


# ---------------------------------------------------------------------------------------------
# The corpus half. Both shapes the invariant predicts, on the pages #51 names.
# ---------------------------------------------------------------------------------------------


def _structural_rules(paper: str, pageno: int) -> tuple[list[Drawing], list[list[Drawing]]]:
    """The page's structural rules and the groups they form, at the pipeline's own threshold."""
    with SourceDocument(str(CORPUS / f"{paper}.pdf")) as doc:
        page = doc.page(pageno)
        columns = layout_page(page, heads=set()).columns
        column_width = columns[0].x1 - columns[0].x0
        candidates = [d for d in page.drawings if not d.is_clip and _is_horizontal_rule(d)]
        floor = max(MIN_RULE_WIDTH_PT, MIN_RULE_WIDTH_SHARE * column_width)
        structural = [d for d in candidates if (d.bbox[2] - d.bbox[0]) >= floor]
        return structural, [g for g in _group_rules(structural) if len(g) >= 2]


@requires_corpus
def test_gpt3_page_59_is_six_booktabs_groups_and_not_one_page_sized_table(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The worked example in #51. Gold draws 6 figures and 6 captions on this page; the parser
    drew ONE table over all of it.

    The assertion is on the count AND on the height, because six groups that each spanned the
    page would satisfy a count alone.

    MUTATION THAT TURNS THIS RED: delete the `closed` set from `_group_rules`. Watched: 1 group,
    height 610.9.
    """
    structural, groups = _structural_rules("gpt3-longform-singlecol", 59)
    heights = [round(g[-1].bbox[3] - g[0].bbox[1], 1) for g in groups]
    with capsys.disabled():
        print(
            f"\n[worker/rule-weight] gpt3 p59: {len(structural)} structural rules -> "
            f"{len(groups)} groups, heights {heights}"
        )
    assert len(groups) == 6
    assert max(heights) < 160.0, f"a group still spans most of the 611 pt page: {heights}"


@requires_corpus
@pytest.mark.parametrize(
    ("paper", "page", "expected"),
    [
        # `H L L L L L L L H` - superglue's 9-rule Table 1, one table, must NOT be cut into four.
        ("superglue-tableheavy", 3, [9]),
        # bert p6 holds three tables in two columns; each is `H L L L H` and each stays whole.
        ("bert-2col", 6, [5, 5, 5]),
        # ...and p8 holds two, in different columns. Two groups here is the right answer, not a
        # split: the rules do not share an x-range, so this exercises the pre-existing grouping
        # rather than the weight rule.
        ("bert-2col", 8, [5, 4]),
        # gpt3 p27 draws all four rules at ONE width (0.398). `_heavy_flags` returns `{}` and the
        # page is grouped exactly as before - the uniform-weight fallback, on real data.
        ("gpt3-longform-singlecol", 27, [4]),
    ],
)
def test_genuine_tables_keep_every_rule_they_started_with(
    paper: str, page: int, expected: list[int]
) -> None:
    """The other half of the discriminator, and the half every rejected candidate failed on.

    Each of these is a real table whose interior rules are light. A rule that split on weight
    without the open/close asymmetry - or one that read the weight on a uniform-width page -
    would cut all of them up.
    """
    _, groups = _structural_rules(paper, page)
    assert [len(g) for g in groups] == expected


@requires_corpus
def test_attention_page_8_no_longer_swallows_its_footnote_rule(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """A second, unlooked-for consequence, asserted because it is load-bearing.

    attention p8's rules run `H L L L L H | H` and then a narrow rule at y=709.3 - the footnote
    separator. Chaining put the footnote rule 465 pt below the bottomrule into the same table,
    so the region ran y=94.5..709.3, most of the page. Closing at the bottomrule leaves the
    table at its real extent and the footnote rule alone in a one-rule group that `MIN_RULES`
    drops.
    """
    with SourceDocument(str(CORPUS / "attention-is-all-you-need.pdf")) as doc:
        page = doc.page(8)
        layout = layout_page(page, heads=set())
        column_width = layout.columns[0].x1 - layout.columns[0].x0
        regions = detect_tables(page, column_width)
    ruled = [r for r in regions if r.rule_count >= 2]
    with capsys.disabled():
        print(
            f"\n[worker/rule-weight] attention p8 ruled regions: "
            f"{[(round(r.bbox[1], 1), round(r.bbox[3], 1)) for r in ruled]}"
        )
    assert ruled, "the page's one real table disappeared"
    assert max(r.bbox[3] for r in ruled) < 400.0, (
        "a ruled region still reaches the footnote separator at y=709.3"
    )


@requires_corpus
def test_gpt3_appendix_captions_are_captions_rather_than_headings(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The two changes are coupled and this is where the coupling is checked.

    Splitting the false table un-claims 24 lines reading `Figure G.N: ...`. Before the
    `_CAPTION_START` fix they were promoted by font weight and gpt3 went to **85** headings
    against `test_outline_floor`'s 2.1x bar on 32 bookmarked sections. They are captions.

    MUTATION THAT TURNS THIS RED: restore `([0-9]+|[IVXivx]+)` in `_CAPTION_START`. Watched:
    0 appendix captions, 85 headings.
    """
    from test_pipeline_end_to_end import _parse

    result = _parse(CORPUS / "gpt3-longform-singlecol.pdf", tmp_path)
    document = result.paper.model_dump(mode="json", by_alias=True)
    blocks = document["blocks"]
    headings = [b for b in blocks if b["type"] == "heading"]
    appendix = [
        b
        for b in blocks
        if b["type"] == "caption" and (b.get("text") or "").lstrip().startswith("Figure G.")
    ]
    with capsys.disabled():
        print(
            f"\n[worker/rule-weight] gpt3: {len(headings)} headings, "
            f"{len(appendix)} 'Figure G.N' captions"
        )
    assert len(appendix) >= 24, "the appendix captions are back in the heading stream"
    assert len(headings) <= 61, (
        f"{len(headings)} headings - the split un-claimed lines that are not captions either"
    )
