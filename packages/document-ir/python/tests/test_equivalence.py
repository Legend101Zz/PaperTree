"""The Python twin of ``test/equivalence.spec.ts``.

It reads the SAME corpus files - ``packages/document-ir/test/cases/*.json`` - and asserts that the
Pydantic verdict matches the verdict recorded in each case. The TypeScript suite has already
asserted that ajv agrees with those recorded verdicts, so agreeing with the recording is agreeing
with ajv, without this process needing a JSON Schema validator of its own.

A few cases carry a ``divergence`` block: inputs on which the generated bindings are DELIBERATELY
stricter than ajv (an unpaired surrogate is legal JSON but not UTF-8-encodable; a 2000-deep payload
is not a verdict ajv can give at all - it throws). Those cases are not skipped: the recorded
``divergence.pydantic`` verdict is asserted exactly, so closing a divergence turns the annotation
red instead of leaving a stale claim in the tree. Every class is documented in DESIGN.md §12.

Any UNRECORDED divergence is a CODEGEN bug. Fix ``codegen/generate.ts`` and regenerate; do not
special-case it here, and do not "fix" the corpus.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from papertree_document_ir import (
    KNOWN_BLOCK_TYPES,
    KNOWN_DERIVATION_KINDS,
    KNOWN_RELATION_TYPES,
    MAX_PAYLOAD_DEPTH,
    Derivation,
    Paper,
    TableGrid,
    assert_model_free,
    find_excessive_depth,
    is_known_block_type,
    is_known_relation_type,
    loads,
)
from pydantic import BaseModel, ValidationError

PKG = Path(__file__).resolve().parents[2]
CASE_DIR = PKG / "test" / "cases"

VALIDATORS: dict[str, type[BaseModel]] = {"paperir": Paper, "derivation": Derivation}


def load_cases() -> list[dict[str, Any]]:
    cases = []
    for path in sorted(CASE_DIR.glob("*.json")):
        case = json.loads(path.read_text(encoding="utf-8"))
        case["file"] = path.name
        cases.append(case)
    return cases


CASES = load_cases()


def pydantic_verdict(case: dict[str, Any]) -> tuple[str, str]:
    model = VALIDATORS[case["schema"]]
    try:
        model.model_validate(case["document"])
    except ValidationError as exc:
        return "invalid", "; ".join(
            f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in exc.errors()
        )
    except ValueError as exc:  # raised by the hand-encoded recursive validators
        return "invalid", str(exc)
    return "valid", ""


def test_corpus_is_present() -> None:
    assert len(CASES) > 100, f"corpus not found or too small at {CASE_DIR}"
    assert any(c["schema"] == "derivation" for c in CASES)
    assert sum(1 for c in CASES if c["expect"] == "valid") > 20
    assert sum(1 for c in CASES if c["expect"] == "invalid") > 80


#: The complete set of classes on which the bindings may disagree with ajv. See DESIGN.md §12.
DOCUMENTED_DIVERGENCES = {"lone-surrogate", "payload-depth"}


def expected_verdict(case: dict[str, Any]) -> str:
    divergence = case.get("divergence")
    return str(divergence["pydantic"]) if divergence else str(case["expect"])


@pytest.mark.parametrize("case", CASES, ids=[c["file"] for c in CASES])
def test_pydantic_matches_recorded_verdict(case: dict[str, Any]) -> None:
    verdict, why = pydantic_verdict(case)
    want = expected_verdict(case)
    divergence = case.get("divergence")
    header = (
        f"the RECORDED divergence {divergence['class']!r} no longer holds - if it was closed,"
        f" delete the divergence block from codegen/build-corpus.ts and DESIGN.md §12"
        if divergence
        else "Pydantic and the schema disagree - this is a CODEGEN bug, fix codegen/generate.ts"
    )
    assert verdict == want, (
        f"\n{case['file']}: {header}.\n"
        f"  reason recorded: {case['reason']}\n"
        f"  ajv (recorded): {case['expect']}\n"
        f"  pydantic: {verdict}{f' - {why}' if why else ''}\n"
        f"  expected pydantic: {want}\n"
    )


def test_known_divergences_are_exactly_the_documented_ones() -> None:
    """A documented divergence is acceptable; an undocumented or a stale one is not."""
    annotated = [c for c in CASES if c.get("divergence")]
    assert {c["divergence"]["class"] for c in annotated} == DOCUMENTED_DIVERGENCES
    assert len(annotated) < 10, "a binding that disagrees with the schema often is not a binding"
    for case in annotated:
        # The annotation must record a real disagreement, not restate the ajv verdict.
        assert case["divergence"]["pydantic"] != case["expect"], (
            f"{case['file']}: annotated as diverging but agrees with ajv. Delete the annotation."
        )
        assert "DESIGN.md §12." in case["divergence"]["why"]


# -------------------------------------------------------------------------------------------
# The named acceptance criteria, restated against the Python binding.
# -------------------------------------------------------------------------------------------


def case_named(name: str) -> dict[str, Any]:
    for case in CASES:
        if case["name"] == name:
            return case
    raise AssertionError(f"corpus case missing: {name}")


@pytest.mark.parametrize(
    "name",
    ["unknown-block-type", "unknown-type-carries-payload", "unknown-relation-type"],
)
def test_unknown_types_validate(name: str) -> None:
    """Construct 1: unknown types MUST validate in both languages."""
    assert pydantic_verdict(case_named(name))[0] == "valid"


def test_block_missing_polygon_fails() -> None:
    assert pydantic_verdict(case_named("block-missing-polygon"))[0] == "invalid"


@pytest.mark.parametrize(
    "name", ["block-source-llm", "block-source-model", "block-source-vlm", "block-generated-by"]
)
def test_llm_authored_source_fails(name: str) -> None:
    assert pydantic_verdict(case_named(name))[0] == "invalid"


@pytest.mark.parametrize(
    "name",
    [
        "paper-extra-summary",
        "relation-extra-field",
        "strict-span-extra-field",
        "strict-provenance-extra-field",
        "strict-flows-extra-key",
        "conditional-equation-payload-extra-field",
        "strict-nested-table-cell-extra-field",
    ],
)
def test_extra_forbid_survives_at_every_depth(name: str) -> None:
    """Construct 3: ``extra="forbid"`` is the Pydantic spelling of additionalProperties:false."""
    assert pydantic_verdict(case_named(name))[0] == "invalid"


def test_nullable_is_not_optional() -> None:
    """DESIGN.md D11 in the Python binding."""
    assert pydantic_verdict(case_named("nullable-required-metadata-null"))[0] == "valid"
    assert pydantic_verdict(case_named("nullable-optional-doc-order-null"))[0] == "invalid"
    assert pydantic_verdict(case_named("nullable-required-overall-null"))[0] == "invalid"


def test_known_vocabularies_are_documentation_not_constraints() -> None:
    """Construct 1: the StrEnum exists alongside ``str``; it never narrows a field."""
    assert "paragraph" in KNOWN_BLOCK_TYPES
    assert is_known_block_type("paragraph")
    assert not is_known_block_type("totally_new_type_v2")
    assert is_known_relation_type("cites")
    assert "guided_section" in KNOWN_DERIVATION_KINDS
    assert "continues_in_next_column" in KNOWN_RELATION_TYPES


def test_known_vocabularies_match_the_typescript_ones() -> None:
    """Both languages read the same $defs in the same pass, so the sets are identical."""
    types_ts = (PKG / "src" / "generated" / "types.ts").read_text(encoding="utf-8")
    start = types_ts.index("export const KNOWN_BLOCK_TYPES = [")
    end = types_ts.index("] as const;", start)
    ts_values = {
        line.strip().strip(",").strip('"') for line in types_ts[start:end].splitlines()[1:]
    }
    assert ts_values == set(KNOWN_BLOCK_TYPES)


def test_model_free_subtree_is_recursive() -> None:
    """Construct 3's recursive half, which cannot be a type in either language."""
    assert_model_free({"a": {"b": [{"c": 1}]}})
    with pytest.raises(ValueError, match="model-authorship"):
        assert_model_free({"a": {"b": [{"generated_by": "gpt-4"}]}})


# -------------------------------------------------------------------------------------------
# The differential attack, restated against the Python binding. See DESIGN.md §12.
# -------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        "proto-payload-model-authorship",
        "proto-payload-bare",
        "proto-payload-whole-derivation",
        "proto-inside-equation-payload",
        "proto-as-block-key",
    ],
)
def test_proto_is_an_ordinary_key(name: str) -> None:
    """§12.1. ``json.loads`` makes ``__proto__`` an ordinary key here, which is why Python was
    already right and Zod was not - pinned so it stays that way."""
    assert pydantic_verdict(case_named(name))[0] == "invalid"


def test_constructor_key_is_not_over_rejected() -> None:
    assert pydantic_verdict(case_named("constructor-payload-key"))[0] == "valid"


@pytest.mark.parametrize(
    ("name", "expect"),
    [
        ("uri-whitespace-feff", "invalid"),
        ("uri-whitespace-nel", "valid"),
        ("uri-whitespace-nbsp", "invalid"),
        ("uri-whitespace-line-separator", "invalid"),
        ("uri-whitespace-tab", "invalid"),
        ("uri-whitespace-none", "valid"),
    ],
)
def test_ecma_whitespace_class_decides_the_uri(name: str, expect: str) -> None:
    """§12.2. The Rust engine behind Pydantic uses ``\\p{White_Space}``, which omits U+FEFF and
    includes U+0085 - two divergences from ECMA-262 in opposite directions, both closed by
    expanding the class in codegen rather than handing ``\\s`` to a second engine."""
    assert pydantic_verdict(case_named(name))[0] == expect


@pytest.mark.parametrize(
    ("name", "expect"),
    [
        ("integer-generation-float-literal", "valid"),
        ("integer-generation-exponent-literal", "valid"),
        ("integer-page-index-float-literal", "valid"),
        ("integer-rotation-float-literal", "valid"),
        ("integer-block-order-float-literal", "valid"),
        ("integer-generation-fractional", "invalid"),
        ("integer-rotation-bool", "invalid"),
        ("integer-generation-beyond-safe-range", "valid"),
    ],
)
def test_json_integer_semantics(name: str, expect: str) -> None:
    """§12.3. JSON Schema ``"integer"`` is any NUMBER with a zero fractional part; strict Pydantic
    refuses float->int, so every non-JS producer was emitting documents ajv blessed and this
    binding rejected. ``False == 0`` must STILL be rejected."""
    assert pydantic_verdict(case_named(name))[0] == expect


def test_json_integer_does_not_truncate_or_admit_bools() -> None:
    """The unit-level statement of the same rule, independent of any corpus case."""
    grid = TableGrid.model_validate({"rows": 2.0, "cols": 1e0, "cells": []})
    assert (grid.rows, grid.cols) == (2, 1)
    assert isinstance(grid.rows, int) and not isinstance(grid.rows, bool)
    for bad in (1.5, True, False, "1", None):
        with pytest.raises(ValidationError):
            TableGrid.model_validate({"rows": bad, "cols": 1, "cells": []})


def test_payload_depth_is_bounded_in_both_languages() -> None:
    """§12.6. The bound exists so a hostile document gets a VERDICT rather than a RecursionError."""
    assert MAX_PAYLOAD_DEPTH == 64
    assert find_excessive_depth({"a": {"b": 1}}) is None
    deep: Any = {"leaf": 1}
    for _ in range(2000):
        deep = {"a": deep}
    assert find_excessive_depth(deep) is not None
    with pytest.raises(ValueError, match="nests deeper"):
        assert_model_free(deep)
    assert pydantic_verdict(case_named("payload-depth-at-limit"))[0] == "valid"
    assert pydantic_verdict(case_named("payload-depth-over-limit"))[0] == "invalid"


def test_lone_surrogates_are_rejected_consistently() -> None:
    """§12.5. pydantic-core rejected these in CONSTRAINED strings and accepted them in
    unconstrained ones - a binding disagreeing with itself. Both now reject."""
    for name in ("lone-surrogate-constrained-string", "lone-surrogate-unconstrained-string"):
        assert pydantic_verdict(case_named(name))[0] == "invalid"
    assert pydantic_verdict(case_named("astral-pair-string"))[0] == "valid"


def test_json_loads_rejects_the_non_json_constants() -> None:
    """§12.7. ``NaN``/``Infinity`` are not JSON: ``JSON.parse`` cannot read them at all, while
    CPython accepts them by default. ``loads`` is the package's parse-layer answer to that."""
    for text in ("NaN", "Infinity", "-Infinity", '{"a": NaN}'):
        with pytest.raises(ValueError, match="not JSON"):
            loads(text)
    assert loads('{"a": 1}') == {"a": 1}
