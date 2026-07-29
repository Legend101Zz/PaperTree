#!/usr/bin/env python3
"""Emit ``conformance/validator-clean.json`` - the semantically perfect PaperIR document that
``test/validate.spec.ts`` and ``python/tests/test_validate.py`` mutate.

Run with::

    cd "/path/to/PaperTree"
    uv run python packages/document-ir/conformance/generate-validator-clean.py

WHY THIS IS GENERATED AND NOT HAND-WRITTEN. Rule I1 recomputes every ``blk_`` id from the block's
own ``source_hash | page_index | q(x0) | q(y0) | type | normalise(text)[:8]``, and rules 28/29
recompute ``text_normalised`` and ``content_hash``. A hand-written document cannot satisfy those,
which is exactly why DESIGN.md 8's worked example fails them (see the test suite). So the geometry,
the text and the structure are written by hand below; the three DERIVED fields are computed with
the identity library and threaded through every place that names them.

HONEST CAVEAT. Because this generator derives ``block_id`` / ``text_normalised`` /
``content_hash`` with the same functions rules I1/28/29 check them against, "the clean document
produces zero diagnostics" is not independent evidence for those three rules. It is evidence for
the other 44. I1/28/29 are graded by the MUTATION cases, which perturb the stored value and not
the recomputation, and by the DESIGN.md 8 worked example, whose hand-invented ids and blake2s
hashes both fail.

This script is deterministic: two runs produce byte-identical output.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from papertree_document_ir.generated.models import Paper
from papertree_document_ir.geometry import polygon_extent
from papertree_document_ir.identity import BlockIdInput, block_id, content_hash, normalise_text

HERE = Path(__file__).resolve().parent
OUT = HERE / "validator-clean.json"

PAPER_ID = "ppr_01JQ8ZC5X4T2VBN6R3KDWY7HAE"
SOURCE_HASH_HEX = "9f2c4b1e7a03d5c68f19b2e4a7c0d3f6819b5e2a4c7d0f36819b5e2a4c7d0f36"
SOURCE_HASH = f"sha256:{SOURCE_HASH_HEX}"

CONFIG_HASH = "sha256:0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9"

PARAGRAPH_TEXT = "We explicitly reformulate the layers as learning residual functions F(x)."
REFERENCE_TEXT = (
    "[1] K. He, X. Zhang, S. Ren, and J. Sun. Deep Residual Learning for Image Recognition. "
    "In CVPR, 2016. doi:10.1109/CVPR.2016.90"
)


def rect(x0: float, y0: float, x1: float, y1: float) -> list[list[float]]:
    """A 4-vertex ring, clockwise on screen, starting top-left. NOT closed: no repeated point."""
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def image(path: str, scale: float, rendered_from: str) -> dict[str, Any]:
    return {
        "uri": f"r2://papers/{PAPER_ID}/{path}",
        "scale": scale,
        "rendered_from": rendered_from,
    }


#: (key, type, page, polygon, text, flow, order, doc_order, extra fields).
#: `key` is a stable handle used only inside this script; the emitted document carries real ids.
BLOCKS: list[dict[str, Any]] = [
    {
        "key": "title",
        "type": "title",
        "page_index": 0,
        "polygon": rect(54, 72, 558, 96),
        "flow": "body",
        "order": 0,
        "doc_order": 0,
        "text": "Deep Residual Learning for Image Recognition",
        "source": "pdf_text_layer",
        "confidence": 0.97,
        "provenance": {"parser": "pdfium-deterministic", "stage": "layout+text"},
        "children": ["paragraph", "figure", "heading"],
    },
    {
        "key": "paragraph",
        "type": "paragraph",
        "page_index": 0,
        "polygon": rect(54, 120, 292, 240),
        "flow": "body",
        "order": 1,
        "doc_order": 1,
        "text": PARAGRAPH_TEXT,
        "source": "pdf_text_layer",
        "confidence": 0.95,
        "provenance": {"parser": "pdfium-deterministic", "stage": "layout+text"},
        "parent": "title",
        "children": ["inline_equation"],
        "next": "figure",
        "spans": [
            {
                "start": 0,
                "end": 45,
                "bbox": [54, 120, 292, 132],
                "font": "NimbusRomNo9L-Regu",
                "size": 9.96,
            },
            {
                "start": 45,
                "end": 68,
                "bbox": [54, 132, 240, 144],
                "font": "NimbusRomNo9L-Regu",
                "size": 9.96,
            },
            {
                "start": 68,
                "end": 72,
                "bbox": [240, 132, 262, 144],
                "role": "inline_equation",
                "span_block": "inline_equation",
                "font": "CMMI10",
                "size": 9.96,
            },
        ],
        # text[49:57] == "residual"; _dehyphenate("resid-\nual") == "residual" (rules 27 and 30b).
        "repairs": [
            {
                "kind": "dehyphenate",
                "applied": True,
                "at": 49,
                "from": "resid-\nual",
                "to": "residual",
            }
        ],
    },
    {
        "key": "inline_equation",
        "type": "inline_equation",
        "page_index": 0,
        "polygon": rect(240, 132, 262, 144),
        "flow": "body",
        "order": 0,
        "text": "F(x)",
        "source": "pdf_text_layer",
        "confidence": 0.71,
        "provenance": {"parser": "pdfium-deterministic", "stage": "formula-recognition"},
        "parent": "paragraph",
        "payload": {
            "display": False,
            "latex": "\\mathcal{F}(\\mathbf{x})",
            "latex_confidence": 0.71,
            "image": image("eq/inline-1.webp", 3, "page"),
        },
    },
    {
        "key": "figure",
        "type": "figure",
        "page_index": 0,
        "polygon": rect(320, 120, 558, 300),
        "flow": "body",
        "order": 2,
        "doc_order": 2,
        "source": "pdf_vector",
        "confidence": 0.93,
        "provenance": {"parser": "pdfium-deterministic", "stage": "layout+text"},
        "parent": "title",
        "prev": "paragraph",
        "payload": {
            "figure_number": "2",
            "figure_kind": "diagram",
            "is_vector": True,
            "image": image("fig/figure-2.webp", 3, "vector"),
            "caption_block_key": "caption",
            "detected_labels": [
                {
                    "text": "conv 3x3",
                    "polygon": rect(340, 160, 396, 172),
                    "source": "pdf_text_layer",
                    "confidence": 0.88,
                }
            ],
        },
    },
    {
        "key": "caption",
        "type": "caption",
        "page_index": 0,
        "polygon": rect(320, 308, 558, 332),
        "flow": "caption",
        "order": 0,
        "text": "Figure 2. Residual learning: a building block.",
        "source": "pdf_text_layer",
        "confidence": 0.94,
        "provenance": {"parser": "pdfium-deterministic", "stage": "layout+text"},
    },
    {
        "key": "heading",
        "type": "heading",
        "page_index": 1,
        "polygon": rect(54, 72, 292, 90),
        "flow": "body",
        "order": 0,
        "doc_order": 3,
        "text": "3. Deep Residual Learning",
        "source": "pdf_text_layer",
        "confidence": 0.96,
        "provenance": {"parser": "pdfium-deterministic", "stage": "layout+text"},
        "parent": "title",
        "children": ["equation", "table", "reference_entry", "citation"],
    },
    {
        "key": "equation",
        "type": "equation",
        "page_index": 1,
        "polygon": rect(54, 110, 292, 146),
        "flow": "body",
        "order": 1,
        "doc_order": 4,
        "source": "pdf_text_layer",
        "confidence": 0.9,
        "provenance": {"parser": "pdfium-deterministic", "stage": "formula-recognition"},
        "parent": "heading",
        "next": "table",
        "payload": {
            "display": True,
            "equation_number": "1",
            "latex": "\\mathcal{F}(\\mathbf{x}) := \\mathcal{H}(\\mathbf{x}) - \\mathbf{x}",
            "latex_confidence": 0.88,
            "image": image("eq/equation-1.webp", 3, "page"),
        },
        "alternatives": [
            {
                "parser": "pdfium-deterministic",
                "authored_by": "parser",
                "confidence": 0.9,
                "decision": "selected",
                "rule": "prefer_native_text_when_delta<0.2",
            },
            {
                "parser": "vlm-repair",
                "authored_by": "model",
                "text": "\\mathcal{F}(x) + x",
                "confidence": 0.88,
                "decision": "not_selected",
                "rule": "prefer_native_text_when_delta<0.2",
            },
        ],
    },
    {
        "key": "table",
        "type": "table",
        "page_index": 1,
        "polygon": rect(54, 170, 292, 230),
        "flow": "body",
        "order": 2,
        "doc_order": 5,
        "source": "pdf_text_layer",
        "confidence": 0.87,
        "provenance": {"parser": "tatr", "stage": "table-structure"},
        "parent": "heading",
        "prev": "equation",
        "next": "reference_entry",
        "children": ["cell_a", "cell_b"],
        "payload": {
            "table_number": "1",
            "grid_cells": [
                {
                    "cell_key": "cell_a",
                    "r": 0,
                    "c": 0,
                    "polygon": rect(54, 170, 173, 200),
                    "is_header": True,
                },
                {
                    "cell_key": "cell_b",
                    "r": 0,
                    "c": 1,
                    "polygon": rect(173, 170, 292, 200),
                    "is_header": True,
                },
            ],
            "rows": 1,
            "cols": 2,
        },
    },
    {
        "key": "cell_a",
        "type": "table_cell",
        "page_index": 1,
        "polygon": rect(54, 170, 173, 200),
        "flow": "body",
        "order": 0,
        "text": "Method",
        "source": "pdf_text_layer",
        "confidence": 0.86,
        "provenance": {"parser": "tatr", "stage": "table-structure"},
        "parent": "table",
        "next": "cell_b",
    },
    {
        "key": "cell_b",
        "type": "table_cell",
        "page_index": 1,
        "polygon": rect(173, 170, 292, 200),
        "flow": "body",
        "order": 1,
        "text": "top-1 err.",
        "source": "pdf_text_layer",
        "confidence": 0.86,
        "provenance": {"parser": "tatr", "stage": "table-structure"},
        "parent": "table",
        "prev": "cell_a",
    },
    {
        "key": "reference_entry",
        "type": "reference_entry",
        "page_index": 1,
        "polygon": rect(54, 260, 292, 300),
        "flow": "body",
        "order": 3,
        "doc_order": 6,
        "text": REFERENCE_TEXT,
        "source": "pdf_text_layer",
        "confidence": 0.92,
        "provenance": {"parser": "pdfium-deterministic", "stage": "layout+text"},
        "parent": "heading",
        "prev": "table",
        "next": "citation",
    },
    {
        "key": "citation",
        "type": "citation",
        "page_index": 1,
        "polygon": rect(54, 320, 292, 334),
        "flow": "body",
        "order": 4,
        "doc_order": 7,
        "text": "[1]",
        "source": "pdf_text_layer",
        "confidence": 0.89,
        "provenance": {"parser": "pdfium-deterministic", "stage": "layout+text"},
        "parent": "heading",
        "prev": "reference_entry",
    },
]

PAGES = [
    {"page_id": "pg_2a4c6e2g4j6m2p4r", "index": 0, "confidence": 0.98},
    {"page_id": "pg_3b5d7f3h5k7n3q5s", "index": 1, "confidence": 0.83},
]


def build() -> dict[str, Any]:
    ids: dict[str, str] = {}
    for spec in BLOCKS:
        extent = polygon_extent(spec["polygon"])
        spec["bbox"] = extent
        ids[spec["key"]] = block_id(
            BlockIdInput(
                source_hash=SOURCE_HASH_HEX,
                page_index=spec["page_index"],
                x0=extent[0],
                y0=extent[1],
                block_type=spec["type"],
                text=spec.get("text", ""),
            )
        )
    if len(set(ids.values())) != len(ids):
        raise SystemExit("two blocks collided on one id; perturb a bbox or a text prefix")

    blocks: list[dict[str, Any]] = []
    for spec in BLOCKS:
        block: dict[str, Any] = {
            "block_id": ids[spec["key"]],
            "type": spec["type"],
            "page_index": spec["page_index"],
            "polygon": spec["polygon"],
            "bbox": spec["bbox"],
            "flow": spec["flow"],
            "order": spec["order"],
        }
        if "doc_order" in spec:
            block["doc_order"] = spec["doc_order"]
        if "parent" in spec:
            block["parent_id"] = ids[spec["parent"]]
        if "children" in spec:
            block["child_ids"] = [ids[k] for k in spec["children"]]
        if "prev" in spec:
            block["prev_id"] = ids[spec["prev"]]
        if "next" in spec:
            block["next_id"] = ids[spec["next"]]
        text = spec.get("text")
        if text is not None:
            block["text"] = text
            block["text_normalised"] = normalise_text(text)
            block["content_hash"] = content_hash(text)
            if block["text"][49:57] == "residual":
                pass  # documented in the paragraph spec; asserted below for real.
        if "spans" in spec:
            spans = []
            for raw in spec["spans"]:
                span = {k: v for k, v in raw.items() if k != "span_block"}
                if "span_block" in raw:
                    span["block_id"] = ids[raw["span_block"]]
                spans.append(span)
            block["spans"] = spans
        block["source"] = spec["source"]
        block["confidence"] = spec["confidence"]
        block["provenance"] = spec["provenance"]
        if "repairs" in spec:
            block["repairs"] = spec["repairs"]
        if "alternatives" in spec:
            block["alternatives"] = spec["alternatives"]
        payload = spec.get("payload")
        if payload is not None:
            resolved = {
                k: v
                for k, v in payload.items()
                if k not in ("caption_block_key", "grid_cells", "rows", "cols")
            }
            if "caption_block_key" in payload:
                resolved["caption_block"] = ids[payload["caption_block_key"]]
            if "grid_cells" in payload:
                cells = []
                for cell in payload["grid_cells"]:
                    entry = {k: v for k, v in cell.items() if k != "cell_key"}
                    entry["cell_id"] = ids[cell["cell_key"]]
                    cell_spec = next(b for b in BLOCKS if b["key"] == cell["cell_key"])
                    entry["text"] = cell_spec["text"]
                    cells.append(
                        {
                            "cell_id": entry["cell_id"],
                            "r": entry["r"],
                            "c": entry["c"],
                            "polygon": entry["polygon"],
                            "text": entry["text"],
                            "is_header": entry["is_header"],
                        }
                    )
                resolved["grid"] = {
                    "rows": payload["rows"],
                    "cols": payload["cols"],
                    "cells": cells,
                }
            block["payload"] = resolved
        blocks.append(block)

    by_key = {spec["key"]: block for spec, block in zip(BLOCKS, blocks, strict=True)}
    paragraph = by_key["paragraph"]
    if paragraph["text"][49:57] != "residual":
        raise SystemExit("the dehyphenate repair's offset drifted; rule 27 would fail")

    pages: list[dict[str, Any]] = []
    for page in PAGES:
        index = page["index"]
        on_page = [b for b in blocks if b["page_index"] == index]
        top_level = [
            b
            for b in on_page
            if "parent_id" not in b
            or next(x for x in blocks if x["block_id"] == b["parent_id"])["type"]
            in ("title", "heading")
        ]
        flows: dict[str, list[str]] = {
            key: [] for key in ("body", "caption", "footnote", "header", "footer", "margin")
        }
        for block in sorted(top_level, key=lambda b: b["order"]):
            flows[block["flow"]].append(block["block_id"])
        pages.append(
            {
                "page_id": page["page_id"],
                "index": index,
                "width": 612,
                "height": 792,
                "rotation": 0,
                "user_unit": 1,
                "crop_box": [0, 0, 612, 792],
                "media_box": [0, 0, 612, 792],
                "image": image(f"pages/{index:03d}@2x.webp", 2, "page"),
                "has_text_layer": True,
                "is_scanned": False,
                "block_ids": [b["block_id"] for b in on_page],
                "flows": flows,
                "confidence": page["confidence"],
            }
        )

    relations: list[dict[str, Any]] = [
        {
            "type": "caption_of",
            "from": ids["caption"],
            "to": ids["figure"],
            "confidence": 0.91,
            "provenance": "geometric+numbering",
        },
    ]
    for parent, child in (
        ("title", "paragraph"),
        ("title", "figure"),
        ("title", "heading"),
        ("paragraph", "inline_equation"),
        ("heading", "equation"),
        ("heading", "table"),
        ("heading", "reference_entry"),
        ("heading", "citation"),
        ("table", "cell_a"),
        ("table", "cell_b"),
    ):
        relations.append(
            {
                "type": "parent_of",
                "from": ids[parent],
                "to": ids[child],
                "confidence": 1,
                "provenance": "font-cluster",
            }
        )
    for a, b in (
        ("paragraph", "figure"),
        ("equation", "table"),
        ("table", "reference_entry"),
        ("reference_entry", "citation"),
        ("cell_a", "cell_b"),
    ):
        relations.append(
            {
                "type": "next_in_reading_order",
                "from": ids[a],
                "to": ids[b],
                "confidence": 1,
                "provenance": "geometric",
            }
        )
    relations.append(
        {
            "type": "cites",
            "from": ids["citation"],
            "to": ids["reference_entry"],
            "confidence": 0.94,
            "provenance": "numbering",
        }
    )

    document: dict[str, Any] = {
        "ir_version": "1.0.0",
        "paper_id": PAPER_ID,
        "source_hash": SOURCE_HASH,
        "generation": 1,
        "coordinate_space": "pdf_user_space_topleft",
        "parser": {
            "name": "pdfium-deterministic",
            "version": "0.1.0",
            "config_hash": CONFIG_HASH,
            "profile": "born-digital-fast",
            "parsed_at": "2026-07-30T09:14:22Z",
        },
        "status": "complete",
        "partial_reason": None,
        "metadata": {
            "title": {
                "value": "Deep Residual Learning for Image Recognition",
                "source_block_id": ids["title"],
                "confidence": 0.97,
            },
            "authors": [],
            "abstract": None,
            "doi": None,
            "arxiv_id": None,
            "venue": None,
            "year": {"value": 2016, "source_block_id": ids["reference_entry"], "confidence": 0.8},
        },
        "pages": pages,
        "blocks": blocks,
        "relations": relations,
        "sections": [
            {
                "heading_block_id": ids["title"],
                "level": 1,
                "block_ids": [ids["paragraph"], ids["figure"], ids["caption"]],
            },
            {
                "heading_block_id": ids["heading"],
                "level": 2,
                "parent_heading_block_id": ids["title"],
                "block_ids": [
                    ids["equation"],
                    ids["table"],
                    ids["reference_entry"],
                    ids["citation"],
                ],
            },
        ],
        "references": [
            {
                "reference_entry_block_id": ids["reference_entry"],
                "title": "Deep Residual Learning for Image Recognition",
                "authors": ["K. He", "X. Zhang", "S. Ren"],
                "year": 2016,
                "venue": "CVPR",
                "doi": "10.1109/CVPR.2016.90",
                "confidence": 0.9,
            }
        ],
        "confidence": {
            "overall": 0.91,
            "by_page": [0.98, 0.83],
            "weakest_pages": [1],
            "needs_review": True,
        },
    }
    return document


def main() -> None:
    document = build()
    Paper.model_validate(document)  # the semantic validator's stated precondition.
    payload = {
        "$note": (
            "The semantically perfect PaperIR document that test/validate.spec.ts and "
            "python/tests/test_validate.py mutate. GENERATED by "
            "conformance/generate-validator-clean.py - do not hand-edit; block_id, "
            "text_normalised and content_hash are computed with the identity library and no "
            "hand-written value can satisfy rules I1/28/29."
        ),
        "generated_by": "packages/document-ir/conformance/generate-validator-clean.py",
        "document": document,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(document['blocks'])} blocks, {len(document['pages'])} pages)")


if __name__ == "__main__":
    main()
