"""Runs Docling in ITS OWN interpreter and returns PaperIR-shaped counts as JSON.

Executed with `python docling_bridge.py <pdf>` by `DoclingAdapter`, using the probe venv's
interpreter rather than this workspace's. It must therefore import NOTHING from PaperTree: the
probe venv has docling and its ~100 transitive dependencies and none of this repo's packages.

That separation is the whole point. `packages/evaluation`'s pyproject records the measurement:
one `docling>=2.0` line took the workspace lock from 22 packages to 100+, because uv locks a
dependency-group whether or not it installs it.

The output is a small JSON summary on stdout - counts, not the document - because the harness
compares capability columns and a full DoclingDocument is megabytes of JSON crossing a pipe.
"""

from __future__ import annotations

import json
import sys
import time


def main(pdf_path: str) -> int:
    started = time.perf_counter()
    try:
        from docling.document_converter import DocumentConverter
    except Exception as exc:  # pragma: no cover - runs only in the probe venv
        print(json.dumps({"status": "unavailable", "error": f"{type(exc).__name__}: {exc}"}))
        return 0

    try:
        result = DocumentConverter().convert(pdf_path)
        document = result.document
    except Exception as exc:  # pragma: no cover - depends on the PDF
        print(
            json.dumps(
                {
                    "status": "crashed",
                    "error": f"{type(exc).__name__}: {exc}",
                    "seconds": time.perf_counter() - started,
                }
            )
        )
        return 0

    elapsed = time.perf_counter() - started
    texts = list(getattr(document, "texts", []) or [])
    tables = list(getattr(document, "tables", []) or [])
    pictures = list(getattr(document, "pictures", []) or [])

    def has_geometry(item: object) -> bool:
        provenance = getattr(item, "prov", None) or []
        return bool(provenance) and getattr(provenance[0], "bbox", None) is not None

    headings = sum(1 for t in texts if str(getattr(t, "label", "")).lower() in ("section_header",))
    equations = sum(1 for t in texts if str(getattr(t, "label", "")).lower() == "formula")
    captions = sum(1 for t in texts if str(getattr(t, "label", "")).lower() == "caption")

    cells = 0
    for table in tables:
        data = getattr(table, "data", None)
        cells += len(getattr(data, "table_cells", []) or []) if data is not None else 0

    print(
        json.dumps(
            {
                "status": "ok",
                "seconds": elapsed,
                "pages": len(getattr(document, "pages", {}) or {}),
                "counts": {
                    "blocks": len(texts) + len(tables) + len(pictures),
                    "with_bbox": sum(1 for t in texts if has_geometry(t)),
                    "with_page": sum(1 for t in texts if has_geometry(t)),
                    # Docling's self_ref ids are POSITIONAL JSON pointers (`#/texts/47`). They
                    # are stable within a parse and NOT across re-parses - findings.md H2 calls
                    # this "the single most important schema consequence", because it is why
                    # PaperTree must mint content-derived ids whichever parser wins.
                    "with_stable_id": 0,
                    "headings": headings,
                    "equations": equations,
                    "equations_with_latex": 0,
                    "figures": len(pictures),
                    "tables": len(tables),
                    "table_cells": cells,
                    "captions_linked": captions,
                    "sections": headings,
                },
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
