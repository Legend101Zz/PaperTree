"""A small PDF with a known picture on it, stored where the API keeps an upload, for the image
tests (the crop endpoint, the image ask): no corpus needed, so they run on CI.

Page 0 is Letter (612 x 792 pt). A filled red box sits at (100, 200)-(380, 300) and a blue one at
(100, 400)-(200, 460); the words ``FIGURE-TWO`` are set inside the red box. Page 1 is blank.
"""

from __future__ import annotations

from pathlib import Path

from papertree_document_worker.pdf import pymupdf

RED_BOX = (100.0, 200.0, 380.0, 300.0)
BLUE_BOX = (100.0, 400.0, 200.0, 460.0)


def make_pdf() -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=612, height=792)
    page.draw_rect(pymupdf.Rect(*RED_BOX), color=(1, 0, 0), fill=(1, 0.2, 0.2))
    page.draw_rect(pymupdf.Rect(*BLUE_BOX), color=(0, 0, 1), fill=(0.2, 0.2, 1))
    page.insert_text((120, 260), "FIGURE-TWO", fontsize=24, color=(1, 1, 1))
    document.new_page(width=612, height=792)
    out: bytes = document.tobytes()
    document.close()
    return out


def store_pdf(upload_root: Path, paper_id: str) -> Path:
    """Where ``GET /papers/{id}/file`` and the crop route read the upload."""
    upload_root.mkdir(parents=True, exist_ok=True)
    path = upload_root / f"{paper_id}.pdf"
    path.write_bytes(make_pdf())
    return path


def image_anchor(
    doc: dict[str, object],
    *,
    kind: str = "figure_region",
    page: int = 0,
    box: tuple[float, float, float, float] = RED_BOX,
    block_id: str | None = None,
    anchor_id: str = "7e1f0c3a-5b2d-4c8e-9a64-1d2e3f4a5b6c",
) -> dict[str, object]:
    """A client-shaped IMAGE anchor (Anchor v1): a PageSelector and one ShapeSelector quad, no text
    quote. ``doc`` is the paper's (``paragraph_anchor()["doc"]``: its id and its source hash)."""
    selectors: list[dict[str, object]] = []
    if block_id is not None:
        selectors.append({"type": "BlockSelector", "blockId": block_id, "blockTextHash": "h"})
    selectors += [
        {"type": "PageSelector", "index": page},
        {
            "type": "ShapeSelector",
            "pageIndex": page,
            "quads": [list(box)],
            "polygons": [],
            "pageWidth": 612,
            "pageHeight": 792,
            "rotation": 0,
            "userUnit": 1,
            "cropBox": [0, 0, 612, 792],
        },
    ]
    return {
        "anchorVersion": 1,
        "offsetUnit": "unicode",
        "id": anchor_id,
        "doc": doc,
        "targetKind": kind,
        "provenanceClass": "source",
        "selectors": selectors,
        "created": {"mode": "source", "at": "2026-11-20T10:00:00.000Z", "client": "api-tests"},
    }
