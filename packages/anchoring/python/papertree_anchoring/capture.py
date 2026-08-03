"""Mint an ``Anchor``'s selectors in Python — the capture half of ``src/capture.ts``.

EVERY SELECTOR IS WRITTEN AT CAPTURE TIME OR NOT AT ALL (``capture.ts:1-11``). A selector cannot be
backfilled, because the document it would have described is the one that has already changed. That
is why this emits the same SIX selectors ``captureAnchor`` does rather than only the three #72 names
as interesting: emitting three would permanently cost a Python-minted anchor its T2 hint and its T5
rung, and no later patch can recover them.

SCOPE, STATED AS A LIMIT RATHER THAN DISCOVERED AS A BUG. This mints WHOLE-BLOCK anchors only — the
shape ``SourceRegion`` carries and the shape ``verify_answer_grounding`` produces (one region per
supporting block, with ``block.bbox``). Sub-block ranges need ``lineband.ts::quadsForRange``, whose
whole reason to exist is that a span bbox is the extractor's font box and 17 of resnet's 295 are
~7.33 pt too tall; emitting unclamped span boxes would ship that defect into Python. Filed as #123,
not ported.

THE RESOLVER IS NOT PORTED AND MUST NOT BE. ``resolve.ts`` carries hand-tuned constants — 0.72 /
0.60 (which ``match.ts:150`` calls "a PROPOSAL, not a measured value" in its own words),
MIN_QUOTE_WITHOUT_CONTEXT = 10, PROXIMITY_TOLERANCE_PT = 6 — and a second copy of them is a second
contract that drifts. TypeScript resolves; Python captures. ``conformance/`` keeps the two halves
honest: Python declares the tier it expects the real resolver to reach, and the TypeScript suite
runs the real resolver and checks the claim.

The selector types are TypedDicts because they are wire records defined in ``src/types.ts``, they
are camelCase, and their only job is to be serialised: a TypedDict IS a dict at runtime, so there is
no ``as_dict`` layer to drift, and mypy still checks every key.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

from .document import IndexedBlock, IndexedDocument
from .quotenorm import normalise_for_match, snap_to_word_boundary

#: Context window either side of the quote, in code points. 64 and not Hypothesis's hard-coded 32:
#: academic prose is dense in repeated phrasing and 32 characters is frequently non-discriminating.
#: ``capture.ts:34``.
CONTEXT_CODE_POINTS = 64

#: ``TargetKind`` from ``src/types.ts:39-49``. All ten, because ``targets.spec`` requires all ten to
#: resolve and a Python caller must be able to say which one it means.
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


class BlockSelector(TypedDict):
    type: Literal["BlockSelector"]
    blockId: str
    #: ``Block.content_hash`` AS SHIPPED, never recomputed — and the reason is MEASURED here rather
    #: than inherited. ``document.ts:368-386`` argues from ``normalise_text`` not being idempotent;
    #: on this corpus that hazard is unexercised (``content_hash(text)`` and
    #: ``content_hash(text_normalised)`` both equal the shipped value for all 184 blocks that carry
    #: one). What DOES bite is ABSENCE: 15 of the 199 blocks ship no ``content_hash``, the resolver
    #: reads that as ``""`` (``document.ts:384``), and no recomputation can produce ``""``. So a
    #: recomputing capture loses T1 on exactly those 15 — run as a mutation, 7 of 46 vectors red.
    blockTextHash: str


class PageSelector(TypedDict):
    type: Literal["PageSelector"]
    index: int
    #: PaperIR's ``Page`` has no printed label, so this is never emitted today. Declared because
    #: ``types.ts`` has it and an absent optional is not the same claim as a missing field.
    label: NotRequired[str]


class TextPositionSelector(TypedDict):
    type: Literal["TextPositionSelector"]
    start: int
    end: int


class TextQuoteSelector(TypedDict):
    type: Literal["TextQuoteSelector"]
    exact: str
    prefix: str
    suffix: str
    exactNormalised: str
    prefixNormalised: str
    suffixNormalised: str


class ShapeSelector(TypedDict):
    type: Literal["ShapeSelector"]
    pageIndex: int
    quads: list[list[float]]
    polygons: list[list[list[float]]]
    pageWidth: float
    pageHeight: float
    rotation: int
    userUnit: float
    cropBox: list[float]


class SectionPathSelector(TypedDict):
    type: Literal["SectionPathSelector"]
    path: list[str]
    headingText: str
    paraIndexInSection: int
    charOffsetInPara: int


Selector = (
    BlockSelector
    | PageSelector
    | TextPositionSelector
    | TextQuoteSelector
    | ShapeSelector
    | SectionPathSelector
)


class AnchorDoc(TypedDict):
    paperId: str
    pdfSha256: str
    parserVersion: str
    textStreamId: str


class Created(TypedDict):
    mode: Literal["source", "guided"]
    at: str
    client: str


class Anchor(TypedDict):
    anchorVersion: Literal[1]
    offsetUnit: Literal["unicode"]
    id: str
    doc: AnchorDoc
    targetKind: TargetKind
    provenanceClass: Literal["source", "ai_generated"]
    selectors: list[Selector]
    created: Created


def _section_path(doc: IndexedDocument, heading_block_id: str) -> list[str]:
    """The path up through ``parent_heading_block_id``, as HEADING TEXTS.

    Texts and not numbers because the IR stores neither a number nor a path: ``Section`` is
    ``{heading_block_id, level, block_ids}`` and the display title lives in the heading block.
    """
    path: list[str] = []
    guard: set[str] = set()
    current = doc.section_containing(heading_block_id)
    while current is not None and current.heading_block_id not in guard:
        guard.add(current.heading_block_id)
        heading = doc.by_id.get(current.heading_block_id)
        path.insert(0, heading.text.strip() if heading is not None else current.heading_block_id)
        parent_id = current.parent_heading_block_id
        if parent_id is None:
            break
        current = next(
            (s for s in doc.sections if s.heading_block_id == parent_id),
            None,
        )
    return path


def _geometry(indexed: IndexedBlock) -> tuple[list[list[float]], list[list[list[float]]]] | None:
    """A whole-block target's paintable geometry: the block's own polygon, which is snug.

    ``capture.ts:187-195``: polygon when it has one, a bbox ring when it does not, nothing when the
    block has no extent at all — a degenerate block resolves at no tier rather than at a fake one.
    """
    block = indexed.block
    bbox = [float(v) for v in block.bbox]
    polygon = [[float(point[0]), float(point[1])] for point in block.polygon]
    if len(polygon) >= 3:
        return [bbox], [polygon]
    if bbox[2] > bbox[0]:
        return [bbox], [
            [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]]]
        ]
    return None


def capture_selectors(doc: IndexedDocument, block_id: str) -> list[Selector]:
    """Every selector a whole-block target here can support, in ``captureAnchor``'s own order.

    Raises ``KeyError`` when the block is not in this parse — the same refusal ``captureAnchor``
    makes, and for the same reason: an anchor minted against a document that does not contain its
    own target is not a partial anchor, it is a wrong one.
    """
    indexed = doc.by_id.get(block_id)
    if indexed is None:
        raise KeyError(f"capture_selectors: no block {block_id} in this parse")

    block = indexed.block
    selectors: list[Selector] = [
        BlockSelector(
            type="BlockSelector",
            blockId=block.block_id,
            blockTextHash=block.content_hash or "",
        ),
        PageSelector(type="PageSelector", index=block.page_index),
    ]

    start, end = indexed.stream_start, indexed.stream_end
    selectors.append(TextPositionSelector(type="TextPositionSelector", start=start, end=end))

    stream = doc.stream
    exact = stream[start:end]
    if exact:
        prefix_from = snap_to_word_boundary(stream, max(0, start - CONTEXT_CODE_POINTS), -1)
        suffix_to = snap_to_word_boundary(stream, min(len(stream), end + CONTEXT_CODE_POINTS), 1)
        prefix = stream[prefix_from:start]
        suffix = stream[end:suffix_to]
        selectors.append(
            TextQuoteSelector(
                type="TextQuoteSelector",
                exact=exact,
                prefix=prefix,
                suffix=suffix,
                exactNormalised=normalise_for_match(exact).text,
                prefixNormalised=normalise_for_match(prefix).text,
                suffixNormalised=normalise_for_match(suffix).text,
            )
        )

    geometry = _geometry(indexed)
    page = doc.page(block.page_index)
    if geometry is not None and page is not None:
        quads, polygons = geometry
        selectors.append(
            ShapeSelector(
                type="ShapeSelector",
                pageIndex=block.page_index,
                quads=quads,
                polygons=polygons,
                pageWidth=page.width,
                pageHeight=page.height,
                # The page's /Rotate is ALREADY applied to every stored coordinate; recorded for
                # auditability. A consumer that applies it again double-rotates every highlight.
                rotation=page.rotation,
                userUnit=page.user_unit,
                cropBox=[float(v) for v in page.crop_box],
            )
        )

    section = doc.section_containing(block.block_id)
    if section is not None:
        heading = doc.by_id.get(section.heading_block_id)
        selectors.append(
            SectionPathSelector(
                type="SectionPathSelector",
                path=_section_path(doc, section.heading_block_id),
                headingText=heading.text if heading is not None else "",
                paraIndexInSection=max(0, list(section.block_ids).index(block.block_id))
                if block.block_id in section.block_ids
                else 0,
                charOffsetInPara=0,
            )
        )
    return selectors


def capture_anchor(
    doc: IndexedDocument,
    block_id: str,
    *,
    anchor_id: str,
    at: str,
    client: str,
    target_kind: TargetKind = "text",
    provenance_class: Literal["source", "ai_generated"] = "source",
    mode: Literal["source", "guided"] = "source",
) -> Anchor:
    """The full ``Anchor`` record, ready to be stored or handed to the TypeScript resolver.

    ``provenance_class`` defaults to ``source`` and is a HARD RULE, not a label
    (``types.ts:51-56``):
    a highlight over model-authored prose must never be fed back to a model as text from a paper. A
    Python caller minting an anchor over a ``Derivation`` passes ``ai_generated`` here.
    """
    return Anchor(
        anchorVersion=1,
        offsetUnit="unicode",
        id=anchor_id,
        doc=AnchorDoc(
            paperId=doc.paper_id,
            pdfSha256=doc.source_hash,
            parserVersion=doc.parser_version,
            textStreamId=doc.text_stream_id,
        ),
        targetKind=target_kind,
        provenanceClass=provenance_class,
        selectors=capture_selectors(doc, block_id),
        created=Created(mode=mode, at=at, client=client),
    )
