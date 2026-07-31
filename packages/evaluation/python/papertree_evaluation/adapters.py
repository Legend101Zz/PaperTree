"""PTUB candidate adapters. One interface, four implementations, honest about what each can do.

`research/benchmarks/README.md` §3 defines the contract: every candidate implements

    class ParserAdapter(Protocol):
        name: str
        version: str
        def parse(self, pdf_path: str) -> ParseResult: ...   # -> PaperIR-shaped

and the rows to evaluate are

    1  PaperTree current            the baseline to beat
    2  PaperTree dead structured    what the unused code would have given
    3  PyMuPDF raw                  the honest floor
    5  Docling                      opt-in

TWO RULES FROM THE README THAT PULL IN OPPOSITE DIRECTIONS, AND HOW THEY ARE RESOLVED

  §3: *"A candidate that cannot express a metric's input (e.g. no bboxes) scores **0 on that
      metric, not N/A** — inability to represent geometry is a real failure, not a missing
      measurement."*

  ...but an adapter that was never INSTALLED has not failed at anything. Scoring an absent
  Docling as 0 would report "the deterministic path beats Docling" on the strength of a missing
  dependency, which is the single most dishonest number this benchmark could produce.

So the two are distinguished explicitly. `available` is about the ENVIRONMENT; a `0` is about
the PARSER. `AdapterOutcome.status` is one of `ok` / `unavailable` / `crashed` / `timeout`, and
the harness reports the last three separately from any score.

ROW 2 IS GONE, AND THAT IS NOT AN OMISSION

`PaperTree dead structured` was `papers/extraction.py`. Epic 1 **deleted it** - it is on the
must-delete list and had zero importers (findings.md §A). Its measured numbers survive in
findings.md H2 and are quoted in `EPIC-01-RESULT.md`; re-implementing 1,016 lines of deleted
code to re-measure what was already measured would be the opposite of the point.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol, runtime_checkable

__all__ = [
    "AdapterOutcome",
    "DeterministicAdapter",
    "DoclingAdapter",
    "ParserAdapter",
    "PyMuPdfRawAdapter",
    "all_adapters",
]

OutcomeStatus = Literal["ok", "unavailable", "crashed", "timeout"]

#: Where the Docling probe environment lives. Outside the repo AND outside `~`, because the
#: internal disk had 14 GiB free against the SSD's 649 GiB when it was installed.
DOCLING_PYTHON_ENV = "PAPERTREE_DOCLING_PYTHON"
DEFAULT_DOCLING_PYTHON = "/Volumes/Mrigesh SSD/papertree-docling/.venv/bin/python"


@dataclass(slots=True)
class AdapterOutcome:
    """What one adapter did to one paper.

    `status` and the metrics are deliberately separate fields. A crashed run and a run that
    scored zero are different facts, and §4.5 disqualifies a parser on crash+timeout+empty > 5 %
    regardless of accuracy - which is only computable if they were never conflated.
    """

    adapter: str
    paper: str
    status: OutcomeStatus
    seconds: float = 0.0
    pages: int = 0
    #: PaperIR-shaped document, or `None` when the run did not produce one.
    document: dict[str, Any] | None = None
    error: str | None = None
    counts: dict[str, int] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        """§4.5's `empty-output rate`. A run that produced a document with no blocks."""
        return self.status == "ok" and not (self.document or {}).get("blocks")

    @property
    def seconds_per_page(self) -> float:
        return self.seconds / self.pages if self.pages else 0.0


@runtime_checkable
class ParserAdapter(Protocol):
    name: str
    version: str

    @property
    def available(self) -> bool: ...

    def parse(self, pdf_path: str) -> AdapterOutcome: ...


def _count(document: dict[str, Any]) -> dict[str, int]:
    """The capability columns findings.md H2 reports, computed the same way for every adapter."""
    blocks = document.get("blocks") or []
    by_type: dict[str, int] = {}
    for block in blocks:
        by_type[block.get("type", "?")] = by_type.get(block.get("type", "?"), 0) + 1
    return {
        "blocks": len(blocks),
        "with_bbox": sum(1 for b in blocks if b.get("bbox")),
        "with_page": sum(1 for b in blocks if b.get("page_index") is not None),
        "with_stable_id": sum(1 for b in blocks if str(b.get("block_id", "")).startswith("blk_")),
        "headings": by_type.get("heading", 0) + by_type.get("title", 0),
        "equations": by_type.get("equation", 0) + by_type.get("inline_equation", 0),
        "equations_with_latex": sum(
            1
            for b in blocks
            if b.get("type") in ("equation", "inline_equation")
            and (b.get("payload") or {}).get("latex")
        ),
        "figures": by_type.get("figure", 0),
        "tables": by_type.get("table", 0),
        "table_cells": by_type.get("table_cell", 0),
        "captions_linked": sum(
            1 for r in (document.get("relations") or []) if r.get("type") == "caption_of"
        ),
        "sections": len(document.get("sections") or []),
    }


class DeterministicAdapter:
    """Row 4: this epic's parser. The one the decision rule is about."""

    name = "papertree-deterministic"
    version = "1.0.0"

    def __init__(self, asset_root: Path) -> None:
        self.asset_root = asset_root

    @property
    def available(self) -> bool:
        return True

    def parse(self, pdf_path: str) -> AdapterOutcome:
        from papertree_document_worker.pipeline import parse_document

        paper = Path(pdf_path).stem
        started = time.perf_counter()
        try:
            result = parse_document(
                pdf_path,
                paper_id="ppr_0123456789ABCDEFGHJKMNP0TV",
                asset_root=self.asset_root / paper,
            )
        except Exception as exc:
            return AdapterOutcome(
                self.name,
                paper,
                "crashed",
                seconds=time.perf_counter() - started,
                error=f"{type(exc).__name__}: {exc}",
            )
        elapsed = time.perf_counter() - started
        document = result.paper.model_dump(mode="json", by_alias=True, exclude_unset=True)
        return AdapterOutcome(
            self.name,
            paper,
            "ok",
            seconds=elapsed,
            pages=result.page_count,
            document=document,
            counts=_count(document),
        )


class PyMuPdfRawAdapter:
    """Row 3: the honest floor.

    `get_text("dict")` with naive top-to-bottom order and no column detection - i.e. exactly what
    findings.md B5.2 measured alternating between columns 44 times on a single ResNet page. It
    exists so every other row is read against something, and it deliberately produces no
    headings, figures, tables or sections: it CANNOT, and §3 says that scores 0 rather than N/A.
    """

    name = "pymupdf-raw"
    version = "1.28.0"

    @property
    def available(self) -> bool:
        return importlib.util.find_spec("pymupdf") is not None

    def parse(self, pdf_path: str) -> AdapterOutcome:
        # The same Any-typed boundary the worker declares: PyMuPDF ships py.typed with almost
        # no annotations, so every call is a `no-untyped-call` error under `mypy --strict`.
        from papertree_document_worker.pdf import pymupdf

        paper = Path(pdf_path).stem
        started = time.perf_counter()
        try:
            document = pymupdf.open(pdf_path)
            blocks: list[dict[str, Any]] = []
            for page in document:
                for raw in page.get_text("dict", sort=True)["blocks"]:
                    if raw.get("type") != 0:
                        continue
                    text = "".join(
                        span["text"] for line in raw.get("lines", ()) for span in line["spans"]
                    )
                    if not text.strip():
                        continue
                    blocks.append(
                        {
                            "block_id": f"raw_{page.number}_{len(blocks)}",
                            "type": "paragraph",
                            "page_index": page.number,
                            "bbox": [float(v) for v in raw["bbox"]],
                            "text": text,
                        }
                    )
            pages = document.page_count
            document.close()
        except Exception as exc:
            return AdapterOutcome(
                self.name,
                paper,
                "crashed",
                seconds=time.perf_counter() - started,
                error=f"{type(exc).__name__}: {exc}",
            )
        shaped = {"blocks": blocks, "relations": [], "sections": []}
        return AdapterOutcome(
            self.name,
            paper,
            "ok",
            seconds=time.perf_counter() - started,
            pages=pages,
            document=shaped,
            counts=_count(shaped),
        )


class DoclingAdapter:
    """Row 5, OPT-IN. Reports `unavailable` rather than crashing or scoring zero.

    Runs in a SEPARATE interpreter - the probe venv at `PAPERTREE_DOCLING_PYTHON` - because
    Docling is deliberately absent from this workspace's `uv.lock` in every form: uv locks a
    dependency-group whether or not it installs it, and one `docling>=2.0` line took the lock
    from 22 packages to 100+.
    """

    name = "docling"
    version = "2.117.0"

    def __init__(self, python: str | None = None, timeout: float = 1800.0) -> None:
        self.python = python or os.environ.get(DOCLING_PYTHON_ENV, DEFAULT_DOCLING_PYTHON)
        #: §4.5 defines a timeout as >120 s/PAGE. 1800 s covers a 15-page paper at Docling's
        #: measured 19 s/page (findings.md H2) with a wide margin, and still terminates a hang.
        self.timeout = timeout

    @property
    def available(self) -> bool:
        return Path(self.python).is_file()

    def parse(self, pdf_path: str) -> AdapterOutcome:
        paper = Path(pdf_path).stem
        if not self.available:
            return AdapterOutcome(
                self.name,
                paper,
                "unavailable",
                error=(
                    f"no interpreter at {self.python}. Docling is an opt-in probe environment; "
                    f"set ${DOCLING_PYTHON_ENV} or see research/benchmarks/DOCLING.md."
                ),
            )
        bridge = Path(__file__).with_name("docling_bridge.py")
        started = time.perf_counter()
        try:
            completed = subprocess.run(  # noqa: S603 - fixed interpreter, fixed script
                [self.python, str(bridge), pdf_path],
                capture_output=True,
                text=True,
                timeout=self.timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            # §4.5 counts timeouts separately and disqualifies at crash+timeout+empty > 5 %.
            return AdapterOutcome(
                self.name,
                paper,
                "timeout",
                seconds=self.timeout,
                error=f"exceeded {self.timeout:.0f}s",
            )

        if completed.returncode != 0 or not completed.stdout.strip():
            return AdapterOutcome(
                self.name,
                paper,
                "crashed",
                seconds=time.perf_counter() - started,
                error=(completed.stderr or "no output").strip()[:400],
            )
        try:
            reported = json.loads(completed.stdout.splitlines()[-1])
        except json.JSONDecodeError as exc:
            return AdapterOutcome(
                self.name, paper, "crashed", error=f"unparseable bridge output: {exc}"
            )

        status = reported.get("status", "crashed")
        if status != "ok":
            return AdapterOutcome(self.name, paper, status, error=reported.get("error"))
        return AdapterOutcome(
            self.name,
            paper,
            "ok",
            seconds=float(reported.get("seconds", 0.0)),
            pages=int(reported.get("pages", 0)),
            # Counts only: a full DoclingDocument is megabytes of JSON across a pipe, and the
            # comparison is over capability columns.
            document={"blocks": [None] * int(reported["counts"]["blocks"])},
            counts=dict(reported["counts"]),
        )


def all_adapters(asset_root: Path) -> list[ParserAdapter]:
    """Every row PTUB can run today.

    Row 1 (`PaperTree current`) and row 2 (`PaperTree dead structured`) are absent BY DELETION -
    both were on Epic 1's must-delete list and are gone. Their measured numbers are carried
    forward from findings.md H2 in the result document rather than re-derived from code that no
    longer exists.
    """
    return [DeterministicAdapter(asset_root), PyMuPdfRawAdapter(), DoclingAdapter()]
