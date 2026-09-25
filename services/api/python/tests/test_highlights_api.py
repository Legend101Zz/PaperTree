"""The highlight routes on 0005 (contracts.md §2.4), through the real ASGI app.

Every body here is a REAL ``captureAnchor()`` record over the committed ``resnet-cvpr-2col``
fixture (``packages/db/python/tests/data/capture_anchor_resnet.json``), and the paper is that
fixture written through ``put_paper`` — so the anchor's ``doc.paperId`` and ``doc.pdfSha256`` are
the seeded paper's own, and nothing in a passing test is a shape this file made up.

WATCHED FAILING on the pre-0005 routes (base ``bda3a09``, see the S0 db report): the old POST
created a highlight for ``anchors: []`` (``assert 201 == 422``) and raised ``KeyError: 'block_id'``
— a 500 — on every Anchor-shaped body.
"""

from __future__ import annotations

import copy
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

from api_support import auth, harness, register, seed_paper
from fastapi.testclient import TestClient
from papertree_api.settings import Settings
from papertree_db import PaperTreeDb

SLUG = "resnet-cvpr-2col"
CAPTURE = (
    Path(__file__).resolve().parents[4]
    / "packages"
    / "db"
    / "python"
    / "tests"
    / "data"
    / "capture_anchor_resnet.json"
)
HIGHLIGHT_ID = "hl_01K0APIHIGHLIGHT000000001"


def _record() -> dict[str, Any]:
    anchor: dict[str, Any] = json.loads(CAPTURE.read_text(encoding="utf-8"))["anchor"]
    return anchor


def _body(**overrides: Any) -> dict[str, Any]:
    record = _record()
    body: dict[str, Any] = {
        "highlight_id": HIGHLIGHT_ID,
        "color": "amber",
        "note": "residual learning",
        "anchors": [{"anchor": record}],
        "resolutions": [
            {
                "anchor_id": record["id"],
                "generation": 1,
                "tier": 1,
                "state": "anchored",
                "block_ids": [record["selectors"][0]["blockId"]],
                "score": 1.0,
                "resolver_version": "anchoring@test",
            }
        ],
    }
    body.update(overrides)
    return body


def _rows(settings: Settings) -> dict[str, int]:
    conn = sqlite3.connect(settings.database_file)
    try:
        return {
            t: int(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
            for t in ("highlights", "anchors", "anchor_resolutions")
        }
    finally:
        conn.close()


NO_ROWS = {"highlights": 0, "anchors": 0, "anchor_resolutions": 0}

#: The largest value SQLite's INTEGER holds. One more is a bad body, not a server error.
SQLITE_INTEGER_MAX = 2**63 - 1


def _selector(anchor: dict[str, Any], kind: str) -> dict[str, Any]:
    selector: dict[str, Any] = next(s for s in anchor["selectors"] if s["type"] == kind)
    return selector


def _assert_envelope(response: Any, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"detail", "code", "retryable"}, body
    assert body["code"] == code, body
    assert body["retryable"] is False
    assert isinstance(body["detail"], str) and body["detail"]


def _post(client: TestClient, token: str, paper_id: str, body: Any) -> Any:
    return client.post(f"/papers/{paper_id}/highlights", headers=auth(token), json=body)


# ── the happy path ───────────────────────────────────────────────────────────────────────────


def test_create_then_list_a_real_captured_highlight(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        body = _body()
        # A client-side resolution field on the Anchor must be stripped before storage (§2.4).
        body["anchors"][0]["anchor"] = {**_record(), "resolution": {"tier": 0, "stale": True}}

        created = _post(h.client, alice, paper_id, body)
        assert created.status_code == 201, created.text
        highlight = created.json()
        assert set(highlight) == {
            "highlight_id",
            "color",
            "note",
            "created_generation",
            "created_at",
            "updated_at",
            "anchors",
        }
        assert highlight["highlight_id"] == HIGHLIGHT_ID
        assert highlight["color"] == "amber" and highlight["note"] == "residual learning"
        assert highlight["created_generation"] == 1  # the promoted generation
        [wire] = highlight["anchors"]
        assert wire["anchor_id"] == _record()["id"] and wire["ordinal"] == 0
        assert wire["anchor"] == _record()  # verbatim, minus `resolution`
        assert wire["resolution"] == {
            "generation": 1,
            "tier": 1,
            "state": "anchored",
            "block_ids": [_record()["selectors"][0]["blockId"]],
            "score": 1.0,
            "reason": None,
            "resolver_version": "anchoring@test",
        }

        listed = h.client.get(f"/papers/{paper_id}/highlights", headers=auth(alice))
        assert listed.status_code == 200
        assert listed.json() == [highlight]
        # `?gen=` asks about another generation's cache: the highlight is still listed.
        other = h.client.get(f"/papers/{paper_id}/highlights?gen=2", headers=auth(alice)).json()
        assert [x["highlight_id"] for x in other] == [HIGHLIGHT_ID]
        assert other[0]["anchors"][0]["resolution"] is None
        assert "own_" not in listed.text and "owner_id" not in listed.text
        assert _rows(h.settings) == {"highlights": 1, "anchors": 1, "anchor_resolutions": 1}


def test_a_replayed_create_is_idempotent(tmp_path: Path) -> None:
    """Same ``highlight_id`` and body: 200 with the stored highlight, and nothing written twice."""
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        first = _post(h.client, alice, paper_id, _body())
        again = _post(h.client, alice, paper_id, _body())
        assert first.status_code == 201 and again.status_code == 200, again.text
        assert again.json() == first.json()
        assert _rows(h.settings) == {"highlights": 1, "anchors": 1, "anchor_resolutions": 1}


def test_the_same_highlight_id_with_a_different_body_is_422(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        assert _post(h.client, alice, paper_id, _body()).status_code == 201
        changed = _post(h.client, alice, paper_id, _body(color="pink"))
        _assert_envelope(changed, 422, "validation_failed")
        assert (
            h.client.get(f"/papers/{paper_id}/highlights", headers=auth(alice)).json()[0]["color"]
            == "amber"
        )


# ── contracts.md §9 regression tests ─────────────────────────────────────────────────────────


def test_empty_anchors_is_422(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        _assert_envelope(
            _post(h.client, alice, paper_id, _body(anchors=[], resolutions=[])),
            422,
            "validation_failed",
        )
        assert _rows(h.settings) == NO_ROWS


def test_anchor_mismatch_is_422(tmp_path: Path) -> None:
    """``doc.paperId`` must be this paper and ``doc.pdfSha256`` its ``source_hash``."""
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)

        wrong_paper = _record()
        wrong_paper["doc"]["paperId"] = "ppr_0000000000000000000000OTHR"
        _assert_envelope(
            _post(h.client, alice, paper_id, _body(anchors=[{"anchor": wrong_paper}])),
            422,
            "anchor_mismatch",
        )
        wrong_bytes = _record()
        wrong_bytes["doc"]["pdfSha256"] = "sha256:" + "0" * 64
        _assert_envelope(
            _post(h.client, alice, paper_id, _body(anchors=[{"anchor": wrong_bytes}])),
            422,
            "anchor_mismatch",
        )
        assert _rows(h.settings) == NO_ROWS


def test_anchor_incomplete_is_422(tmp_path: Path) -> None:
    """A NEW user anchor needs a TextQuoteSelector and a ShapeSelector with at least one quad."""
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)

        no_quote = _record()
        no_quote["selectors"] = [
            s for s in no_quote["selectors"] if s["type"] != "TextQuoteSelector"
        ]
        no_quads = _record()
        for selector in no_quads["selectors"]:
            if selector["type"] == "ShapeSelector":
                selector["quads"] = []
        for anchor in (no_quote, no_quads):
            _assert_envelope(
                _post(h.client, alice, paper_id, _body(anchors=[{"anchor": anchor}])),
                422,
                "anchor_incomplete",
            )
        assert _rows(h.settings) == NO_ROWS


def test_a_paper_with_no_promoted_generation_is_409_not_parsed(tmp_path: Path) -> None:
    """Contracts §2.4: ``created_generation`` is the promoted generation, so none means 409."""
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        user_id = h.client.get("/auth/me", headers=auth(alice)).json()["user_id"]
        document = json.loads(
            (
                Path(__file__).resolve().parents[4]
                / "packages/document-ir/fixtures/resnet-cvpr-2col.paperir.json"
            ).read_text(encoding="utf-8")
        )
        db = PaperTreeDb(h.settings.database_file)
        try:
            db.put_paper(db.owner_for(user_id), document)  # stored, never promoted
        finally:
            db.close()
        paper_id = document["paper_id"]
        _assert_envelope(_post(h.client, alice, paper_id, _body()), 409, "not_parsed")
        # GET still answers: the paper is the caller's, there is just nothing to list yet.
        assert h.client.get(f"/papers/{paper_id}/highlights", headers=auth(alice)).json() == []
        assert _rows(h.settings) == NO_ROWS


def test_bad_bodies_are_422_and_never_500_and_never_write(tmp_path: Path) -> None:
    """Contracts §2.4: "Never 500 on a bad body, and never a partial write."

    The TestClient re-raises any server exception, so a 500 here is a loud failure, not a status
    to compare. Each body is wrong in exactly one way.
    """
    good = _body()
    record = _record()

    def with_anchor(mutate: Any) -> dict[str, Any]:
        anchor = copy.deepcopy(record)
        mutate(anchor)
        return _body(anchors=[{"anchor": anchor}])

    def resolution(**fields: Any) -> dict[str, Any]:
        return _body(resolutions=[{**good["resolutions"][0], **fields}])

    bad_bodies: dict[str, Any] = {
        "a JSON array": [good],
        "a JSON string": "highlight",
        "missing highlight_id": {k: v for k, v in good.items() if k != "highlight_id"},
        "a malformed highlight_id": _body(highlight_id="not an id"),
        "a colour outside the palette": _body(color="red"),
        "anchors not a list": _body(anchors={"anchor": record}),
        "65 anchors": _body(anchors=[{"anchor": record}] * 65),
        "an anchor that is not an object": _body(anchors=[{"anchor": "anchor"}]),
        "an anchor item without `anchor`": _body(anchors=[record]),
        "anchorVersion 2": with_anchor(lambda a: a.update(anchorVersion=2)),
        "anchorVersion true": with_anchor(lambda a: a.update(anchorVersion=True)),
        "an anchor id that is no id": with_anchor(lambda a: a.update(id="x y")),
        "doc not an object": with_anchor(lambda a: a.update(doc="doc")),
        "selectors not a list": with_anchor(lambda a: a.update(selectors={"type": "x"})),
        "a selector without a type": with_anchor(lambda a: a["selectors"].append({"x": 1})),
        "an unknown provenance class": with_anchor(lambda a: a.update(provenanceClass="user")),
        "a quad of three numbers": with_anchor(
            lambda a: next(s for s in a["selectors"] if s["type"] == "ShapeSelector").update(
                quads=[[1, 2, 3]]
            )
        ),
        "a duplicated anchor": _body(anchors=[{"anchor": record}, {"anchor": record}]),
        "a resolution for an anchor not in the body": resolution(anchor_id="nope-0000"),
        "a resolution for a generation that does not exist": resolution(generation=7),
        "tier 9": resolution(tier=9),
        "an unknown state": resolution(state="lost"),
        "score 2": resolution(score=2),
        "block_ids a string": resolution(block_ids="blk_x"),
        # JSON integers are unbounded and SQLite's INTEGER is 64-bit: each of these reached a
        # bound parameter and raised OverflowError (a 500) until the bound was checked first.
        "a resolution generation of 10**20": resolution(generation=10**20),
        "a resolution generation of 2**63": resolution(generation=SQLITE_INTEGER_MAX + 1),
        "a PageSelector.index of 10**20": with_anchor(
            lambda a: _selector(a, "PageSelector").update(index=10**20)
        ),
        "a ShapeSelector.pageIndex of 2**63 and no PageSelector": with_anchor(
            lambda a: (
                a.update(selectors=[s for s in a["selectors"] if s["type"] != "PageSelector"]),
                _selector(a, "ShapeSelector").update(pageIndex=SQLITE_INTEGER_MAX + 1),
            )
        ),
        # Past float range, so `float()` itself raised OverflowError: not a finite quad.
        "a quad coordinate of 10**400": with_anchor(
            lambda a: _selector(a, "ShapeSelector").update(quads=[[10**400, 170.0, 343.0, 180.0]])
        ),
    }
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        for label, body in bad_bodies.items():
            response = _post(h.client, alice, paper_id, body)
            assert response.status_code == 422, f"{label}: {response.status_code} {response.text}"
            assert response.json()["code"] in {"validation_failed", "anchor_incomplete"}, label
        not_json = h.client.post(
            f"/papers/{paper_id}/highlights",
            headers={**auth(alice), "Content-Type": "application/json"},
            content=b"{not json",
        )
        _assert_envelope(not_json, 422, "validation_failed")
        assert _rows(h.settings) == NO_ROWS


def test_bad_gen_params_are_422_and_never_500(tmp_path: Path) -> None:
    """``?gen=`` is a generation: ASCII digits, 1 to 2**63-1.

    WATCHED FAILING before the bound: ``str.isdigit()`` is True for ``²`` (then ``int()`` raised
    ValueError, a 500) and for ``٣`` (silently read as generation 3), and an unbounded integer
    overflowed the bound SQL parameter (OverflowError, a 500).
    """
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        assert _post(h.client, alice, paper_id, _body()).status_code == 201
        base = f"/papers/{paper_id}/highlights"
        for raw in (
            "",
            "0",
            "-1",
            "abc",
            "1.0",
            "+1",
            "%201",
            "%C2%B2",  # superscript two
            "%D9%A3",  # ARABIC-INDIC DIGIT THREE
            "99999999999999999999999",
            str(SQLITE_INTEGER_MAX + 1),
        ):
            response = h.client.get(f"{base}?gen={raw}", headers=auth(alice))
            assert response.status_code == 422, f"?gen={raw}: {response.status_code}"
            _assert_envelope(response, 422, "validation_failed")
        # Non-vacuous: a real generation still answers with its cache entry, and the bound is
        # SQLite's own, not a smaller one — 2**63-1 is simply a generation no parse has.
        [one] = h.client.get(f"{base}?gen=1", headers=auth(alice)).json()
        assert one["anchors"][0]["resolution"]["generation"] == 1
        [edge] = h.client.get(f"{base}?gen={SQLITE_INTEGER_MAX}", headers=auth(alice)).json()
        assert edge["highlight_id"] == HIGHLIGHT_ID
        assert edge["anchors"][0]["resolution"] is None


def test_bad_resolution_puts_are_422_and_never_500_and_never_write(tmp_path: Path) -> None:
    """The PUT twin of the bad-body matrix. WATCHED FAILING before the bound: a ``generation``
    above 2**63-1 overflowed the bound SQL parameter (OverflowError, a 500)."""
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        assert _post(h.client, alice, paper_id, _body()).status_code == 201
        url = f"/papers/{paper_id}/highlights/resolutions"
        item = {k: v for k, v in _body()["resolutions"][0].items() if k != "generation"}
        item["tier"] = 4
        bad_bodies: dict[str, Any] = {
            "generation 10**20, no items": {"generation": 10**20, "items": []},
            "generation 2**63 with an item": {
                "generation": SQLITE_INTEGER_MAX + 1,
                "items": [item],
            },
            "generation 0": {"generation": 0, "items": [item]},
            "generation missing": {"items": [item]},
            "items not a list": {"generation": 1, "items": item},
            "tier 7": {"generation": 1, "items": [{**item, "tier": 7}]},
        }
        for label, body in bad_bodies.items():
            response = h.client.put(url, headers=auth(alice), json=body)
            assert response.status_code == 422, f"{label}: {response.status_code}"
            _assert_envelope(response, 422, "validation_failed")
        # In range but never stored: the contract's 409, neither a 422 nor a 500.
        _assert_envelope(
            h.client.put(
                url, headers=auth(alice), json={"generation": SQLITE_INTEGER_MAX, "items": [item]}
            ),
            409,
            "generation_not_found",
        )
        # Nothing above wrote: the cache entry is the one the POST stored (tier 1, not 4).
        [listed] = h.client.get(f"/papers/{paper_id}/highlights", headers=auth(alice)).json()
        assert listed["anchors"][0]["resolution"]["tier"] == 1
        assert _rows(h.settings) == {"highlights": 1, "anchors": 1, "anchor_resolutions": 1}


#: contracts.md §0: "Times are ISO-8601 UTC strings (`2026-09-25T15:09:25.123Z`)".
CONTRACT_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def test_highlight_times_on_the_wire_are_the_contract_shape(tmp_path: Path) -> None:
    """Every ``created_at``/``updated_at`` a highlight route returns is §0's shape.

    WATCHED FAILING before the wire formatting: the store stamps ``datetime.isoformat()``, so the
    routes returned ``2026-09-25T19:05:35.274228+00:00``. A legacy 0001 row keeps whatever its
    runner wrote (the demo data root's one is ``…752375+00:00``), so the shape is fixed on the way
    out, not only on the way in.
    """
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        base = f"/papers/{paper_id}/highlights"
        created = _post(h.client, alice, paper_id, _body())
        patched = h.client.patch(f"{base}/{HIGHLIGHT_ID}", headers=auth(alice), json={"note": "x"})
        for response in (created, patched):
            assert response.status_code in (200, 201), response.text
            for field in ("created_at", "updated_at"):
                assert CONTRACT_TIME.fullmatch(response.json()[field]), response.json()[field]

        # Rows written by older runners, inserted as they are stored in a saved data root.
        user_id = h.client.get("/auth/me", headers=auth(alice)).json()["user_id"]
        conn = sqlite3.connect(h.settings.database_file)
        try:
            for highlight_id, stamp in (
                ("hl_01K0LEGACYPYTHONSTAMP0001", "2026-08-06T09:37:32.752375+00:00"),
                ("hl_01K0LEGACYTSSTAMP00000001", "2026-08-06T09:37:33.100Z"),
                ("hl_01K0LEGACYNOTATIME0000001", "z"),
            ):
                conn.execute(
                    "INSERT INTO highlights (highlight_id, owner_id, paper_id, color, note, "
                    "created_generation, created_at, updated_at) "
                    "VALUES (?, ?, ?, 'amber', NULL, 1, ?, ?)",
                    (highlight_id, user_id, paper_id, stamp, stamp),
                )
            conn.commit()
        finally:
            conn.close()
        listed = {
            row["highlight_id"]: row for row in h.client.get(base, headers=auth(alice)).json()
        }
        assert listed["hl_01K0LEGACYPYTHONSTAMP0001"]["created_at"] == "2026-08-06T09:37:32.752Z"
        assert listed["hl_01K0LEGACYTSSTAMP00000001"]["updated_at"] == "2026-08-06T09:37:33.100Z"
        assert CONTRACT_TIME.fullmatch(listed[HIGHLIGHT_ID]["created_at"])
        # A stored value that is not a time at all is passed through as stored: a GET of a user's
        # highlights never becomes a 500 over a timestamp.
        assert listed["hl_01K0LEGACYNOTATIME0000001"]["created_at"] == "z"


# ── ownership and the path ───────────────────────────────────────────────────────────────────


def test_another_owner_gets_404_on_every_highlight_route(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        assert _post(h.client, alice, paper_id, _body()).status_code == 201
        base = f"/papers/{paper_id}/highlights"

        _assert_envelope(h.client.get(base, headers=auth(bob)), 404, "not_found")
        _assert_envelope(_post(h.client, bob, paper_id, _body()), 404, "not_found")
        _assert_envelope(
            h.client.patch(f"{base}/{HIGHLIGHT_ID}", headers=auth(bob), json={"note": "pwned"}),
            404,
            "not_found",
        )
        _assert_envelope(
            h.client.delete(f"{base}/{HIGHLIGHT_ID}", headers=auth(bob)), 404, "not_found"
        )
        _assert_envelope(
            h.client.put(
                f"{base}/resolutions", headers=auth(bob), json={"generation": 1, "items": []}
            ),
            404,
            "not_found",
        )
        # Non-vacuous: all of it is still there, unchanged, for Alice.
        [mine] = h.client.get(base, headers=auth(alice)).json()
        assert mine["note"] == "residual learning"


def test_patch_and_delete_follow_the_path_paper(tmp_path: Path) -> None:
    """The 0001 routes ignored ``{paper_id}``: a highlight id under ANY path was found. Now a
    highlight is addressed by (owner, paper, id), so another paper's path does not reach it."""
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        other_paper = seed_paper(h.settings, h.client, alice, "attention-is-all-you-need")
        assert _post(h.client, alice, paper_id, _body()).status_code == 201
        mine = f"/papers/{paper_id}/highlights/{HIGHLIGHT_ID}"
        wrong = f"/papers/{other_paper}/highlights/{HIGHLIGHT_ID}"

        _assert_envelope(
            h.client.patch(wrong, headers=auth(alice), json={"note": "x"}), 404, "not_found"
        )
        _assert_envelope(h.client.delete(wrong, headers=auth(alice)), 404, "not_found")

        patched = h.client.patch(mine, headers=auth(alice), json={"color": "green"})
        assert patched.status_code == 200, patched.text
        assert patched.json()["color"] == "green"
        assert patched.json()["note"] == "residual learning"  # untouched when absent
        cleared = h.client.patch(mine, headers=auth(alice), json={"note": None})
        assert cleared.json()["note"] is None and cleared.json()["color"] == "green"
        assert len(cleared.json()["anchors"]) == 1
        _assert_envelope(
            h.client.patch(mine, headers=auth(alice), json={"color": "red"}),
            422,
            "validation_failed",
        )

        assert h.client.delete(mine, headers=auth(alice)).status_code == 204
        _assert_envelope(h.client.delete(mine, headers=auth(alice)), 404, "not_found")
        assert _rows(h.settings) == NO_ROWS  # anchors and cache entries cascade


# ── PUT …/resolutions ────────────────────────────────────────────────────────────────────────


def test_put_resolutions_upserts_the_cache_for_one_generation(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        assert _post(h.client, alice, paper_id, _body(resolutions=[])).status_code == 201
        anchor_id = _record()["id"]
        url = f"/papers/{paper_id}/highlights/resolutions"
        item = {
            "anchor_id": anchor_id,
            "tier": 3,
            "state": "approximate",
            "block_ids": ["blk_a", "blk_b"],
            "score": 0.8,
            "reason": None,
            "resolver_version": "anchoring@test",
        }
        put = h.client.put(url, headers=auth(alice), json={"generation": 1, "items": [item]})
        assert put.status_code == 204, put.text
        again = h.client.put(
            url, headers=auth(alice), json={"generation": 1, "items": [{**item, "tier": 1}]}
        )
        assert again.status_code == 204
        [listed] = h.client.get(f"/papers/{paper_id}/highlights", headers=auth(alice)).json()
        assert listed["anchors"][0]["resolution"]["tier"] == 1  # upserted, not duplicated
        assert listed["anchors"][0]["resolution"]["block_ids"] == ["blk_a", "blk_b"]
        assert _rows(h.settings)["anchor_resolutions"] == 1

        _assert_envelope(
            h.client.put(url, headers=auth(alice), json={"generation": 9, "items": [item]}),
            409,
            "generation_not_found",
        )
        _assert_envelope(
            h.client.put(
                url,
                headers=auth(alice),
                json={"generation": 1, "items": [{**item, "anchor_id": "0" * 8 + "-dead"}]},
            ),
            422,
            "validation_failed",
        )
        _assert_envelope(
            h.client.put(url, headers=auth(alice), json={"generation": 1, "items": [item] * 501}),
            422,
            "validation_failed",
        )
        # A full record may replace ONLY a legacy-0001 row; this one was captured by a client.
        _assert_envelope(
            h.client.put(
                url,
                headers=auth(alice),
                json={"generation": 1, "items": [{**item, "upgraded_anchor": _record()}]},
            ),
            422,
            "validation_failed",
        )
        # Every rejected PUT above left the cache entry as the last good PUT wrote it.
        [still] = h.client.get(f"/papers/{paper_id}/highlights", headers=auth(alice)).json()
        assert still["anchors"][0]["resolution"]["tier"] == 1
