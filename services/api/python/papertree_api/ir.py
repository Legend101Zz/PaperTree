"""Recompose a stored generation into the PaperIR document a client can index.

WHAT `/papers/{id}/ir` RETURNS, because #74 asks for this decision to be explicit.

Exactly what `apps/web/src/lib/fixtures.ts` already fetches out of `public/fixtures/*.paperir.json`
and hands to `indexDocument`. `PaperSource` (packages/anchoring/src/document.ts:154) is a
structural subset of the full PaperIR `Paper`, so returning the whole document satisfies it and
also satisfies anything else that reads the IR. The fixture files ARE the contract; a test asserts
this output matches one of them for the same paper, key for key.

`PaperTreeDb.put_paper` decomposed the document into `papers` / `pages` / `blocks` / `relations`.
This inverts that, field for field.

THE TRAP THIS MODULE EXISTS TO AVOID

`PaperTreeDb` exposes `list_blocks_in_doc_order`, and the obvious `/ir` implementation calls it.
It is wrong, silently, and by a lot: its SQL filters `WHERE doc_order IS NOT NULL`
(database.py:341), and `doc_order` exists ONLY on top-level `flow == "body"` blocks — validator
rule 15 makes that mandatory rather than optional (AGENTS.md §4, #49). So it drops every caption,
footnote, header, footer, margin note, table row, table cell and inline equation in the document.

`packages/anchoring/src/document.ts:238-246` puts the size of that at 64 of 199 blocks — 32% — on
the fixture set. The response would still parse, still index, still render a page, and quietly
have no captions. `tests/test_ir.py::test_the_ir_response_matches_the_committed_fixture_exactly`
is watched failing against exactly that mutation.

So blocks are read per page via `list_blocks_on_page`, which has no such filter.

WHAT THE DATABASE DOES NOT STORE, MEASURED — and what that costs

`pages` has no `flows` column and no `block_ids` column, and BOTH FIELDS ARE REQUIRED by the
PaperIR schema (`Page.model_fields`: `block_ids` required, `flows` required). So a document that
went in through `put_paper` cannot come back out as a schema-valid PaperIR document without being
re-derived here. Three separate facts, each measured against all three committed fixtures rather
than reasoned about:

  1. `flows` IS exactly derivable: every block on the page, grouped by `flow`, ordered by `order`.
     Reproduces the stored value on 3/3 fixtures, every flow, every page.

     `0001_core.sql:80-81` states the rule as "reconstructable from `blocks(page_index, flow,
     "order")` FILTERED TO TOP-LEVEL BLOCKS". That filter is wrong: resnet page 0 has 11 top-level
     blocks and its `flows` carries 21 ids — every block on the page, nested ones included.
     Following the comment would silently drop every caption and table cell from reading order.
     Filed as a correction; the rule implemented here is the measured one.

  2. `block_ids` is the order the blocks appear in the document's `blocks` ARRAY — verified on
     3/3 fixtures, every page. That order is NOT STORED. `list_blocks_on_page` returns
     `ORDER BY flow, "order"`, which yields the same SET and a different ORDER on all three
     fixtures. So `block_ids` is emitted in the order the database can produce, not the order the
     producer wrote.

  3. The document-level `blocks` array has the same problem for the same reason.

WHY (2) AND (3) ARE HARMLESS, AND WHY THAT IS AN ARGUMENT RATHER THAN A SHRUG

Array order carries no meaning in PaperIR. Reading order is `Page.flows` plus parent/child descent
— AGENTS.md §4 is emphatic that it is NOT `doc_order` and NOT array position, because `doc_order`
exists only on top-level `flow == "body"` blocks and `doc_order ?? 0` collapses every caption to
position 0. `indexDocument` rebuilds the stream from `flows`, which IS round-tripped exactly. So
what is lost is a serialisation detail, and what is preserved is the thing every consumer reads.

A consumer that depended on array order would already be broken by any re-parse. If one turns up,
the fix is a stored ordinal in `packages/db`, not a sort here.
"""

from __future__ import annotations

import json
from typing import Any

from papertree_db import BlockId, Generation, OwnerId, PaperId, PaperTreeDb, Row


def _loads(value: Any) -> Any:
    return None if value is None else json.loads(value)


def _without_nulls(fields: dict[str, Any]) -> dict[str, Any]:
    """Drops keys whose value is None. OMISSION AND NULL ARE NOT THE SAME THING HERE.

    Several PaperIR fields are "optional but never nullable" and the generated validator says so in
    those words — `payload` is one, and an explicit `"payload": null` fails validation with
    `Value error, payload is optional but never nullable; omit it instead`. A SQLite NULL is how
    "absent" was stored, so the inverse must omit rather than emit null.

    Found by validating the response against the generated `Paper` model in `test_ir.py`, not by
    reading. Every block in every fixture was affected; the document was well-formed JSON, indexed
    fine in the reader, and was not a valid PaperIR document.
    """
    return {key: value for key, value in fields.items() if value is not None}


#: The flow buckets `Page.flows` always carries, in the schema's own key order. Present-but-empty
#: is the contract — resnet's `header` is `[]` on every page, not absent.
FLOWS: tuple[str, ...] = ("body", "caption", "footnote", "header", "footer", "margin")


def _page(row: Row, blocks_on_page: list[dict[str, Any]]) -> dict[str, Any]:
    return _without_nulls({
        "page_id": row["page_id"],
        # The column is `page_index`; the IR field is `index`. `_page_params` maps it the other
        # way, and getting this backwards yields pages that index as page 0 forever.
        "index": row["page_index"],
        "width": row["width"],
        "height": row["height"],
        "rotation": row["rotation"],
        "user_unit": row["user_unit"],
        "crop_box": _loads(row["crop_box"]),
        "media_box": _loads(row["media_box"]),
        "image": _loads(row["image"]),
        "has_text_layer": bool(row["has_text_layer"]),
        "is_scanned": bool(row["is_scanned"]),
        "confidence": row["confidence"],
        # Derived, because the schema requires them and the DB stores neither. See the header:
        # `flows` reproduces the producer exactly (3/3 fixtures); `block_ids` reproduces the same
        # SET in a different ORDER, and array order carries no meaning in PaperIR.
        "block_ids": [block["block_id"] for block in blocks_on_page],
        "flows": {
            flow: [
                block["block_id"]
                for block in sorted(
                    (b for b in blocks_on_page if b["flow"] == flow), key=lambda b: b["order"]
                )
            ]
            for flow in FLOWS
        },
    })


def _block(row: Row) -> dict[str, Any]:
    return _without_nulls({
        "block_id": row["block_id"],
        "page_index": row["page_index"],
        "type": row["type"],
        "flow": row["flow"],
        "order": row["order"],
        "doc_order": row["doc_order"],
        "parent_id": row["parent_id"],
        "prev_id": row["prev_id"],
        "next_id": row["next_id"],
        "child_ids": _loads(row["child_ids"]),
        "polygon": _loads(row["polygon"]),
        "bbox": [row["bbox_x0"], row["bbox_y0"], row["bbox_x1"], row["bbox_y1"]],
        "text": row["text"],
        "text_normalised": row["text_normalised"],
        "content_hash": row["content_hash"],
        "spans": _loads(row["spans"]),
        "payload": _loads(row["payload"]),
        "source": row["source"],
        "confidence": row["confidence"],
        "provenance": _loads(row["provenance"]),
        "repairs": _loads(row["repairs"]),
        "alternatives": _loads(row["alternatives"]),
    })


def _relation(row: Row) -> dict[str, Any]:
    # TWO traps here, both caught by comparing against a committed fixture rather than by reading.
    #
    #   1. The IR field names are `from` and `to`; the COLUMNS are `from_block`/`to_block`
    #      (`_relation_params` maps them, database.py:775-776). Emitting the column names produces
    #      a document that indexes cleanly and has zero usable relations.
    #   2. `provenance` on a relation is stored RAW, not JSON-encoded — unlike the identically
    #      named column on `blocks` and unlike every other `_json`-wrapped field. Round-tripping it
    #      through `json.loads` raises on the first row.
    return {
        "type": row["type"],
        "from": row["from_block"],
        "to": row["to_block"],
        "confidence": row["confidence"],
        "provenance": row["provenance"],
    }


def paper_document(
    db: PaperTreeDb, owner: OwnerId, paper_id: PaperId, generation: Generation
) -> dict[str, Any] | None:
    """The full PaperIR document for one generation, or None if the owner cannot see it."""
    paper = db.get_paper(owner, paper_id, generation)
    if paper is None:
        return None

    pages = db.list_pages(owner, paper_id, generation)

    # Per page, NOT `list_blocks_in_doc_order` — see this module's header. Blocks within a page
    # come back ordered by (flow, "order"); the document-global reading order is `indexDocument`'s
    # job and it rebuilds it from `Page.flows` plus parent/child descent, which is the only
    # correct way (AGENTS.md §4: `doc_order ?? 0` collapses every caption to position 0).
    blocks: list[dict[str, Any]] = []
    per_page: list[list[dict[str, Any]]] = []
    for page in pages:
        on_page = [
            _block(row)
            for row in db.list_blocks_on_page(owner, paper_id, generation, page["page_index"])
        ]
        per_page.append(on_page)
        blocks.extend(on_page)

    # NOT `_without_nulls` at this level: `partial_reason` is required AND nullable, so stripping
    # nulls here makes the document invalid in the opposite direction. Required-nullable and
    # optional-non-nullable both exist in this schema and they are not interchangeable.
    return {
        "ir_version": paper["ir_version"],
        "paper_id": paper["paper_id"],
        "generation": paper["generation"],
        "source_hash": paper["source_hash"],
        "coordinate_space": paper["coordinate_space"],
        "parser": {
            "name": paper["parser_name"],
            "version": paper["parser_version"],
            "config_hash": paper["parser_config_hash"],
            "profile": paper["parser_profile"],
            "parsed_at": paper["parsed_at"],
        },
        "status": paper["status"],
        "partial_reason": paper["partial_reason"],
        "metadata": _loads(paper["metadata"]),
        "pages": [_page(row, on_page) for row, on_page in zip(pages, per_page, strict=True)],
        "blocks": blocks,
        "relations": [_relation(row) for row in db.list_relations(owner, paper_id, generation)],
        "sections": _loads(paper["sections"]),
        "references": _loads(paper["references_json"]),
        "confidence": _loads(paper["confidence"]),
    }


def block_location(
    db: PaperTreeDb,
    owner: OwnerId,
    paper_id: PaperId,
    generation: Generation,
    block_id: BlockId,
) -> dict[str, Any] | None:
    """`(page_index, bbox)` for one block — what a citation needs to scroll to.

    Kept here rather than making a caller fetch the whole document for one bbox.
    """
    row = db.get_block(owner, paper_id, generation, block_id)
    if row is None:
        return None
    return {
        "block_id": row["block_id"],
        "page_index": row["page_index"],
        "bbox": [row["bbox_x0"], row["bbox_y0"], row["bbox_x1"], row["bbox_y1"]],
        "polygon": _loads(row["polygon"]),
    }
