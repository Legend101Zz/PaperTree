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

    # Page heights, needed to convert Docling's coordinates. `document.pages` is keyed by a
    # ONE-BASED page number, and `prov.page_no` uses the same numbering; PaperIR's `page_index`
    # is zero-based. Off by one here would score every region against the wrong page's gold and
    # report a parser that finds nothing.
    heights: dict[int, float] = {}
    for number, page in (getattr(document, "pages", {}) or {}).items():
        size = getattr(page, "size", None)
        if size is not None and getattr(size, "height", None):
            heights[int(number)] = float(size.height)

    def region_of(item: object, kind: str) -> dict[str, object] | None:
        """One item as a PaperIR-shaped region, in PDF user space with a TOP-LEFT origin.

        THE COORDINATE ORIGIN IS THE WHOLE DIFFICULTY. Docling's `BoundingBox` carries a
        `coord_origin` that is TOPLEFT or BOTTOMLEFT depending on the backend, and its `t`/`b`
        mean "top" and "bottom" in that frame - so under BOTTOMLEFT, `t` is the LARGER number.
        PaperIR and the gold set are both top-left. Converting with the wrong assumption produces
        boxes that are perfectly plausible, land on the wrong half of the page, and score 0.00
        everywhere - indistinguishable from a parser that failed.
        """
        provenance = getattr(item, "prov", None) or []
        if not provenance:
            return None
        prov = provenance[0]
        box = getattr(prov, "bbox", None)
        page_no = getattr(prov, "page_no", None)
        if box is None or page_no is None:
            return None

        origin = str(getattr(box, "coord_origin", "TOPLEFT")).upper()
        left, right = float(box.l), float(box.r)
        if "BOTTOMLEFT" in origin:
            height = heights.get(int(page_no))
            if height is None:
                return None
            # `t` and `b` are distances from the BOTTOM here, so the top edge is the larger one.
            top, bottom = height - float(box.t), height - float(box.b)
        else:
            top, bottom = float(box.t), float(box.b)

        if right < left:
            left, right = right, left
        if bottom < top:
            top, bottom = bottom, top
        return {
            "block_id": None,
            "type": kind,
            "page_index": int(page_no) - 1,
            "bbox": [round(left, 2), round(top, 2), round(right, 2), round(bottom, 2)],
        }

    #: Docling's label vocabulary mapped onto PaperIR block types. Anything unlisted becomes
    #: `unknown` WITH ITS GEOMETRY rather than being dropped - the same rule Epic 1 applies to
    #: its own output, and dropping would flatter Docling's precision by hiding its output.
    LABELS = {
        "title": "title",
        "section_header": "heading",
        "text": "paragraph",
        "paragraph": "paragraph",
        "formula": "equation",
        "caption": "caption",
        "footnote": "footnote",
        "page_header": "header",
        "page_footer": "footer",
        "list_item": "list",
        "code": "code",
        "reference": "reference_entry",
    }

    regions: list[dict[str, object]] = []
    for text_item in texts:
        label = str(getattr(text_item, "label", "")).lower().split(".")[-1]
        region = region_of(text_item, LABELS.get(label, "unknown"))
        if region is not None:
            regions.append(region)
    for table in tables:
        region = region_of(table, "table")
        if region is not None:
            regions.append(region)
    for picture in pictures:
        region = region_of(picture, "figure")
        if region is not None:
            regions.append(region)

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
                # PER-REGION GEOMETRY, which is what makes Docling scoreable against gold at all.
                # Until this existed the bridge returned capability counts only, so the decision
                # rule's "85 % of Docling's F1" could not be computed even with gold in hand.
                "blocks": regions,
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
