"""The route table, pinned. S0b's rule: the router split may ADD routes, never move or drop one.

`BEFORE` is the table `create_app()` served at `b33d8f8` (the last commit before the split),
captured by introspecting the app, not by reading the code. `ADDED` is everything S0 added on top.
`REMOVED` is the one deliberate removal since: `POST /papers/{id}/ask`, deleted by S5 with `ask.py`
(slice-plan §R R9; threads and summary replace it). A route that disappears, changes its path or
changes its method fails the first test; a route that appears without being listed in `ADDED`
fails the second. Both directions matter: a silently added route is a surface nobody reviewed, and
a silently removed one is a client that breaks.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.routing import iter_route_contexts
from papertree_api import create_app
from papertree_api.settings import Settings

#: `create_app().routes` at `b33d8f8`, as (method, path). FastAPI's own `/docs`, `/redoc` and
#: `/openapi.json` are part of the served surface, so they are pinned too.
BEFORE: frozenset[tuple[str, str]] = frozenset(
    {
        ("POST", "/auth/login"),
        ("POST", "/auth/logout"),
        ("GET", "/auth/me"),
        ("POST", "/auth/register"),
        ("GET", "/docs"),
        ("HEAD", "/docs"),
        ("GET", "/docs/oauth2-redirect"),
        ("HEAD", "/docs/oauth2-redirect"),
        ("GET", "/jobs/{job_id}"),
        ("GET", "/openapi.json"),
        ("HEAD", "/openapi.json"),
        ("GET", "/papers"),
        ("POST", "/papers"),
        ("GET", "/papers/{paper_id}"),
        ("POST", "/papers/{paper_id}/ask"),
        ("GET", "/papers/{paper_id}/assets/{kind}/{block_id}"),
        ("GET", "/papers/{paper_id}/blocks"),
        ("GET", "/papers/{paper_id}/blocks/{block_id}/location"),
        ("GET", "/papers/{paper_id}/file"),
        ("GET", "/papers/{paper_id}/highlights"),
        ("POST", "/papers/{paper_id}/highlights"),
        ("PUT", "/papers/{paper_id}/highlights/resolutions"),
        ("DELETE", "/papers/{paper_id}/highlights/{highlight_id}"),
        ("PATCH", "/papers/{paper_id}/highlights/{highlight_id}"),
        ("GET", "/papers/{paper_id}/ir"),
        ("GET", "/papers/{paper_id}/pages"),
        ("GET", "/papers/{paper_id}/relations"),
        ("GET", "/redoc"),
        ("HEAD", "/redoc"),
    }
)

#: What S0 added. Every entry is a contracts.md route; see the report for the section of each.
ADDED: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/healthz"),  # §2.8, implemented
        # §2.2 (S1)
        ("DELETE", "/papers/{paper_id}"),
        ("POST", "/papers/{paper_id}/retry"),
        ("POST", "/papers/{paper_id}/reparse"),
        # §2.5 (S5)
        ("POST", "/papers/{paper_id}/threads"),
        ("GET", "/papers/{paper_id}/threads"),
        ("GET", "/papers/{paper_id}/threads/{thread_id}"),
        ("POST", "/papers/{paper_id}/threads/{thread_id}/messages"),
        ("POST", "/runs/{run_id}/cancel"),
        ("GET", "/papers/{paper_id}/summary"),
        ("POST", "/papers/{paper_id}/summary"),
        ("GET", "/usage"),
        # §2.7 (S7)
        ("GET", "/papers/{paper_id}/board"),
        ("POST", "/papers/{paper_id}/board/nodes"),
        ("PATCH", "/boards/{board_id}/nodes/{node_id}"),
        ("DELETE", "/boards/{board_id}/nodes/{node_id}"),
        ("POST", "/boards/{board_id}/edges"),
        ("PATCH", "/boards/{board_id}/edges/{edge_id}"),
        ("DELETE", "/boards/{board_id}/edges/{edge_id}"),
        ("PATCH", "/boards/{board_id}"),
        # §4 (S5)
        ("GET", "/internal/agent/runs/{run_id}/outline"),
        ("GET", "/internal/agent/runs/{run_id}/sections/{handle}"),
        ("GET", "/internal/agent/runs/{run_id}/passages/{handle}"),
        ("GET", "/internal/agent/runs/{run_id}/search"),
    }
)


#: Deliberate removals, each with the slice that made it. Removing a route is a contract change the
#: report must name; listing it here is what lets the first test keep failing on an ACCIDENTAL one.
REMOVED: frozenset[tuple[str, str]] = frozenset(
    {
        ("POST", "/papers/{paper_id}/ask"),  # S5, R9: ask.py deleted; threads replace it
    }
)


def _served(tmp_path: Path) -> set[tuple[str, str]]:
    """Every (method, path) the app matches. `app.routes` is NOT that list: FastAPI 0.14x keeps an
    included router as one lazy `_IncludedRouter` entry, so a table read off `app.routes` shows
    none of the routers' routes (observed: 9 rows instead of 29). `iter_route_contexts` is the
    public walk over what the router actually dispatches to."""
    app = create_app(Settings(root=tmp_path / "data"))
    return {
        (method, route.path)
        for route in iter_route_contexts(app.routes)
        if route.path is not None
        for method in (route.methods or ())
    }


def test_no_route_that_existed_before_the_split_moved_or_disappeared(tmp_path: Path) -> None:
    served = _served(tmp_path)
    missing = BEFORE - REMOVED - served
    assert not missing, f"routes the split dropped or moved: {sorted(missing)}"
    assert not REMOVED & served, f"a route listed as removed is still served: {REMOVED & served}"
    assert REMOVED <= BEFORE, "only a route that existed can be removed"


def test_every_route_is_either_pre_split_or_a_listed_addition(tmp_path: Path) -> None:
    served = _served(tmp_path)
    expected = (BEFORE - REMOVED) | ADDED
    assert served == expected, (
        f"unlisted: {sorted(served - expected)}; listed but not served: "
        f"{sorted(expected - served)}"
    )
    assert not BEFORE & ADDED, "a pre-split route is also listed as an addition"


def test_the_openapi_document_builds_and_lists_every_api_route(tmp_path: Path) -> None:
    """`/openapi.json` is a served route, and it is built from the models the routes declare, so a
    model the generator cannot render would break it at request time, not import time."""
    from fastapi.testclient import TestClient

    with TestClient(create_app(Settings(root=tmp_path / "data"))) as client:
        response = client.get("/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]
    documented = {(method.upper(), path) for path, item in paths.items() for method in item}
    api_routes = {
        (method, path)
        for method, path in (BEFORE - REMOVED) | ADDED
        if method != "HEAD" and not path.startswith(("/docs", "/redoc", "/openapi"))
    }
    assert api_routes <= documented, sorted(api_routes - documented)
