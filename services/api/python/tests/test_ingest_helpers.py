"""Shared helpers for the S1 ingest tests (`test_ingest_*.py`). No tests of its own.

Named `test_ingest_*` because that is S1's test path (slice-plan §S1); pytest collects it and
finds nothing to run.

THE PDFs ARE REAL AND MADE HERE. `synthetic_pdf` builds a small born-digital paper with PyMuPDF (a
title, an author line, a heading, body lines and one raster figure per page) and the REAL parser
reads it, so these tests run the real worker end to end on every checkout, including CI's, which
has no corpus. The corpus-gated checks skip loudly and name the fetch script.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from api_support import auth
from fastapi.testclient import TestClient
from papertree_api.settings import Settings
from papertree_api.worker import run as run_worker
from papertree_document_worker.pdf import pymupdf
from papertree_jobs import Job, JobObserver

#: Bytes that start like a PDF and are not one: PyMuPDF refuses them ("Failed to open stream").
GARBAGE_PDF = b"%PDF-1.4 this is not really a pdf\n"

#: A PDF PyMuPDF OPENS but cannot count: its page tree claims 999,999,999 pages and lists none.
#: `document.page_count` raises a bare `RuntimeError('code=7: Invalid number of pages')`, and so
#: does the parser (S1 review MF1: this was a 500 at upload).
UNCOUNTABLE_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Count 999999999/Kids[]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n%%EOF"
)


def encrypted_pdf() -> bytes:
    """One page behind a USER password: PyMuPDF opens it and counts its page (`needs_pass` 1),
    and loading any page raises `ValueError('document closed or encrypted')`."""
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "secret body text", fontsize=12)
    data = bytes(
        doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
    )
    doc.close()
    return data


CORPUS = Path(__file__).resolve().parents[4] / "research" / "benchmarks" / "corpus"
FETCH_HINT = "Run ./research/benchmarks/fetch_corpus.sh to enable it."


def synthetic_pdf(
    pages: int = 2, *, title: str = "A Synthetic Paper About Durable Parsing"
) -> bytes:
    doc = pymupdf.open()
    for index in range(pages):
        page = doc.new_page(width=612, height=792)
        if index == 0:
            page.insert_text((72, 90), title, fontsize=20)
            page.insert_text((72, 120), "Ada Lovelace", fontsize=11)
        y = 160
        page.insert_text((72, y), f"{index + 1} Section {index + 1}", fontsize=13)
        y += 24
        for line in range(12):
            page.insert_text(
                (72, y),
                f"This is sentence {line} of page {index + 1}; it has words enough to be body.",
                fontsize=10,
            )
            y += 14
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 40), 0)
        pixmap.set_rect(pixmap.irect, (200, 30, 30))
        page.insert_image(pymupdf.Rect(72, y + 10, 272, y + 140), pixmap=pixmap)
        page.insert_text(
            (72, y + 160),
            f"Figure {index + 1}: A red rectangle standing in for a plot.",
            fontsize=9,
        )
    data = bytes(doc.tobytes())
    doc.close()
    return data


def upload(client: TestClient, token: str, data: bytes, name: str = "paper.pdf") -> Any:
    return client.post(
        "/papers", files={"file": (name, data, "application/pdf")}, headers=auth(token)
    )


def library(client: TestClient, token: str) -> list[dict[str, Any]]:
    response = client.get("/papers", headers=auth(token))
    assert response.status_code == 200, response.text
    rows: list[dict[str, Any]] = response.json()
    return rows


def row_for(client: TestClient, token: str, paper_id: str) -> dict[str, Any]:
    (row,) = [r for r in library(client, token) if r["paper_id"] == paper_id]
    return row


def drain(settings: Settings, max_jobs: int = 20) -> int:
    """Runs the REAL worker loop (`python -m papertree_api.worker`'s `run`) until the queue is
    empty."""
    return run_worker(settings, max_jobs=max_jobs)


def sql(settings: Settings, query: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    """A read of the real SQLite file, for asserting on rows (never a write)."""
    conn = sqlite3.connect(f"file:{settings.database_file}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        return list(conn.execute(query, params).fetchall())
    finally:
        conn.close()


def write_sql(settings: Settings, query: str, params: tuple[Any, ...] = ()) -> None:
    """A deliberate write, for a test that has to put a row into a state no route produces."""
    conn = sqlite3.connect(str(settings.database_file), isolation_level=None)
    try:
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute(query, params)
    finally:
        conn.close()


class Gate(JobObserver):
    """Holds the worker at the START of each named step until the test releases it.

    `step_started` runs before the step's row is written (`JobObserver`), so while the worker
    waits here the steps before it have committed and this one has not begun: the moment a poll
    of `GET /papers` should show "reading, step <name>, <n> of 3 done".
    """

    def __init__(self, *steps: str) -> None:
        self.arrived = {step: threading.Event() for step in steps}
        self.release = {step: threading.Event() for step in steps}

    def step_started(self, job: Job, name: str) -> None:
        if name in self.arrived:
            self.arrived[name].set()
            assert self.release[name].wait(120), f"the test never released {name}"

    def wait_for(self, step: str) -> None:
        assert self.arrived[step].wait(120), f"the worker never reached {step}"

    def open_all(self) -> None:
        for event in self.release.values():
            event.set()


@contextmanager
def worker_thread(settings: Settings, observer: JobObserver, max_jobs: int = 1) -> Iterator[None]:
    """The real worker loop on a thread (its SQLite connections are made on that thread)."""
    errors: list[BaseException] = []

    def target() -> None:
        try:
            run_worker(settings, max_jobs=max_jobs, observer=observer)
        except BaseException as exc:  # surfaced to the test below
            errors.append(exc)

    thread = threading.Thread(target=target, name="s1-worker", daemon=True)
    thread.start()
    try:
        yield
    finally:
        if isinstance(observer, Gate):
            observer.open_all()
        thread.join(timeout=120)
        assert not thread.is_alive(), "the worker thread did not finish"
        assert not errors, errors
