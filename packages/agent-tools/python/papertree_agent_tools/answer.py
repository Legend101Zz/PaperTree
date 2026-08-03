"""F3.5's answer contract — the Python twin of ``apps/web/src/components/inspector/types.ts``.

TWO IMPLEMENTATIONS OF ONE SCHEMA, AND HOW THEY ARE KEPT HONEST

The TypeScript side already exists and shipped with Epic 3's Inspector work: ``GroundedAnswer``
and ``VerifiedClaim`` in ``apps/web/src/components/inspector/types.ts``. **The field names here
are the same names in snake_case**, and the mapping is total:

    Python (this module)      TypeScript (types.ts)
    ----------------------    ---------------------------
    states                    states
    interpretation            interpretation
    supporting_block_ids      supportingBlockIds
    source_pages              sourcePages
    source_regions            sourceRegions
    confidence                confidence
    unresolved_ambiguities    unresolvedAmbiguities
    claims                    claims
    claim.text                text
    claim.supported_by        supportedBy
    claim.supported           supported
    claim.reason              reason

**THE CODE PATH NOW EXISTS AND IT IS :func:`answer_to_wire`** (#76). Until then this docstring
said "there is no code path between the two", and the alignment rested entirely on
``tests/test_answer_contract.py`` asserting the mapping mechanically. That test is unchanged and
is still the thing that has to keep passing; what changed is that ``POST /papers/{id}/ask`` now
serialises through :func:`answer_to_wire`, so a field renamed on one side breaks a request rather
than only a test. :data:`ANSWER_SCHEMA` remains the single written statement of the shape.

ONE FIELD DOES NOT MEAN THE SAME THING ON THE TWO SIDES, AND THE WIRE SAYS SO
    ``types.ts``'s ``GroundedAnswer.sourceRegions`` is ``Citation[]`` — anchor plus resolution.
    :func:`answer_to_wire` emits :class:`SourceRegion` ADDRESSES under that name, because the six
    selectors an ``Anchor`` needs live in ``@papertree/anchoring``, which is TypeScript-only (see
    below). The client mints the anchor from the address with ``captureCitation``. A consumer that
    assigns the wire object straight to a ``GroundedAnswer`` is wrong; ``apps/web``'s
    ``liveAnswerSource.ts`` is the conversion and it is the only sanctioned one.

THE ONE FIELD THAT IS NOT A CLEAN TWIN, SAID PLAINLY

``types.ts``'s ``sourceRegions`` is ``Citation[]``, and a ``Citation`` carries a resolved
``Anchor`` plus its ``Resolution`` — the comment there is emphatic about why: *"store an
``Anchor``, never a bare ``block_id`` — that is precisely what makes a citation survive a
re-parse."* **``@papertree/anchoring`` is TypeScript-only. There is no Python anchoring package,
and this package does not own one.** So :class:`SourceRegion` carries the ADDRESS an anchor would
be minted from — block id, page index, bbox in the document's coordinate space, and the target
type — and the anchor is minted on the TypeScript side where the six selectors live. That is a
real gap, not a design: a Python-side consumer that stores a ``SourceRegion`` and re-parses the
paper is storing a bare block id with extra fields, and it will be retired by any repair that
changes the block's content hash. It is recorded here so nobody discovers it at re-parse time.

WHY ``supporting_block_ids`` IS NON-EMPTY BY CONSTRUCTION

``types.ts``: *"Non-empty for any answer that renders. ``DerivedBlock`` enforces this at
runtime."* :class:`GroundedAnswer` raises in ``__post_init__`` for the same reason and in the
same direction: **an ungrounded answer must fail to exist rather than render unattributed.**
findings.md C4 records what v1 shipped — a response schema with no block ids at all, built from
±200 raw characters of context, in which nothing could be checked and so nothing was.

WHY ``interpretation`` IS NULLABLE AND SEPARATE

EPIC-03 §4: *"Interpretation is separated from what the paper states — in the schema and in the
UI."* Two fields, not one string with a convention about the second paragraph: a single field
cannot be rendered in two registers, and §11.4 requires that derived content never share a
register with the paper. ``None`` is the honest common case (a purely extractive answer) and must
not be faked — a model that always writes something into ``interpretation`` has made the
separation decorative.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

__all__ = [
    "ANSWER_SCHEMA",
    "CITATION_TARGET_TYPES",
    "UNVERIFIED_REASON",
    "AnswerContractError",
    "GroundedAnswer",
    "SourceRegion",
    "VerifiedClaim",
    "answer_from_mapping",
    "answer_to_wire",
    "camel_case",
    "target_type_for_block_type",
]

#: ``types.ts``'s ``CitationTargetType``, verbatim. Deliberately NOT PaperIR's block-type
#: vocabulary, which is OPEN (any ``^[a-z][a-z0-9_]{0,63}$`` string) — these are the buckets the
#: citation-navigation metric is reported in, and ``other`` is a real bucket rather than a
#: fallback for something forgotten. Reported per bucket because Epic 1's equation extents (#55)
#: and figure regions (#51) are known-bad, so one blended number would hide which half is broken.
CITATION_TARGET_TYPES: Final[tuple[str, ...]] = (
    "text",
    "heading",
    "equation",
    "figure",
    "table",
    "other",
)

_BLOCK_TYPE_TO_TARGET: Final[Mapping[str, str]] = {
    "equation": "equation",
    "inline_equation": "equation",
    "figure": "figure",
    "table": "table",
    "table_row": "table",
    "table_cell": "table",
    "heading": "heading",
    "title": "heading",
    "paragraph": "text",
    "caption": "text",
    "footnote": "text",
    "list": "text",
    "code": "text",
    "reference_entry": "text",
    "abstract": "text",
}


def target_type_for_block_type(block_type: str) -> str:
    """Buckets an OPEN-vocabulary block type into one of six citation target types.

    An unknown type answers ``"other"`` rather than raising, because ``Block.type`` is an open
    vocabulary and a future parser inventing ``theorem`` must produce a citable answer rather
    than a crash. ``"other"`` is a bucket, not a failure — see :data:`CITATION_TARGET_TYPES`.
    """
    return _BLOCK_TYPE_TO_TARGET.get(block_type, "other")


class AnswerContractError(ValueError):
    """An answer that violates the contract. Raised at construction, never returned."""


@dataclass(frozen=True, slots=True)
class VerifiedClaim:
    """One claim, with the verifier's verdict attached.

    ``supported is False`` is NOT a reason to drop the claim — it is a reason to render it
    differently and say so. A ``bool`` per claim is the only shape that can express all three
    outcomes (supported / flagged / absent); a filtered list can express exactly one of them, and
    it is the wrong one. ``tests/test_grounding_verifier.py`` asserts the flagged claim is still
    PRESENT in the output as well as marked, because a verifier that filters is the tempting
    wrong implementation and the "is it marked" half of the assertion passes for it too.
    """

    text: str
    #: The cited blocks the verifier could actually match this claim against. May be empty, and
    #: an empty one alongside ``supported=False`` is the normal shape of a flagged claim.
    supported_by: tuple[str, ...] = ()
    supported: bool = False
    #: Why the verifier reached that verdict. Shown to the reader, never swallowed. ``None`` only
    #: when ``supported`` is True and there is nothing to explain.
    reason: str | None = None

    def __post_init__(self) -> None:
        if not self.text.strip():
            raise AnswerContractError("a claim must have text; an empty claim cannot be verified")
        if not self.supported and self.reason is None:
            raise AnswerContractError(
                f"claim {self.text[:48]!r} is unsupported and carries no reason. A flag the "
                "reader cannot interpret is a flag the reader ignores."
            )

    def as_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "supported_by": list(self.supported_by),
            "supported": self.supported,
            "reason": self.reason,
        }


@dataclass(frozen=True, slots=True)
class SourceRegion:
    """A citable region: the address ``@papertree/anchoring`` would mint an ``Anchor`` from.

    See the module docstring on why this is an address and not an anchor. ``bbox`` is in PDF user
    space with a top-left origin — PaperIR's only coordinate space, CHECKed on the ``papers``
    table — and is carried so a citation chip can outline the polygon without a second query.
    """

    block_id: str
    page_index: int
    bbox: tuple[float, float, float, float]
    #: One of :data:`CITATION_TARGET_TYPES`.
    target_type: str = "other"
    #: The label the chip shows, e.g. ``"p3 · eq"``. Stable within one answer; used as the chip's
    #: key and its accessible-name suffix on the TypeScript side.
    label: str = ""

    def __post_init__(self) -> None:
        if self.target_type not in CITATION_TARGET_TYPES:
            raise AnswerContractError(
                f"target_type={self.target_type!r} is not one of {list(CITATION_TARGET_TYPES)}; "
                "use target_type_for_block_type() to bucket an open-vocabulary block type"
            )
        if self.page_index < 0:
            raise AnswerContractError(f"page_index must be >= 0, got {self.page_index}")

    def as_dict(self) -> dict[str, Any]:
        return {
            "block_id": self.block_id,
            "page_index": self.page_index,
            "bbox": list(self.bbox),
            "target_type": self.target_type,
            "label": self.label,
        }


@dataclass(frozen=True, slots=True)
class GroundedAnswer:
    """The answer contract. Every field required; ``interpretation`` required-and-nullable.

    "Required and nullable" rather than optional, throughout, for the reason
    ``papertree_document_ir``'s ``Metadata`` gives: there is then exactly one encoding of
    absence, and "we looked and found nothing" is stated rather than silently omitted.
    """

    states: str
    interpretation: str | None
    supporting_block_ids: tuple[str, ...]
    source_pages: tuple[int, ...]
    source_regions: tuple[SourceRegion, ...]
    confidence: float
    unresolved_ambiguities: tuple[str, ...]
    claims: tuple[VerifiedClaim, ...]

    def __post_init__(self) -> None:
        if not self.states.strip():
            raise AnswerContractError(
                "`states` is what the paper says and cannot be empty. An answer with no "
                "extractive content is an interpretation with nothing under it."
            )
        if not self.supporting_block_ids:
            raise AnswerContractError(
                "`supporting_block_ids` must be non-empty. findings.md C4: v1 shipped a response "
                "schema with no block ids at all, so nothing in it could be checked and nothing "
                "was. An ungrounded answer must fail to exist rather than render unattributed."
            )
        if not 0.0 <= self.confidence <= 1.0:
            raise AnswerContractError(f"confidence must be in [0, 1], got {self.confidence!r}")
        if self.interpretation is not None and not self.interpretation.strip():
            raise AnswerContractError(
                "`interpretation` is None or non-empty. An empty string is a third encoding of "
                "'there is none', and the UI renders it as a labelled, empty derived register."
            )

    @property
    def unsupported_claims(self) -> tuple[VerifiedClaim, ...]:
        """The flagged claims. Present in :attr:`claims` too — this is a view, never a filter."""
        return tuple(claim for claim in self.claims if not claim.supported)

    @property
    def fully_grounded(self) -> bool:
        """True when every claim was matched. False is a legitimate, renderable answer."""
        return all(claim.supported for claim in self.claims)

    def as_dict(self) -> dict[str, Any]:
        """The wire object. Key order fixed so two runs produce diffable JSON."""
        return {
            "states": self.states,
            "interpretation": self.interpretation,
            "supporting_block_ids": list(self.supporting_block_ids),
            "source_pages": list(self.source_pages),
            "source_regions": [region.as_dict() for region in self.source_regions],
            "confidence": self.confidence,
            "unresolved_ambiguities": list(self.unresolved_ambiguities),
            "claims": [claim.as_dict() for claim in self.claims],
        }


def answer_from_mapping(payload: Mapping[str, Any]) -> GroundedAnswer:
    """Builds a :class:`GroundedAnswer` from a decoded JSON object.

    Used by ``verify_answer_grounding``, whose argument IS an answer draft. Every contract
    violation surfaces as :class:`AnswerContractError` from the dataclasses' own
    ``__post_init__``; this function does shape coercion (list → tuple) and nothing else, so
    there is exactly one place the rules live.
    """
    claims = tuple(_claim_from_mapping(entry) for entry in _sequence(payload.get("claims")))
    regions = tuple(
        _region_from_mapping(entry) for entry in _sequence(payload.get("source_regions"))
    )
    interpretation = payload.get("interpretation")
    return GroundedAnswer(
        states=str(payload.get("states", "")),
        interpretation=None if interpretation is None else str(interpretation),
        supporting_block_ids=tuple(str(b) for b in _sequence(payload.get("supporting_block_ids"))),
        source_pages=tuple(int(p) for p in _sequence(payload.get("source_pages"))),
        source_regions=regions,
        confidence=float(payload.get("confidence", 0.0)),
        unresolved_ambiguities=tuple(
            str(a) for a in _sequence(payload.get("unresolved_ambiguities"))
        ),
        claims=claims,
    )


def camel_case(name: str) -> str:
    """``supporting_block_ids`` → ``supportingBlockIds``. The whole of the naming difference.

    MECHANICAL rather than a hand-written table, and that is the design decision. A table has to
    be edited when a field is added, and the failure mode of forgetting is a field that silently
    never reaches the client — the shape of defect this repo has been bitten by three times. This
    function cannot forget. ``tests/test_answer_contract.py`` derives the expected camel names
    with its own independent copy of this rule and compares, so the two would have to be wrong
    together.
    """
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def answer_to_wire(answer: GroundedAnswer) -> dict[str, Any]:
    """:meth:`GroundedAnswer.as_dict` with every key camelCased. The Python→TypeScript path.

    Recursive, so nested claims (``supported_by``) and regions (``block_id``, ``page_index``,
    ``target_type``) are converted too — those are exactly the keys a per-field table would have
    left behind, because they are one level down from the ones anybody looks at.

    See the module docstring on ``sourceRegions``: the values under that key are ADDRESSES, not
    ``types.ts``'s ``Citation``. Key order is inherited from ``as_dict``, so two runs diff.
    """
    return {camel_case(key): _camelise(item) for key, item in answer.as_dict().items()}


def _camelise(value: Any) -> Any:
    """Recurses into the two containers ``as_dict`` produces and leaves every scalar alone."""
    if isinstance(value, Mapping):
        return {camel_case(str(key)): _camelise(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_camelise(item) for item in value]
    return value


#: What an unverified draft claim carries in ``reason`` until the verifier replaces it.
#: ``VerifiedClaim`` refuses ``supported=False`` with ``reason=None``, and a DRAFT is by
#: definition unsupported-and-unexplained — so the placeholder is what keeps the invariant true
#: for the one legitimate case, instead of the invariant being weakened for every case.
UNVERIFIED_REASON: Final = "not yet verified — verify_answer_grounding has not run on this claim"


def _claim_from_mapping(payload: Mapping[str, Any]) -> VerifiedClaim:
    supported = bool(payload.get("supported", False))
    reason = payload.get("reason")
    if reason is None and not supported:
        reason = UNVERIFIED_REASON
    return VerifiedClaim(
        text=str(payload.get("text", "")),
        supported_by=tuple(str(b) for b in _sequence(payload.get("supported_by"))),
        supported=supported,
        reason=None if reason is None else str(reason),
    )


def _region_from_mapping(payload: Mapping[str, Any]) -> SourceRegion:
    bbox = [float(v) for v in _sequence(payload.get("bbox"))]
    if len(bbox) != 4:
        raise AnswerContractError(f"bbox must have 4 numbers, got {bbox}")
    return SourceRegion(
        block_id=str(payload.get("block_id", "")),
        page_index=int(payload.get("page_index", 0)),
        bbox=(bbox[0], bbox[1], bbox[2], bbox[3]),
        target_type=str(payload.get("target_type", "other")),
        label=str(payload.get("label", "")),
    )


def _sequence(value: object) -> Sequence[Any]:
    if value is None:
        return ()
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return value
    raise AnswerContractError(f"expected an array, got {type(value).__name__}")


#: The answer draft's JSON Schema, in the subset ``schema.py`` enforces.
#:
#: This is ``verify_answer_grounding``'s argument schema, so it describes a DRAFT: ``supported``
#: and ``reason`` on each claim are optional here because the verifier is what fills them. The
#: verified answer that comes back out has both on every claim.
ANSWER_SCHEMA: Final[Mapping[str, Any]] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["states", "interpretation", "supporting_block_ids", "claims"],
    "properties": {
        "states": {
            "type": "string",
            "minLength": 1,
            "description": "What the paper states, in the source register. Never your reading.",
        },
        "interpretation": {
            "type": ["string", "null"],
            "description": (
                "Your reading of it, kept separate from `states`. Pass null when the answer is "
                "purely extractive — that is the honest common case and must not be faked."
            ),
        },
        "supporting_block_ids": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "string", "minLength": 1},
            "description": "Block ids the answer rests on. Non-empty: an answer with none is "
            "rejected rather than rendered unattributed.",
        },
        "source_pages": {
            "type": "array",
            "items": {"type": "integer", "minimum": 0},
            "default": [],
            "description": "Zero-based page indices the answer draws on.",
        },
        "source_regions": {
            "type": "array",
            "default": [],
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["block_id", "page_index", "bbox"],
                "properties": {
                    "block_id": {"type": "string", "minLength": 1},
                    "page_index": {"type": "integer", "minimum": 0},
                    "bbox": {
                        "type": "array",
                        "minItems": 4,
                        "maxItems": 4,
                        "items": {"type": "number"},
                    },
                    "target_type": {"type": "string", "enum": list(CITATION_TARGET_TYPES)},
                    "label": {"type": "string"},
                },
            },
            "description": "Citable regions, as addresses. The Anchor is minted on the client.",
        },
        "confidence": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.5},
        "unresolved_ambiguities": {
            "type": "array",
            "items": {"type": "string", "minLength": 1},
            "default": [],
            "description": "What you were unsure about. Hiding this is what makes a confident "
            "wrong answer indistinguishable from a confident right one.",
        },
        "claims": {
            "type": "array",
            "minItems": 1,
            "description": "One entry per checkable assertion in `states`, each citing the "
            "blocks it rests on.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["text", "supported_by"],
                "properties": {
                    "text": {"type": "string", "minLength": 1},
                    "supported_by": {"type": "array", "items": {"type": "string", "minLength": 1}},
                    "supported": {"type": "boolean", "default": False},
                    "reason": {"type": "string"},
                },
            },
        },
    },
}
