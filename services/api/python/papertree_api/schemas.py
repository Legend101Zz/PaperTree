"""The wire models: one pydantic model per request and response body in contracts.md §2, the §2.6
browser events, the §3.2 agent run request and events, and the §6 Anchor.

EVERY MODEL IS `strict` AND `extra="forbid"`. Strict: no `"1"` for `1`, no `1.0` for an int. Forbid:
the exported JSON Schema (`contracts/api/*.schema.json`, `python -m papertree_api.contracts export`)
says `additionalProperties: false`, so a client-side type with a stray field fails
`apps/web/test/contracts.spec.ts`, and so does one missing a required field. Non-finite floats are
refused everywhere (`allow_inf_nan=False`): SQLite stores NaN as NULL, which a NOT NULL column then
rejects at the bind — a 500 from a request body.

INTEGERS THAT REACH SQL are bounded by `SQLITE_INTEGER_MAX` (from `papertree_db`, not re-typed):
generations, page indices, canvas `z` and `version`. Wave 1's review found the unbounded ones as
500s (JSON integers are unbounded; SQLite's INTEGER is 64-bit).

TIMES are `WireTime`: whatever the store holds, serialised in contracts.md §0's one shape by
`wiretime.wire_time`, and exported with that shape as a `pattern`.

OPTIONAL-BUT-NOT-NULL fields (`label?: string` in §5, as opposed to `label: string | null`) are
`omittable()`: absent from the JSON when unset, REFUSED when sent as `null`, and exported without
`null`, so the validator, the schema and the TypeScript type say the same thing.

What these models are NOT: the stored rows. The existing routes whose response is still the
pre-release shape (`POST /papers`, `GET /papers`, `GET /jobs/{id}`) keep it until their slice
switches them (S1); the models here are the §2 shapes those slices switch TO, and the new routes
already declare them (the 501 stubs, `routers/*.py`).
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, Final, Literal, Self

from papertree_db import SQLITE_INTEGER_MAX
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    RootModel,
    ValidationError,
    ValidationInfo,
    WithJsonSchema,
    field_validator,
    model_validator,
)
from pydantic.fields import FieldInfo
from pydantic_core import InitErrorDetails, PydanticCustomError

from .errors import ErrorCode, RunErrorCode
from .image_anchor import image_box
from .wiretime import wire_time

# ── building blocks ──────────────────────────────────────────────────────────────────────────


class Wire(BaseModel):
    """The base of every wire model.

    `json_schema_serialization_defaults_required`: a response field with a default is still
    ALWAYS sent (only an `omittable()` one is ever left out, and pydantic keeps those optional),
    so the exported response schema marks it required. Without it a defaulted field the server
    always sends looked optional, and a web type that lacked it passed `contracts.spec.ts`.
    """

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        allow_inf_nan=False,
        json_schema_serialization_defaults_required=True,
    )

    @model_validator(mode="after")
    def _omitted_not_null(self) -> Self:
        """An `omittable()` field that was GIVEN as `null` is refused (see `omittable`).

        Checked here, on the fields the input actually set, because that is the one place that
        tells "absent" from "null": both leave the attribute None. A field-level validator
        cannot (a `validate_default` field sees its default None too), and a `before` one would
        hand pydantic Python objects where it had JSON, which strict mode then reads differently
        (a JSON array is a tuple, a Python list is not). The error is raised with the FIELD's
        location, which pydantic nests under the model's own, so the 422 names
        `anchors.0.anchor.subTarget` rather than `anchors.0.anchor`.
        """
        fields = type(self).model_fields
        given = self.model_fields_set
        errors = [
            InitErrorDetails(
                type=PydanticCustomError("null_not_allowed", NULL_NOT_ALLOWED),
                loc=(name,),
                input=None,
            )
            for name, field in fields.items()
            if name in given and getattr(self, name) is None and is_omittable(field)
        ]
        if errors:
            raise ValidationError.from_exception_data(type(self).__name__, errors)
        return self


def _drop_null_branch(schema: dict[str, Any]) -> None:
    """`X | None = None` exports as `anyOf: [X, null]` with `default: null`; an omittable field is
    `X`, absent when unset."""
    branches = [branch for branch in schema.pop("anyOf", []) if branch.get("type") != "null"]
    if len(branches) == 1:
        schema.update(branches[0])
    elif branches:
        schema["anyOf"] = branches
    schema.pop("default", None)


def _is_none(value: object) -> bool:
    return value is None


def omittable(**constraints: Any) -> Any:
    """A field that is ABSENT or a value, never `null` on the wire (TypeScript's `field?: T`).

    Both directions: unset, it is left out of the JSON (`exclude_if`); sent as `null`, it is a 422
    (`Wire._omitted_not_null`); and its exported schema has no `null` branch (`_drop_null_branch`),
    so the schema, the validator and the TypeScript type say the same thing. Until S0's review
    (M1) only the schema said it: the validator took `null`, and a highlight whose anchor carried
    `"subTarget": null` was stored, a record `anchor-v1.schema.json` refuses."""
    return Field(
        default=None, exclude_if=_is_none, json_schema_extra=_drop_null_branch, **constraints
    )


#: The message of the 422 an explicit `null` in an omittable field gets.
NULL_NOT_ALLOWED: Final = "Field may be omitted, but not sent as null"


def is_omittable(field: FieldInfo) -> bool:
    """Whether `field` was declared with `omittable()`: the same mark that drops `null` from the
    exported schema, so the schema and the validator are keyed to one fact."""
    return field.json_schema_extra is _drop_null_branch


def _reject_bool(value: object) -> object:
    """`Literal[1]` accepts `true` (and `Literal[0, 90]` accepts `false`), even in strict mode,
    because `True == 1` in Python. JSON Schema's `const: 1` does not."""
    if isinstance(value, bool):
        raise PydanticCustomError("int_type", "Input should be a valid integer")
    return value


def _to_wire_time(value: object) -> object:
    return wire_time(value) if isinstance(value, str) else value


#: contracts.md §0: `2026-09-25T15:09:25.123Z`.
WIRE_TIME_PATTERN: Final = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
WireTime = Annotated[
    str,
    BeforeValidator(_to_wire_time),
    WithJsonSchema({"type": "string", "pattern": WIRE_TIME_PATTERN}),
]

#: A time a CLIENT sends (`GET /usage?since=`, §2.5 "ISO"): an ISO-8601 date and time WITH its zone,
#: `Z` or `±HH:MM`, seconds required, up to six fraction digits. §0's wire shape is one of these.
ISO_TIME_PATTERN: Final = (
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$"
)
_ISO_TIME: Final = re.compile(ISO_TIME_PATTERN)


def _iso_time(value: object) -> object:
    """pydantic's lax `datetime` (a query parameter is lax) also takes a bare date, a time with
    no zone and a Unix number as a string; none of them is "ISO" in §2.5's sense, and a naive time
    would be read in the server's zone. So the grammar is checked first, then the calendar."""
    if isinstance(value, str) and _ISO_TIME.fullmatch(value) is not None:
        try:
            return datetime.fromisoformat(value).astimezone(UTC)
        except ValueError:
            pass  # `2026-02-30…`: the grammar's shape, not a date
    raise PydanticCustomError(
        "iso_time", "Input should be an ISO-8601 time with a zone, e.g. 2026-09-25T15:09:25.123Z"
    )


#: A client-sent time, parsed to an aware UTC `datetime`.
IsoTime = Annotated[
    datetime,
    BeforeValidator(_iso_time),
    WithJsonSchema({"type": "string", "pattern": ISO_TIME_PATTERN}),
]

#: contracts.md §0: client-minted ids (`hl_…`, `cn_…`, `ce_…`).
CLIENT_ID_PATTERN: Final = r"^[a-z]{2,4}_[0-9A-Za-z-]{8,64}$"
UUID_PATTERN: Final = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
#: `anchor.id`: a bare UUID (`crypto.randomUUID()`) or a prefixed id (a 0001 `anc_…`, a `cit_…`).
ANCHOR_ID_PATTERN: Final = (
    r"^(?:[a-z]{2,4}_[0-9A-Za-z-]{8,64}"
    r"|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"
)
#: A handle the API issued to the agent for one block in one run (`ai_run_handles`, §4).
HANDLE_PATTERN: Final = r"^b[0-9]+$"
SHA256_PATTERN: Final = r"^sha256:[0-9a-f]{64}$"


def server_id(prefix: str) -> str:
    """contracts.md §0: `<prefix>_<ULID>`, a 26-character Crockford ULID."""
    return rf"^{prefix}_[0-9A-HJKMNP-TV-Z]{{26}}$"


ClientId = Annotated[str, Field(pattern=CLIENT_ID_PATTERN)]
Handle = Annotated[str, Field(pattern=HANDLE_PATTERN)]
NonNegative = Annotated[int, Field(ge=0)]
Positive = Annotated[int, Field(ge=1)]
#: A parse generation, bound as a SQL parameter.
Generation = Annotated[int, Field(ge=1, le=SQLITE_INTEGER_MAX)]
#: A 0-based page index, bound as a SQL parameter (`anchors.page_index`, `ai_citations`).
PageIndex = Annotated[int, Field(ge=0, le=SQLITE_INTEGER_MAX)]
Tier = Annotated[int, Field(ge=0, le=6)]
Unit = Annotated[float, Field(ge=0, le=1)]
Usd = Annotated[float, Field(ge=0)]

# ── §6 the Anchor (`@papertree/anchoring` `types.ts`, v1, minus `resolution`) ────────────────

TargetKind = Literal[
    "text",
    "guided_para",
    "equation",
    "equation_part",
    "figure",
    "figure_region",
    "table_row",
    "table_cell",
    "algorithm",
    "citation",
]
ProvenanceClass = Literal["source", "ai_generated"]
AnchorFailureReason = Literal[
    "block_id_missing",
    "block_text_changed",
    "quote_below_threshold",
    "quote_too_short_no_context",
    "no_geometric_overlap",
    "section_not_found",
    "page_out_of_range",
    "no_selectors",
]
ResolutionState = Literal["anchored", "approximate", "orphan"]
#: `[x0, y0, x1, y1]` in IR space (PDF points, top-left origin).
BBox = tuple[float, float, float, float]
Point = tuple[float, float]


class BlockSelector(Wire):
    type: Literal["BlockSelector"]
    blockId: str = Field(min_length=1)
    blockTextHash: str
    startOffset: NonNegative | None = omittable()
    endOffset: NonNegative | None = omittable()
    cellRef: tuple[NonNegative, NonNegative] | None = omittable()
    rowIndex: NonNegative | None = omittable()


class PageSelector(Wire):
    type: Literal["PageSelector"]
    index: PageIndex
    label: str | None = omittable()


class TextPositionSelector(Wire):
    type: Literal["TextPositionSelector"]
    start: NonNegative
    end: NonNegative


class TextQuoteSelector(Wire):
    type: Literal["TextQuoteSelector"]
    exact: str
    prefix: str
    suffix: str
    exactNormalised: str
    prefixNormalised: str
    suffixNormalised: str


class ShapeSelector(Wire):
    type: Literal["ShapeSelector"]
    pageIndex: PageIndex
    #: One per typographic line. EMPTY is schema-valid (types.ts has no minimum); a new user
    #: highlight without a quad is §2.4's `anchor_incomplete`, which the data layer checks.
    quads: list[BBox]
    polygons: list[list[Point]]
    pageWidth: float
    pageHeight: float
    rotation: Annotated[Literal[0, 90, 180, 270], BeforeValidator(_reject_bool)]
    userUnit: float
    cropBox: BBox


class SectionPathSelector(Wire):
    type: Literal["SectionPathSelector"]
    path: list[str]
    headingText: str
    paraIndexInSection: NonNegative
    charOffsetInPara: NonNegative


Selector = Annotated[
    BlockSelector
    | PageSelector
    | TextPositionSelector
    | TextQuoteSelector
    | ShapeSelector
    | SectionPathSelector,
    Field(discriminator="type"),
]


class SubTarget(Wire):
    kind: Literal["equation_part", "figure_region", "table_cell", "table_row", "algorithm_line"]
    normalisedRect: tuple[Unit, Unit, Unit, Unit] | None = omittable()
    latexStart: NonNegative | None = omittable()
    latexEnd: NonNegative | None = omittable()
    lineIndex: NonNegative | None = omittable()


class AnchorDoc(Wire):
    paperId: str = Field(min_length=1)
    pdfSha256: str = Field(pattern=SHA256_PATTERN)
    parserVersion: str
    #: `api/<paper_id>/g<gen>/<parser_version>`, `pdfjs@5.7.284/page-text` or `legacy-0001` (§6).
    textStreamId: str = Field(min_length=1)


class AnchorCreated(Wire):
    mode: Literal["source", "guided"]
    at: str
    client: str


class AnchorV1(Wire):
    """The persisted Anchor, verbatim (contracts.md §6): `@papertree/anchoring`'s `Anchor` v1
    without `resolution`. `contracts/anchor/anchor-v1.schema.json` is the same record, written by
    hand; `tests/test_anchor_examples.py` holds this model to every committed example."""

    anchorVersion: Annotated[Literal[1], BeforeValidator(_reject_bool)]
    offsetUnit: Literal["unicode"]
    id: str = Field(pattern=ANCHOR_ID_PATTERN)
    doc: AnchorDoc
    targetKind: TargetKind
    provenanceClass: ProvenanceClass
    subTarget: SubTarget | None = omittable()
    selectors: list[Selector]
    created: AnchorCreated


class AnchorV1In(AnchorV1):
    """An Anchor as a client sends it: it may still carry the client's T0 cache (`resolution`),
    which the server strips before storing (§2.4). Anything else extra is still refused."""

    resolution: Any = Field(default=None, exclude=True)


# ── §2.1 auth ────────────────────────────────────────────────────────────────────────────────


class Credentials(Wire):
    # A constrained `str`, not pydantic's `EmailStr`: that needs `email-validator` and `dnspython`
    # for a check that guards nothing here (no mail is sent, no address is trusted). The pattern
    # rejects the typo class and stops there. 8 is the password floor, not a policy.
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=1024)


class Session(Wire):
    token: str
    user_id: str
    email: str


def _trimmed(value: object) -> object:
    """Strips a string before its length is checked, so `"  x  "` is `"x"` and 60 letters padded
    with spaces is still 60 letters. Anything else is left for the type check to refuse."""
    return value.strip() if isinstance(value, str) else value


#: A chosen name for the library's bookplate and the account menu: 1 to 60 characters AFTER
#: trimming. Enforced here, not by a CHECK, so relaxing it later needs no table rebuild (0006).
DisplayName = Annotated[str, BeforeValidator(_trimmed), Field(min_length=1, max_length=60)]


class Me(Wire):
    user_id: str
    email: str
    #: Null until the person sets one. Never derived from the email (#192).
    display_name: str | None


class MeUpdate(Wire):
    """`PATCH /auth/me` (#192)."""

    display_name: DisplayName


# ── §2.2 papers, library, jobs ───────────────────────────────────────────────────────────────

Processing = Literal["queued", "reading", "ready", "partial", "failed"]
JobState = Literal["pending", "running", "succeeded", "dead_letter", "cancelled"]
JobStepName = Literal["parse", "persist", "promote"]
#: §2.2 lists the codes a parse job can end with.
JobErrorCode = Literal["pdf_unreadable", "validation_failed", "timeout", "internal"]


class JobSummary(Wire):
    job_id: str
    kind: Literal["parse"]
    state: JobState
    step: JobStepName | None
    done: NonNegative
    total: NonNegative
    attempt: NonNegative
    max_attempts: NonNegative
    error_code: JobErrorCode | None


class ReadingProgress(Wire):
    """Where the caller is in a paper (#192). A paper they have not started has `reading: null`.

    Pages are zero-based. `state` is the progress rule: `finished` once the last page was
    reached (or the paper was marked read), else `reading`.
    """

    last_page: NonNegative
    furthest_page: NonNegative
    page_count: NonNegative | None
    #: When the reader last wrote its page (every write counts), not the first open.
    opened_at: WireTime
    #: Always set when `state` is `finished`.
    finished_at: WireTime | None
    state: Literal["reading", "finished"]


class ReadingStateUpdate(Wire):
    """`PUT /papers/{id}/reading-state` (#192): the page the reader is on now."""

    last_page: PageIndex
    mode: Literal["source", "guided", "split"] | None = omittable()


# ── topics (#193) ────────────────────────────────────────────────────────────────────────────

#: The six cloth colours of the design (`papertree_db.CLOTHS`; a test pins that they agree).
Cloth = Literal["transformers", "vision", "generative", "optimization", "language", "rl"]
TopicSource = Literal["arxiv_category", "manual", "model"]
#: 1 to 60 characters AFTER trimming (`papertree_db.TOPIC_NAME_MAX`). Not a CHECK: see 0009.
TopicName = Annotated[str, BeforeValidator(_trimmed), Field(min_length=1, max_length=60)]


class TopicRef(Wire):
    """A topic as another record points at it."""

    topic_id: str = Field(pattern=server_id("top"))
    name: str
    cloth: Cloth | None


class Topic(TopicRef):
    """`GET /topics` (#193): a shelf with what it holds. Counts cover ACCEPTED papers only."""

    sort_order: NonNegative
    paper_count: NonNegative
    #: The sum of the held papers' page counts (a paper of unknown length counts for 0).
    page_count: NonNegative
    #: The distinct arXiv categories of the held papers, sorted ("arXiv cs.CL, cs.LG").
    categories: list[str]


class TopicCreate(Wire):
    """`POST /topics`."""

    name: TopicName
    cloth: Cloth | None = omittable()


class TopicPatch(Wire):
    """`PATCH /topics/{topic_id}`: only what is sent changes (`cloth: null` clears the colour)."""

    name: TopicName | None = omittable()
    #: Sent as `null` it CLEARS the colour (the design's "no cloth"); left out it is kept.
    cloth: Cloth | None = None
    sort_order: PageIndex | None = omittable()


class LibraryTopic(TopicRef):
    """`LibraryPaper.topic`: the topic the caller ACCEPTED for the paper. A mere offer is not
    here (`GET /papers/{id}/topic` has it): an unaccepted suggestion must not group the shelf."""

    source: TopicSource
    #: `cs.CL` for `arxiv_category`, the model id for `model`, else null.
    source_detail: str | None


class PaperTopic(Wire):
    """`GET /papers/{id}/topic` and the body of its writes (#193).

    `none`: no topic, no offer. `suggested`: an offer (`topic`, or `suggested_name` for a topic
    that does not exist yet); the paper is NOT shelved. `accepted`: shelved under `topic`.
    `rejected`: the person said no.
    """

    status: Literal["none", "suggested", "accepted", "rejected"]
    topic: TopicRef | None
    suggested_name: str | None
    source: TopicSource | None
    source_detail: str | None
    #: The paper's own arXiv category, whatever the status.
    arxiv_category: str | None


class PaperTopicPut(Wire):
    """`PUT /papers/{id}/topic`: accept an existing topic, or name a new one (reused if the person
    already has a topic of that name).

    EXACTLY ONE of `topic_id` and `new_topic_name`. The route enforces it (422), not this model:
    every field here is omittable, which is what the exported schema and `omittable_cases` say.
    """

    topic_id: str | None = omittable(pattern=server_id("top"))
    new_topic_name: TopicName | None = omittable()
    cloth: Cloth | None = omittable()


class LibraryPlate(Wire):
    """`LibraryPaper.plate` (#200): the figure the caller chose as the cover, as it is in the
    promoted generation. Null on the paper means the typographic cover."""

    #: Which entry of `GET /papers/{id}/figures` it is: a hint, the choice is stored as an Anchor.
    block_id: str
    page_index: PageIndex
    #: "Figure 1", read from the start of its caption; null when the parser attached none.
    label: str | None
    #: The caption as the paper has it ("Figure 1: The Transformer - model architecture."), or null.
    caption_text: str | None
    #: The crop, signed for about an hour (the same URL for ten minutes, so a polled list keeps it).
    asset_url: str


class LibraryPaper(Wire):
    """The row shape used everywhere a paper is listed (§2.2)."""

    paper_id: str = Field(pattern=server_id("ppr"))
    title: str
    authors: list[str]
    original_filename: str | None
    source_hash: str = Field(pattern=SHA256_PATTERN)
    page_count: NonNegative | None
    processing: Processing
    job: JobSummary | None
    generation: Generation | None
    parser_version: str | None
    highlight_count: NonNegative
    created_at: WireTime
    updated_at: WireTime
    #: The caller's place in the paper; null when they have not started it (#192).
    reading: ReadingProgress | None
    #: The year first submitted, from the arXiv id only; null when unsure (never a guess).
    year: NonNegative | None
    arxiv_id: str | None
    #: The primary category from the arXiv margin stamp (`cs.CL`); null when absent.
    arxiv_category: str | None
    thread_count: NonNegative
    #: True when the promoted generation has any cached summary (whatever prompt or model).
    has_summary: bool
    #: The topic the caller accepted for it (#193); null when unshelved or only offered.
    topic: LibraryTopic | None
    #: The caller's notebook pages on this paper (#200).
    notebook_count: NonNegative
    #: The figure the caller chose as the cover (#200); null for the typographic cover, and when
    #: the chosen figure is not in the promoted parse or has no crop.
    plate: LibraryPlate | None


class PaperFigure(Wire):
    """One figure the parser FOUND (`GET /papers/{id}/figures`, #200). Detection misses some
    (#103), so a list is never "every figure"."""

    block_id: str
    page_index: PageIndex
    bbox: BBox
    #: The caption `caption_of` attaches, as the paper has it; null when none is attached.
    caption_text: str | None
    caption_block_id: str | None
    #: "Figure 1" (or "Figure 1.1") when the caption starts with its number; else null.
    label: str | None
    #: The crop, signed for about an hour; null when none was rendered.
    asset_url: str | None
    #: A whole-block Anchor on the figure, minted by this response: what `PUT …/plate` takes back.
    #: Null only when no valid Anchor could be minted (such a figure cannot be chosen).
    anchor: AnchorV1 | None


#: A paper's name as its owner gives it: 1 to 300 characters AFTER trimming (`papertree_db
#: .PAPER_TITLE_MAX`). Enforced here and by the data layer, not by a CHECK (0012).
PaperTitle = Annotated[str, BeforeValidator(_trimmed), Field(min_length=1, max_length=300)]


class PaperRename(Wire):
    """`PATCH /papers/{id}` (v0.3 #337): the name the library shows for this paper from now on.
    The parsed title is kept; this one wins over it and over the filename."""

    title: PaperTitle


class PlatePut(Wire):
    """`PUT /papers/{id}/plate`: the Anchor of one of the paper's figures (from `…/figures`)."""

    anchor: AnchorV1In


class PaperAbstract(Wire):
    """`GET /papers/{id}/abstract` (#200): the abstract the parser found, for the opened book.
    Every field is null when it found none."""

    #: The abstract's blocks' text as the paper has it (line breaks and line-end hyphens kept; a
    #: reader joins them for display), blocks separated by a blank line.
    text: str | None
    page_index: PageIndex | None
    #: A whole-block Anchor on the abstract's first block: the "p. 1 · Abstract" tab.
    anchor: AnchorV1 | None


class UploadAccepted(Wire):
    """`202` from `POST /papers` once S1 lands. Until then the route answers the pre-release
    `{paper_id, job_id, created}` (`routers/papers.py::Upload`)."""

    paper_id: str
    job_id: str
    created: bool
    paper: LibraryPaper


class JobAccepted(Wire):
    """`202` from `POST /papers/{id}/retry` and `…/reparse`."""

    job_id: str
    generation: Generation


class LibraryReference(Wire):
    """The bibliography entry that made a library link: its position and its text."""

    #: Zero-based position in the citing paper's bibliography (document order).
    index: int = Field(ge=0, le=SQLITE_INTEGER_MAX)
    text: str


class LibraryLink(Wire):
    """One real link between two of the caller's papers (``GET /library/links``, #194).

    ``via`` is only ``"citation"``: ``"board"`` joins the enum when a board can hold a second
    paper. ``matched_by`` is what actually matched, so the UI words it from the field.
    """

    from_paper_id: str
    to_paper_id: str
    via: Literal["citation"]
    matched_by: Literal["arxiv_id", "title"]
    reference: LibraryReference


class LibraryLinks(Wire):
    """``GET /library/links``."""

    links: list[LibraryLink]


class ReparseRequest(Wire):
    reason: str | None = omittable(max_length=500)


class JobStepStatus(Wire):
    name: JobStepName
    index: NonNegative
    state: Literal["running", "succeeded", "failed"]


class JobStatus(Wire):
    """`GET /jobs/{job_id}` once S1 lands: "the existing shape plus `error_code`", with the raw
    `error` text kept in logs and the DB only (§2.2)."""

    job_id: str
    kind: Literal["parse"]
    state: JobState
    attempt: NonNegative
    max_attempts: NonNegative
    progress_done: NonNegative
    progress_total: NonNegative
    progress_note: str | None
    error_code: JobErrorCode | None
    is_terminal: bool
    created_at: WireTime
    updated_at: WireTime
    steps: list[JobStepStatus]
    #: The generation this job parses (its payload's), and the parser version that produced it once
    #: it is stored; null until then (contracts.md §8, S5F).
    generation: Generation | None = None
    parser_version: str | None = None


# ── §2.4 highlights ──────────────────────────────────────────────────────────────────────────

HighlightColor = Literal["amber", "green", "blue", "pink", "purple"]


class ResolutionWire(Wire):
    generation: Generation
    tier: Tier
    state: ResolutionState
    block_ids: list[str]
    score: Annotated[float, Field(ge=0, le=1)] | None
    reason: AnchorFailureReason | None
    resolver_version: str


class AnchorWire(Wire):
    anchor_id: str
    ordinal: NonNegative
    anchor: AnchorV1
    resolution: ResolutionWire | None


class Highlight(Wire):
    highlight_id: str
    color: HighlightColor
    note: str | None
    created_generation: Generation
    created_at: WireTime
    updated_at: WireTime
    anchors: list[AnchorWire]


class HighlightAnchorIn(Wire):
    anchor: AnchorV1In


class _ResolutionFields(Wire):
    anchor_id: str = Field(min_length=1)
    tier: Tier
    state: ResolutionState
    block_ids: list[str]
    score: Annotated[float, Field(ge=0, le=1)] | None = None
    reason: AnchorFailureReason | None = None
    resolver_version: str = Field(min_length=1)


class HighlightResolutionIn(_ResolutionFields):
    generation: Generation


class HighlightCreate(Wire):
    """`POST /papers/{id}/highlights`. `anchors[i]`'s ordinal is `i`."""

    highlight_id: ClientId
    color: HighlightColor
    note: str | None = None
    anchors: list[HighlightAnchorIn] = Field(min_length=1, max_length=64)
    resolutions: list[HighlightResolutionIn] = Field(default_factory=list)


class HighlightPatch(Wire):
    """`{color?, note?}`: absent is unchanged, `note: null` clears the note, `color: null` is 422
    (an omittable field: a colour is never removed)."""

    color: HighlightColor | None = omittable()
    note: str | None = None


class ResolutionPutItem(_ResolutionFields):
    #: Only for a `legacy-0001` anchor, which the reader upgrades on first open (ADR-002 §6.3).
    upgraded_anchor: AnchorV1In | None = omittable()


class ResolutionsPut(Wire):
    generation: Generation
    items: list[ResolutionPutItem] = Field(max_length=500)


# ── §2.5 AI threads, messages, citations, runs ───────────────────────────────────────────────

MessageStatus = Literal["streaming", "complete", "partial", "error", "aborted"]
#: ``image`` (v0.3 #348): a question about a figure or region, answered from its crop. It is stored
#: as an ``ask`` thread (0017 does not rebuild the thread table) and read back as ``image``.
ThreadKind = Literal["explain", "ask", "diagram", "image"]
#: The reader's level an explain/ask answer is written for (v0.3, #339; 0014).
AnswerLevel = Literal["new", "familiar", "expert"]
RunKind = Literal["explain", "ask", "summary", "diagram", "topic", "glance", "image"]
DoneStatus = Literal["complete", "partial", "error", "aborted"]


class MessageError(Wire):
    code: RunErrorCode | ErrorCode
    retryable: bool
    message: str


class PassageLocator(Wire):
    """Where a cited passage sits, DERIVED on read from the parse (never stored; #201).

    The UI shows `p. 2 ¶3 · Introduction`; `passage_key` is only a display key that numbers
    "the same passage" within one answer, so it is never kept on a user row.
    """

    #: `g{generation}:{block_id}`: equal keys are the same passage within one generation.
    passage_key: str
    page_index: PageIndex
    #: 1-based among that page's body paragraphs in reading order; null for a caption, a table
    #: cell, a heading or anything else the UI should show by page only.
    para_index: Positive | None
    #: The display title of the section the block belongs to; null for none.
    section_heading: str | None


class Citation(Wire):
    citation_id: str
    ordinal: NonNegative
    #: The handle as the model wrote it, e.g. `b3`.
    marker: Handle
    page_index: PageIndex
    anchor: AnchorV1
    #: Present on a stored answer read back (`GET /papers/{id}/threads/{tid}`), when its
    #: generation's parse can still be loaded; the live SSE `citations` event omits it.
    locator: PassageLocator | None = omittable()


# ── a diagram answer (v0.2 S7a, #216; DESIGN.md §1 "Diagrams", §4) ─────────────────────────────

#: How the plate draws a part: `input` (bare letters, Q K V), `step` (a ruled box), `output` (a
#: double rule), `concept` (plain).
DiagramPartKind = Literal["input", "step", "output", "concept"]
#: A plate's state, from its message's: `stopped` is the reader's Stop (the parts that came are
#: kept), `partial` a plate cut short by anything else.
DiagramStatus = Literal["streaming", "complete", "partial", "stopped", "error"]
#: A part's letter: the Nth part to arrive is the Nth letter, A to L (twelve parts at most).
Letter = Annotated[str, Field(pattern=r"^[A-L]$")]


class DiagramCite(Wire):
    """Where a part's quote was found: the Anchor of the block it came from (null when the quote
    was found nowhere). The plate shows only its page; it carries no verdict (#340)."""

    #: The Anchor's id (`cit_…`); null when the quote was found nowhere.
    citation_id: str | None
    #: The quote as the model wrote it.
    quote: str
    anchor: AnchorV1 | None
    #: Derived from the parse on read (never stored); null when it cannot be had.
    locator: PassageLocator | None
    page_index: PageIndex | None


class DiagramPart(Wire):
    letter: Letter
    label: str
    #: One short line for the plate's key.
    text: str
    kind: DiagramPartKind
    #: Edges INTO this part, from earlier letters only (acyclic by construction).
    after: list[Letter]
    #: One label (or null) per `after` entry, same order.
    edge: list[str | None]
    #: Null: the part is inferred, with no passage behind it ("inferred, no passage").
    cite: DiagramCite | None


class DiagramLink(Wire):
    """An edge `after` cannot say (a feedback edge), from one placed part to another."""

    source: Letter
    target: Letter
    label: str | None


class MessageDiagram(Wire):
    #: The plate's title; null until the model wrote one.
    title: str | None
    status: DiagramStatus
    parts: list[DiagramPart]
    links: list[DiagramLink]


class RunSummary(Wire):
    run_id: str
    model: str
    provider: str
    agent_sdk: str
    input_tokens: NonNegative | None
    output_tokens: NonNegative | None
    cache_read_tokens: NonNegative | None
    reasoning_tokens: NonNegative | None
    cost_usd_est: Usd | None
    first_text_ms: NonNegative | None
    latency_ms: NonNegative | None
    retries: NonNegative
    tool_calls: NonNegative


class Message(Wire):
    message_id: str
    thread_id: str
    ordinal: NonNegative
    role: Literal["user", "assistant"]
    content: str
    status: MessageStatus
    error: MessageError | None
    generation: Generation
    run: RunSummary | None
    citations: list[Citation]
    #: The level an assistant answer of an `explain` or `ask` thread was written at (an answer
    #: stored before v0.3 reads `familiar`); null on a user message and on a diagram answer.
    level: AnswerLevel | None
    #: Assistant messages only (null on a user message): the `message_id` of the FIRST answer to
    #: the question this one answers. Answers that share it are siblings, one per level
    #: (`FollowUp.relevel_of`); an answer with no sibling carries its own `message_id`.
    sibling_group: str | None
    #: Only on an assistant message of a `diagram` thread; `content` keeps the raw lines.
    diagram: MessageDiagram | None = omittable()
    created_at: WireTime
    completed_at: WireTime | None


class Thread(Wire):
    thread_id: str
    kind: ThreadKind
    title: str
    origin_anchor: AnchorV1 | None
    created_at: WireTime
    updated_at: WireTime
    message_count: NonNegative
    #: The first user message, cut to 160 characters on a word boundary ("" if none yet).
    ask: str
    #: Stored status of the thread's last assistant message; null when there is none. A run that
    #: died but has not expired still reads `streaming` here, where the thread detail already says
    #: `partial` or `error`.
    last_status: MessageStatus | None


class ThreadDetail(Wire):
    thread: Thread
    messages: list[Message]


DEFAULT_QUESTION: Final = "Explain this passage."
#: A `diagram` thread's question when the client sends none.
DIAGRAM_QUESTION: Final = "Explain with a diagram."
#: An `image` thread's question when the client sends none: what "Explain" on a figure asks.
IMAGE_QUESTION: Final = "Explain this figure."


class ThreadCreate(Wire):
    """`POST /papers/{id}/threads`. `anchor` is required for `explain`, `diagram` and `image`; a
    diagram's default question is `DIAGRAM_QUESTION`, an image's `IMAGE_QUESTION`.

    An `image` thread (v0.3 #348) is about a figure or a free region of a page: its `anchor` is an
    IMAGE anchor (`image_anchor`: targetKind `figure` or `figure_region`, a PageSelector and ONE
    ShapeSelector quad, no text quote), the API renders the crop and sends it to the model with the
    figure's caption and the paragraph that first mentions it. `with_text_anchor` (image only) is
    the text anchor of a paragraph the reader selected together with the figure ("figure +
    paragraph together"): its words go beside the picture.
    """

    kind: ThreadKind
    anchor: AnchorV1In | None = omittable(validate_default=True)
    question: str = Field(default=DEFAULT_QUESTION, min_length=1, max_length=2000)
    #: The level the first answer is written for (stored on the answer). Ignored by a `diagram`.
    level: AnswerLevel = "familiar"
    #: `image` only: a text anchor selected together with the figure.
    with_text_anchor: AnchorV1In | None = omittable()

    @field_validator("anchor", mode="after")
    @classmethod
    def _explain_needs_an_anchor(cls, value: AnchorV1In | None, info: ValidationInfo) -> Any:
        kind = info.data.get("kind")
        if value is None and kind in ("explain", "diagram", "image"):
            article = "an" if kind in ("explain", "image") else "a"
            raise PydanticCustomError("missing", f"Field required for {article} {kind} thread")
        if value is not None and kind == "image":
            try:
                image_box(value.model_dump(mode="json"))
            except ValueError as exc:
                raise PydanticCustomError("image_anchor", str(exc)) from exc
        return value

    @model_validator(mode="after")
    def _with_text_is_for_an_image(self) -> Self:
        if self.with_text_anchor is not None and self.kind != "image":
            raise PydanticCustomError(
                "extra_forbidden", "with_text_anchor: only an image thread takes one"
            )
        return self


class FollowUp(Wire):
    """`POST /papers/{id}/threads/{tid}/messages`. `question` is required except on a relevel
    (`relevel_of`), which re-asks the stored question and ignores one if sent."""

    question: str = Field(default="", max_length=2000)
    #: The level this answer is written for (stored on the answer). Ignored on a diagram thread.
    level: AnswerLevel = "familiar"
    #: Change level: an assistant answer of this thread (finished, any level) to answer AGAIN, to
    #: the same question, at `level`. It appends a sibling answer and no user turn.
    relevel_of: str | None = omittable(pattern=server_id("msg"))
    #: Re-run a failed assistant message instead of appending a new user turn.
    retry_of: str | None = omittable(pattern=server_id("msg"))
    #: Redraw: a diagram answer of this thread (finished, in any state) to draw again. Required on
    #: a `diagram` thread, refused on any other; it appends a new turn, never replaces one.
    redraw_of: str | None = omittable(pattern=server_id("msg"))

    @model_validator(mode="after")
    def _question_unless_relevel(self) -> Self:
        if self.question == "" and self.relevel_of is None:
            raise PydanticCustomError("string_too_short", "String should have at least 1 character")
        return self


# ── §2.6 browser-facing SSE events (the `data` of each `event:`) ─────────────────────────────


class SseRun(Wire):
    run_id: str
    thread_id: str | None
    user_message_id: str | None
    message_id: str
    generation: Generation


class SseStatus(Wire):
    phase: Literal["thinking", "tool", "retrying", "writing"]
    label: str | None = omittable()
    attempt: Positive | None = omittable()
    delay_ms: NonNegative | None = omittable()


class SseText(Wire):
    delta: str


class SseCitations(Wire):
    items: list[Citation]


class SsePlate(Wire):
    """A diagram run's plate title (v0.2 S7a); its parts follow as `part` (a `DiagramPart`, the
    quote already resolved) and its feedback edges as `link` (a `DiagramLink`)."""

    title: str


class SseDone(Wire):
    status: DoneStatus
    error: MessageError | None
    message_id: str


#: event name -> the model of its `data`. `usage` is a `RunSummary`.
BROWSER_EVENTS: Final[dict[str, type[Wire]]] = {
    "run": SseRun,
    "status": SseStatus,
    "text": SseText,
    "citations": SseCitations,
    "plate": SsePlate,
    "part": DiagramPart,
    "link": DiagramLink,
    "usage": RunSummary,
    "done": SseDone,
}

# ── §2.5 summary ─────────────────────────────────────────────────────────────────────────────


class SummaryBullet(Wire):
    text: str
    citations: list[Citation]


class Summary(Wire):
    generation: Generation
    model: str
    prompt_version: str
    created_at: WireTime
    status: Literal["complete", "partial"]
    bullets: list[SummaryBullet]


class SummaryStatus(Wire):
    state: Literal["none", "running", "ready", "partial", "failed"]
    summary: Summary | None


class SummaryRequest(Wire):
    regenerate: bool = False


# ── the spread's "At a glance" sheet (v0.3 #337) ────────────────────────────────────────────

#: A page number (1-based, the number printed in the reader), or null when the block cites nothing.
GlancePage = Annotated[int, Field(ge=1, le=100_000)]


class GlanceBlock(Wire):
    """Problem, Idea, How it works or Limits: the words, and the page they come from (the quiet
    `p. 3 ›` link), or null when the model cited no passage."""

    text: str = Field(min_length=1)
    page: GlancePage | None


class GlanceNumber(Wire):
    """A large number under Results: its value and what it measures."""

    value: str = Field(min_length=1)
    measures: str = Field(min_length=1)


class GlanceResults(Wire):
    numbers: list[GlanceNumber] = Field(max_length=2)
    note: str | None
    page: GlancePage | None


class GlanceWord(Wire):
    term: str = Field(min_length=1)
    gloss: str = Field(min_length=1)


class Glance(Wire):
    """The sheet. Maths in any text is `$…$`. Every cap of `glance.py` is already applied."""

    gist: str = Field(min_length=1)
    problem: GlanceBlock
    idea: GlanceBlock
    how: GlanceBlock
    results: GlanceResults
    limits: GlanceBlock
    #: Names sections; it needs no page mark.
    read_first: str = Field(min_length=1)
    words: list[GlanceWord] = Field(min_length=5, max_length=5)
    #: The model that wrote it, as the agent reported it (`MiniMax-M3.1-Flash`).
    model: str = Field(min_length=1)
    #: The parse it was written from (the pages are pages of that one).
    generation: Generation


class GlanceStatus(Wire):
    """`GET /papers/{id}/glance`. `ready`: 200 with the sheet. `making`: 202, no sheet yet (a run is
    writing it; ask again). `none`: 200, no sheet and none coming (the model is not configured, the
    daily cap is reached, or the run failed): the spread shows the abstract alone."""

    state: Literal["ready", "making", "none"]
    glance: Glance | None


# ── §2.5 usage ───────────────────────────────────────────────────────────────────────────────


class UsageBucket(Wire):
    """One kind's share. §2.5 leaves the inner shape open; this is the web client's
    (`lib/api/usage.ts::UsageBucket`), which the totals repeat at the top level."""

    runs: NonNegative
    input_tokens: NonNegative
    output_tokens: NonNegative
    cost_usd_est: Usd


class UsageByKind(Wire):
    explain: UsageBucket
    ask: UsageBucket
    summary: UsageBucket
    diagram: UsageBucket
    topic: UsageBucket
    #: The spread's "At a glance" run (v0.3 #337).
    glance: UsageBucket
    #: The image ask (v0.3 #348): a run shown a crop of a figure.
    image: UsageBucket


class UsageTotals(Wire):
    since: WireTime
    runs: NonNegative
    input_tokens: NonNegative
    output_tokens: NonNegative
    cost_usd_est: Usd
    budget_usd: Usd
    by_kind: UsageByKind


# ── §2.7 canvas ──────────────────────────────────────────────────────────────────────────────

#: "frame" on the design's board is the `group` kind on the wire.
NodeKind = Literal["excerpt", "explanation", "note", "group", "question", "notebook", "diagram"]
#: The four typed pins (DESIGN.md section 5); `papertree_db.canvas.PIN_TABLE` says who offers which.
FromPort = Literal["claim_out", "answer_out"]
ToPort = Literal["evidence_in", "question_in"]
EdgeKind = Literal[
    "supports", "contradicts", "derives_from", "answers", "compares", "references", "relates"
]
#: `canvas_nodes.z` and `version` are INTEGER columns.
SqlInt = Annotated[int, Field(ge=-SQLITE_INTEGER_MAX, le=SQLITE_INTEGER_MAX)]
Version = Annotated[int, Field(ge=1, le=SQLITE_INTEGER_MAX)]
#: W2UI size limits (#141): a canvas row is a card, not a document store. Coordinates are finite
#: and within +/- 1e6, a card is at most 1e5 wide or tall, text is capped, zoom stays usable.
CANVAS_COORD_LIMIT = 1_000_000.0
CANVAS_EXTENT_LIMIT = 100_000.0
CANVAS_TITLE_MAX = 200
CANVAS_BODY_MAX = 20_000
CANVAS_LABEL_MAX = 200
CANVAS_ZOOM_MIN = 0.05
CANVAS_ZOOM_MAX = 8.0

Coord = Annotated[float, Field(ge=-CANVAS_COORD_LIMIT, le=CANVAS_COORD_LIMIT, allow_inf_nan=False)]
Extent = Annotated[float, Field(gt=0, le=CANVAS_EXTENT_LIMIT, allow_inf_nan=False)]
CanvasTitle = Annotated[str, Field(max_length=CANVAS_TITLE_MAX)]
CanvasBody = Annotated[str, Field(max_length=CANVAS_BODY_MAX)]
CanvasLabel = Annotated[str, Field(max_length=CANVAS_LABEL_MAX)]


class Viewport(Wire):
    x: Coord
    y: Coord
    zoom: Annotated[float, Field(ge=CANVAS_ZOOM_MIN, le=CANVAS_ZOOM_MAX, allow_inf_nan=False)]


class Board(Wire):
    board_id: str
    paper_id: str
    title: str
    viewport: Viewport | None
    created_at: WireTime
    updated_at: WireTime


class NotebookCardCounts(Wire):
    """What a notebook card says about its page ("4 quotes · 1 sticky"), counted on read."""

    quotes: NonNegative
    stickies: NonNegative
    text: NonNegative
    shapes: NonNegative
    strokes: NonNegative


BoardBranch = Literal["down", "right"]
UsesPaper = Literal["page", "whole", "off"]
UsesDiagram = Literal["may", "never", "always"]
QuickAsk = Literal["simpler", "example", "diagram"]
AnswerStatus = Literal["streaming", "complete", "error", "partial", "aborted"]
BOARD_QUESTION_MAX = 2000
BOARD_EXTRA_NODES_MAX = 12


class ParentSpan(Wire):
    """The words of a parent answer a branch starts from (spec §1 rule 4): `start` and `end` are
    UTF-16 code units into the parent's stored final answer text (the Markdown the model wrote), and
    `quote` is exactly the words at those offsets, which the store checks."""

    start: NonNegative
    end: Positive
    quote: str = Field(min_length=1, max_length=BOARD_QUESTION_MAX)

    @model_validator(mode="after")
    def _a_span_is_not_empty(self) -> Self:
        if self.end <= self.start:
            raise PydanticCustomError("value_error", "end must be after start")
        return self


class NodeUses(Wire):
    """What an ask reads (spec §2 `uses_json`), shown above the ask box and stored on the card.
    `path` is always the card's ancestors; `paper` is `page` (the root passage's page and the
    pages on each side, tools off), `whole` (tools on) or `off` (the path only); `extra_node_ids`
    are cards the user explicitly attached."""

    path: bool = True
    paper: UsesPaper = "page"
    level: AnswerLevel = "familiar"
    diagram: UsesDiagram = "may"
    extra_node_ids: list[ClientId] = Field(default_factory=list, max_length=BOARD_EXTRA_NODES_MAX)


class CanvasNode(Wire):
    node_id: str
    board_id: str
    kind: NodeKind
    group_id: str | None
    x: float
    y: float
    w: Extent
    h: Extent
    z: SqlInt
    title: str | None
    body: str
    source_anchor: AnchorV1 | None
    source_message_id: str | None
    source_page_id: str | None
    source_diagram_id: str | None
    #: A notebook card's page counts, computed on read; null on every other kind.
    counts: NotebookCardCounts | None
    #: The branching board (0016, v0.3 #343). A root passage or a loose v0.2 card has no parent.
    parent_id: str | None
    branch: BoardBranch | None
    parent_span: ParentSpan | None
    #: An answer card's ask (as typed, or the quick-ask label), and what the ask read.
    question: str | None
    uses: NodeUses | None
    #: The user's drag offset on top of the Tidy layout; `folded` collapses the subtree to a pill.
    offset_x: float
    offset_y: float
    folded: bool
    #: An answer card's answer, read with the board in one query (no thread fetch per card): the
    #: stored final text, the level it was written at, the model that wrote it and its status
    #: (`streaming` while the run is live). All null on every other kind.
    final_text: str | None
    level: AnswerLevel | None
    model: str | None
    answer_status: AnswerStatus | None
    #: The answer's citations (each `[bN]` handle -> its page and Anchor), read in the same query
    #: as `final_text`; the live `locator` is not derived here. Null on every non-answer kind.
    citations: list[Citation] | None
    version: Version
    created_at: WireTime
    updated_at: WireTime


class CanvasEdge(Wire):
    edge_id: str
    board_id: str
    from_node_id: str
    to_node_id: str
    kind: EdgeKind
    label: str | None
    from_port: FromPort | None
    to_port: ToPort | None
    created_at: WireTime


class BoardView(Wire):
    """`GET /papers/{id}/board`: `board` is null until the first explicit send. Never writes."""

    board: Board | None
    nodes: list[CanvasNode]
    edges: list[CanvasEdge]


BROWSER_EVENTS["node"] = CanvasNode  # the board ask's first event: the card its answer streams into


class NodeCreate(Wire):
    """`POST /papers/{id}/board/nodes`. An excerpt needs `source_anchor` (on this paper, which the
    route checks), an explanation needs `source_message_id`."""

    node_id: ClientId
    kind: NodeKind
    x: Coord
    y: Coord
    w: Extent
    h: Extent
    title: CanvasTitle | None = None
    body: CanvasBody = ""
    source_anchor: AnchorV1In | None = omittable(validate_default=True)
    source_message_id: str | None = omittable(validate_default=True)
    source_page_id: str | None = omittable(validate_default=True)
    source_diagram_id: str | None = omittable(validate_default=True)
    group_id: str | None = None
    #: The tree (0016). Used by an undo that puts a deleted subtree back, parents first; the store
    #: holds the rules (one `down` child, a span branch is `right` and its words are the parent's).
    parent_id: str | None = omittable()
    branch: BoardBranch | None = omittable()
    parent_span: ParentSpan | None = omittable()
    question: str | None = omittable(min_length=1, max_length=BOARD_QUESTION_MAX)
    uses: NodeUses | None = omittable()
    offset_x: Coord | None = omittable()
    offset_y: Coord | None = omittable()
    folded: bool | None = omittable()

    @field_validator("source_anchor", mode="after")
    @classmethod
    def _excerpt_needs_an_anchor(cls, value: AnchorV1In | None, info: ValidationInfo) -> Any:
        if value is None and info.data.get("kind") == "excerpt":
            raise PydanticCustomError("missing", "Field required for an excerpt node")
        return value

    @field_validator("source_message_id", mode="after")
    @classmethod
    def _explanation_needs_a_message(cls, value: str | None, info: ValidationInfo) -> Any:
        if value is None and info.data.get("kind") == "explanation":
            raise PydanticCustomError("missing", "Field required for an explanation node")
        return value

    @field_validator("source_page_id", mode="after")
    @classmethod
    def _notebook_needs_a_page(cls, value: str | None, info: ValidationInfo) -> Any:
        if value is None and info.data.get("kind") == "notebook":
            raise PydanticCustomError("missing", "Field required for a notebook node")
        return value

    @field_validator("source_diagram_id", mode="after")
    @classmethod
    def _diagram_needs_a_diagram(cls, value: str | None, info: ValidationInfo) -> Any:
        if value is None and info.data.get("kind") == "diagram":
            raise PydanticCustomError("missing", "Field required for a diagram node")
        return value


class NodeCreated(Wire):
    board: Board
    node: CanvasNode


class NodePatch(Wire):
    """`PATCH /boards/{bid}/nodes/{nid}`: `version` is the one the client last saw."""

    version: Version
    x: Coord | None = omittable()
    y: Coord | None = omittable()
    w: Extent | None = omittable()
    h: Extent | None = omittable()
    z: SqlInt | None = omittable()
    title: CanvasTitle | None = None
    body: CanvasBody | None = omittable()
    group_id: str | None = None
    source_page_id: str | None = omittable()
    source_diagram_id: str | None = omittable()
    offset_x: Coord | None = omittable()
    offset_y: Coord | None = omittable()
    folded: bool | None = omittable()


class AskCreate(Wire):
    """`POST /boards/{bid}/nodes/{nid}/asks` (spec §3): ask about the card, as a branch of it.
    `question` is required unless `quick` names one. The server decides `branch` (rule 3): `down`
    for the first plain ask on a card, `right` for every other, including `ask_differently` and
    every ask with a `span`. `level` (when sent) overrides `uses.level`. `redo_of` is a retry or a
    re-level of an answer card of this board (rule 6): a failed answer with no branches is replaced
    in place, any other answer gets a `right` sibling."""

    node_id: ClientId | None = omittable()
    question: str | None = Field(default=None, min_length=1, max_length=BOARD_QUESTION_MAX)
    span: ParentSpan | None = omittable()
    ask_differently: bool = False
    quick: QuickAsk | None = None
    uses: NodeUses = Field(default_factory=NodeUses)
    level: AnswerLevel | None = omittable()
    redo_of: str | None = omittable()

    @model_validator(mode="after")
    def _a_question_or_a_quick_ask(self) -> Self:
        if self.question is None and self.quick is None and self.redo_of is None:
            raise PydanticCustomError("missing", "question is required unless quick is given")
        return self


class NoteCreate(Wire):
    """`POST /boards/{bid}/nodes/{nid}/notes` (Keep as note): the selected words become a note
    card to the right of the answer. No AI call."""

    node_id: ClientId | None = omittable()
    span: ParentSpan
    text: str = Field(min_length=1, max_length=CANVAS_BODY_MAX)


class TidyRequest(Wire):
    """`POST /boards/{bid}/tidy`: reset the drag offsets of the tree that holds `root_id`."""

    root_id: str


class Tidied(Wire):
    """The cards Tidy changed, with their new versions (one tree, never the loose cards)."""

    nodes: list[CanvasNode]


class StaleVersion(Wire):
    """`409 stale_version` (§2.7): the §0 envelope plus the node as it now is, under `current`."""

    detail: str
    code: Literal["stale_version"]
    retryable: bool
    current: CanvasNode


class EdgeCreate(Wire):
    edge_id: ClientId
    from_node_id: str
    to_node_id: str
    kind: EdgeKind
    label: CanvasLabel | None = None
    #: Both optional: a link made with the keyboard (and every v0.1 edge) has no pins.
    from_port: FromPort | None = None
    to_port: ToPort | None = None

    @field_validator("to_node_id", mode="after")
    @classmethod
    def _not_a_loop(cls, value: str, info: ValidationInfo) -> str:
        if value == info.data.get("from_node_id"):
            raise PydanticCustomError("value_error", "An edge must join two different nodes")
        return value


class EdgePatch(Wire):
    kind: EdgeKind | None = omittable()
    label: CanvasLabel | None = None
    from_port: FromPort | None = None
    to_port: ToPort | None = None


class BoardPatch(Wire):
    title: str | None = omittable(min_length=1, max_length=200)
    viewport: Viewport | None = None


# ── v0.2 notebook (S5a, #206) ───────────────────────────────────────────────────────────────

PageTemplate = Literal["blank", "dot", "lined", "cornell", "derivation"]
NotebookItemKind = Literal["exchange", "text", "sticky", "quote", "shape"]
StrokeTool = Literal["pen", "highlighter"]
StrokeNib = Literal["EF", "F", "M"]
#: Page units (the web's PAGE_WIDTH is 960); same bounds as a canvas card.
NOTEBOOK_BODY_MAX = 100_000
#: A stroke colour is a TOKEN NAME (`pen`, `hl-amber`), never a hex, so a theme can re-map it.
ColourToken = Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]{0,31}$")]
NotebookTitle = Annotated[str, Field(min_length=1, max_length=200)]
#: Base64 of one stroke blob. Generous on the wire so the store, not the parser, answers 413.
PointsB64 = Annotated[str, Field(min_length=1, max_length=8_000_000)]


class NotebookPage(Wire):
    page_id: str
    paper_id: str
    title: str
    template: PageTemplate
    source_thread_id: str | None
    source_message_id: str | None
    version: Version
    created_at: WireTime
    updated_at: WireTime


class NotebookItem(Wire):
    """`anchor` is the full Anchor of a quote (required for `quote`, null otherwise); `body` is the
    typed text, the quote's display cache, or the JSON of an exchange / shape."""

    item_id: str
    page_id: str
    kind: NotebookItemKind
    x: float
    y: float
    w: Extent
    h: Extent
    z: SqlInt
    body: str
    anchor: AnchorV1 | None
    version: Version
    created_at: WireTime
    updated_at: WireTime


class NotebookStroke(Wire):
    stroke_id: str
    page_id: str
    tool: StrokeTool
    nib: StrokeNib
    colour: str
    points_b64: str
    created_at: WireTime


class NotebookCounts(Wire):
    quotes: NonNegative
    stickies: NonNegative
    text: NonNegative
    shapes: NonNegative
    strokes: NonNegative


class NotebookPageSummary(Wire):
    page_id: str
    title: str
    template: PageTemplate
    counts: NotebookCounts
    version: Version
    updated_at: WireTime


class NotebookPageView(Wire):
    """`GET /notebook/pages/{id}`."""

    page: NotebookPage
    items: list[NotebookItem]
    strokes: list[NotebookStroke]


class NotebookPageCreated(Wire):
    """`POST /papers/{id}/notebook/pages` (201): the page and its seeded items."""

    page: NotebookPage
    items: list[NotebookItem]


class NotebookHit(Wire):
    page_id: str
    page_title: str
    item_id: str
    kind: NotebookItemKind
    snippet: str


class NotebookPageCreate(Wire):
    """`from_message_id` is "Dive in": an assistant message of this paper's threads."""

    page_id: ClientId
    title: NotebookTitle | None = omittable(max_length=200)
    template: PageTemplate | None = omittable()
    from_message_id: str | None = omittable(min_length=1, max_length=200)


class NotebookPagePatch(Wire):
    version: Version
    title: NotebookTitle | None = omittable(max_length=200)
    template: PageTemplate | None = omittable()


class NotebookItemCreate(Wire):
    item_id: ClientId
    kind: NotebookItemKind
    x: Coord
    y: Coord
    w: Extent
    h: Extent
    z: SqlInt = 0
    body: Annotated[str, Field(max_length=NOTEBOOK_BODY_MAX)] = ""
    anchor: AnchorV1In | None = omittable(validate_default=True)

    @field_validator("anchor", mode="after")
    @classmethod
    def _quote_needs_an_anchor(cls, value: AnchorV1In | None, info: ValidationInfo) -> Any:
        if value is None and info.data.get("kind") == "quote":
            raise PydanticCustomError("missing", "Field required for a quote")
        return value


class NotebookItemPatch(Wire):
    version: Version
    x: Coord | None = omittable()
    y: Coord | None = omittable()
    w: Extent | None = omittable()
    h: Extent | None = omittable()
    z: SqlInt | None = omittable()
    body: Annotated[str, Field(max_length=NOTEBOOK_BODY_MAX)] | None = omittable()


class NotebookStrokeIn(Wire):
    stroke_id: ClientId
    tool: StrokeTool
    nib: StrokeNib
    colour: ColourToken
    points_b64: PointsB64


class NotebookStrokeBatch(RootModel[list[NotebookStrokeIn]]):
    """`POST /notebook/pages/{id}/strokes`: a bare JSON array, one pen-up batch of 1 to 200."""

    root: Annotated[list[NotebookStrokeIn], Field(min_length=1, max_length=200)]


class NotebookStrokesAdded(Wire):
    added: NonNegative


class NotebookPageStale(Wire):
    """`409 stale_version` on a page: the envelope plus the page as it now is."""

    detail: str
    code: Literal["stale_version"]
    retryable: bool
    current: NotebookPage


class NotebookItemStale(Wire):
    """`409 stale_version` on an item: the envelope plus the item as it now is."""

    detail: str
    code: Literal["stale_version"]
    retryable: bool
    current: NotebookItem


# ── §2.8 health ──────────────────────────────────────────────────────────────────────────────


class AgentHealth(Wire):
    """What the API learned by asking `GET {PAPERTREE_AGENT_URL}/healthz` (§3.2).

    `reachable` is True only for an HTTP 200 whose body is a JSON object. When it is False the
    other two are null: the API does not know, and saying `key_present: false` would claim it did.
    """

    reachable: bool
    key_present: bool | None
    sdk: str | None


class Healthz(Wire):
    ok: bool
    version: str
    db: Literal["ok"]
    migrations: list[int]
    agent: AgentHealth


# ── §4 internal paper tools (agent -> API) ───────────────────────────────────────────────────

ToolName = Literal["get_outline", "get_section", "get_passage", "search_passages"]


class ToolResult(Wire):
    """Every internal tool answers this: model-facing `text` (datamarked), the handles it
    introduced, and a cursor where the tool pages (`get_section`)."""

    text: str
    handles: list[Handle]
    next_cursor: str | None = None


# ── §3.2 the agent's run request and run events (what S5's FakeAgent parses) ─────────────────


class AgentToolAccess(Wire):
    base_url: str = Field(
        pattern=r"^https?://[^/]+/internal/agent/runs/run_[0-9A-HJKMNP-TV-Z]{26}$"
    )
    #: `secrets.token_urlsafe(32)`: 43 base64url characters.
    token: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")


class AgentPaper(Wire):
    title: str
    page_count: NonNegative | None
    generation: Generation


class AgentPassage(Wire):
    handle: Handle
    label: str
    text: str


class AgentSeed(Wire):
    quote: str
    page_label: str
    section: str | None
    passages: list[AgentPassage]


class AgentImage(Wire):
    """A picture of an `image` run (v0.3 #348): a crop PNG, base64, at most 4 MiB of bytes."""

    media_type: Literal["image/png", "image/jpeg"]
    data_base64: str = Field(min_length=8, max_length=5_592_408)
    #: The figure's caption as one short line, and its 0-based page.
    caption: str | None = omittable(max_length=600)
    page: NonNegative | None = omittable()


class AgentHistory(Wire):
    session_id: str = Field(pattern=server_id("thr"))
    #: Pi's `exportEntries()` as of the thread's last completed turn. Opaque to the API.
    entries: list[dict[str, Any]]


class AgentLimits(Wire):
    deadline_ms: Positive
    idle_ms: Positive
    max_tool_calls: NonNegative
    max_turns: Positive
    max_output_tokens: Positive
    max_retries: NonNegative


class AgentRunRequest(Wire):
    """`POST /v1/runs` (§3.2); `contracts/agent/run-request.schema.json` is the same, by hand."""

    run_id: str = Field(pattern=server_id("run"))
    request_id: str = Field(pattern=server_id("req"))
    kind: RunKind
    prompt_version: Literal[
        "explain-v1",
        "ask-v1",
        "summary-v1",
        "diagram-v1",
        "topic-v1",
        "glance-v1",
        "image-v1",
    ]
    tool: AgentToolAccess
    datamark: str = Field(pattern=r"^\^[0-9a-f]{8}$")
    paper: AgentPaper
    seed: AgentSeed | None = Field(validate_default=True)
    question: str = Field(min_length=1, max_length=2000)
    history: AgentHistory | None
    limits: AgentLimits
    #: v0.3 (#339): the level an explain/ask answer is written for, and whether it ends with a
    #: ```check fence (the API decides: contracts.md §2.5). Both are optional on the agent's side.
    level: AnswerLevel = "familiar"
    check: bool = False
    #: v0.3 (#343): whether the answer may / must / must not carry a ```diagram fence. `may` is the
    #: tutor shape's own rule; a board ask's `uses.diagram` sets the others.
    diagram: Literal["may", "never", "always"] = "may"
    #: v0.3 (#348): the crop(s) of an `image` run: required there, refused on every other kind.
    images: list[AgentImage] | None = omittable(min_length=1, max_length=2)

    @model_validator(mode="after")
    def _images_exactly_on_an_image_run(self) -> Self:
        if (self.kind == "image") != (self.images is not None):
            raise PydanticCustomError(
                "images_kind", "images: required on an image run and refused on any other kind"
            )
        return self

    @field_validator("seed", mode="after")
    @classmethod
    def _seed_matches_kind(cls, value: AgentSeed | None, info: ValidationInfo) -> Any:
        kind = info.data.get("kind")
        if kind in ("summary", "explain", "diagram", "topic", "glance", "image") and value is None:
            raise PydanticCustomError("missing", f"Field required for a {kind} run")
        return value


class AgentRun(Wire):
    run_id: str = Field(pattern=server_id("run"))
    model: Literal["minimax/MiniMax-M3", "minimax/MiniMax-M3.1-Flash"]
    sdk: str = Field(pattern=r"^pi-coding-agent@[0-9]+\.[0-9]+\.[0-9]+$")


class AgentStatus(Wire):
    phase: Literal["thinking", "tool", "retrying", "writing"]
    tool: ToolName | None = omittable()
    #: `minLength: 1` in `run-events.schema.json`: an agent that has nothing to say omits it.
    label: str | None = omittable(min_length=1)
    attempt: Positive | None = omittable()
    delay_ms: NonNegative | None = omittable()


class AgentText(Wire):
    delta: str


def _agent_event_defs() -> dict[str, Any]:
    """`$defs` of the committed `contracts/agent/run-events.schema.json`, found by walking up from
    this file (the agent finds the same file the same way, `contract.ts`)."""
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "contracts" / "agent" / "run-events.schema.json"
        if candidate.is_file():
            defs: dict[str, Any] = json.loads(candidate.read_text(encoding="utf-8"))["$defs"]
            return defs
    raise RuntimeError("contracts/agent/run-events.schema.json not found above papertree_api")


def _text(node: dict[str, Any]) -> Any:
    """A `str` field bounded exactly as the schema node says. pydantic counts code points, as JSON
    Schema does (and as the agent's zod does, `text.ts`), so the two sides agree on every bound."""
    return Field(min_length=node.get("minLength"), max_length=node["maxLength"])


#: The ONE place a diagram line's text limits are written (S7a review): the agent contract.
_EVENT_DEFS: Final = _agent_event_defs()
_PART: Final = _EVENT_DEFS["part"]["properties"]


class AgentPlate(Wire):
    """A diagram run's first line (`run-events.schema.json` `$defs.plate`, v0.2 S7a)."""

    title: str = _text(_EVENT_DEFS["plate"]["properties"]["title"])


class AgentCite(Wire):
    """The model's quote for a part, before the API looked for it in the paper."""

    quote: str = _text(_EVENT_DEFS["PartCite"]["properties"]["quote"])
    #: A hint only; the resolver never trusts it.
    page: Positive | None = omittable()


class AgentPart(Wire):
    """One part as the agent checked it (`$defs.part`): its letter by arrival, `after` from
    earlier letters only, one `edge` label (or null) per `after` entry."""

    letter: Letter
    label: str = _text(_PART["label"])
    text: str = _text(_PART["text"])
    kind: DiagramPartKind
    after: list[Letter] = Field(max_length=_PART["after"]["maxItems"])
    edge: list[Annotated[str, _text(_PART["edge"]["items"]["anyOf"][0])] | None] = Field(
        max_length=_PART["edge"]["maxItems"]
    )
    cite: AgentCite | None


class AgentLink(Wire):
    """A feedback edge between two placed parts (`$defs.link`)."""

    source: Letter
    target: Letter
    label: Annotated[str, _text(_EVENT_DEFS["link"]["properties"]["label"]["anyOf"][0])] | None


class AgentUsage(Wire):
    """Per assistant message (`usage`) and summed over the run (`done.usage_totals`).
    `reasoning` is null when the provider does not report it (Pi leaves it undefined)."""

    input: NonNegative
    output: NonNegative
    cache_read: NonNegative
    cache_write: NonNegative
    reasoning: NonNegative | None
    cost_usd_est: Usd


class AgentRunError(Wire):
    code: RunErrorCode
    retryable: bool
    message: str


#: Pi's `StopReason` (`@earendil-works/pi-ai` 0.87.1 `types.d.ts`); null when the run produced no
#: assistant message at all.
StopReason = Literal["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"]


class AgentDone(Wire):
    status: DoneStatus
    stop_reason: StopReason | None
    error: AgentRunError | None
    final_text: str
    handles_seen: list[Handle]
    markers: list[Handle]
    usage_totals: AgentUsage
    tool_calls: NonNegative
    turns: NonNegative
    retries: NonNegative
    first_text_ms: NonNegative | None
    latency_ms: NonNegative
    entries: list[dict[str, Any]]

    @field_validator("error", mode="after")
    @classmethod
    def _error_matches_status(cls, value: AgentRunError | None, info: ValidationInfo) -> Any:
        status = info.data.get("status")
        if status == "complete" and value is not None:
            raise PydanticCustomError("value_error", "A complete run carries no error")
        if status in {"partial", "error", "aborted"} and value is None:
            raise PydanticCustomError("missing", f"Field required when the status is {status}")
        return value


#: event name -> the model of its `data` (§3.2). `usage` is per assistant message.
AGENT_EVENTS: Final[dict[str, type[Wire]]] = {
    "run": AgentRun,
    "status": AgentStatus,
    "text": AgentText,
    "plate": AgentPlate,
    "part": AgentPart,
    "link": AgentLink,
    "usage": AgentUsage,
    "done": AgentDone,
}


def parse_agent_event(event: str, data: str | bytes) -> Wire:
    """One agent SSE frame's `data`, as its model. `KeyError` for an event the contract does not
    name; `pydantic.ValidationError` for data that is not that event's shape."""
    return AGENT_EVENTS[event].model_validate_json(data)
