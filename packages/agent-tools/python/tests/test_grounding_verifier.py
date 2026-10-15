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

import socket
from pathlib import Path
from typing import Any

import pytest
from _agent_tools_fixtures import Seeded, seed_synthetic
from papertree_agent_tools import (
    DEFAULT_COVERAGE_THRESHOLD,
    STOPWORDS,
    UNVERIFIED_REASON,
    ClaimEvidence,
    GroundedAnswer,
    VerifiedClaim,
    claim_coverage,
    content_tokens,
    load_paper_view,
    verify_grounding,
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


def _answer(claims: tuple[VerifiedClaim, ...], **overrides: Any) -> GroundedAnswer:
    fields: dict[str, Any] = {
        "states": "The paper presents a residual learning framework.",
        "interpretation": None,
        "supporting_block_ids": ("blk_a",),
        "source_pages": (0,),
        "source_regions": (),
        "confidence": 0.8,
        "unresolved_ambiguities": (),
        "claims": claims,
    }
    fields.update(overrides)
    return GroundedAnswer(**fields)


def _draft(text: str, cited: tuple[str, ...] = ("blk_a",)) -> VerifiedClaim:
    return VerifiedClaim(text=text, supported_by=cited, supported=False, reason="draft")


# ── the rule ─────────────────────────────────────────────────────────────────────────────


def test_an_unsupported_claim_is_kept_and_marked_and_not_filtered_out() -> None:
    """The rule, asserted in both halves.

    FAILED ON PURPOSE ONCE: with ``verify_grounding``'s comprehension changed to
    ``tuple(c for c in ... if c.supported)`` — the filtering implementation — this test failed on
    the ``len(verified.claims) == 2`` line while every "is it marked" assertion below still
    passed. That is what makes the presence half load-bearing rather than decorative.
    """
    grounded = _draft("residual learning framework")
    fabricated = _draft("Transformers replace recurrence entirely with self-attention")
    verified = verify_grounding(_answer((grounded, fabricated)), TEXTS)

    assert len(verified.claims) == 2
    assert [claim.text for claim in verified.claims] == [grounded.text, fabricated.text]
    assert verified.claims[0].supported is True
    assert verified.claims[1].supported is False
    assert verified.claims[1].reason is not None
    assert "content words" in verified.claims[1].reason
    assert verified.fully_grounded is False
    # And the flagged claim is reachable BOTH ways: through the view and through the full list.
    assert verified.unsupported_claims == (verified.claims[1],)


def test_the_number_of_claims_never_changes_however_many_are_flagged() -> None:
    claims = tuple(_draft(f"claim {n} about nothing in this paper at all") for n in range(6))
    verified = verify_grounding(_answer(claims), TEXTS)
    assert len(verified.claims) == 6
    assert all(not claim.supported for claim in verified.claims)


def test_the_answers_own_fields_are_carried_through_untouched() -> None:
    original = _answer(
        (_draft("residual learning framework"),),
        interpretation="our reading",
        unresolved_ambiguities=("which dataset split",),
        confidence=0.42,
    )
    verified = verify_grounding(original, TEXTS)
    assert verified.states == original.states
    assert verified.interpretation == "our reading"
    assert verified.unresolved_ambiguities == ("which dataset split",)
    assert verified.confidence == 0.42


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


def test_a_correct_paraphrase_is_flagged_and_that_is_the_safe_direction() -> None:
    """A false positive, asserted as one. It is the direction to fail in: the claim is still
    shown, marked, with a reason the reader can judge — as opposed to a false negative, which
    would silently bless a fabrication."""
    verified = verify_grounding(
        _answer(
            (
                _draft(
                    "The authors introduce a shortcut-connection architecture simplifying "
                    "optimisation of very deep models"
                ),
            )
        ),
        TEXTS,
    )
    assert verified.claims[0].supported is False
    assert "paraphrase" in (verified.claims[0].reason or "")


# ── the blind spots, measured ────────────────────────────────────────────────────────────


def test_negation_is_invisible_to_this_check_and_the_docstring_says_so() -> None:
    """The most consequential limitation, asserted as an EQUALITY.

    ``never`` is in :data:`STOPWORDS`, so "the framework eases X" and "the framework never eases
    X" produce the same token bag and therefore the same verdict. Keeping the negators OUT of the
    stopword list would flag every claim containing "not" against text that does not use the
    word — a false-positive rate high enough that a reader learns to ignore the flag.

    Written as ``==`` on purpose: if a future implementation learns to see negation, this test
    fails and forces ``grounding.py``'s honesty paragraph to be rewritten rather than left stale.
    """
    assert "never" in STOPWORDS and "not" in STOPWORDS
    affirmed = "The framework eases the training of networks that are substantially deeper"
    negated = "The framework never eases the training of networks that are substantially deeper"
    evidence = ClaimEvidence({"blk_a": frozenset(content_tokens(BLOCK))}, ())
    assert content_tokens(affirmed) == content_tokens(negated)
    assert claim_coverage(affirmed, evidence) == claim_coverage(negated, evidence)

    verified = verify_grounding(_answer((_draft(affirmed), _draft(negated))), TEXTS)
    assert verified.claims[0].supported == verified.claims[1].supported is True


# ── the number rule ──────────────────────────────────────────────────────────────────────


def test_a_fabricated_number_is_flagged_even_though_coverage_is_high() -> None:
    """0.83 coverage — above the threshold — and still flagged, by the separate number rule.

    This is the whole justification for that rule being separate: a twelve-word claim with one
    wrong digit scores comfortably above any threshold that does not also flag honest claims.
    """
    evidence = ClaimEvidence({"blk_a": frozenset(content_tokens(BLOCK))}, ())
    claim = "They evaluate residual nets with a depth of up to 999 layers"
    coverage, missing = claim_coverage(claim, evidence)
    assert coverage > DEFAULT_COVERAGE_THRESHOLD
    assert missing == ("999",)

    verified = verify_grounding(_answer((_draft(claim),)), TEXTS)
    assert verified.claims[0].supported is False
    assert "999" in (verified.claims[0].reason or "")


def test_the_correct_number_passes_so_the_rule_is_not_flagging_every_digit() -> None:
    claim = "They evaluate residual nets with a depth of up to 152 layers"
    verified = verify_grounding(_answer((_draft(claim),)), TEXTS)
    assert verified.claims[0].supported is True


# ── citations that do not resolve ────────────────────────────────────────────────────────


def test_a_claim_citing_a_block_that_does_not_exist_is_flagged_and_the_reason_names_it() -> None:
    """A stale block id survives a re-parse and resolves to nothing — it must not read as OK."""
    verified = verify_grounding(
        _answer((_draft("residual learning framework", cited=("blk_gone",)),)), TEXTS
    )
    assert verified.claims[0].supported is False
    assert "blk_gone" in (verified.claims[0].reason or "")


def test_a_claim_citing_nothing_falls_back_to_the_answers_supporting_blocks() -> None:
    """Without the fallback, a model that cites at the answer level gets EVERY claim flagged.

    A verifier that flags everything is a verifier the reader turns off, which is a worse outcome
    than a verifier that occasionally uses the answer's own citation list.
    """
    verified = verify_grounding(_answer((_draft("residual learning framework", cited=()),)), TEXTS)
    assert verified.claims[0].supported is True
    assert verified.claims[0].supported_by == ("blk_a",)


# ── deterministic and offline ────────────────────────────────────────────────────────────


def test_two_runs_produce_byte_identical_output() -> None:
    answer = _answer(
        (
            _draft("residual learning framework"),
            _draft("Transformers replace recurrence entirely"),
            _draft("depth of up to 152 layers"),
        )
    )
    first = verify_grounding(answer, TEXTS).as_dict()
    second = verify_grounding(answer, TEXTS).as_dict()
    assert first == second


def test_the_verifier_runs_with_the_network_physically_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No model call, asserted by removing the ability to make one.

    Stronger than grepping the source: it would catch a network call reached through any import
    at any depth. ``socket.socket`` is what every HTTP client in the standard library ends at.
    """

    def _no_sockets(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("the grounding verifier opened a socket")

    monkeypatch.setattr(socket, "socket", _no_sockets)
    verified = verify_grounding(
        _answer((_draft("residual learning framework"), _draft("invented nonsense claim"))), TEXTS
    )
    assert verified.claims[0].supported is True
    assert verified.claims[1].supported is False


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


def test_a_fabrication_is_flagged_against_a_real_document(tmp_path: Path) -> None:
    """End to end on a real parse: real PDF, real parser, real handle, and the flagged claim
    survives. (Until the reader release this went through the registry's
    ``verify_answer_grounding`` tool; the registry is gone and the API calls the verifier
    directly, so this does too.)"""
    seeded = seed_synthetic(tmp_path / "verify")
    block_id = seeded.first_of_type("paragraph")
    verified = verify_grounding(
        _answer(
            (
                VerifiedClaim(
                    text="residual learning framework",
                    supported_by=(block_id,),
                    reason=UNVERIFIED_REASON,
                ),
                VerifiedClaim(
                    text="the model reaches 99.9 percent accuracy on ImageNet",
                    supported_by=(block_id,),
                    reason=UNVERIFIED_REASON,
                ),
            ),
            supporting_block_ids=(block_id,),
        ),
        _resolved_text(seeded),
    )
    assert len(verified.claims) == 2, "the verifier dropped a claim"
    assert verified.claims[0].supported is True
    assert verified.claims[1].supported is False
    assert verified.claims[1].reason is not None and "99.9" in verified.claims[1].reason
    assert verified.fully_grounded is False


def test_a_claim_citing_a_block_this_generation_lacks_is_flagged_not_refused(
    tmp_path: Path,
) -> None:
    """A stale block id (a survivor from another generation) is FLAGGED with the id named."""
    seeded = seed_synthetic(tmp_path / "stale")
    verified = verify_grounding(
        _answer(
            (VerifiedClaim(text="a claim", supported_by=("blk_gone",), reason=UNVERIFIED_REASON),),
            supporting_block_ids=("blk_gone",),
        ),
        _resolved_text(seeded),
    )
    assert verified.claims[0].supported is False
    assert verified.claims[0].reason is not None and "blk_gone" in verified.claims[0].reason


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


def test_a_neutral_claim_is_not_reported_supported_by_verify_grounding() -> None:
    """The boolean the answer contract carries is True only for the `supported` verdict."""
    claim = (
        "This residual framework is, in my reading, a notable shift in how people build networks"
    )
    verified = verify_grounding(_answer((_draft(claim),)), TEXTS)
    assert verified.claims[0].supported is False


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
