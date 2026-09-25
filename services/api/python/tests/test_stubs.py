"""Every contracts.md §2 / §4 route S0 did not build is a 501 stub that ALREADY enforces its final
contract: its auth, its path and query parameters and its body model all run before the 501.

    no token            401 auth_required (user routes)
    a body that breaks  422 validation_failed, naming the field (the final pydantic model)
    a good request      501 {"detail": "Not implemented yet (slice Sx)", "code": "not_implemented",
                             "retryable": false}, and NOTHING written

So a client written against the contract gets real 401s and 422s today, and a slice that builds a
route replaces one `raise not_implemented(...)` without redefining its models.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from api_support import assert_envelope, auth, harness, register

PAPER = "ppr_0000000000000000000000STUB"
THREAD = "thr_01K62ZX4Y6C0G6Y7T3N2E6Q9VB"
RUN = "run_01K62ZX4Y6C0G6Y7T3N2E6Q9VB"
BOARD = "brd_01K62ZX4Y6C0G6Y7T3N2E6Q9VB"
NODE = "cn_0f9e8d7c-aaaa-4bbb-8ccc-123456789abc"
EDGE = "ce_0f9e8d7c-aaaa-4bbb-8ccc-123456789abd"


@dataclass(frozen=True)
class Stub:
    method: str
    path: str
    slice: str
    body: Any = None
    #: (body, the field the 422's detail must name)
    bad: tuple[Any, str] | None = None
    user: bool = True


STUBS = [
    # §2.2 (S1)
    Stub("DELETE", f"/papers/{PAPER}", "S1"),
    Stub("POST", f"/papers/{PAPER}/retry", "S1"),
    Stub(
        "POST",
        f"/papers/{PAPER}/reparse",
        "S1",
        {"reason": "a better parser"},
        ({"reason": 5}, "reason"),
    ),
    # §2.5 (S5)
    Stub(
        "POST",
        f"/papers/{PAPER}/threads",
        "S5",
        {"kind": "ask", "question": "What does YOLO predict?"},
        ({"kind": "explain"}, "anchor"),
    ),
    Stub(
        "POST",
        f"/papers/{PAPER}/threads/{THREAD}/messages",
        "S5",
        {"question": "And what does that mean?"},
        ({"question": ""}, "question"),
    ),
    Stub("GET", f"/papers/{PAPER}/threads", "S5"),
    Stub("GET", f"/papers/{PAPER}/threads/{THREAD}", "S5"),
    Stub("POST", f"/runs/{RUN}/cancel", "S5"),
    Stub("GET", f"/papers/{PAPER}/summary", "S5"),
    Stub(
        "POST",
        f"/papers/{PAPER}/summary",
        "S5",
        {"regenerate": True},
        ({"regenerate": "yes"}, "regenerate"),
    ),
    Stub("GET", "/usage", "S5"),
    # §2.7 (S7)
    Stub("GET", f"/papers/{PAPER}/board", "S7"),
    Stub(
        "POST",
        f"/papers/{PAPER}/board/nodes",
        "S7",
        {"node_id": NODE, "kind": "note", "x": 0, "y": 0, "w": 240, "h": 120, "body": "n"},
        (
            {"node_id": NODE, "kind": "excerpt", "x": 0, "y": 0, "w": 240, "h": 120},
            "source_anchor",
        ),
    ),
    Stub(
        "PATCH",
        f"/boards/{BOARD}/nodes/{NODE}",
        "S7",
        {"version": 1, "x": 10.5},
        ({"x": 10.5}, "version"),
    ),
    Stub("DELETE", f"/boards/{BOARD}/nodes/{NODE}", "S7"),
    Stub(
        "POST",
        f"/boards/{BOARD}/edges",
        "S7",
        {"edge_id": EDGE, "from_node_id": NODE, "to_node_id": "cn_other", "kind": "supports"},
        (
            {"edge_id": EDGE, "from_node_id": NODE, "to_node_id": NODE, "kind": "supports"},
            "to_node_id",
        ),
    ),
    Stub(
        "PATCH",
        f"/boards/{BOARD}/edges/{EDGE}",
        "S7",
        {"label": "because"},
        ({"kind": "x"}, "kind"),
    ),
    Stub("DELETE", f"/boards/{BOARD}/edges/{EDGE}", "S7"),
    Stub("PATCH", f"/boards/{BOARD}", "S7", {"title": "My board"}, ({"title": ""}, "title")),
    # §4 (S5): the agent's paper tools. Their auth is a run token, which S5 checks.
    Stub("GET", f"/internal/agent/runs/{RUN}/outline", "S5", user=False),
    Stub("GET", f"/internal/agent/runs/{RUN}/sections/b3?cursor=c1", "S5", user=False),
    Stub("GET", f"/internal/agent/runs/{RUN}/passages/b12", "S5", user=False),
    Stub("GET", f"/internal/agent/runs/{RUN}/search?q=anchor%20boxes&limit=8", "S5", user=False),
]

#: The tables a stub must not touch.
USER_TABLES = ("ai_threads", "ai_messages", "ai_runs", "canvas_boards", "canvas_nodes", "jobs")


def _counts(database: Path) -> dict[str, int]:
    conn = sqlite3.connect(database)
    try:
        return {
            t: int(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]) for t in USER_TABLES
        }
    finally:
        conn.close()


def _send(client: Any, stub: Stub, token: str | None, body: Any = None) -> Any:
    headers = auth(token) if token else {}
    if body is None:
        return client.request(stub.method, stub.path, headers=headers)
    return client.request(stub.method, stub.path, headers=headers, json=body)


@pytest.mark.parametrize("stub", STUBS, ids=lambda s: f"{s.method} {s.path}")
def test_a_stub_enforces_its_contract_then_answers_501(stub: Stub, tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        before = _counts(h.settings.database_file)
        if stub.user:
            assert_envelope(_send(h.client, stub, None, stub.body), 401, "auth_required")
        if stub.bad is not None:
            bad_body, field = stub.bad
            rejected = assert_envelope(
                _send(h.client, stub, token, bad_body), 422, "validation_failed"
            )
            assert rejected["detail"].startswith(f"{field}: "), rejected
        response = _send(h.client, stub, token, stub.body)
        assert response.status_code == 501, response.text
        assert response.json() == {
            "detail": f"Not implemented yet (slice {stub.slice})",
            "code": "not_implemented",
            "retryable": False,
        }
        assert _counts(h.settings.database_file) == before, "a stub wrote a row"


#: (stub, a body whose one fault is an explicit null in an omittable field, the field)
NULLS = [
    (f"/papers/{PAPER}/reparse", "POST", {"reason": None}, "reason"),
    (f"/papers/{PAPER}/threads", "POST", {"kind": "ask", "anchor": None}, "anchor"),
    (
        f"/papers/{PAPER}/threads/{THREAD}/messages",
        "POST",
        {"question": "q", "retry_of": None},
        "retry_of",
    ),
    (f"/boards/{BOARD}/nodes/{NODE}", "PATCH", {"version": 1, "body": None}, "body"),
    (f"/boards/{BOARD}/nodes/{NODE}", "PATCH", {"version": 1, "w": None}, "w"),
    (f"/boards/{BOARD}/edges/{EDGE}", "PATCH", {"kind": None}, "kind"),
    (f"/boards/{BOARD}", "PATCH", {"title": None}, "title"),
]


@pytest.mark.parametrize(
    ("path", "method", "body", "field"), NULLS, ids=[f"{p} {f}" for p, _, _, f in NULLS]
)
def test_a_stub_refuses_an_explicit_null_where_the_contract_says_omit(
    path: str, method: str, body: dict[str, Any], field: str, tmp_path: Path
) -> None:
    """S0 review M1 on the stubs: each of these was a 501 (the model accepted the null), so the
    slice that builds the route would have inherited it; `NodePatch.body: null` would have reached
    S7's NOT NULL `canvas_nodes.body`. Without the null field each body is the stub's 501."""
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        refused = assert_envelope(
            h.client.request(method, path, headers=auth(token), json=body), 422, "validation_failed"
        )
        assert refused["detail"].startswith(f"{field}: "), refused
        rest = {key: value for key, value in body.items() if key != field}
        assert h.client.request(method, path, headers=auth(token), json=rest).status_code == 501


def test_usage_since_is_an_iso_time_already(tmp_path: Path) -> None:
    """contracts.md §2.5 `GET /usage?since=ISO`. S0 review S2, WATCHED FAILING: the stub took any
    1 to 64 characters, so `?since=yesterday` was the 501 (and S5 would have inherited a `str`).
    It is now an ISO-8601 date-time WITH its zone; a bare date, a naive time and a Unix number
    (each of which pydantic's lax `datetime` would take) are refused, as is a date that is none."""
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        for good in (
            "2026-09-25T15:09:25.123Z",
            "2026-09-25T15:09:25Z",
            "2026-09-25T20:39:25.5+05:30",
        ):
            answer = h.client.get("/usage", params={"since": good}, headers=auth(token))
            assert answer.status_code == 501, (good, answer.text)
        for bad in (
            "yesterday",
            "1695000000",
            "2026-09-25",
            "2026-09-25T15:09:25",
            "2026-13-01T00:00:00Z",
            "2026-02-30T00:00:00Z",
            "2026-09-25T15:09:25.123Zjunk",
            "",
        ):
            refused = assert_envelope(
                h.client.get("/usage", params={"since": bad}, headers=auth(token)),
                422,
                "validation_failed",
            )
            assert refused["detail"].startswith("since: "), (bad, refused)


def test_the_internal_tools_validate_their_parameters_already(tmp_path: Path) -> None:
    base = f"/internal/agent/runs/{RUN}"
    with harness(tmp_path) as h:
        for path in (
            f"{base}/sections/not-a-handle",
            f"{base}/passages/b",
            f"{base}/search?q=x&limit=9",
            f"{base}/search?q=x&limit=0",
            f"{base}/search",
        ):
            assert_envelope(h.client.get(path), 422, "validation_failed")
