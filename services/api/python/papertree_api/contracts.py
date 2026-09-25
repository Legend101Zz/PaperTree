"""`contracts/api/*.schema.json`, exported from `schemas.py` (contracts.md §0, "Wire-contract
files").

    uv run python -m papertree_api.contracts export   # (re)write the files that changed
    uv run python -m papertree_api.contracts check    # exit 1 if a committed file drifted

One file per group of routes, each a JSON Schema (draft 2020-12) whose `$defs` hold every model
of that group and everything they reference. Responses are exported in pydantic's
`serialization` mode (what goes on the wire), requests in `validation` mode (what is accepted).

The drift test (`tests/test_contract_schemas.py`) compares PARSED JSON, not bytes, so the files
can be formatted by prettier (which `prettier --check .` requires of every JSON file under
`contracts/`): `export` rewrites only a file whose content changed, and says to run prettier on
what it wrote. A formatting difference is never drift; a changed model always is.

No new dependency: this is pydantic's own `models_json_schema`. The TypeScript side validates the
same files with ajv (`apps/web/test/contracts.spec.ts`).
"""

from __future__ import annotations

import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Final, Literal

from pydantic import BaseModel
from pydantic.json_schema import GenerateJsonSchema, models_json_schema

from . import schemas as s
from .errors import ErrorEnvelope

Mode = Literal["validation", "serialization"]
OUT: Final[Mode] = "serialization"
IN: Final[Mode] = "validation"

#: file stem -> (model, mode). The web's contracts.spec.ts reads `$defs[<model name>]`.
GROUPS: Final[dict[str, tuple[tuple[type[BaseModel], Mode], ...]]] = {
    "errors": ((ErrorEnvelope, OUT), (s.StaleVersion, OUT)),
    "auth": ((s.Credentials, IN), (s.Session, OUT), (s.Me, OUT)),
    "papers": (
        (s.LibraryPaper, OUT),
        (s.JobSummary, OUT),
        (s.UploadAccepted, OUT),
        (s.JobAccepted, OUT),
        (s.JobStatus, OUT),
        (s.ReparseRequest, IN),
    ),
    "highlights": (
        (s.Highlight, OUT),
        (s.AnchorWire, OUT),
        (s.ResolutionWire, OUT),
        (s.HighlightCreate, IN),
        (s.HighlightPatch, IN),
        (s.ResolutionsPut, IN),
    ),
    "threads": (
        (s.Thread, OUT),
        (s.ThreadDetail, OUT),
        (s.Message, OUT),
        (s.Citation, OUT),
        (s.RunSummary, OUT),
        (s.ThreadCreate, IN),
        (s.FollowUp, IN),
    ),
    # §2.6: the `data` of each browser-facing event; `usage` is `RunSummary`.
    "sse": (
        (s.SseRun, OUT),
        (s.SseStatus, OUT),
        (s.SseText, OUT),
        (s.SseCitations, OUT),
        (s.RunSummary, OUT),
        (s.SseDone, OUT),
    ),
    "summary": ((s.Summary, OUT), (s.SummaryStatus, OUT), (s.SummaryRequest, IN)),
    "usage": ((s.UsageTotals, OUT), (s.UsageBucket, OUT)),
    "boards": (
        (s.Board, OUT),
        (s.CanvasNode, OUT),
        (s.CanvasEdge, OUT),
        (s.BoardView, OUT),
        (s.NodeCreated, OUT),
        (s.NodeCreate, IN),
        (s.NodePatch, IN),
        (s.EdgeCreate, IN),
        (s.EdgePatch, IN),
        (s.BoardPatch, IN),
    ),
    "healthz": ((s.Healthz, OUT),),
    "internal": ((s.ToolResult, OUT),),
}

DIALECT: Final = "https://json-schema.org/draft/2020-12/schema"
#: `services/api/python/papertree_api/contracts.py` -> the repo root.
REPO_ROOT: Final = Path(__file__).resolve().parents[4]
OUT_DIR: Final = REPO_ROOT / "contracts" / "api"


class _Generator(GenerateJsonSchema):
    """pydantic's generator, minus two things: a `title` on every PROPERTY (`"Blockid"` beside
    `blockId` is noise; models keep theirs), and OpenAPI's `discriminator` keyword, which is not
    JSON Schema — ajv's strict mode refuses it. The `oneOf` it annotates stays, and is exact on
    its own: every branch pins `type` with a `const`."""

    def field_title_should_be_set(self, schema: Any) -> bool:
        return False


def _strip(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _strip(item) for key, item in value.items() if key != "discriminator"}
    if isinstance(value, list):
        return [_strip(item) for item in value]
    return value


def render(stem: str) -> dict[str, Any]:
    models = GROUPS[stem]
    _, top = models_json_schema(
        list(models), ref_template="#/$defs/{model}", schema_generator=_Generator
    )
    names = [model.__name__ for model, _ in models]
    return {
        "$schema": DIALECT,
        "title": f"PaperTree API contract: {stem}",
        "description": (
            "GENERATED from services/api/python/papertree_api/schemas.py by "
            "`uv run python -m papertree_api.contracts export` (contracts.md §0). Do not edit: "
            "change the model and re-export. Models: " + ", ".join(names) + "."
        ),
        "$defs": _strip(top["$defs"]),
    }


def render_all() -> dict[str, dict[str, Any]]:
    return {f"{stem}.schema.json": render(stem) for stem in GROUPS}


def drift(out_dir: Path = OUT_DIR) -> list[str]:
    """Files that are missing, stale or extra, by name. Empty: the committed copy is current."""
    expected = render_all()
    present = {path.name for path in out_dir.glob("*.schema.json")} if out_dir.is_dir() else set()
    problems = [f"extra: {name}" for name in sorted(present - expected.keys())]
    for name, schema in expected.items():
        path = out_dir / name
        if not path.is_file():
            problems.append(f"missing: {name}")
        elif json.loads(path.read_text(encoding="utf-8")) != schema:
            problems.append(f"stale: {name}")
    return problems


def export(out_dir: Path = OUT_DIR) -> list[Path]:
    """Writes every file whose parsed content differs (and removes extras). Returns what changed."""
    out_dir.mkdir(parents=True, exist_ok=True)
    expected = render_all()
    written: list[Path] = []
    for name, schema in expected.items():
        path = out_dir / name
        current = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None
        if current != schema:
            path.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", "utf-8")
            written.append(path)
    for path in out_dir.glob("*.schema.json"):
        if path.name not in expected:
            path.unlink()
            written.append(path)
    return written


def main(argv: Sequence[str]) -> int:
    command = argv[0] if argv else ""
    if command == "export":
        changed = export()
        for path in changed:
            print(f"wrote {path.relative_to(REPO_ROOT)}")
        if changed:
            print("now format them: pnpm exec prettier --write contracts/api")
        else:
            print("contracts/api is current; nothing written")
        return 0
    if command == "check":
        problems = drift()
        for problem in problems:
            print(problem, file=sys.stderr)
        return 1 if problems else 0
    print("usage: python -m papertree_api.contracts export|check", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
