"""#193 part 1 over HTTP: topics, a paper's topic, and the deterministic suggestion.

The suggestion is asserted on REAL parses of the corpus papers (Attention and BERT are cs.CL, DDPM
is cs.LG), uploaded and parsed by the real worker, so the categories are what the parser produced
and not ones a fixture was written to agree with. A missing PDF skips LOUDLY (AGENTS.md §4).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, get_args

import pytest
from api_support import assert_envelope, auth, harness, register, seed_paper
from papertree_api.schemas import Cloth
from papertree_api.worker import run as run_worker
from papertree_db import CLOTHS

BENCHMARKS = Path(__file__).resolve().parents[4] / "research" / "benchmarks"
ATTENTION = "corpus/attention-is-all-you-need.pdf"
BERT = "corpus/bert-2col.pdf"
DDPM = "fresh/pdfs/ddpm-2006.11239.pdf"


def _upload_and_parse(h, token: str, name: str) -> str:  # type: ignore[no-untyped-def]
    pdf = BENCHMARKS / name
    if not pdf.is_file():
        pytest.skip(f"corpus PDF {name} is absent (fetched, not committed): topics NOT checked")
    response = h.client.post(
        "/papers",
        files={"file": (pdf.name, pdf.read_bytes(), "application/pdf")},
        headers=auth(token),
    )
    assert response.status_code == 202, response.text
    assert run_worker(h.settings, max_jobs=5) >= 1
    return str(response.json()["paper_id"])


def test_the_wire_cloth_list_is_the_databases() -> None:
    assert set(get_args(Cloth)) == set(CLOTHS)


def test_a_new_cs_cl_paper_is_suggested_into_the_topic_holding_cs_cl_papers(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        attention = _upload_and_parse(h, token, ATTENTION)
        topic = h.client.post(
            "/topics",
            json={"name": "Transformers & attention", "cloth": "transformers"},
            headers=auth(token),
        )
        assert topic.status_code == 201, topic.text
        topic_id = topic.json()["topic_id"]

        # Nothing holds cs.CL yet: no deterministic suggestion, and nothing is stored.
        first = h.client.get(f"/papers/{attention}/topic", headers=auth(token)).json()
        assert first == {
            "status": "none",
            "topic": None,
            "suggested_name": None,
            "source": None,
            "source_detail": None,
            "arxiv_category": "cs.CL",
        }

        put = h.client.put(
            f"/papers/{attention}/topic", json={"topic_id": topic_id}, headers=auth(token)
        )
        assert put.status_code == 200, put.text
        assert (put.json()["status"], put.json()["source"]) == ("accepted", "manual")

        bert = _upload_and_parse(h, token, BERT)
        offered = h.client.get(f"/papers/{bert}/topic", headers=auth(token)).json()
        assert offered["status"] == "suggested"
        assert offered["topic"]["topic_id"] == topic_id
        assert (offered["source"], offered["source_detail"]) == ("arxiv_category", "cs.CL")
        assert offered["arxiv_category"] == "cs.CL"
        # Idempotent, and a suggestion shelves nothing.
        assert h.client.get(f"/papers/{bert}/topic", headers=auth(token)).json() == offered
        row = h.client.get(f"/papers/{bert}", headers=auth(token)).json()
        assert row["topic"] is None
        listed = h.client.get("/topics", headers=auth(token)).json()
        assert [(t["paper_count"], t["categories"]) for t in listed] == [(1, ["cs.CL"])]

        accepted = h.client.put(
            f"/papers/{bert}/topic", json={"topic_id": topic_id}, headers=auth(token)
        )
        assert accepted.json()["status"] == "accepted"
        assert (accepted.json()["source"], accepted.json()["source_detail"]) == (
            "arxiv_category",
            "cs.CL",
        )
        row = h.client.get(f"/papers/{bert}", headers=auth(token)).json()
        assert row["topic"] == {
            "topic_id": topic_id,
            "name": "Transformers & attention",
            "cloth": "transformers",
            "source": "arxiv_category",
            "source_detail": "cs.CL",
        }
        assert [
            p["topic"] and p["topic"]["name"]
            for p in h.client.get("/papers", headers=auth(token)).json()
        ] == ["Transformers & attention"] * 2
        pages = sum(p["page_count"] for p in h.client.get("/papers", headers=auth(token)).json())
        listed = h.client.get("/topics", headers=auth(token)).json()
        assert [(t["paper_count"], t["page_count"], t["categories"]) for t in listed] == [
            (2, pages, ["cs.CL"])
        ]

        # DDPM is cs.LG and no topic holds one: no suggestion (the model seam returns None).
        ddpm = _upload_and_parse(h, token, DDPM)
        none = h.client.get(f"/papers/{ddpm}/topic", headers=auth(token)).json()
        assert (none["status"], none["topic"], none["arxiv_category"]) == ("none", None, "cs.LG")


def test_a_decision_sticks(tmp_path: Path) -> None:
    """Reject -> unshelve -> read, and unshelve -> read, never offer the same topic back."""
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        attention = _upload_and_parse(h, token, ATTENTION)
        bert = _upload_and_parse(h, token, BERT)
        topic_id = h.client.post(
            "/topics", json={"name": "Transformers"}, headers=auth(token)
        ).json()["topic_id"]
        h.client.put(f"/papers/{attention}/topic", json={"topic_id": topic_id}, headers=auth(token))

        def topic(paper: str) -> dict[str, object]:
            return h.client.get(f"/papers/{paper}/topic", headers=auth(token)).json()  # type: ignore[no-any-return]

        assert topic(bert)["status"] == "suggested"
        # Sequence 1: reject the offer, unshelve, read.
        assert (
            h.client.post(f"/papers/{bert}/topic/reject", headers=auth(token)).json()["status"]
            == "rejected"
        )
        again = h.client.delete(f"/papers/{bert}/topic", headers=auth(token)).json()
        assert (again["status"], again["topic"]) == ("rejected", None)
        assert (topic(bert)["status"], topic(bert)["topic"]) == ("rejected", None)

        # Choosing is still possible; then sequence 2: unshelve an accepted paper, read.
        put = h.client.put(
            f"/papers/{bert}/topic", json={"topic_id": topic_id}, headers=auth(token)
        )
        assert put.json()["status"] == "accepted" and put.json()["source"] == "manual"
        left = h.client.delete(f"/papers/{bert}/topic", headers=auth(token)).json()
        assert (left["status"], left["topic"]) == ("rejected", None)
        assert (topic(bert)["status"], topic(bert)["topic"]) == ("rejected", None)
        assert h.client.get(f"/papers/{bert}", headers=auth(token)).json()["topic"] is None

        # "Reject" on an accepted paper is a real remove-and-reject: no topic on the wire anywhere.
        h.client.put(f"/papers/{bert}/topic", json={"topic_id": topic_id}, headers=auth(token))
        rejected = h.client.post(f"/papers/{bert}/topic/reject", headers=auth(token)).json()
        assert (rejected["status"], rejected["topic"]) == ("rejected", None)
        assert h.client.get(f"/papers/{bert}", headers=auth(token)).json()["topic"] is None
        counts = h.client.get("/topics", headers=auth(token)).json()
        assert [t["paper_count"] for t in counts] == [1]  # only Attention is left on the shelf


def test_topic_crud_and_errors(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        assert h.client.get("/topics").status_code == 401
        assert h.client.get("/topics", headers=auth(token)).json() == []

        made = h.client.post("/topics", json={"name": "  Vision  "}, headers=auth(token))
        assert made.status_code == 201
        topic = made.json()
        assert (topic["name"], topic["cloth"], topic["paper_count"]) == ("Vision", None, 0)
        assert set(topic) == {
            "topic_id",
            "name",
            "cloth",
            "sort_order",
            "paper_count",
            "page_count",
            "categories",
        }

        assert_envelope(
            h.client.post("/topics", json={"name": "vision"}, headers=auth(token)),
            409,
            "topic_exists",
        )
        for body in (
            {"name": ""},
            {"name": "   "},
            {"name": "x" * 61},
            {"name": "A", "cloth": "magenta"},
            {},
        ):
            assert_envelope(
                h.client.post("/topics", json=body, headers=auth(token)), 422, "validation_failed"
            )
        assert (
            h.client.post("/topics", json={"name": "x" * 60}, headers=auth(token)).status_code
            == 201
        )

        url = f"/topics/{topic['topic_id']}"
        patched = h.client.patch(
            url, json={"name": "Seeing", "cloth": "vision", "sort_order": 7}, headers=auth(token)
        )
        assert patched.status_code == 200, patched.text
        assert (patched.json()["name"], patched.json()["cloth"], patched.json()["sort_order"]) == (
            "Seeing",
            "vision",
            7,
        )
        cleared = h.client.patch(url, json={"cloth": None}, headers=auth(token))
        assert cleared.status_code == 200 and cleared.json()["cloth"] is None
        assert cleared.json()["name"] == "Seeing"  # only what is sent changes
        assert_envelope(
            h.client.patch(url, json={"name": "X" * 60}, headers=auth(token)), 409, "topic_exists"
        )
        assert_envelope(
            h.client.patch(url, json={"name": None}, headers=auth(token)), 422, "validation_failed"
        )
        assert_envelope(
            h.client.patch(f"/topics/top_{'0' * 26}", json={"name": "Z"}, headers=auth(token)),
            404,
            "not_found",
        )

        assert h.client.delete(url, headers=auth(token)).status_code == 204
        assert_envelope(h.client.delete(url, headers=auth(token)), 404, "not_found")
        assert [t["name"] for t in h.client.get("/topics", headers=auth(token)).json()] == [
            "x" * 60
        ]


def test_papers_topics_and_isolation(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        mallory = register(h.client, "mallory@example.com")
        paper = seed_paper(h.settings, h.client, alice, "resnet-cvpr-2col")
        secret = h.client.post("/topics", json={"name": "Alice only"}, headers=auth(alice)).json()
        url = f"/papers/{paper}/topic"

        # Accept a topic by id, then a NEW one by name (created on the spot), then the same name
        # in another letter case reuses it.
        ok = h.client.put(url, json={"topic_id": secret["topic_id"]}, headers=auth(alice))
        assert ok.status_code == 200 and ok.json()["topic"]["name"] == "Alice only"
        new = h.client.put(
            url, json={"new_topic_name": "Deep nets", "cloth": "vision"}, headers=auth(alice)
        )
        assert (
            new.json()["topic"]["name"] == "Deep nets" and new.json()["topic"]["cloth"] == "vision"
        )
        again = h.client.put(url, json={"new_topic_name": "deep NETS"}, headers=auth(alice))
        assert again.json()["topic"] == new.json()["topic"]
        names = {
            t["name"]: t["paper_count"] for t in h.client.get("/topics", headers=auth(alice)).json()
        }
        assert names == {"Alice only": 0, "Deep nets": 1}

        for body in (
            {},
            {"topic_id": secret["topic_id"], "new_topic_name": "x"},
            {"topic_id": "nope"},
        ):
            assert_envelope(
                h.client.put(url, json=body, headers=auth(alice)), 422, "validation_failed"
            )
        assert_envelope(
            h.client.put(url, json={"topic_id": f"top_{'0' * 26}"}, headers=auth(alice)),
            404,
            "not_found",
        )

        # Mallory: another owner's paper and topic are 404 everywhere, and list nothing of Alice's.
        assert h.client.get("/topics", headers=auth(mallory)).json() == []
        mine = h.client.post("/topics", json={"name": "Mine"}, headers=auth(mallory)).json()
        attempts: tuple[tuple[str, str, dict[str, Any] | None], ...] = (
            ("get", url, None),
            ("put", url, {"topic_id": mine["topic_id"]}),
            ("post", f"{url}/reject", None),
            ("delete", url, None),
        )
        for method, path, payload in attempts:
            response = h.client.request(method, path, json=payload, headers=auth(mallory))
            assert_envelope(response, 404, "not_found")
        assert_envelope(
            h.client.put(url, json={"topic_id": secret["topic_id"]}, headers=auth(mallory)),
            404,
            "not_found",
        )
        stolen = h.client.put(
            f"/papers/{paper}/topic", json={"topic_id": mine["topic_id"]}, headers=auth(alice)
        )
        assert_envelope(stolen, 404, "not_found")  # and Alice cannot use Mallory's topic either
        assert_envelope(
            h.client.patch(
                f"/topics/{secret['topic_id']}", json={"name": "Hi"}, headers=auth(mallory)
            ),
            404,
            "not_found",
        )
        assert_envelope(
            h.client.delete(f"/topics/{secret['topic_id']}", headers=auth(mallory)),
            404,
            "not_found",
        )

        # Deleting the topic unshelves the paper; the paper itself stays.
        deep = new.json()["topic"]["topic_id"]
        assert h.client.delete(f"/topics/{deep}", headers=auth(alice)).status_code == 204
        row = h.client.get(f"/papers/{paper}", headers=auth(alice)).json()
        assert row["topic"] is None and row["processing"] in ("ready", "partial")
        assert h.client.get(url, headers=auth(alice)).json()["status"] == "none"
        for body in (
            h.client.get("/topics", headers=auth(alice)).text,
            h.client.get(url, headers=auth(alice)).text,
        ):
            assert "owner" not in body and "own_" not in body
