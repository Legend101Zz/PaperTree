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

from typing import Annotated, Any, Final, Literal, Self

from papertree_db import SQLITE_INTEGER_MAX
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    ValidationError,
    ValidationInfo,
    WithJsonSchema,
    field_validator,
    model_validator,
)
from pydantic.fields import FieldInfo
from pydantic_core import InitErrorDetails, PydanticCustomError

from .errors import ErrorCode, RunErrorCode
from .wiretime import wire_time

# ── building blocks ──────────────────────────────────────────────────────────────────────────


class Wire(BaseModel):
    """The base of every wire model."""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

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


class Me(Wire):
    user_id: str
    email: str


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
ThreadKind = Literal["explain", "ask"]
RunKind = Literal["explain", "ask", "summary"]
DoneStatus = Literal["complete", "partial", "error", "aborted"]


class MessageError(Wire):
    code: RunErrorCode | ErrorCode
    retryable: bool
    message: str


class Citation(Wire):
    citation_id: str
    ordinal: NonNegative
    #: The handle as the model wrote it, e.g. `b3`.
    marker: Handle
    page_index: PageIndex
    anchor: AnchorV1
    supported: bool | None


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


class ThreadDetail(Wire):
    thread: Thread
    messages: list[Message]


DEFAULT_QUESTION: Final = "Explain this passage."


class ThreadCreate(Wire):
    """`POST /papers/{id}/threads`. `anchor` is required for `explain`."""

    kind: ThreadKind
    anchor: AnchorV1In | None = omittable(validate_default=True)
    question: str = Field(default=DEFAULT_QUESTION, min_length=1, max_length=2000)

    @field_validator("anchor", mode="after")
    @classmethod
    def _explain_needs_an_anchor(cls, value: AnchorV1In | None, info: ValidationInfo) -> Any:
        if value is None and info.data.get("kind") == "explain":
            raise PydanticCustomError("missing", "Field required for an explain thread")
        return value


class FollowUp(Wire):
    """`POST /papers/{id}/threads/{tid}/messages`."""

    question: str = Field(min_length=1, max_length=2000)
    #: Re-run a failed assistant message instead of appending a new user turn.
    retry_of: str | None = omittable(pattern=server_id("msg"))


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
    "usage": RunSummary,
    "done": SseDone,
}

# ── §2.5 summary ─────────────────────────────────────────────────────────────────────────────


class SummaryBullet(Wire):
    text: str
    citations: list[Citation]
    supported: bool


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


class UsageTotals(Wire):
    since: WireTime
    runs: NonNegative
    input_tokens: NonNegative
    output_tokens: NonNegative
    cost_usd_est: Usd
    budget_usd: Usd
    by_kind: UsageByKind


# ── §2.7 canvas ──────────────────────────────────────────────────────────────────────────────

NodeKind = Literal["excerpt", "explanation", "note", "group"]
EdgeKind = Literal[
    "supports", "contradicts", "derives_from", "answers", "compares", "references", "relates"
]
#: `canvas_nodes.z` and `version` are INTEGER columns.
SqlInt = Annotated[int, Field(ge=-SQLITE_INTEGER_MAX, le=SQLITE_INTEGER_MAX)]
Version = Annotated[int, Field(ge=1, le=SQLITE_INTEGER_MAX)]
Extent = Annotated[float, Field(gt=0)]


class Viewport(Wire):
    x: float
    y: float
    zoom: Annotated[float, Field(gt=0)]


class Board(Wire):
    board_id: str
    paper_id: str
    title: str
    viewport: Viewport | None
    created_at: WireTime
    updated_at: WireTime


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


class BoardView(Wire):
    """`GET /papers/{id}/board`: `board` is null until the first explicit send. Never writes."""

    board: Board | None
    nodes: list[CanvasNode]
    edges: list[CanvasEdge]


class NodeCreate(Wire):
    """`POST /papers/{id}/board/nodes`. An excerpt needs `source_anchor` (on this paper, which the
    route checks), an explanation needs `source_message_id`."""

    node_id: ClientId
    kind: NodeKind
    x: float
    y: float
    w: Extent
    h: Extent
    title: str | None = None
    body: str = ""
    source_anchor: AnchorV1In | None = omittable(validate_default=True)
    source_message_id: str | None = omittable(validate_default=True)
    group_id: str | None = None

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


class NodeCreated(Wire):
    board: Board
    node: CanvasNode


class NodePatch(Wire):
    """`PATCH /boards/{bid}/nodes/{nid}`: `version` is the one the client last saw."""

    version: Version
    x: float | None = omittable()
    y: float | None = omittable()
    w: Extent | None = omittable()
    h: Extent | None = omittable()
    z: SqlInt | None = omittable()
    title: str | None = None
    body: str | None = omittable()
    group_id: str | None = None


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
    label: str | None = None

    @field_validator("to_node_id", mode="after")
    @classmethod
    def _not_a_loop(cls, value: str, info: ValidationInfo) -> str:
        if value == info.data.get("from_node_id"):
            raise PydanticCustomError("value_error", "An edge must join two different nodes")
        return value


class EdgePatch(Wire):
    kind: EdgeKind | None = omittable()
    label: str | None = None


class BoardPatch(Wire):
    title: str | None = omittable(min_length=1, max_length=200)
    viewport: Viewport | None = None


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
    prompt_version: Literal["explain-v1", "ask-v1", "summary-v1"]
    tool: AgentToolAccess
    datamark: str = Field(pattern=r"^\^[0-9a-f]{8}$")
    paper: AgentPaper
    seed: AgentSeed | None = Field(validate_default=True)
    question: str = Field(min_length=1, max_length=2000)
    history: AgentHistory | None
    limits: AgentLimits

    @field_validator("seed", mode="after")
    @classmethod
    def _seed_matches_kind(cls, value: AgentSeed | None, info: ValidationInfo) -> Any:
        kind = info.data.get("kind")
        if kind == "summary" and value is not None:
            raise PydanticCustomError("value_error", "A summary run has no seed")
        if kind == "explain" and value is None:
            raise PydanticCustomError("missing", "Field required for an explain run")
        return value


class AgentRun(Wire):
    run_id: str
    model: str
    sdk: str


class AgentStatus(Wire):
    phase: Literal["thinking", "tool", "retrying", "writing"]
    tool: ToolName | None = omittable()
    label: str | None = omittable()
    attempt: Positive | None = omittable()
    delay_ms: NonNegative | None = omittable()


class AgentText(Wire):
    delta: str


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
    "usage": AgentUsage,
    "done": AgentDone,
}


def parse_agent_event(event: str, data: str | bytes) -> Wire:
    """One agent SSE frame's `data`, as its model. `KeyError` for an event the contract does not
    name; `pydantic.ValidationError` for data that is not that event's shape."""
    return AGENT_EVENTS[event].model_validate_json(data)
