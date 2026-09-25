"""contracts.md §9 `test_contract_schemas_match_models`: the committed `contracts/api/*.schema.json`
are what `schemas.py` exports today. A model changed without re-exporting fails here, naming the
file; so does a hand edit to a generated file, and so does a file nobody exports any more.

Compared as PARSED JSON, so prettier's formatting of the files is not drift (see `contracts.py`).
"""

from __future__ import annotations

import json
from pathlib import Path

from papertree_api import contracts
from papertree_api.schemas import SseStatus

CONTRACTS_API = Path(__file__).resolve().parents[4] / "contracts" / "api"


def test_contract_schemas_match_models() -> None:
    problems = contracts.drift(CONTRACTS_API)
    assert not problems, (
        f"{problems}: re-export with `uv run python -m papertree_api.contracts export`, then "
        "`pnpm exec prettier --write contracts/api`, and review the diff"
    )


def test_the_drift_check_sees_a_changed_model(tmp_path: Path) -> None:
    """Non-vacuity: export into a scratch dir, change ONE committed model's schema, and the check
    names the file."""
    contracts.export(tmp_path)
    assert contracts.drift(tmp_path) == []
    sse = tmp_path / "sse.schema.json"
    schema = json.loads(sse.read_text(encoding="utf-8"))
    schema["$defs"]["SseStatus"]["required"].append("label")
    sse.write_text(json.dumps(schema), encoding="utf-8")
    assert contracts.drift(tmp_path) == ["stale: sse.schema.json"]
    (tmp_path / "gone.schema.json").write_text("{}", encoding="utf-8")
    (tmp_path / "boards.schema.json").unlink()
    assert sorted(contracts.drift(tmp_path)) == [
        "extra: gone.schema.json",
        "missing: boards.schema.json",
        "stale: sse.schema.json",
    ]


def test_every_group_names_the_models_the_web_reads() -> None:
    """`contracts.spec.ts` looks models up as `$defs[<name>]`: a renamed model breaks a lookup."""
    rendered = contracts.render_all()
    for name, schema in rendered.items():
        stem = name.removesuffix(".schema.json")
        for model, _ in contracts.GROUPS[stem]:
            assert model.__name__ in schema["$defs"], (name, model.__name__)
    assert rendered["sse.schema.json"]["$defs"]["SseStatus"]["required"] == ["phase"]
    assert SseStatus.__name__ == "SseStatus"


def test_a_real_highlight_response_validates_against_the_exported_schema(tmp_path: Path) -> None:
    """The exported file describes what the route sends: a real `POST …/highlights` response, and
    the list, validate against `highlights.schema.json`, and a response with a stray key does not.
    (`jsonschema_lite` refuses keywords it does not implement, so this exercises every keyword
    pydantic emitted for these models.)"""
    from api_support import auth, harness, register, seed_paper
    from jsonschema_lite import validate

    schema = json.loads((CONTRACTS_API / "highlights.schema.json").read_text(encoding="utf-8"))
    anchor = json.loads(
        (
            Path(__file__).resolve().parents[4]
            / "packages/db/python/tests/data/capture_anchor_resnet.json"
        ).read_text(encoding="utf-8")
    )["anchor"]
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, "resnet-cvpr-2col")
        created = h.client.post(
            f"/papers/{paper_id}/highlights",
            headers=auth(alice),
            json={
                "highlight_id": "hl_01K0EXPORTEDSCHEMA0000001",
                "color": "green",
                "note": "the grid",
                "anchors": [{"anchor": anchor}],
                "resolutions": [
                    {
                        "anchor_id": anchor["id"],
                        "generation": 1,
                        "tier": 1,
                        "state": "anchored",
                        "block_ids": [anchor["selectors"][0]["blockId"]],
                        "score": 1.0,
                        "resolver_version": "anchoring@test",
                    }
                ],
            },
        ).json()
        listed = h.client.get(f"/papers/{paper_id}/highlights", headers=auth(alice)).json()
    assert validate(created, schema, "#/$defs/Highlight") == []
    for item in listed:
        assert validate(item, schema, "#/$defs/Highlight") == []
    assert validate({**created, "owner_id": "own_x"}, schema, "#/$defs/Highlight")
    assert validate({**created, "color": "red"}, schema, "#/$defs/Highlight")
    stale = {**created, "created_at": "2026-09-25T15:09:25.123456+00:00"}
    assert validate(stale, schema, "#/$defs/Highlight"), "the time pattern must bite"
