"""contracts.md §0 / §9 `test_error_envelope_shape`: EVERY non-2xx JSON response is the envelope.

    {"detail": "a sentence, safe to show", "code": "<ErrorCode, §2.9>", "retryable": false}

One test per way a non-2xx is produced, because they are produced by different machinery and each
one has to be wired separately: a route's own refusal, the auth dependency, FastAPI's request
validation, Starlette's router (unknown path, wrong method), a data-layer exception that escaped a
route, and an exception nobody anticipated. The last one must not leak what it was.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, get_args

from api_support import auth, harness, register, seed_paper
from papertree_api import create_app
from papertree_api.errors import ERROR_STATUS, ErrorCode
from papertree_api.settings import Settings
from papertree_db import GenerationNotFound, HighlightRejected, PaperNotFound
from starlette.testclient import TestClient

SLUG = "resnet-cvpr-2col"

#: contracts.md §2.9, verbatim: code -> status.
CONTRACT_CODES: dict[ErrorCode, int] = {
    "auth_required": 401,
    "invalid_credentials": 401,
    "email_taken": 409,
    "not_found": 404,
    "validation_failed": 422,
    "empty_upload": 400,
    "payload_too_large": 413,
    "unsupported_media_type": 415,
    "not_parsed": 409,
    "not_failed": 409,
    "busy": 409,
    "stale_version": 409,
    "generation_not_found": 409,
    "anchor_incomplete": 422,
    "anchor_mismatch": 422,
    "budget_exhausted": 429,
    "agent_unavailable": 503,
    "not_configured": 503,
    "internal": 500,
}


def assert_envelope(response: Any, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith("application/json"), response.headers
    body: dict[str, Any] = response.json()
    assert set(body) == {"detail", "code", "retryable"}, body
    assert body["code"] == code, body
    assert body["code"] in get_args(ErrorCode)
    assert isinstance(body["retryable"], bool)
    assert isinstance(body["detail"], str) and body["detail"].strip(), body
    return body


def test_the_error_enum_is_the_contracts_enum() -> None:
    codes = set(get_args(ErrorCode))
    assert CONTRACT_CODES.keys() <= codes
    for code, status in CONTRACT_CODES.items():
        assert ERROR_STATUS[code] == status, code
    assert set(ERROR_STATUS) == codes


def test_auth_errors_are_envelopes(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        missing = assert_envelope(h.client.get("/papers"), 401, "auth_required")
        assert "token" in missing["detail"]
        assert h.client.get("/papers").headers["WWW-Authenticate"] == "Bearer"
        assert_envelope(h.client.get("/papers", headers=auth("forged")), 401, "auth_required")

        register(h.client, "alice@example.com")
        assert_envelope(
            h.client.post(
                "/auth/register", json={"email": "alice@example.com", "password": "12345678"}
            ),
            409,
            "email_taken",
        )
        bad_login = h.client.post(
            "/auth/login", json={"email": "alice@example.com", "password": "not the password"}
        )
        assert_envelope(bad_login, 401, "invalid_credentials")
        assert bad_login.headers["WWW-Authenticate"] == "Bearer"


def test_request_validation_is_validation_failed_naming_the_first_failing_field(
    tmp_path: Path,
) -> None:
    with harness(tmp_path) as h:
        short = assert_envelope(
            h.client.post("/auth/register", json={"email": "a@b.co", "password": "short"}),
            422,
            "validation_failed",
        )
        assert short["detail"].startswith("password: "), short
        assert "short" not in short["detail"], "the rejected value must never be echoed back"
        no_email = assert_envelope(
            h.client.post("/auth/register", json={"password": "long enough"}),
            422,
            "validation_failed",
        )
        assert no_email["detail"].startswith("email: "), no_email
        not_json = assert_envelope(
            h.client.post(
                "/auth/register",
                content=b"{nope",
                headers={"Content-Type": "application/json"},
            ),
            422,
            "validation_failed",
        )
        assert not_json["detail"].startswith("body: "), not_json

        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        page = assert_envelope(
            h.client.get(f"/papers/{paper_id}/blocks?page=-1", headers=auth(alice)),
            422,
            "validation_failed",
        )
        assert page["detail"].startswith("page: "), page


def test_route_refusals_are_envelopes(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)

        assert_envelope(h.client.get(f"/papers/{paper_id}", headers=auth(bob)), 404, "not_found")
        assert_envelope(h.client.get(f"/papers/{paper_id}/ir", headers=auth(bob)), 404, "not_found")
        assert_envelope(h.client.get("/jobs/job_nope", headers=auth(alice)), 404, "not_found")
        assert_envelope(
            h.client.post(
                "/papers", files={"file": ("x.pdf", b"", "application/pdf")}, headers=auth(alice)
            ),
            400,
            "empty_upload",
        )
        assert_envelope(
            h.client.post(
                "/papers",
                files={"file": ("x.pdf", b"not a pdf", "application/pdf")},
                headers=auth(alice),
            ),
            415,
            "unsupported_media_type",
        )
        # /ask without a model key: the provider is not configured, which is §2.9's own code.
        assert_envelope(
            h.client.post(
                f"/papers/{paper_id}/ask",
                headers=auth(alice),
                json={"question": "q", "block_ids": ["blk_x"]},
            ),
            503,
            "not_configured",
        )


def test_router_errors_are_envelopes(tmp_path: Path) -> None:
    """Starlette answers these before any route runs, so a per-route envelope never sees them."""
    with harness(tmp_path) as h:
        assert_envelope(h.client.get("/no/such/route"), 404, "not_found")
        wrong_method = h.client.delete("/papers")
        assert_envelope(wrong_method, 405, "not_found")
        # Starlette's own `Allow` (it names the first route that matched the path) is kept.
        assert wrong_method.headers["Allow"]


def _app_with_raising_routes(tmp_path: Path) -> TestClient:
    app = create_app(Settings(root=tmp_path / "data"))

    async def unforeseen() -> None:
        # What a real one looks like: a driver error whose text names internals.
        raise sqlite3.OperationalError(
            "no such table: secret_internal_table (/Users/someone/.papertree/papertree.sqlite)"
        )

    async def rejected() -> None:
        raise HighlightRejected("anchor_mismatch", "doc.paperId is not this paper")

    async def paper_missing() -> None:
        raise PaperNotFound("ppr_X")

    async def generation_missing() -> None:
        raise GenerationNotFound("generation 9 of ppr_X")

    app.add_api_route("/__test/unforeseen", unforeseen)
    app.add_api_route("/__test/rejected", rejected)
    app.add_api_route("/__test/paper-missing", paper_missing)
    app.add_api_route("/__test/generation-missing", generation_missing)
    return TestClient(app, raise_server_exceptions=False)


def test_data_layer_refusals_that_escape_a_route_map_to_their_contract_codes(
    tmp_path: Path,
) -> None:
    with _app_with_raising_routes(tmp_path) as client:
        body = assert_envelope(client.get("/__test/rejected"), 422, "anchor_mismatch")
        assert body["detail"] == "doc.paperId is not this paper"
        assert_envelope(client.get("/__test/paper-missing"), 404, "not_found")
        assert_envelope(client.get("/__test/generation-missing"), 409, "generation_not_found")


def test_an_unforeseen_exception_is_500_internal_and_leaks_nothing(tmp_path: Path) -> None:
    with _app_with_raising_routes(tmp_path) as client:
        response = client.get("/__test/unforeseen")
        body = assert_envelope(response, 500, "internal")
        for leak in ("secret_internal_table", "/Users/", "OperationalError", "sqlite"):
            assert leak not in response.text, f"the 500 leaked {leak!r}"
        assert body["retryable"] is False
