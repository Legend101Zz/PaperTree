"""The Rule of Two: all eight triples, enumerated, with exactly one of them forbidden.

The brief for this package asks for "RuleOfTwoViolation raises on (True, True, True) and on
nothing else — enumerate all 8 triples". Enumeration rather than sampling is the point: a
test that checks only the forbidden triple passes against an implementation that raises on
everything, and a test that checks only a couple of legal ones passes against an
implementation that raises on none.
"""

from __future__ import annotations

import dataclasses
import itertools

import pytest
from papertree_prompts import TOOLSETS, RuleOfTwoViolation, Toolset, TurnCaps, toolset_for

ALL_TRIPLES = tuple(itertools.product((False, True), repeat=3))
FORBIDDEN = (True, True, True)
LEGAL = tuple(t for t in ALL_TRIPLES if t != FORBIDDEN)


def test_there_are_eight_triples_and_exactly_one_is_forbidden() -> None:
    """Guards the enumeration itself, so the seven-vs-eight arithmetic below cannot drift."""
    assert len(ALL_TRIPLES) == 8
    assert len(LEGAL) == 7
    assert FORBIDDEN not in LEGAL


@pytest.mark.parametrize("triple", LEGAL)
def test_every_legal_triple_constructs(triple: tuple[bool, bool, bool]) -> None:
    caps = TurnCaps(*triple)
    assert caps.triple == triple


def test_the_forbidden_triple_raises() -> None:
    with pytest.raises(RuleOfTwoViolation):
        TurnCaps(True, True, True)


def test_the_forbidden_triple_raises_by_keyword_too() -> None:
    """The positional form is the documented one; the keyword form must not be a side door."""
    with pytest.raises(RuleOfTwoViolation):
        TurnCaps(untrusted_input=True, sensitive_scope=True, state_or_egress=True)


def test_rule_of_two_violation_is_not_a_value_error() -> None:
    """A control that a routine `except ValueError` can swallow is a control that fails green.

    §13.6(a) does not say what `RuleOfTwoViolation` derives from. It derives from `Exception`
    directly, because call sites wrap coercion and settings parsing in `except ValueError` as
    a habit and a Rule-of-Two violation caught by one of those disappears silently.
    """
    assert not issubclass(RuleOfTwoViolation, ValueError)
    assert not issubclass(RuleOfTwoViolation, TypeError)
    assert issubclass(RuleOfTwoViolation, Exception)


def test_the_violation_message_names_all_three_properties() -> None:
    """The exception is the only artefact a on-call engineer sees; it must say which rule."""
    with pytest.raises(RuleOfTwoViolation) as caught:
        TurnCaps(True, True, True)
    message = str(caught.value)
    for field in ("untrusted_input", "sensitive_scope", "state_or_egress"):
        assert field in message


def test_turn_caps_is_frozen_so_a_legal_turn_cannot_be_escalated_after_construction() -> None:
    """Validation in `__post_init__` is worthless if a field can be set afterwards.

    This is the realistic escalation path: a turn is built legally as (True, True, False) and
    something later decides it also needs egress. Frozen means that attempt raises rather
    than producing an object whose triple was never validated.
    """
    caps = TurnCaps(True, True, False)
    with pytest.raises(dataclasses.FrozenInstanceError):
        caps.state_or_egress = True  # type: ignore[misc]


# ── the toolset mapping ───────────────────────────────────────────────────────────────────


def test_toolsets_covers_every_constructible_triple_and_no_others() -> None:
    """Seven entries. A `KeyError` at a call site becomes a hand-picked toolset at that call
    site, which is the review-enforced arrangement the Rule of Two exists to replace."""
    assert set(TOOLSETS) == set(LEGAL)
    assert FORBIDDEN not in TOOLSETS


@pytest.mark.parametrize("triple", LEGAL)
def test_toolset_for_is_total_over_constructible_turns(triple: tuple[bool, bool, bool]) -> None:
    assert isinstance(toolset_for(TurnCaps(*triple)), Toolset)


def test_the_three_toolsets_named_in_the_brief_are_reproduced_verbatim() -> None:
    """§13.6(a)'s `TOOLSETS` literal, checked key by key rather than paraphrased."""
    assert TOOLSETS[(True, True, False)] is Toolset.READ_ONLY_MULTI_PAPER
    assert TOOLSETS[(True, False, False)] is Toolset.READ_ONLY_SINGLE_PAPER
    assert TOOLSETS[(False, True, True)] is Toolset.PRIVILEGED_NO_DOCUMENT_TEXT


def test_every_toolset_is_reachable_from_some_legal_turn() -> None:
    """No dead enum member. An unreachable toolset name reads as a supported configuration."""
    assert set(TOOLSETS.values()) == set(Toolset)


def test_no_two_triples_share_a_toolset() -> None:
    """Seven turns, seven toolsets: the audit log's toolset name identifies the triple."""
    assert len(set(TOOLSETS.values())) == len(TOOLSETS)


def test_the_ordinary_reading_turn_gets_no_cross_paper_tool() -> None:
    """§13.6(e) Attack 2's stopping point, as a property of the mapping rather than prose.

    "…the turn already holds [A] untrusted input + [B] the open paper, so
    TOOLSETS[(True, False, False)] is READ_ONLY_SINGLE_PAPER — the cross-paper retrieval tool
    is not in the model's tool list. It cannot call what it was never given."
    """
    reading_turn = TurnCaps(untrusted_input=True, sensitive_scope=False, state_or_egress=False)
    assert toolset_for(reading_turn) is Toolset.READ_ONLY_SINGLE_PAPER
    assert toolset_for(reading_turn) is not Toolset.READ_ONLY_MULTI_PAPER


def test_a_turn_that_reads_paper_text_and_the_library_cannot_also_write_or_send() -> None:
    """§13.6(b): "A turn that reads paper text has [A] + [B] and therefore no [C]"."""
    assert toolset_for(TurnCaps(True, True, False)) is Toolset.READ_ONLY_MULTI_PAPER
    with pytest.raises(RuleOfTwoViolation):
        TurnCaps(True, True, True)


def test_the_paper_memory_write_turn_is_legal_and_has_no_library_reach() -> None:
    """(True, False, True) is §13.6(b) row 1 — "PAPER: Autonomous agent write: Yes".

    It looks alarming and it is inside the rule: the attacker who fully controls the model
    can write provenance-stamped memory for the paper they already control, and reach nothing
    else, because the turn holds no sensitive scope.
    """
    caps = TurnCaps(untrusted_input=True, sensitive_scope=False, state_or_egress=True)
    assert toolset_for(caps) is Toolset.WRITE_SINGLE_PAPER_NO_LIBRARY
    assert caps.sensitive_scope is False


def test_toolset_values_are_plain_strings_for_the_package_boundary() -> None:
    """`packages/agent-tools` owns the registry; this package must not hold tool objects."""
    for toolset in Toolset:
        assert isinstance(toolset, str)
        assert toolset.value == toolset.name
