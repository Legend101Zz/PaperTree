"""F3.5's answer contract, and its alignment with the TypeScript twin that already shipped.

The contract's whole value is that it makes specific unfalsifiable things falsifiable
(findings.md C4: v1's response schema had no block ids at all, so nothing in it could be
checked and nothing was). So the tests here are mostly about what the contract REFUSES to
represent — an answer with no supporting blocks, an interpretation that is an empty string, an
unsupported claim with no reason — because each of those is a way for an ungrounded answer to
look grounded.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
from papertree_agent_tools import (
    ANSWER_SCHEMA,
    CITATION_TARGET_TYPES,
    UNVERIFIED_REASON,
    AnswerContractError,
    GroundedAnswer,
    SourceRegion,
    ToolArgumentError,
    VerifiedClaim,
    answer_from_mapping,
    answer_to_wire,
    target_type_for_block_type,
    validate_arguments,
)

REPO = Path(__file__).resolve().parents[4]
TWIN = REPO / "apps" / "web" / "src" / "components" / "inspector" / "types.ts"


def _answer(**overrides: Any) -> GroundedAnswer:
    fields: dict[str, Any] = {
        "states": "The paper presents a residual learning framework.",
        "interpretation": None,
        "supporting_block_ids": ("blk_a",),
        "source_pages": (0,),
        "source_regions": (),
        "confidence": 0.8,
        "unresolved_ambiguities": (),
        "claims": (
            VerifiedClaim(text="residual learning", supported_by=("blk_a",), supported=True),
        ),
    }
    fields.update(overrides)
    return GroundedAnswer(**fields)


# ── the twin ─────────────────────────────────────────────────────────────────────────────


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def test_every_python_field_has_the_camel_case_field_the_inspector_declares() -> None:
    """Mechanical, not by eye. Two implementations of one schema drift silently otherwise.

    There is no code path between the two — nothing serves PaperIR over HTTP yet (#62) — so this
    assertion is the only thing keeping them aligned until an endpoint exists, at which point it
    is the thing that has to keep passing.

    It FAILS rather than skips when ``types.ts`` is missing: the twin's absence is exactly the
    drift being watched for, and a skip would report it as a pass.
    """
    assert TWIN.exists(), (
        f"{TWIN} is gone. The Python answer contract has no counterpart to align with, which "
        "means one of the two implementations was deleted or moved without the other."
    )
    source = TWIN.read_text(encoding="utf-8")
    for field in (
        "states",
        "interpretation",
        "supporting_block_ids",
        "source_pages",
        "source_regions",
        "confidence",
        "unresolved_ambiguities",
        "claims",
    ):
        assert re.search(rf"\breadonly {_camel(field)}\b", source), field
    for field in ("text", "supported_by", "supported", "reason"):
        assert re.search(rf"\breadonly {_camel(field)}\b", source), field


def test_the_six_citation_target_types_match_the_twins_union() -> None:
    source = TWIN.read_text(encoding="utf-8")
    match = re.search(r"export type CitationTargetType =([^;]+);", source)
    assert match is not None
    declared = {value.strip().strip("'") for value in match.group(1).split("|")}
    assert declared == set(CITATION_TARGET_TYPES)


# ── the serialiser that is now the code path between them (#76) ──────────────────────────


def test_the_wire_object_is_as_dict_with_every_key_camel_cased() -> None:
    """The mapping asserted MECHANICALLY, against the same names the test above reads out of
    ``types.ts``.

    ``_camel`` here is this file's own independent implementation of the rule; ``answer_to_wire``
    has ``answer.camel_case``. Comparing the two means a bug would have to be present in both.
    """
    answer = _answer(
        interpretation="our reading",
        source_regions=(
            SourceRegion(
                block_id="blk_a",
                page_index=2,
                bbox=(1.0, 2.0, 3.0, 4.0),
                target_type="figure",
                label="p3 · figure",
            ),
        ),
        unresolved_ambiguities=("which dataset split",),
    )
    wire = answer_to_wire(answer)
    assert list(wire) == [_camel(key) for key in answer.as_dict()]
    # NESTED keys too — those are the ones a hand-written per-field table drops, because they are
    # one level down from the ones anybody looks at.
    assert set(wire["claims"][0]) == {"text", "supportedBy", "supported", "reason"}
    assert set(wire["sourceRegions"][0]) == {
        "blockId",
        "pageIndex",
        "bbox",
        "targetType",
        "label",
    }
    assert wire["supportingBlockIds"] == ["blk_a"]
    assert wire["sourceRegions"][0]["pageIndex"] == 2


def test_every_wire_key_is_a_field_the_inspector_actually_declares() -> None:
    """The serialiser's output checked against the TWIN, not against this file's expectations.

    ``test_every_python_field_has_the_camel_case_field_the_inspector_declares`` reads the field
    list from a literal here; this reads it from what the function EMITS. A field added to
    ``GroundedAnswer`` and forgotten in ``types.ts`` fails here without anyone editing a list.
    """
    source = TWIN.read_text(encoding="utf-8")
    for key in answer_to_wire(_answer()):
        assert re.search(rf"\breadonly {key}\b", source), f"types.ts declares no `{key}`"


def test_the_wire_source_regions_are_addresses_and_the_twin_says_they_are_citations() -> None:
    """The one field that is NOT a clean twin, asserted so nobody assigns the wire object across.

    ``types.ts``'s ``sourceRegions`` is ``Citation[]`` — anchor plus resolution — and
    ``@papertree/anchoring`` is TypeScript-only, so Python emits the ADDRESS an anchor is minted
    from. ``apps/web/src/components/inspector/liveAnswerSource.ts`` is the conversion. If this
    ever stops being true, the two sides have silently agreed on different things.
    """
    source = TWIN.read_text(encoding="utf-8")
    assert re.search(r"readonly sourceRegions: readonly Citation\[\]", source)
    region = answer_to_wire(
        _answer(source_regions=(SourceRegion(block_id="blk_a", page_index=0, bbox=(0, 0, 1, 1)),))
    )["sourceRegions"][0]
    assert "anchor" not in region and "resolution" not in region


# ── what the contract refuses to represent ───────────────────────────────────────────────


def test_an_answer_with_no_supporting_blocks_cannot_be_constructed() -> None:
    """The single rule the whole contract exists for.

    ``types.ts``: *"Non-empty for any answer that renders. ``DerivedBlock`` enforces this at
    runtime."* Same direction here — an ungrounded answer must fail to exist rather than render
    unattributed.
    """
    with pytest.raises(AnswerContractError, match="supporting_block_ids"):
        _answer(supporting_block_ids=())


def test_an_answer_with_no_states_cannot_be_constructed() -> None:
    with pytest.raises(AnswerContractError, match="`states`"):
        _answer(states="   ")


def test_interpretation_is_none_or_non_empty_and_never_the_empty_string() -> None:
    """Three encodings of "there is none" is two too many.

    An empty string renders as a labelled, empty derived register in the UI — a visible claim
    that we interpreted something, with nothing in it.
    """
    assert _answer(interpretation=None).interpretation is None
    assert _answer(interpretation="our reading").interpretation == "our reading"
    with pytest.raises(AnswerContractError, match="interpretation"):
        _answer(interpretation="")


def test_confidence_outside_zero_to_one_is_refused() -> None:
    for bad in (-0.1, 1.1):
        with pytest.raises(AnswerContractError, match="confidence"):
            _answer(confidence=bad)


def test_an_unsupported_claim_must_carry_a_reason() -> None:
    """A flag the reader cannot interpret is a flag the reader ignores."""
    with pytest.raises(AnswerContractError, match="no reason"):
        VerifiedClaim(text="something", supported=False, reason=None)


def test_a_claim_with_no_text_is_refused() -> None:
    with pytest.raises(AnswerContractError, match="must have text"):
        VerifiedClaim(text="  ", supported=True)


def test_a_source_region_with_an_invented_target_type_is_refused() -> None:
    with pytest.raises(AnswerContractError, match="target_type"):
        SourceRegion(block_id="blk_a", page_index=0, bbox=(0, 0, 1, 1), target_type="diagram")


# ── open vocabularies bucket rather than raise ───────────────────────────────────────────


def test_block_types_bucket_into_the_six_and_an_unknown_type_is_other_not_a_crash() -> None:
    """``Block.type`` is an OPEN vocabulary — any ``^[a-z][a-z0-9_]{0,63}$`` string is valid.

    A future parser emitting ``theorem`` must produce a citable answer, not an exception in the
    middle of rendering an answer the reader is waiting for.
    """
    assert target_type_for_block_type("inline_equation") == "equation"
    assert target_type_for_block_type("table_cell") == "table"
    assert target_type_for_block_type("title") == "heading"
    assert target_type_for_block_type("theorem") == "other"
    assert set(CITATION_TARGET_TYPES) >= {
        target_type_for_block_type(t) for t in ("figure", "paragraph", "theorem")
    }


# ── round trip ───────────────────────────────────────────────────────────────────────────


def test_a_draft_claim_with_no_verdict_gets_the_unverified_placeholder() -> None:
    """A DRAFT is unsupported-and-unexplained by definition, and that is the one legitimate case.

    The placeholder is what keeps ``VerifiedClaim``'s invariant true for it, instead of the
    invariant being weakened for every claim.
    """
    answer = answer_from_mapping(
        {
            "states": "x",
            "interpretation": None,
            "supporting_block_ids": ["blk_a"],
            "claims": [{"text": "a claim", "supported_by": ["blk_a"]}],
        }
    )
    assert answer.claims[0].supported is False
    assert answer.claims[0].reason == UNVERIFIED_REASON


def test_as_dict_round_trips_through_answer_from_mapping() -> None:
    original = _answer(
        interpretation="our reading",
        source_regions=(
            SourceRegion(
                block_id="blk_a", page_index=2, bbox=(1.0, 2.0, 3.0, 4.0), target_type="figure"
            ),
        ),
        unresolved_ambiguities=("which dataset split",),
    )
    assert answer_from_mapping(original.as_dict()) == original


def test_as_dict_key_order_is_fixed_so_two_runs_diff() -> None:
    assert list(_answer().as_dict()) == [
        "states",
        "interpretation",
        "supporting_block_ids",
        "source_pages",
        "source_regions",
        "confidence",
        "unresolved_ambiguities",
        "claims",
    ]


def test_unsupported_claims_is_a_view_and_never_a_filter() -> None:
    answer = _answer(
        claims=(
            VerifiedClaim(text="kept", supported_by=("blk_a",), supported=True),
            VerifiedClaim(text="flagged", supported=False, reason="no overlap"),
        )
    )
    assert len(answer.claims) == 2
    assert len(answer.unsupported_claims) == 1
    assert answer.fully_grounded is False


# ── the schema the tool actually validates against ───────────────────────────────────────


def test_the_answer_schema_accepts_a_minimal_draft_and_fills_its_defaults() -> None:
    validated = validate_arguments(
        "verify_answer_grounding",
        ANSWER_SCHEMA,
        {
            "states": "x",
            "interpretation": None,
            "supporting_block_ids": ["blk_a"],
            "claims": [{"text": "a claim", "supported_by": ["blk_a"]}],
        },
    )
    assert validated["source_pages"] == []
    assert validated["confidence"] == 0.5
    assert validated["claims"][0]["supported"] is False


def test_the_answer_schema_refuses_an_answer_with_no_supporting_blocks() -> None:
    """Refused at the SCHEMA layer as well as at the dataclass layer.

    Two gates on purpose: the schema one produces a message a model can correct from before any
    handler runs, and the dataclass one holds for every Python caller that never went through a
    tool.
    """
    with pytest.raises(ToolArgumentError, match="minimum is 1"):
        validate_arguments(
            "verify_answer_grounding",
            ANSWER_SCHEMA,
            {
                "states": "x",
                "interpretation": None,
                "supporting_block_ids": [],
                "claims": [{"text": "a claim", "supported_by": []}],
            },
        )


def test_the_answer_schema_refuses_an_unknown_field() -> None:
    with pytest.raises(ToolArgumentError, match="unknown argument"):
        validate_arguments(
            "verify_answer_grounding",
            ANSWER_SCHEMA,
            {
                "states": "x",
                "interpretation": None,
                "supporting_block_ids": ["blk_a"],
                "claims": [{"text": "c", "supported_by": ["blk_a"]}],
                "sources": ["blk_a"],
            },
        )
