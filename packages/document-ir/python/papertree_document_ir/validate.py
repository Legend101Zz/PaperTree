"""document-ir/validate - the SEMANTIC VALIDATOR: the invariants JSON Schema cannot express.

``DESIGN.md`` section 5.2 is the specification. Every rule below carries its 5.2 number in
``RuleInfo.design`` and the rule list is exported as ``SEMANTIC_RULES``, so "which rules exist" is
data rather than folklore. ``src/validate.ts`` is the twin; both are graded against
``conformance/validator-cases.json``, and neither is the other's oracle.

PRECONDITION: the input is already SCHEMA-VALID (``Paper.model_validate`` here, ajv/zod there).
This module checks the layer *above* that and deliberately does not re-check field shapes - with
two exceptions that exist because a caller may skip the schema: rule G5 (finite coordinates) and
the defensive resolution guards, which turn a dangling id into a diagnostic instead of a crash.

WHAT IS AND IS NOT PART OF THE CROSS-LANGUAGE CONTRACT.

* IN:  the ordered list of ``(rule, severity, path)`` triples. Both languages emit them in the
  same order - rules run in ``SEMANTIC_RULES`` order, each iterating in document order.
* OUT: ``message``. It is human-facing and interpolates numbers, and ``str(1.0)`` is ``"1.0"``
  here while ``String(1.0)`` is ``"1"`` in JS. Pinning message bytes across the two runtimes would
  buy nothing and would fail for reasons that have nothing to do with the rule.

SEVERITY. Everything is ERROR except the two places DESIGN.md 5.2 says otherwise: rule 3 (polygon
outside crop_box) is a WARN until G7's 5%-of-page threshold promotes it, and the
self-intersecting-ring half of G6 is a WARN because a bowtie is a parser bug rather than a
data-integrity failure.

NOT IMPLEMENTED HERE, deliberately - see the module's report and DESIGN.md 5.2:

* rule 32b  Tier B, owned by Epic 1 (the grid->HTML serialiser lives there).
* rule 34   Tier B, owned by Epic 3 (cross-document; Epic 0 has no second store to check).
* rule 33   deleted by DESIGN.md D20.
"""

from __future__ import annotations

import math
import unicodedata
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from papertree_document_ir.generated.models import (
    Block,
    Flows,
    Page,
    Paper,
    Repair,
    Section,
    is_known_heading_block_type,
)
from papertree_document_ir.geometry import (
    BBOX_EXTENT_EPSILON_PT,
    bbox_matches_polygon_extent,
    polygon_area,
    polygon_extent,
    polygon_is_simple,
)
from papertree_document_ir.identity import (
    LIGATURE_TABLE,
    WHITESPACE_CODE_POINTS,
    BlockIdInput,
    normalise_text,
)
from papertree_document_ir.identity import block_id as recompute_block_id
from papertree_document_ir.identity import (
    content_hash_of_normalised as compute_content_hash,
)

__all__ = [
    "SEMANTIC_RULES",
    "Diagnostic",
    "RuleInfo",
    "SemanticValidationError",
    "Severity",
    "ValidateOptions",
    "ValidationReport",
    "assert_valid_paper",
    "format_diagnostics",
    "validate_paper",
]

# ─── PUBLIC SHAPES ──────────────────────────────────────────────────────────────────────────

#: WARN is "a parser bug worth reporting"; ERROR is "this document is not internally consistent".
Severity = Literal["error", "warning"]


@dataclass(frozen=True, slots=True)
class Diagnostic:
    """One finding. ``(rule, severity, path)`` is the cross-language contract, ``message`` not."""

    #: The rule id, e.g. ``"R14"``, ``"G7"``, ``"I1"``. See ``SEMANTIC_RULES`` for the 5.2 mapping.
    rule: str
    severity: Severity
    #: Where in the document: ``blocks[3].bbox``, ``pages[0].flows.body[1]``, ``references[2].doi``.
    path: str
    #: Human-facing. Deliberately NOT part of the cross-language contract; see the module doc.
    message: str


@dataclass(frozen=True, slots=True)
class ValidationReport:
    #: True when there is no diagnostic of severity ``"error"``. Warnings do not fail a document.
    ok: bool
    #: Every diagnostic, in rule order and then document order.
    diagnostics: tuple[Diagnostic, ...]
    errors: tuple[Diagnostic, ...]
    warnings: tuple[Diagnostic, ...]


@dataclass(frozen=True, slots=True)
class ValidateOptions:
    """Knobs. Every default is the one DESIGN.md 5.2 states; overriding one is a decision."""

    #: Rule ids to skip. The one rule anybody legitimately disables is ``"I1"`` - a fixture written
    #: by hand carries invented block ids and cannot satisfy it.
    disabled_rules: frozenset[str] = frozenset()
    #: Tolerance for rule 1 (bbox == polygon extent) and G4.
    bbox_epsilon_pt: float = BBOX_EXTENT_EPSILON_PT
    #: Tolerance for rule 3 / G7 containment.
    crop_box_tolerance_pt: float = BBOX_EXTENT_EPSILON_PT
    #: G7's promotion threshold as a fraction of a page's blocks.
    out_of_crop_box_error_fraction: float = 0.05
    #: G8's minimum union coverage as a fraction of page area.
    min_page_coverage_fraction: float = 0.01


@dataclass(frozen=True, slots=True)
class RuleInfo:
    id: str
    #: The DESIGN.md 5.2 rule number this implements.
    design: str
    title: str
    #: The severity the rule emits, or its worst when it emits more than one.
    severity: Severity
    tier: Literal["A"]


class SemanticValidationError(ValueError):
    """Raised by :func:`assert_valid_paper`. Carries every diagnostic, not just the first."""

    def __init__(self, diagnostics: Sequence[Diagnostic]) -> None:
        errors = [d for d in diagnostics if d.severity == "error"]
        first = errors[0] if errors else None
        super().__init__(
            f"PaperIR failed semantic validation: {len(errors)} error(s), first is "
            f"{first.rule if first else '?'} at {first.path if first else '?'} - "
            f"{first.message if first else ''}"
        )
        self.diagnostics: tuple[Diagnostic, ...] = tuple(diagnostics)


def _rule(id_: str, design: str, title: str, severity: Severity = "error") -> RuleInfo:
    return RuleInfo(id=id_, design=design, title=title, severity=severity, tier="A")


#: Every rule this module implements, in the order it runs - which is also the order diagnostics
#: come out in. Exported so a caller can enumerate coverage rather than trust a comment.
SEMANTIC_RULES: tuple[RuleInfo, ...] = (
    _rule("G5", "G5", "every polygon/bbox coordinate is finite"),
    _rule("R2", "2", "every bbox satisfies x0 <= x1 and y0 <= y1"),
    _rule("R1", "1", "block.bbox equals the extent of block.polygon"),
    _rule("G6", "G6", "block polygon has positive area (error) and a simple ring (warn)"),
    _rule("R3", "3", "block polygon lies within the page crop_box", "warning"),
    _rule("G7", "G7", "rule 3 promoted to error past 5% of a page's blocks"),
    _rule("G4", "G4", "page.width/height match crop_box, and crop_box starts at (0,0)"),
    _rule("G8", "G8", "block bboxes cover >= 1% of the page area"),
    _rule("R8", "8", "block ids, page ids and page indices are unique"),
    _rule("R40", "40", "page indices are contiguous 0..n-1; pages exist when blocks do"),
    _rule("R41", "41", "status and partial_reason agree"),
    _rule("R13", "13", "confidence.by_page has one entry per page; weakest_pages resolve"),
    _rule("R13b", "13b", "a complete paper has no null confidences"),
    _rule("R10", "10", "page.block_ids is exactly the blocks claiming that page"),
    _rule("R11", "11", "page.flows partition the page's top-level blocks by flow"),
    _rule("R42", "42", "no nested block appears in any page.flows[f]"),
    _rule("R12", "12", "each page.flows[f] is in ascending block.order"),
    _rule("R14", "14", "order is dense and unique within (page_index, flow, container)"),
    _rule("R15", "15", "doc_order is on exactly the top-level body blocks, dense and unique"),
    _rule("R16", "16", "doc_order does not run backwards through (page_index, order)"),
    _rule("R4", "4", "every relation endpoint resolves to a block"),
    _rule("R5", "5", "parent_id, prev_id, next_id and child_ids[] resolve"),
    _rule("R6", "6", "metadata source_block_id and abstract.block_ids[] resolve"),
    _rule("R6b", "6b", "a metadata value is a substring of its source block's text"),
    _rule("R7", "7", "every other block-id-bearing field resolves"),
    _rule("R9", "9", "relations are unique on (type, from, to)"),
    _rule("R17", "17", "parent_id and child_ids are mutually consistent"),
    _rule("R18", "18", "prev_id/next_id are mutual and link siblings only"),
    _rule("R19", "19", "parent_of and next_in_reading_order agree with the fields"),
    _rule("R20", "20", "the parent graph and the sibling chain are acyclic"),
    _rule("R21", "21", "section.level and heading_block_id are consistent"),
    _rule("R38", "38", "section.block_ids excludes its heading, duplicates and nested blocks"),
    _rule("R22", "22", "caption_of and payload.caption_block are typed correctly"),
    _rule("R23", "23", "cites.to points at a reference_entry block"),
    _rule("R24", "24", "continues_on_next_page crosses pages in ascending order"),
    _rule("R24b", "24b", "continues_in_next_column stays on the page with disjoint x-extents"),
    _rule("R25", "25", "span offsets lie within the stored text"),
    _rule("R26", "26", "spans do not overlap and ascend by start"),
    _rule("R27", "27", "repair.at addresses the text the repair claims"),
    _rule("R28", "28", "text_normalised is the library's normalisation of text"),
    _rule("R29", "29", "content_hash is the library's digest of text_normalised"),
    _rule("R30", "30", "model-authored repairs carry model_id and prompt_hash"),
    _rule("R30b", "30b", "a deterministic repair is reproducibly an edit of its own class"),
    _rule("R31", "31", "at most one selected alternative, and it matches block.text"),
    _rule("R32", "32", "table grid cells agree with their table_cell blocks"),
    _rule("R35", "35", "every Reference scalar appears in its entry block's text"),
    _rule("R36", "36", "a complete paper has rendered crops on equations and figures"),
    _rule("R37", "37", "pdf_text_layer text carries text_normalised and content_hash"),
    _rule("R39", "39", "an inline_equation payload has display == false"),
    _rule("I1", "(added)", "block_id equals identity.block_id() recomputed from the block"),
)

_RULE_SEVERITY: dict[str, Severity] = {r.id: r.severity for r in SEMANTIC_RULES}

_FLOW_KEYS = ("body", "caption", "footnote", "header", "footer", "margin")
_MODEL_REPAIR_KINDS = frozenset({"ocr_correction", "vlm_substitution"})
_DETERMINISTIC_REPAIR_KINDS = frozenset(
    {"dehyphenate", "ligature", "unicode_normalise", "whitespace", "reorder"}
)
#: DESIGN.md rule 22: what ``caption_of.to`` may point at.
_FLOAT_BLOCK_TYPES = frozenset({"figure", "table", "diagram", "plot"})
#: DESIGN.md rule 36 / D16: the types whose payload carries a required-and-nullable ``image``.
_CROPPED_BLOCK_TYPES = frozenset({"equation", "inline_equation", "figure"})
_METADATA_VALUE_FIELDS = ("title", "doi", "arxiv_id", "venue")
_REFERENCE_STRING_FIELDS = ("title", "venue", "doi", "arxiv_id", "url")
_SOURCE_HASH_PREFIX = "sha256:"


# ─── SMALL SHARED HELPERS ───────────────────────────────────────────────────────────────────


def _fmt(value: float) -> str:
    """Numbers in MESSAGES only. Message bytes are not part of the cross-language contract."""
    if value == 0:
        return "0"
    if float(value).is_integer() and abs(value) < 1e21:
        return str(int(value))
    return repr(value)


def _quote(value: str) -> str:
    trimmed = value[:57] + "..." if len(value) > 60 else value
    return '"' + trimmed.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _collapse_whitespace(text: str) -> str:
    """Step 3 of the identity normalisation, ALONE.

    Rule 30b's ``whitespace`` class is defined in terms of whitespace collapse only, so it must not
    also case-fold. The 26-code-point table is imported from ``identity`` rather than re-enumerated
    so the two cannot drift.
    """
    out: list[str] = []
    in_run = False
    for ch in text:
        if ord(ch) in WHITESPACE_CODE_POINTS:
            if not in_run:
                out.append(" ")
            in_run = True
        else:
            out.append(ch)
            in_run = False
    return "".join(out).strip(" ")


def _expand_ligatures(text: str) -> str:
    """Step 2 of the identity normalisation, ALONE - rule 30b's ``ligature`` class. Case kept."""
    return "".join(LIGATURE_TABLE.get(ord(ch), ch) for ch in text)


_HYPHENS = frozenset({0x002D, 0x00AD, 0x2010})
_LINE_BREAKS = frozenset({0x000A, 0x000D, 0x2028, 0x2029})
_INLINE_SPACES = frozenset({0x0020, 0x0009})


def _dehyphenate(text: str) -> str:
    """The canonical dehyphenation transform for rule 30b.

    Delete every ``hyphen . spaces? . line break . spaces?`` run, and delete every remaining SOFT
    hyphen (U+00AD is invisible by definition, so its removal is the same class of edit even
    without a break).

    Written as one total function rather than "does ``to`` look plausibly dehyphenated", because
    30b's whole point is that a deterministic repair must be REPRODUCIBLE: ``dehyphenate(from) ==
    to`` or it is not a dehyphenation.
    """
    points = [ord(ch) for ch in text]
    out: list[int] = []
    i = 0
    while i < len(points):
        point = points[i]
        if point in _HYPHENS:
            j = i + 1
            while j < len(points) and points[j] in _INLINE_SPACES:
                j += 1
            if j < len(points) and points[j] in _LINE_BREAKS:
                while j < len(points) and points[j] in _LINE_BREAKS:
                    j += 1
                while j < len(points) and points[j] in _INLINE_SPACES:
                    j += 1
                i = j
                continue
            if point == 0x00AD:
                i += 1
                continue
        out.append(point)
        i += 1
    return "".join(chr(p) for p in out)


def _token_multiset(text: str) -> dict[str, int]:
    """Whitespace-separated tokens as a MULTISET.

    A multiset rather than a sorted list because JS sorts strings by UTF-16 code unit and Python by
    code point, and the two orders differ above U+FFFF - dict equality has no ordering in it at all.
    ``str.split()`` is deliberately not used: its whitespace set is Python's, not the contract's.
    """
    counts: dict[str, int] = {}
    current: list[str] = []
    for ch in text:
        if ord(ch) in WHITESPACE_CODE_POINTS:
            if current:
                token = "".join(current)
                counts[token] = counts.get(token, 0) + 1
                current = []
        else:
            current.append(ch)
    if current:
        token = "".join(current)
        counts[token] = counts.get(token, 0) + 1
    return counts


def _rect_union_area(rects: Sequence[Sequence[float]]) -> float:
    """Exact union area of axis-aligned rectangles, by coordinate compression over x."""
    if not rects:
        return 0.0
    xs = sorted({r[0] for r in rects} | {r[2] for r in rects})
    total = 0.0
    for left, right in zip(xs, xs[1:], strict=False):
        width = right - left
        if width <= 0:
            continue
        intervals = [(r[1], r[3]) for r in rects if r[0] <= left and r[2] >= right and r[3] > r[1]]
        if not intervals:
            continue
        intervals.sort()
        covered = 0.0
        cursor_start, cursor_end = intervals[0]
        for start, end in intervals[1:]:
            if start > cursor_end:
                covered += cursor_end - cursor_start
                cursor_start, cursor_end = start, end
            elif end > cursor_end:
                cursor_end = end
        covered += cursor_end - cursor_start
        total += covered * width
    return total


def _all_finite(values: Iterable[float]) -> bool:
    return all(math.isfinite(v) for v in values)


def _polygon_finite(polygon: Sequence[Sequence[float]]) -> bool:
    return all(_all_finite(vertex) for vertex in polygon)


def _payload(block: Block) -> dict[str, Any]:
    return block.payload or {}


def _table_cells(payload: dict[str, Any]) -> list[tuple[int, dict[str, Any]]]:
    grid = payload.get("grid")
    if not isinstance(grid, dict):
        return []
    cells = grid.get("cells")
    if not isinstance(cells, list):
        return []
    return [(i, c) for i, c in enumerate(cells) if isinstance(c, dict)]


def _flow_map(flows: Flows) -> dict[str, list[str]]:
    return {
        "body": flows.body,
        "caption": flows.caption,
        "footnote": flows.footnote,
        "header": flows.header,
        "footer": flows.footer,
        "margin": flows.margin,
    }


# ─── CONTEXT ────────────────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class _Ctx:
    paper: Paper
    blocks: list[Block]
    pages: list[Page]
    by_id: dict[str, Block]
    #: Index of the FIRST block carrying each id, so a duplicate id (rule 8) still localises.
    index_by_id: dict[str, int]
    page_by_index: dict[int, Page]
    blocks_on_page: dict[int, list[Block]]
    options: ValidateOptions
    out: list[Diagnostic] = field(default_factory=list)

    def emit(self, rule: str, path: str, message: str, severity: Severity | None = None) -> None:
        if rule in self.options.disabled_rules:
            return
        self.out.append(
            Diagnostic(
                rule=rule,
                severity=severity if severity is not None else _RULE_SEVERITY.get(rule, "error"),
                path=path,
                message=message,
            )
        )

    def is_nested(self, block: Block) -> bool:
        """A block whose ``parent_id`` names a NON-heading block is NESTED (DESIGN.md 3.2 / D14)."""
        if block.parent_id is None:
            return False
        parent = self.by_id.get(block.parent_id)
        # An UNRESOLVED parent nests by default - the same safe direction 3.2 chose for an unknown
        # parent TYPE. Splicing the children of a container we cannot see into the body stream is
        # the damaging error; rule 5 reports the dangling id separately.
        if parent is None:
            return True
        return not is_known_heading_block_type(parent.type)

    def block_path(self, block_id: str) -> str:
        index = self.index_by_id.get(block_id)
        return f"blocks[?{block_id}]" if index is None else f"blocks[{index}]"

    def resolve(self, rule: str, block_id: str, path: str, what: str) -> Block | None:
        block = self.by_id.get(block_id)
        if block is None:
            self.emit(
                rule,
                path,
                f"{what} names {_quote(block_id)}, which is not a block in this document",
            )
        return block


# ─── GEOMETRY RULES ─────────────────────────────────────────────────────────────────────────


def _rule_g5(ctx: _Ctx) -> None:
    for p, page in enumerate(ctx.pages):
        for key in ("crop_box", "media_box"):
            box: list[float] = getattr(page, key)
            if not _all_finite(box):
                ctx.emit("G5", f"pages[{p}].{key}", f"{key} contains a non-finite coordinate")
    for b, block in enumerate(ctx.blocks):
        if not _all_finite(block.bbox):
            ctx.emit("G5", f"blocks[{b}].bbox", "bbox contains a non-finite coordinate")
        for v, vertex in enumerate(block.polygon):
            if not _all_finite(vertex):
                ctx.emit("G5", f"blocks[{b}].polygon[{v}]", "polygon vertex is not finite")
        for s, span in enumerate(block.spans or []):
            if not _all_finite(span.bbox):
                ctx.emit(
                    "G5",
                    f"blocks[{b}].spans[{s}].bbox",
                    "span bbox contains a non-finite coordinate",
                )


def _check_box_order(ctx: _Ctx, box: Sequence[float], path: str) -> None:
    if not _all_finite(box):
        return  # G5 already said so; a NaN comparison here would say nothing.
    if box[0] > box[2] or box[1] > box[3]:
        joined = ", ".join(_fmt(v) for v in box)
        ctx.emit("R2", path, f"bbox must satisfy x0 <= x1 and y0 <= y1, got [{joined}]")


def _rule_r2(ctx: _Ctx) -> None:
    for p, page in enumerate(ctx.pages):
        _check_box_order(ctx, page.crop_box, f"pages[{p}].crop_box")
        _check_box_order(ctx, page.media_box, f"pages[{p}].media_box")
    for b, block in enumerate(ctx.blocks):
        _check_box_order(ctx, block.bbox, f"blocks[{b}].bbox")
        for s, span in enumerate(block.spans or []):
            _check_box_order(ctx, span.bbox, f"blocks[{b}].spans[{s}].bbox")


def _rule_r1(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        if not _all_finite(block.bbox) or not _polygon_finite(block.polygon):
            continue
        if not block.polygon:
            continue
        # polygon_extent() is the CANONICAL implementation (geometry.py). A second extent loop here
        # is exactly the drift this rule exists to catch, so the rule calls the producer's own
        # function.
        if not bbox_matches_polygon_extent(block.bbox, block.polygon, ctx.options.bbox_epsilon_pt):
            extent = polygon_extent(block.polygon)
            got = ", ".join(_fmt(v) for v in block.bbox)
            want = ", ".join(_fmt(v) for v in extent)
            ctx.emit(
                "R1",
                f"blocks[{b}].bbox",
                f"bbox [{got}] is not the polygon extent [{want}] "
                f"(epsilon {ctx.options.bbox_epsilon_pt})",
            )


def _rule_g6(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        if not _polygon_finite(block.polygon):
            continue
        area = polygon_area(block.polygon)
        if not area > 0:
            ctx.emit(
                "G6",
                f"blocks[{b}].polygon",
                f"polygon must have strictly positive area, got {_fmt(area)}",
                "error",
            )
            continue  # A degenerate ring is not meaningfully "simple"; one diagnostic is enough.
        if not polygon_is_simple(block.polygon):
            ctx.emit(
                "G6",
                f"blocks[{b}].polygon",
                "polygon ring is self-intersecting (a bowtie): a parser bug, not a "
                "data-integrity failure",
                "warning",
            )


def _rule_r3_and_g7(ctx: _Ctx) -> None:
    """Rules 3 and G7 together: the individual diagnostic IS the promoted one past the threshold."""
    for page_index, blocks in ctx.blocks_on_page.items():
        page = ctx.page_by_index.get(page_index)
        if page is None or not _all_finite(page.crop_box):
            continue
        cx0, cy0, cx1, cy1 = page.crop_box
        tol = ctx.options.crop_box_tolerance_pt
        outside = [
            block
            for block in blocks
            if _polygon_finite(block.polygon)
            and any(
                v[0] < cx0 - tol or v[0] > cx1 + tol or v[1] < cy0 - tol or v[1] > cy1 + tol
                for v in block.polygon
            )
        ]
        if not outside:
            continue
        promoted = bool(blocks) and len(outside) / len(blocks) > (
            ctx.options.out_of_crop_box_error_fraction
        )
        crop = ", ".join(_fmt(v) for v in page.crop_box)
        for block in outside:
            detail = f"polygon leaves the page crop_box [{crop}]"
            if promoted:
                detail += (
                    f" - and {len(outside)}/{len(blocks)} blocks on page {page_index} do, which "
                    f"is a systematic coordinate-space error rather than parser jitter (G7)"
                )
            ctx.emit(
                "G7" if promoted else "R3",
                f"{ctx.block_path(block.block_id)}.polygon",
                detail,
                "error" if promoted else "warning",
            )


def _rule_g4(ctx: _Ctx) -> None:
    for p, page in enumerate(ctx.pages):
        if not _all_finite(page.crop_box):
            continue
        x0, y0, x1, y1 = page.crop_box
        eps = ctx.options.bbox_epsilon_pt
        crop = ", ".join(_fmt(v) for v in page.crop_box)
        if abs(x0) > eps or abs(y0) > eps:
            ctx.emit(
                "G4",
                f"pages[{p}].crop_box",
                f"crop_box must start at (0, 0) - geometry is CropBox-relative (D23) - "
                f"got [{crop}]",
            )
        if abs(page.width - (x1 - x0)) > eps:
            ctx.emit(
                "G4",
                f"pages[{p}].width",
                f"page.width {_fmt(page.width)} != crop_box[2] - crop_box[0] = {_fmt(x1 - x0)}",
            )
        if abs(page.height - (y1 - y0)) > eps:
            ctx.emit(
                "G4",
                f"pages[{p}].height",
                f"page.height {_fmt(page.height)} != crop_box[3] - crop_box[1] = {_fmt(y1 - y0)}",
            )


def _rule_g8(ctx: _Ctx) -> None:
    for p, page in enumerate(ctx.pages):
        blocks = ctx.blocks_on_page.get(page.index, [])
        # A page with no blocks carries no coordinate evidence at all. Failing a legitimately blank
        # page would make the rule unusable on real documents, which is not what G8 is for.
        if not blocks:
            continue
        page_area = page.width * page.height
        if not page_area > 0:
            continue  # the schema bounds these > 0; G4 owns the disagreement.
        threshold = page_area * ctx.options.min_page_coverage_fraction
        rects = [
            b.bbox
            for b in blocks
            if _all_finite(b.bbox) and b.bbox[2] > b.bbox[0] and b.bbox[3] > b.bbox[1]
        ]
        # Fast path: a single bbox already over the threshold makes the union over it too. On a real
        # page one paragraph clears 1% on its own, so the O(n^2) sweep below almost never runs.
        largest = max((r[2] - r[0]) * (r[3] - r[1]) for r in rects) if rects else 0.0
        if largest >= threshold:
            continue
        union = _rect_union_area(rects)
        if union < threshold:
            percent = 100 * union / page_area
            floor = 100 * ctx.options.min_page_coverage_fraction
            ctx.emit(
                "G8",
                f"pages[{p}]",
                f"block bboxes cover {_fmt(union)} pt2 of a {_fmt(page_area)} pt2 page "
                f"({percent:.4f} %), below the {floor:.2f} % floor - the signature of geometry "
                f"stored as normalised [0,1] fractions",
            )


# ─── DOCUMENT-LEVEL RULES ───────────────────────────────────────────────────────────────────


def _rule_r8(ctx: _Ctx) -> None:
    seen_block: set[str] = set()
    for b, block in enumerate(ctx.blocks):
        if block.block_id in seen_block:
            ctx.emit("R8", f"blocks[{b}].block_id", f"duplicate block_id {_quote(block.block_id)}")
        seen_block.add(block.block_id)
    seen_page_id: set[str] = set()
    seen_page_index: set[int] = set()
    for p, page in enumerate(ctx.pages):
        if page.page_id in seen_page_id:
            ctx.emit("R8", f"pages[{p}].page_id", f"duplicate page_id {_quote(page.page_id)}")
        seen_page_id.add(page.page_id)
        if page.index in seen_page_index:
            ctx.emit("R8", f"pages[{p}].index", f"duplicate page index {_fmt(page.index)}")
        seen_page_index.add(page.index)


def _rule_r40(ctx: _Ctx) -> None:
    if not ctx.pages:
        if ctx.blocks:
            ctx.emit("R40", "pages", f"pages is empty but {len(ctx.blocks)} block(s) exist")
        return
    for i, index in enumerate(sorted(page.index for page in ctx.pages)):
        if index != i:
            ctx.emit(
                "R40",
                "pages",
                f"page indices must be contiguous 0..n-1; sorted position {i} holds {_fmt(index)}",
            )


def _rule_r41(ctx: _Ctx) -> None:
    status = ctx.paper.status
    reason = ctx.paper.partial_reason
    if status == "failed" and reason is None:
        ctx.emit("R41", "partial_reason", 'status "failed" requires a non-null partial_reason')
    if status == "complete" and reason is not None:
        ctx.emit("R41", "partial_reason", 'status "complete" requires partial_reason to be null')


def _rule_r13(ctx: _Ctx) -> None:
    conf = ctx.paper.confidence
    if len(conf.by_page) != len(ctx.pages):
        ctx.emit(
            "R13",
            "confidence.by_page",
            f"by_page has {len(conf.by_page)} entries for {len(ctx.pages)} pages",
        )
    for i, index in enumerate(conf.weakest_pages):
        if index not in ctx.page_by_index:
            ctx.emit(
                "R13",
                f"confidence.weakest_pages[{i}]",
                f"{_fmt(index)} is not a page index in this document",
            )


def _rule_r13b(ctx: _Ctx) -> None:
    if ctx.paper.status != "complete":
        return
    conf = ctx.paper.confidence
    if conf.overall is None:
        ctx.emit(
            "R13b",
            "confidence.overall",
            'a "complete" paper must have a calibrated overall confidence',
        )
    for i, value in enumerate(conf.by_page):
        if value is None:
            ctx.emit(
                "R13b",
                f"confidence.by_page[{i}]",
                'a "complete" paper must have a calibrated confidence for every page',
            )


# ─── PAGE / FLOW RULES ──────────────────────────────────────────────────────────────────────


def _rule_r10(ctx: _Ctx) -> None:
    for p, page in enumerate(ctx.pages):
        claimed = {b.block_id for b in ctx.blocks_on_page.get(page.index, [])}
        listed: set[str] = set()
        for i, block_id in enumerate(page.block_ids):
            path = f"pages[{p}].block_ids[{i}]"
            if block_id in listed:
                ctx.emit("R10", path, f"block_ids lists {_quote(block_id)} more than once")
                continue
            listed.add(block_id)
            if block_id not in claimed:
                block = ctx.by_id.get(block_id)
                ctx.emit(
                    "R10",
                    path,
                    f"block_ids names {_quote(block_id)}, which is not a block in this document"
                    if block is None
                    else f"block_ids names {_quote(block_id)}, whose page_index is "
                    f"{_fmt(block.page_index)}",
                )
        for block in ctx.blocks_on_page.get(page.index, []):
            if block.block_id not in listed:
                ctx.emit(
                    "R10",
                    f"pages[{p}].block_ids",
                    f"block {_quote(block.block_id)} claims page_index {_fmt(page.index)} "
                    f"but is not listed",
                )


def _rule_r11_and_r42(ctx: _Ctx) -> None:
    for p, page in enumerate(ctx.pages):
        on_page = ctx.blocks_on_page.get(page.index, [])
        seen: set[str] = set()
        flows = _flow_map(page.flows)
        for flow in _FLOW_KEYS:
            for i, block_id in enumerate(flows[flow]):
                path = f"pages[{p}].flows.{flow}[{i}]"
                block = ctx.by_id.get(block_id)
                if block is None:
                    ctx.emit(
                        "R11",
                        path,
                        f"flow names {_quote(block_id)}, which is not a block in this document",
                    )
                    continue
                if block_id in seen:
                    ctx.emit(
                        "R11",
                        path,
                        f"{_quote(block_id)} appears in more than one flow on this page",
                    )
                    continue
                seen.add(block_id)
                if ctx.is_nested(block):
                    # Rule 42 is the enforcement half of D14 and owns this case exclusively, so a
                    # nested block in a flow is reported once, not twice.
                    ctx.emit(
                        "R42",
                        path,
                        f"{_quote(block_id)} is NESTED (its parent "
                        f"{_quote(block.parent_id or '')} is not a heading) and must be reached "
                        f"through child_ids, never listed in a flow",
                    )
                    continue
                if block.page_index != page.index:
                    ctx.emit(
                        "R11",
                        path,
                        f"{_quote(block_id)} sits on page {_fmt(block.page_index)}, "
                        f"not {_fmt(page.index)}",
                    )
                    continue
                if block.flow != flow:
                    ctx.emit(
                        "R11",
                        path,
                        f"{_quote(block_id)} has flow {_quote(block.flow)}, not {_quote(flow)}",
                    )
        for block in on_page:
            if not ctx.is_nested(block) and block.block_id not in seen:
                ctx.emit(
                    "R11",
                    f"pages[{p}].flows.{block.flow}",
                    f"top-level block {_quote(block.block_id)} on this page is in no flow",
                )


def _rule_r12(ctx: _Ctx) -> None:
    for p, page in enumerate(ctx.pages):
        flows = _flow_map(page.flows)
        for flow in _FLOW_KEYS:
            previous: int | None = None
            for i, block_id in enumerate(flows[flow]):
                block = ctx.by_id.get(block_id)
                if block is None:
                    continue  # rule 11 owns it.
                if previous is not None and block.order < previous:
                    ctx.emit(
                        "R12",
                        f"pages[{p}].flows.{flow}[{i}]",
                        f"flow must ascend by block.order: {_fmt(block.order)} follows "
                        f"{_fmt(previous)}",
                    )
                previous = block.order


# ─── ORDERING RULES ─────────────────────────────────────────────────────────────────────────


def _rule_r14(ctx: _Ctx) -> None:
    groups: dict[tuple[int, str, str], list[Block]] = {}
    for block in ctx.blocks:
        container = block.parent_id or "" if ctx.is_nested(block) else ""
        groups.setdefault((block.page_index, block.flow, container), []).append(block)
    for (page_index, flow, container), members in groups.items():
        where = "top level" if container == "" else f"container {container}"
        label = f"(page_index {page_index}, flow {flow}, {where})"
        seen: dict[int, str] = {}
        for block in members:
            owner = seen.get(block.order)
            if owner is not None:
                ctx.emit(
                    "R14",
                    f"{ctx.block_path(block.block_id)}.order",
                    f"order {_fmt(block.order)} is already taken by {_quote(owner)} in {label}",
                )
            else:
                seen[block.order] = block.block_id
        for expected in range(len(members)):
            if expected not in seen:
                ctx.emit(
                    "R14",
                    f"{ctx.block_path(members[0].block_id)}.order",
                    f"order must be dense 0..{len(members) - 1} within {label}; "
                    f"{expected} is missing",
                )


def _rule_r15(ctx: _Ctx) -> None:
    carriers: list[Block] = []
    for block in ctx.blocks:
        nested = ctx.is_nested(block)
        should_carry = not nested and block.flow == "body"
        does = block.doc_order is not None
        if should_carry and not does:
            ctx.emit(
                "R15",
                f"{ctx.block_path(block.block_id)}.doc_order",
                "a top-level block in the body flow must carry doc_order",
            )
        if not should_carry and does:
            ctx.emit(
                "R15",
                f"{ctx.block_path(block.block_id)}.doc_order",
                "a NESTED block must not carry doc_order - it is read as part of its container "
                "(D14)"
                if nested
                else f"only the body flow carries doc_order; this block's flow is "
                f"{_quote(block.flow)}",
            )
        if does:
            carriers.append(block)
    seen: dict[int, str] = {}
    for block in carriers:
        value = block.doc_order
        if value is None:  # unreachable: `carriers` is exactly the blocks that carry one.
            continue
        owner = seen.get(value)
        if owner is not None:
            ctx.emit(
                "R15",
                f"{ctx.block_path(block.block_id)}.doc_order",
                f"doc_order {_fmt(value)} is already taken by {_quote(owner)}",
            )
        else:
            seen[value] = block.block_id
    for expected in range(len(carriers)):
        if expected not in seen:
            ctx.emit(
                "R15",
                "blocks",
                f"doc_order must be dense 0..{len(carriers) - 1} across the body flow; "
                f"{expected} is missing",
            )


def _rule_r16(ctx: _Ctx) -> None:
    stream = [
        (index, block)
        for index, block in enumerate(ctx.blocks)
        if block.doc_order is not None and not ctx.is_nested(block) and block.flow == "body"
    ]
    stream.sort(key=lambda pair: (pair[1].page_index, pair[1].order, pair[0]))
    for (_, previous), (_, current) in zip(stream, stream[1:], strict=False):
        before, after = previous.doc_order, current.doc_order
        if before is None or after is None:  # unreachable: the comprehension filtered them out.
            continue
        if after < before:
            ctx.emit(
                "R16",
                f"{ctx.block_path(current.block_id)}.doc_order",
                f"the body stream runs backwards: (page {_fmt(current.page_index)}, order "
                f"{_fmt(current.order)}) has doc_order {_fmt(after)} after "
                f"(page {_fmt(previous.page_index)}, order {_fmt(previous.order)}) at "
                f"{_fmt(before)}",
            )


# ─── REFERENTIAL INTEGRITY ──────────────────────────────────────────────────────────────────


def _rule_r4(ctx: _Ctx) -> None:
    for r, relation in enumerate(ctx.paper.relations):
        ctx.resolve("R4", relation.from_, f"relations[{r}].from", "relation endpoint")
        ctx.resolve("R4", relation.to, f"relations[{r}].to", "relation endpoint")


def _rule_r5(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        for name, value in (
            ("parent_id", block.parent_id),
            ("prev_id", block.prev_id),
            ("next_id", block.next_id),
        ):
            if value is not None:
                ctx.resolve("R5", value, f"blocks[{b}].{name}", name)
        for c, child_id in enumerate(block.child_ids or []):
            ctx.resolve("R5", child_id, f"blocks[{b}].child_ids[{c}]", "child_ids")


def _rule_r6(ctx: _Ctx) -> None:
    metadata = ctx.paper.metadata
    for name in _METADATA_VALUE_FIELDS:
        value = getattr(metadata, name)
        if value is not None:
            ctx.resolve("R6", value.source_block_id, f"metadata.{name}.source_block_id", name)
    for a, author in enumerate(metadata.authors):
        ctx.resolve(
            "R6", author.source_block_id, f"metadata.authors[{a}].source_block_id", "author"
        )
    if metadata.year is not None:
        ctx.resolve("R6", metadata.year.source_block_id, "metadata.year.source_block_id", "year")
    if metadata.abstract is not None:
        for i, block_id in enumerate(metadata.abstract.block_ids):
            ctx.resolve("R6", block_id, f"metadata.abstract.block_ids[{i}]", "abstract")


def _assert_quoted(ctx: _Ctx, rule: str, path: str, value: str, source_id: str, label: str) -> None:
    """Rule 6b / rule 35's shared engine.

    Is ``value``, under the library's normalisation, a substring of the normalised text of
    ``source_id``? One ``in`` per field, exactly as 5.2 says - and it is ``normalise_text`` from
    identity.py, never a second normalisation, because rules 28/29/30b/35 all key on that one
    contract.
    """
    block = ctx.by_id.get(source_id)
    if block is None:
        return  # rule 6/7 owns the dangling id.
    if block.text is None:
        ctx.emit(
            rule,
            path,
            f"{label} {_quote(value)} cites block {_quote(source_id)}, which has no text at all",
        )
        return
    if normalise_text(value) not in normalise_text(block.text):
        ctx.emit(
            rule,
            path,
            f"{label} {_quote(value)} does not occur in the normalised text of "
            f"{_quote(source_id)} - a PaperIR scalar is EXTRACTED from its block, never "
            f"composed, cleaned up or enriched",
        )


def _rule_r6b(ctx: _Ctx) -> None:
    metadata = ctx.paper.metadata
    for name in _METADATA_VALUE_FIELDS:
        value = getattr(metadata, name)
        if value is not None:
            _assert_quoted(
                ctx, "R6b", f"metadata.{name}.value", value.value, value.source_block_id, name
            )
    for a, author in enumerate(metadata.authors):
        _assert_quoted(
            ctx,
            "R6b",
            f"metadata.authors[{a}].value",
            author.value,
            author.source_block_id,
            "author",
        )
    if metadata.year is not None:
        _assert_quoted(
            ctx,
            "R6b",
            "metadata.year.value",
            _fmt(metadata.year.value),
            metadata.year.source_block_id,
            "year",
        )


def _rule_r7(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        base = f"blocks[{b}]"
        for s, span in enumerate(block.spans or []):
            if span.block_id is not None:
                ctx.resolve("R7", span.block_id, f"{base}.spans[{s}].block_id", "span.block_id")
        payload = block.payload
        if payload is None:
            continue
        caption_block = payload.get("caption_block")
        if isinstance(caption_block, str):
            ctx.resolve("R7", caption_block, f"{base}.payload.caption_block", "caption_block")
        referenced_by = payload.get("referenced_by")
        if isinstance(referenced_by, list):
            for i, block_id in enumerate(referenced_by):
                if isinstance(block_id, str):
                    ctx.resolve(
                        "R7", block_id, f"{base}.payload.referenced_by[{i}]", "referenced_by"
                    )
        symbols = payload.get("symbols")
        if isinstance(symbols, list):
            for i, symbol in enumerate(symbols):
                definition = symbol.get("definition_block") if isinstance(symbol, dict) else None
                if isinstance(definition, str):
                    ctx.resolve(
                        "R7",
                        definition,
                        f"{base}.payload.symbols[{i}].definition_block",
                        "definition_block",
                    )
        for index, cell in _table_cells(payload):
            cell_id = cell.get("cell_id")
            if isinstance(cell_id, str):
                ctx.resolve("R7", cell_id, f"{base}.payload.grid.cells[{index}].cell_id", "cell_id")
    for s, section in enumerate(ctx.paper.sections):
        ctx.resolve(
            "R7", section.heading_block_id, f"sections[{s}].heading_block_id", "heading_block_id"
        )
        if section.parent_heading_block_id is not None:
            ctx.resolve(
                "R7",
                section.parent_heading_block_id,
                f"sections[{s}].parent_heading_block_id",
                "parent_heading_block_id",
            )
        for i, block_id in enumerate(section.block_ids):
            ctx.resolve("R7", block_id, f"sections[{s}].block_ids[{i}]", "section.block_ids")
    for r, reference in enumerate(ctx.paper.references):
        ctx.resolve(
            "R7",
            reference.reference_entry_block_id,
            f"references[{r}].reference_entry_block_id",
            "reference_entry_block_id",
        )


def _rule_r9(ctx: _Ctx) -> None:
    seen: dict[tuple[str, str, str], int] = {}
    for r, relation in enumerate(ctx.paper.relations):
        key = (relation.type, relation.from_, relation.to)
        first = seen.get(key)
        if first is not None:
            ctx.emit(
                "R9",
                f"relations[{r}]",
                f"duplicate relation ({relation.type}, {relation.from_}, {relation.to}); "
                f"identity is the triple, so relations[{first}] is the same edge",
            )
        else:
            seen[key] = r


# ─── TREE CONSISTENCY ───────────────────────────────────────────────────────────────────────


def _rule_r17(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        base = f"blocks[{b}]"
        if block.parent_id is not None:
            parent = ctx.by_id.get(block.parent_id)
            if parent is not None and block.block_id not in (parent.child_ids or []):
                ctx.emit(
                    "R17",
                    f"{base}.parent_id",
                    f"parent {_quote(block.parent_id)} does not list "
                    f"{_quote(block.block_id)} in child_ids",
                )
        for c, child_id in enumerate(block.child_ids or []):
            child = ctx.by_id.get(child_id)
            if child is not None and child.parent_id != block.block_id:
                ctx.emit(
                    "R17",
                    f"{base}.child_ids[{c}]",
                    f"child {_quote(child_id)} has parent_id "
                    f"{_quote(child.parent_id or '(absent)')}, not {_quote(block.block_id)}",
                )


def _rule_r18(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        base = f"blocks[{b}]"
        if block.next_id is not None:
            nxt = ctx.by_id.get(block.next_id)
            if nxt is not None:
                if nxt.prev_id != block.block_id:
                    ctx.emit(
                        "R18",
                        f"{base}.next_id",
                        f"next {_quote(block.next_id)} has prev_id "
                        f"{_quote(nxt.prev_id or '(absent)')}, not {_quote(block.block_id)}",
                    )
                if nxt.parent_id != block.parent_id:
                    ctx.emit(
                        "R18",
                        f"{base}.next_id",
                        f"prev/next link SIBLINGS only: parent_id "
                        f"{_quote(block.parent_id or '(absent)')} != "
                        f"{_quote(nxt.parent_id or '(absent)')}",
                    )
                if nxt.block_id == block.parent_id or nxt.parent_id == block.block_id:
                    ctx.emit("R18", f"{base}.next_id", "a parent is never its child's next")
        if block.prev_id is not None:
            prev = ctx.by_id.get(block.prev_id)
            if prev is not None and prev.next_id != block.block_id:
                ctx.emit(
                    "R18",
                    f"{base}.prev_id",
                    f"prev {_quote(block.prev_id)} has next_id "
                    f"{_quote(prev.next_id or '(absent)')}, not {_quote(block.block_id)}",
                )


def _rule_r19(ctx: _Ctx) -> None:
    for r, relation in enumerate(ctx.paper.relations):
        path = f"relations[{r}]"
        if relation.type == "parent_of":
            child = ctx.by_id.get(relation.to)
            parent = ctx.by_id.get(relation.from_)
            if child is None or parent is None:
                continue  # rule 4 owns it.
            if child.parent_id != relation.from_:
                ctx.emit(
                    "R19",
                    path,
                    f"parent_of says {_quote(relation.from_)} owns {_quote(relation.to)}, but "
                    f"that block's parent_id is {_quote(child.parent_id or '(absent)')}",
                )
            if relation.to not in (parent.child_ids or []):
                ctx.emit(
                    "R19",
                    path,
                    f"parent_of says {_quote(relation.from_)} owns {_quote(relation.to)}, but "
                    f"that block is not in its child_ids",
                )
        if relation.type == "next_in_reading_order":
            from_block = ctx.by_id.get(relation.from_)
            to_block = ctx.by_id.get(relation.to)
            if from_block is None or to_block is None:
                continue
            if from_block.next_id != relation.to:
                ctx.emit(
                    "R19",
                    path,
                    f"next_in_reading_order says {_quote(relation.to)} follows "
                    f"{_quote(relation.from_)}, but its next_id is "
                    f"{_quote(from_block.next_id or '(absent)')}",
                )
            if to_block.prev_id != relation.from_:
                ctx.emit(
                    "R19",
                    path,
                    f"next_in_reading_order says {_quote(relation.to)} follows "
                    f"{_quote(relation.from_)}, but its prev_id is "
                    f"{_quote(to_block.prev_id or '(absent)')}",
                )


def _walk_cycle(ctx: _Ctx, start: Block, step: Callable[[Block], str | None]) -> list[str] | None:
    """Walk ``step`` from ``start`` and return the CYCLE, if one is reached.

    The trail from the repeated id onward, not the whole path. Returning only the cycle is what
    lets :func:`_rule_r20` report one diagnostic per cycle rather than one per block that happens
    to lead into it.
    """
    seen = {start.block_id}
    trail = [start.block_id]
    current: Block | None = start
    while current is not None:
        next_id = step(current)
        if next_id is None:
            return None
        trail.append(next_id)
        if next_id in seen:
            return trail[trail.index(next_id) :]
        seen.add(next_id)
        current = ctx.by_id.get(next_id)
    return None


def _rule_r20(ctx: _Ctx) -> None:
    reported_parent: set[str] = set()
    reported_sibling: set[str] = set()
    for b, block in enumerate(ctx.blocks):
        base = f"blocks[{b}]"
        parent_cycle = _walk_cycle(ctx, block, lambda n: n.parent_id)
        if parent_cycle is not None:
            key = ",".join(sorted(set(parent_cycle)))
            if key not in reported_parent:
                reported_parent.add(key)
                ctx.emit(
                    "R20",
                    f"{base}.parent_id",
                    f"the parent graph is cyclic: {' -> '.join(parent_cycle)}",
                )
        sibling_cycle = _walk_cycle(ctx, block, lambda n: n.next_id)
        if sibling_cycle is not None:
            key = ",".join(sorted(set(sibling_cycle)))
            if key not in reported_sibling:
                reported_sibling.add(key)
                ctx.emit(
                    "R20",
                    f"{base}.next_id",
                    f"the sibling chain is cyclic: {' -> '.join(sibling_cycle)}",
                )


def _rule_r21(ctx: _Ctx) -> None:
    by_heading: dict[str, Section] = {}
    for section in ctx.paper.sections:
        by_heading.setdefault(section.heading_block_id, section)
    for s, section in enumerate(ctx.paper.sections):
        path = f"sections[{s}]"
        heading = ctx.by_id.get(section.heading_block_id)
        if heading is not None and not is_known_heading_block_type(heading.type):
            ctx.emit(
                "R21",
                f"{path}.heading_block_id",
                f'a section is opened by a heading block ("title" or "heading"), not by '
                f"{_quote(heading.type)}",
            )
        if section.parent_heading_block_id is None:
            if section.level != 1:
                ctx.emit(
                    "R21",
                    f"{path}.level",
                    f"a section with no parent_heading_block_id is level 1, "
                    f"got {_fmt(section.level)}",
                )
            continue
        parent = by_heading.get(section.parent_heading_block_id)
        if parent is None:
            ctx.emit(
                "R21",
                f"{path}.parent_heading_block_id",
                f"{_quote(section.parent_heading_block_id)} does not open a section in this "
                f"document",
            )
            continue
        if section.level != parent.level + 1:
            ctx.emit(
                "R21",
                f"{path}.level",
                f"level must be parent.level + 1 = {_fmt(parent.level + 1)}, "
                f"got {_fmt(section.level)}",
            )


def _rule_r38(ctx: _Ctx) -> None:
    for s, section in enumerate(ctx.paper.sections):
        seen: set[str] = set()
        for i, block_id in enumerate(section.block_ids):
            path = f"sections[{s}].block_ids[{i}]"
            if block_id == section.heading_block_id:
                ctx.emit("R38", path, "section.block_ids must exclude its own heading_block_id")
            if block_id in seen:
                ctx.emit("R38", path, f"duplicate block id {_quote(block_id)}")
            seen.add(block_id)
            block = ctx.by_id.get(block_id)
            if block is not None and ctx.is_nested(block):
                ctx.emit(
                    "R38",
                    path,
                    f"{_quote(block_id)} is NESTED and belongs to its container, not directly "
                    f"to a section",
                )


# ─── TYPED-RELATION SEMANTICS ───────────────────────────────────────────────────────────────


def _rule_r22(ctx: _Ctx) -> None:
    for r, relation in enumerate(ctx.paper.relations):
        if relation.type != "caption_of":
            continue
        from_block = ctx.by_id.get(relation.from_)
        to_block = ctx.by_id.get(relation.to)
        if from_block is not None and from_block.type != "caption":
            ctx.emit(
                "R22",
                f"relations[{r}].from",
                f'caption_of.from must be a "caption" block, got {_quote(from_block.type)}',
            )
        if to_block is not None and to_block.type not in _FLOAT_BLOCK_TYPES:
            ctx.emit(
                "R22",
                f"relations[{r}].to",
                f"caption_of.to must be a float (figure/table/diagram/plot), "
                f"got {_quote(to_block.type)}",
            )
    for b, block in enumerate(ctx.blocks):
        caption_block = _payload(block).get("caption_block")
        if not isinstance(caption_block, str):
            continue
        caption = ctx.by_id.get(caption_block)
        if caption is not None and caption.type != "caption":
            ctx.emit(
                "R22",
                f"blocks[{b}].payload.caption_block",
                f'caption_block must name a "caption" block, got {_quote(caption.type)}',
            )


def _rule_r23(ctx: _Ctx) -> None:
    for r, relation in enumerate(ctx.paper.relations):
        if relation.type != "cites":
            continue
        to_block = ctx.by_id.get(relation.to)
        if to_block is not None and to_block.type != "reference_entry":
            ctx.emit(
                "R23",
                f"relations[{r}].to",
                f'cites.to must be a "reference_entry" block, got {_quote(to_block.type)}',
            )


def _rule_r24(ctx: _Ctx) -> None:
    for r, relation in enumerate(ctx.paper.relations):
        if relation.type != "continues_on_next_page":
            continue
        from_block = ctx.by_id.get(relation.from_)
        to_block = ctx.by_id.get(relation.to)
        if from_block is None or to_block is None:
            continue
        if from_block.page_index >= to_block.page_index:
            ctx.emit(
                "R24",
                f"relations[{r}]",
                f"continues_on_next_page must run to a LATER page: "
                f"{_fmt(from_block.page_index)} -> {_fmt(to_block.page_index)}",
            )


def _rule_r24b(ctx: _Ctx) -> None:
    for r, relation in enumerate(ctx.paper.relations):
        if relation.type != "continues_in_next_column":
            continue
        path = f"relations[{r}]"
        from_block = ctx.by_id.get(relation.from_)
        to_block = ctx.by_id.get(relation.to)
        if from_block is None or to_block is None:
            continue
        if from_block.page_index != to_block.page_index:
            ctx.emit(
                "R24b",
                path,
                f"continues_in_next_column stays on ONE page: {_fmt(from_block.page_index)} -> "
                f"{_fmt(to_block.page_index)} (use continues_on_next_page)",
            )
            continue
        if not from_block.bbox[0] < to_block.bbox[0]:
            ctx.emit(
                "R24b",
                path,
                f"continues_in_next_column must ascend by bbox.x0: "
                f"{_fmt(from_block.bbox[0])} -> {_fmt(to_block.bbox[0])}",
            )
        if from_block.bbox[2] > to_block.bbox[0]:
            ctx.emit(
                "R24b",
                path,
                f"the two columns' x-extents overlap ([{_fmt(from_block.bbox[0])}, "
                f"{_fmt(from_block.bbox[2])}] and [{_fmt(to_block.bbox[0])}, "
                f"{_fmt(to_block.bbox[2])}]) - a single block spanning the gutter is the "
                f"highlight bleed Commitment 2 exists to prevent",
            )


# ─── TEXT, SPANS AND REPAIRS ────────────────────────────────────────────────────────────────


def _rule_r25(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        if block.spans is None:
            continue
        if block.text is None:
            ctx.emit("R25", f"blocks[{b}].spans", "a block with spans must have text")
            continue
        length = len(block.text)
        for s, span in enumerate(block.spans):
            if not (0 <= span.start < span.end <= length):
                ctx.emit(
                    "R25",
                    f"blocks[{b}].spans[{s}]",
                    f"span must satisfy 0 <= start < end <= len(text) = {length} code points, "
                    f"got [{_fmt(span.start)}, {_fmt(span.end)})",
                )


def _rule_r26(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        spans = block.spans
        if spans is None:
            continue
        for s in range(1, len(spans)):
            previous = spans[s - 1]
            current = spans[s]
            path = f"blocks[{b}].spans[{s}]"
            if current.start < previous.start:
                ctx.emit(
                    "R26",
                    path,
                    f"spans must ascend by start: {_fmt(current.start)} follows "
                    f"{_fmt(previous.start)}",
                )
            elif current.start < previous.end:
                ctx.emit(
                    "R26",
                    path,
                    f"spans must not overlap: [{_fmt(current.start)}, {_fmt(current.end)}) "
                    f"overlaps [{_fmt(previous.start)}, {_fmt(previous.end)})",
                )


def _rule_r27(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        for r, repair in enumerate(block.repairs or []):
            if repair.at is None:
                continue  # e.g. reorder: no single offset, and never guessed.
            path = f"blocks[{b}].repairs[{r}].at"
            if block.text is None:
                ctx.emit("R27", path, "a repair with an offset requires the block to have text")
                continue
            expected = repair.to if repair.applied else repair.from_
            length = len(block.text)
            if repair.at < 0 or repair.at + len(expected) > length:
                ctx.emit(
                    "R27",
                    path,
                    f"at {_fmt(repair.at)} + len({'to' if repair.applied else 'from'}) = "
                    f"{repair.at + len(expected)} runs past len(text) = {length} code points",
                )
                continue
            actual = block.text[repair.at : repair.at + len(expected)]
            if actual != expected:
                ctx.emit(
                    "R27",
                    path,
                    f"text[{_fmt(repair.at)}:] is {_quote(actual)}, but an "
                    f"applied={str(repair.applied).lower()} repair requires "
                    f"{_quote(expected)} there",
                )


def _rule_r28(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        if block.text_normalised is None:
            continue
        path = f"blocks[{b}].text_normalised"
        if block.text is None:
            ctx.emit(
                "R28", path, "text_normalised without text: there is nothing it can be derived from"
            )
            continue
        expected = normalise_text(block.text)
        if block.text_normalised != expected:
            ctx.emit(
                "R28",
                path,
                f"text_normalised is {_quote(block.text_normalised)}, but the library's "
                f"normalisation of text is {_quote(expected)}",
            )


def _rule_r29(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        if block.content_hash is None:
            continue
        path = f"blocks[{b}].content_hash"
        # The subject is a string ALREADY in normalised form, so it is digested as-is:
        # normalise_text is deliberately not idempotent (Amendment 1 § A: its output is not
        # guaranteed to be NFC), and normalising text_normalised a second time re-composes a
        # ligature expansion that lands in front of a combining mark. Doing that would fail a
        # document whose content_hash came from identity.content_hash(block.text) - the library's
        # own documented API - so the two must be compared through the same single normalisation.
        if block.text_normalised is not None:
            subject: str | None = block.text_normalised
        elif block.text is not None:
            subject = normalise_text(block.text)
        else:
            subject = None
        if subject is None:
            ctx.emit("R29", path, "content_hash without text or text_normalised: nothing to digest")
            continue
        expected = compute_content_hash(subject)
        if block.content_hash != expected:
            ctx.emit(
                "R29",
                path,
                f"content_hash is {_quote(block.content_hash)}, but the library's digest of "
                f"text_normalised is {_quote(expected)}",
            )


def _rule_r30(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        for r, repair in enumerate(block.repairs or []):
            if repair.kind not in _MODEL_REPAIR_KINDS:
                continue
            path = f"blocks[{b}].repairs[{r}]"
            if repair.model_id is None:
                ctx.emit(
                    "R30", path, f"a {repair.kind} repair must name the model_id that proposed it"
                )
            if repair.prompt_hash is None:
                ctx.emit(
                    "R30",
                    path,
                    f"a {repair.kind} repair must carry the prompt_hash that produced it, so the "
                    f"proposal is reproducible and auditable",
                )
            if repair.applied:
                ctx.emit(
                    "R30",
                    path,
                    f"a {repair.kind} repair is a PROPOSAL and must have applied: false - a model "
                    f"never overwrites source",
                )


def _complain_30b(ctx: _Ctx, path: str, repair: Repair, rule_text: str, expected: str) -> None:
    ctx.emit(
        "R30b",
        path,
        f'a "{repair.kind}" repair must be exactly {rule_text}: from {_quote(repair.from_)} '
        f"gives {_quote(expected)}, but to is {_quote(repair.to)}. A deterministic kind whose "
        f"from -> to is not reproducibly an edit of its own class is an arbitrary rewrite of "
        f"source wearing a rule-based label",
    )


def _rule_r30b(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        for r, repair in enumerate(block.repairs or []):
            if repair.kind not in _DETERMINISTIC_REPAIR_KINDS:
                continue
            path = f"blocks[{b}].repairs[{r}]"
            if repair.kind == "whitespace":
                collapsed = _collapse_whitespace(repair.from_)
                if collapsed != _collapse_whitespace(repair.to):
                    _complain_30b(
                        ctx, path, repair, "from == to under whitespace collapse", collapsed
                    )
            elif repair.kind == "ligature":
                expected = _expand_ligatures(repair.from_)
                if expected != repair.to:
                    _complain_30b(ctx, path, repair, "ligature expansion of from", expected)
            elif repair.kind == "unicode_normalise":
                # ESCALATION, measured. This is the ONE check in this file that calls a RUNTIME
                # Unicode function, and it forks the two twins for exactly the reason ADR-001
                # Amendment 1 "case fold by table" forbids one: Node 22 carries Unicode 17.0 and
                # Python 3.12 carries UCD 15.0.0, and NFKC differs on 37 code points between them
                # (U+A7F1 and U+1CCD6..U+1CCF9 - measured, not assumed; the
                # test_nfkc_is_a_runtime_call test pins the measurement so a runtime upgrade
                # surfaces it). A repair whose `from` contains one of those 37 is rejected here and
                # accepted by the TypeScript twin. Closing it properly means shipping a pinned NFKC
                # table in conformance/, which is a contract change and is not this module's to
                # make - DESIGN.md 5.2 rule 30b says "to == NFKC(from)" and this implements that.
                expected = unicodedata.normalize("NFKC", repair.from_)
                if expected != repair.to:
                    _complain_30b(ctx, path, repair, "NFKC(from)", expected)
            elif repair.kind == "dehyphenate":
                expected = _dehyphenate(repair.from_)
                if expected != repair.to:
                    _complain_30b(
                        ctx,
                        path,
                        repair,
                        "from with a soft/hard hyphen + line break removed",
                        expected,
                    )
            elif repair.kind == "reorder" and _token_multiset(repair.from_) != _token_multiset(
                repair.to
            ):
                _complain_30b(
                    ctx,
                    path,
                    repair,
                    "a permutation of from's whitespace-separated tokens",
                    repair.from_,
                )

            if repair.model_id is not None or repair.prompt_hash is not None:
                ctx.emit(
                    "R30b",
                    path,
                    f'a deterministic "{repair.kind}" repair must not name a model: its entire '
                    f"justification is that it is rule-based and reproducible",
                )


def _rule_r31(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        if block.alternatives is None:
            continue
        selected_index: int | None = None
        for a, alternative in enumerate(block.alternatives):
            if alternative.decision != "selected":
                continue
            path = f"blocks[{b}].alternatives[{a}]"
            if selected_index is not None:
                ctx.emit(
                    "R31",
                    path,
                    f'at most one alternative may be "selected"; '
                    f"alternatives[{selected_index}] already is",
                )
                continue
            selected_index = a
            if alternative.text is not None and alternative.text != block.text:
                ctx.emit(
                    "R31",
                    f"{path}.text",
                    f"the selected alternative's text {_quote(alternative.text)} is not "
                    f"block.text {_quote(block.text or '(absent)')} - the selected reading IS "
                    f"what renders",
                )


# ─── MATERIALISED-VIEW HONESTY ──────────────────────────────────────────────────────────────


def _rule_r32(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        if block.type != "table" or block.payload is None:
            continue
        for index, cell in _table_cells(block.payload):
            path = f"blocks[{b}].payload.grid.cells[{index}]"
            cell_id = cell.get("cell_id")
            if not isinstance(cell_id, str):
                continue
            cell_block = ctx.by_id.get(cell_id)
            if cell_block is None:
                continue  # rule 7 owns it.
            if cell_block.type != "table_cell":
                ctx.emit(
                    "R32",
                    f"{path}.cell_id",
                    f'cell_id must name a "table_cell" block, got {_quote(cell_block.type)}',
                )
            if cell_block.page_index != block.page_index:
                ctx.emit(
                    "R32",
                    f"{path}.cell_id",
                    f"cell sits on page {_fmt(cell_block.page_index)} but its table is on page "
                    f"{_fmt(block.page_index)}",
                )
            text = cell.get("text")
            if isinstance(text, str) and text != cell_block.text:
                ctx.emit(
                    "R32",
                    f"{path}.text",
                    f"grid cell text {_quote(text)} != the table_cell block's text "
                    f"{_quote(cell_block.text or '(absent)')} - a derived field nobody checks "
                    f"is a second representation that drifts",
                )


def _rule_r35(ctx: _Ctx) -> None:
    for r, reference in enumerate(ctx.paper.references):
        base = f"references[{r}]"
        source = reference.reference_entry_block_id
        for name in _REFERENCE_STRING_FIELDS:
            value = getattr(reference, name)
            if value is not None:
                _assert_quoted(ctx, "R35", f"{base}.{name}", value, source, f"reference {name}")
        for a, author in enumerate(reference.authors or []):
            _assert_quoted(ctx, "R35", f"{base}.authors[{a}]", author, source, "reference author")
        if reference.year is not None:
            _assert_quoted(
                ctx, "R35", f"{base}.year", _fmt(reference.year), source, "reference year"
            )


def _rule_r36(ctx: _Ctx) -> None:
    if ctx.paper.status != "complete":
        return
    for b, block in enumerate(ctx.blocks):
        if block.type not in _CROPPED_BLOCK_TYPES:
            continue
        if _payload(block).get("image") is None:
            ctx.emit(
                "R36",
                f"blocks[{b}].payload.image",
                f'a "complete" paper retains the rendered source region on every {block.type} '
                f"block; the crop is ground truth and the latex/vector reading is an "
                f"interpretation of it",
            )


def _rule_r37(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        if block.text is None or block.source != "pdf_text_layer":
            continue
        if block.text_normalised is None:
            ctx.emit(
                "R37",
                f"blocks[{b}].text_normalised",
                "tier-2 anchoring cannot be optional on exactly the blocks anchors land on",
            )
        if block.content_hash is None:
            ctx.emit(
                "R37",
                f"blocks[{b}].content_hash",
                "tier-2 anchoring cannot be optional on exactly the blocks anchors land on",
            )


def _rule_r39(ctx: _Ctx) -> None:
    for b, block in enumerate(ctx.blocks):
        if block.type != "inline_equation" or block.payload is None:
            continue
        if block.payload.get("display") is not False:
            ctx.emit(
                "R39",
                f"blocks[{b}].payload.display",
                "an inline_equation is by definition not display math: payload.display must be "
                "false",
            )


# ─── IDENTITY ───────────────────────────────────────────────────────────────────────────────


def _rule_i1(ctx: _Ctx) -> None:
    """I1 - the rule that catches a producer INVENTING ids.

    Not numbered in DESIGN.md 5.2, because 5.2 was written before F0.4 existed and the rule is not
    expressible without it. It is the only check in this file that reaches outside the document: it
    recomputes ``blk_...`` from the block's own ``source_hash | page_index | q(x0) | q(y0) | type |
    normalise(text)[:8]`` and compares. Everything else here checks that the document agrees with
    itself; this checks that it agrees with the formula.

    The anchor is ``bbox[0], bbox[1]`` - the stored top-left, which is what the producer hashed.
    Rule 1 separately pins that bbox to the polygon, so the two together mean the id is derived
    from the geometry the reader actually sees.
    """
    raw = ctx.paper.source_hash
    source_hash = raw[len(_SOURCE_HASH_PREFIX) :] if raw.startswith(_SOURCE_HASH_PREFIX) else raw
    for b, block in enumerate(ctx.blocks):
        path = f"blocks[{b}].block_id"
        if not _all_finite(block.bbox):
            continue  # G5 owns it.
        try:
            expected = recompute_block_id(
                BlockIdInput(
                    source_hash=source_hash,
                    page_index=block.page_index,
                    x0=block.bbox[0],
                    y0=block.bbox[1],
                    block_type=block.type,
                    # A block legitimately has no text (the `unknown` requirement). The formula
                    # hashes the normalised prefix, and normalise("") is "", so the empty string is
                    # the only encoding of "no text" that does not invent one.
                    text=block.text if block.text is not None else "",
                )
            )
        except (ValueError, TypeError) as error:
            ctx.emit("I1", path, f"block_id cannot be recomputed: {error}")
            continue
        if block.block_id != expected:
            ctx.emit(
                "I1",
                path,
                f"block_id is {_quote(block.block_id)} but the formula (ADR-001 Amendment 1) "
                f"over this block's own source_hash | page_index | q(x0) | q(y0) | type | "
                f"normalise(text)[:8] gives {_quote(expected)}",
            )


# ─── ENTRY POINT ────────────────────────────────────────────────────────────────────────────


#: Rules in the order they run, which is the order diagnostics come out in.
_RULE_PASSES: tuple[tuple[str, Callable[[_Ctx], None]], ...] = (
    ("G5", _rule_g5),
    ("R2", _rule_r2),
    ("R1", _rule_r1),
    ("G6", _rule_g6),
    ("R3", _rule_r3_and_g7),
    ("G4", _rule_g4),
    ("G8", _rule_g8),
    ("R8", _rule_r8),
    ("R40", _rule_r40),
    ("R41", _rule_r41),
    ("R13", _rule_r13),
    ("R13b", _rule_r13b),
    ("R10", _rule_r10),
    ("R11", _rule_r11_and_r42),
    ("R12", _rule_r12),
    ("R14", _rule_r14),
    ("R15", _rule_r15),
    ("R16", _rule_r16),
    ("R4", _rule_r4),
    ("R5", _rule_r5),
    ("R6", _rule_r6),
    ("R6b", _rule_r6b),
    ("R7", _rule_r7),
    ("R9", _rule_r9),
    ("R17", _rule_r17),
    ("R18", _rule_r18),
    ("R19", _rule_r19),
    ("R20", _rule_r20),
    ("R21", _rule_r21),
    ("R38", _rule_r38),
    ("R22", _rule_r22),
    ("R23", _rule_r23),
    ("R24", _rule_r24),
    ("R24b", _rule_r24b),
    ("R25", _rule_r25),
    ("R26", _rule_r26),
    ("R27", _rule_r27),
    ("R28", _rule_r28),
    ("R29", _rule_r29),
    ("R30", _rule_r30),
    ("R30b", _rule_r30b),
    ("R31", _rule_r31),
    ("R32", _rule_r32),
    ("R35", _rule_r35),
    ("R36", _rule_r36),
    ("R37", _rule_r37),
    ("R39", _rule_r39),
    ("I1", _rule_i1),
)


def validate_paper(paper: Paper, options: ValidateOptions | None = None) -> ValidationReport:
    """Run every semantic rule against a SCHEMA-VALID :class:`Paper`.

    Never raises for a malformed document - that is the whole point of a validator - but it does
    assume the input has already satisfied the JSON Schema. See :func:`assert_valid_paper` for the
    raising form.
    """
    opts = options if options is not None else ValidateOptions()
    by_id: dict[str, Block] = {}
    index_by_id: dict[str, int] = {}
    for index, block in enumerate(paper.blocks):
        if block.block_id not in by_id:
            by_id[block.block_id] = block
            index_by_id[block.block_id] = index
    page_by_index: dict[int, Page] = {}
    for page in paper.pages:
        page_by_index.setdefault(page.index, page)
    blocks_on_page: dict[int, list[Block]] = {}
    for block in paper.blocks:
        blocks_on_page.setdefault(block.page_index, []).append(block)

    ctx = _Ctx(
        paper=paper,
        blocks=list(paper.blocks),
        pages=list(paper.pages),
        by_id=by_id,
        index_by_id=index_by_id,
        page_by_index=page_by_index,
        blocks_on_page=blocks_on_page,
        options=opts,
    )
    for _, run in _RULE_PASSES:
        run(ctx)

    diagnostics = tuple(ctx.out)
    errors = tuple(d for d in diagnostics if d.severity == "error")
    warnings = tuple(d for d in diagnostics if d.severity == "warning")
    return ValidationReport(
        ok=not errors, diagnostics=diagnostics, errors=errors, warnings=warnings
    )


def assert_valid_paper(paper: Paper, options: ValidateOptions | None = None) -> None:
    """:func:`validate_paper`, but a document with any ERROR raises. Warnings never raise."""
    report = validate_paper(paper, options)
    if not report.ok:
        raise SemanticValidationError(report.diagnostics)


def format_diagnostics(diagnostics: Sequence[Diagnostic]) -> str:
    """``rule severity path: message`` per line - the form a test failure and a CI log both want."""
    return "\n".join(f"{d.rule} {d.severity} {d.path}: {d.message}" for d in diagnostics)
