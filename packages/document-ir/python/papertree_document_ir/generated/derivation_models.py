"""
DO NOT EDIT — generated from schema/derivation-1.0.0.schema.json by codegen/generate.ts.

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
from typing import Annotated, Any, ClassVar, Literal

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


class ModelAuthor(_Model):
    """Who generated this. kind is the constant "model": there is no human or source option,
    because a human note is not a derivation and source text belongs in PaperIR. Recording
    model_id and prompt_hash makes a generation reproducible, attributable and invalidatable
    when the prompt changes.
    """

    #: Always "model". The mirror image of PaperIR's Block.source, which has no model value at all.
    kind: Literal["model"]
    #: Exact model identifier, e.g. "anthropic/claude-haiku-4.5". Not a family name: a regression
    #: must be attributable to a specific model version.
    model_id: JsonText = Field(min_length=1)
    #: Algorithm-prefixed digest of the exact prompt used, e.g. "sha256:...". Lets a prompt change
    #: invalidate stale derivations instead of leaving them silently mismatched.
    prompt_hash: JsonText = Field(pattern=r"^[a-z0-9]+:[0-9a-f]{16,128}$")


class Derivation(_Model):
    """One piece of model-authored content, permanently tied to the source blocks it was derived
    from.

    ONE DERIVATION IS ONE RENDERABLE UNIT. ADR-001 Commitment 1 requires the Guided view to be
    "a derivation whose EVERY PARAGRAPH carries derived_from: [block_ids]"; `content` is
    deliberately unconstrained in shape, so the granularity has to be stated rather than
    schema-enforced. A twenty-paragraph guided section is TWENTY Derivations, each grounded in
    the blocks that paragraph came from — not one Derivation with three block ids attached.
    This is what makes Epic 2's reader/provenance.spec ("no Guided block renders without a
    visible derived marker and a working source link") testable at all.
    """

    #: Derivation identity: "drv_" + a 26-character Crockford base32 ULID. Random and time-ordered,
    #: NOT content-derived: unlike a block, a derivation is an event that happened, not a region of
    #: a document that can be re-found.
    derivation_id: JsonText = Field(pattern=r"^drv_[0-9A-HJKMNP-TV-Z]{26}$")
    #: The paper this derivation is about.
    paper_id: JsonText = Field(pattern=r"^ppr_[0-9A-HJKMNP-TV-Z]{26}$")
    #: What sort of derivation this is. ANY IDENTIFIER-SHAPED STRING VALIDATES
    #: (^[a-z][a-z0-9_]{0,63}$) — the same open-vocabulary forward-compatibility rule as PaperIR's
    #: Block.type, and the same identifier-shape constraint. The known kinds are listed in
    #: $defs/KnownDerivationKind for codegen and documentation only. A consumer that meets an
    #: unknown kind must not render it as source.
    kind: JsonText = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$", min_length=1)
    author: ModelAuthor
    #: The generated content of ONE renderable unit. Deliberately unconstrained in shape — a guided
    #: paragraph is Markdown, a canvas node is an object, a narration is a script — because the
    #: point of this file is to keep generated content OUT of the source schema, not to standardise
    #: it. This is the ONE place in the whole system where unconstrained model output is correct.
    #: Whatever it is, it is model output and must be rendered in a visually distinct register.
    content: Any
    #: The PaperIR block ids this content was derived from, in order of relevance. minItems 1 is
    #: load-bearing: a derivation that cannot point at any source block is ungrounded, and
    #: ungrounded generated content is exactly what the product currently ships (findings.md C4 — no
    #: block ids, no page spans, no citations). Every paragraph of the Guided view carries these so
    #: the reader can jump to the source.
    derived_from: list[Annotated[JsonText, Field(pattern=r"^blk_[a-z2-7]{16}$")]] = Field(
        min_length=1,
    )
    #: RFC 3339 timestamp of generation.
    created_at: Annotated[JsonText, AfterValidator(_date_time)]


class KnownDerivationKind(StrEnum):
    """The known derivation kinds. NOT REFERENCED BY Derivation.kind and not a validation
    constraint — documentation and codegen input only, exactly like PaperIR's KnownBlockType.
    """

    GUIDED_SECTION = "guided_section"
    SUMMARY = "summary"
    NARRATION = "narration"
    EXPLANATION = "explanation"
    CANVAS_NODE = "canvas_node"
    FLASHCARD = "flashcard"


KNOWN_DERIVATION_KINDS: frozenset[str] = frozenset(member.value for member in KnownDerivationKind)


def is_known_derivation_kind(value: str) -> bool:
    """True when 'value' is in the documented vocabulary. NOT a validation constraint."""
    return value in KNOWN_DERIVATION_KINDS


#: The OPEN type. Any identifier-shaped string validates; unknown values are legal by
#: design (DESIGN.md D2), so this is 'str' and the enum above is documentation only.
DerivationKind = str


#: The root of schema/derivation-1.0.0.schema.json.
DerivationRoot = Derivation
