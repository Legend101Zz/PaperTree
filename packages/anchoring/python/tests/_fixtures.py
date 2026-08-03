"""The three golden papers, and the conformance vectors built from them.

THE FIXTURES ARE REAL PARSES, NOT INPUTS THIS SUITE AUTHORED. ``packages/document-ir/fixtures`` is
199 hand-checked blocks over 10 of 45 pages of ``attention``, ``neural-odes`` and ``resnet``, and it
is the same set ``packages/anchoring/test/fixtures.ts`` loads. That matters here for the reason
AGENTS.md §4 records against #66: a producer tested only against a document its own author wrote
asserts that the producer matches the author's mental model of the schema, which is the thing that
was wrong. Every number in this suite has a denominator and the denominator is a real parse.

THE SELECTION RULE IS A RULE, NOT A LIST. Vectors are "the first block in reading order of each
distinct ``Block.type``, per fixture" — 46 of them. Hand-picked ids rot the moment a fixture is
regenerated, and worse, they let the author pick the blocks that work. This rule cannot: it drags in
the textless ``figure``/``table``/``unknown`` blocks, the one-character ``page_number``, and the
nested ``table_cell`` that is only reachable through step 3 of the reading order.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from papertree_anchoring import IndexedDocument, capture_anchor, index_document, normalise_for_match
from papertree_document_ir import Paper, loads

PKG = Path(__file__).resolve().parents[2]
FIXTURE_DIR = PKG.parent / "document-ir" / "fixtures"
VECTOR_FILE = PKG / "conformance" / "python-selector-vectors.json"

FIXTURE_SLUGS = ("attention-is-all-you-need", "neural-odes-mathheavy", "resnet-cvpr-2col")

#: Recorded in the vector file and asserted by the TypeScript side against the real constant, so a
#: change to the resolver's short-quote gate fails as "the constant moved" and not as a baffling
#: tier mismatch. This is the ONE resolver constant the expectations below depend on.
MIN_QUOTE_WITHOUT_CONTEXT = 10

#: Fixed so the vectors are reproducible byte-for-byte; a real caller passes its own.
TEXT_STREAM_ID = "papertree/anchoring/python-conformance/1"
CAPTURED_AT = "2026-08-03T00:00:00.000Z"

SELECTION_RULE = "the first block in reading order of each distinct Block.type, per fixture"


def load_paper(slug: str) -> Paper:
    return Paper.model_validate(loads((FIXTURE_DIR / f"{slug}.paperir.json").read_text("utf-8")))


def load_document(slug: str) -> IndexedDocument:
    return index_document(load_paper(slug), TEXT_STREAM_ID)


def _selector(anchor: dict[str, Any], kind: str) -> dict[str, Any] | None:
    return next((s for s in anchor["selectors"] if s["type"] == kind), None)


def _expectations(anchor: dict[str, Any]) -> dict[str, int]:
    """The tier Python CLAIMS the real TypeScript resolver reaches, per selector subset.

    Derived from the ladder's published entry conditions, NOT from a Python resolver — there is no
    Python resolver and #72 option 2 is the decision that there must not be. Each key names the
    subset ``test/python-conformance.spec.ts`` hands to ``resolveAnchor``; 6 is Tier.Orphan, which
    is a real verdict here rather than a failure: a figure carries no quote, so a subset that offers
    only text tiers MUST orphan, and asserting that is what stops the suite quietly passing because
    something else answered.
    """
    quote = _selector(anchor, "TextQuoteSelector")
    section = _selector(anchor, "SectionPathSelector")
    exact_normalised = "" if quote is None else quote["exactNormalised"]
    has_context = (
        quote is not None and bool(quote["prefixNormalised"]) and bool(quote["suffixNormalised"])
    )
    quote_resolves = bool(exact_normalised) and (
        len(exact_normalised) >= MIN_QUOTE_WITHOUT_CONTEXT or has_context
    )
    section_resolves = section is not None and (
        bool(normalise_for_match(section["headingText"]).text) or bool(section["path"][-1:])
    )
    return {
        # T1 always: the block is in this parse and the hash is the one the document ships.
        "full": 1,
        # T2 verifies the stream slice against the quote, so this is where a text-stream ordering
        # drift or a normalisation drift between the two bindings shows up as a tier drop to 3.
        "position": 2 if quote is not None else 6,
        "quote": 3 if quote_resolves else 6,
        "shape": 4 if _selector(anchor, "ShapeSelector") is not None else 6,
        "sectionPath": 5 if section_resolves else 6,
    }


def build_vectors() -> dict[str, Any]:
    streams: dict[str, str] = {}
    vectors: list[dict[str, Any]] = []
    for slug in FIXTURE_SLUGS:
        doc = load_document(slug)
        streams[slug] = "sha256:" + hashlib.sha256(doc.stream.encode("utf-8")).hexdigest()
        first_of_type: dict[str, str] = {}
        for indexed in doc.blocks:
            first_of_type.setdefault(indexed.block.type, indexed.block.block_id)
        for block_type, block_id in first_of_type.items():
            anchor = dict(
                capture_anchor(
                    doc,
                    block_id,
                    anchor_id=f"anc_{slug}_{block_type}",
                    at=CAPTURED_AT,
                    client="papertree_anchoring/conformance",
                )
            )
            vectors.append(
                {
                    "fixture": slug,
                    "blockType": block_type,
                    "blockId": block_id,
                    "expect": _expectations(anchor),
                    "anchor": anchor,
                }
            )
    return {
        "$note": (
            "Selectors minted by papertree_anchoring (Python) from the three golden fixtures. "
            "Each vector's `expect` is a CLAIM about what the real TypeScript resolver does with a "
            "subset of those selectors; test/python-conformance.spec.ts runs resolveAnchor and "
            "checks it. Python asserting only that Python wrote JSON is the vacuous green this "
            "file exists to prevent."
        ),
        "contract_version": "papertree/anchoring-python-selectors/1.0.0",
        "generated_by": ("PAPERTREE_WRITE_VECTORS=1 uv run pytest packages/anchoring/python/tests"),
        "selection_rule": SELECTION_RULE,
        "text_stream_id": TEXT_STREAM_ID,
        "resolver_constants": {"MIN_QUOTE_WITHOUT_CONTEXT": MIN_QUOTE_WITHOUT_CONTEXT},
        "stream_sha256": streams,
        "vectors": vectors,
    }


def render_vectors(payload: dict[str, Any]) -> str:
    """One vector per LINE.

    ``json.dumps(indent=2)`` would put every polygon vertex on its own line and turn 46 vectors into
    several thousand; one line per vector keeps a changed vector to a one-line diff and the whole
    artefact to ~55 lines. ``packages/anchoring/conformance/`` is in ``.prettierignore`` for exactly
    this, on the model of ``packages/document-ir/conformance/``.
    """
    head = {key: value for key, value in payload.items() if key != "vectors"}
    lines = json.dumps(head, indent=2, ensure_ascii=False, sort_keys=True)[:-2].rstrip()
    body = ",\n".join(
        "    " + json.dumps(vector, ensure_ascii=False, sort_keys=True)
        for vector in payload["vectors"]
    )
    return f'{lines},\n  "vectors": [\n{body}\n  ]\n}}\n'
