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

from statistics import median

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
    """`apps/api/.env` carries OPENROUTER_API_KEY with a TEXT model configured.

    A fallback to it would accept this call shape and return confident nonsense, so there is
    none: no key means unavailable, and unavailable means the equation keeps its crop with no
    `latex`. That is a valid document, not a failure.
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
