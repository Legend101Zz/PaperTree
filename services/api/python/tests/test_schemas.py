"""`schemas.py`: the rules the wire models add, each shown to bite.

The Anchor half: `AnchorV1` is the §6 record, and it now sits in front of the data layer on every
highlight write, so a body the data layer ALONE would have stored — a target kind outside the ten,
an unknown key, a selector field of the wrong type — is a 422 naming the field. The rest: the
cross-field rules §2.5/§2.7/§3.2 state (explain needs an anchor, an excerpt needs a source, a
summary run has no seed, a complete run carries no error), `omittable` fields, and `WireTime`.
"""

from __future__ import annotations

import copy
import inspect
import json
from pathlib import Path
from typing import Any

import pytest
from api_support import assert_envelope, auth, harness, register, seed_paper
from omittable_cases import CASES, null_cases, with_null
from papertree_api import schemas
from papertree_api.schemas import NULL_NOT_ALLOWED as NULL_MESSAGE
from papertree_api.schemas import (
    AgentDone,
    AgentRunRequest,
    AnchorV1,
    AnchorV1In,
    EdgeCreate,
    Highlight,
    NodeCreate,
    SseStatus,
    ThreadCreate,
    Wire,
    is_omittable,
)
from pydantic import ValidationError

CAPTURE = (
    Path(__file__).resolve().parents[4] / "packages/db/python/tests/data/capture_anchor_resnet.json"
)
SLUG = "resnet-cvpr-2col"


def _anchor() -> dict[str, Any]:
    record: dict[str, Any] = json.loads(CAPTURE.read_text(encoding="utf-8"))["anchor"]
    return record


def _shape(anchor: dict[str, Any]) -> dict[str, Any]:
    selector: dict[str, Any] = next(s for s in anchor["selectors"] if s["type"] == "ShapeSelector")
    return selector


#: Each is malformed in ONE way the §6 record forbids. Label -> mutation.
MALFORMED: dict[str, Any] = {
    "anchorVersion 2": lambda a: a.update(anchorVersion=2),
    "anchorVersion true": lambda a: a.update(anchorVersion=True),
    "anchorVersion '1'": lambda a: a.update(anchorVersion="1"),
    "offsetUnit utf16": lambda a: a.update(offsetUnit="utf16"),
    "an id that is no id": lambda a: a.update(id="not an id"),
    "doc missing": lambda a: a.pop("doc"),
    "a bare-hex pdfSha256": lambda a: a["doc"].update(pdfSha256="ab" * 32),
    "targetKind paragraph": lambda a: a.update(targetKind="paragraph"),
    "provenanceClass user": lambda a: a.update(provenanceClass="user"),
    "an unknown top-level key": lambda a: a.update(colour="amber"),
    "an unknown selector type": lambda a: a["selectors"].append({"type": "XPathSelector"}),
    "a selector with an extra key": lambda a: a["selectors"][0].update(extra=1),
    "a quad of three numbers": lambda a: _shape(a).update(quads=[[1, 2, 3]]),
    "a string coordinate": lambda a: _shape(a).update(quads=[["1", 2, 3, 4]]),
    "rotation 45": lambda a: _shape(a).update(rotation=45),
    "rotation false": lambda a: _shape(a).update(rotation=False),
    "a negative page index": lambda a: _shape(a).update(pageIndex=-1),
    "created.mode reader": lambda a: a["created"].update(mode="reader"),
    "subTarget outside the unit square": lambda a: a.update(
        subTarget={"kind": "figure_region", "normalisedRect": [0, 0, 1.5, 1]}
    ),
}


def test_the_committed_capture_anchor_record_is_an_anchor_v1() -> None:
    record = _anchor()
    model = AnchorV1.model_validate_json(json.dumps(record))
    # Round trip: nothing the model would add or drop (omittable fields stay absent).
    assert model.model_dump(mode="json") == json.loads(json.dumps(record), parse_float=float)


@pytest.mark.parametrize("label", sorted(MALFORMED))
def test_anchor_v1_rejects(label: str) -> None:
    anchor = copy.deepcopy(_anchor())
    MALFORMED[label](anchor)
    with pytest.raises(ValidationError):
        AnchorV1.model_validate_json(json.dumps(anchor))


def test_an_incoming_anchor_may_carry_its_cache_and_it_is_dropped() -> None:
    anchor = {**_anchor(), "resolution": {"tier": 0, "anything": ["goes"]}}
    model = AnchorV1In.model_validate_json(json.dumps(anchor))
    assert "resolution" not in model.model_dump(mode="json")
    with pytest.raises(ValidationError):
        AnchorV1.model_validate_json(json.dumps(anchor))  # the persisted record has no cache


def test_anchor_v1_is_in_front_of_the_data_layer_on_every_highlight_write(tmp_path: Path) -> None:
    """WATCHED FAILING on wave 1's routes, which checked only what the SQL CHECKs need: these
    bodies were STORED (201), because the data layer accepts any target kind string, any extra
    key and any selector field."""

    def body(anchor: dict[str, Any], n: int) -> dict[str, Any]:
        return {
            "highlight_id": f"hl_01K0SCHEMAPATH000000000{n:02d}",
            "color": "amber",
            "anchors": [{"anchor": anchor}],
        }

    cases: dict[str, tuple[Any, str]] = {
        "targetKind paragraph": (MALFORMED["targetKind paragraph"], "anchors.0.anchor.targetKind"),
        "an unknown top-level key": (MALFORMED["an unknown top-level key"], "anchors.0.anchor"),
        "created.mode reader": (MALFORMED["created.mode reader"], "anchors.0.anchor.created"),
        "offsetUnit utf16": (MALFORMED["offsetUnit utf16"], "anchors.0.anchor.offsetUnit"),
    }
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        url = f"/papers/{paper_id}/highlights"
        for n, (label, (mutate, where)) in enumerate(cases.items()):
            anchor = copy.deepcopy(_anchor())
            mutate(anchor)
            response = h.client.post(url, headers=auth(alice), json=body(anchor, n))
            found = assert_envelope(response, 422, "validation_failed")
            assert found["detail"].startswith(where), (label, found)
        assert h.client.get(url, headers=auth(alice)).json() == []

        # The stored record is the client's JSON verbatim, not the model's re-serialisation.
        good = _anchor()
        created = h.client.post(url, headers=auth(alice), json=body(good, 99))
        assert created.status_code == 201, created.text
        Highlight.model_validate_json(created.content)
        stored = created.json()["anchors"][0]["anchor"]
        assert json.dumps(stored, sort_keys=True) == json.dumps(good, sort_keys=True)
        assert _shape(stored)["pageWidth"] == 612 and isinstance(_shape(stored)["pageWidth"], int)


def test_cross_field_rules() -> None:
    with pytest.raises(ValidationError) as explain:
        ThreadCreate.model_validate_json('{"kind": "explain"}')
    assert explain.value.errors()[0]["loc"] == ("anchor",)
    ask = ThreadCreate.model_validate_json('{"kind": "ask"}')
    assert ask.anchor is None and ask.question == "Explain this passage."

    with pytest.raises(ValidationError) as excerpt:
        NodeCreate.model_validate_json(
            '{"node_id": "cn_0f9e8d7c-aaaa-4bbb-8ccc-123456789abc", "kind": "excerpt",'
            ' "x": 0, "y": 0, "w": 10, "h": 10}'
        )
    assert excerpt.value.errors()[0]["loc"] == ("source_anchor",)
    with pytest.raises(ValidationError) as explanation:
        NodeCreate.model_validate_json(
            '{"node_id": "cn_0f9e8d7c-aaaa-4bbb-8ccc-123456789abc", "kind": "explanation",'
            ' "x": 0, "y": 0, "w": 10, "h": 10}'
        )
    assert explanation.value.errors()[0]["loc"] == ("source_message_id",)
    with pytest.raises(ValidationError):
        EdgeCreate.model_validate_json(
            '{"edge_id": "ce_0f9e8d7c-aaaa-4bbb-8ccc-123456789abc", "from_node_id": "cn_a",'
            ' "to_node_id": "cn_a", "kind": "supports"}'
        )


def test_agent_contract_rules() -> None:
    request: dict[str, Any] = {
        "run_id": "run_01K62ZX4Y6C0G6Y7T3N2E6Q9VB",
        "request_id": "req_01K62ZX4Y6C0G6Y7T3N2E6Q9VC",
        "kind": "summary",
        "prompt_version": "summary-v1",
        "tool": {
            "base_url": "http://127.0.0.1:8000/internal/agent/runs/run_01K62ZX4Y6C0G6Y7T3N2E6Q9VB",
            "token": "A" * 43,
        },
        "datamark": "^1a2b3c4d",
        "paper": {"title": "YOLO", "page_count": 10, "generation": 1},
        "seed": None,
        "question": "Summarise this paper.",
        "history": None,
        "limits": {
            "deadline_ms": 90000,
            "idle_ms": 20000,
            "max_tool_calls": 12,
            "max_turns": 6,
            "max_output_tokens": 6144,
            "max_retries": 1,
        },
    }
    AgentRunRequest.model_validate_json(json.dumps(request))
    seed: dict[str, Any] = {"quote": "q", "page_label": "p. 1", "section": None, "passages": []}
    with pytest.raises(ValidationError):  # a summary run has no seed
        AgentRunRequest.model_validate_json(json.dumps({**request, "seed": seed}))
    explain = {**request, "kind": "explain", "prompt_version": "explain-v1"}
    with pytest.raises(ValidationError):  # an explain run needs one
        AgentRunRequest.model_validate_json(json.dumps(explain))
    AgentRunRequest.model_validate_json(json.dumps({**explain, "seed": seed}))

    done = {
        "status": "complete",
        "stop_reason": "stop",
        "error": None,
        "final_text": "x",
        "handles_seen": ["b1"],
        "markers": [],
        "usage_totals": {
            "input": 1,
            "output": 1,
            "cache_read": 0,
            "cache_write": 0,
            "reasoning": None,
            "cost_usd_est": 0.0,
        },
        "tool_calls": 0,
        "turns": 1,
        "retries": 0,
        "first_text_ms": 10,
        "latency_ms": 20,
        "entries": [],
    }
    AgentDone.model_validate_json(json.dumps(done))
    error = {"code": "timeout", "retryable": True, "message": "The model stopped answering."}
    with pytest.raises(ValidationError):
        AgentDone.model_validate_json(json.dumps({**done, "error": error}))
    with pytest.raises(ValidationError):
        AgentDone.model_validate_json(json.dumps({**done, "status": "error"}))
    AgentDone.model_validate_json(json.dumps({**done, "status": "error", "error": error}))


def test_omittable_fields_are_absent_not_null() -> None:
    assert SseStatus(phase="tool").model_dump(mode="json") == {"phase": "tool"}
    schema = SseStatus.model_json_schema(mode="serialization")
    assert schema["properties"]["label"] == {"type": "string", "title": "Label"}
    assert schema["required"] == ["phase"]


def _omittable_fields() -> dict[str, tuple[str, ...]]:
    """Every wire model in `schemas.py` that has an `omittable()` field, and those fields."""
    found: dict[str, tuple[str, ...]] = {}
    for name, value in vars(schemas).items():
        if inspect.isclass(value) and issubclass(value, Wire) and value is not Wire:
            fields = tuple(n for n, f in value.model_fields.items() if is_omittable(f))
            if fields:
                found[name] = fields
    return found


def test_every_omittable_field_has_a_null_case() -> None:
    """`omittable_cases.CASES` is complete: a model that gains an omittable field fails here
    until its null case is written, so the refusal below cannot silently skip it."""
    assert _omittable_fields() == {model: fields for model, (_, fields) in CASES.items()}


@pytest.mark.parametrize(("model", "field"), null_cases())
def test_an_omittable_field_may_be_absent_but_never_null(model: str, field: str) -> None:
    """S0 review M1. WATCHED FAILING (`DID NOT RAISE`) on all 33 cases while `omittable()` only
    dropped `null` from the exported schema: the validator still took `null`, so the server
    accepted what every schema refuses."""
    cls = getattr(schemas, model)
    example, _ = CASES[model]
    parsed = cls.model_validate_json(json.dumps(example))
    assert getattr(parsed, field) is None
    assert field not in parsed.model_dump(mode="json")
    with pytest.raises(ValidationError) as refused:
        cls.model_validate_json(json.dumps(with_null(model, field)))
    first = refused.value.errors()[0]
    assert (first["type"], first["loc"]) == ("null_not_allowed", (field,)), first


def test_a_null_is_named_where_it_is_nested_and_every_one_is_reported() -> None:
    anchor = copy.deepcopy(_anchor())
    page = next(i for i, s in enumerate(anchor["selectors"]) if s["type"] == "PageSelector")
    anchor["selectors"][page]["label"] = None
    anchor["subTarget"] = None
    body = {"highlight_id": "hl_01K0NULLNESTED000000000001", "color": "amber"}
    with pytest.raises(ValidationError) as refused:
        schemas.HighlightCreate.model_validate_json(
            json.dumps({**body, "anchors": [{"anchor": anchor}]})
        )
    # The selector's own null first (it is validated first); the anchor's once its fields pass.
    assert [(e["type"], e["loc"]) for e in refused.value.errors()] == [
        (
            "null_not_allowed",
            ("anchors", 0, "anchor", "selectors", page, "PageSelector", "label"),
        ),
    ]
    anchor["selectors"][page].pop("label")
    with pytest.raises(ValidationError) as refused:
        schemas.HighlightCreate.model_validate_json(
            json.dumps({**body, "anchors": [{"anchor": anchor}]})
        )
    assert [(e["type"], e["loc"]) for e in refused.value.errors()] == [
        ("null_not_allowed", ("anchors", 0, "anchor", "subTarget"))
    ]
    with pytest.raises(ValidationError) as both:
        schemas.NodePatch.model_validate_json('{"version": 1, "x": null, "body": null}')
    assert [e["loc"] for e in both.value.errors()] == [("x",), ("body",)]
    # The FakeAgent's parser (S5) is the same model: an agent frame with a null is not a frame.
    with pytest.raises(ValidationError):
        schemas.parse_agent_event("status", '{"phase": "tool", "tool": null}')
    assert schemas.parse_agent_event("status", '{"phase": "tool", "tool": "get_outline"}')
    # A nullable field is not an omittable one: `note: null` still clears the note.
    assert schemas.HighlightPatch.model_validate_json('{"note": null}').note is None


def test_an_explicit_null_never_reaches_the_store(tmp_path: Path) -> None:
    """S0 review M1, end to end. WATCHED FAILING: the three anchors below were each a 201 and
    STORED (and the stored record then failed `anchor-v1.schema.json`); `color: null` was the one
    null a route checked by hand. Every one is now the model's 422, and nothing is written."""

    def selector(anchor: dict[str, Any], kind: str) -> tuple[int, dict[str, Any]]:
        return next((i, s) for i, s in enumerate(anchor["selectors"]) if s["type"] == kind)

    def page(anchor: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        return selector(anchor, "PageSelector")

    def block(anchor: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        return selector(anchor, "BlockSelector")

    anchor = _anchor()
    at = "anchors.0.anchor"
    cases: dict[str, tuple[Any, str]] = {
        "subTarget": (lambda a: a.update(subTarget=None), f"{at}.subTarget"),
        "PageSelector.label": (
            lambda a: page(a)[1].update(label=None),
            f"{at}.selectors.{page(anchor)[0]}.PageSelector.label",
        ),
        "BlockSelector offsets": (
            lambda a: block(a)[1].update(startOffset=None, endOffset=None),
            f"{at}.selectors.{block(anchor)[0]}.BlockSelector.startOffset",
        ),
    }
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        url = f"/papers/{paper_id}/highlights"
        for n, (label, (mutate, where)) in enumerate(cases.items()):
            sent = copy.deepcopy(anchor)
            mutate(sent)
            body = {
                "highlight_id": f"hl_01K0NULLNEVERSTORED0000{n:02d}",
                "color": "amber",
                "anchors": [{"anchor": sent}],
            }
            found = assert_envelope(
                h.client.post(url, headers=auth(alice), json=body), 422, "validation_failed"
            )
            assert found["detail"] == f"{where}: {NULL_MESSAGE}", (label, found)
        assert h.client.get(url, headers=auth(alice)).json() == []

        created = h.client.post(
            url,
            headers=auth(alice),
            json={
                "highlight_id": "hl_01K0NULLNEVERSTORED000099",
                "color": "amber",
                "anchors": [{"anchor": anchor}],
            },
        )
        assert created.status_code == 201, created.text
        one = f"{url}/hl_01K0NULLNEVERSTORED000099"
        refused = assert_envelope(
            h.client.patch(one, headers=auth(alice), json={"color": None}), 422, "validation_failed"
        )
        assert refused["detail"] == f"color: {NULL_MESSAGE}"
        put = h.client.put(
            f"{url}/resolutions",
            headers=auth(alice),
            json={
                "generation": 1,
                "items": [
                    {
                        "anchor_id": anchor["id"],
                        "tier": 1,
                        "state": "anchored",
                        "block_ids": [],
                        "resolver_version": "anchoring@test",
                        "upgraded_anchor": None,
                    }
                ],
            },
        )
        refused = assert_envelope(put, 422, "validation_failed")
        assert refused["detail"] == f"items.0.upgraded_anchor: {NULL_MESSAGE}"
        (listed,) = h.client.get(url, headers=auth(alice)).json()
        assert listed["color"] == "amber" and listed["anchors"][0]["resolution"] is None


def test_times_serialise_in_the_one_wire_shape() -> None:
    record = _anchor()
    highlight = Highlight.model_validate(
        {
            "highlight_id": "hl_01K0WIRETIME000000000001",
            "color": "amber",
            "note": None,
            "created_generation": 1,
            "created_at": "2026-08-06T09:37:32.752375+00:00",
            "updated_at": "2026-08-06T09:37:33Z",
            "anchors": [
                {"anchor_id": record["id"], "ordinal": 0, "anchor": record, "resolution": None}
            ],
        },
        strict=False,
    )
    wire = highlight.model_dump(mode="json")
    assert wire["created_at"] == "2026-08-06T09:37:32.752Z"
    assert wire["updated_at"] == "2026-08-06T09:37:33.000Z"
