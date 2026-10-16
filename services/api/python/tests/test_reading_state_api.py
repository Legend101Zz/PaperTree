"""#192 over HTTP: the reading-state route, the library facts, and the display name.

The library facts (year, arXiv id and category) are asserted on REAL parses of the corpus papers,
uploaded and parsed by the real worker, so they test what the parser actually produced and not a
fixture written to agree with the rule. A missing PDF skips LOUDLY (AGENTS.md §4): the corpus is
fetched, not committed.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from api_support import auth, harness, register
from papertree_api.worker import run as run_worker

BENCHMARKS = Path(__file__).resolve().parents[4] / "research" / "benchmarks"

#: (pdf, title words, arXiv id, year first published, primary category). The year is NOT what the
#: parser's `metadata.year` says for Attention (2023), BERT (2019) or YOLO (2016): those are the
#: stamp's date, the latest version.
GOLDEN = [
    ("corpus/attention-is-all-you-need.pdf", "1706.03762", 2017, "cs.CL"),
    ("corpus/bert-2col.pdf", "1810.04805", 2018, "cs.CL"),
    ("corpus/resnet-cvpr-2col.pdf", "1512.03385", 2015, "cs.CV"),
    ("fresh/pdfs/yolo-1506.02640.pdf", "1506.02640", 2015, "cs.CV"),
    ("fresh/pdfs/ddpm-2006.11239.pdf", "2006.11239", 2020, "cs.LG"),
]


def _upload_and_parse(h, token: str, pdf: Path) -> str:  # type: ignore[no-untyped-def]
    response = h.client.post(
        "/papers",
        files={"file": (pdf.name, pdf.read_bytes(), "application/pdf")},
        headers=auth(token),
    )
    assert response.status_code == 202, response.text
    paper_id = str(response.json()["paper_id"])
    assert run_worker(h.settings, max_jobs=5) >= 1
    return paper_id


@pytest.mark.parametrize(("name", "arxiv_id", "year", "category"), GOLDEN)
def test_library_facts_on_a_real_parse(
    tmp_path: Path, name: str, arxiv_id: str, year: int, category: str
) -> None:
    pdf = BENCHMARKS / name
    if not pdf.is_file():
        pytest.skip(f"corpus PDF {name} is absent (fetched, not committed): facts NOT checked")
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        paper_id = _upload_and_parse(h, token, pdf)
        paper = h.client.get(f"/papers/{paper_id}", headers=auth(token)).json()
        listed = h.client.get("/papers", headers=auth(token)).json()
    print(
        f"\n[library-facts] {pdf.name}: year={paper['year']} arxiv_id={paper['arxiv_id']} "
        f"category={paper['arxiv_category']} pages={paper['page_count']}"
    )
    assert paper["processing"] in ("ready", "partial")
    assert paper["arxiv_id"] is not None and paper["arxiv_id"].startswith(arxiv_id)
    assert paper["year"] == year
    assert paper["arxiv_category"] == category
    assert (paper["reading"], paper["thread_count"], paper["has_summary"]) == (None, 0, False)
    assert listed == [paper]


def test_reading_state_over_http_on_a_real_parse(tmp_path: Path) -> None:
    pdf = BENCHMARKS / "fresh/pdfs/yolo-1506.02640.pdf"  # 10 pages
    if not pdf.is_file():
        pytest.skip(
            "corpus PDF yolo-1506.02640.pdf is absent: reading state NOT checked on a parse"
        )
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        intruder = register(h.client, "mallory@example.com")
        paper_id = _upload_and_parse(h, token, pdf)
        url = f"/papers/{paper_id}/reading-state"

        def reading() -> dict[str, object] | None:
            return h.client.get(f"/papers/{paper_id}", headers=auth(token)).json()["reading"]  # type: ignore[no-any-return]

        assert h.client.put(url, json={"last_page": 3}).status_code == 401
        assert reading() is None  # not started

        assert (
            h.client.put(
                url, json={"last_page": 3, "mode": "split"}, headers=auth(token)
            ).status_code
            == 204
        )
        first = reading()
        assert first is not None
        assert (first["last_page"], first["furthest_page"], first["page_count"]) == (3, 3, 10)
        assert (first["state"], first["finished_at"]) == ("reading", None)

        h.client.put(url, json={"last_page": 1}, headers=auth(token))
        back = reading()
        assert back is not None and (back["last_page"], back["furthest_page"]) == (1, 3)

        h.client.put(url, json={"last_page": 9}, headers=auth(token))
        done = reading()
        assert done is not None and done["state"] == "finished" and done["finished_at"]

        # 422: negative, past the last page (10 pages), bad mode, not an integer.
        for bad in (
            {"last_page": -1},
            {"last_page": 10},
            {"last_page": 1, "mode": "x"},
            {"last_page": "1"},
        ):
            assert h.client.put(url, json=bad, headers=auth(token)).status_code == 422, bad

        # Another user's paper is a 404, and writes nothing; their library never shows the state.
        assert h.client.put(url, json={"last_page": 2}, headers=auth(intruder)).status_code == 404
        assert h.client.get(f"/papers/{paper_id}", headers=auth(intruder)).status_code == 404
        assert h.client.get("/papers", headers=auth(intruder)).json() == []
        unknown = "/papers/ppr_00000000000000000000000000/reading-state"
        assert h.client.put(unknown, json={"last_page": 0}, headers=auth(token)).status_code == 404
        after = reading()
        assert (
            after is not None
            and after["last_page"] == 9
            and after["opened_at"] == done["opened_at"]
        )


def test_display_name_over_http(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        me = h.client.get("/auth/me", headers=auth(alice)).json()
        assert me["display_name"] is None and me["email"] == "alice@example.com"

        patched = h.client.patch(
            "/auth/me", json={"display_name": "  Ada L.  "}, headers=auth(alice)
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["display_name"] == "Ada L."
        assert h.client.get("/auth/me", headers=auth(alice)).json()["display_name"] == "Ada L."
        assert h.client.get("/auth/me", headers=auth(bob)).json()["display_name"] is None

        for bad in ("", "   ", "x" * 61, 5, None):
            response = h.client.patch("/auth/me", json={"display_name": bad}, headers=auth(alice))
            assert response.status_code == 422, bad
        assert (
            h.client.patch(
                "/auth/me", json={"display_name": "x" * 60}, headers=auth(alice)
            ).status_code
            == 200
        )
        # Padding that trims away does not count against the 60.
        padded = h.client.patch(
            "/auth/me", json={"display_name": " " * 5 + "y" * 60}, headers=auth(alice)
        )
        assert padded.status_code == 200
        assert h.client.patch("/auth/me", json={"display_name": "z"}).status_code == 401
