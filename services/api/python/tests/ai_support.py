"""The AI routes' test harness: the real app, a ``FakeAgent`` replaying the contract fixtures, and
the fake's tool calls going back into the SAME app (contracts.md §4) from a loopback address.

    browser (TestClient) ──▶ app ──agent_transport──▶ FakeAgent ──ASGITransport(127.0.0.1)──▶ app

Nothing here opens a socket. The fake's tool requests arrive at ``/internal/agent/runs/…`` from
``127.0.0.1`` exactly as the real agent's would, with the run token the API minted, so the loopback
guard, the run grant, the handle table and the cap all run inside every AI test.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from api_support import auth, load_fixture, register, seed_paper
from fake_agent import FakeAgent, Script
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jsonschema_lite import validate
from papertree_anchoring import capture_anchor, index_document
from papertree_api import create_app
from papertree_api.settings import Settings
from papertree_document_ir import Paper
from pydantic import BaseModel

SECRET = "test-agent-secret-not-a-real-one"
CONTRACTS = Path(__file__).resolve().parents[4] / "contracts"
#: The smallest committed fixture paper (`test_isolation.py` uses it too).
SLUG = "resnet-cvpr-2col"


@dataclass
class AiHarness:
    client: TestClient
    settings: Settings
    fake: FakeAgent
    app: FastAPI

    def rows(self, sql: str, *params: Any) -> list[dict[str, Any]]:
        """A read of the real database file, beside the app (tests observe rows, not only JSON)."""
        conn = sqlite3.connect(self.settings.database_file)
        conn.row_factory = sqlite3.Row
        try:
            return [dict(row) for row in conn.execute(sql, params).fetchall()]
        finally:
            conn.close()

    def count(self, table: str) -> int:
        return int(self.rows(f"SELECT COUNT(*) AS n FROM {table}")[0]["n"])


@contextmanager
def ai_harness(
    tmp_path: Path,
    scripts: Script | Iterable[Script],
    *,
    budget_usd: float = 1.0,
    agent_secret: str = SECRET,
) -> Iterator[AiHarness]:
    settings = Settings(
        root=tmp_path / "data",
        agent_secret=agent_secret,
        agent_url="http://agent.test",
        daily_budget_usd=budget_usd,
        api_internal_url="http://127.0.0.1:8000",
    )
    fake = FakeAgent(scripts, secret=SECRET)
    app = create_app(settings, agent_transport=fake.transport())
    fake.tools = httpx.ASGITransport(app=app, client=("127.0.0.1", 50123))
    with TestClient(app) as client:
        yield AiHarness(client=client, settings=settings, fake=fake, app=app)


@dataclass(frozen=True)
class SseFrame:
    event: str
    data: dict[str, Any]


def read_sse(response: httpx.Response) -> tuple[list[SseFrame], int]:
    """``(frames, pings)`` of a complete §0-framed stream; asserts the framing."""
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream"), response.headers
    text = response.text
    assert text.endswith("\n\n"), text[-200:]
    frames: list[SseFrame] = []
    pings = 0
    for block in text[:-2].split("\n\n"):
        if block == ": ping":
            pings += 1
            continue
        event_line, data_line = block.split("\n")
        assert event_line.startswith("event: ") and data_line.startswith("data: "), block
        frames.append(SseFrame(event_line[7:], json.loads(data_line[6:])))
    return frames, pings


def events(frames: list[SseFrame], name: str) -> list[dict[str, Any]]:
    return [f.data for f in frames if f.event == name]


def paragraph_anchor(
    slug: str = SLUG, *, nth: int = 3, needle: str | None = None
) -> dict[str, Any]:
    """A real Anchor v1 over a body paragraph of a committed fixture paper, minted by
    ``papertree_anchoring`` the way a reader capture is recorded (IR-stamped: BlockSelector,
    TextQuote, Shape, …). ``nth`` picks the paragraph; ``needle`` picks one containing it."""
    document = load_fixture(slug)
    paper = Paper.model_validate(document)
    indexed = index_document(
        paper, f"api/{paper.paper_id}/g{paper.generation}/{paper.parser.version}"
    )
    paragraphs = [
        b.block.block_id
        for b in indexed.blocks
        if b.block.type == "paragraph"
        and len(b.text) > 120
        and (needle is None or needle in b.text)
    ]
    anchor = dict(
        capture_anchor(
            indexed,
            paragraphs[0 if needle else nth],
            anchor_id=str(uuid.uuid4()),
            at="2026-09-26T05:00:00.000Z",
            client="api-tests",
        )
    )
    return anchor


def block_of(anchor: dict[str, Any]) -> str:
    return str(next(s["blockId"] for s in anchor["selectors"] if s["type"] == "BlockSelector"))


def alice_with_paper(h: AiHarness, email: str = "alice@example.com") -> tuple[str, str]:
    token = register(h.client, email)
    return token, seed_paper(h.settings, h.client, token, SLUG)


def explain(
    h: AiHarness, token: str, paper_id: str, anchor: dict[str, Any], question: str | None = None
) -> httpx.Response:
    body: dict[str, Any] = {"kind": "explain", "anchor": anchor}
    if question is not None:
        body["question"] = question
    response: httpx.Response = h.client.post(
        f"/papers/{paper_id}/threads",
        json=body,
        headers={**auth(token), "Accept": "text/event-stream"},
    )
    return response


def contract_errors(value: Any, schema_file: str, name: str, model: type[BaseModel]) -> list[str]:
    """A wire value held to BOTH checkers of its contract: ``contracts/<schema_file>``'s
    ``$defs[name]`` (``jsonschema_lite``) and the pydantic model, on its JSON (the wire form)."""
    root = json.loads((CONTRACTS / schema_file).read_text(encoding="utf-8"))
    errors = validate(value, root, f"#/$defs/{name}")
    try:
        model.model_validate_json(json.dumps(value))
    except ValueError as exc:
        errors.append(f"pydantic {model.__name__}: {exc}")
    return errors


def anchor_errors(anchor: Any) -> list[str]:
    """``contracts/anchor/anchor-v1.schema.json`` (the root) and ``AnchorV1``."""
    from papertree_api.schemas import AnchorV1

    root = json.loads((CONTRACTS / "anchor" / "anchor-v1.schema.json").read_text(encoding="utf-8"))
    errors = validate(anchor, root)
    try:
        AnchorV1.model_validate_json(json.dumps(anchor))
    except ValueError as exc:
        errors.append(f"pydantic AnchorV1: {exc}")
    return errors
