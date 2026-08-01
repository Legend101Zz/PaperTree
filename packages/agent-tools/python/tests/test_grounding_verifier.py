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
from _agent_tools_fixtures import run, seed_synthetic
from papertree_agent_tools import (
    DEFAULT_COVERAGE_THRESHOLD,
    STOPWORDS,
    ClaimEvidence,
    GroundedAnswer,
    ToolStatus,
    VerifiedClaim,
    build_registry,
    claim_coverage,
    content_tokens,
    verify_grounding,
)

REGISTRY = build_registry()

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
    """``grounding.py`` quotes 1.00 / 0.125 / 0.00. Recomputed here rather than trusted.

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
    assert round(paraphrase, 3) == 0.125
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


# ── through the tool, against a real parsed paper ────────────────────────────────────────


def test_verify_answer_grounding_flags_a_fabrication_against_a_real_document(
    tmp_path: Path,
) -> None:
    """End to end: real PDF, real parse, real handle, and the flagged claim survives the tool.

    The tool layer is where a filter would be easiest to slip in — "clean up the answer before
    returning it" — so the assertion is repeated at this level rather than trusted from the unit
    test above.
    """
    seeded = seed_synthetic(tmp_path / "verify")
    block_id = seeded.first_of_type("paragraph")
    with seeded.handle() as handle:
        result = run(
            REGISTRY.call(
                "verify_answer_grounding",
                {
                    "states": "The paper presents a residual learning framework.",
                    "interpretation": None,
                    "supporting_block_ids": [block_id],
                    "claims": [
                        {"text": "residual learning framework", "supported_by": [block_id]},
                        {
                            "text": "the model reaches 99.9 percent accuracy on ImageNet",
                            "supported_by": [block_id],
                        },
                    ],
                },
                context=seeded.context(handle),
            )
        )
    assert result.status is ToolStatus.OK
    claims = result.data["answer"]["claims"]
    assert len(claims) == 2, "the tool dropped a claim"
    assert claims[0]["supported"] is True
    assert claims[1]["supported"] is False
    assert "99.9" in claims[1]["reason"]
    assert result.data["claims_flagged"] == 1
    assert result.data["fully_grounded"] is False
    # The citation chips F3.6 needs, resolved from the answer's own block ids.
    assert result.data["resolved_source_regions"][0]["block_id"] == block_id
    assert len(result.data["resolved_source_regions"][0]["bbox"]) == 4


def test_verify_answer_grounding_refuses_a_draft_that_violates_the_contract(
    tmp_path: Path,
) -> None:
    """An ungrounded draft is REFUSED, never repaired into shape.

    The field a repair would invent is exactly the field the reader is being asked to trust.
    """
    seeded = seed_synthetic(tmp_path / "refuse")
    with seeded.handle() as handle:
        result = run(
            REGISTRY.call(
                "verify_answer_grounding",
                {
                    "states": "Something true.",
                    "interpretation": None,
                    "supporting_block_ids": ["blk_gone"],
                    "claims": [{"text": "a claim", "supported_by": []}],
                },
                context=seeded.context(handle),
            )
        )
    # The schema admits it (the ids are well-formed strings); the VERIFIER is what discovers the
    # blocks do not exist, and it flags rather than refuses. Refusal is for contract violations.
    assert result.status is ToolStatus.OK
    assert result.data["answer"]["claims"][0]["supported"] is False
    assert "blk_gone" in result.data["answer"]["claims"][0]["reason"]
