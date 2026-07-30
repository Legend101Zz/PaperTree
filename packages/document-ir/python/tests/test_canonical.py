"""The Python twin of ``test/canonical.spec.ts`` — DESIGN.md §7.1 canonical JSON.

It reads the SAME file the TypeScript suite reads, ``conformance/canonical-vectors.json``, so
neither language is the oracle. Before this module existed, no test in either language exercised
PaperIR SERIALISATION at all, and the two bindings did not agree on the bytes of the SAME
committed golden fixture: 112 777 bytes here against 112 359 in TypeScript, diverging at 145
numeric literals, because the fixtures store ``"confidence": 1.0`` and JavaScript re-emits it as
``1``.

It also pins the Pydantic incantation that produces a valid document, because the obvious one does
not: ``Paper.model_dump_json()`` emits ``from_`` for every ``Relation.from`` and ``null`` for every
absent optional, and the result carries 1 241 ajv errors.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import pytest
from papertree_document_ir.canonical import (
    MAX_SAFE_JSON_INTEGER,
    CanonicalJsonError,
    canonical_json,
    canonical_json_for_determinism,
    ecmascript_number_to_string,
)
from papertree_document_ir.generated.models import Paper
from papertree_document_ir.validate import validate_paper

PKG = Path(__file__).resolve().parents[2]
CONTRACT: dict[str, Any] = json.loads(
    (PKG / "conformance" / "canonical-vectors.json").read_text(encoding="utf-8")
)
SCHEMA: dict[str, Any] = json.loads(
    (PKG / "schema" / "paperir-1.0.0.schema.json").read_text(encoding="utf-8")
)
FIXTURES = sorted(p.name for p in (PKG / "fixtures").glob("*.paperir.json"))


def test_contract_is_the_one_the_typescript_twin_reads() -> None:
    assert CONTRACT["contract_version"] == "papertree/canonical-json/1.0.0"
    assert CONTRACT["number_vectors"]
    assert CONTRACT["document_vectors"]
    assert len(CONTRACT["fixture_vectors"]) == 3


# ── clause 3: numbers in ECMAScript shortest-round-trip form ───────────────────────────────


@pytest.mark.parametrize("vector", CONTRACT["number_vectors"], ids=lambda v: v["python_repr"])
def test_number_formatting(vector: dict[str, str]) -> None:
    value = float(vector["python_repr"])
    assert ecmascript_number_to_string(value) == vector["canonical"]


def test_rejection_vectors_are_rejected(  # the acceptance BOUNDARY, not just the value
) -> None:
    assert CONTRACT["rejection_vectors"]
    for vector in CONTRACT["rejection_vectors"]:
        text = vector["python_repr"]
        value: Any = math.inf if text == "inf" else (int(text) if "e" not in text else float(text))
        with pytest.raises(CanonicalJsonError):
            canonical_json(value)


def test_one_point_zero_is_the_whole_reason_this_module_exists() -> None:
    assert canonical_json({"confidence": 1.0}) == '{"confidence":1}'
    # ...and the int 1 gives the same bytes, which is what makes the two languages comparable at
    # all: `json.loads` gives int for `1` and float for `1.0`, JavaScript gives one number type.
    assert canonical_json({"confidence": 1}) == '{"confidence":1}'


def test_there_is_no_negative_zero() -> None:
    assert canonical_json(-0.0) == "0"
    assert canonical_json([0, -0.0]) == "[0,0]"


def test_an_integer_that_cannot_round_trip_through_a_double_is_rejected() -> None:
    assert canonical_json(MAX_SAFE_JSON_INTEGER) == "9007199254740991"
    with pytest.raises(CanonicalJsonError):
        canonical_json(MAX_SAFE_JSON_INTEGER + 2)
    # The float branch carries the SAME bound: in JavaScript `1e16` IS the integer
    # 10000000000000000, so a laxer branch here would be an asymmetric-acceptance fork.
    with pytest.raises(CanonicalJsonError):
        canonical_json(1e16)
    with pytest.raises(CanonicalJsonError):
        canonical_json(math.nan)


# ── clauses 1 and 2: sorted keys, no insignificant whitespace ──────────────────────────────


@pytest.mark.parametrize("vector", CONTRACT["document_vectors"], ids=lambda v: v["label"])
def test_document_vectors(vector: dict[str, Any]) -> None:
    assert canonical_json(vector["value"]) == vector["canonical"]


def test_sorts_by_code_point() -> None:
    # Python's `sorted()` is already code-point order; `canonical.ts` implements it explicitly
    # because JavaScript's default sort is UTF-16 code-unit order and disagrees here.
    assert canonical_json({"\U0001f600": 1, "�": 2}) == '{"�":2,"\U0001f600":1}'


def test_keeps_a_null_value_and_drops_nothing_else() -> None:
    assert canonical_json({"a": None, "c": 1}) == '{"a":null,"c":1}'


def test_rejects_a_string_that_is_not_utf8_encodable() -> None:
    with pytest.raises(CanonicalJsonError):
        canonical_json({"a": "\ud800"})


# ── clause 4 is a SCHEMA guarantee, not a serialiser step ──────────────────────────────────


def test_every_optional_array_in_the_schema_carries_min_items() -> None:
    """§7.1 says "empty optional arrays omitted (D11)", which reads like a serialiser rule and is
    not one: several REQUIRED arrays (``Paper.relations``, every ``Flows.*``,
    ``Section.block_ids``) are legitimately empty, so a serialiser that dropped empty arrays would
    turn a valid document into an invalid one. What holds the line is ``minItems: 1`` on every
    OPTIONAL array. This asserts THAT, so a future optional array shipped without it fails here."""
    defs = SCHEMA["$defs"]
    offenders: list[str] = []
    checked = 0
    for def_name, node in defs.items():
        properties = node.get("properties")
        if not properties:
            continue
        required = set(node.get("required", []))
        for prop, spec in properties.items():
            target = defs[spec["$ref"].rsplit("/", 1)[-1]] if "$ref" in spec else spec
            if target.get("type") != "array" or prop in required:
                continue
            checked += 1
            if target.get("minItems", 0) < 1:
                offenders.append(f"{def_name}.{prop}")
    assert checked > 0
    assert offenders == []


# ── the two languages agree on the bytes of the SAME committed fixture ─────────────────────


@pytest.mark.parametrize("vector", CONTRACT["fixture_vectors"], ids=lambda v: v["fixture"])
def test_fixture_canonical_bytes(vector: dict[str, Any]) -> None:
    document = json.loads((PKG / "fixtures" / vector["fixture"]).read_text(encoding="utf-8"))
    canonical = canonical_json(document)
    assert len(canonical.encode("utf-8")) == vector["canonical_bytes"]
    assert hashlib.sha256(canonical.encode("utf-8")).hexdigest() == vector["canonical_sha256"]
    assert (
        hashlib.sha256(canonical_json_for_determinism(document).encode("utf-8")).hexdigest()
        == vector["determinism_sha256"]
    )


@pytest.mark.parametrize("name", FIXTURES)
def test_canonical_form_is_stable_under_reserialisation(name: str) -> None:
    """Criterion 1 in one line."""
    document = json.loads((PKG / "fixtures" / name).read_text(encoding="utf-8"))
    once = canonical_json(document)
    assert canonical_json(json.loads(once)) == once


# ── SERIALISATION round-trip, which nothing used to exercise ───────────────────────────────


@pytest.mark.parametrize("name", FIXTURES)
def test_unknown_block_survives_parse_canonicalise_reparse(name: str) -> None:
    """The hard rule is "``unknown`` is a valid block type and must round-trip", and "round-trips"
    was only ever proven as "validates"."""
    document = json.loads((PKG / "fixtures" / name).read_text(encoding="utf-8"))
    model = json.loads(json.dumps(document["blocks"][0]))
    unknown = {
        **model,
        "block_id": "blk_zzzzzzzzzzzzzzzz",
        "type": "brand_new_type_v9",
        "order": 100_000,
        "doc_order": 100_000,
        "payload": {"opaque_field": [1, 2, {"nested": True}]},
    }
    for key in (
        "text",
        "text_normalised",
        "content_hash",
        "spans",
        "parent_id",
        "prev_id",
        "next_id",
        "child_ids",
        "repairs",
        "alternatives",
    ):
        unknown.pop(key, None)
    document["blocks"].append(unknown)

    before = [d.rule for d in validate_paper(Paper.model_validate(document)).diagnostics]
    canonical = canonical_json(document)
    reparsed = json.loads(canonical)

    assert canonical_json(reparsed) == canonical
    paper = Paper.model_validate(reparsed)
    after = [d.rule for d in validate_paper(paper).diagnostics]
    assert after == before

    back = next(b for b in reparsed["blocks"] if b["block_id"] == "blk_zzzzzzzzzzzzzzzz")
    assert back["type"] == "brand_new_type_v9"
    assert back["polygon"] == model["polygon"]
    assert back["payload"] == {"opaque_field": [1, 2, {"nested": True}]}
    assert "text" not in back  # absent, not null


# ── the Pydantic incantation, pinned because the obvious one is silently wrong ─────────────


def test_the_only_model_dump_that_reproduces_a_valid_document() -> None:
    """``Paper.model_dump_json()`` is the obvious call and it is WRONG.

    It emits ``from_`` (the Python-keyword-escaped field name) instead of ``from`` for every
    ``Relation``, and ``null`` for every absent optional - a document with 1 241 ajv errors. Only
    ``model_dump(mode="json", by_alias=True, exclude_unset=True)`` round-trips, and that
    incantation appeared nowhere in DESIGN.md §6, the generated models, these tests or
    fixtures/README.md. It is pinned here AND written down in DESIGN.md §6.
    """
    raw = json.loads((PKG / "fixtures" / "resnet-cvpr-2col.paperir.json").read_text())
    paper = Paper.model_validate(raw)

    wrong = json.loads(paper.model_dump_json())
    assert "from_" in wrong["relations"][0]
    assert "from" not in wrong["relations"][0]

    right = paper.model_dump(mode="json", by_alias=True, exclude_unset=True)
    assert "from" in right["relations"][0]
    assert "from_" not in right["relations"][0]
    # …and it is byte-identical to the source document under the canonical form, which is the
    # only comparison that means anything across the two languages.
    assert canonical_json(right) == canonical_json(raw)
