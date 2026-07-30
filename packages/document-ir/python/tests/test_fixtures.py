"""The Python twin of the ``golden fixtures (F0.7)`` block in ``test/schema.spec.ts``.

It loads the SAME three files out of ``packages/document-ir/fixtures/`` and asserts the same four
things about each of them, through the Python half of the library:

  1. present            - exactly ``EXPECTED_FIXTURES`` ``*.paperir.json`` files, named for the
                          corpus PDF they were built from.
  2. well-FORMED        - ``Paper.model_validate`` accepts it. The Pydantic models are GENERATED
                          from ``schema/paperir-1.0.0.schema.json`` and are strict, so this is the
                          Python-side reading of the same schema ajv reads in TypeScript. (There is
                          no ``jsonschema`` dependency in this workspace, and adding one to
                          re-validate the schema a second time in the same language would prove
                          nothing the TypeScript ajv run does not already prove.)
  3. internally CONSISTENT - ``validate_paper`` (DESIGN.md §5.2, Tier A) with ZERO errors and zero
                          warnings. Schema validity alone would let through a document whose
                          polygons disagree with their bboxes, whose relations dangle, or whose
                          reading order has holes.
  4. HONEST about identity - every ``block_id`` recomputes from that block's own
                          ``(source_hash, page_index, x0, y0, type, text)``, and
                          ``text_normalised`` / ``content_hash`` recompute from its own text.

NEITHER LANGUAGE IS THE ORACLE. This suite does not compare itself against the TypeScript output;
it re-derives everything from the committed fixture bytes with the Python implementation, exactly
as ``test_identity.py`` re-derives the conformance vectors. A shared misreading would otherwise
pass both halves.

What the fixtures do and do not cover, in prose, is ``packages/document-ir/fixtures/README.md``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from papertree_document_ir import loads
from papertree_document_ir.generated.models import Paper
from papertree_document_ir.identity import BlockIdInput, block_id, content_hash, normalise_text
from papertree_document_ir.validate import validate_paper

PKG = Path(__file__).resolve().parents[2]
FIXTURES = PKG / "fixtures"

EXPECTED_FIXTURES = (
    "attention-is-all-you-need.paperir.json",
    "neural-odes-mathheavy.paperir.json",
    "resnet-cvpr-2col.paperir.json",
)


def _fixture_files() -> list[str]:
    return sorted(p.name for p in FIXTURES.glob("*.paperir.json"))


def _raw(name: str) -> dict[str, Any]:
    # ``loads``, not ``json.loads``: a fixture carrying NaN/Infinity would be a document the two
    # halves of this system could not agree on, and it must fail here rather than downstream.
    doc = loads((FIXTURES / name).read_text(encoding="utf-8"))
    assert isinstance(doc, dict)
    return doc


def test_all_three_fixtures_are_present() -> None:
    assert _fixture_files() == list(EXPECTED_FIXTURES)


@pytest.mark.parametrize("name", EXPECTED_FIXTURES)
def test_fixture_validates_against_the_generated_pydantic_binding(name: str) -> None:
    paper = Paper.model_validate(_raw(name))
    assert paper.ir_version == "1.0.0"
    assert paper.blocks, "a fixture with no blocks would pass every other check vacuously"


@pytest.mark.parametrize("name", EXPECTED_FIXTURES)
def test_fixture_has_zero_tier_a_semantic_errors(name: str) -> None:
    report = validate_paper(Paper.model_validate(_raw(name)))
    # The whole diagnostic, not a count: a bare ``assert report.ok`` tells the next person nothing
    # about which rule broke or where.
    assert [f"{d.rule} {d.path}: {d.message}" for d in report.errors] == []
    assert report.ok is True


@pytest.mark.parametrize("name", EXPECTED_FIXTURES)
def test_fixture_has_zero_tier_a_warnings(name: str) -> None:
    # Warnings are not fatal for an arbitrary document. For a HAND-CHECKED fixture they are: a
    # warning means a human declared something the validator finds suspicious, and Epic 2 would
    # inherit it silently.
    report = validate_paper(Paper.model_validate(_raw(name)))
    assert [f"{d.rule} {d.path}: {d.message}" for d in report.warnings] == []


@pytest.mark.parametrize("name", EXPECTED_FIXTURES)
def test_every_block_id_recomputes_from_the_blocks_own_content(name: str) -> None:
    doc = _raw(name)
    source_hash = str(doc["source_hash"]).removeprefix("sha256:")
    mismatched: list[str] = []

    for block in doc["blocks"]:
        recomputed = block_id(
            BlockIdInput(
                source_hash=source_hash,
                page_index=block["page_index"],
                x0=block["bbox"][0],
                y0=block["bbox"][1],
                block_type=block["type"],
                text=block.get("text") or "",
            )
        )
        if recomputed != block["block_id"]:
            mismatched.append(
                f"{block['block_id']} (p{block['page_index']} {block['type']}) -> {recomputed}"
            )

    assert mismatched == []
    assert doc["blocks"]


@pytest.mark.parametrize("name", EXPECTED_FIXTURES)
def test_text_normalised_and_content_hash_recompute(name: str) -> None:
    wrong: list[str] = []
    for block in _raw(name)["blocks"]:
        text = block.get("text")
        if text is None:
            continue
        if block.get("text_normalised") != normalise_text(text):
            wrong.append(f"{block['block_id']}.text_normalised")
        if block.get("content_hash") != content_hash(text):
            wrong.append(f"{block['block_id']}.content_hash")
    assert wrong == []


def test_the_recompute_check_discriminates() -> None:
    """Negative controls. Without them a check that computed nothing would pass forever."""
    doc = _raw(EXPECTED_FIXTURES[0])
    source_hash = str(doc["source_hash"]).removeprefix("sha256:")
    block = next(b for b in doc["blocks"] if b.get("text"))

    def mint(**overrides: Any) -> str:
        base = {
            "source_hash": source_hash,
            "page_index": block["page_index"],
            "x0": block["bbox"][0],
            "y0": block["bbox"][1],
            "block_type": block["type"],
            "text": block["text"],
        }
        return block_id(BlockIdInput(**{**base, **overrides}))

    assert mint() == block["block_id"]  # the positive half, on the same input
    assert mint(text="tampered " + block["text"]) != block["block_id"]
    assert mint(x0=block["bbox"][0] + 1) != block["block_id"]
    assert mint(page_index=block["page_index"] + 1) != block["block_id"]

    # ...but APPENDING is invisible to the id: only the first 8 code points of the normalised text
    # are hashed (DESIGN.md §E.4), by design, so that a block which grows downward keeps its id.
    # That is exactly why ``content_hash`` is mandatory on every tier-1 anchor hit, and why the
    # previous test checks ``content_hash`` separately.
    assert mint(text=block["text"] + " appended") == block["block_id"]
    assert content_hash(block["text"] + " appended") != block["content_hash"]


@pytest.mark.parametrize("name", EXPECTED_FIXTURES)
def test_every_declared_asset_exists_on_disk(name: str) -> None:
    """``ImageRef.uri`` is ``fixture://<slug>/<path>`` -> ``fixtures/assets/<slug>/<path>``.

    The schema can only check the URI's shape. A crop is the ground truth for an equation
    (ADR-001), so a fixture that names a crop it did not ship is a fixture that lies.
    """
    missing: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            uri = node.get("uri")
            if (
                isinstance(uri, str)
                and uri.startswith("fixture://")
                and not (FIXTURES / "assets" / uri.removeprefix("fixture://")).is_file()
            ):
                missing.append(uri)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(_raw(name))
    assert missing == []


@pytest.mark.parametrize("name", EXPECTED_FIXTURES)
def test_fixture_is_byte_stable_json(name: str) -> None:
    """Re-serialising must not change the bytes.

    ``paper_id`` and ``page_id`` are derived from ``source_hash`` rather than minted from a clock
    (DESIGN.md §7.1) precisely so a rebuild is a no-op in git. This catches the other half: a
    fixture hand-edited into a shape the writer would not produce (trailing whitespace, tab
    indentation, unsorted duplicate keys) would churn the moment anyone regenerates it.
    """
    text = (FIXTURES / name).read_text(encoding="utf-8")
    assert text.endswith("\n")
    assert "\t" not in text
    assert json.dumps(json.loads(text), ensure_ascii=False, indent=2) + "\n" == text
