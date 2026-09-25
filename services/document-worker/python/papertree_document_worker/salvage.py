"""The salvage lane: a parse whose document fails validation is emitted PARTIAL, never raised.

WHY THIS EXISTS. `parse_document` promises a document that passes both `Paper.model_validate`
and `validate_paper`, or an exception - and the exception is a DEAD LETTER: the job fails, the
library shows the upload as Failed, and the reader has nothing to open. Before S2 (#141) two of
the fourteen corpus + fresh papers dead-lettered for defects in a figure or a table region
(`ddpm-2006.11239`: G7 on one overhanging raster, then R21; `maskrcnn-1703.06870`: two table
cells minted twice). Every paragraph of both papers was extracted correctly and thrown away with
the one bad region. contracts.md §2.2: "Salvage (S2) makes an invalid IR `status: partial`, not
a dead-letter."

WHAT IT DOES, IN ORDER, STOPPING AT THE FIRST DOCUMENT THAT VALIDATES

  1. TARGETED, up to `MAX_TARGETED_ROUNDS` times: read the validator's ERROR diagnostics and
     remove exactly what they name. A figure/table region (and everything nested in it) is
     dropped; a relation or a section is dropped (orphaned sections are re-attached, R21); a TEXT
     block is never dropped for a detail - its geometry is clipped to the crop box (G5/R1/R2/G6/
     R3/G7) or its spans and repairs are stripped (R25-R31), and its text is kept. Colliding ids
     (rule 8) drop the later duplicate, or the region that holds it.
  2. TEXT-ONLY: every region, relation and section goes; every text block stays, clipped.
  3. BARE TEXT: as 2, with spans, repairs, metadata values and references dropped too.

If even 3 fails, the ORIGINAL failure is re-raised: that document is genuinely not
representable, and a dead letter is the honest answer.

WHAT IT NEVER DOES. It never keeps an invalid document, never marks a salvaged one `complete`,
and never drops text for a region's defect. Every change is written into `partial_reason`, so a
reader of the stored IR can see what was removed and why. It is deterministic: it reads only the
builder and the validator's diagnostics, both of which are.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any, cast

from papertree_document_ir import BBox, Paper
from papertree_document_ir.validate import (
    SemanticValidationError,
    ValidationReport,
    validate_paper,
)

from papertree_document_worker.assemble import AssembledBlock, PaperBuilder
from papertree_document_worker.hierarchy import SectionNode, reparent_orphans
from papertree_document_worker.layout import LayoutBlock

__all__ = ["REGION_TYPES", "build_or_salvage"]

#: Block types that are REGIONS rather than text: dropping one loses a float, never prose.
REGION_TYPES = frozenset({"figure", "table", "table_row", "table_cell", "diagram", "plot"})
#: Rules about a block's geometry. Clipping its bands to the crop box addresses every one.
GEOMETRY_RULES = frozenset({"G5", "R1", "R2", "G6", "R3", "G7"})
#: Rules about a text block's spans or repairs. Stripping them keeps the text itself.
TEXT_DETAIL_RULES = frozenset({"R25", "R26", "R27", "R30", "R30b", "R31"})
#: A fix can unmask the next defect (dropping a cell leaves its table's grid dangling), so the
#: targeted pass repeats. Four rounds is more than any failure seen on the 14 papers needs.
MAX_TARGETED_ROUNDS = 4

_PATH = re.compile(
    r"^(?P<kind>blocks|relations|sections|references|metadata)(?:\[(?P<index>\d+)\])?"
)

Attempt = tuple[Paper | None, ValidationReport | None, ValueError | None]


def build_or_salvage(
    builder: PaperBuilder, build: Callable[[], Paper]
) -> tuple[Paper, ValidationReport]:
    """`build()` validated, or salvaged to a validating `partial` document, or the first failure.

    `build` must build from `builder`'s CURRENT state each call (it is `builder.build` with the
    parse's fixed arguments bound), because salvage works by editing the builder and rebuilding.
    """
    paper, report, failure = _attempt(build)
    if failure is None:
        assert paper is not None and report is not None
        return paper, report
    original = failure
    builder.salvage_rules = _rules_of(original)
    counted = builder.multi_polygon_blocks

    for _ in range(MAX_TARGETED_ROUNDS):
        if not _targeted(builder, paper, failure):
            break
        paper, report, failure = _attempt(build)
        if failure is None:
            break
    stages: tuple[Callable[[PaperBuilder], None], ...] = (_text_only, _bare_text)
    for stage in stages:
        if failure is None:
            break
        stage(builder)
        paper, report, failure = _attempt(build)

    # Rebuilding re-runs `assign_ids`, and `_geometry` counts gutter-spanning blocks every time
    # it runs; the diagnostic must describe the document, not how many times it was built.
    builder.multi_polygon_blocks = counted
    if failure is not None:
        raise original
    assert paper is not None and report is not None
    return paper, report


def _attempt(build: Callable[[], Paper]) -> Attempt:
    """Build and validate once. `ValueError` covers all three failure shapes: the duplicate-id
    guard in `PaperBuilder.build`, pydantic's `ValidationError`, and `SemanticValidationError`."""
    try:
        paper = build()
    except ValueError as exc:
        return None, None, exc
    report = validate_paper(paper)
    if report.ok:
        return paper, report, None
    return paper, report, SemanticValidationError(report.diagnostics)


def _rules_of(failure: ValueError) -> tuple[str, ...]:
    if isinstance(failure, SemanticValidationError):
        return tuple(sorted({d.rule for d in failure.diagnostics if d.severity == "error"}))
    if str(failure).startswith("duplicate block ids"):
        return ("R8",)
    return ("schema",)


# ── stage 1: targeted ────────────────────────────────────────────────────────────────────────


def _targeted(builder: PaperBuilder, paper: Paper | None, failure: ValueError) -> bool:
    """Remove exactly what the failure names. Returns whether anything changed."""
    # Indices in the diagnostics are positions in the document that was BUILT, which is the
    # builder's list at that moment - snapshot both lists before anything is removed from them.
    blocks, section_list = list(builder.blocks), list(builder.sections)
    changed = _drop_duplicates(builder)
    if not isinstance(failure, SemanticValidationError) or paper is None:
        return changed

    drop: set[int] = set()
    clip: set[int] = set()
    strip: set[int] = set()
    relations: set[tuple[str, str, str]] = set()
    sections: set[int] = set()  # id() of the section's heading block
    #: Sections whose only defect is a PARENT that opens no section (R21 on the parent or the
    #: level): they are re-attached rather than dropped - their own heading is fine.
    orphans: set[int] = set()
    for diagnostic in failure.diagnostics:
        if diagnostic.severity != "error":
            continue
        match = _PATH.match(diagnostic.path)
        if match is None:
            continue
        kind, index = match.group("kind"), match.group("index")
        if kind == "metadata" and not builder.bare_metadata:
            builder.bare_metadata = True
            builder.salvage_notes.append(f"metadata values dropped ({diagnostic.rule})")
            changed = True
        elif kind == "references" and builder.emit_references:
            builder.emit_references = False
            builder.salvage_notes.append(f"references dropped ({diagnostic.rule})")
            changed = True
        elif index is None:
            continue
        elif kind == "blocks" and int(index) < len(blocks):
            block = blocks[int(index)]
            if _region_root(block).type in REGION_TYPES:
                drop.add(id(_region_root(block)))
            elif diagnostic.rule in GEOMETRY_RULES:
                clip.add(id(block))
            elif diagnostic.rule in TEXT_DETAIL_RULES:
                strip.add(id(block))
        elif kind == "relations" and int(index) < len(paper.relations):
            relation = paper.relations[int(index)]
            relations.add((relation.type, relation.from_, relation.to))
        elif kind == "sections" and int(index) < len(section_list):
            heading = id(section_list[int(index)][0])
            if diagnostic.rule == "R21" and diagnostic.path.endswith(
                (".parent_heading_block_id", ".level")
            ):
                orphans.add(heading)
            else:
                sections.add(heading)

    if drop:
        regions = [b for b in builder.blocks if id(b) in drop]
        _drop_blocks(builder, {id(b) for b in regions})
        kinds = sorted({b.type for b in regions})
        builder.salvage_notes.append(f"dropped {len(regions)} {'/'.join(kinds)} region(s)")
        changed = True
    if clip:
        changed |= _clip_blocks(builder, [b for b in builder.blocks if id(b) in clip])
    if strip:
        for block in builder.blocks:
            if id(block) in strip:
                block.spans, block.repairs = (), ()
        builder.salvage_notes.append(f"spans/repairs stripped from {len(strip)} text block(s)")
        changed = True
    if relations:
        before = len(builder.relations)
        builder.relations = [
            r for r in builder.relations if (r[0], r[1].block_id, r[2].block_id) not in relations
        ]
        builder.salvage_notes.append(f"dropped {before - len(builder.relations)} relation(s)")
        changed = True
    if sections:
        _drop_sections(builder, sections)
        builder.salvage_notes.append(f"dropped {len(sections)} section(s)")
        changed = True
    orphans -= sections
    if orphans:
        # Dropping nothing still re-runs `reparent_orphans`, which re-attaches every section
        # whose parent opens no section and re-derives every level from its parent.
        _drop_sections(builder, set())
        builder.salvage_notes.append(f"re-attached {len(orphans)} orphaned section(s)")
        changed = True
    return changed


def _region_root(block: AssembledBlock) -> AssembledBlock:
    """The top-level block a nested one lives in: a table cell's defect is its table's."""
    while block.parent is not None:
        block = block.parent
    return block


def _drop_duplicates(builder: PaperBuilder) -> bool:
    """Rule 8: keep the FIRST block for each id. A colliding nested block takes its region with
    it, since a table missing one of its own cells is not a table either."""
    builder.assign_ids()
    seen: set[str] = set()
    drop: set[int] = set()
    for block in builder.blocks:
        if block.block_id in seen:
            root = _region_root(block)
            drop.add(id(root if root.type in REGION_TYPES else block))
        seen.add(block.block_id)
    if not drop:
        return False
    count = len(drop)
    _drop_blocks(builder, drop)
    builder.salvage_notes.append(
        f"dropped {count} block(s) whose content-derived ids collided (R8)"
    )
    return True


def _drop_blocks(builder: PaperBuilder, drop: set[int]) -> None:
    """Remove blocks, everything nested in them, and every reference to them."""
    grew = True
    while grew:
        grew = False
        for block in builder.blocks:
            if id(block) not in drop and block.parent is not None and id(block.parent) in drop:
                drop.add(id(block))
                grew = True
    # An id is GONE only if no surviving block carries it: a dropped duplicate shares its id with
    # the block that is kept, and references to THAT one must survive the scrub below.
    kept_ids = {b.block_id for b in builder.blocks if id(b) not in drop}
    gone = {b.block_id for b in builder.blocks if id(b) in drop} - kept_ids
    builder.blocks = [b for b in builder.blocks if id(b) not in drop]
    builder.relations = [
        r for r in builder.relations if id(r[1]) not in drop and id(r[2]) not in drop
    ]
    builder.sections = [
        (heading, level, parent, [m for m in members if id(m) not in drop])
        for heading, level, parent, members in builder.sections
    ]
    if any(id(section[0]) in drop for section in builder.sections):
        _drop_sections(builder, drop)
    for block in builder.blocks:
        if block.payload is not None:
            block.payload = cast(dict[str, Any], _scrub(block.payload, gone))


def _scrub(value: Any, gone: set[str]) -> Any:
    """`value` with every reference to a dropped block id removed.

    A payload's optional id fields are NON-NULLABLE-OPTIONAL (`caption_block`, `referenced_by`):
    omitted, never null, and a list is never empty. So a dangling key is deleted, a list is
    filtered and deleted if that empties it, and a list element that is itself a dict naming a
    dropped id (a grid cell's `cell_id`) goes with it.
    """
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if isinstance(item, str) and item in gone:
                continue
            scrubbed = _scrub(item, gone)
            if isinstance(item, list) and item and not scrubbed:
                continue
            out[key] = scrubbed
        return out
    if isinstance(value, list):
        return [
            _scrub(item, gone)
            for item in value
            if not (isinstance(item, str) and item in gone)
            and not (
                isinstance(item, dict)
                and any(v in gone for v in item.values() if isinstance(v, str))
            )
        ]
    return value


def _drop_sections(builder: PaperBuilder, headings: set[int]) -> None:
    """Drop the sections whose heading block's `id()` is in `headings`, and re-attach the ones
    they parented - rule 21 again, via the same `reparent_orphans` the parse uses, so a salvaged
    tree follows the parse's own rule."""
    nodes = [
        SectionNode(
            heading_block=cast(LayoutBlock, heading),
            level=level,
            parent_heading_block=cast(LayoutBlock | None, parent),
            member_blocks=cast(list[LayoutBlock], list(members)),
        )
        for heading, level, parent, members in builder.sections
    ]
    kept = reparent_orphans(nodes, keep=lambda node: id(node.heading_block) not in headings)
    builder.sections = [
        (
            cast(AssembledBlock, node.heading_block),
            node.level,
            cast(AssembledBlock | None, node.parent_heading_block),
            cast(list[AssembledBlock], node.member_blocks),
        )
        for node in kept
    ]


def _clip_blocks(builder: PaperBuilder, blocks: list[AssembledBlock]) -> bool:
    """Clip text blocks' line bands to their page's crop box. A block with no visible band left
    has no visible text either, and is the one text block salvage removes (and says so)."""
    offpage: set[int] = set()
    clipped = 0
    for block in blocks:
        crop = builder.frames[block.page_index].crop_box
        bands = [band for raw in block.line_bands if (band := _clip(raw, crop)) is not None]
        if not bands:
            offpage.add(id(block))
        elif bands != block.line_bands:
            block.line_bands = bands
            clipped += 1
    if clipped:
        builder.salvage_notes.append(f"geometry clipped to the crop box on {clipped} block(s)")
    if offpage:
        _drop_blocks(builder, offpage)
        builder.salvage_notes.append(f"dropped {len(offpage)} block(s) wholly off the page")
    return bool(clipped or offpage)


def _clip(band: BBox, crop: BBox) -> BBox | None:
    x0, y0 = max(band[0], crop[0]), max(band[1], crop[1])
    x1, y1 = min(band[2], crop[2]), min(band[3], crop[3])
    if x1 <= x0 or y1 <= y0:
        return None
    return [x0, y0, x1, y1]


# ── stages 2 and 3 ───────────────────────────────────────────────────────────────────────────


def _text_only(builder: PaperBuilder) -> None:
    regions = {id(b) for b in builder.blocks if b.type in REGION_TYPES and b.parent is None}
    relations, sections = len(builder.relations), len(builder.sections)
    if regions:
        _drop_blocks(builder, regions)
    builder.relations, builder.sections = [], []
    _clip_blocks(builder, [b for b in builder.blocks if b.line_bands])
    builder.salvage_notes.append(
        f"text-only: dropped {len(regions)} region(s), {relations} relation(s) and "
        f"{sections} section(s)"
    )


def _bare_text(builder: PaperBuilder) -> None:
    for block in builder.blocks:
        block.spans, block.repairs = (), ()
    builder.bare_metadata = True
    builder.emit_references = False
    builder.salvage_notes.append("bare text: spans, repairs, metadata and references dropped")
