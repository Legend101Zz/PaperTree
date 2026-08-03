"""papertree_anchoring — derive ADR-004 anchor selectors in Python. Resolve them in TypeScript.

WHY THIS PACKAGE EXISTS, with the number re-measured on 2026-08-03 rather than quoted.
``apps/web/test/citation-nav.spec.ts`` re-parses ``resnet-cvpr-2col`` under ``worst_case`` with ids
re-minted by the real ``blockId`` and prints:

    bare block_id survival: 3.3%   ·   Anchor survival: 100.0%

A block id is content-derived, so any edit to a block retires it and the link breaks SILENTLY. Until
now only TypeScript could mint the alternative, so a Python consumer that persisted a citation was
persisting a bare id with extra fields (``agent_tools/answer.py``'s own header says so). This is #72
option 2: derive the selectors here, store them, and let ``resolve.ts`` remain the only resolver.

WHAT THIS PACKAGE DELIBERATELY IS NOT

* **Not a resolver.** No T0-T6 ladder, no thresholds, no fuzzy matcher. See ``capture.py``.
* **Not a second region type.** ``SourceRegion`` stays the address; this turns an address into
  selectors. There is no dataclass here that competes with it.
* **Not sub-block.** Whole-block targets only, which is the shape ``SourceRegion`` carries.

HOW IT IS KEPT HONEST. A Python suite that mints well-formed selectors no resolver ever reaches T1
on would be green and worthless. So ``packages/anchoring/conformance/python-selector-vectors.json``
records, per vector, the tier Python CLAIMS the real TypeScript resolver will reach for a given
subset of the selectors — and ``test/python-conformance.spec.ts`` runs the real ``resolveAnchor``
and checks the claim. The producer commits; the consumer verifies.
"""

from papertree_anchoring.capture import (
    CONTEXT_CODE_POINTS,
    Anchor,
    AnchorDoc,
    BlockSelector,
    Created,
    PageSelector,
    SectionPathSelector,
    Selector,
    ShapeSelector,
    TargetKind,
    TextPositionSelector,
    TextQuoteSelector,
    capture_anchor,
    capture_selectors,
)
from papertree_anchoring.document import (
    BLOCK_SEPARATOR,
    FLOW_ORDER,
    IndexedBlock,
    IndexedDocument,
    index_document,
    reading_order,
)
from papertree_anchoring.quotenorm import (
    HYPHENS,
    NEWLINES,
    NormalisedQuote,
    is_whitespace,
    normalise_for_match,
    snap_to_word_boundary,
)

__all__ = [
    "BLOCK_SEPARATOR",
    "CONTEXT_CODE_POINTS",
    "FLOW_ORDER",
    "HYPHENS",
    "NEWLINES",
    "Anchor",
    "AnchorDoc",
    "BlockSelector",
    "Created",
    "IndexedBlock",
    "IndexedDocument",
    "NormalisedQuote",
    "PageSelector",
    "SectionPathSelector",
    "Selector",
    "ShapeSelector",
    "TargetKind",
    "TextPositionSelector",
    "TextQuoteSelector",
    "capture_anchor",
    "capture_selectors",
    "index_document",
    "is_whitespace",
    "normalise_for_match",
    "reading_order",
    "snap_to_word_boundary",
]
