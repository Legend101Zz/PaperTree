"""Mint a real Anchor v1 over one body paragraph of an uploaded paper, for the live journey.

    uv run python scripts/live/make_anchor.py IR.json [NEEDLE]

IR.json is the body of ``GET /papers/{id}/ir``. The anchor is minted by ``papertree_anchoring``
exactly as the API's own tests mint one (IR-stamped: BlockSelector, TextQuote, Shape, ...), against
the same text stream id the reader uses for an API paper (contracts.md section 6). It is printed
as one JSON object on stdout. Nothing here touches the network, a data root or a key.
"""

from __future__ import annotations

import json
import sys
import uuid
from datetime import UTC, datetime

from papertree_anchoring import capture_anchor, index_document
from papertree_document_ir import Paper


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as handle:
        paper = Paper.model_validate(json.load(handle))
    needle = argv[2] if len(argv) > 2 else None
    indexed = index_document(
        paper, f"api/{paper.paper_id}/g{paper.generation}/{paper.parser.version}"
    )
    candidates = [
        b.block.block_id
        for b in indexed.blocks
        if b.block.type == "paragraph"
        and len(b.text) > 120
        and (needle is None or needle in b.text)
    ]
    if not candidates:
        print("no body paragraph longer than 120 characters matches", file=sys.stderr)
        return 1
    # The first long paragraph after the abstract-sized ones: stable, and real prose.
    block_id = candidates[min(2, len(candidates) - 1)] if needle is None else candidates[0]
    anchor = capture_anchor(
        indexed,
        block_id,
        anchor_id=str(uuid.uuid4()),
        at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        client="live-journey",
    )
    print(json.dumps(dict(anchor)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
