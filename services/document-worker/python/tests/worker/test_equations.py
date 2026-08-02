"""F1.7 - `worker/equations.spec`'s first clause: prose is NEVER classified as an equation.

findings.md B1 is the defect. The old classifier was **100 % font-driven** - of 86 lines ResNet
called math, 86 came from the typeface and 0 from symbol content; Neural ODEs 574 of 574. The
`MATH_FONTS` list contained `cmr` and `latinmodern`, the body fonts of most LaTeX papers, and
the font test sat INSIDE the per-character loop so one span made every character in it math.
68.3 % of Neural ODEs' blocks were classified as math.

`equations.py` reads **no font name at all**, and this suite is what holds that: the four
verbatim false positives measured in B1 are asserted here by name, and the thresholds are the
ones derived from the fixtures' own labelled blocks rather than from taste.

WHAT THIS SUITE DOES NOT CLAIM. `worker/equations.spec` also requires "detected equations >= 80 %
of gold" and "every equation retains its crop". Neither is asserted, because neither is met:
against the neural-odes fixture's 5 hand-labelled display equations on pages 0-2 the detector
returns 13 regions, 7 of them math inside Algorithm 1 rather than standalone equations. That is
recorded in EPIC-01-PROGRESS.md, not papered over here.
"""

from __future__ import annotations

import tempfile
from collections.abc import Sequence
from pathlib import Path
from statistics import median
from typing import Any

import pytest
from _corpus_manifest import CORPUS_DIR as CORPUS
from _corpus_manifest import requires_corpus
from papertree_document_worker.equations import (
    MIN_SEED_DENSITY,
    detect_equation_regions,
    is_probably_prose,
    symbol_density,
)
from papertree_document_worker.layout import layout_document
from papertree_document_worker.pdf import SourceDocument
from papertree_document_worker.pipeline import _extend_to_right_margin, _right_text_margins
from papertree_document_worker.vlm import (
    LATEX_PROMPT,
    NOT_MATH,
    VlmBudget,
    VlmClient,
    _clean,
    prompt_hash,
)

#: findings.md B1's measured false positives, VERBATIM. Each was classified as math by the old
#: extractor purely because of its typeface.
B1_FALSE_POSITIVES = [
    "where t ∈{0 . . . T} and ht ∈RD. These iterative",
    "[T1, T2, ..., Tn] from d with PDF Miner or OCR",
    "side is in {224, 256, 384, 480, 640}).",
    "LayerNorm(x + Sublayer(x)), where Sublayer(x) is the function implemented by the sub-layer",
]


@pytest.mark.parametrize("text", B1_FALSE_POSITIVES)
def test_findings_b1_false_positives_are_never_equations(text: str) -> None:
    """The regression, stated as the criterion: none of these may reach a detector at all.

    Two independent mechanisms have to agree, because either alone leaves a gap:
      * the PROSE VETO catches three of the four;
      * the DENSITY GATE catches the fourth - `side is in {224, 256, 384, 480, 640}).` has only
        one four-letter word, but zero mathematical characters.
    """
    vetoed = is_probably_prose(text)
    gated = symbol_density(text) < MIN_SEED_DENSITY
    assert vetoed or gated, (
        f"neither the prose veto nor the density gate rejects {text!r} "
        f"(prose={vetoed}, density={symbol_density(text):.3f})"
    )


def test_symbol_density_counts_characters_not_typefaces() -> None:
    """The whole design, in one assertion pair: identical text, different notional font."""
    assert symbol_density("The quick brown fox jumped over it") == 0.0
    assert symbol_density("2015 and 224 and 640") == 0.0, "digits are not mathematics"
    assert symbol_density("∂L/∂θ = −a(t)ᵀ∇f") > 0.2
    # U+2212 MINUS is mathematical; ASCII hyphen in a compound word is not.
    assert symbol_density("x − 1") > symbol_density("state-of-the-art")


def test_prose_veto_needs_two_ordinary_words() -> None:
    assert is_probably_prose("where the mapping is defined")
    assert not is_probably_prose("dh(t)")
    assert not is_probably_prose("= f(h(t), t, θ)")
    # One word is not enough - `\max` and `subject` appear inside real equations.
    assert not is_probably_prose("argmax f(x)")


@requires_corpus
def test_a_math_heavy_paper_yields_equation_regions_and_a_prose_paper_far_fewer() -> None:
    """A weak but real end-to-end check: the detector must track how much math a paper has.

    Deliberately a RATIO rather than an absolute count. There is no gold to score an absolute
    against, and inventing a threshold that today's implementation happens to hit is how a test
    becomes a tautology that never fails.
    """

    def regions_per_page(name: str) -> float:
        with SourceDocument(CORPUS / name) as document:
            pages = document.pages()
            layout = layout_document(pages)
            total = 0
            for page_layout in layout.pages:
                body = [
                    line
                    for block in page_layout.blocks
                    if block.flow == "body"
                    for line in block.lines
                ]
                sizes = [s.size for line in body for s in line.spans if s.size > 0]
                width = page_layout.columns[0].x1 - page_layout.columns[0].x0
                total += len(detect_equation_regions(body, width, median(sizes) if sizes else 10.0))
            return total / len(pages)

    math_heavy = regions_per_page("neural-odes-mathheavy.pdf")
    table_heavy = regions_per_page("superglue-tableheavy.pdf")
    assert math_heavy > 3 * table_heavy, (
        f"the math-heavy paper should carry far more equations than the table-heavy one "
        f"({math_heavy:.1f} vs {table_heavy:.1f} per page)"
    )


# ── the VLM boundary ───────────────────────────────────────────────────────────────────────


def test_the_vlm_client_is_unavailable_without_a_key_and_never_falls_back() -> None:
    """No key means unavailable, and unavailable means the equation keeps its crop with no
    `latex`. That is a valid document, not a failure.

    The client reads its OWN key and its OWN model. It never inherits a general "which LLM are
    we using" setting, because a text model accepts this call's shape and answers anyway.
    """
    client = VlmClient(api_key=None)
    assert not client.available
    assert client.read_equation(b"not-a-real-png", VlmBudget(max_calls=10)) is None


def test_the_budget_is_a_hard_stop() -> None:
    client = VlmClient(api_key="test-key-not-used")
    budget = VlmBudget(max_calls=0)
    assert budget.exhausted
    # Returns None WITHOUT making a request - if it tried, this would raise a network error.
    assert client.read_equation(b"png", budget) is None
    assert budget.calls == 0


def test_prompt_hash_covers_the_model_and_the_token_cap() -> None:
    """A prompt digest that ignores the model would claim two experiments were one."""
    base = prompt_hash(LATEX_PROMPT, "MiniMax-M3", 512)
    assert base.startswith("sha256:") and len(base) == len("sha256:") + 64
    assert base != prompt_hash(LATEX_PROMPT, "MiniMax-M2", 512), "model must be in the digest"
    assert base != prompt_hash(LATEX_PROMPT, "MiniMax-M3", 256), "token cap must be in the digest"
    assert base != prompt_hash(LATEX_PROMPT + " ", "MiniMax-M3", 512)
    assert base == VlmClient(api_key="x").prompt_digest


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("\\frac{a}{b}", "\\frac{a}{b}"),
        ("$$\\frac{a}{b}$$", "\\frac{a}{b}"),
        ("\\[\\frac{a}{b}\\]", "\\frac{a}{b}"),
        ("```latex\n\\frac{a}{b}\n```", "\\frac{a}{b}"),
        (NOT_MATH, None),
        ("", None),
        ("   ", None),
    ],
)
def test_the_cleaner_strips_wrappers_and_nothing_else(raw: str, expected: str | None) -> None:
    """It removes fences and delimiters. It must NOT rewrite the body - a stored `latex` that no
    model actually produced is worse than a wrong one, because it is unattributable."""
    assert _clean(raw) == expected


# ── extents, not counts: the right-margin extension (issue #55) ─────────────────────────────
#
# `worker/equations.spec` also asks for "detected equations >= 80 % of gold". The count half was
# closed by `pipeline._merge_equation_blocks` (89 -> 21 predicted against 21 gold corpus-wide);
# the EXTENT half is what these cover. Gold boxes a display equation across the measure of its
# column INCLUDING its right-margin number and the parser boxed the glyph bands, which was worth
# 0 matches at IoU 0.5 against all 21 gold equations.
#
# The scored consequence lives in `packages/evaluation/python/tests/eval/test_corpus_gold.py`,
# which is the only place in the repo that scores the corpus against gold. These assert the
# MECHANISM, and specifically the one property the measurement cannot see: that the change is
# horizontal, and within horizontal, right-edge-only.


def test_the_margin_extension_moves_the_right_edge_and_nothing_else() -> None:
    """x1 only. y0, y1 and - the load-bearing one - x0 are returned untouched.

    Measured on `neural-odes-mathheavy` p14's 17 gold equations: right edges cluster in a 24 pt
    band (507.06-531.54 for 14 of 17) and LEFT edges scatter over 214 pt (109.14-323.22), because
    a centred display equation is left where its glyphs are. A symmetric extension would over-box
    9 of 17 on the left.
    """
    bands = [[100.0, 10.0, 200.0, 20.0], [150.0, 25.0, 300.0, 35.0]]
    out = _extend_to_right_margin(bands, 504.0)
    assert [b[0] for b in out] == [100.0, 150.0], "x0 must never move"
    assert [b[1] for b in out] == [10.0, 25.0]
    assert [b[3] for b in out] == [20.0, 35.0]
    assert [b[2] for b in out] == [504.0, 504.0]


def test_a_band_already_past_the_margin_is_left_alone() -> None:
    """The extension only ever grows a box. A band wider than the quantile - the stray wide line
    the quantile exists to ignore - must not be TRIMMED back to it, which would be a silent loss
    of geometry dressed as a fix."""
    assert _extend_to_right_margin([[100.0, 0.0, 550.0, 10.0]], 504.0) == [
        [100.0, 0.0, 550.0, 10.0]
    ]


def test_no_margin_is_a_no_op_rather_than_a_substituted_default() -> None:
    """A page with no body line has no measurable margin, and `None` must return the bands
    unchanged rather than fall back to some page-derived constant.

    WHAT THIS DOES NOT EXERCISE, AND HOW THAT WAS FOUND. It was first written as "collapsing to
    0.0 would drag every right edge to the page's left edge", and the mutation
    `if margin is None: margin = 0.0` **stayed green**. It cannot do otherwise: the extension is
    `max(band[2], margin)`, so ANY substitute at or below a band's own right edge is already a
    no-op and this assertion cannot see it. The dangerous substitute is a LARGE one - a page
    width, a column partition's `x1`, the 612.0 that `_right_text_margins` exists to avoid using
    - so that is what the second half asserts, and it is the half the mutation kills.
    """
    bands = [[100.0, 0.0, 200.0, 10.0]]
    assert _extend_to_right_margin(bands, None) == bands
    assert _extend_to_right_margin(bands, 612.0) == [[100.0, 0.0, 612.0, 10.0]], (
        "the guard must be on `margin is None` and nothing else - if a substituted default can "
        "reach this line, `None` reaches it too"
    )


class TestRightTextMargins:
    """`_right_text_margins` reads the TEXT, not the column partition."""

    @staticmethod
    def _layout(blocks: Sequence[tuple[str, int | None, list[float]]]) -> Any:
        # `Sequence`, not `list`: a `list[tuple[str, int, ...]]` built at a call site is not a
        # `list[tuple[str, int | None, ...]]` because `list` is invariant, and widening the
        # parameter is the fix rather than annotating every caller.
        class _Line:
            def __init__(self, band: list[float]) -> None:
                self.band = band

        class _Block:
            def __init__(self, flow: str, column: int | None, bands: list[list[float]]) -> None:
                self.flow = flow
                self.column = column
                self.lines = [_Line(b) for b in bands]

        class _Layout:
            def __init__(self, blocks: list[Any]) -> None:
                self.blocks = blocks

        grouped: dict[tuple[str, int | None], list[list[float]]] = {}
        for flow, column, band in blocks:
            grouped.setdefault((flow, column), []).append(band)
        return _Layout([_Block(f, c, bands) for (f, c), bands in grouped.items()])

    def test_a_column_takes_the_margin_of_its_own_body_lines(self) -> None:
        layout = self._layout(
            [("body", 0, [0.0, float(i), 286.0, float(i) + 8.0]) for i in range(20)]
            + [("body", 1, [300.0, float(i), 545.0, float(i) + 8.0]) for i in range(20)]
        )
        margins = _right_text_margins(layout)
        assert margins[0] == 286.0
        assert margins[1] == 545.0

    def test_a_full_width_block_takes_the_widest_margin_on_the_page(self) -> None:
        layout = self._layout(
            [("body", 0, [0.0, float(i), 286.0, float(i) + 8.0]) for i in range(20)]
            + [("body", 1, [300.0, float(i), 545.0, float(i) + 8.0]) for i in range(20)]
        )
        assert _right_text_margins(layout)[None] == 545.0

    def test_one_stray_wide_line_does_not_move_the_margin(self) -> None:
        """A QUANTILE, NOT A MAXIMUM. Measured on `resnet-cvpr-2col` p0: column 0's body lines
        have a p50 right edge of 286.37 and a **maximum of 441.78** - the title, set across the
        measure on a page whose body is two columns. Taking the maximum would run every equation
        on such a page 155 pt past the text."""
        layout = self._layout(
            [("body", 0, [0.0, float(i), 286.0, float(i) + 8.0]) for i in range(20)]
            + [("body", 0, [0.0, 99.0, 441.78, 107.0])]
        )
        assert _right_text_margins(layout)[0] == 286.0

    def test_furniture_is_not_text(self) -> None:
        """A running head spans the measure and is not body text. Letting it set the margin would
        make the margin the page's, not the column's."""
        layout = self._layout(
            [("body", 0, [0.0, float(i), 286.0, float(i) + 8.0]) for i in range(20)]
            + [("header", None, [0.0, 40.0, 560.0, 50.0])] * 20
        )
        assert _right_text_margins(layout)[0] == 286.0
        assert _right_text_margins(layout)[None] == 286.0


@requires_corpus
def test_equation_extents_reach_the_right_margin_and_keep_their_own_left_edge() -> None:
    """End to end on the page the whole item is about, against the real parser.

    `neural-odes-mathheavy` p14 is the densest display-math page in the corpus: 17 gold
    equations, of which the parser emits 8 blocks. Two properties, and the second is the one no
    scored number can distinguish from the first:

      * every emitted `equation` block reaches the column's right text margin - which is what
        picks up the `(35)` that sits out there in a block of its own;
      * the left edges still SCATTER. Measured 2026-08-03 on those 8 blocks: right edges all
        504.00 (spread 0.00) against left edges 115.23-265.92 (spread 150.69). A symmetric
        extension would collapse the second number to 0.00 too, and gold does not support it -
        p14's 17 gold left edges scatter over 214 pt.
    """
    from papertree_document_worker.pipeline import ParserConfig, parse_document

    with tempfile.TemporaryDirectory() as assets:
        result = parse_document(
            CORPUS / "neural-odes-mathheavy.pdf",
            paper_id="ppr_0123456789ABCDEFGHJKMNP0TV",
            asset_root=Path(assets),
            config=ParserConfig(),
        )
    document = result.paper.model_dump(mode="json", by_alias=True)

    with SourceDocument(CORPUS / "neural-odes-mathheavy.pdf") as source:
        layout = layout_document(source.pages())
    margin = _right_text_margins(layout.pages[14])[0]

    equations = [b for b in document["blocks"] if b["type"] == "equation" and b["page_index"] == 14]
    assert equations, "p14 is the display-math page; zero equation blocks means detection broke"
    lefts = [b["bbox"][0] for b in equations]
    rights = [b["bbox"][2] for b in equations]

    assert min(rights) >= margin - 0.01, (
        f"an equation stops at {min(rights):.2f} against a right text margin of {margin:.2f} - "
        "the extension did not run"
    )
    assert max(rights) - min(rights) <= 0.01, (
        f"right edges spread {max(rights) - min(rights):.2f} pt; they should all sit at the "
        "column's right text margin"
    )
    assert max(lefts) - min(lefts) > 100.0, (
        f"left edges spread only {max(lefts) - min(lefts):.2f} pt across {len(equations)} "
        f"equations ({sorted(round(x, 2) for x in lefts)}). A centred display equation is left "
        "where its glyphs are, so a tight spread means the left edge was extended too - which "
        "over-boxes 9 of p14's 17 gold equations"
    )
