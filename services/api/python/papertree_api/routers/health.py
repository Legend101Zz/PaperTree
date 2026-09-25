"""contracts.md §2.8: `GET /healthz`. No auth, no secrets, never an error for an absent agent.

    {"ok": true, "version": "1.0.0", "db": "ok", "migrations": [1, 2, 3, 4, 5],
     "agent": {"reachable": false, "key_present": null, "sdk": null}}

`ok` is "the database answers and every migration on disk is applied". The agent is REPORTED, not
required: the reader, the library and highlights all work without it (only the AI routes answer
503), so an unreachable agent is `reachable: false` in a 200. The one failure that is a non-2xx is
a database that cannot be read at all — then there is nothing this process can serve, and the
answer is the §0 envelope, 503.

THE AGENT PROBE is a plain `GET {PAPERTREE_AGENT_URL}/healthz` with a short timeout (connect
0.5 s, whole call 1 s), so an agent that accepts and never answers costs one second, not the
caller's patience. It carries the request id (contracts.md §0: forwarded to the agent) and NOT the
agent secret: health needs no authority. `trust_env=False`, because the agent is on loopback and a
developer's `HTTP_PROXY` must not route the probe through a proxy.
"""

from __future__ import annotations

import sqlite3
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Final

import httpx
from fastapi import APIRouter, Request
from papertree_db import load_migrations

from ..deps import SettingsDep
from ..errors import ApiError
from ..middleware import REQUEST_ID_HEADER
from ..schemas import AgentHealth, Healthz

router = APIRouter()

AGENT_CONNECT_SECONDS: Final = 0.5
AGENT_PROBE_SECONDS: Final = 1.0
#: An agent's `sdk` string is echoed; bounded, since it is another process's text.
MAX_SDK_CHARS: Final = 120

UNKNOWN_AGENT: Final = AgentHealth(reachable=False, key_present=None, sdk=None)


def _package_version() -> str:
    try:
        return version("papertree-api")
    except PackageNotFoundError:  # pragma: no cover - the workspace always installs it
        return "unknown"


def _applied_migrations(database_file: Path) -> list[int]:
    """The applied versions, read on a READ-ONLY connection: health never writes."""
    uri = f"{database_file.resolve().as_uri()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        rows = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
    finally:
        conn.close()
    return [int(row[0]) for row in rows]


async def probe_agent(agent_url: str, request_id: str | None) -> AgentHealth:
    headers = {REQUEST_ID_HEADER: request_id} if request_id else {}
    timeout = httpx.Timeout(AGENT_PROBE_SECONDS, connect=AGENT_CONNECT_SECONDS)
    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            response = await client.get(f"{agent_url}/healthz", headers=headers)
        body = response.json() if response.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return UNKNOWN_AGENT
    if not isinstance(body, dict):
        return UNKNOWN_AGENT
    key_present = body.get("key_present")
    sdk = body.get("sdk")
    return AgentHealth(
        reachable=True,
        key_present=key_present if isinstance(key_present, bool) else None,
        sdk=sdk[:MAX_SDK_CHARS] if isinstance(sdk, str) else None,
    )


@router.get("/healthz", response_model=Healthz)
async def healthz(request: Request, settings: SettingsDep) -> Healthz:
    try:
        applied = _applied_migrations(settings.database_file)
    except sqlite3.Error as exc:
        raise ApiError(
            "internal", "The database is not readable.", status=503, retryable=True
        ) from exc
    on_disk = [migration.version for migration in load_migrations()]
    agent = await probe_agent(settings.agent_url, getattr(request.state, "request_id", None))
    return Healthz(
        ok=applied == on_disk,
        version=_package_version(),
        db="ok",
        migrations=applied,
        agent=agent,
    )
