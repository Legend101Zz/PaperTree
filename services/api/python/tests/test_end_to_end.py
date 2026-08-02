"""A real PDF goes in one end and an indexable document comes out the other.

This is #74's fourth done-when — *"a PDF uploaded through the UI parses and opens in the v2
reader, with the paper named and the duration recorded"* — as far as it can be asserted without a
browser. It uploads REAL BYTES from the corpus, runs the REAL parse job through the REAL runner,
and reads the result back through the REAL `/ir` route. What it does not do is drive Chrome; the
browser half is #77 and belongs to Session C, and this file says so rather than implying coverage
it does not have.

WHY THIS IS NOT REDUNDANT WITH `test_ir.py`

`test_ir.py` seeds `put_paper` directly with a committed fixture — it proves the READ path against
a known-good document. Everything before `put_paper` is unexercised by it: the upload, the bytes
landing on disk, `enqueue_parse`, the runner claiming the job, `parse_document`, the staged JSON,
the persist step, and the promotion. Each of those is where an integration actually breaks, and
none of them is covered by a test that starts at the database.

CORPUS-DEPENDENT, AND IT SAYS SO. Corpus PDFs are fetched, not committed (`AGENTS.md` §4), so this
skips loudly on a clean checkout and names the fetch script. Skipping loudly is honest; passing
quietly is the vacuous green §2 records.
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest
from api_support import auth, harness, register
from papertree_api.worker import run as run_worker
from papertree_document_ir import Paper

CORPUS = Path(__file__).resolve().parents[4] / "research" / "benchmarks" / "corpus"

#: The smallest corpus paper, so the end-to-end run is seconds rather than minutes. The point of
#: this test is the WIRING; parser quality is `packages/evaluation`'s job and Session B's.
PAPER = "resnet-cvpr-2col.pdf"

pytestmark = pytest.mark.skipif(
    not (CORPUS / PAPER).is_file(),
    reason=(
        f"corpus PDF {PAPER} is absent — it is fetched, not committed. "
        "Run ./research/benchmarks/fetch_corpus.sh to enable this end-to-end test."
    ),
)


def test_a_real_pdf_uploads_parses_and_comes_back_indexable(tmp_path: Path) -> None:
    pdf = (CORPUS / PAPER).read_bytes()
    assert pdf.startswith(b"%PDF-") and len(pdf) > 100_000, "the corpus file is not a real PDF"

    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")

        # 1. UPLOAD — the thing `dashboard/page.tsx` does, and the thing that has never worked.
        started = time.monotonic()
        response = h.client.post(
            "/papers", files={"file": (PAPER, pdf, "application/pdf")}, headers=auth(token)
        )
        assert response.status_code == 202, response.text
        upload = response.json()
        paper_id, job_id = upload["paper_id"], upload["job_id"]
        assert upload["created"] is True

        # 2. THE JOB IS REAL AND PENDING. This is what makes the library's PENDING state honest
        #    rather than the permanent default `libraryPaperFromApi` used to give every row.
        job = h.client.get(f"/jobs/{job_id}", headers=auth(token)).json()
        assert job["state"] == "pending"
        assert job["is_terminal"] is False

        # 3. RUN THE WORKER. `packages/jobs` ships no `run_forever` on purpose, so nothing in this
        #    repo ran a parse job before `papertree_api.worker`. Draining rather than looping.
        ran = run_worker(h.settings, max_jobs=5)
        elapsed = time.monotonic() - started
        assert ran >= 1, "the worker claimed no job — the queue or the handler is not wired"

        job = h.client.get(f"/jobs/{job_id}", headers=auth(token)).json()
        assert job["state"] == "succeeded", job
        assert [step["name"] for step in job["steps"]] == ["parse", "persist"]

        # 4. THE DOCUMENT IS THERE, AND IT IS A VALID PaperIR DOCUMENT.
        #    Promotion first: the worker persists a generation, and `promoted_generation` is what
        #    `/ir` reads by default. A parse that stored a generation nobody promoted would 404
        #    here, which is a real failure mode and not a detail.
        ir = h.client.get(f"/papers/{paper_id}/ir", headers=auth(token))
        assert ir.status_code == 200, ir.text
        document = ir.json()
        Paper.model_validate(document)

        pages, blocks = len(document["pages"]), len(document["blocks"])
        title = next(
            (b.get("text", "") for b in document["blocks"] if b["type"] == "title"),
            "<no title block>",
        )

        # The numbers #74 asks to be recorded. Printed rather than asserted tightly: this test is
        # about the wiring; a bound on block count would be a parser assertion in the wrong file.
        print(
            f"\n[end-to-end] {PAPER} ({len(pdf) / 1_000_000:.2f} MB) "
            f"-> {pages} pages, {blocks} blocks in {elapsed:.1f}s\n"
            f"[end-to-end] title: {title.strip()[:100]!r}\n"
            f"[end-to-end] paper_id: {paper_id}"
        )
        assert pages > 0 and blocks > 0

        # 5. WHAT THE READER NEEDS. `indexDocument` takes `PaperSource`; these are the fields it
        #    reads, and `flows` is the one that carries reading order (#91).
        assert {"paper_id", "source_hash", "pages", "blocks", "relations", "sections"} <= set(
            document
        )
        for page in document["pages"]:
            assert set(page["flows"]) == {
                "body",
                "caption",
                "footnote",
                "header",
                "footer",
                "margin",
            }
            assert page["block_ids"], "a page with no block_ids indexes to an empty text stream"

        # 6. THE ORIGINAL PDF COMES BACK, because pdf.js has to render it beside the IR.
        served = h.client.get(f"/papers/{paper_id}/file", headers=auth(token))
        assert served.status_code == 200
        assert served.content == pdf, "the bytes served are not the bytes uploaded"


def test_uploading_the_same_bytes_twice_does_not_parse_twice(tmp_path: Path) -> None:
    """`enqueue_parse`'s idempotency key is `parse:{source_hash}:{paper_id}` — this asserts it holds
    at the HTTP boundary, where a user double-clicking Upload is the ordinary case."""
    pdf = (CORPUS / PAPER).read_bytes()

    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        first = h.client.post(
            "/papers", files={"file": (PAPER, pdf, "application/pdf")}, headers=auth(token)
        ).json()
        second = h.client.post(
            "/papers", files={"file": (PAPER, pdf, "application/pdf")}, headers=auth(token)
        ).json()

        assert second["paper_id"] == first["paper_id"], "same bytes must mint the same paper_id"
        assert second["job_id"] == first["job_id"], "the second upload queued a second parse"
        assert second["created"] is False
        assert len(h.client.get("/papers", headers=auth(token)).json()) <= 1


def test_two_users_uploading_the_same_pdf_get_different_papers(tmp_path: Path) -> None:
    """The idempotency above must not become a cross-owner collision.

    `paper_id` is derived from `sha256(user_id : source_hash)` precisely so that two users who
    upload the same public arXiv PDF — the ordinary case for this product — do not land on one
    row that one of them owns and the other cannot read.
    """
    pdf = (CORPUS / PAPER).read_bytes()

    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        a = h.client.post(
            "/papers", files={"file": (PAPER, pdf, "application/pdf")}, headers=auth(alice)
        ).json()
        b = h.client.post(
            "/papers", files={"file": (PAPER, pdf, "application/pdf")}, headers=auth(bob)
        ).json()

        assert a["paper_id"] != b["paper_id"]
        run_worker(h.settings, max_jobs=5)
        assert h.client.get(f"/papers/{a['paper_id']}/ir", headers=auth(bob)).status_code == 404
        assert h.client.get(f"/papers/{b['paper_id']}/ir", headers=auth(alice)).status_code == 404
