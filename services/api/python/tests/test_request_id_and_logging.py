"""contracts.md §0 request ids and §8 logs, observed from outside: headers and stdout.

every response            carries `X-Request-Id: req_<ULID>`, errors and preflights included
an incoming req_<ULID>    is echoed verbatim; anything else is replaced, and never logged
every request             writes exactly ONE `http.request` JSON line carrying that id, the
                          route TEMPLATE, the status, the time and — when a token resolved —
                          `user_ref = sha256(user_id)[:12]`; never an email, password or token
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pytest
from api_support import auth, harness, register, seed_paper
from papertree_api import create_app
from papertree_api.settings import Settings
from starlette.testclient import TestClient

REQUEST_ID = re.compile(r"^req_[0-9A-HJKMNP-TV-Z]{26}$")
WIRE_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
SLUG = "resnet-cvpr-2col"


def _lines(captured: str) -> list[dict[str, Any]]:
    """Every stdout line, each of which must be one JSON object: §8 is one JSON line per event."""
    out = []
    for line in captured.splitlines():
        if not line.strip():
            continue
        record = json.loads(line)  # a non-JSON line on stdout fails here, which is the point
        assert isinstance(record, dict), line
        out.append(record)
    return out


def _requests(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in records if r["event"] == "http.request"]


def test_every_response_carries_a_minted_request_id(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        seen = set()
        for response in (
            h.client.post("/auth/register", json={"email": "a@b.co", "password": "long enough"}),
            h.client.get("/papers"),  # 401
            h.client.get("/no/such/route"),  # 404 from the router
            h.client.delete("/papers"),  # 405
            h.client.post("/auth/register", json={"email": "x"}),  # 422
            h.client.options(
                "/papers",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "GET",
                },
            ),  # CORS preflight, answered by the CORS middleware itself
        ):
            request_id = response.headers.get("X-Request-Id")
            assert request_id is not None and REQUEST_ID.fullmatch(request_id), response
            seen.add(request_id)
        assert len(seen) == 6, "two requests shared an id"


def test_a_valid_incoming_id_is_echoed_and_anything_else_is_replaced(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    mine = "req_01K62ZX4Y6C0G6Y7T3N2E6Q9VB"
    with harness(tmp_path) as h:
        capsys.readouterr()
        assert h.client.get("/papers", headers={"X-Request-Id": mine}).headers["X-Request-Id"] == (
            mine
        )
        for forged in ("req_short", "../../etc/passwd", "req_01K62ZX4Y6C0G6Y7T3N2E6Q9VB-x", ""):
            got = h.client.get("/papers", headers={"X-Request-Id": forged}).headers["X-Request-Id"]
            assert got != forged and REQUEST_ID.fullmatch(got), (forged, got)
        out = capsys.readouterr().out
        assert "etc/passwd" not in out and "req_short" not in out
        assert mine in out


def test_one_json_line_per_request_with_the_contract_fields(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    email, password = "reader@example.com", "correct horse battery"
    with harness(tmp_path) as h:
        token = register(h.client, email, password)
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        paper_id = seed_paper(h.settings, h.client, token, SLUG)
        capsys.readouterr()

        ok = h.client.get(f"/papers/{paper_id}/highlights?gen=1", headers=auth(token))
        anonymous = h.client.get("/papers")
        records = _lines(capsys.readouterr().out)

    lines = _requests(records)
    assert len(lines) == 2, records
    first, second = lines
    assert first["request_id"] == ok.headers["X-Request-Id"]
    assert second["request_id"] == anonymous.headers["X-Request-Id"]
    for record in lines:
        assert WIRE_TIME.fullmatch(record["ts"]), record
        assert record["level"] == "info" and record["service"] == "api"
        assert isinstance(record["ms"], int | float) and record["ms"] >= 0
    assert first["method"] == "GET" and first["status"] == 200
    # The TEMPLATE, never the concrete path or the query string.
    assert first["route"] == "/papers/{paper_id}/highlights"
    assert first["user_ref"] == hashlib.sha256(user_id.encode()).hexdigest()[:12]
    assert second["status"] == 401 and "user_ref" not in second
    assert set(first) <= {
        "ts",
        "level",
        "service",
        "event",
        "request_id",
        "method",
        "route",
        "status",
        "ms",
        "user_ref",
    }


def test_no_email_password_token_or_query_string_is_ever_logged(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    email, password = "secret-reader@example.com", "a very private passphrase"
    with harness(tmp_path) as h:
        token = register(h.client, email, password)
        login = h.client.post("/auth/login", json={"email": email, "password": password})
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        paper_id = seed_paper(h.settings, h.client, token, SLUG)
        h.client.get(f"/papers/{paper_id}/assets/figures/blk_x?gen=1&sig=SIGSECRET&exp=1")
        h.client.post("/auth/login", json={"email": email, "password": "wrong but private"})
        out = capsys.readouterr().out
    for secret in (
        email,
        password,
        "wrong but private",
        token,
        login.json()["token"],
        user_id,
        "SIGSECRET",
    ):
        assert secret not in out, f"{secret!r} reached the log"
    assert len(_requests(_lines(out))) >= 6


def test_a_500_is_logged_once_by_class_and_place_with_its_request_id(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    app = create_app(Settings(root=tmp_path / "data"))

    async def boom() -> None:
        raise RuntimeError("a message that names a private value: hunter2")

    app.add_api_route("/__test/boom", boom)
    with TestClient(app, raise_server_exceptions=False) as client:
        capsys.readouterr()
        response = client.get("/__test/boom", headers={"Origin": "http://localhost:3000"})
        out = capsys.readouterr().out
    assert response.status_code == 500
    # The 500 is rendered INSIDE CORS, so a cross-origin reader can read the envelope.
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.json()["code"] == "internal"
    request_id = response.headers["X-Request-Id"]
    records = _lines(out)
    [error] = [r for r in records if r["event"] == "http.error"]
    [access] = _requests(records)
    assert error["request_id"] == access["request_id"] == request_id
    assert error["level"] == "error" and error["error_type"] == "RuntimeError"
    assert error["where"].startswith("test_request_id_and_logging.py:boom:"), error
    assert access["status"] == 500 and access["route"] == "/__test/boom"
    assert "hunter2" not in out and "hunter2" not in response.text


def test_the_browser_can_read_the_request_id(tmp_path: Path) -> None:
    """A cross-origin `fetch` only exposes the headers CORS lists in Access-Control-Expose-Headers;
    without it the web client could never quote a request id to anyone."""
    with harness(tmp_path) as h:
        response = h.client.get("/papers", headers={"Origin": "http://localhost:3000"})
        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
        assert "x-request-id" in response.headers["access-control-expose-headers"].lower()


def test_the_logger_refuses_a_field_outside_the_allowlist() -> None:
    """The allowlist is the mechanism behind "never an email or a token": there is no keyword to
    pass one through. A typo'd or new field fails loudly in tests rather than logging silently."""
    from papertree_api.logging import log_event

    with pytest.raises(TypeError, match="email"):
        log_event("http.request", email="someone@example.com")
