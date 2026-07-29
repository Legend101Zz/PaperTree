"""papertree_document_ir - the PaperIR canonical document representation (Python twin).

The JSON Schema in ``packages/document-ir/schema/`` is the single source of truth (DESIGN.md §1).
Everything re-exported here is GENERATED from it by ``codegen/generate.ts``; nothing under
``generated/`` may be hand-edited, and ``test/codegen-drift.spec.ts`` fails the build if it is.

Two schema files, two generated modules (DESIGN.md §6): ``generated.models`` for PaperIR and
``generated.derivation_models`` for Derivation. They are deliberately not merged.

Validate a document with ``Paper.model_validate(loads(text))``. The models are strict on purpose -
see ``generated.models._Model`` for why lax coercion would make this binding disagree with ajv -
and ``loads`` is here rather than ``json.loads`` for the reason given on it.
"""

from typing import Any

from papertree_document_ir.generated.derivation_models import (
    KNOWN_DERIVATION_KINDS,
    Derivation,
    DerivationKind,
    DerivationRoot,
    KnownDerivationKind,
    ModelAuthor,
    is_known_derivation_kind,
)
from papertree_document_ir.generated.models import (
    KNOWN_BLOCK_TYPES,
    KNOWN_HEADING_BLOCK_TYPES,
    KNOWN_RELATION_TYPES,
    MAX_PAYLOAD_DEPTH,
    MODEL_AUTHORSHIP_KEYS,
    AbstractRef,
    AlgoPrefixedHash,
    Alternative,
    BBox,
    Block,
    BlockId,
    BlockType,
    Confidence,
    DetectedLabel,
    DocumentConfidence,
    EquationPayload,
    EquationSymbol,
    FigurePanel,
    FigurePayload,
    Flow,
    Flows,
    ImageRef,
    KnownBlockType,
    KnownHeadingBlockType,
    KnownRelationType,
    Metadata,
    MetadataValue,
    MetadataYear,
    OpaquePayload,
    Page,
    PageId,
    Paper,
    PaperId,
    PaperRoot,
    PaperStatus,
    ParserInfo,
    Point,
    Polygon,
    Provenance,
    Reference,
    Relation,
    RelationType,
    Repair,
    RepairKind,
    Section,
    Sha256Hash,
    SourceKind,
    Span,
    TableCell,
    TableGrid,
    TablePayload,
    assert_model_free,
    find_excessive_depth,
    find_model_declaration,
    is_known_block_type,
    is_known_heading_block_type,
    is_known_relation_type,
    validate_opaque_payload,
)


def _reject_json_constant(token: str) -> Any:
    raise ValueError(f"{token} is not JSON and cannot cross the TypeScript boundary")


def loads(text: str | bytes) -> Any:
    """``json.loads`` with the non-JSON constants switched off.

    CPython accepts ``NaN``, ``Infinity`` and ``-Infinity`` as number literals; ``JSON.parse``
    cannot read them at all, so a document containing one is a document the two halves of this
    system cannot agree on - Python would hand Pydantic a float and TypeScript would throw at the
    parse layer, before any validator got a verdict. Every float in PaperIR 1.0.0 is bounded, so
    nothing is accepted today that this rejects; it is here so the first UNBOUNDED number added in
    a later version does not open the hole silently. See DESIGN.md §12.7.
    """
    import json

    return json.loads(text, parse_constant=_reject_json_constant)


# ─── identity + geometry (F0.4) ─────────────────────────────
# from papertree_document_ir.identity import ...
# from papertree_document_ir.geometry import ...

__all__ = [
    "KNOWN_BLOCK_TYPES",
    "KNOWN_DERIVATION_KINDS",
    "KNOWN_HEADING_BLOCK_TYPES",
    "KNOWN_RELATION_TYPES",
    "MAX_PAYLOAD_DEPTH",
    "MODEL_AUTHORSHIP_KEYS",
    "AbstractRef",
    "AlgoPrefixedHash",
    "Alternative",
    "BBox",
    "Block",
    "BlockId",
    "BlockType",
    "Confidence",
    "Derivation",
    "DerivationKind",
    "DerivationRoot",
    "DetectedLabel",
    "DocumentConfidence",
    "EquationPayload",
    "EquationSymbol",
    "FigurePanel",
    "FigurePayload",
    "Flow",
    "Flows",
    "ImageRef",
    "KnownBlockType",
    "KnownDerivationKind",
    "KnownHeadingBlockType",
    "KnownRelationType",
    "Metadata",
    "MetadataValue",
    "MetadataYear",
    "ModelAuthor",
    "OpaquePayload",
    "Page",
    "PageId",
    "Paper",
    "PaperId",
    "PaperRoot",
    "PaperStatus",
    "ParserInfo",
    "Point",
    "Polygon",
    "Provenance",
    "Reference",
    "Relation",
    "RelationType",
    "Repair",
    "RepairKind",
    "Section",
    "Sha256Hash",
    "SourceKind",
    "Span",
    "TableCell",
    "TableGrid",
    "TablePayload",
    "assert_model_free",
    "find_excessive_depth",
    "find_model_declaration",
    "is_known_block_type",
    "is_known_derivation_kind",
    "is_known_heading_block_type",
    "is_known_relation_type",
    "loads",
    "validate_opaque_payload",
]
