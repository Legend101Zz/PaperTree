"""F3.1's registry: introspection, validation-before-execution, and the Rule of Two.

Every test here runs without a database. That is the property being asserted as much as anything
else: a registry that needed a handle to describe itself would be a registry with a tenant baked
into it, and the runtime could not hand a model a tool list before opening a connection.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest
from papertree_agent_tools import (
    ANNOTATION_KEYWORDS,
    CONSTRAINT_KEYWORDS,
    TOOL_NAMES,
    SchemaError,
    ToolArgumentError,
    ToolRegistry,
    ToolResult,
    ToolSpec,
    ToolStatus,
    UnknownToolError,
    build_registry,
    check_schema,
    validate_arguments,
)
from papertree_prompts import Toolset, TurnCaps, toolset_for


async def _noop(context: Any, arguments: Mapping[str, Any]) -> ToolResult:
    del context
    return ToolResult(tool="noop", status=ToolStatus.OK, data=dict(arguments))


def _spec(name: str = "noop", **overrides: Any) -> ToolSpec:
    fields: dict[str, Any] = {
        "name": name,
        "description": "a tool",
        "parameters": {"type": "object", "additionalProperties": False, "properties": {}},
        "handler": _noop,
    }
    fields.update(overrides)
    return ToolSpec(**fields)


# ── the eighteen tools ───────────────────────────────────────────────────────────────────


def test_registry_holds_exactly_the_eighteen_tools_the_epic_names() -> None:
    registry = build_registry()
    assert registry.names() == tuple(sorted(TOOL_NAMES))
    assert len(registry) == 18


def test_every_tool_is_introspectable_without_a_database() -> None:
    registry = build_registry()
    for name in registry.names():
        schema = registry.schema(name)
        assert schema["type"] == "object"
        assert registry.spec(name).description.strip()
        # Every schema is one the validator fully enforces. `register` already checked this;
        # re-checking here is what makes the claim survive a future change to `register`.
        check_schema(schema, where=name)


def test_unknown_tool_raises_rather_than_returning_a_result() -> None:
    registry = build_registry()
    with pytest.raises(UnknownToolError):
        registry.spec("get_page_pixels")


def test_a_duplicate_name_is_refused_instead_of_silently_replacing() -> None:
    registry = ToolRegistry()
    registry.register(_spec())
    with pytest.raises(ValueError, match="already registered"):
        registry.register(_spec())


def test_a_tool_with_no_description_is_refused() -> None:
    registry = ToolRegistry()
    with pytest.raises(ValueError, match="no description"):
        registry.register(_spec(description="   "))


def test_a_tool_belonging_to_no_toolset_is_refused() -> None:
    registry = ToolRegistry()
    with pytest.raises(ValueError, match="no toolset"):
        registry.register(_spec(toolsets=frozenset()))


# ── the schema validator: the unenforceable-keyword rule ─────────────────────────────────


def test_a_schema_keyword_the_validator_cannot_enforce_is_refused_at_registration() -> None:
    """The load-bearing rule of ``schema.py``.

    ``multipleOf`` is real JSON Schema and is NOT implemented. If ``check_schema`` merely ignored
    it, this schema would register, the constraint would read as enforced in review, and
    ``{"n": 3}`` would pass. FAILED ON PURPOSE ONCE: with the ``unknown`` check deleted from
    ``check_schema`` this test failed at the ``pytest.raises`` line, confirming it is the
    rejection being asserted and not some other error in the same schema.
    """
    registry = ToolRegistry()
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"n": {"type": "integer", "multipleOf": 5}},
    }
    with pytest.raises(SchemaError, match="multipleOf"):
        registry.register(_spec(parameters=schema))
    assert "multipleOf" not in CONSTRAINT_KEYWORDS
    assert "multipleOf" not in ANNOTATION_KEYWORDS


def test_a_default_that_violates_its_own_schema_is_refused_at_registration() -> None:
    with pytest.raises(ToolArgumentError):
        check_schema(
            {
                "type": "object",
                "properties": {"radius": {"type": "integer", "default": "two"}},
            }
        )


def test_required_naming_an_undeclared_property_is_refused() -> None:
    with pytest.raises(SchemaError, match="not in properties"):
        check_schema({"type": "object", "properties": {}, "required": ["block_id"]})


def test_additional_properties_true_is_refused_because_it_would_state_an_unapplied_policy() -> None:
    with pytest.raises(SchemaError, match="additionalProperties"):
        check_schema({"type": "object", "additionalProperties": True, "properties": {}})


# ── the validator: values ────────────────────────────────────────────────────────────────

_RADIUS: Mapping[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["block_id"],
    "properties": {
        "block_id": {"type": "string", "minLength": 1},
        "radius": {"type": "integer", "minimum": 1, "maximum": 10, "default": 2},
    },
}


def test_true_is_not_an_integer_even_though_python_says_it_is() -> None:
    """``isinstance(True, int)`` is True in CPython — the trap ``_json_type_name`` exists for.

    Without the ``bool`` branch ordered before ``int``, ``{"radius": true}`` validates and the
    handler receives ``radius == 1`` with nothing raised anywhere. FAILED ON PURPOSE ONCE: with
    the ``isinstance(value, bool)`` branch removed from ``_json_type_name`` this test failed,
    which is what makes it a test of the ordering rather than of the constant.
    """
    assert isinstance(True, int)  # the premise, asserted so the test cannot rot silently
    with pytest.raises(ToolArgumentError, match="expected integer, got boolean"):
        validate_arguments("t", _RADIUS, {"block_id": "blk_x", "radius": True})


def test_a_float_is_not_an_integer_and_is_not_coerced() -> None:
    with pytest.raises(ToolArgumentError, match="expected integer, got number"):
        validate_arguments("t", _RADIUS, {"block_id": "blk_x", "radius": 2.0})


def test_defaults_are_filled_so_the_schema_and_the_code_cannot_disagree() -> None:
    assert validate_arguments("t", _RADIUS, {"block_id": "blk_x"})["radius"] == 2


def test_bounds_are_enforced() -> None:
    with pytest.raises(ToolArgumentError, match="above the maximum"):
        validate_arguments("t", _RADIUS, {"block_id": "blk_x", "radius": 99})
    with pytest.raises(ToolArgumentError, match="0 characters"):
        validate_arguments("t", _RADIUS, {"block_id": ""})


def test_an_unknown_argument_is_refused_and_the_message_lists_the_real_ones() -> None:
    with pytest.raises(ToolArgumentError, match="unknown argument"):
        validate_arguments("t", _RADIUS, {"block_id": "blk_x", "radiuss": 2})


def test_a_missing_required_argument_is_refused() -> None:
    with pytest.raises(ToolArgumentError, match="is required"):
        validate_arguments("t", _RADIUS, {})


def test_array_bounds_are_enforced_which_is_what_the_embedding_length_rests_on() -> None:
    schema: Mapping[str, Any] = {
        "type": "object",
        "properties": {
            "embedding": {
                "type": "array",
                "minItems": 768,
                "maxItems": 768,
                "items": {"type": "number"},
            }
        },
    }
    with pytest.raises(ToolArgumentError, match="minimum is 768"):
        validate_arguments("t", schema, {"embedding": [0.0, 1.0]})


def test_a_nullable_type_union_accepts_both_members_and_nothing_else() -> None:
    schema: Mapping[str, Any] = {
        "type": "object",
        "properties": {"interpretation": {"type": ["string", "null"]}},
    }
    assert validate_arguments("t", schema, {"interpretation": None})["interpretation"] is None
    assert validate_arguments("t", schema, {"interpretation": "x"})["interpretation"] == "x"
    with pytest.raises(ToolArgumentError, match="one of"):
        validate_arguments("t", schema, {"interpretation": 3})


# ── the Rule of Two, enforced by the registry rather than by review ──────────────────────


def test_every_tool_is_available_to_the_ordinary_reading_turn() -> None:
    registry = build_registry()
    caps = TurnCaps(untrusted_input=True, sensitive_scope=False, state_or_egress=False)
    assert toolset_for(caps) is Toolset.READ_ONLY_SINGLE_PAPER
    assert registry.for_toolset(Toolset.READ_ONLY_SINGLE_PAPER) == registry.names()


def test_no_tool_is_available_to_a_turn_with_no_document_text() -> None:
    """A turn that is not reading a paper gets NO tools from this registry.

    Every tool here reads paper content, so ``NO_TOOLS`` and the metadata-only toolsets resolve
    to an empty list. The model is then told the tools are ABSENT rather than withheld, which is
    what ``build_system_prompt`` promises it.
    """
    registry = build_registry()
    assert registry.for_toolset(Toolset.NO_TOOLS) == ()
    assert registry.for_toolset(Toolset.PRIVILEGED_NO_DOCUMENT_TEXT) == ()


def test_there_is_no_tool_in_a_write_toolset_because_the_handle_cannot_write() -> None:
    registry = build_registry()
    assert registry.for_toolset(Toolset.WRITE_SINGLE_PAPER_NO_LIBRARY) == ()
    assert registry.for_toolset(Toolset.WRITE_NO_DOCUMENT_TEXT_NO_LIBRARY) == ()


def test_the_forbidden_capability_triple_cannot_be_constructed_at_all() -> None:
    """Belt and braces on ``papertree_prompts``: this registry has no path to an (A,B,C) turn.

    The exception type matters and is asserted: ``RuleOfTwoViolation`` does NOT derive from
    ``ValueError``, so a runtime wrapping turn construction in ``except ValueError`` cannot
    swallow it.
    """
    from papertree_prompts import RuleOfTwoViolation

    with pytest.raises(RuleOfTwoViolation):
        TurnCaps(untrusted_input=True, sensitive_scope=True, state_or_egress=True)
    assert not issubclass(RuleOfTwoViolation, ValueError)


# ── result shape ─────────────────────────────────────────────────────────────────────────


def test_a_non_ok_result_cannot_be_constructed_without_a_reason() -> None:
    """The single invariant the whole honesty argument rests on.

    A bare ``[]`` with ``status='empty'`` and no reason is what a model reads as "I looked and
    there are none". Making it unconstructible is stronger than documenting it.
    """
    for status in (
        ToolStatus.EMPTY,
        ToolStatus.NOT_FOUND,
        ToolStatus.UNAVAILABLE,
        ToolStatus.REFUSED,
    ):
        with pytest.raises(ValueError, match="must carry a reason"):
            ToolResult(tool="t", status=status, data={"items": []})


def test_an_ok_result_cannot_carry_a_reason() -> None:
    with pytest.raises(ValueError, match="must not carry a reason"):
        ToolResult(tool="t", status=ToolStatus.OK, reason="everything is fine")


def test_result_serialises_with_a_fixed_key_order() -> None:
    payload = ToolResult(tool="t", status=ToolStatus.OK, data={"a": 1}).as_dict()
    assert list(payload) == ["tool", "status", "reason", "data"]


# ── the registry is framework-free, which is the whole of F3.1 ───────────────────────────


def test_no_agent_framework_is_reachable_from_the_registry_or_the_tools() -> None:
    """``registry.py`` and ``tools.py`` import no framework, transitively, at any depth.

    Asserted over ``sys.modules`` AFTER importing both, so it catches an indirect import through
    a helper as well as a direct one. ``importlib`` alone would not: a lazy import inside
    ``runtime.py`` is fine and must stay fine, which is why ``runtime`` is not imported here.
    """
    import subprocess
    import sys

    source = (
        "import sys\n"
        "import papertree_agent_tools.registry, papertree_agent_tools.tools\n"
        "banned = {'pydantic_ai', 'openai', 'httpx', 'requests', 'jsonschema', 'anthropic'}\n"
        "print(sorted(banned & {m.split('.')[0] for m in sys.modules}))\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", source], capture_output=True, text=True, check=True
    )
    assert result.stdout.strip() == "[]", result.stdout
