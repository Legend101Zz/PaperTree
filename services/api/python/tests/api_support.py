"""Fixtures and helpers for the HTTP tests. NOT named `conftest.py`, deliberately.

`services/document-worker/python/tests/conftest.py:20-24` already predicted this file:

    "Not by copying the file: mypy treats two files with the same basename as one module and
     aborts the whole run ("Duplicate module named ..."), which is the constraint pytest's
     `prepend` import mode imposes across this repo. Not by a second conftest either - same
     collision. And not by making `tests` a package: packages/db/python/tests/__init__.py
     already claims that name."

A second `conftest.py` under `services/*/python/tests/` is exactly that second conftest, and it
does abort `uv run mypy packages/*/python services/*/python` with "Duplicate module named
conftest" -- observed, not predicted. Both documented escapes are closed, so the fixtures live in
a uniquely-named module and each test file imports the ones it uses. pytest resolves a fixture
that is in the test module's namespace just as it resolves one from a conftest.

Every test runs against the REAL ASGI app through Starlette's TestClient, not against the route
functions. That is deliberate and it is the point of `test_isolation.py`: `owner_for` is called in
the DEPENDENCY GRAPH (`deps.caller`), so a test that imports a route function and calls it with a
hand-made `Caller` would be asserting isolation over wiring it had just bypassed.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from papertree_api import create_app
from papertree_api.settings import Settings
from papertree_db import PaperTreeDb, generation

#: The three papers `apps/web` ships in `public/fixtures/` and every anchoring test measures
#: against. Reading one here is what makes `test_ir.py` a contract test rather than a shape test.
FIXTURE_DIR = Path(__file__).resolve().parents[4] / "packages" / "document-ir" / "fixtures"


@dataclass(frozen=True, slots=True)
class Harness:
    """A live app plus the settings it was built from. Not a pytest fixture, on purpose.

    Custom fixtures would have to be IMPORTED into each test module (there is no conftest here —
    see the header), and an imported fixture named `client` collides with the test parameter named
    `client`, which ruff reports as F811 on every test. A plain constructor sidesteps the whole
    mechanism; `tmp_path` is pytest's own and is still used as a parameter.
    """

    client: TestClient
    settings: Settings


@contextmanager
def harness(tmp_path: Path) -> Iterator[Harness]:
    # Faster scrypt is NOT configured. A test that runs against a weakened KDF is not testing the
    # thing that ships. Two registrations per test at ~50 ms is affordable; if that stops being
    # true the fix is fewer registrations, not a weaker hash.
    settings = Settings(root=tmp_path / "data")
    with TestClient(create_app(settings)) as client:
        yield Harness(client=client, settings=settings)


def register(client: TestClient, email: str, password: str = "correct horse battery") -> str:
    """Registers and returns the bearer token."""
    response = client.post("/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201, response.text
    return str(response.json()["token"])


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def load_fixture(slug: str) -> dict[str, Any]:
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
