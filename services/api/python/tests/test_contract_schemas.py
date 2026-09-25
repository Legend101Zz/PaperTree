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
