"""The opened book over HTTP (v0.2 S3, #200): figures, the cover plate, the abstract.

On REAL parses, uploaded through ``POST /papers`` and parsed by the real worker, so every figure,
caption and ``caption_of`` link is the parser's and not one a fixture was written to agree with:

  * Attention: Figure 1 (p. 3, "The Transformer - model architecture") is found with its caption,
    and "Use Figure 1 as the plate" sets a plate the library row then carries;
  * a3c: the parser keeps a "Figure 1." caption on p. 5 but attaches it to no figure, so there is
    no caption-matched Figure 1 and no offer (GAP-A1 D6 left WHICH paper lacks one NOT CONFIRMED;
    a probe over all 14 corpus papers found a3c, and GPT-3, whose captions are numbered 1.1, 1.2).

Corpus PDFs are fetched, not committed (AGENTS.md §4): the real-parse tests skip LOUDLY without
them. The refusals and the isolation run against the same parses.
"""

from __future__ import annotations

import copy
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from api_support import Harness, assert_envelope, auth, harness, register
from papertree_api.figures import figure_label, stable_exp
from papertree_api.worker import run as run_worker

BENCH = Path(__file__).resolve().parents[4] / "research" / "benchmarks" / "corpus"
ATTENTION = BENCH / "attention-is-all-you-need.pdf"
A3C = BENCH / "a3c-algorithmheavy.pdf"
_MISSING = [p.name for p in (ATTENTION, A3C) if not p.is_file()]
requires_corpus = pytest.mark.skipif(
    bool(_MISSING),
    reason=(
        f"corpus PDFs {_MISSING} are absent (fetched, not committed): run "
        "./research/benchmarks/fetch_corpus.sh; the opened book's real-parse tests did NOT run."
    ),
)


@dataclass(frozen=True, slots=True)
class Library:
    """One app with two readers: A holds Attention and a3c, B holds their own Attention."""

    h: Harness
    a: str
    b: str
    attention: str
    a3c: str
    b_attention: str


def _upload(h: Harness, token: str, pdf: Path) -> str:
    response = h.client.post(
        "/papers",
        files={"file": (pdf.name, pdf.read_bytes(), "application/pdf")},
        headers=auth(token),
    )
    assert response.status_code == 202, response.text
    return str(response.json()["paper_id"])


@pytest.fixture(scope="module")
def library(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Library]:
    if _MISSING:
        pytest.skip(f"corpus PDFs {_MISSING} are absent: the opened book was NOT checked")
    with harness(tmp_path_factory.mktemp("book")) as h:
        a, b = register(h.client, "a@example.com"), register(h.client, "b@example.com")
        ids = (_upload(h, a, ATTENTION), _upload(h, a, A3C), _upload(h, b, ATTENTION))
        assert run_worker(h.settings, max_jobs=10) >= 3
        yield Library(h, a, b, ids[0], ids[1], ids[2])


def _figures(lib: Library, token: str, paper_id: str) -> list[dict[str, Any]]:
    response = lib.h.client.get(f"/papers/{paper_id}/figures", headers=auth(token))
    assert response.status_code == 200, response.text
    body: list[dict[str, Any]] = response.json()
    return body


def _figure_1(figures: list[dict[str, Any]]) -> dict[str, Any]:
    (found,) = [f for f in figures if f["label"] == "Figure 1"]
    return found


def _row(lib: Library, token: str, paper_id: str) -> dict[str, Any]:
    response = lib.h.client.get(f"/papers/{paper_id}", headers=auth(token))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


# ── pure rules ────────────────────────────────────────────────────────────────────────────


def test_a_label_is_the_number_a_caption_starts_with() -> None:
    assert figure_label("Figure 1: The Transformer - model architecture.") == "Figure 1"
    assert figure_label("Figure 1. Training error (left)") == "Figure 1"  # ResNet's full stop
    assert figure_label("Fig. 3. Results") == "Figure 3"
    assert figure_label("FIGURE 12: Ablation") == "Figure 12"
    assert figure_label("Figure 1.1: Language model meta-learning.") == "Figure 1.1"  # GPT-3
    assert figure_label("Table 1: Maximum path lengths") is None
    assert figure_label("As Figure 1 shows, ...") is None  # a mention is not a label
    assert figure_label("Figure 1 shows the model.") is None  # nor a body sentence opening on it
    assert figure_label("Figure 1.2 illustrates the trend") is None
    assert figure_label("Figure 3") == "Figure 3"  # a caption that is only its label
    assert figure_label(None) is None


def test_signed_urls_hold_still_for_ten_minutes_and_live_an_hour() -> None:
    now = 1_760_000_000.0
    assert all(3600 <= stable_exp(now + d) - (now + d) <= 4200 for d in range(0, 1300, 7))
    assert len({stable_exp(now + d) for d in range(0, 600)}) <= 2


# ── figures on real parses ────────────────────────────────────────────────────────────────


@requires_corpus
def test_attention_figure_1_on_page_3_is_found_with_its_caption(library: Library) -> None:
    figures = _figures(library, library.a, library.attention)
    labels = [f["label"] for f in figures if f["label"] is not None]
    print(f"\n[book] Attention: {len(figures)} figure regions, labels {labels}")
    assert labels == ["Figure 1", "Figure 2", "Figure 3", "Figure 4", "Figure 5"]
    one = _figure_1(figures)
    assert one["page_index"] == 2  # p. 3
    assert one["caption_text"].startswith("Figure 1: The Transformer - model architecture")
    assert one["caption_block_id"] is not None
    assert one["anchor"]["targetKind"] == "figure"
    assert one["anchor"]["doc"]["paperId"] == library.attention
    assert one["anchor"]["provenanceClass"] == "source"
    assert {s["type"] for s in one["anchor"]["selectors"]} >= {"BlockSelector", "ShapeSelector"}
    # The crop loads with no Bearer: the signature is the grant, for that one object.
    crop = library.h.client.get(one["asset_url"])
    assert crop.status_code == 200 and crop.headers["content-type"] == "image/png"
    # Figure 2 is two regions, only one captioned: listed as found, not merged.
    assert sum(1 for f in figures if f["page_index"] == 3) == 2


@requires_corpus
def test_a3c_has_no_caption_matched_figure_1_so_there_is_no_offer(library: Library) -> None:
    figures = _figures(library, library.a, library.a3c)
    labels = [f["label"] for f in figures if f["label"] is not None]
    print(f"\n[book] a3c: {len(figures)} figure regions, labels {labels}")
    assert figures and "Figure 1" not in labels
    # The caption exists: what is missing is the link, which is what the offer keys on.
    blocks = library.h.client.get(f"/papers/{library.a3c}/blocks", headers=auth(library.a)).json()
    captions = [
        b for b in blocks if b["type"] == "caption" and figure_label(b["text"]) == "Figure 1"
    ]
    assert captions, "a3c's 'Figure 1.' caption is gone: re-probe which paper lacks a Figure 1"
    assert {f["caption_block_id"] for f in figures}.isdisjoint({c["block_id"] for c in captions})


@requires_corpus
def test_the_abstract_is_the_parsers_with_an_anchor_on_page_1(library: Library) -> None:
    response = library.h.client.get(
        f"/papers/{library.attention}/abstract", headers=auth(library.a)
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["text"].startswith("The dominant sequence transduction models are based on")
    assert body["page_index"] == 0
    assert body["anchor"]["targetKind"] == "text"
    assert body["anchor"]["doc"]["paperId"] == library.attention


# ── the plate ─────────────────────────────────────────────────────────────────────────────


@requires_corpus
def test_use_figure_1_as_the_plate_then_put_it_back(library: Library) -> None:
    client, token, paper = library.h.client, library.a, library.attention
    assert _row(library, token, paper)["plate"] is None  # the typographic cover by default
    one = _figure_1(_figures(library, token, paper))
    sent = {**one["anchor"], "resolution": {"tier": 1}}  # a client's T0 cache is stripped
    put = client.put(f"/papers/{paper}/plate", json={"anchor": sent}, headers=auth(token))
    assert put.status_code == 204, put.text

    row = _row(library, token, paper)
    plate = row["plate"]
    assert (plate["block_id"], plate["page_index"], plate["label"]) == (
        one["block_id"],
        2,
        "Figure 1",
    )
    assert plate["caption_text"].startswith("Figure 1: The Transformer")
    assert client.get(plate["asset_url"]).status_code == 200
    listed = {p["paper_id"]: p for p in client.get("/papers", headers=auth(token)).json()}
    assert listed[paper]["plate"] == plate  # the same URL on a second read in this window
    assert listed[paper]["notebook_count"] == 0

    assert client.delete(f"/papers/{paper}/plate", headers=auth(token)).status_code == 204
    assert _row(library, token, paper)["plate"] is None
    assert client.delete(f"/papers/{paper}/plate", headers=auth(token)).status_code == 204


@requires_corpus
def test_the_plate_refuses_what_is_not_a_figure_of_this_paper(library: Library) -> None:
    client, token, paper = library.h.client, library.a, library.attention
    one = _figure_1(_figures(library, token, paper))

    def put(anchor: Any) -> Any:
        return client.put(f"/papers/{paper}/plate", json={"anchor": anchor}, headers=auth(token))

    # The abstract's Anchor: a real one, on this paper, but not a figure.
    text = client.get(f"/papers/{paper}/abstract", headers=auth(token)).json()["anchor"]
    assert_envelope(put(text), 422, "validation_failed")
    # Called a figure, but its block is a paragraph and its box is the abstract's.
    lying = {**text, "targetKind": "figure"}
    assert_envelope(put(lying), 422, "validation_failed")
    # Another paper's figure (a3c's first region) on this paper's route.
    other = _figures(library, token, library.a3c)[0]["anchor"]
    assert_envelope(put(other), 422, "anchor_mismatch")
    # This paper's id with other bytes.
    forged = copy.deepcopy(one["anchor"])
    forged["doc"]["pdfSha256"] = "sha256:" + "0" * 64
    assert_envelope(put(forged), 422, "anchor_mismatch")
    # Not an Anchor at all.
    assert_envelope(put({"doc": {"paperId": paper}}), 422, "validation_failed")
    assert _row(library, token, paper)["plate"] is None  # nothing was stored


@requires_corpus
def test_another_reader_cannot_see_or_touch_the_plate(library: Library) -> None:
    client, a, b, paper = library.h.client, library.a, library.b, library.attention
    one = _figure_1(_figures(library, a, paper))
    put = client.put(f"/papers/{paper}/plate", json={"anchor": one["anchor"]}, headers=auth(a))
    assert put.status_code == 204, put.text
    for method, path in (
        ("GET", f"/papers/{paper}/figures"),
        ("GET", f"/papers/{paper}/abstract"),
        ("DELETE", f"/papers/{paper}/plate"),
    ):
        assert_envelope(client.request(method, path, headers=auth(b)), 404, "not_found")
    # B's own copy of the same PDF is another paper: A's anchor is on the wrong paper there, and
    # B's anchor cannot be put on A's paper.
    mine = _figure_1(_figures(library, b, library.b_attention))["anchor"]
    on_a = client.put(f"/papers/{paper}/plate", json={"anchor": mine}, headers=auth(b))
    assert_envelope(on_a, 404, "not_found")
    cross = client.put(
        f"/papers/{library.b_attention}/plate", json={"anchor": one["anchor"]}, headers=auth(b)
    )
    assert_envelope(cross, 422, "anchor_mismatch")
    assert _row(library, b, library.b_attention)["plate"] is None
    assert _row(library, a, paper)["plate"]["label"] == "Figure 1"  # A's choice untouched
    assert client.delete(f"/papers/{paper}/plate", headers=auth(a)).status_code == 204


@requires_corpus
def test_a_valid_plate_on_a_paper_still_being_read_is_409(library: Library) -> None:
    """The body is a real figure Anchor, so the route gets past validation to the parse check."""
    client = library.h.client
    reader = register(client, "c@example.com")
    queued = _upload(library.h, reader, ATTENTION)  # uploaded, and the worker is not run again
    anchor = _figure_1(_figures(library, library.a, library.attention))["anchor"]
    response = client.put(f"/papers/{queued}/plate", json={"anchor": anchor}, headers=auth(reader))
    assert_envelope(response, 409, "not_parsed")


def test_a_paper_still_being_read_has_no_figures_yet(tmp_path: Path) -> None:
    if not ATTENTION.is_file():
        pytest.skip(f"corpus PDF {ATTENTION.name} absent: the queued-paper half did NOT run")
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        paper = _upload(h, token, ATTENTION)  # uploaded, never parsed
        for method, path in (
            ("GET", f"/papers/{paper}/figures"),
            ("GET", f"/papers/{paper}/abstract"),
        ):
            assert_envelope(h.client.request(method, path, headers=auth(token)), 409, "not_parsed")
        anchor = {"doc": {"paperId": paper}}
        response = h.client.put(
            f"/papers/{paper}/plate", json={"anchor": anchor}, headers=auth(token)
        )
        assert_envelope(response, 422, "validation_failed")  # the body is read first
        assert h.client.get(f"/papers/{paper}", headers=auth(token)).json()["plate"] is None
        missing = "/papers/ppr_00000000000000000000000000/figures"
        assert_envelope(h.client.get(missing, headers=auth(token)), 404, "not_found")
