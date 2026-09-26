"""S1: `POST /papers` and `GET /papers` (contracts.md §2.2), through the real app and worker.

Regression tests named by slice-plan §S1: `test_upload_size_cap_413`,
`test_library_lists_pending_and_failed`, `test_dead_letter_upload_can_be_retried`.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest
from api_support import assert_envelope, auth, harness, register
from papertree_api.library import title_for
from papertree_api.settings import Settings
from papertree_db import LibraryRow
from papertree_document_worker.pdf import SourceDocument
from test_ingest_helpers import (
    CORPUS,
    FETCH_HINT,
    GARBAGE_PDF,
    UNCOUNTABLE_PDF,
    drain,
    encrypted_pdf,
    library,
    row_for,
    sql,
    synthetic_pdf,
    upload,
)


def test_an_upload_is_202_with_its_library_row_and_a_queued_job(tmp_path: Path) -> None:
    pdf = synthetic_pdf(pages=3)
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        response = upload(h.client, token, pdf, name="reading-list/2026/Durable Parsing.pdf")
        assert response.status_code == 202, response.text
        body = response.json()
        assert set(body) == {"paper_id", "job_id", "created", "paper"}
        assert body["created"] is True
        paper = body["paper"]
        digest = hashlib.sha256(pdf).hexdigest()
        assert paper["paper_id"] == body["paper_id"]
        assert paper["source_hash"] == f"sha256:{digest}"
        assert paper["page_count"] == 3
        # The filename is metadata: no directory part, and the title falls back to it.
        assert paper["original_filename"] == "Durable Parsing.pdf"
        assert paper["title"] == "Durable Parsing"
        assert (paper["processing"], paper["generation"], paper["parser_version"]) == (
            "queued",
            None,
            None,
        )
        assert paper["job"] == {
            "job_id": body["job_id"],
            "kind": "parse",
            "state": "pending",
            "step": None,
            "done": 0,
            "total": 3,
            "attempt": 0,
            "max_attempts": 3,
            "error_code": None,
        }
        assert paper["highlight_count"] == 0 and paper["authors"] == []

        # The rows behind it: the upload's columns and the job the library points at.
        (owned,) = sql(h.settings, "SELECT * FROM paper_owners")
        assert (owned["byte_size"], owned["page_count"], owned["latest_job_id"]) == (
            len(pdf),
            3,
            body["job_id"],
        )
        (job,) = sql(h.settings, "SELECT idempotency_key, payload FROM jobs")
        assert job["idempotency_key"] == f"parse:sha256:{digest}:{body['paper_id']}:g1:a1"
        payload = json.loads(job["payload"])
        assert payload == {
            "paper_id": body["paper_id"],
            "source_path": str(h.settings.upload_root / f"{body['paper_id']}.pdf"),
            "source_hash": f"sha256:{digest}",
            "generation": 1,
            "attempt_seq": 1,
        }
        assert (h.settings.upload_root / f"{body['paper_id']}.pdf").read_bytes() == pdf

        # The same list GET /papers gives, with no client state.
        assert library(h.client, token) == [paper]


def test_uploading_the_same_bytes_again_returns_the_same_job(tmp_path: Path) -> None:
    pdf = synthetic_pdf()
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        first = upload(h.client, token, pdf, name="a.pdf").json()
        second = upload(h.client, token, pdf, name="b.pdf").json()
        assert (second["paper_id"], second["job_id"], second["created"]) == (
            first["paper_id"],
            first["job_id"],
            False,
        )
        assert second["paper"]["original_filename"] == "b.pdf"
        drain(h.settings)
        third = upload(h.client, token, pdf).json()
        assert (third["job_id"], third["created"], third["paper"]["processing"]) == (
            first["job_id"],
            False,
            "ready",
        )
        assert len(library(h.client, token)) == 1
        assert len(sql(h.settings, "SELECT job_id FROM jobs")) == 1


def test_upload_size_cap_413(tmp_path: Path) -> None:
    """contracts.md §2.2: 413 `payload_too_large` at `PAPERTREE_MAX_UPLOAD_MB`. A file of exactly
    the cap is accepted; one byte more is refused, with nothing written (no row, no file, no job).
    WATCHED FAILING at base: a 1 MB + 1 upload under a 1 MB cap was 202 (no cap existed)."""
    cap = 1024 * 1024
    settings = Settings(root=tmp_path / "data", max_upload_mb=1)
    base = synthetic_pdf()
    exact = base + b"%" * (cap - len(base))
    with harness(tmp_path, settings=settings) as h:
        token = register(h.client, "reader@example.com")
        over = upload(h.client, token, exact + b"%")
        assert_envelope(over, 413, "payload_too_large")
        assert sql(h.settings, "SELECT paper_id FROM paper_owners") == []
        assert sql(h.settings, "SELECT job_id FROM jobs") == []
        assert list(h.settings.upload_root.iterdir()) == []

        # A declared Content-Length over the cap is refused before the body is read.
        declared = h.client.post(
            "/papers",
            content=b"x" * 16,
            headers={
                **auth(token),
                "content-type": "multipart/form-data; boundary=b",
                "content-length": str(cap + 10 * 1024 * 1024),
            },
        )
        assert_envelope(declared, 413, "payload_too_large")

        # A body with no length at all (chunked) is refused once it passes the cap.
        def chunks() -> Iterator[bytes]:
            yield b'--b\r\nContent-Disposition: form-data; name="file"; filename="x.pdf"\r\n\r\n'
            for _ in range(3):
                yield b"%PDF-" + b"x" * (512 * 1024)

        chunked = h.client.post(
            "/papers",
            content=chunks(),
            headers={**auth(token), "content-type": "multipart/form-data; boundary=b"},
        )
        assert_envelope(chunked, 413, "payload_too_large")

        accepted = upload(h.client, token, exact)
        assert accepted.status_code == 202, accepted.text
        assert accepted.json()["paper"]["page_count"] == 2


def test_upload_refusals_are_the_contract_codes(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        assert_envelope(upload(h.client, token, b""), 400, "empty_upload")
        assert_envelope(upload(h.client, token, b"GIF89a not a pdf"), 415, "unsupported_media_type")
        no_file = h.client.post(
            "/papers",
            files={"other": ("x.pdf", b"%PDF-1.4", "application/pdf")},
            headers=auth(token),
        )
        assert (
            assert_envelope(no_file, 422, "validation_failed")["detail"] == "file: Field required"
        )
        not_multipart = h.client.post("/papers", json={"file": "x"}, headers=auth(token))
        assert_envelope(not_multipart, 422, "validation_failed")
        assert_envelope(
            h.client.post("/papers", files={"file": ("x", b"%PDF-")}), 401, "auth_required"
        )
        assert sql(h.settings, "SELECT paper_id FROM paper_owners") == []


def test_library_lists_pending_and_failed(tmp_path: Path) -> None:
    """N4 + backend-map §2.3. WATCHED FAILING at base: right after two uploads `GET /papers` was
    `[]` (an unparsed upload was not listed), and after the parse the garbage paper never
    appeared at all (it had no generation) — S1 report §1."""
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        good = upload(h.client, token, synthetic_pdf(), name="good.pdf").json()
        bad = upload(h.client, token, GARBAGE_PDF, name="garbage.pdf").json()

        queued = library(h.client, token)
        assert [row["paper_id"] for row in queued] == [bad["paper_id"], good["paper_id"]]
        assert [row["processing"] for row in queued] == ["queued", "queued"]
        assert queued[0]["page_count"] is None  # PyMuPDF could not open it; the job will say why

        drain(h.settings)

        done = {row["paper_id"]: row for row in library(h.client, token)}
        assert len(done) == 2
        ready, failed = done[good["paper_id"]], done[bad["paper_id"]]
        assert (ready["processing"], ready["generation"], ready["parser_version"]) == (
            "ready",
            1,
            "1.0.0",
        )
        assert ready["title"] == "A Synthetic Paper About Durable Parsing"
        assert ready["job"]["state"] == "succeeded" and ready["job"]["done"] == 3
        assert failed["processing"] == "failed" and failed["generation"] is None
        assert failed["job"] == {
            "job_id": bad["job_id"],
            "kind": "parse",
            "state": "dead_letter",
            "step": "parse",
            "done": 0,
            "total": 3,
            "attempt": 1,
            "max_attempts": 3,
            "error_code": "pdf_unreadable",
        }
        # The raw error text stays in the DB (and the worker log); the wire carries the code.
        (stored,) = sql(h.settings, "SELECT error FROM jobs WHERE job_id = ?", (bad["job_id"],))
        assert stored["error"] == "[pdf_unreadable] FileDataError: Failed to open stream"
        assert "FileDataError" not in json.dumps(library(h.client, token))


@pytest.mark.parametrize(
    ("case", "page_count", "reason"),
    [
        ("uncountable", None, "RuntimeError: code=7: Invalid number of pages"),
        ("encrypted", 1, "the PDF needs a password to open"),
    ],
)
def test_a_pdf_pymupdf_opens_but_cannot_read_is_accepted_and_fails_unreadable_at_once(
    tmp_path: Path, case: str, page_count: int | None, reason: str
) -> None:
    """S1 review MF1 + should-fix 2. Both files OPEN in PyMuPDF; then one cannot count its pages
    and the other needs a password. §2.2 allows this route 202/400/413/415 only, and a file the
    parser cannot read is the job's `pdf_unreadable`, final on attempt 1 (the bytes will not
    change).

    WATCHED FAILING at `4ed8f05`: `uncountable` answered 500 `internal` (the `page_count` read sat
    outside `_page_count`'s guard; the log's `where` was `extra.py:page_count_fz:135`);
    `encrypted` was accepted, then its parse failed `ValueError: document closed or encrypted`,
    coded `internal` and rescheduled with backoff, so the row still read `queued`."""
    data = UNCOUNTABLE_PDF if case == "uncountable" else encrypted_pdf()
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        accepted = upload(h.client, token, data, name=f"{case}.pdf")
        assert accepted.status_code == 202, accepted.text
        body = accepted.json()
        assert (body["created"], body["paper"]["processing"], body["paper"]["page_count"]) == (
            True,
            "queued",
            page_count,
        )
        (owned,) = sql(h.settings, "SELECT page_count, byte_size FROM paper_owners")
        assert (owned["page_count"], owned["byte_size"]) == (page_count, len(data))

        drain(h.settings)
        row = row_for(h.client, token, body["paper_id"])
        assert row["processing"] == "failed"
        assert row["job"] is not None
        assert (row["job"]["state"], row["job"]["attempt"], row["job"]["error_code"]) == (
            "dead_letter",
            1,
            "pdf_unreadable",
        )
        (job,) = sql(h.settings, "SELECT error FROM jobs")
        assert job["error"].startswith("[pdf_unreadable] ") and reason in job["error"], job["error"]
        # The original is still the user's to open, and nothing internal reached the wire.
        served = h.client.get(f"/papers/{body['paper_id']}/file", headers=auth(token))
        assert (served.status_code, served.content) == (200, data)
        assert "Error" not in json.dumps(library(h.client, token))


def test_dead_letter_upload_can_be_retried(tmp_path: Path) -> None:
    """WATCHED FAILING at base: re-uploading the dead-lettered bytes answered `created: false`
    with the SAME dead job id, and `POST /retry` was 501 — no way back (S1 report §1).

    Now both make a NEW job for the same generation (a new `attempt_seq`), which the worker runs."""
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        first = upload(h.client, token, GARBAGE_PDF).json()
        paper_id = first["paper_id"]
        drain(h.settings)
        assert row_for(h.client, token, paper_id)["job"]["state"] == "dead_letter"

        again = upload(h.client, token, GARBAGE_PDF).json()
        assert again["created"] is True and again["job_id"] != first["job_id"]
        assert again["paper"]["processing"] == "queued"
        assert again["paper"]["job"]["job_id"] == again["job_id"]
        drain(h.settings)

        retried = h.client.post(f"/papers/{paper_id}/retry", headers=auth(token))
        assert retried.status_code == 202, retried.text
        assert retried.json()["generation"] == 1
        assert retried.json()["job_id"] not in {first["job_id"], again["job_id"]}
        keys = [
            r["idempotency_key"].rsplit(":", 2)[1:]
            for r in sql(h.settings, "SELECT idempotency_key FROM jobs ORDER BY created_at")
        ]
        assert keys == [["g1", "a1"], ["g1", "a2"], ["g1", "a3"]]
        assert row_for(h.client, token, paper_id)["job"]["job_id"] == retried.json()["job_id"]

        # Only a dead-lettered paper can be retried; this one is queued again.
        assert_envelope(
            h.client.post(f"/papers/{paper_id}/retry", headers=auth(token)), 409, "not_failed"
        )
        drain(h.settings)
        states = [r["state"] for r in sql(h.settings, "SELECT state FROM jobs")]
        assert states == ["dead_letter"] * 3, "each attempt is a real job the worker ran"


def test_retry_is_409_for_a_paper_that_has_not_failed_and_404_for_anothers(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        paper_id = upload(h.client, alice, synthetic_pdf()).json()["paper_id"]
        assert_envelope(
            h.client.post(f"/papers/{paper_id}/retry", headers=auth(alice)), 409, "not_failed"
        )
        drain(h.settings)
        assert_envelope(
            h.client.post(f"/papers/{paper_id}/retry", headers=auth(alice)), 409, "not_failed"
        )
        assert_envelope(
            h.client.post(f"/papers/{paper_id}/retry", headers=auth(bob)), 404, "not_found"
        )
        assert len(sql(h.settings, "SELECT job_id FROM jobs")) == 1


@pytest.mark.skipif(
    not (CORPUS / "resnet-cvpr-2col.pdf").is_file(),
    reason=f"corpus PDF resnet-cvpr-2col.pdf is absent (fetched, not committed). {FETCH_HINT}",
)
def test_the_uploads_page_count_is_the_parsed_page_count_on_the_corpus(tmp_path: Path) -> None:
    """#133: `page_count` at upload (one PyMuPDF open of the bytes), against the pages the real
    parse produced, on every corpus paper that is present. Producer-side field, real parses."""
    papers = sorted(CORPUS.glob("*.pdf"))
    print(f"\n[corpus] {len(papers)} papers in {CORPUS.name}/")
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        accepted = {}
        for path in papers:
            body = upload(h.client, token, path.read_bytes(), name=path.name).json()
            with SourceDocument(path) as document:
                assert body["paper"]["page_count"] == document.page_count, path.name
            accepted[body["paper_id"]] = (path.name, body["paper"]["page_count"])
        drain(h.settings, max_jobs=len(papers) * 3)
        for paper_id, (name, page_count) in accepted.items():
            ir = h.client.get(f"/papers/{paper_id}/ir", headers=auth(token))
            assert ir.status_code == 200, (name, ir.text)
            assert len(ir.json()["pages"]) == page_count, name
            row = row_for(h.client, token, paper_id)
            assert (row["processing"], row["page_count"]) in {
                ("ready", page_count),
                ("partial", page_count),
            }
            print(f"[corpus] {name}: page_count {page_count}, {row['processing']}")


def test_the_library_title_is_one_line() -> None:
    """Live, on YOLO: `metadata.title.value` is `"You Only Look Once:\\nUni\\ufb01ed, Real-Time
    Object Detection"` — the title block's own line break. A library card shows one line, so the
    whitespace runs collapse; the characters (the U+FB01 ligature included) are kept as parsed."""
    row = LibraryRow(
        paper_id="ppr_" + "A" * 26,
        source_hash="sha256:" + "a" * 64,
        original_filename="yolo.pdf",
        byte_size=1,
        page_count=10,
        created_at="2026-09-26T00:00:00Z",
        generation=1,
        promoted_at=None,
        paper_status="complete",
        parser_version="1.0.0",
        title="You Only Look Once:\nUniﬁed,  Real-Time\tObject Detection ",
        authors=(),
        latest_job_id=None,
        job_state=None,
        job_attempt=None,
        job_max_attempts=None,
        job_error=None,
        job_updated_at=None,
        job_generation=None,
        job_attempt_seq=None,
        job_steps_done=0,
        job_open_step=None,
        highlight_count=0,
    )
    assert title_for(row) == "You Only Look Once: Uniﬁed, Real-Time Object Detection"
    assert title_for(replace(row, title=None, original_filename="  My\nPaper.PDF")) == "My Paper"
    assert title_for(replace(row, title=None, original_filename=None)) == row.paper_id
