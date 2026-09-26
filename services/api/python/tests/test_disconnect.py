"""contracts.md §2.5: "A browser disconnect does the same [as cancel]".

Starlette's ``TestClient`` cannot drop a connection mid-stream, so this drives the ASGI app
directly: the ``receive`` channel answers ``http.disconnect`` as soon as the first answer text has
been sent, exactly what uvicorn does when the tab closes. The fake agent HOLDS its answer until it
receives ``DELETE /v1/runs/{id}``, so the run can only end if the disconnect reached the agent; the
test then waits for the row the broker writes after the agent's ``aborted`` ``done``.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import anyio
import httpx
from ai_support import SECRET, paragraph_anchor
from api_support import auth, register, seed_paper
from fake_agent import FakeAgent, Script
from fastapi.testclient import TestClient
from papertree_api import create_app
from papertree_api.settings import Settings


def test_a_browser_that_goes_away_cancels_the_run_and_the_partial_answer_is_kept(
    tmp_path: Path,
) -> None:
    settings = Settings(root=tmp_path / "data", agent_secret=SECRET, agent_url="http://agent.test")
    fake = FakeAgent(Script("explain-ok", hold_after_text=2), secret=SECRET)
    app = create_app(settings, agent_transport=fake.transport())
    fake.tools = httpx.ASGITransport(app=app, client=("127.0.0.1", 50125))
    with TestClient(app) as client:
        token = register(client, "alice@example.com")
        paper_id = seed_paper(settings, client, token, "resnet-cvpr-2col")
    body = json.dumps({"kind": "explain", "anchor": paragraph_anchor()}).encode()
    sent: list[bytes] = []

    async def main() -> str:
        saw_text = anyio.Event()
        request_sent = False

        async def receive() -> dict[str, Any]:
            nonlocal request_sent
            if not request_sent:
                request_sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            await saw_text.wait()
            return {"type": "http.disconnect"}

        async def send(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.body":
                chunk = message.get("body", b"")
                sent.append(chunk)
                if b"event: text" in chunk:
                    saw_text.set()

        scope: dict[str, Any] = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": f"/papers/{paper_id}/threads",
            "raw_path": f"/papers/{paper_id}/threads".encode(),
            "query_string": b"",
            "root_path": "",
            "headers": [
                (b"authorization", auth(token)["Authorization"].encode()),
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
            "client": ("127.0.0.1", 50126),
            "server": ("testserver", 80),
            "state": {},
        }
        with anyio.fail_after(30):
            await app(scope, receive, send)  # returns when the response is cancelled
            while True:  # the broker keeps reading to the agent's `done`, then writes the row
                status = _assistant_status(settings)
                if status not in (None, "streaming"):
                    return status
                await anyio.sleep(0.05)

    status = anyio.run(main)
    assert status == "aborted"
    assert len(fake.deletes) == 1, "the disconnect reached the agent as DELETE /v1/runs/{id}"
    assert fake.deletes[0] == fake.requests[0]["run_id"]
    assert b"event: done" not in b"".join(sent), "nothing is sent after the browser left"
    conn = sqlite3.connect(settings.database_file)
    content, error_code = conn.execute(
        "SELECT content, error_code FROM ai_messages WHERE role = 'assistant'"
    ).fetchone()
    (run_status,) = conn.execute("SELECT status FROM ai_runs").fetchone()
    conn.close()
    assert content and error_code == "aborted" and run_status == "aborted"


def _assistant_status(settings: Settings) -> str | None:
    conn = sqlite3.connect(settings.database_file)
    try:
        row = conn.execute("SELECT status FROM ai_messages WHERE role = 'assistant'").fetchone()
        return None if row is None else str(row[0])
    finally:
        conn.close()
