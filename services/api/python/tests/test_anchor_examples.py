"""contracts.md §6: the pydantic `AnchorV1` accepts every example in `contracts/anchor/examples/`.

The examples come from the two producers of stored anchors, so this is the API held to what is
really stored:

    text, table-cell, figure-region, equation-part, citation
        `captureAnchor()` outputs, written by `packages/anchoring/test/anchor-schema.spec.ts`
    legacy-0001
        what migration 0005 BUILDS from a 0001 highlight row, written HERE from a real migration
        of the demo data root's shape (`packages/db/python/tests/saved_shapes.py`, the builder the
        0005 tests use: the committed resnet fixture plus the one legacy row with its placeholder
        polygon)

Each example is also checked against the hand-written `anchor-v1.schema.json` (the TypeScript
side checks the same files with ajv), and the hand-written schema and pydantic's export of
`AnchorV1` are compared def by def, property by property.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from jsonschema_lite import validate
from papertree_api import contracts
from papertree_api.schemas import AnchorV1
from papertree_db import find_migrations_dir, migrate

REPO = Path(__file__).resolve().parents[4]
ANCHOR = REPO / "contracts" / "anchor"
EXAMPLES = ANCHOR / "examples"
SCHEMA: dict[str, Any] = json.loads((ANCHOR / "anchor-v1.schema.json").read_text("utf-8"))
SAVED_SHAPES = REPO / "packages/db/python/tests/saved_shapes.py"


def _saved_shapes() -> ModuleType:
    """`saved_shapes.py`, loaded by path: `packages/db/python/tests` is a package named `tests`,
    which is only importable when pytest happens to have put its parent on `sys.path`."""
    name = "papertree_db_saved_shapes"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SAVED_SHAPES)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclasses resolve their module by name
    spec.loader.exec_module(module)
    return module


def test_the_legacy_0001_example_is_what_0005_writes(tmp_path: Path) -> None:
    shapes = _saved_shapes()
    shape = shapes.build_demo_shape(tmp_path)
    conn = shapes.raw_connect(shape.file)
    try:
        assert migrate(conn, find_migrations_dir()).applied == (5,)
        [row] = conn.execute(
            "SELECT anchor_json FROM anchors WHERE anchor_id = ?", (shapes.LEGACY_ANCHOR,)
        ).fetchall()
    finally:
        conn.close()
    stored: dict[str, Any] = json.loads(row["anchor_json"])
    assert stored["doc"]["textStreamId"] == "legacy-0001"
    AnchorV1.model_validate_json(row["anchor_json"])  # what 0005 writes is an AnchorV1 already

    path = EXAMPLES / "legacy-0001.json"
    if not path.is_file() or os.environ.get("PAPERTREE_WRITE_ANCHOR_EXAMPLES") == "1":
        EXAMPLES.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(stored, indent=2, ensure_ascii=False) + "\n", "utf-8")
    committed = json.loads(path.read_text("utf-8"))
    assert committed == stored, (
        "0005's legacy Anchor changed: re-run with PAPERTREE_WRITE_ANCHOR_EXAMPLES=1, then "
        "`pnpm exec prettier --write contracts/anchor`, and review the diff"
    )


def _examples() -> list[Path]:
    return sorted(EXAMPLES.glob("*.json"))


def test_the_examples_are_there() -> None:
    names = {path.stem for path in _examples()}
    assert {"legacy-0001", "text", "table-cell", "figure-region", "equation-part"} <= names
    assert "citation" in names


@pytest.mark.parametrize("path", _examples(), ids=lambda p: p.stem)
def test_anchor_v1_accepts_every_example(path: Path) -> None:
    raw = path.read_text("utf-8")
    AnchorV1.model_validate_json(raw)
    assert validate(json.loads(raw), SCHEMA) == [], path.name


#: hand-written def -> pydantic def, for the defs both sides have.
PAIRS = {
    "#": "AnchorV1",
    "AnchorDoc": "AnchorDoc",
    "SubTarget": "SubTarget",
    "BlockSelector": "BlockSelector",
    "PageSelector": "PageSelector",
    "TextPositionSelector": "TextPositionSelector",
    "TextQuoteSelector": "TextQuoteSelector",
    "ShapeSelector": "ShapeSelector",
    "SectionPathSelector": "SectionPathSelector",
}


@pytest.mark.parametrize("hand_name", sorted(PAIRS))
def test_the_hand_written_schema_and_the_model_have_the_same_fields(hand_name: str) -> None:
    """The two sides of §6 cannot disagree about which fields exist or which are required."""
    exported = contracts.render("highlights")["$defs"]
    hand = SCHEMA if hand_name == "#" else SCHEMA["$defs"][hand_name]
    model = exported[PAIRS[hand_name]]
    assert set(hand["properties"]) == set(model["properties"]), hand_name
    assert set(hand.get("required", [])) == set(model.get("required", [])), hand_name
    assert hand.get("additionalProperties") is False and model["additionalProperties"] is False
