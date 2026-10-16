"""``GET /library/links`` (#194): citation links between the caller's own papers.

Three layers, cheapest first:

  * the matcher (`papertree_api.library_links`) on hand-written `LinkSource`s: the rules in its
    docstring, one test per rule (short titles, versions, hyphens, ligatures, no self-link, dedupe);
  * the route over seeded papers: owner isolation, a paper still parsing, the wire shape;
  * REAL PARSES of corpus papers uploaded through `POST /papers` and read back through the route.
    The audit (GAP-A1-library, 01e) found exactly two links on the demo library, both by title and
    none by arXiv id; `test_real_parses_reproduce_the_audits_two_title_links` re-derives that.
    Corpus PDFs are fetched, not committed (AGENTS.md §4): these skip LOUDLY when they are absent.
"""

from __future__ import annotations

import copy
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from api_support import auth, harness, load_fixture, register
from fastapi.testclient import TestClient
from papertree_api.library_links import (
    arxiv_ids_in,
    find_links,
    normalise_arxiv_id,
    title_in_entry,
)
from papertree_api.settings import Settings
from papertree_api.worker import run as run_worker
from papertree_db import LinkReference, LinkSource, PaperTreeDb, generation

BENCH = Path(__file__).resolve().parents[4] / "research" / "benchmarks"
CORPUS = {
    "attention": BENCH / "corpus" / "attention-is-all-you-need.pdf",
    "resnet": BENCH / "corpus" / "resnet-cvpr-2col.pdf",
    "bert": BENCH / "corpus" / "bert-2col.pdf",
    "ddpm": BENCH / "fresh" / "pdfs" / "ddpm-2006.11239.pdf",
    "yolo": BENCH / "fresh" / "pdfs" / "yolo-1506.02640.pdf",
}
_MISSING = [name for name, path in CORPUS.items() if not path.is_file()]
requires_corpus = pytest.mark.skipif(
    bool(_MISSING),
    reason=(
        f"corpus PDFs {_MISSING} are absent (fetched, not committed): run "
        "./research/benchmarks/fetch_corpus.sh and the fresh-set fetch to test real parses."
    ),
)

ATTENTION = "Attention Is All You Need"
ATTENTION_ENTRY = (
    "[2] Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N "
    "Gomez, Lukasz Kaiser, and Illia Polosukhin. Attention is all you need. In Advances in "
    "Neural Information Processing Systems, 2017."
)


def _source(
    pid: str,
    title: str | None = None,
    arxiv: str | None = None,
    entries: tuple[str, ...] = (),
    entry_arxiv: str | None = None,
) -> LinkSource:
    refs = tuple(
        LinkReference(index=i, text=t, arxiv_id=entry_arxiv if i == 0 else None)
        for i, t in enumerate(entries)
    )
    return LinkSource(paper_id=pid, title=title, arxiv_id=arxiv, references=refs)


# ── the matcher ─────────────────────────────────────────────────────────────────────────────

CITED = _source("B", ATTENTION)


def _linked(entry: str, cited: LinkSource = CITED) -> bool:
    return bool(find_links([_source("A", entries=(entry,)), cited]))


def test_arxiv_id_in_a_real_reference_string_matches_across_versions() -> None:
    entry = (
        "Ashish Vaswani et al. Attention is all you need. CoRR, abs/1706.03762, 2017. "
        "arXiv preprint arXiv:1706.03762v5."
    )
    # A title that does NOT match, so only the id can have made the link.
    cited = _source("B", "A Different Title Altogether Here", arxiv="1706.03762v7")
    links = find_links([_source("A", entries=(entry,)), cited])
    assert [(x.from_paper_id, x.to_paper_id, x.matched_by) for x in links] == [
        ("A", "B", "arxiv_id")
    ]
    assert links[0].reference_index == 0 and "arXiv:1706.03762v5" in links[0].reference_text


def test_the_parsers_own_arxiv_field_counts_and_other_ids_do_not() -> None:
    cited = _source("B", "Unrelated Words In This Title", arxiv="1706.03762")
    hit = _source("A", entries=("Some entry without an id in its text.",), entry_arxiv="1706.03762")
    miss = _source("C", entries=("Another one. arXiv:1706.03763v1, 2017.",))
    assert [x.from_paper_id for x in find_links([hit, miss, cited])] == ["A"]


def test_arxiv_id_helpers() -> None:
    assert normalise_arxiv_id("1706.03762v5") == normalise_arxiv_id("1706.03762") == "1706.03762"
    assert arxiv_ids_in("see arxiv.org/abs/1706.03762v2 and arXiv: hep-th/9901001v3") == [
        "1706.03762",
        "hep-th/9901001",
    ]
    assert arxiv_ids_in("doi 10.48550/arXiv.1706.03762") == ["1706.03762"]
    assert arxiv_ids_in("pages 1706.03762 of volume 12") == []  # a bare number is not an id
    assert arxiv_ids_in("arXiv:1706.037621") == []  # a longer digit run is not a shorter id
    assert arxiv_ids_in("arXiv:1706.03762v5.") == ["1706.03762"]


def test_one_link_per_pair_arxiv_preferred_over_title() -> None:
    cited = _source("B", ATTENTION, arxiv="1706.03762")
    same = _source("A", entries=(ATTENTION_ENTRY + " arXiv:1706.03762v5",))
    assert [x.matched_by for x in find_links([same, cited])] == ["arxiv_id"]
    # Title at entry 0, id at entry 1: still ONE link, the arXiv one.
    two = _source("A", entries=(ATTENTION_ENTRY, "Vaswani. Other. arXiv:1706.03762v5."))
    (link,) = find_links([two, cited])
    assert (link.matched_by, link.reference_index) == ("arxiv_id", 1)


def test_title_must_equal_the_title_segment() -> None:
    for entry in (
        "K. Smith. “Attention is all you need,” in NeurIPS, 2017.",  # quoted
        "A. Vaswani, N. Shazeer, and J. Uszkoreit. Attention is all you need. In NIPS, 2017.",
        "Vaswani, A. (2017). ATTENTION   IS ALL YOU NEED. NeurIPS.",  # APA, year in the block
        "Vaswani A, Shazeer N, et al. 2017. Attention is all you need? NIPS.",  # trailing mark
    ):
        assert _linked(entry), entry


def test_longer_titles_prose_and_venue_lines_do_not_link() -> None:
    for entry in (
        "Foo. Attention is all you need for graphs. 2019.",  # a different, longer-titled paper
        "Bar. We think attention is all you need to understand. 2019",  # prose
        "Baz. Some talk. In Advances: Attention Is All You Need Workshop Track, 2018.",  # venue
        "Qux. Is Attention Is All You Need Enough? NeurIPS, 2020.",  # a rebuttal
        "Attention is all you need. 2017.",  # no author block before it
    ):
        assert not _linked(entry), entry


def test_short_titles_are_exact_title_segments_never_venues_or_authors() -> None:
    for title, entry in (
        ("Neural Computation", "Smith. Foo bar. Neural Computation, 2016."),
        ("Geoffrey", "Hinton, Geoffrey. Foo bar. 2016."),
        ("Deep Residual Learning", "Deep Residual Learning, ICLR 2016."),
        ("Attention", "Vaswani. Attention is all you need. 2017."),
        ("Adam", "Using Adam, we study X. Adam works. 2019 Foo."),  # prose, not the title segment
    ):
        assert not _linked(entry, _source("B", title)), (title, entry)
    adam = _source("B", "Adam")
    assert _linked("D. P. Kingma and J. Ba. Adam. In ICLR, 2015.", adam)
    assert _linked("D. P. Kingma and J. Ba. \u201cAdam,\u201d in ICLR, 2015.", adam)


def test_title_match_folds_case_ligatures_and_line_broken_hyphens() -> None:
    cited = _source("B", "Deep Residual Learning for Image Recognition")
    for entry in (
        "He K. DEEP RESIDUAL   LEARNING FOR IM-AGE RECOGNITION. CVPR 2016.",
        "K. He. \u201cDeep residual learning for image recognition,\u201d in CVPR, 2016.",
    ):
        assert _linked(entry, cited), entry
    unified = "You Only Look Once: Uni\ufb01ed, Real-Time Object Detection"
    entry = "J. Redmon, S. Divvala. You only look once: Unified, real-time object detection. CVPR."
    assert title_in_entry(unified, entry)
    assert title_in_entry(
        "Self-Attention With Relative Position Representations",
        "P. Shaw, J. Uszkoreit. Self attention with relative position representations. NAACL.",
    )


def test_a_title_cut_across_two_entries_joins_only_a_broken_entry() -> None:
    """The real Attention parse cuts [11] into "...for im-" and "age recognition..."."""
    cited = _source("B", "Deep Residual Learning for Image Recognition")
    citing = _source(
        "A",
        entries=(
            "[11] Kaiming He, Xiangyu Zhang. Deep residual learning for im-",
            "age recognition. In Proceedings of the IEEE Conference on CVPR, 2016.",
            "[12] Sepp Hochreiter. Gradient flow in recurrent nets, 2001.",
        ),
    )
    (link,) = find_links([citing, cited])
    assert (link.matched_by, link.reference_index) == ("title", 0)
    assert "im-age recognition" in link.reference_text
    # No hyphen and a sentence end in the first entry: two separate entries, never joined.
    apart = _source("A", entries=("X. Y. Deep residual learning for.", "Image recognition. Z."))
    assert find_links([apart, cited]) == []
    # Joined for lack of a final mark + lower case, but the segment is longer than the title.
    longer = _source(
        "A",
        entries=(
            "[3] Smith J. A study of transformers. Attention is all",
            "you need to know: a tutorial.",
        ),
    )
    assert find_links([longer, CITED]) == []
    # A genuine unpunctuated split does link.
    split = _source("A", entries=("Smith J. Study. Attention is all", "you need. In NIPS, 2017."))
    assert [x.to_paper_id for x in find_links([split, CITED])] == ["B"]


def test_no_self_link_one_link_per_pair_and_first_entry_wins() -> None:
    me = _source("A", ATTENTION, arxiv="1706.03762", entries=(ATTENTION_ENTRY, "arXiv:1706.03762"))
    assert find_links([me]) == []
    citing = _source("A", entries=("x", ATTENTION_ENTRY, ATTENTION_ENTRY))
    (link,) = find_links([citing, CITED])
    assert link.reference_index == 1


def test_papers_without_references_or_titles_yield_nothing_and_no_error() -> None:
    assert find_links([]) == []
    assert find_links([_source("A"), _source("B", None), _source("C", "", None)]) == []


def test_links_scale(tmp_path: Path) -> None:
    """400 papers x 60 entries, realistic: 350 long titles that mostly share first words, 50 short
    titles, entries in author-block / title / venue form. The matching is timed alone, and the DB
    query (400 stored papers through `put_paper`) separately."""
    openers = ("Deep", "Learning", "Neural", "Attention", "Efficient")

    def title(k: int) -> str:
        if k % 8 == 0:
            return f"{openers[k % 5]} {k}"  # a short title: 2 words
        return f"{openers[k % 5]} Methods For Scalable Study Number {k} Of Models"

    def entry(k: int, j: int) -> str:
        other = (k * 7 + j) % 400 if j == 0 else None
        return (
            f"[{j}] A. Author, B. Writer and C. Coauthor. "
            f"{title(other) if other is not None else f'{openers[j % 5]} notes on topic {j}'}."
            f" In Proceedings of the Conference {j}, pages 1-9, 2019."
        )

    sources = [
        _source(f"P{k:03d}", title(k), entries=tuple(entry(k, j) for j in range(60)))
        for k in range(400)
    ]
    started = time.monotonic()
    links = find_links(sources)
    matching = time.monotonic() - started
    assert len(links) == 398  # 400 ring links minus the two self-references (k = 0, 200)
    assert matching < 1.0, matching

    with harness(tmp_path) as h:
        token = register(h.client, "scale@example.com")
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        db = PaperTreeDb(h.settings.database_file)
        try:
            owner = db.owner_for(user_id)
            base = load_fixture("resnet-cvpr-2col")
            for k in range(400):
                doc = copy.deepcopy(base)
                doc["paper_id"], doc["source_hash"] = _crockford(1000 + k), "sha256:" + f"{k:064x}"
                doc["metadata"]["title"]["value"] = title(k)
                doc["references"] = []
                for block, j in zip(doc["blocks"], range(60), strict=False):
                    block["text"] = entry(k, j)
                    doc["references"].append(
                        {"reference_entry_block_id": block["block_id"], "confidence": 0.6}
                    )
                db.put_paper(owner, doc)
                db.promote_generation(owner, doc["paper_id"], generation(1))
            started = time.monotonic()
            read = db.library_link_sources(owner)
            query = time.monotonic() - started
        finally:
            db.close()
    print(
        f"\n[library-links] 400 papers x 60 entries: {len(links)} links, matching "
        f"{matching:.3f}s; DB query ({len(read)} papers, {sum(len(r.references) for r in read)} "
        f"entries) {query:.3f}s"
    )
    assert len(read) == 400 and query < 3.0


def test_a_references_json_that_is_not_an_array_skips_that_paper_only(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        cited = _seed(h.settings, h.client, token, 1, ATTENTION, "1706.03762", [])
        good = _seed(h.settings, h.client, token, 2, "A Later Paper", None, [ATTENTION_ENTRY])
        bad = _seed(h.settings, h.client, token, 3, "Broken Paper", None, [ATTENTION_ENTRY])
        db = PaperTreeDb(h.settings.database_file)
        try:
            db._conn.execute(  # noqa: SLF001 - a writer never stores this; the row is hand-made
                "UPDATE papers SET references_json = '{\"oops\": 1}' WHERE paper_id = ?", (bad,)
            )
        finally:
            db.close()
        links = _links(h.client, token)
        assert [(x["from_paper_id"], x["to_paper_id"]) for x in links] == [(good, cited)]


# ── the route over seeded papers ────────────────────────────────────────────────────────────


def _crockford(n: int) -> str:
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    out = ""
    for _ in range(26):
        out, n = alphabet[n % 32] + out, n // 32
    return "ppr_" + out


def _seed(
    settings: Settings,
    client: TestClient,
    token: str,
    n: int,
    title: str,
    arxiv: str | None,
    entries: list[str],
) -> str:
    """A real committed fixture, retitled and with `entries` as its first blocks' text, stored the
    way the parse job stores it (`put_paper`). The reference records point at those blocks."""
    user_id = client.get("/auth/me", headers=auth(token)).json()["user_id"]
    doc: dict[str, Any] = copy.deepcopy(load_fixture("resnet-cvpr-2col"))
    doc["paper_id"] = _crockford(n)
    doc["source_hash"] = "sha256:" + f"{n:064x}"
    doc["metadata"]["title"]["value"] = title
    doc["metadata"]["arxiv_id"] = (
        None if arxiv is None else {"value": arxiv, "source_block_id": None, "confidence": 0.6}
    )
    doc["references"] = []
    for block, text in zip(doc["blocks"], entries, strict=False):
        block["text"] = text
        doc["references"].append({"reference_entry_block_id": block["block_id"], "confidence": 0.6})
    db = PaperTreeDb(settings.database_file)
    try:
        owner = db.owner_for(user_id)
        db.put_paper(owner, doc)
        db.promote_generation(owner, doc["paper_id"], generation(1))
    finally:
        db.close()
    return str(doc["paper_id"])


def _links(client: TestClient, token: str) -> list[dict[str, Any]]:
    response = client.get("/library/links", headers=auth(token))
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"links"}
    return body["links"]  # type: ignore[no-any-return]


def test_route_shape_and_owner_isolation(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        cited = _seed(h.settings, h.client, alice, 1, ATTENTION, "1706.03762", [])
        citing = _seed(h.settings, h.client, alice, 2, "A Later Paper", None, [ATTENTION_ENTRY])
        # Bob has a paper that also cites Attention, but no Attention of his own.
        _seed(h.settings, h.client, bob, 3, "Bob's Paper On Things", None, [ATTENTION_ENTRY])

        (link,) = _links(h.client, alice)
        assert link == {
            "from_paper_id": citing,
            "to_paper_id": cited,
            "via": "citation",
            "matched_by": "title",
            "reference": {"index": 0, "text": ATTENTION_ENTRY},
        }
        assert _links(h.client, bob) == []  # Alice's Attention is invisible to Bob
        assert h.client.get("/library/links").status_code == 401


def test_a_paper_still_parsing_yields_no_links_and_no_error(tmp_path: Path) -> None:
    pdf = BENCH / "corpus" / "resnet-cvpr-2col.pdf"
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        assert _links(h.client, token) == []  # an empty library
        if pdf.is_file():  # uploaded, queued, never run: no promoted generation
            r = h.client.post(
                "/papers",
                files={"file": ("r.pdf", pdf.read_bytes(), "application/pdf")},
                headers=auth(token),
            )
            assert r.status_code == 202
        else:
            pytest.skip(f"corpus PDF {pdf.name} absent: the queued-upload half cannot run")
        _seed(h.settings, h.client, token, 5, ATTENTION, "1706.03762", [])
        assert _links(h.client, token) == []


# ── real parses ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def real_library(
    tmp_path_factory: pytest.TempPathFactory,
) -> Iterator[tuple[dict[str, str], list[dict[str, Any]]]]:
    """The five corpus papers uploaded and parsed for real; (paper ids by short name, links)."""
    if _MISSING:
        pytest.skip(f"corpus PDFs {_MISSING} are absent")
    with harness(tmp_path_factory.mktemp("links")) as h:
        token = register(h.client, "reader@example.com")
        ids: dict[str, str] = {}
        for name, path in CORPUS.items():
            r = h.client.post(
                "/papers",
                files={"file": (path.name, path.read_bytes(), "application/pdf")},
                headers=auth(token),
            )
            assert r.status_code == 202, r.text
            ids[name] = r.json()["paper_id"]
        assert run_worker(h.settings, max_jobs=20) >= len(CORPUS)
        papers = {p["paper_id"]: p for p in h.client.get("/papers", headers=auth(token)).json()}
        assert all(p["processing"] == "ready" for p in papers.values()), papers
        yield ids, _links(h.client, token)


def _pairs(
    links: list[dict[str, Any]], ids: dict[str, str], within: tuple[str, ...]
) -> set[tuple[str, str, str]]:
    names = {v: k for k, v in ids.items()}
    return {
        (names[x["from_paper_id"]], names[x["to_paper_id"]], x["matched_by"])
        for x in links
        if {names[x["from_paper_id"]], names[x["to_paper_id"]]} <= set(within)
    }


@requires_corpus
def test_real_parses_reproduce_the_audits_two_title_links(
    real_library: tuple[dict[str, str], list[dict[str, Any]]],
) -> None:
    """The demo library is Attention, DDPM, ResNet and YOLO: two links, both by title."""
    ids, links = real_library
    demo = ("attention", "ddpm", "resnet", "yolo")
    assert _pairs(links, ids, demo) == {
        ("attention", "resnet", "title"),
        ("ddpm", "attention", "title"),
    }
    assert not [x for x in links if x["matched_by"] == "arxiv_id"]  # the audit found none either
    print("\n[library-links] real parses:", sorted(_pairs(links, ids, tuple(CORPUS))))


@requires_corpus
def test_real_parses_find_bert_citing_attention_and_nothing_spurious(
    real_library: tuple[dict[str, str], list[dict[str, Any]]],
) -> None:
    ids, links = real_library
    assert _pairs(links, ids, tuple(CORPUS)) == {
        ("attention", "resnet", "title"),
        ("ddpm", "attention", "title"),
        ("bert", "attention", "title"),
    }
    for link in links:
        assert link["from_paper_id"] != link["to_paper_id"] and link["via"] == "citation"
        assert link["reference"]["text"].strip()
    attention_to_resnet = next(x for x in links if x["to_paper_id"] == ids["resnet"])
    assert "im-age recognition" in attention_to_resnet["reference"]["text"]
