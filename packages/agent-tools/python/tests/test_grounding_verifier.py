"""F3.5's grounding verifier: it FLAGS, it never deletes, and it is honest about what it misses.

EPIC-03 §4: *"When grounding verification fails, the claim is flagged, not deleted and not
silently emitted."*

The tempting wrong implementation drops unsupported claims, and its output looks better than the
right one's: every claim in it is grounded. So the central test asserts BOTH halves — the
fabricated claim is still present AND it is marked — because the "is it marked" half passes for
the filtering implementation too (it marks the claims it kept), and the "is it present" half
passes for an implementation that marks nothing.

The second thing this file does is MEASURE the verifier's blind spots rather than describe them.
``grounding.py``'s docstring says negation is invisible; the test below computes both coverages
and asserts they are equal, so that sentence is a fact in the suite. If a future implementation
learns to see negation, this test fails and forces the docstring to be rewritten — which is the
correct outcome, and is why it is phrased as an equality rather than as a bound.
"""

from __future__ import annotations

from _agent_tools_fixtures import Seeded
from papertree_agent_tools import (
    DEFAULT_COVERAGE_THRESHOLD,
    ClaimEvidence,
    claim_coverage,
    content_tokens,
    load_paper_view,
)

#: The paragraph the synthetic paper carries, quoted here so the coverage numbers in
#: ``grounding.py``'s docstring are computable from this file alone.
BLOCK = (
    "Deep networks are more diﬁcult to train.\n"
    "We present a residual learning framework\n"
    "that eases the training of networks that are\n"
    "substantially deeper than those used before.\n"
    "We evaluate residual nets with a depth of up\n"
    "to 152 layers on the ImageNet dataset [3]."
)
TEXTS = {"blk_a": BLOCK}


# ── the rule ─────────────────────────────────────────────────────────────────────────────


# ── the measured coverages the threshold sits between ────────────────────────────────────


def test_the_three_coverages_the_docstring_quotes_are_the_ones_this_code_produces() -> None:
    """``grounding.py`` quotes 1.00 / 0.167 / 0.00. Recomputed here rather than trusted.

    AGENTS.md §2: *"Numbers get re-derived, not quoted."* If the tokeniser or the stopword list
    changes, this fails and the docstring has to be corrected — which is the only way a number
    in a comment stays true.
    """
    evidence = ClaimEvidence({"blk_a": frozenset(content_tokens(BLOCK))}, ())
    verbatim, _ = claim_coverage(
        "We present a residual learning framework that eases the training of networks", evidence
    )
    paraphrase, _ = claim_coverage(
        "The authors introduce a shortcut-connection architecture simplifying optimisation of "
        "very deep models",
        evidence,
    )
    fabricated, _ = claim_coverage(
        "Transformers replace recurrence entirely with self-attention over token sequences",
        evidence,
    )
    assert verbatim == 1.0
    assert round(paraphrase, 3) == 0.167
    assert fabricated == 0.0
    assert fabricated < paraphrase < DEFAULT_COVERAGE_THRESHOLD < verbatim


# ── the blind spots, measured ────────────────────────────────────────────────────────────


# ── the number rule ──────────────────────────────────────────────────────────────────────


# ── citations that do not resolve ────────────────────────────────────────────────────────


# ── deterministic and offline ────────────────────────────────────────────────────────────


# ── against a real parsed paper, through the read-only handle ────────────────────────────


def _resolved_text(seeded: Seeded) -> dict[str, str]:
    """``block_id -> resolved text`` exactly as the API's ``evidence.py`` builds it: from the
    index's ``IndexedBlock.text`` (``resolved_text``, never ``text`` plus ``repairs`` by hand)."""
    with seeded.handle() as handle:
        view = load_paper_view(handle, seeded.paper_id, seeded.generation)
        return {
            block_id: block.text
            for block_id in view.index.reading_order
            if (block := view.index.block(block_id)) is not None
        }


# ── S5F: normalisation and the three verdicts ────────────────────────────────────────────


def test_the_pdfs_typesetting_is_folded_before_words_are_compared() -> None:
    """A text layer says ``classiﬁer`` and ``prob- lem``; a claim says ``classifier`` and
    ``problem``. They are the same words (NFKC, line-break hyphens joined, plurals stemmed)."""
    from papertree_agent_tools import content_tokens

    block = "Systems repurpose classiﬁers. This is a regression prob-\nlem for bounding-box boxes."
    assert content_tokens("A classifier") == content_tokens("classiﬁers") == ("classifier",)
    evidence = ClaimEvidence({"b": frozenset(content_tokens(block))}, ())
    covered, missing = claim_coverage("classifier problem bounding box", evidence)
    assert (covered, missing) == (1.0, ())


def test_a_hyphenated_compound_is_covered_by_its_words_and_numbers_are_never_stemmed() -> None:
    from papertree_agent_tools import content_tokens

    assert content_tokens("self-attention layers 152") == ("self-attention", "layer", "152")
    evidence = ClaimEvidence({"b": frozenset(content_tokens("attention for self supervision"))}, ())
    assert evidence.contains("self-attention")
    assert not evidence.contains("self-regression")


def test_the_three_verdicts() -> None:
    from papertree_agent_tools import CONTRADICTION_FLOOR, assess_claim

    evidence = ClaimEvidence({"blk_a": frozenset(content_tokens(BLOCK))}, ())
    supported = assess_claim(
        "We present a residual learning framework that eases training", evidence
    )
    # Reuses some of the passage's words and adds its own: commentary, neither grounded nor refuted.
    neutral = assess_claim(
        "This residual framework is, in my reading, a notable shift in how people build networks",
        evidence,
    )
    invented = assess_claim(
        "Transformers replace recurrence entirely with self-attention over token sequences",
        evidence,
    )
    wrong_number = assess_claim(
        "They evaluate residual nets with a depth of up to 999 layers", evidence
    )
    too_short = assess_claim("Why that matters", evidence)
    assert supported.verdict == "supported"
    assert neutral.verdict == "neutral" and CONTRADICTION_FLOOR <= neutral.coverage < 0.6
    assert invented.verdict == "unsupported" and invented.coverage < CONTRADICTION_FLOOR
    assert wrong_number.verdict == "unsupported" and wrong_number.missing_numbers == ("999",)
    assert too_short.verdict == "neutral" and too_short.content_words < 3


def test_subscripts_and_superscripts_do_not_invent_a_number() -> None:
    """NFKC would fold ``σ²₁`` to ``σ21`` and the claim would "state" the number 21 (found on the
    held-out DDPM answers: a faithful sentence about the discrete decoder was called unsupported).
    Only ligatures are expanded."""
    from papertree_agent_tools import assess_claim

    block = "the discrete decoder N(x0; µθ(x1, 1), σ2 1 I) at the last step of the reverse process"
    claim = (
        "The last step of the reverse process uses the discrete decoder N(x₀; µ_θ(x₁, 1), σ²₁ I)"
    )
    evidence = ClaimEvidence({"b": frozenset(content_tokens(block))}, ())
    assert "21" not in content_tokens(claim)
    assert assess_claim(claim, evidence).missing_numbers == ()


def test_a_reference_to_the_papers_own_structure_is_not_a_number_to_find() -> None:
    """ "Section 4.2", "Eq. (14)", "Table 2": the number names a place and the cited block rarely
    carries it. A real statistic next to it is still checked."""
    from papertree_agent_tools import assess_claim

    block = "We compare the sample quality effects of reverse process parameterizations."
    evidence = ClaimEvidence({"b": frozenset(content_tokens(block))}, ())
    assert (
        assess_claim(
            "Section 4.2 compares the sample quality effects (Eq. 14)", evidence
        ).missing_numbers
        == ()
    )
    assert content_tokens("see Table 2 and Figure 3a") == ("see",)
    wrong = assess_claim("Table 2 shows a sample quality of 94.2 percent", evidence)
    assert wrong.missing_numbers == ("94.2",) and wrong.verdict == "unsupported"


def test_words_that_talk_about_the_paper_do_not_count_as_missing_content() -> None:
    """ "The authors also note several choices" is framing: counting `authors`, `note` and
    `several` made every framing sentence look invented. Invented content is still invented."""
    from papertree_agent_tools import assess_claim

    block = "We ablate the choices of reverse process parameterization and training objective."
    evidence = ClaimEvidence({"b": frozenset(content_tokens(block))}, ())
    assert assess_claim("The authors also ablate several choices", evidence).verdict == "supported"
    invented = assess_claim(
        "The authors also recommend anchor pyramids and language decoders", evidence
    )
    assert invented.verdict == "unsupported"
