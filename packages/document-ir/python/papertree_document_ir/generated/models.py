"""
DO NOT EDIT — generated from schema/paperir-1.0.0.schema.json by codegen/generate.ts.

Regenerate with `pnpm --filter @papertree/document-ir codegen`. Hand edits are deleted by
the next run and are caught before that by test/codegen-drift.spec.ts. The JSON Schema is the
single source of truth (DESIGN.md §1); Pydantic is one of its bindings, never a second one.
"""

# ruff: noqa: SIM102 - each nested `if` is one schema `if`/`then` branch, kept one-for-one
# with the construct it encodes; collapsing them would decouple the two.

from __future__ import annotations

import re
from collections.abc import Callable
from enum import StrEnum
from typing import Annotated, Any, ClassVar, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    model_validator,
)


def _json_integer(value: Any) -> Any:
    """JSON Schema 'integer' matches any NUMBER with a zero fractional part.

    'json.loads' hands '1.0', '1e0' and '10e-1' to Python as 'float', and strict Pydantic
    refuses to fill an 'int' from a float - so every non-JS producer (a Go 'float64', a numpy
    pipeline, 'json.dumps' of a computed year) emitted documents ajv blessed and this binding
    rejected. Converting here restores the JSON Schema meaning. 'bool' is passed through
    UNCHANGED so strict mode still rejects it: 'False == 0' in Python, ajv rejects it, and a
    conversion here would have quietly reopened that trap.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


#: JSON Schema '"type": "integer"'. See '_json_integer'.
JsonInt = Annotated[int, BeforeValidator(_json_integer)]


_LONE_SURROGATE = re.compile("[\ud800-\udfff]")


def _well_formed(value: str) -> str:
    """Unpaired-surrogate guard, applied to EVERY string in this binding.

    'json.loads' and ajv both accept a lone surrogate; it is not UTF-8-encodable, so such a
    document cannot survive the serialisation round-trip '$defs/Point' names as a precondition.
    pydantic-core already rejected it in every string carrying 'pattern' or 'min_length' while
    silently accepting it in an unconstrained one - an inconsistency inside ONE binding. Both
    generated bindings now reject it everywhere. Deliberate divergence from ajv: DESIGN.md §12.5.

    A surrogate PAIR in JSON text is decoded by 'json.loads' into one astral character, so any
    surrogate still present in a Python 'str' is by construction unpaired.
    """
    if _LONE_SURROGATE.search(value) is not None:
        raise ValueError("string contains an unpaired surrogate and is not UTF-8-encodable")
    return value


#: Every schema string. See '_well_formed'.
JsonText = Annotated[str, AfterValidator(_well_formed)]


#: See codegen/generate.ts 'MAX_PAYLOAD_DEPTH'; the TypeScript twin carries the same number.
MAX_PAYLOAD_DEPTH = 64


def find_excessive_depth(value: Any) -> tuple[str | int, ...] | None:
    """The path at which 'value' first nests deeper than MAX_PAYLOAD_DEPTH, or None.

    Iterative on purpose: a guard against unbounded recursion that is itself recursive raises
    RecursionError on exactly the input it exists to reject.
    """
    stack: list[tuple[Any, tuple[str | int, ...]]] = [(value, ())]
    while stack:
        node, path = stack.pop()
        if not isinstance(node, (dict, list)):
            continue
        if len(path) > MAX_PAYLOAD_DEPTH:
            return path
        if isinstance(node, list):
            stack.extend((child, (*path, index)) for index, child in enumerate(node))
            continue
        stack.extend((child, (*path, key)) for key, child in node.items())
    return None


def _one_of(allowed: tuple[int, ...]) -> Callable[[int], int]:
    """Membership test for an integer enum.

    'Literal[0, 90, 180, 270]' would accept 'False' ('False == 0' in Python) where ajv
    rejects it, so integer enums are an 'int' annotation — which strict mode refuses to fill
    from a bool — plus this check.
    """

    def check(value: int) -> int:
        if value not in allowed:
            raise ValueError(f"must be one of {allowed}")
        return value

    return check


_DATE_RE = re.compile(r"^(\d\d\d\d)-(\d\d)-(\d\d)\Z")
_TIME_RE = re.compile(r"^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)\Z", re.I)
_DAYS_IN_MONTH = (0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def _is_date(value: str) -> bool:
    m = _DATE_RE.match(value)
    if m is None:
        return False
    year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if month < 1 or month > 12:
        return False
    leap = month == 2 and year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    return 1 <= day <= _DAYS_IN_MONTH[month] + (1 if leap else 0)


def _is_time(value: str) -> bool:
    m = _TIME_RE.match(value)
    if m is None:
        return False
    hour, minute, second = int(m.group(1)), int(m.group(2)), float(m.group(3))
    sign = -1 if m.group(5) == "-" else 1
    tz_hour = int(m.group(6) or 0)
    tz_minute = int(m.group(7) or 0)
    if tz_hour > 23 or tz_minute > 59:
        return False
    if hour <= 23 and minute <= 59 and second < 60:
        return True
    utc_minute = minute - tz_minute * sign
    utc_hour = hour - tz_hour * sign - (1 if utc_minute < 0 else 0)
    return utc_hour in (23, -1) and utc_minute in (59, -1) and second < 61


def _date_time(value: str) -> str:
    """'format: "date-time"', ported from ajv-formats so both languages agree."""
    parts = re.split(r"[tT ]", value, maxsplit=1)
    if len(parts) != 2 or not _is_date(parts[0]) or not _is_time(parts[1]):
        raise ValueError('must match format "date-time"')
    return value


class _Model(BaseModel):
    """Base of every generated model.

    'extra="forbid"' is the Pydantic spelling of the schema's 'additionalProperties: false',
    which is the constraint that makes an AI-authored field unrepresentable (DESIGN.md §2.1).
    'strict=True' is what stops Pydantic's lax coercion from accepting documents ajv rejects:
    without it '"612"' becomes '612.0' and the two validators disagree.
    """

    model_config = ConfigDict(extra="forbid", strict=True)

    #: Optional fields are NEVER nullable (DESIGN.md D11). Pydantic cannot distinguish an absent
    #: key from an explicit 'null' once the default is 'None', so explicit nulls are rejected.
    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="before")
    @classmethod
    def _reject_explicit_null(cls, data: Any) -> Any:
        if isinstance(data, dict):
            for key in cls.NON_NULLABLE_OPTIONAL:
                if key in data and data[key] is None:
                    raise ValueError(f"{key} is optional but never nullable; omit it instead")
        return data


MODEL_AUTHORSHIP_KEYS: frozenset[str] = frozenset(
    {"model_id", "prompt_hash", "generated_by", "derivation_id", "derived_from", "prompt", "llm"}
)


def find_model_declaration(
    value: Any, path: tuple[str | int, ...] = ()
) -> tuple[str | int, ...] | None:
    """A recursive constraint: no object ANYWHERE in this value's subtree may declare model
    authorship. Applied to Block.payload for block types this schema does not know, which is
    the one place in PaperIR where an open object shape is required for forward compatibility.

    Without it, `blocks[i].payload` was the single object in the file with no
    "additionalProperties": false, and a complete Derivation — or a bare {"generated_by":
    "gpt-4"} — fitted inside it whole, one level below the block that rejects exactly those
    fields. That falsified the field-closure property the whole design rests on.

    This blocks the SHAPE of a declared derivation, not prose. A payload string containing
    model output is still expressible — see the schema-level description on
    undeclarable-vs-undetectable.

    Returns the path of the first model-authorship declaration, or None. A recursive
    constraint
    cannot be a type in either language, so it is a runtime guard in both (DESIGN.md §6).

    The descent stops at MAX_PAYLOAD_DEPTH so this guard cannot itself raise RecursionError.
    That
    is not a hole: every caller rejects an over-deep value outright before searching it, so
    the
    truncated levels are levels no valid document has.
    """
    if len(path) > MAX_PAYLOAD_DEPTH:
        return None
    if isinstance(value, list):
        for index, child in enumerate(value):
            hit = find_model_declaration(child, (*path, index))
            if hit is not None:
                return hit
        return None
    if isinstance(value, dict):
        for key, child in value.items():
            if key in MODEL_AUTHORSHIP_KEYS:
                return (*path, key)
            hit = find_model_declaration(child, (*path, key))
            if hit is not None:
                return hit
    return None


def assert_model_free(value: Any) -> None:
    """Raise if 'value' is over-deep or declares model authorship in its subtree."""
    too_deep = find_excessive_depth(value)
    if too_deep is not None:
        raise ValueError(
            "payload nests deeper than 64 levels" + f" at {'.'.join(str(p) for p in too_deep)}"
        )
    hit = find_model_declaration(value)
    if hit is not None:
        raise ValueError(f"model-authorship declaration at {'.'.join(str(p) for p in hit)}")


_OPAQUE_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}\Z")


def validate_opaque_payload(value: dict[str, Any]) -> dict[str, Any]:
    """Block.payload for any block type this schema version does not know. OPEN IN SHAPE — that
    is the forward-compatibility requirement: a block type added in 1.1.0 must be able to
    carry its own data without a major bump — but CLOSED against authorship declarations at
    any depth (see $defs/ModelFreeSubtree) and restricted to identifier-shaped keys.
    """
    too_deep = find_excessive_depth(value)
    if too_deep is not None:
        raise ValueError(
            "payload nests deeper than 64 levels" + f" at {'.'.join(str(p) for p in too_deep)}"
        )
    for key in value:
        if _OPAQUE_KEY_RE.match(key) is None:
            raise ValueError(f"payload key {key!r} must match " + _OPAQUE_KEY_RE.pattern)
    assert_model_free(value)
    return value


OpaquePayload = Annotated[dict[str, Any], AfterValidator(validate_opaque_payload)]


"""Paper identity: "ppr_" + a 26-character Crockford base32 ULID (uppercase, no I/L/O/U).
Time-ordered, so paper ids sort by ingest time.

A paper_id is minted ONCE per source_hash and is then HELD FIXED across every re-parse of that
PDF (re-parses vary only `generation`). This is required by two things at once: ADR-001's
generation model, and the milestone criterion "re-parsing produces byte-identical PaperIR" — a
freshly minted ULID per parse would falsify it by construction. See DESIGN.md §7 for the exact
definition of byte-identity.
"""
PaperId = Annotated[JsonText, Field(pattern=r"^ppr_[0-9A-HJKMNP-TV-Z]{26}$")]


"""A SHA-256 digest, algorithm-prefixed and lowercase hex, e.g. "sha256:9f2c..."."""
Sha256Hash = Annotated[JsonText, Field(pattern=r"^sha256:[0-9a-f]{64}$")]


"""A digest carrying its own algorithm prefix, e.g. "blake2s:3f9a..." or "sha256:...". The prefix
is mandatory so that changing the hash function is a visible, migratable event rather than a
silent reinterpretation of existing bytes. The hex body is bounded to 16-128 characters
(64-512 bits) so that a one-digit string like "x:0" cannot pose as a digest.
"""
AlgoPrefixedHash = Annotated[JsonText, Field(pattern=r"^[a-z0-9]+:[0-9a-f]{16,128}$")]


class ParserInfo(_Model):
    """Exactly which software produced this generation. Required so that a re-parse is
    reproducible, so a regression can be attributed, and so parser choice stays a swappable
    implementation detail behind an adapter.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "profile",
        }
    )

    #: Parser/adapter name, e.g. "pdfium-deterministic" or "docling".
    name: JsonText = Field(min_length=1)
    #: Parser version string, e.g. "2.14.0".
    version: JsonText = Field(min_length=1)
    #: Digest of the full effective parser configuration. Two generations with the same source_hash,
    #: name, version and config_hash must be byte-identical; this is what makes the "re-parsing is a
    #: no-op" acceptance criterion checkable.
    config_hash: AlgoPrefixedHash
    #: Optional named preset, e.g. "born-digital-fast" or "scanned-ocr". Absent when no preset was
    #: used.
    profile: JsonText | None = Field(default=None, min_length=1)
    #: RFC 3339 timestamp of when this generation was produced.
    #:
    #: THIS FIELD IS EXCLUDED FROM THE DETERMINISM COMPARISON. "Re-parsing produces byte-identical
    #: PaperIR" (research/build/README.md definition-of-done #1, worker/determinism.spec) is defined
    #: as byte-identity of the canonical JSON serialisation AFTER REMOVING parser.parsed_at — it is
    #: a wall-clock reading and no two parses can agree on it. Everything else must match exactly,
    #: and paper_id is held fixed per source_hash so it is not a source of nondeterminism either.
    #: See DESIGN.md §7.1 for the full definition; Epic 1 must not read the criterion literally and
    #: conclude it is unachievable.
    parsed_at: Annotated[JsonText, AfterValidator(_date_time)]


"""Lifecycle of this parse generation. "partial" is a FIRST-CLASS STATE, not an error: a reader
can open the paper while pages 12-14 are still in vision repair. This is the direct
replacement for a pipeline that blocked an HTTP request for up to 450 s (findings.md C1).

ADR-001 also lists "pending" and "parsing". THEY ARE DELIBERATELY ABSENT HERE. A PaperIR
document requires a fully-populated ParserInfo (including config_hash and parsed_at) and a
DocumentConfidence; at upload time none of those exist, so a "pending" PaperIR document could
only be produced by fabricating them — which is precisely the failure class this schema exists
to prevent (findings.md: title = the uploaded filename). pending/parsing are JOB states: they
live in the `papers` and `jobs` tables in packages/db, and the first PaperIR document for a
generation is written when there is something real to write.
"""
PaperStatus = Literal["partial", "complete", "failed"]


"""Block identity: "blk_" + 16 characters of lowercase RFC 4648 base32 (80 bits).

Block ids are CONTENT-DERIVED, not positional and not random: a digest over the paper's
source_hash, page index, quantised top-left anchor, block type and a normalised text prefix.
Same PDF + same parser => same ids, so re-parsing is a no-op and a highlight anchored to a
block survives it. Only the STRING SHAPE is frozen by this schema, and only the string shape
is anything a consumer may depend on.

The derivation is settled by ADR-001 Amendment 1 (2026-07-30, resolved by measurement):
SHA-256 over source_hash | page_index | q(x0) | q(y0) | block_type | normalise(text)[:8],
quantiser q(v) = floor(v/1.0 + 0.5) emitted as an integer bucket index on a 1.0 pt grid,
ANCHOR geometry only (x1/y1 deliberately not hashed), RFC 4648 base32 LOWERCASED and truncated
to 16 characters. The 427 normative conformance vectors live at
conformance/identity-vectors.json and every one of them validates against the pattern above.

Ids are mostly-stable, not perfectly stable, and the measurement quantified how far from
perfect: 42.2% of ids do not survive a paragraph-merge segmentation change, and because only
the top-left anchor is hashed, 11.7% of the ids that DO survive land on a block whose text has
changed. Block.content_hash detects 100% of those (measured, not assumed). That is why block
ids are only tier 1 of anchoring, why the multi-selector anchor (ADR-004) is mandatory, and
why a tier-1 hit MUST be confirmed against content_hash before it is trusted.
"""
BlockId = Annotated[JsonText, Field(pattern=r"^blk_[a-z2-7]{16}$")]


"""A confidence in [0, 1]. Uncertainty is represented explicitly everywhere it exists: the
product must be able to say "we are not sure about this equation" instead of confidently
rendering garbage. 1.0 is a legitimate value for facts read directly out of a born-digital
text layer.
"""
Confidence = Annotated[float, Field(allow_inf_nan=False, ge=0, le=1)]


class MetadataValue(_Model):
    """A metadata STRING together with the block it was read from and how sure we are. Never a
    bare string.

    source_block_id is REQUIRED, so a metadata value that cannot point at a real block is
    unrepresentable. This is the schema-level answer to findings.md: the live system sets
    title = os.path.splitext(file.filename)[0] — the uploaded filename — and there is nowhere
    in PaperIR to put a value with no source.
    """

    #: The value, as read from the source block. It must be EXTRACTED OR TRANSCRIBED from that
    #: block, never composed, cleaned up or reworded: semantic rule 6b requires the normalised value
    #: to be a substring of the normalised text of source_block_id. Requiring the citation alone was
    #: not enough — a pipeline that reads a real title block and then asks a model to "tidy" the
    #: title produces a valid document with a plausible source_block_id attached.
    value: JsonText
    #: The block this value was read from. Must resolve to a block in Paper.blocks (semantic
    #: validator).
    source_block_id: BlockId
    confidence: Confidence


class AbstractRef(_Model):
    """The abstract is not copied into metadata — it is a POINTER at the blocks that are the
    abstract. Copying would create a second representation that drifts from the first, which
    is the failure mode this whole rewrite exists to remove.
    """

    #: The blocks constituting the abstract, in reading order.
    block_ids: list[BlockId] = Field(min_length=1)
    confidence: Confidence


class MetadataYear(_Model):
    """A metadata INTEGER (publication year) with the same provenance requirement as
    MetadataValue: value, source_block_id, confidence.
    """

    #: The year, as read from the source block.
    value: JsonInt
    source_block_id: BlockId
    confidence: Confidence


class Metadata(_Model):
    """Document-level bibliographic metadata. EVERY field is either a provenance-carrying value
    object or explicitly null: all keys are required so that "we looked and found nothing" is
    stated rather than silently omitted, and so there is exactly one encoding of absence.
    """

    #: The paper's title, read from a block of type "title". Null if no title block was identified.
    title: MetadataValue | None
    #: One entry per author, each read from a source block. Empty when no author block was
    #: identified.
    authors: list[MetadataValue]
    #: Pointer at the abstract blocks. Null if no abstract was identified.
    abstract: AbstractRef | None
    #: DOI as printed in the paper, with its source block. Null if not found. A DOI resolved from an
    #: external service is NOT a PaperIR fact — it has no source block — and belongs outside this
    #: document.
    doi: MetadataValue | None
    #: arXiv identifier as printed in the paper (usually the margin stamp), with its source block.
    #: Null if not found.
    arxiv_id: MetadataValue | None
    #: Publication venue as printed in the paper, with its source block. Null if not found.
    venue: MetadataValue | None
    #: Publication year as printed in the paper, with its source block. Null if not found.
    year: MetadataYear | None


"""Page identity: "pg_" + 16 characters of lowercase RFC 4648 base32."""
PageId = Annotated[JsonText, Field(pattern=r"^pg_[a-z2-7]{16}$")]


"""An axis-aligned bounding box [x0, y0, x1, y1] in PDF user space, origin top-left, with x0 <=
x1 and y0 <= y1. Wherever a bbox accompanies a polygon it is a DERIVED CONVENIENCE and must
equal the polygon's extent exactly; JSON Schema cannot express that, so it is enforced by the
semantic validator (see DESIGN.md §Semantic validator).
"""
BBox = Annotated[
    list[Annotated[float, Field(allow_inf_nan=False, ge=-20000, le=20000)]],
    Field(min_length=4, max_length=4),
]


class ImageRef(_Model):
    """A pointer to a rendered raster of a region of the source, held in object storage. The
    image is GROUND TRUTH: for equations and figures it is retained even when LaTeX or vector
    extraction succeeds, because the LaTeX is an interpretation and the crop is the paper.
    When latex_confidence is low the UI shows the crop and offers the LaTeX as "our reading".
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "scale",
            "dpi",
            "rendered_from",
        }
    )

    #: Opaque storage URI with an explicit scheme, e.g. "r2://papers/ppr_.../pages/000@2x.webp". The
    #: scheme pattern is load-bearing: it rejects "data:" and every other inline scheme, so PaperIR
    #: provably never embeds pixel bytes. Resolution is the storage layer's business.
    uri: JsonText = Field(
        pattern=r"^[a-z][a-z0-9+.\-]*://[^"
        r"\t\n\v\f\r\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
        r"]+$",
        min_length=1,
    )
    #: Render scale relative to PDF user space, e.g. 2.0 for a 2x raster. Needed to map image pixels
    #: back to points.
    scale: float | None = Field(default=None, allow_inf_nan=False, gt=0, le=64)
    #: Effective dots per inch of the render.
    dpi: float | None = Field(default=None, allow_inf_nan=False, gt=0, le=4800)
    #: What was rasterised: an embedded raster image, vector drawing operations, or a crop of the
    #: rendered page.
    rendered_from: Literal["raster", "vector", "page"] | None = Field(default=None)


class Flows(_Model):
    """The page's TOP-LEVEL blocks partitioned into independent reading orders, one array per
    Flow value, each in ascending Block.order. All six keys are required (an empty array means
    "this page has no top-level blocks in that flow") so consumers never have to distinguish
    absent from empty.

    NESTED blocks — those whose parent_id names a block that is NOT a heading (see
    $defs/KnownHeadingBlockType) — are DELIBERATELY NOT LISTED HERE. They appear in
    Page.block_ids and are reached through their container's child_ids. This is what keeps
    Docling's 342 cells on a single ResNet table out of the body reading order: without it,
    "read the document" would mean reading a table cell by cell, and every consumer of
    doc_order (Guided view, TTS, get_adjacent_blocks) would inherit that. See DESIGN.md §4
    D14.

    Every id listed here must belong to a top-level block whose page_index is this page's
    index and whose flow is the corresponding key (semantic validator rule 11).
    """

    #: The main prose/float stream.
    body: list[BlockId]
    #: Figure and table captions.
    caption: list[BlockId]
    #: Footnotes, in their own order.
    footnote: list[BlockId]
    #: Running heads.
    header: list[BlockId]
    #: Running feet and page numbers.
    footer: list[BlockId]
    #: Margin notes and publisher stamps (e.g. the arXiv margin stamp).
    margin: list[BlockId]


class Page(_Model):
    """One page of the PDF, carrying every fact needed to place blocks on it and to render it at
    any zoom without re-consulting the PDF.
    """

    page_id: PageId
    #: 0-based page index. Unique within the document (semantic validator). Note that page
    #: boundaries are NOT semantic section boundaries — an outline keyed on page index is the
    #: anti-requirement recorded in findings.md C3.
    index: JsonInt = Field(ge=0)
    #: Page width in points, POST-rotation — i.e. the width of the space the polygons live in. Must
    #: equal crop_box[2] - crop_box[0] (semantic validator rule G4); that identity is the cheapest
    #: available coordinate-space sanity check.
    width: float = Field(allow_inf_nan=False, gt=0, le=20000)
    #: Page height in points, POST-rotation. Must equal crop_box[3] - crop_box[1] (rule G4).
    height: float = Field(allow_inf_nan=False, gt=0, le=20000)
    #: The page's /Rotate value, recorded for auditability. It has ALREADY been applied to width,
    #: height and every polygon on this page; a consumer must not apply it again.
    rotation: Annotated[JsonInt, AfterValidator(_one_of((0, 90, 180, 270)))]
    #: The PDF /UserUnit. Recorded because a page with user_unit != 1 scales points to physical
    #: size, and the geometry library must round-trip it. Bounded so that 0, a negative, a denormal
    #: and Infinity are all rejected.
    user_unit: float = Field(allow_inf_nan=False, ge=0.001, le=1000)
    #: The page's CropBox expressed in THIS DOCUMENT'S coordinate space — normalised, top-left
    #: origin, post-rotation — not as the raw PDF array. RESOLVED CONVENTION (ADR-001 implies it;
    #: this schema states it): block geometry is expressed relative to the CropBox origin, therefore
    #: crop_box is ALWAYS [0, 0, page.width, page.height]. Semantic validator rule G4 enforces
    #: exactly that, which is what turns "we normalised the geometry" from a claim into a check.
    #: Getting this wrong silently offsets every polygon on the (common) pages where CropBox !=
    #: MediaBox, so F0.4's geometry library must encode it and geometry.spec must cover CropBox !=
    #: MediaBox.
    crop_box: BBox
    #: The page's MediaBox in the same normalised, top-left, post-rotation space as crop_box.
    #: Because geometry is CropBox-relative, media_box coordinates are frequently NEGATIVE (the
    #: media box extends above/left of the crop box) and that is correct, not an error. Retained
    #: because CropBox != MediaBox is common and the transform must be reproducible.
    media_box: BBox
    #: A rendered raster of the whole page, or null if none has been produced yet.
    #: Required-and-nullable so "not rendered yet" is explicit.
    image: ImageRef | None
    #: Whether the page carries an extractable text layer.
    has_text_layer: bool
    #: Whether the page is a scanned image requiring OCR. Distinct from has_text_layer: a scan may
    #: carry a bad OCR text layer already.
    is_scanned: bool
    #: EVERY block on this page, regardless of flow and including nested blocks (table cells, list
    #: items). Must exactly match the set of blocks whose page_index equals this page's index
    #: (semantic validator rule 10).
    block_ids: list[BlockId]
    flows: Flows
    #: Confidence in this page's extraction as a whole.
    confidence: Confidence


"""An [x, y] point in PDF user space (points), origin top-left. Both coordinates are bounded to
±20000 pt (≈278 inches, far beyond any real page) so that a JSON literal such as 1e400 — which
parses to Infinity, satisfies exclusiveMinimum:0, and then re-serialises as null — cannot
enter the document. A value that validates must survive a serialisation round-trip; that is a
precondition of "re-parsing produces byte-identical PaperIR".
"""
Point = Annotated[
    list[Annotated[float, Field(allow_inf_nan=False, ge=-20000, le=20000)]],
    Field(min_length=2, max_length=2),
]


"""A region as a polygon in PDF user space, origin top-left. Minimum 3 vertices, maximum 512; NOT
closed — do not repeat the first point. Polygons rather than rectangles because a text
selection spanning lines in a two-column layout is not a rectangle, and flattening it to a
bounding box is exactly what makes highlights bleed across columns. Positive area and a
non-self-intersecting ring are semantic-validator rules (G5/G6): JSON Schema can bound the
vertex count but not the shape.
"""
Polygon = Annotated[list[Point], Field(min_length=3, max_length=512)]


"""Which independent reading order a block belongs to. CLOSED vocabulary, deliberately: unlike
block/relation types, adding a flow changes what "read the document" means for every consumer
and is a breaking change.

Footnotes, captions and page furniture get their own orders rather than being spliced into the
body stream (ADR-001 Commitment 3, after PDF-to-Tree). This is what lets the reader run the
body continuously while still knowing exactly where footnote 3 sits on the page, and what
keeps running heads and arXiv margin stamps out of the prose — the failure measured in
findings.md B6.
"""
Flow = Literal["body", "caption", "footnote", "header", "footer", "margin"]


class Span(_Model):
    """Character-level geometry inside a block's text: the unit a highlight snaps to. A span maps
    a half-open character range [start, end) of Block.text onto a box on the page, so a
    selection of part of a paragraph has real coordinates instead of viewport pixels.

    OFFSETS INDEX Block.text AS STORED — that is, POST-APPLIED-REPAIR. So does Repair.at.
    Exactly one string is addressable in this schema and every offset in it means the same
    thing; the alternative (spans measured against the raw glyph stream, repairs against a
    different one) drifts every tier-1 anchor after offset 0 by the cumulative length delta of
    the applied repairs, and the drift is invisible until a highlight lands a word off.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "role",
            "block_id",
            "font",
            "size",
        }
    )

    #: Inclusive start offset into Block.text as stored (post-applied-repair), in Unicode code
    #: points.
    start: JsonInt = Field(ge=0)
    #: Exclusive end offset into Block.text. Must satisfy start < end <= len(text), and spans must
    #: not overlap (semantic validator).
    end: JsonInt = Field(ge=0)
    #: The box covering this character range.
    bbox: BBox
    #: What this character range IS, when it is not ordinary prose: "inline_equation", "citation",
    #: "footnote_marker", "code", .... An OPEN vocabulary, like Block.type. Absent means ordinary
    #: text.
    #:
    #: This exists because inline math and inline citation markers are the majority of real math and
    #: the unit resolve_citation needs, and the only alternatives were both failures already
    #: measured: fragment the paragraph into three blocks (the shredding of findings.md B1 — Neural
    #: ODEs' median text block was 59 characters), or lose the location entirely.
    role: JsonText | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{0,63}$")
    #: The block this span corresponds to, when the span's role names a construct that is ALSO a
    #: block — e.g. an inline_equation span pointing at the inline_equation block that carries the
    #: LaTeX and the crop. Absent otherwise. This is how "this inline equation occupies characters
    #: 45-58 of paragraph X" becomes expressible without fragmenting X.
    block_id: BlockId | None = Field(default=None)
    #: Font name as recorded in the PDF, e.g. "NimbusRomNo9L-Regu". Absent when unknown. Retained
    #: for evidence, NOT as a classifier: font-driven math detection is what made 36.9% of ResNet's
    #: blocks false-positive math (findings.md B1).
    font: JsonText | None = Field(default=None, min_length=1)
    #: Font size in points. Absent when unknown.
    size: float | None = Field(default=None, allow_inf_nan=False, gt=0, le=2000)


"""How this block's content was obtained from the PDF. CLOSED vocabulary with NO model/LLM value,
and that absence is the point: the line is TRANSCRIPTION vs GENERATION. "ocr" transcribes a
region of the source and is legitimate; an LLM generating prose is not, and has no value it
could be recorded under. Combined with "additionalProperties": false everywhere, this makes
AI-authored source text unrepresentable rather than merely discouraged.

- pdf_text_layer: characters read from the PDF's own text layer.
- pdf_vector: derived from vector drawing operations (the property the previous extractor was
blind to — findings.md B3: every ResNet figure is a vector drawing and zero were extracted).
- pdf_raster: derived from an embedded raster image.
- ocr: transcribed from a rendered region by an OCR engine.

A model's READING of a region is not a source; it is a proposed Repair (see $defs/Repair) or
an Alternative, stored alongside the original and never in place of it.
"""
SourceKind = Literal["pdf_text_layer", "pdf_vector", "pdf_raster", "ocr"]


class Provenance(_Model):
    """Which component of the pipeline produced this block, and what it called the block itself.
    Kept so that a bad block can be attributed to a stage, and so a parser upgrade can be
    diffed stage by stage.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "native_id",
        }
    )

    #: The component that emitted this block, e.g. "pdfium-deterministic", "docling", "tatr". May
    #: differ from Paper.parser.name when a specialist model handled a flagged region.
    parser: JsonText = Field(min_length=1)
    #: The pipeline stage, e.g. "layout+text", "table-structure", "formula-recognition".
    stage: JsonText = Field(min_length=1)
    #: The upstream tool's own identifier for this object, e.g. Docling's "#/texts/47". Recorded for
    #: debugging and for adapter round-tripping ONLY. It is deliberately NOT PaperTree's identity:
    #: positional pointers break on every re-parse, which is the concrete reason PaperIR mints its
    #: own content-derived ids.
    native_id: JsonText | None = Field(default=None, min_length=1)


"""The kind of modification a Repair records.

DETERMINISTIC (may be applied): dehyphenate, ligature, unicode_normalise, whitespace, reorder.
These are rule-based, reproducible and reviewable.

MODEL-AUTHORED (must NOT be applied): ocr_correction, vlm_substitution. A model's reading of a
region is a PROPOSAL. Block.text keeps the original; the proposal sits in Repair.to and the UI
can offer "this region was reconstructed" without ever silently replacing the paper.
"""
RepairKind = Literal[
    "dehyphenate",
    "ligature",
    "unicode_normalise",
    "whitespace",
    "reorder",
    "ocr_correction",
    "vlm_substitution",
]


class Repair(_Model):
    """One recorded modification of source text — never a silent fix. The original always
    survives in "from".

    This exists because the previous code failed the rule twice: _clean_text rewrote U+2212
    MINUS SIGN to an ASCII hyphen in the same table as ligature repair (destroying
    mathematical content, findings.md B7), and the LLM path silently discarded the middle of
    any page over 5,000 characters (C6). Both would now have to be expressed as a Repair or
    not happen at all.

    Repairs are split into APPLIED and PROPOSED by the required "applied" flag. When applied
    is true, Block.text already contains "to" and "from" preserves what was replaced. When
    applied is false, Block.text still contains "from" and "to" is only a proposal awaiting
    acceptance.

    TWO if/then branches, mirror images of each other, carry the safety property:
    • A MODEL-AUTHORED kind (ocr_correction, vlm_substitution) must have applied:false and
    MUST name its model_id and prompt_hash. This is ADR-001's "the LLM never overwrites
    source; it proposes a repair that is stored alongside the original ... the model and
    prompt hash are recorded", in full, as a schema constraint.
    • A DETERMINISTIC kind (dehyphenate, ligature, unicode_normalise, whitespace, reorder) MAY
    be applied and MUST NOT carry model_id or prompt_hash. Without this branch,
    {kind:"dehyphenate", applied:true, model_id:"gpt-4o", to:"<model prose>"} validates — an
    openly model-stamped rewrite of source, through a category whose entire justification is
    that it is rule-based and reproducible. Semantic rule 30b closes the remaining half by
    checking that from→to is actually an edit of the declared class.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "at",
            "model_id",
            "prompt_hash",
            "confidence",
        }
    )

    kind: RepairKind
    #: Whether this repair has been applied to Block.text. Forced to false for model-authored kinds
    #: (see the if/then below).
    applied: bool
    #: Character offset into Block.text AS STORED at which this repair sits: for applied:true, the
    #: offset at which "to" now appears; for applied:false, the offset at which "from" still
    #: appears. Absent for repairs with no single offset, e.g. reorder. Offsets in this schema index
    #: exactly one string — see $defs/Span.
    at: JsonInt | None = Field(default=None, ge=0)
    #: The original source text. This field is the whole point of the mechanism: it is never
    #: overwritten, and an empty string is a legitimate value (a pure insertion).
    from_: JsonText = Field(alias="from")
    #: The repaired or proposed replacement text. An empty string is a legitimate value (a pure
    #: deletion).
    to: JsonText
    #: Identifier of the model that proposed this repair. REQUIRED for ocr_correction and
    #: vlm_substitution and FORBIDDEN for deterministic kinds (see the if/then branches below).
    model_id: JsonText | None = Field(default=None, min_length=1)
    #: Digest of the exact prompt that produced the proposal, so it is reproducible and auditable.
    #: Required for model-authored kinds, forbidden for deterministic ones.
    prompt_hash: AlgoPrefixedHash | None = Field(default=None)
    #: How sure the proposer is. Absent for deterministic kinds, which are certain by construction.
    confidence: Confidence | None = Field(default=None)

    @model_validator(mode="after")
    def _check_conditional_branches(self) -> Self:
        """The schema's `allOf`/`if`/`then` branches.

        A model validator rather than a discriminated union, because the discriminator is an
        OPEN string (DESIGN.md §6): a tagged union would have to enumerate it and would then
        reject the unknown types that forward compatibility requires to validate.
        """
        if self.kind in ("ocr_correction", "vlm_substitution"):
            if self.model_id is None:
                raise ValueError(f"model_id is required for kind={self.kind!r}")
            if self.prompt_hash is None:
                raise ValueError(f"prompt_hash is required for kind={self.kind!r}")
            if self.applied is not False:
                raise ValueError(f"applied must be false for kind={self.kind!r}")
        if self.kind in ("dehyphenate", "ligature", "unicode_normalise", "whitespace", "reorder"):
            if self.model_id is not None:
                raise ValueError(f"model_id is forbidden for kind={self.kind!r}")
            if self.prompt_hash is not None:
                raise ValueError(f"prompt_hash is forbidden for kind={self.kind!r}")
        return self


class Alternative(_Model):
    """A competing reading of the same block from a different parser, retained WITH the rule that
    decided between them. When two parsers disagree, both survive and the decision is
    auditable rather than lost.

    An Alternative is EVIDENCE, never content. `authored_by` is required and a model-authored
    alternative is pinned to decision:"not_selected" — the exact mirror of Repair's
    applied:false constraint, and for the same reason. Without it, a block could carry
    text:"<model prose>" with a selected alternative from "openai/gpt-4o" saying the same
    thing, and every check would pass: the semantic rule that a selected alternative's text
    equals block.text is satisfied BECAUSE the model's reading is what the reader sees. That
    was the last channel through which model text could sit inside a Paper without an explicit
    "this is not what you are reading" flag next to it.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "text",
            "rule",
        }
    )

    #: The parser or repair stage that produced this reading, e.g. "docling", "vlm-repair".
    parser: JsonText = Field(min_length=1)
    #: Whether this reading came from a deterministic parser or from a model. CLOSED, with no third
    #: option. "model" forces decision:"not_selected" (see the if/then below): a model may argue
    #: about what a region says, and its argument is kept, but it may never BE the reading the
    #: reader sees.
    authored_by: Literal["parser", "model"]
    #: This parser's reading of the block's text. Absent when the disagreement is not about text.
    #: For a selected alternative this must equal Block.text (semantic rule 31); for a
    #: model-authored one it is by construction not selected, so it is never what renders.
    text: JsonText | None = Field(default=None)
    confidence: Confidence
    #: Whether this reading won. Exactly one alternative may be "selected" (semantic validator).
    decision: Literal["selected", "not_selected"]
    #: The named reconciliation rule that produced the decision, e.g.
    #: "prefer_native_text_when_delta<0.2". Recording the rule is what makes the choice reviewable
    #: instead of a black box.
    rule: JsonText | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _check_conditional_branches(self) -> Self:
        """The schema's `allOf`/`if`/`then` branches.

        A model validator rather than a discriminated union, because the discriminator is an
        OPEN string (DESIGN.md §6): a tagged union would have to enumerate it and would then
        reject the unknown types that forward compatibility requires to validate.
        """
        if self.authored_by == "model":
            if self.decision != "not_selected":
                raise ValueError(
                    f"decision must be not_selected for authored_by={self.authored_by!r}"
                )
        return self


class EquationSymbol(_Model):
    """A symbol occurring in an equation, linked to the block that defines it. definition_block
    is REQUIRED: a symbol whose definition cannot be pointed at a real block is
    unrepresentable, mirroring the rule for metadata values. Note that a natural-language
    GLOSS of a symbol is model-authored explanation and belongs in a Derivation, not here (see
    DESIGN.md §Deviations).
    """

    #: The symbol as it appears, e.g. "\\mathcal{F}".
    symbol: JsonText = Field(min_length=1)
    #: The block in which this symbol is defined.
    definition_block: BlockId


class EquationPayload(_Model):
    """Block.payload for type "equation" AND type "inline_equation". The rendered crop is the
    ground truth; latex and mathml are interpretations of it, each with their own confidence.
    The crop is required-and-nullable so that "detected but not yet rendered" is statable, and
    so an inline equation that has not been cropped is expressible.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "equation_number",
            "latex",
            "latex_confidence",
            "mathml",
            "symbols",
            "referenced_by",
        }
    )

    #: True for display (set-off) math, false for math typeset inline. Must be false when the
    #: block's type is "inline_equation" (semantic rule 39). The distinction matters because inline
    #: math is a genuinely unsolved recognition problem and is the majority of real math, while
    #: display math is largely solved — a consumer must be able to tell which regime a result came
    #: from.
    display: bool
    #: The equation number as printed, e.g. "3". A string, not an integer: papers number equations
    #: "A.2", "3a", "(iv)".
    equation_number: JsonText | None = Field(default=None, min_length=1)
    #: The recognised LaTeX. An INTERPRETATION of the image, never a replacement for it. Absent when
    #: recognition was not attempted or produced nothing.
    latex: JsonText | None = Field(default=None)
    #: Confidence in the LaTeX specifically, held separately from the block's confidence because the
    #: region can be certain while its reading is not. When this is low the UI shows the crop and
    #: labels the LaTeX "our reading".
    latex_confidence: Confidence | None = Field(default=None)
    #: MathML rendering, for the audiobook's speech-rule engine. Also an interpretation.
    mathml: JsonText | None = Field(default=None)
    #: The rendered source region, or NULL if it has not been produced yet. REQUIRED-AND-NULLABLE,
    #: mirroring Page.image, because parsing is a durable multi-step job: detecting the region and
    #: rendering the crop are different steps, and between them the region exists but the raster
    #: does not. A non-nullable image would leave an adapter three moves — invent a URI, drop the
    #: region, or emit it as "unknown" — all of which destroy the fact that was correctly extracted.
    #: Semantic rule 36 requires it non-null when Paper.status is "complete", which is where
    #: ADR-001's "always retained" actually bites.
    image: ImageRef | None
    #: Symbols linked to their defining blocks. Omitted entirely when empty — an empty array is not
    #: a valid encoding, so there is exactly one way to say "none".
    symbols: list[EquationSymbol] | None = Field(default=None, min_length=1)
    #: Blocks that refer to this equation. A denormalised convenience over the inverse of the
    #: "references" relation; the relations array is authoritative.
    referenced_by: list[BlockId] | None = Field(default=None, min_length=1)


class FigurePanel(_Model):
    """A labelled sub-panel of a multi-part figure, e.g. "(a)", so a citation can point at a
    panel rather than the whole figure. A panel label is transcribed text, so it carries the
    same required `source` and `confidence` as DetectedLabel.
    """

    #: The panel label as printed, e.g. "(a)".
    label: JsonText = Field(min_length=1)
    #: The panel's region.
    polygon: Polygon
    #: How the panel label was obtained.
    source: SourceKind
    confidence: Confidence


class DetectedLabel(_Model):
    """Text found INSIDE a figure, e.g. "conv 3x3" on an architecture diagram, with its own
    geometry. Kept separate from blocks so that diagram interior text is searchable without
    being promoted into the reading order — promoting it is exactly how the previous extractor
    produced headings like "T[SEP]" and "BUFFER" (findings.md B6).

    `source` and `confidence` are REQUIRED for the same reason they are required on a Block:
    reading text off a VECTOR diagram is precisely the job that gets handed to a VLM, and a
    required-minLength string with no source field would be a transcription surface exempt
    from the rule the rest of the page obeys. SourceKind has no model value here either.
    """

    #: The label text, transcribed from the source.
    text: JsonText = Field(min_length=1)
    #: The label's region.
    polygon: Polygon
    #: How this label was obtained. Same closed transcription vocabulary as Block.source.
    source: SourceKind
    confidence: Confidence


class FigurePayload(_Model):
    """Block.payload for type "figure". The rendered crop is the ground truth for a figure
    exactly as it is for an equation, and is required-and-nullable for the same reason.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "figure_number",
            "figure_kind",
            "caption_block",
            "panels",
            "detected_labels",
            "referenced_by",
        }
    )

    #: The figure number as printed, e.g. "2". A string for the same reason as equation_number.
    figure_number: JsonText | None = Field(default=None, min_length=1)
    #: Free-form sub-classification of the figure, e.g. "diagram", "plot", "photo", "schematic".
    #: Open on purpose: it is a hint for the UI, not a contract.
    figure_kind: JsonText | None = Field(default=None, min_length=1)
    #: Whether the figure CONTAINS VECTOR DRAWING OPERATIONS. REQUIRED because this is precisely the
    #: property the previous extractor was blind to: it called page.get_images() only, so every
    #: ResNet figure — all vector — was invisible and 0 of 4 figures were extracted (findings.md
    #: B3).
    #:
    #: Deliberately NOT synchronised with Block.source. `source` names the DOMINANT extraction path;
    #: `is_vector` names a property of the figure's content. A matplotlib plot with an embedded
    #: raster inside vector axes is common and has an honest answer for both (source: pdf_raster or
    #: pdf_vector by dominance, is_vector: true), which a consistency rule between them would have
    #: made unrepresentable.
    is_vector: bool
    #: The rendered source region, or NULL if it has not been produced yet. REQUIRED-AND-NULLABLE,
    #: mirroring Page.image, because parsing is a durable multi-step job: detecting the region and
    #: rendering the crop are different steps, and between them the region exists but the raster
    #: does not. A non-nullable image would leave an adapter three moves — invent a URI, drop the
    #: region, or emit it as "unknown" — all of which destroy the fact that was correctly extracted.
    #: Semantic rule 36 requires it non-null when Paper.status is "complete", which is where
    #: ADR-001's "always retained" actually bites.
    image: ImageRef | None
    #: The caption block for this figure. Must reference a block of type "caption" (semantic
    #: validator). Denormalised inverse of the caption_of relation, which remains authoritative.
    caption_block: BlockId | None = Field(default=None)
    #: Sub-panels, when the figure has them. Omitted when there are none.
    panels: list[FigurePanel] | None = Field(default=None, min_length=1)
    #: Text found inside the figure. Omitted when there is none.
    detected_labels: list[DetectedLabel] | None = Field(default=None, min_length=1)
    #: Blocks that refer to this figure. Denormalised convenience; relations are authoritative.
    referenced_by: list[BlockId] | None = Field(default=None, min_length=1)


class TableCell(_Model):
    """One cell of a table's grid. Every cell is ALSO a block (of type table_cell) so it can be
    highlighted and cited like anything else; this entry adds the grid coordinates a block
    cannot carry.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "rowspan",
            "colspan",
            "text",
            "is_header",
        }
    )

    #: The table_cell block for this cell.
    cell_id: BlockId
    #: 0-based row index of the cell's top-left corner.
    r: JsonInt = Field(ge=0)
    #: 0-based column index of the cell's top-left corner.
    c: JsonInt = Field(ge=0)
    #: Rows spanned. Absent means 1.
    rowspan: JsonInt | None = Field(default=None, ge=1)
    #: Columns spanned. Absent means 1.
    colspan: JsonInt | None = Field(default=None, ge=1)
    #: The cell's region.
    polygon: Polygon
    #: The cell's text. Denormalised from the cell block for cheap grid rendering; must equal that
    #: block's text (semantic validator).
    text: JsonText | None = Field(default=None)
    #: Whether this cell is a header cell. Absent means false.
    is_header: bool | None = Field(default=None)


class TableGrid(_Model):
    """The logical grid recovered from a table, alongside (never instead of) the geometry of its
    cells.
    """

    #: Number of logical rows.
    rows: JsonInt = Field(ge=0)
    #: Number of logical columns.
    cols: JsonInt = Field(ge=0)
    #: Every cell, in row-major order.
    cells: list[TableCell]


class TablePayload(_Model):
    """Block.payload for type "table". The grid is required; the HTML serialisation is a
    convenience for rendering and for feeding a model, never the canonical form.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "table_number",
            "caption_block",
            "html",
        }
    )

    #: The table number as printed, e.g. "1".
    table_number: JsonText | None = Field(default=None, min_length=1)
    #: The caption block for this table. Must reference a block of type "caption" (semantic
    #: validator).
    caption_block: BlockId | None = Field(default=None)
    grid: TableGrid
    #: An HTML serialisation of the grid, for rendering and for LLM input. DERIVED: it must be the
    #: library's deterministic serialisation of `grid` (semantic rule 32b), not an independent
    #: rendering. A derived field nobody checks is a second representation that drifts, which is the
    #: failure this rewrite exists to remove.
    html: JsonText | None = Field(default=None)


class Block(_Model):
    """The addressable unit of a document: a region of a page with geometry, identity, provenance
    and uncertainty. Everything downstream — highlights, citations, retrieval, narration,
    canvas nodes — anchors to a block.

    NOTE ON SHAPE (deliberate deviation from ADR-001's JSONC sketches): specialised fields for
    equations, figures and tables live in the nested "payload" object rather than being
    hoisted onto the block. With "additionalProperties": false, hoisting would force this base
    definition to enumerate every specialised field of every type and would break cleanly for
    unknown types. The nested payload also maps 1:1 onto the blocks.payload column in the
    physical model. See DESIGN.md §4 D1.

    REQUIRED SET: only what every block must have — identity, type, page, geometry, flow,
    order, source, confidence, provenance. In particular "text" is OPTIONAL, so an "unknown"
    block with geometry and no text is no harder to express than a classified one. That is the
    point: a parser that cannot classify a region must be able to emit it rather than drop it.

    NESTING: a block whose parent_id names a NON-HEADING block (see
    $defs/KnownHeadingBlockType) is NESTED — it ranks by `order` inside its container, has no
    `doc_order`, and is not listed in Page.flows. A block whose parent_id names a heading is
    SECTION content and stays top-level.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "doc_order",
            "parent_id",
            "child_ids",
            "prev_id",
            "next_id",
            "text",
            "text_normalised",
            "content_hash",
            "spans",
            "repairs",
            "alternatives",
            "payload",
        }
    )

    block_id: BlockId
    #: What kind of region this is. ANY IDENTIFIER-SHAPED STRING VALIDATES (^[a-z][a-z0-9_]{0,63}$)
    #: — this is the forward-compatibility mechanism required from v1: adding a block type is a
    #: MINOR version bump, so consumers must tolerate types they have never seen. The known
    #: vocabulary is listed in $defs/KnownBlockType for codegen and documentation; it is not a
    #: constraint.
    #:
    #: The PATTERN is not decoration. Payload constraints below key on the literal strings
    #: "equation", "figure" and "table"; without it, "Equation" and "equation " are near-misses that
    #: silently fall through to the free-form payload branch and evade the required image. Types are
    #: identifiers, not display strings.
    #:
    #: A consumer that meets an unknown type must render it as an unstructured region with its
    #: geometry, exactly as it renders "unknown". Forward compatibility applies to TYPES, not to
    #: FIELDS: unknown fields are rejected everywhere, which is what keeps a producer from bolting
    #: e.g. "generated_by": "gpt-4" onto a block.
    type: JsonText = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$", min_length=1)
    #: 0-based index of the page this block sits on. Must match a Page.index, and that page's
    #: block_ids must contain this block (semantic validator).
    page_index: JsonInt = Field(ge=0)
    #: REQUIRED on every block, including "unknown" ones. Geometry is never discarded: this is the
    #: single fact whose absence blocks every downstream feature (findings.md §A — the live pipeline
    #: produced 99,210 characters and zero addressable objects).
    polygon: Polygon
    #: Axis-aligned extent of "polygon", stored for cheap indexing and hit-testing. Must EQUAL the
    #: polygon's extent; JSON Schema cannot express that relationship, so it is enforced by the
    #: semantic validator and a test.
    bbox: BBox
    flow: Flow
    #: Rank of this block among its SIBLINGS in reading order. Dense and unique within (page_index,
    #: flow, container) — where `container` is the block's nesting parent (a non-heading parent_id),
    #: or the page's top level when it has none (semantic validator rule 14). Ranking within the
    #: container rather than within the page is what lets a table's 342 cells be ordered without
    #: consuming 342 slots of the page's body order.
    order: JsonInt = Field(ge=0)
    #: Rank within the whole BODY flow, across pages — the sequence a continuous reader or an
    #: audiobook follows. Present on EXACTLY the top-level blocks whose flow is "body"; absent for
    #: captions, footnotes, furniture (which have their own flows) and for nested blocks such as
    #: table cells and list items (which are read as part of their container). Unique and dense
    #: across the document (semantic validator rule 15).
    doc_order: JsonInt | None = Field(default=None, ge=0)
    #: Structural parent: the heading block that owns this paragraph (SECTION containment), or the
    #: container block that owns this cell/row/list item (NESTING — see
    #: $defs/KnownHeadingBlockType). Absent when the block is a root. Must agree with the parent_of
    #: relations (semantic validator rule 19).
    parent_id: BlockId | None = Field(default=None)
    #: Structural children, in order. Omitted entirely when there are none — an empty array is not a
    #: valid encoding, so "no children" has exactly one representation and re-parses stay
    #: byte-identical.
    child_ids: list[BlockId] | None = Field(default=None, min_length=1)
    #: Previous SIBLING — the block sharing this block's parent_id and flow, one rank lower. Absent
    #: for the first sibling. Siblings only: a parent is never its child's prev/next, and a child is
    #: never its parent's next. (ADR-001's "left-child/right-sibling" phrasing is ambiguous here;
    #: this schema resolves it as sibling-only, with child_ids carrying descent.)
    prev_id: BlockId | None = Field(default=None)
    #: Next SIBLING in this block's flow, sharing the same parent_id. Absent for the last sibling.
    #: Must be mutually consistent with that block's prev_id (semantic validator rule 18). Siblings
    #: only — see prev_id.
    next_id: BlockId | None = Field(default=None)
    #: The block's text, exactly as obtained from the source named in "source", with any APPLIED
    #: repairs already present (every offset in this schema — Span.start/end, Repair.at — indexes
    #: this string). OPTIONAL: figures, unknown regions and many blocks legitimately have none, and
    #: requiring it would penalise exactly the unclassified regions this schema insists on keeping.
    #:
    #: This string is SOURCE. It is never composed, summarised, translated or completed by a model.
    #: Any change to it must be recorded as an entry in "repairs", and any model-proposed change
    #: must sit there unapplied. Consumers must read it through the library's resolvedText(block,
    #: {applyProposed}) helper rather than reimplementing repair application — see DESIGN.md §4 D4.
    text: JsonText | None = Field(default=None)
    #: Case-, whitespace- and ligature-normalised form of "text", for search and for content-hash
    #: derivation. A derived index, never displayed.
    text_normalised: JsonText | None = Field(default=None)
    #: Digest of the normalised text, e.g. "blake2s:3f9a...". Anchoring tier 2: when a block id
    #: changes across a parser upgrade, an anchor can still find its block by content. Semantic rule
    #: 37 requires it (and text_normalised) whenever text is present and source is "pdf_text_layer"
    #: — tier-2 anchoring cannot be optional on exactly the blocks anchors land on.
    content_hash: AlgoPrefixedHash | None = Field(default=None)
    #: Character-level geometry within "text", in ascending start order. Omitted when unavailable or
    #: when the block has no text.
    spans: list[Span] | None = Field(default=None, min_length=1)
    #: REQUIRED on every block. See $defs/SourceKind: the enum is closed and contains no model or
    #: LLM value, which is what makes AI-authored text in a source field unrepresentable rather than
    #: merely discouraged.
    source: SourceKind
    #: Confidence in this block's extraction and classification.
    confidence: Confidence
    provenance: Provenance
    #: Every modification to source text, recorded rather than applied invisibly. Omitted when there
    #: are none.
    repairs: list[Repair] | None = Field(default=None, min_length=1)
    #: Competing readings from other parsers, with the rule that chose between them. Omitted unless
    #: parsers actually disagreed.
    alternatives: list[Alternative] | None = Field(default=None, min_length=1)
    #: Type-specific extra content. Constrained by the if/then rules below: "equation" requires an
    #: EquationPayload, "figure" a FigurePayload, "table" a TablePayload, and ANY OTHER TYPE —
    #: including types this version has never heard of — an OpaquePayload: open in shape so a future
    #: block type can carry its own data without a major bump, but closed against authorship
    #: declarations at any depth.
    #:
    #: Keeping this nested rather than hoisted onto the block is what lets "additionalProperties":
    #: false hold at the block level while still supporting unknown types.
    payload: dict[str, Any] | None = Field(default=None)

    @model_validator(mode="after")
    def _check_conditional_branches(self) -> Self:
        """The schema's `allOf`/`if`/`then` branches.

        A model validator rather than a discriminated union, because the discriminator is an
        OPEN string (DESIGN.md §6): a tagged union would have to enumerate it and would then
        reject the unknown types that forward compatibility requires to validate.
        """
        if self.type in ("equation", "inline_equation"):
            if self.payload is None:
                raise ValueError(f"payload is required for type={self.type!r}")
            if self.payload is not None:
                EquationPayload.model_validate(self.payload)
        if self.type == "figure":
            if self.payload is None:
                raise ValueError(f"payload is required for type={self.type!r}")
            if self.payload is not None:
                FigurePayload.model_validate(self.payload)
        if self.type == "table":
            if self.payload is None:
                raise ValueError(f"payload is required for type={self.type!r}")
            if self.payload is not None:
                TablePayload.model_validate(self.payload)
        if self.type not in ("equation", "inline_equation", "figure", "table"):
            if self.payload is not None:
                validate_opaque_payload(self.payload)
        return self


class Relation(_Model):
    """A typed, directed, confidence-scored edge between two blocks. Relations are first-class
    rather than implied by array order, so hierarchy, captioning, citation and cross-page
    continuation can each be measured and repaired independently.

    Identity is the tuple (type, from, to) — matching the physical model's primary key — so a
    relation has no id of its own and cannot be duplicated.
    """

    #: The relation type. ANY IDENTIFIER-SHAPED STRING VALIDATES (^[a-z][a-z0-9_]{0,63}$), for the
    #: same forward-compatibility reason as Block.type: adding a relation type is a minor bump and
    #: consumers must tolerate unknown ones. The known vocabulary is in $defs/KnownRelationType, for
    #: codegen and documentation only. A consumer that does not understand a relation type must
    #: preserve it and ignore it, never drop it.
    type: JsonText = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$", min_length=1)
    #: Source endpoint. Must resolve to a block in this document (semantic validator).
    from_: BlockId = Field(alias="from")
    #: Target endpoint. Must resolve to a block in this document (semantic validator).
    to: BlockId
    #: How sure we are that this edge holds. Scored because relations like continues_on_next_page
    #: are inferred, and an inferred edge that cannot be doubted cannot be improved.
    confidence: Confidence
    #: How this edge was derived, e.g. "geometric+numbering", "pdf-outline", "font-cluster". A free
    #: string describing the METHOD — note this is deliberately not the Provenance object used by
    #: Block, because a relation is produced by a rule rather than by a parsing stage.
    provenance: JsonText = Field(min_length=1)


class Section(_Model):
    """One node of the document outline: a materialised view over heading blocks and parent_of
    relations.

    A Section has NO title field. Its title IS the text of its heading block, by construction,
    which makes an LLM-invented section title unrepresentable — the exact failure recorded in
    findings.md C3, where the "semantic outline" was one entry per PDF page named by the
    model. For the same reason a Section has no id of its own: it is identified by its heading
    block.

    FRONT MATTER IS SECTION-LESS, deliberately: title, authors, affiliations and the abstract
    precede the first heading and belong to no Section. Consumers of get_parent_section must
    handle null rather than discovering it at runtime.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "parent_heading_block_id",
        }
    )

    #: The heading block that opens this section. This is the section's identity, and its text is
    #: the section's title. Must resolve to a block whose type is a HEADING TYPE — "heading" or
    #: "title" (semantic rule 21); a paper's title block legitimately opens the document's outermost
    #: section.
    heading_block_id: BlockId
    #: Nesting depth, 1 for a top-level section. Must be consistent with parent_heading_block_id
    #: (semantic validator).
    level: JsonInt = Field(ge=1)
    #: The heading block of the enclosing section. Absent for a top-level section.
    parent_heading_block_id: BlockId | None = Field(default=None)
    #: The blocks belonging to this section, EXCLUDING heading_block_id itself and excluding blocks
    #: belonging to nested sections. Ordered by doc_order where present, otherwise by (page_index,
    #: order) — which is how captions and footnotes, having no doc_order, still get a defined
    #: position in the section they sit in. May be empty for a heading with no content beneath it.
    #: No duplicates (semantic rule 38).
    block_ids: list[BlockId]


class Reference(_Model):
    """One bibliography entry, parsed into fields. A materialised view over a reference_entry
    block.

    The verbatim text of the entry is NOT copied here: it lives in exactly one place, the
    reference_entry block, and duplicating it would create a second representation that
    drifts.

    EVERY FIELD BELOW IS EXTRACTED FROM THAT BLOCK'S TEXT — never fetched from an external
    service and never composed. A citation enriched from Crossref or Semantic Scholar is NOT a
    PaperIR fact, because it has no region of this PDF behind it. Semantic rule 35 enforces
    this by requiring every non-null scalar here to appear in the normalised text of
    reference_entry_block_id: one substring check per field, exactly checkable precisely
    because the verbatim entry is deliberately kept in one place. This is the schema's most
    likely real-world leak — bibliographic enrichment is a normal, well-intentioned feature
    that a future epic will want — so the rule is not optional.
    """

    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(
        {
            "title",
            "authors",
            "year",
            "venue",
            "doi",
            "arxiv_id",
            "url",
        }
    )

    #: The reference_entry block this was parsed from. Identity of the reference; its text is the
    #: verbatim entry.
    reference_entry_block_id: BlockId
    #: Cited work's title, as printed in the entry.
    title: JsonText | None = Field(default=None, min_length=1)
    #: Cited authors, as printed. Omitted when none could be parsed.
    authors: list[Annotated[JsonText, Field(min_length=1)]] | None = Field(
        default=None,
        min_length=1,
    )
    #: Publication year, as printed.
    year: JsonInt | None = Field(default=None)
    #: Venue, as printed.
    venue: JsonText | None = Field(default=None, min_length=1)
    #: DOI, as printed in the entry.
    doi: JsonText | None = Field(default=None, min_length=1)
    #: arXiv identifier, as printed in the entry.
    arxiv_id: JsonText | None = Field(default=None, min_length=1)
    #: URL, as printed in the entry.
    url: JsonText | None = Field(default=None, min_length=1)
    #: Confidence in the field parse of this entry.
    confidence: Confidence


class DocumentConfidence(_Model):
    """Document-level uncertainty rollup, so the UI can route a reader to the weak pages and so a
    partial parse is actionable rather than merely incomplete. `overall` and each entry of
    `by_page` are REQUIRED-AND-NULLABLE: null means "no calibrated estimate exists", which is
    the honest value for a failed parse and for a page still queued for repair. Writing 0
    there would be a fabricated measurement in the field the UI uses to decide whether to
    trust the document. Semantic rule 13b requires them non-null when status is "complete".
    """

    #: Aggregate confidence for the whole document, or null when no calibrated estimate exists
    #: (failed or still-incomplete parse).
    overall: Confidence | None
    #: One entry per page, indexed by page index; null for a page with no calibrated estimate.
    #: Length must equal Paper.pages length (semantic validator rule 13).
    by_page: list[Confidence | None]
    #: Page indices worth surfacing for review, weakest first.
    weakest_pages: list[Annotated[JsonInt, Field(ge=0)]]
    #: Whether a human or a repair pass should look at this document before it is trusted.
    needs_review: bool


class Paper(_Model):
    """The root object: ONE PARSE GENERATION of one PDF. Immutable once written — a re-parse
    produces a new generation alongside the old one (ADR-001 §Versioning and migration), it
    never mutates this one. The pair (paper_id, generation) is this document's identity and is
    the storage key in packages/db; anchors are migrated from generation N to N+1 and the new
    generation is promoted only at ≥99% re-anchor success, which is what makes promotion
    reversible.
    """

    #: Semver of the IR contract this document conforms to. This schema file validates any 1.x
    #: document: a minor bump only adds block/relation types (which are open vocabularies) or
    #: optional fields, so 1.1.0 documents are deliberately accepted here. A 2.x document must NOT
    #: validate against this file — major means geometry semantics, id derivation or field removal
    #: changed, and requires a migration plus a full re-anchor pass.
    ir_version: JsonText = Field(pattern=r"^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
    paper_id: PaperId
    #: SHA-256 of the PDF bytes. This is the content dedup key the product currently lacks
    #: (findings.md D5: two byte-identical PDFs stored twice), and it is an input to content-derived
    #: block ids, which is what ties an id to a specific document.
    source_hash: Sha256Hash
    #: Which parse generation of this paper this document is. 1 for the first parse; a re-parse
    #: writes generation N+1 ALONGSIDE generation N rather than replacing it. Required because
    #: ADR-001's rollback plan is generation-based: without it two generations of the same PDF are
    #: unstorable (papers.source_hash would collide) and content-derived block ids — which are
    #: IDENTICAL for unchanged blocks across generations, that being their whole purpose — collide
    #: outright. Storage keys on (paper_id, generation); blocks on (paper_id, generation, block_id).
    #: WHICH generation is currently promoted is deliberately NOT recorded here: this document is
    #: immutable, and promotion is mutable state owned by packages/db.
    generation: JsonInt = Field(ge=1)
    #: The only coordinate space PaperIR admits: PDF user space (points), origin TOP-LEFT,
    #: normalised exactly once at parse time from the PDF's native bottom-left origin, with
    #: rotation, CropBox/MediaBox and user_unit already applied. Held as a const so that a document
    #: which has not been normalised is unrepresentable and the geometry commitment is
    #: machine-checkable rather than a comment. Viewport pixels and DOM-relative fractions are never
    #: stored — that is precisely the mistake that made existing highlights unrecoverable
    #: (findings.md, read/page.tsx:228).
    coordinate_space: Literal["pdf_user_space_topleft"]
    parser: ParserInfo
    status: PaperStatus
    #: Human-readable explanation when status is "partial" or "failed", e.g. "pages 12-14 low
    #: confidence, vision repair queued". Null otherwise. Required-and-nullable rather than optional
    #: so that "nothing to report" is stated once, in exactly one encoding.
    partial_reason: JsonText | None
    metadata: Metadata
    #: Every page of the PDF, in index order. May be empty only for a failed parse.
    pages: list[Page]
    #: A FLAT array of every block in the document. Hierarchy is expressed by relations and by
    #: parent_id/child_ids, never by nesting — nesting would make a block's address positional, and
    #: positional addresses are exactly why Docling's self_ref (#/texts/47) fails the re-parse
    #: requirement. Nested content (table cells, list items) is in this array too, as ordinary
    #: blocks with a parent_id naming their container — so a cell can be highlighted and cited like
    #: anything else without being spliced into the body reading order.
    blocks: list[Block]
    #: Typed, first-class, confidence-scored edges between blocks. Relations are explicit rather
    #: than implied by array order so that, for example, cross-page paragraph joining
    #: (continues_on_next_page) can be measured and repaired independently.
    relations: list[Relation]
    #: A materialised view over blocks + parent_of relations, for outline rendering and
    #: structure-aware retrieval. Derived, never authoritative: if it disagrees with the blocks, the
    #: blocks win and the view is rebuilt.
    sections: list[Section]
    #: A materialised view over the reference_entry blocks: the bibliography, parsed into fields.
    #: Derived, never authoritative.
    references: list[Reference]
    confidence: DocumentConfidence


class KnownBlockType(StrEnum):
    """The known block-type vocabulary from ADR-001, identical to the benchmark's gold vocabulary
    so that parser output and gold data compare directly.

    THIS DEFINITION IS NOT REFERENCED BY Block.type AND IS NOT A VALIDATION CONSTRAINT. It
    exists so codegen can emit a KnownBlockType union and an isKnownBlockType() guard, and so
    a human reading the schema knows what to expect. Block.type is any string: a v1 consumer
    MUST tolerate a type it has never seen (ADR-001 §Versioning: adding a block type is a
    MINOR bump, which requires that unknown types validate).

    "unknown" is mandatory and load-bearing. A parser that cannot classify a region emits
    "unknown" WITH GEOMETRY INTACT rather than dropping the region (PDF-to-Tree's
    connect_orphans discipline); the UI surfaces it as "unstructured region". Nothing in this
    schema makes an unknown block harder to express than a classified one — in particular,
    text is optional on every block.
    """

    TITLE = "title"
    AUTHOR = "author"
    AFFILIATION = "affiliation"
    ABSTRACT = "abstract"
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST = "list"
    LIST_ITEM = "list_item"
    EQUATION = "equation"
    INLINE_EQUATION = "inline_equation"
    FIGURE = "figure"
    DIAGRAM = "diagram"
    PLOT = "plot"
    TABLE = "table"
    TABLE_ROW = "table_row"
    TABLE_CELL = "table_cell"
    ALGORITHM = "algorithm"
    CODE = "code"
    CAPTION = "caption"
    FOOTNOTE = "footnote"
    CITATION = "citation"
    REFERENCE_ENTRY = "reference_entry"
    HEADER = "header"
    FOOTER = "footer"
    PAGE_NUMBER = "page_number"
    MARGIN_NOTE = "margin_note"
    ANNOTATION = "annotation"
    UNKNOWN = "unknown"


KNOWN_BLOCK_TYPES: frozenset[str] = frozenset(member.value for member in KnownBlockType)


def is_known_block_type(value: str) -> bool:
    """True when 'value' is in the documented vocabulary. NOT a validation constraint."""
    return value in KNOWN_BLOCK_TYPES


#: The OPEN type. Any identifier-shaped string validates; unknown values are legal by
#: design (DESIGN.md D2), so this is 'str' and the enum above is documentation only.
BlockType = str


class KnownHeadingBlockType(StrEnum):
    """The block types that open a SECTION. NOT REFERENCED BY ANYTHING and not a validation
    constraint — it is the vocabulary the semantic validator and the reading-order rules key
    on, and codegen emits as an isHeadingBlockType() guard.

    It defines the single distinction the reading order depends on:
    • SECTION CONTAINMENT — parent_id names a block of one of these types. The child is
    TOP-LEVEL: it keeps its doc_order and appears in Page.flows. A paragraph under a heading
    is this case.
    • NESTING — parent_id names ANY OTHER type (table, table_row, list, figure, paragraph, or
    a type this version has never heard of). The child is NESTED: it ranks by `order` inside
    its parent, carries NO doc_order, and does NOT appear in Page.flows. A table cell, a list
    item and an inline_equation inside a paragraph are all this case.

    Stated as the complement of a two-value list rather than as a list of containers so that
    an UNKNOWN parent type nests by default — the safe direction, since splicing the children
    of an unrecognised container into the body stream is the damaging error.

    The distinction is load-bearing and measured: Docling emits 342 cells for one ResNet table
    (findings.md §H2). Without it those 342 blocks occupy 342 consecutive doc_order slots
    between two paragraphs, and doc_order is defined as "the sequence a continuous reader or
    an audiobook follows" — so Guided view and TTS would read the table cell by cell and
    get_adjacent_blocks on the preceding paragraph would return cells. Likewise an
    inline_equation inside a paragraph must not become a doc_order slot: that is the prose
    shredding of findings.md B1.
    """

    TITLE = "title"
    HEADING = "heading"


KNOWN_HEADING_BLOCK_TYPES: frozenset[str] = frozenset(
    member.value for member in KnownHeadingBlockType
)


def is_known_heading_block_type(value: str) -> bool:
    """True when 'value' is in the documented vocabulary. NOT a validation constraint."""
    return value in KNOWN_HEADING_BLOCK_TYPES


class KnownRelationType(StrEnum):
    """The known relation vocabulary from ADR-001. As with KnownBlockType this is documentation
    and codegen input ONLY — Relation.type accepts any string.

    - parent_of: structural containment (section → paragraph).
    - next_in_reading_order: explicit successor within a flow.
    - caption_of: from a caption block TO the figure/table it captions.
    - references: from a block that mentions a float ("see Figure 2") TO that float.
    - defines: from a block that defines a symbol or term TO the block using it.
    - explains: from prose TO the equation/figure it explains.
    - result_of: from a result/table TO the method that produced it.
    - footnote_of: from a footnote TO its anchor.
    - continues_on_next_page: from the head of a split paragraph TO its tail. Cross-page
    paragraph joining is the defect readers notice most and that no mainstream parser
    advertises; making it an explicit, confidence-scored relation means it can be measured and
    repaired independently.
    - continues_in_next_column: from the head of a paragraph split across columns ON THE SAME
    PAGE to its tail. Added because ADR-001 offers only continues_on_next_page, and a
    paragraph running from the foot of column A to the head of column B is the most common
    structure in the corpus (4 of 8 papers are two-column). Without it a parser must either
    merge the two halves into one block whose single-ring polygon spans the gutter —
    reintroducing exactly the highlight bleed Commitment 2 exists to prevent — or leave them
    unlinked, so Guided view, retrieval chunks and the audiobook all see half-sentences.
    - visually_associated_with: proximity-based association with no stronger semantics
    available.
    - cites: from a citation block TO the reference_entry it cites.
    """

    PARENT_OF = "parent_of"
    NEXT_IN_READING_ORDER = "next_in_reading_order"
    CAPTION_OF = "caption_of"
    REFERENCES = "references"
    DEFINES = "defines"
    EXPLAINS = "explains"
    RESULT_OF = "result_of"
    FOOTNOTE_OF = "footnote_of"
    CONTINUES_ON_NEXT_PAGE = "continues_on_next_page"
    CONTINUES_IN_NEXT_COLUMN = "continues_in_next_column"
    VISUALLY_ASSOCIATED_WITH = "visually_associated_with"
    CITES = "cites"


KNOWN_RELATION_TYPES: frozenset[str] = frozenset(member.value for member in KnownRelationType)


def is_known_relation_type(value: str) -> bool:
    """True when 'value' is in the documented vocabulary. NOT a validation constraint."""
    return value in KNOWN_RELATION_TYPES


#: The OPEN type. Any identifier-shaped string validates; unknown values are legal by
#: design (DESIGN.md D2), so this is 'str' and the enum above is documentation only.
RelationType = str


#: The root of schema/paperir-1.0.0.schema.json.
PaperRoot = Paper
