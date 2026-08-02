"""Fixtures for the HTTP tests.

Every test runs against the REAL ASGI app through Starlette's TestClient, not against the route
functions. That is deliberate and it is the point of `test_isolation.py`: `owner_for` is called in
the DEPENDENCY GRAPH (`deps.caller`), so a test that imports a route function and calls it with a
hand-made `Caller` would be asserting isolation over wiring it had just bypassed.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from papertree_api import create_app
from papertree_api.settings import Settings
from papertree_db import PaperTreeDb, generation

#: The three papers `apps/web` ships in `public/fixtures/` and every anchoring test measures
#: against. Reading one here is what makes `test_ir.py` a contract test rather than a shape test.
FIXTURE_DIR = Path(__file__).resolve().parents[4] / "packages" / "document-ir" / "fixtures"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # Faster scrypt is NOT configured here. The cost is what it is, and a test that runs against a
    # weakened KDF is not testing the thing that ships. Two registrations per test at ~50 ms is
    # affordable; if that stops being true the fix is fewer registrations, not a weaker hash.
    return Settings(root=tmp_path / "data")


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def register(client: TestClient, email: str, password: str = "correct horse battery") -> str:
    """Registers and returns the bearer token."""
    response = client.post("/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201, response.text
    return str(response.json()["token"])


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def load_fixture(slug: str) -> dict:
    with (FIXTURE_DIR / f"{slug}.paperir.json").open(encoding="utf-8") as handle:
        return json.load(handle)  # type: ignore[no-any-return]


def seed_paper(settings: Settings, client: TestClient, token: str, slug: str) -> str:
    """Puts a real committed fixture into the store as if the worker had parsed it.

    Uses `PaperTreeDb.put_paper` — the SAME call the parse job's persist step makes (job.py:150) —
    rather than a hand-built document, so what these tests read back is what the real producer
    writes. A fixture the test authored itself would be #66's defect in a new place.

    Note the two `owner_for` calls: this opens its own connection, so it mints its own handle. A
    handle from the request path would not resolve here, by design.
    """
    user_id = client.get("/auth/me", headers=auth(token)).json()["user_id"]
    document = load_fixture(slug)
    db = PaperTreeDb(settings.database_file)
    try:
        owner = db.owner_for(user_id)
        db.put_paper(owner, document)
        db.promote_generation(owner, document["paper_id"], generation(int(document["generation"])))
    finally:
        db.close()
    return str(document["paper_id"])
