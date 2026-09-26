"""The citation Anchor is a PRODUCER-side record, so it is tested on real parses (AGENTS.md §4):
every text block of a stored generation, cited through ``evidence.DocumentCache`` +
``papertree_anchoring.capture_citation`` exactly as a run's ``done`` does, is held to BOTH
checkers of ``contracts/anchor/anchor-v1.schema.json`` (the hand schema, and pydantic
``AnchorV1`` on the JSON).

  * always: the three committed fixture parses (``packages/document-ir/fixtures``);
  * corpus-gated, skipping LOUDLY: two corpus PDFs uploaded through ``POST /papers`` and parsed by
    the real worker, then an explain over the FakeAgent on that fresh parse.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import httpx
import pytest
from ai_support import SECRET, anchor_errors, events, read_sse
from api_support import auth, harness, register, seed_paper
from fake_agent import FakeAgent, Script
from fastapi.testclient import TestClient
from papertree_anchoring import capture_citation
from papertree_api import create_app
from papertree_api.evidence import DocumentCache
from papertree_api.settings import Settings
from papertree_api.worker import run as run_worker
from papertree_db import PaperTreeDb

CORPUS = Path(__file__).resolve().parents[4] / "research" / "benchmarks" / "corpus"
CORPUS_PAPERS = ("resnet-cvpr-2col.pdf", "attention-is-all-you-need.pdf")
requires_corpus = pytest.mark.skipif(
    not all((CORPUS / name).is_file() for name in CORPUS_PAPERS),
    reason=(
        f"corpus PDFs {CORPUS_PAPERS} are absent — fetched, not committed. Run "
        "./research/benchmarks/fetch_corpus.sh to test citation Anchors on real parses."
    ),
)


def _cite_every_text_block(settings: Settings, user_id: str, paper_id: str) -> int:
    db = PaperTreeDb(settings.database_file)
    try:
        owner = db.owner_for(user_id)
        generation = db.promoted_generation(owner, paper_id)  # type: ignore[arg-type]
        assert generation is not None
        doc = DocumentCache().get(db, owner, user_id, paper_id, generation)
        assert doc is not None
        cited = 0
        for indexed in doc.blocks:
            if not indexed.text.strip():
                continue
            anchor = dict(
                capture_citation(
                    doc,
                    indexed.block.block_id,
                    citation_id=f"cit_{uuid.uuid4().hex[:26].upper()}",
                    at="2026-09-26T05:00:00.000Z",
                )
            )
            errors = anchor_errors(anchor)
            assert errors == [], (indexed.block.block_id, indexed.block.type, errors[:3])
            assert (
                anchor["doc"]["textStreamId"]
                == f"api/{paper_id}/g{generation}/{doc.parser_version}"
            )
            cited += 1
        return cited
    finally:
        db.close()


@pytest.mark.parametrize(
    "slug", ["attention-is-all-you-need", "neural-odes-mathheavy", "resnet-cvpr-2col"]
)
def test_every_citation_of_a_fixture_parse_is_a_valid_anchor(tmp_path: Path, slug: str) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, slug)
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
    cited = _cite_every_text_block(h.settings, user_id, paper_id)
    print(f"\n[citation-anchors] {slug}: {cited} citations, all valid in both checkers")
    assert cited > 20


def test_the_checkers_refuse_a_broken_citation(tmp_path: Path) -> None:
    """Non-vacuity for "all valid" above: the same checkers REFUSE a minted citation with one
    field broken, in each of the ways a producer bug would break it."""
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
    db = PaperTreeDb(h.settings.database_file)
    owner = db.owner_for(user_id)
    doc = DocumentCache().get(db, owner, user_id, paper_id, 1)
    db.close()
    assert doc is not None
    block = next(b for b in doc.blocks if b.text.strip())
    good = dict(capture_citation(doc, block.block.block_id, citation_id="cit_" + "A" * 26, at="x"))
    assert anchor_errors(good) == []
    for broken in (
        {**good, "targetKind": "paragraph"},
        {**good, "provenanceClass": "model"},
        {**good, "doc": {**good["doc"], "pdfSha256": "not-a-hash"}},
        {**good, "id": "not an id"},
        {**good, "resolution": {"tier": 1}},
    ):
        assert anchor_errors(broken) != [], broken


@requires_corpus
@pytest.mark.parametrize("pdf_name", CORPUS_PAPERS)
def test_citations_on_a_real_upload_and_parse_are_valid_anchors(
    tmp_path: Path, pdf_name: str
) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        pdf = (CORPUS / pdf_name).read_bytes()
        response = h.client.post(
            "/papers", files={"file": (pdf_name, pdf, "application/pdf")}, headers=auth(token)
        )
        assert response.status_code == 202, response.text
        paper_id = response.json()["paper_id"]
        assert run_worker(h.settings, max_jobs=5) >= 1
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
    cited = _cite_every_text_block(h.settings, user_id, paper_id)
    print(f"\n[citation-anchors] {pdf_name} (real parse): {cited} citations, all valid")
    assert cited > 100


@requires_corpus
def test_an_explain_on_a_fresh_real_parse_cites_valid_anchors(tmp_path: Path) -> None:
    settings = Settings(root=tmp_path / "data", agent_secret=SECRET, agent_url="http://agent.test")
    fake = FakeAgent(Script("explain-ok"), secret=SECRET)
    app = create_app(settings, agent_transport=fake.transport())
    fake.tools = httpx.ASGITransport(app=app, client=("127.0.0.1", 50124))
    with TestClient(app) as client:
        token = register(client, "alice@example.com")
        pdf = (CORPUS / "resnet-cvpr-2col.pdf").read_bytes()
        paper_id = client.post(
            "/papers", files={"file": ("resnet.pdf", pdf, "application/pdf")}, headers=auth(token)
        ).json()["paper_id"]
        assert run_worker(settings, max_jobs=5) >= 1
        ir = client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()
        block = next(
            b for b in ir["blocks"] if b["type"] == "paragraph" and len(b.get("text") or "") > 200
        )
        text = block["text"]
        page = next(p for p in ir["pages"] if p["index"] == block["page_index"])
        anchor = {
            "anchorVersion": 1,
            "offsetUnit": "unicode",
            "id": str(uuid.uuid4()),
            "doc": {
                "paperId": paper_id,
                "pdfSha256": ir["source_hash"],
                "parserVersion": ir["parser"]["version"],
                "textStreamId": "pdfjs@5.7.284/page-text",
            },
            "targetKind": "text",
            "provenanceClass": "source",
            "selectors": [
                {"type": "PageSelector", "index": block["page_index"]},
                {
                    "type": "TextQuoteSelector",
                    "exact": text[:120],
                    "prefix": "",
                    "suffix": "",
                    "exactNormalised": text[:120],
                    "prefixNormalised": "",
                    "suffixNormalised": "",
                },
                {
                    "type": "ShapeSelector",
                    "pageIndex": block["page_index"],
                    "quads": [block["bbox"]],
                    "polygons": [],
                    "pageWidth": page["width"],
                    "pageHeight": page["height"],
                    "rotation": page["rotation"],
                    "userUnit": page["user_unit"],
                    "cropBox": page["crop_box"],
                },
            ],
            "created": {"mode": "source", "at": "2026-09-26T05:00:00.000Z", "client": "tests"},
        }
        response = client.post(
            f"/papers/{paper_id}/threads",
            json={"kind": "explain", "anchor": anchor},
            headers=auth(token),
        )
        frames, _ = read_sse(response)
        citations = events(frames, "citations")[0]["items"]
        assert fake.contract_errors == []
        assert fake.requests[0]["seed"]["passages"], "the pdf.js capture found its block by quads"
    assert citations and all(anchor_errors(c["anchor"]) == [] for c in citations)
    print(f"\n[citation-anchors] explain on a fresh resnet parse: {len(citations)} citations valid")
