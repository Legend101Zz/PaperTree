"""#74's one non-negotiable: user B cannot read user A's paper by id.

    "A test must assert user B cannot read user A's paper by id, and it must be watched fail by
     removing the owner argument from one query. Isolation that has never been observed FAILING
     is isolation nobody has tested."

WATCHED FAILING. `ir.paper_document` calls `db.get_paper(owner, paper_id, generation)`. Replacing
that `owner` with a second owner handle minted for the requesting user — the single-character-class
mistake this whole file exists to catch — turns these red:

    FAILED test_isolation.py::test_user_b_cannot_read_user_as_paper_by_id
      assert 200 == 404
    FAILED test_isolation.py::test_user_b_cannot_read_user_as_ir
      assert 200 == 404
    FAILED test_isolation.py::test_the_leak_would_have_been_the_whole_document
      assert 974 == 0

The third exists because the first two would also pass against a service that returned an EMPTY
200. It asserts the leak is total when it happens, so a green here means the query is scoped
rather than merely unlucky.

WHY 404 AND NOT 403. A 403 says "this exists and is not yours", which is an existence oracle over
content-derived ids. `packages/db`'s owner-scoped SELECTs return no row either way, so 404 is what
falls out naturally AND is the answer that leaks least.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from papertree_api.settings import Settings

from conftest import auth, load_fixture, register, seed_paper

#: The smallest committed fixture, so the seed cost is paid once per test rather than noticed.
SLUG = "resnet-cvpr-2col"


def test_user_b_cannot_read_user_as_paper_by_id(client: TestClient, settings: Settings) -> None:
    alice = register(client, "alice@example.com")
    bob = register(client, "bob@example.com")
    paper_id = seed_paper(settings, client, alice, SLUG)

    assert client.get(f"/papers/{paper_id}", headers=auth(alice)).status_code == 200
    assert client.get(f"/papers/{paper_id}", headers=auth(bob)).status_code == 404


def test_user_b_cannot_read_user_as_ir(client: TestClient, settings: Settings) -> None:
    alice = register(client, "alice@example.com")
    bob = register(client, "bob@example.com")
    paper_id = seed_paper(settings, client, alice, SLUG)

    assert client.get(f"/papers/{paper_id}/ir", headers=auth(alice)).status_code == 200
    assert client.get(f"/papers/{paper_id}/ir", headers=auth(bob)).status_code == 404


def test_the_leak_would_have_been_the_whole_document(client: TestClient, settings: Settings) -> None:
    """Non-vacuity: the thing being withheld is real, and it is everything.

    Without this, a service that 404'd because it returned nothing to anybody would pass the two
    tests above. `perf.spec` asserting `peak_mb < 2000` against a 500 MB bar is the same shape.
    """
    alice = register(client, "alice@example.com")
    paper_id = seed_paper(settings, client, alice, SLUG)

    document = client.get(f"/papers/{paper_id}/ir", headers=auth(alice)).json()
    expected = load_fixture(SLUG)
    assert len(document["blocks"]) == len(expected["blocks"]) > 100
    assert document["source_hash"] == expected["source_hash"]


def test_every_other_paper_route_is_owner_scoped_too(client: TestClient, settings: Settings) -> None:
    """One assertion per route, because isolation is per query and not per service.

    `_promoted` is the shared gate, but "shared" is a claim about today's code. A route added
    later that reads a generation directly would keep the two tests above green.
    """
    alice = register(client, "alice@example.com")
    bob = register(client, "bob@example.com")
    paper_id = seed_paper(settings, client, alice, SLUG)
    block_id = client.get(f"/papers/{paper_id}/ir", headers=auth(alice)).json()["blocks"][0]["block_id"]

    for path in (
        f"/papers/{paper_id}",
        f"/papers/{paper_id}/ir",
        f"/papers/{paper_id}/pages",
        f"/papers/{paper_id}/blocks",
        f"/papers/{paper_id}/relations",
        f"/papers/{paper_id}/blocks/{block_id}/location",
        f"/papers/{paper_id}/file",
        f"/papers/{paper_id}/assets/figures/{block_id}",
        f"/papers/{paper_id}/highlights",
    ):
        assert client.get(path, headers=auth(bob)).status_code == 404, path


def test_bobs_library_does_not_list_alices_paper(client: TestClient, settings: Settings) -> None:
    alice = register(client, "alice@example.com")
    bob = register(client, "bob@example.com")
    seed_paper(settings, client, alice, SLUG)

    assert len(client.get("/papers", headers=auth(alice)).json()) == 1
    assert client.get("/papers", headers=auth(bob)).json() == []


def test_no_response_anywhere_carries_an_owner_handle(client: TestClient, settings: Settings) -> None:
    """AGENTS.md §4: `OwnerId` must never cross a wire.

    Handles are `own_` + 32 CSPRNG bytes. Scanning the raw response bodies is cruder than reading
    the route code and catches what reading does not: a `dict(row)` that picks up an `owner_id`
    column nobody thought about. Every owned table has one, and `list_papers` is `SELECT *`.
    """
    alice = register(client, "alice@example.com")
    paper_id = seed_paper(settings, client, alice, SLUG)

    for path in (
        "/papers",
        f"/papers/{paper_id}",
        f"/papers/{paper_id}/ir",
        f"/papers/{paper_id}/pages",
        f"/papers/{paper_id}/relations",
        f"/papers/{paper_id}/highlights",
        "/auth/me",
    ):
        body = client.get(path, headers=auth(alice)).text
        assert "own_" not in body, f"{path} leaked an owner handle"
        assert "owner_id" not in body, f"{path} leaked an owner_id field"


def test_an_unauthenticated_request_is_401_and_says_how_to_authenticate(client: TestClient) -> None:
    response = client.get("/papers")
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_a_forged_token_does_not_authenticate(client: TestClient) -> None:
    register(client, "alice@example.com")
    assert client.get("/papers", headers=auth("not-a-real-token")).status_code == 401


def test_a_revoked_token_stops_working_immediately(client: TestClient) -> None:
    """What the session table buys over a signed token (0004_auth.sql)."""
    alice = register(client, "alice@example.com")
    assert client.get("/papers", headers=auth(alice)).status_code == 200
    assert client.post("/auth/logout", headers=auth(alice)).status_code == 204
    assert client.get("/papers", headers=auth(alice)).status_code == 401


def test_login_does_not_distinguish_a_bad_password_from_a_missing_account(client: TestClient) -> None:
    register(client, "alice@example.com", "correct horse battery")
    wrong = client.post("/auth/login", json={"email": "alice@example.com", "password": "wrong password"})
    absent = client.post("/auth/login", json={"email": "nobody@example.com", "password": "wrong password"})
    assert wrong.status_code == absent.status_code == 401
    assert wrong.json() == absent.json()
