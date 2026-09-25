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
from pydantic import ValidationError

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


def _sel(anchor: dict[str, Any], kind: str) -> dict[str, Any]:
    found: dict[str, Any] = next(s for s in anchor["selectors"] if s["type"] == kind)
    return found


#: (label, base example, mutation). Edges of §6 in every direction, after the S0 review's own 48
#: (`anchor_agree.py`): the model and the hand-written schema must give ONE answer, because a
#: record one of them accepts and the other refuses is exactly how a stored anchor stops being an
#: anchor (M1: explicit nulls, which the model took).
MUTATIONS: list[tuple[str, str, Any]] = [
    ("a prefixed id", "text", lambda a: a.update(id="cit_01K63A9W4XJ7Q2N8R5T0V3Y6ZE")),
    ("an id that is no id", "text", lambda a: a.update(id="not-a-uuid")),
    ("paperId empty", "text", lambda a: a["doc"].update(paperId="")),
    ("textStreamId empty", "text", lambda a: a["doc"].update(textStreamId="")),
    ("pdfSha256 upper case", "text", lambda a: a["doc"].update(pdfSha256="sha256:" + "A" * 64)),
    ("created.mode split", "text", lambda a: a["created"].update(mode="split")),
    ("no selectors", "text", lambda a: a.update(selectors=[])),
    ("blockId empty", "text", lambda a: _sel(a, "BlockSelector").update(blockId="")),
    ("startOffset -1", "text", lambda a: _sel(a, "BlockSelector").update(startOffset=-1)),
    ("startOffset 1.5", "text", lambda a: _sel(a, "BlockSelector").update(startOffset=1.5)),
    ("startOffset null", "text", lambda a: _sel(a, "BlockSelector").update(startOffset=None)),
    ("startOffset huge", "text", lambda a: _sel(a, "BlockSelector").update(startOffset=10**20)),
    ("page index 2**63", "text", lambda a: _sel(a, "PageSelector").update(index=2**63)),
    ("page label null", "text", lambda a: _sel(a, "PageSelector").update(label=None)),
    ("page label empty", "text", lambda a: _sel(a, "PageSelector").update(label="")),
    ("no quads", "text", lambda a: _sel(a, "ShapeSelector").update(quads=[])),
    ("a quad of ints", "text", lambda a: _sel(a, "ShapeSelector").update(quads=[[1, 2, 3, 4]])),
    ("a quad string", "text", lambda a: _sel(a, "ShapeSelector").update(quads=[["1", 2, 3, 4]])),
    ("a 3-point", "text", lambda a: _sel(a, "ShapeSelector").update(polygons=[[[1, 2, 3]]])),
    ("rotation 90.0", "text", lambda a: _sel(a, "ShapeSelector").update(rotation=90.0)),
    ("rotation false", "text", lambda a: _sel(a, "ShapeSelector").update(rotation=False)),
    ("rotation '90'", "text", lambda a: _sel(a, "ShapeSelector").update(rotation="90")),
    ("anchorVersion 1.0", "text", lambda a: a.update(anchorVersion=1.0)),
    ("no suffix", "text", lambda a: _sel(a, "TextQuoteSelector").pop("suffix")),
    ("a selector's extra key", "text", lambda a: _sel(a, "PageSelector").update(foo=1)),
    ("subTarget null", "text", lambda a: a.update(subTarget=None)),
    (
        "rect past the unit square",
        "figure-region",
        lambda a: a["subTarget"].update(normalisedRect=[0, 0, 1.5, 1]),
    ),
    ("rect of 3", "figure-region", lambda a: a["subTarget"].update(normalisedRect=[0, 0, 1])),
    ("subTarget empty", "figure-region", lambda a: a.update(subTarget={})),
    ("subTarget rect null", "figure-region", lambda a: a["subTarget"].update(normalisedRect=None)),
    ("cellRef of 3", "table-cell", lambda a: _sel(a, "BlockSelector").update(cellRef=[1, 2, 3])),
    ("cellRef null", "table-cell", lambda a: _sel(a, "BlockSelector").update(cellRef=None)),
    (
        "a path that is a string",
        "text",
        lambda a: a["selectors"].append(
            {
                "type": "SectionPathSelector",
                "path": "x",
                "headingText": "h",
                "paraIndexInSection": 0,
                "charOffsetInPara": 0,
            }
        ),
    ),
    ("a cache", "text", lambda a: a.update(resolution={"tier": 0})),
]

#: The one disagreement kept, in the harmless direction: JSON Schema's `integer` is any number
#: with a zero fraction, and strict pydantic takes only an int. The schema accepts MORE here, so
#: nothing the model accepts is refused on the other side.
SCHEMA_ONLY: list[tuple[str, str, Any]] = [
    ("startOffset 2.0", "text", lambda a: _sel(a, "BlockSelector").update(startOffset=2.0))
]


@pytest.mark.parametrize(("label", "base", "mutate"), MUTATIONS, ids=[m[0] for m in MUTATIONS])
def test_the_model_and_the_hand_schema_give_one_answer(label: str, base: str, mutate: Any) -> None:
    anchor = json.loads((EXAMPLES / f"{base}.json").read_text("utf-8"))
    mutate(anchor)
    by_schema = validate(anchor, SCHEMA) == []
    try:
        AnchorV1.model_validate_json(json.dumps(anchor))
        by_model = True
    except ValidationError:
        by_model = False
    assert by_model == by_schema, f"{label}: model {by_model}, schema {by_schema}"


def test_where_the_two_differ_the_schema_is_the_wider() -> None:
    for label, base, mutate in SCHEMA_ONLY:
        anchor = json.loads((EXAMPLES / f"{base}.json").read_text("utf-8"))
        mutate(anchor)
        assert validate(anchor, SCHEMA) == [], label
        with pytest.raises(ValidationError):
            AnchorV1.model_validate_json(json.dumps(anchor))
