"""One valid example of every wire model with an `omittable()` field, and which fields those are.

An omittable field is TypeScript's `field?: T`: absent or a value, never `null`. The exported and
hand-written schemas say exactly that (no `null` branch), so the server has to refuse an explicit
`null` too, or it accepts, and STORES, records the contract refuses (S0 review M1: an Anchor with
`"subTarget": null` was a 201).

`test_schemas.py` holds pydantic to "absent is fine, `null` is refused" on every field listed
here, and fails if a model gains an omittable field this table does not list. The schema side of
the same agreement is `test_contract_schemas.py` (S0c).

Each example is the SMALLEST valid body: every omittable field is absent, and a model whose
cross-field rule would require one (an explain thread needs `anchor`, an excerpt node needs
`source_anchor`) is given the kind that does not, so a `null` there meets the omittable rule and
not the "required for …" one.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Final

CAPTURE: Final = (
    Path(__file__).resolve().parents[4] / "packages/db/python/tests/data/capture_anchor_resnet.json"
)


def capture_anchor() -> dict[str, Any]:
    """The committed `captureAnchor` record (a text highlight on the resnet fixture)."""
    record: dict[str, Any] = json.loads(CAPTURE.read_text(encoding="utf-8"))["anchor"]
    return record


#: model name -> (a valid example, its omittable fields in declaration order).
CASES: Final[dict[str, tuple[dict[str, Any], tuple[str, ...]]]] = {
    "BlockSelector": (
        {"type": "BlockSelector", "blockId": "blk_dog5ufrf3mc2bwqy", "blockTextHash": "h"},
        ("startOffset", "endOffset", "cellRef", "rowIndex"),
    ),
    "PageSelector": ({"type": "PageSelector", "index": 0}, ("label",)),
    "SubTarget": (
        {"kind": "figure_region"},
        ("normalisedRect", "latexStart", "latexEnd", "lineIndex"),
    ),
    "AnchorV1": (capture_anchor(), ("subTarget",)),
    "AnchorV1In": (capture_anchor(), ("subTarget",)),
    "ReparseRequest": ({}, ("reason",)),
    "HighlightPatch": ({}, ("color",)),
    "ResolutionPutItem": (
        {
            "anchor_id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
            "tier": 1,
            "state": "anchored",
            "block_ids": ["blk_dog5ufrf3mc2bwqy"],
            "resolver_version": "anchoring@1.0.0",
        },
        ("upgraded_anchor",),
    ),
    "ThreadCreate": ({"kind": "ask"}, ("anchor",)),
    "FollowUp": ({"question": "And that?"}, ("retry_of",)),
    "SseStatus": ({"phase": "tool"}, ("label", "attempt", "delay_ms")),
    "NodeCreate": (
        {
            "node_id": "cn_0f9e8d7c-aaaa-4bbb-8ccc-123456789abc",
            "kind": "note",
            "x": 0,
            "y": 0,
            "w": 240,
            "h": 120,
        },
        ("source_anchor", "source_message_id"),
    ),
    "NodePatch": ({"version": 1}, ("x", "y", "w", "h", "z", "body")),
    "EdgePatch": ({}, ("kind",)),
    "BoardPatch": ({}, ("title",)),
    "AgentStatus": ({"phase": "tool"}, ("tool", "label", "attempt", "delay_ms")),
}


def with_null(model: str, field: str) -> dict[str, Any]:
    """`CASES[model]`'s example with `field` set to an explicit `null`."""
    example, _ = CASES[model]
    return {**json.loads(json.dumps(example)), field: None}


def null_cases() -> list[tuple[str, str]]:
    """Every (model, omittable field) pair, for `pytest.mark.parametrize`."""
    return [(model, field) for model, (_, fields) in CASES.items() for field in fields]
