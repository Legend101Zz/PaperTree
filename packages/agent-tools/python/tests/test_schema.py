"""``schema.py``: the 14-keyword JSON Schema subset, which REFUSES what it cannot enforce.

These tests lived in ``test_registry.py`` until the reader release deleted the registry (slice-plan
§R R10). ``schema.py`` is KEPT — ``packages/evaluation``'s grounding scorer checks its question
files with it — so its tests are kept too, moved here unchanged except that the "refused at
registration" case calls ``check_schema`` directly instead of going through ``ToolRegistry``.
A kept module whose tests were deleted with a neighbour is a module nobody is checking.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest
from papertree_agent_tools import (
    ANNOTATION_KEYWORDS,
    CONSTRAINT_KEYWORDS,
    SchemaError,
    ToolArgumentError,
    check_schema,
    validate_arguments,
)

# ── the schema validator: the unenforceable-keyword rule ─────────────────────────────────


def test_a_schema_keyword_the_validator_cannot_enforce_is_refused() -> None:
    """The load-bearing rule of ``schema.py``.

    ``multipleOf`` is real JSON Schema and is NOT implemented. If ``check_schema`` merely ignored
    it, the schema would be accepted, the constraint would read as enforced in review, and
    ``{"n": 3}`` would pass.
    """
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"n": {"type": "integer", "multipleOf": 5}},
    }
    with pytest.raises(SchemaError, match="multipleOf"):
        check_schema(schema, where="t")
    assert "multipleOf" not in CONSTRAINT_KEYWORDS
    assert "multipleOf" not in ANNOTATION_KEYWORDS


def test_a_default_that_violates_its_own_schema_is_refused() -> None:
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
    """``isinstance(True, int)`` is True in CPython — the trap ``_json_type_name`` exists for."""
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


def test_array_bounds_are_enforced() -> None:
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


def test_the_package_imports_no_agent_framework_and_no_http_client() -> None:
    """The kept package is still stdlib plus workspace packages: no model SDK, no HTTP client.

    Asserted over ``sys.modules`` in a fresh interpreter AFTER importing the package, so an
    indirect import through a helper is caught as well as a direct one. The one MiniMax client in
    the repository is ``services/agent``'s (ADR-002 §3.4).
    """
    import subprocess
    import sys

    source = (
        "import sys\n"
        "import papertree_agent_tools\n"
        "banned = {'pydantic_ai', 'openai', 'httpx', 'requests', 'jsonschema', 'anthropic'}\n"
        "print(sorted(banned & {m.split('.')[0] for m in sys.modules}))\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", source], capture_output=True, text=True, check=True
    )
    assert result.stdout.strip() == "[]", result.stdout
