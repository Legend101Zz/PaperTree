"""Synthetic PaperIR documents for the db tests — the twin of packages/db/test/fixtures.ts.

NOT the golden fixtures (F0.7 owns those). Shape-correct, cheap to generate at 30k blocks,
and deliberately not hand-checked against any real PDF.
"""

from __future__ import annotations

from typing import Any

_BASE32 = "abcdefghijklmnopqrstuvwxyz234567"


def block_id_for(index: int) -> str:
    """Content-derived ids repeat across generations by design (D13) — same index, same id."""
    n = index
    out = ""
    for _ in range(16):
        out = _BASE32[n % 32] + out
        n //= 32
    return f"blk_{out}"


def page_id_for(index: int) -> str:
    return "pg_" + block_id_for(index)[4:]


#: A parser-shaped body paragraph, for the payload="realistic" measurement. See the twin
#: comment in packages/db/test/fixtures.ts: the "<2s for 30k blocks" acceptance bound is met
#: by the MINIMAL payload and not by this one, and both numbers are measured and printed.
_WORDS = 60
_SPANS = 12
_POLYGON_POINTS = 8


def make_paper(
    paper_id: str,
    source_hash: str,
    generation: int,
    block_count: int,
    page_count: int | None = None,
    relation_count: int | None = None,
    payload: str = "minimal",
) -> dict[str, Any]:
    pages_n = page_count if page_count is not None else max(1, -(-block_count // 60))
    pages: list[dict[str, Any]] = [
        {
            "page_id": page_id_for(i),
            "index": i,
            "width": 612,
            "height": 792,
            "rotation": 0,
            "user_unit": 1,
            "crop_box": [0, 0, 612, 792],
            "media_box": [0, 0, 612, 792],
            "image": None,
            "has_text_layer": True,
            "is_scanned": False,
            "block_ids": [],
            "flows": {
                "body": [],
                "caption": [],
                "footnote": [],
                "header": [],
                "footer": [],
                "margin": [],
            },
            "confidence": 0.97,
        }
        for i in range(pages_n)
    ]

    heavy = payload == "realistic"
    blocks: list[dict[str, Any]] = []
    for i in range(block_count):
        y = 40 + ((i * 11) % 700)
        text = (
            " ".join(f"token{(i + w) % 9973}" for w in range(_WORDS))
            if heavy
            else f"Paragraph {i} of the synthetic corpus."
        )
        blocks.append(
            {
                "block_id": block_id_for(i),
                "page_index": i % pages_n,
                "type": "paragraph",
                "flow": "body",
                "order": i,
                "doc_order": i,
                "polygon": (
                    [[72 + p * 58.5, y + (p % 2) * 10.5] for p in range(_POLYGON_POINTS)]
                    if heavy
                    else [[72, y], [540, y], [540, y + 10], [72, y + 10]]
                ),
                "bbox": [72, y, 540, y + 10],
                "text": text,
                "text_normalised": text.lower(),
                "content_hash": "sha256:" + format(i, "x").rjust(64, "0"),
                "spans": (
                    [
                        {
                            "start": s * 7,
                            "end": s * 7 + 6,
                            "bbox": [72 + s, y, 102 + s, y + 10],
                            "font": "NimbusRomNo9L-Regu",
                            "size": 9.9626,
                            "weight": 400,
                            "italic": False,
                        }
                        for s in range(_SPANS)
                    ]
                    if heavy
                    else [{"start": 0, "end": 9, "bbox": [72, y, 130, y + 10]}]
                ),
                "source": "pdf_text_layer",
                "confidence": 0.96,
                "provenance": (
                    {
                        "parser": "pymupdf",
                        "stage": "layout+text",
                        "page_pass": 2,
                        "rule": "block-merge-v3",
                    }
                    if heavy
                    else {"parser": "synthetic", "stage": "layout+text"}
                ),
            }
        )

    n_relations = relation_count if relation_count is not None else max(0, min(block_count - 1, 32))
    relations = [
        {
            "type": "continues_on_next_page",
            "from": block_id_for(i),
            "to": block_id_for(i + 1),
            "confidence": 0.9,
            "provenance": "geometric+numbering",
        }
        for i in range(n_relations)
    ]

    return {
        "ir_version": "1.0.0",
        "paper_id": paper_id,
        "source_hash": source_hash,
        "generation": generation,
        "coordinate_space": "pdf_user_space_topleft",
        "parser": {
            "name": "synthetic",
            "version": "0.0.0",
            "config_hash": "sha256:0000000000000000",
            "parsed_at": "2026-07-30T00:00:00Z",
        },
        "status": "complete",
        "partial_reason": None,
        "metadata": {
            "title": None,
            "authors": [],
            "abstract": None,
            "doi": None,
            "arxiv_id": None,
            "venue": None,
            "year": None,
        },
        "pages": pages,
        "blocks": blocks,
        "relations": relations,
        "sections": [],
        "references": [],
        "confidence": {
            "overall": 0.95,
            "by_page": [0.95] * pages_n,
            "weakest_pages": [],
            "needs_review": False,
        },
    }
