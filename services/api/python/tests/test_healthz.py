"""contracts.md §2.8: `GET /healthz` = `{ok, version, db: "ok", migrations: [1,2,3,4,5],
agent: {reachable, key_present, sdk}}`. No auth, no secrets, and an absent agent is a FACT the body
reports, never an error: the reader works without the agent, so health must not say otherwise.

The agent here is a real HTTP server on a loopback port (stdlib `http.server` in a thread), so the
probe is exercised over a socket, not a mock of httpx.
"""

from __future__ import annotations

import json
import socket
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from api_support import harness
from papertree_api.schemas import Healthz
from papertree_api.settings import Settings
from papertree_db import load_migrations

AGENT_HEALTH = {
    "ok": True,
    "sdk": "pi-coding-agent@0.87.1",
    "pi_ai": "0.87.1",
    "model": "minimax/MiniMax-M3",
    "key_present": True,
    "wiring_ok": True,
    "active_runs": 0,
}


def _closed_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@contextmanager
def fake_agent(status: int = 200, body: bytes | None = None, hang: float = 0.0) -> Iterator[Any]:
    seen: list[dict[str, str]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 (the stdlib's name)
            seen.append({"path": self.path, **{k.lower(): v for k, v in self.headers.items()}})
            if hang:
                time.sleep(hang)
            payload = json.dumps(AGENT_HEALTH).encode() if body is None else body
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args: Any) -> None:  # keep test output clean
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        server.seen = seen  # type: ignore[attr-defined]
        yield server
    finally:
        server.shutdown()
        server.server_close()


def _settings(tmp_path: Path, agent_url: str) -> Settings:
    return Settings(
        root=tmp_path / "data",
        agent_url=agent_url,
        agent_secret="AGENT-SECRET-NEVER-SENT-BY-HEALTHZ",
        signing_secret="SIGNING-SECRET-NEVER-SENT",
    )


def test_healthz_without_an_agent_is_200_and_says_so(tmp_path: Path) -> None:
    settings = _settings(tmp_path, f"http://127.0.0.1:{_closed_port()}")
    with harness(tmp_path, settings=settings) as h:
        started = time.monotonic()
        response = h.client.get("/healthz")  # no Authorization header
        elapsed = time.monotonic() - started
    assert response.status_code == 200, response.text
    body = response.json()
    Healthz.model_validate(body)
    assert body == {
        "ok": True,
        "version": "1.0.0",
        "db": "ok",
        "migrations": [m.version for m in load_migrations()],
        "agent": {"reachable": False, "key_present": None, "sdk": None},
    }
    assert body["migrations"] == [1, 2, 3, 4, 5]
    assert elapsed < 3.0, f"an absent agent made /healthz take {elapsed:.1f}s"
    assert "SECRET" not in response.text


def test_healthz_reports_what_a_reachable_agent_says(tmp_path: Path) -> None:
    with fake_agent() as agent:
        settings = _settings(tmp_path, f"http://127.0.0.1:{agent.server_port}")
        with harness(tmp_path, settings=settings) as h:
            response = h.client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["agent"] == {
        "reachable": True,
        "key_present": True,
        "sdk": "pi-coding-agent@0.87.1",
    }
    [probe] = agent.seen
    assert probe["path"] == "/healthz"
    # The request id is forwarded (contracts.md §0); the agent secret is not needed and not sent.
    assert probe["x-request-id"] == response.headers["X-Request-Id"]
    assert "x-papertree-agent-secret" not in probe
    assert "SECRET" not in response.text


def test_a_broken_or_slow_agent_is_unreachable_not_an_error(tmp_path: Path) -> None:
    cases: list[dict[str, Any]] = [
        {"status": 500},
        {"body": b"<html>not json</html>"},
        {"body": b"[1, 2, 3]"},
        {"hang": 3.0},
    ]
    for index, case in enumerate(cases):
        with fake_agent(**case) as agent:
            root = tmp_path / f"case{index}"
            settings = _settings(root, f"http://127.0.0.1:{agent.server_port}")
            with harness(root, settings=settings) as h:
                started = time.monotonic()
                response = h.client.get("/healthz")
                elapsed = time.monotonic() - started
        assert response.status_code == 200, (case, response.text)
        assert response.json()["agent"] == {
            "reachable": False,
            "key_present": None,
            "sdk": None,
        }, case
        assert response.json()["ok"] is True
        assert elapsed < 2.5, (case, elapsed)


def test_an_unreadable_database_is_the_one_failure(tmp_path: Path) -> None:
    """Nothing this process serves works without its database, so this — and only this — is a
    non-2xx, and it is the §0 envelope like every other one."""
    settings = _settings(tmp_path, f"http://127.0.0.1:{_closed_port()}")
    with harness(tmp_path, settings=settings) as h:
        for suffix in ("", "-wal", "-shm"):
            Path(f"{settings.database_file}{suffix}").unlink(missing_ok=True)
        response = h.client.get("/healthz")
    assert response.status_code == 503
    assert response.json() == {
        "detail": "The database is not readable.",
        "code": "internal",
        "retryable": True,
    }
