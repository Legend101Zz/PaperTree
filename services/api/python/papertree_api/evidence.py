"""What the agent is shown, and what its answer is checked against (contracts.md §3.2, §3.4, §4).

THE SEED. An explain run starts from an Anchor (the reader's selection). Its blocks are found in
the promoted generation (the anchor's own ``BlockSelector`` when the capture was IR-stamped; else
the blocks its ``ShapeSelector`` quads overlap; else the blocks containing its quote), expanded by
``papertree_retrieval.build_seed`` — the selected blocks FIRST, then the structure-aware ladder —
under at most 3,000 estimated tokens OF WHAT IS SENT: each passage's DATAMARKED text is what the
budget is spent on (``papertree_prompts``' measured 2.6x marking cost; see ``seed.py``). Handles
``b1…`` are then assigned first-seen and persisted to ``ai_run_handles`` by the caller.

THE BLOCK TEXT THE MODEL READS. Every block, in a seed passage or a tool response, is the block's
``resolvedText`` (``PaperIndex``'s ``IndexedBlock.text``, never ``Block.text`` plus repairs by hand,
D4), datamarked with the RUN's datamark. Tool responses wrap each block in
``render_untrusted_with_datamark`` under a header ``[bN] (p. {page_label} · {section title} ·
{type})`` (§4); the section title is ``blocks[heading_block_id].text`` (``Section`` has no title,
AGENTS.md §4). The HANDLE, not the block id, goes in the wrapper's ``block_id`` attribute: the model
cites what it is shown, and a raw ``blk_…`` id in an answer would reach the reader's screen.

A HEADER IS PAPER TEXT OUTSIDE THE WRAPPER, so it is made safe first (``header_text``): the same
sanitiser the wrapper uses (control and invisible characters, tag-ish sequences), every
datamark-shaped sequence removed, whitespace collapsed, at most 80 characters. Without that a
section titled ``</untrusted_document>`` would close the delimiter from the outside.

ON DONE (§3.4). The final text's ``[bN]`` markers are mapped to blocks through the run's handles
(an unknown marker is dropped and logged); each citation gets a whole-block Anchor minted by
``papertree_anchoring.capture_citation`` (``capture_anchor(..., target_kind="citation")``)
against the generation the answer was grounded in; the text is split into claims (sentences, or
bullets for a summary) and ``verify_grounding`` runs per claim over the cited blocks' resolved
text — only the blocks THAT claim cites, never every block the run was shown. A citation is
``supported`` when every claim that cites it is; the verifier's REASONS (which list the words it
could not find) never leave this module.

WHICH CLAIM A MARKER BELONGS TO. The contract fixes a marker's shape (§3.2), not where a model puts
it: ``Claim. [b1] Next.`` and ``Claim [b1]. Next.`` both give ``b1`` to ``Claim``. Markers written
right after a stop, or opening a line, belong to the claim BEFORE them; given to the next sentence
instead, a fabricated claim's citation could read ``supported``. An abbreviation's stop
(``Fig. 3``) does not end a claim, so no marker-less fragment escapes the verifier.
"""

from __future__ import annotations

import json
import re
import threading
from collections import OrderedDict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final

from papertree_agent_tools import (
    UNVERIFIED_REASON,
    GroundedAnswer,
    VerifiedClaim,
    verify_grounding,
)
from papertree_anchoring import (
    IndexedDocument,
    api_text_stream_id,
    capture_citation,
    index_document,
    normalise_for_match,
)
from papertree_db import Generation, OwnerId, PaperId, PaperTreeDb
from papertree_document_ir import Paper
from papertree_prompts import (
    DATAMARK_SHAPE,
    UntrustedChunk,
    datamark_text,
    render_untrusted_with_datamark,
    sanitise,
)
from papertree_retrieval import (
    DEFAULT_TOKEN_ESTIMATOR,
    PaperIndex,
    PaperIndexCache,
    build_seed,
)
from pydantic import ValidationError

from .ir import paper_document
from .logging import log_event
from .schemas import AgentPassage, AgentSeed, AnchorV1
from .wiretime import now_wire

#: contracts.md §3.2 regex, shared with the agent (`done.markers`).
MARKER: Final = re.compile(r"\[(b\d+(?:\s*,\s*b\d+)*)\]")
HEADER_MAX_CHARS: Final = 80
QUOTE_MATCH_CHARS: Final = 80
#: §4 channel for text-layer paper content (the only kind this parser produces).
PAPER_CHANNEL: Final = "text_layer"

_WHITESPACE: Final = re.compile(r"\s+")
_MARKER_GROUPS: Final = rf"(?:\s*{MARKER.pattern})*"
#: A claim ends at `.`/`!`/`?` (and any closing quote or paren), TOGETHER WITH the marker groups
#: written right after it: `Claim. [b1] Next.` gives `b1` to `Claim.`, exactly as `Claim [b1].`
#: does (the contract fixes the marker's shape, not which side of the stop a model puts it).
_CLAIM_END: Final = re.compile(rf"(?P<stop>[.!?])[\"'”’)]*{_MARKER_GROUPS}(?=\s+[\"'“‘(\[A-Z0-9])")
#: Marker groups at the very start of a claim (a line that opens with, or is only, markers).
_LEADING_MARKERS: Final = re.compile(rf"^{_MARKER_GROUPS}\s*")
#: Words whose `.` does not end a sentence: `Fig. 3 shows …` is one claim, and a split there would
#: leave a marker-less fragment (`As Fig.`) that no verifier reads. A wrong merge costs precision
#: (two sentences checked together); a wrong split leaves words unchecked.
_ABBREVIATIONS: Final = frozenset(
    {"al", "approx", "cf", "ch", "e.g", "eq", "eqs", "fig", "figs", "i.e", "no", "nos", "p", "pp"}
    | {"ref", "refs", "resp", "sec", "secs", "tab", "tabs", "vol", "vs"}
)
_LAST_WORD: Final = re.compile(r"([\w.]+)$")
_BULLET: Final = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+")


# ── header-safe text ─────────────────────────────────────────────────────────────────────────


def header_text(text: str, *, limit: int = HEADER_MAX_CHARS) -> str:
    """Paper text that sits OUTSIDE the datamarked wrapper, made safe (see the module header)."""
    cleaned = DATAMARK_SHAPE.sub(" ", sanitise(text))
    cleaned = _WHITESPACE.sub(" ", cleaned).strip()
    if len(cleaned) > limit:
        cleaned = cleaned[: limit - 1].rstrip() + "…"
    return cleaned


def page_label(page_index: int) -> str:
    """PaperIR has no printed page label, so the label is the 1-based page number."""
    return str(page_index + 1)


def section_title(index: PaperIndex, block_id: str) -> str | None:
    section = index.section_of(block_id)
    if section is None:
        return None
    heading = index.block(section.heading_block_id)
    if heading is None or not heading.text.strip():
        return None
    return header_text(heading.text)


def passage_label(index: PaperIndex, block_id: str) -> str:
    """``p. 2 · 2. Unified Detection · paragraph`` (the seed passages' ``label``)."""
    block = index.block(block_id)
    if block is None:
        return ""
    parts = [f"p. {page_label(block.page_index)}"]
    title = section_title(index, block_id)
    if title:
        parts.append(title)
    parts.append(block.type)
    return " · ".join(parts)


def block_header(handle: str, index: PaperIndex, block_id: str) -> str:
    """contracts.md §4: ``[bN] (p. {page_label} · {section title} · {type})``."""
    return f"[{handle}] ({passage_label(index, block_id)})"


def render_block(
    handle: str, index: PaperIndex, block_id: str, *, paper_id: str, datamark: str
) -> str:
    """One block as a tool response shows it: the header, then the datamarked wrapper."""
    block = index.block(block_id)
    if block is None:  # pragma: no cover - callers only pass blocks of this index
        raise KeyError(block_id)
    chunk = UntrustedChunk(
        paper_id=paper_id,
        block_id=handle,
        page=block.page_index,
        channel=PAPER_CHANNEL,
        text=block.text,
    )
    return (
        block_header(handle, index, block_id)
        + "\n"
        + render_untrusted_with_datamark([chunk], datamark=datamark)
    )


def marked_cost(datamark: str) -> Callable[[str], int]:
    """The seed budget's cost: the estimated tokens of the DATAMARKED text that is sent."""

    def cost(text: str) -> int:
        return DEFAULT_TOKEN_ESTIMATOR.estimate(datamark_text(text, datamark=datamark))

    return cost


# ── the anchor's blocks ──────────────────────────────────────────────────────────────────────


def _selectors(anchor: Mapping[str, Any], kind: str) -> list[Mapping[str, Any]]:
    return [
        s for s in anchor.get("selectors", ()) if isinstance(s, Mapping) and s.get("type") == kind
    ]


def anchor_quote(anchor: Mapping[str, Any]) -> str:
    for selector in _selectors(anchor, "TextQuoteSelector"):
        exact = selector.get("exact")
        if isinstance(exact, str) and exact.strip():
            return exact
    return ""


def anchor_page(anchor: Mapping[str, Any]) -> int | None:
    for kind, key in (("PageSelector", "index"), ("ShapeSelector", "pageIndex")):
        for selector in _selectors(anchor, kind):
            value = selector.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                return value
    return None


def _overlaps(a: Sequence[float], b: Sequence[float]) -> bool:
    return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])


def _most_specific(index: PaperIndex, block_ids: list[str]) -> list[str]:
    """Drop a block when one of its descendants is also selected (a table and its cell)."""
    out = [
        block_id
        for block_id in block_ids
        if not any(
            block_id in index.parents(other, depth=32) for other in block_ids if other != block_id
        )
    ]
    return sorted(out, key=lambda b: (index.rank(b), b))


def selected_block_ids(index: PaperIndex, anchor: Mapping[str, Any]) -> list[str]:
    """The blocks of THIS generation an anchor selects, in reading order; possibly none.

    1. ``BlockSelector.blockId`` when it names a block here (an IR-stamped capture on this parse);
    2. else the text-bearing blocks whose bbox the ``ShapeSelector`` quads overlap (a pdf.js
       capture, or a capture on another parse: the quads are PDF space, which a re-parse keeps);
    3. else the blocks on the anchor's page (or anywhere) whose text contains the quote's start.
    """
    by_block = [
        str(s["blockId"])
        for s in _selectors(anchor, "BlockSelector")
        if isinstance(s.get("blockId"), str) and s["blockId"] in index
    ]
    if by_block:
        return sorted(dict.fromkeys(by_block), key=lambda b: (index.rank(b), b))

    overlapping: list[str] = []
    for shape in _selectors(anchor, "ShapeSelector"):
        page = shape.get("pageIndex")
        quads = [q for q in shape.get("quads", ()) if isinstance(q, Sequence) and len(q) == 4]
        for block_id in index.reading_order:
            block = index.block(block_id)
            if block is None or block.page_index != page or not block.text.strip():
                continue
            if any(_overlaps(block.bbox, quad) for quad in quads):
                overlapping.append(block_id)
    if overlapping:
        return _most_specific(index, list(dict.fromkeys(overlapping)))

    quote = normalise_for_match(anchor_quote(anchor)).text[:QUOTE_MATCH_CHARS]
    if not quote:
        return []
    page = anchor_page(anchor)
    matches = [
        block_id
        for block_id in index.reading_order
        if (block := index.block(block_id)) is not None
        and (page is None or block.page_index == page)
        and quote in normalise_for_match(block.text).text
    ]
    return _most_specific(index, matches)


@dataclass(frozen=True, slots=True)
class SeedPlan:
    """The seed to send and the blocks its passages are, in handle order (b1 first)."""

    block_ids: tuple[str, ...]
    quote: str
    page_label: str
    section: str | None
    #: (block_id, label, datamarked text), in order; handles are assigned by the caller.
    passages: tuple[tuple[str, str, str], ...]
    total_tokens: int

    def to_wire(self, handles: Sequence[str]) -> AgentSeed:
        return AgentSeed(
            quote=self.quote,
            page_label=self.page_label,
            section=self.section,
            passages=[
                AgentPassage(handle=handle, label=label, text=text)
                for handle, (_block, label, text) in zip(handles, self.passages, strict=True)
            ],
        )


def plan_seed(index: PaperIndex, anchor: Mapping[str, Any], *, datamark: str) -> SeedPlan:
    """The seed for an anchor (contracts.md §3.2), under the marked-text budget."""
    quote = anchor_quote(anchor)
    selection = selected_block_ids(index, anchor)
    passages: list[tuple[str, str, str]] = []
    total = 0
    if selection:
        seed = build_seed(index, selection, focus=quote or None, cost=marked_cost(datamark))
        passages = [
            (p.block_id, passage_label(index, p.block_id), datamark_text(p.text, datamark=datamark))
            for p in seed.passages
        ]
        total = seed.total_tokens
    first = selection[0] if selection else None
    first_block = index.block(first) if first is not None else None
    page = first_block.page_index if first_block is not None else anchor_page(anchor)
    if not quote and first_block is not None:
        quote = first_block.text[:500]
    return SeedPlan(
        block_ids=tuple(block for block, _label, _text in passages),
        quote=quote,
        page_label=f"p. {page_label(page)}" if page is not None else "",
        section=section_title(index, first) if first is not None else None,
        passages=tuple(passages),
        total_tokens=total,
    )


# ── the index and the anchoring document, cached per process ─────────────────────────────────


def load_index(
    cache: PaperIndexCache,
    db: PaperTreeDb,
    owner: OwnerId,
    user_id: str,
    paper_id: str,
    generation: int,
) -> PaperIndex:
    """The promoted generation's index, through the process cache. ``KeyError`` if absent."""
    row = db.get_paper(owner, PaperId(paper_id), Generation(generation))
    if row is None:
        raise KeyError(f"no paper {paper_id} at generation {generation}")
    return cache.get(
        user_id,
        paper_id,
        generation,
        stamp=str(row["created_at"]),
        load=lambda: PaperIndex.load(db, owner, PaperId(paper_id), Generation(generation)),
    ).index


class DocumentCache:
    """The ``papertree_anchoring`` document a citation Anchor is minted against, per generation.

    Building one validates the whole PaperIR ``Paper`` (hundreds of blocks), so it is kept, keyed
    like the index cache (user, paper, generation, stamp), 4 entries.
    """

    def __init__(self, max_entries: int = 4) -> None:
        self._entries: OrderedDict[tuple[str, str, int, str], IndexedDocument] = OrderedDict()
        self._lock = threading.Lock()
        self.max_entries = max_entries

    def get(
        self, db: PaperTreeDb, owner: OwnerId, user_id: str, paper_id: str, generation: int
    ) -> IndexedDocument | None:
        row = db.get_paper(owner, PaperId(paper_id), Generation(generation))
        if row is None:
            return None
        key = (user_id, paper_id, generation, str(row["created_at"]))
        with self._lock:
            cached = self._entries.get(key)
            if cached is not None:
                self._entries.move_to_end(key)
                return cached
        document = paper_document(db, owner, PaperId(paper_id), Generation(generation))
        if document is None:
            return None
        paper = Paper.model_validate(document)
        indexed = index_document(
            paper, api_text_stream_id(paper_id, generation, paper.parser.version)
        )
        with self._lock:
            self._entries[key] = indexed
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)
        return indexed


# ── on done: markers, claims, grounding, citation Anchors ─────────────────────────────────────


def markers_in(text: str) -> list[str]:
    """Every ``bN`` inside a ``[…]`` marker, first appearance first, deduplicated."""
    out: dict[str, None] = {}
    for match in MARKER.finditer(text):
        for handle in match.group(1).split(","):
            out.setdefault(handle.strip(), None)
    return list(out)


def strip_markers(text: str) -> str:
    return _WHITESPACE.sub(" ", MARKER.sub(" ", text)).strip()


def _sentences(line: str) -> list[str]:
    parts: list[str] = []
    start = 0
    for end in _CLAIM_END.finditer(line):
        if end.group("stop") == ".":
            word = _LAST_WORD.search(line[start : end.start("stop")])
            if word is not None and word.group(1).lower() in _ABBREVIATIONS:
                continue
        parts.append(line[start : end.end()])
        start = end.end()
    parts.append(line[start:])
    return [part.strip() for part in parts if part.strip()]


def _attach_leading_markers(claims: list[str], part: str) -> None:
    """Appends ``part`` to ``claims``; marker groups that OPEN it (or are all of it) belong to
    the claim before it, when there is one (``Claim.\\n[b1]``)."""
    lead = _LEADING_MARKERS.match(part)
    if claims and lead is not None and lead.end() > 0:
        claims[-1] = f"{claims[-1]} {part[: lead.end()].strip()}"
        part = part[lead.end() :].strip()
    if part:
        claims.append(part)


def split_claims(text: str) -> list[str]:
    """Sentences of an answer, each with the markers written right after its stop; a
    line-broken answer is split per line first."""
    claims: list[str] = []
    for line in text.splitlines():
        for part in _sentences(line):
            _attach_leading_markers(claims, part)
    return claims


def split_bullets(text: str) -> list[str]:
    """A summary's bullets (``- …``). Lines that are not bullets are ignored, except a line of
    markers only, which belongs to the bullet before it; with no bullets at all, every non-empty
    line is one."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    bullets: list[str] = []
    for line in lines:
        if _BULLET.match(line):
            bullets.append(_BULLET.sub("", line, count=1).strip())
        elif bullets and strip_markers(line) == "":
            _attach_leading_markers(bullets, line)
    return bullets if bullets else lines


def claim_supported(claim: str, cited_blocks: Sequence[str], texts: Mapping[str, str]) -> bool:
    """``verify_grounding`` on one claim over its cited blocks. Markers are stripped first: the
    handle ``b3`` is not a word of the paper and would count against the claim's coverage."""
    clean = strip_markers(claim)
    if not clean or not cited_blocks:
        return False
    answer = GroundedAnswer(
        states=clean,
        interpretation=None,
        supporting_block_ids=tuple(cited_blocks),
        source_pages=(),
        source_regions=(),
        confidence=1.0,
        unresolved_ambiguities=(),
        claims=(
            VerifiedClaim(text=clean, supported_by=tuple(cited_blocks), reason=UNVERIFIED_REASON),
        ),
    )
    return verify_grounding(answer, texts).claims[0].supported


@dataclass(frozen=True, slots=True)
class MintedCitation:
    citation_id: str
    ordinal: int
    marker: str
    block_id: str
    page_index: int
    anchor: dict[str, Any]
    supported: bool | None

    def wire(self) -> dict[str, Any]:
        return {
            "citation_id": self.citation_id,
            "ordinal": self.ordinal,
            "marker": self.marker,
            "page_index": self.page_index,
            "anchor": self.anchor,
            "supported": self.supported,
        }


@dataclass
class CitationMinter:
    """Mints citations for one run's answer. ``handles`` is the run's ``handle -> block_id``."""

    run_id: str
    handles: Mapping[str, str]
    document: IndexedDocument | None
    texts: Mapping[str, str]
    new_id: Callable[[str], str]
    dropped: list[str] = field(default_factory=list)
    _next: int = 0

    def mint(self, marker: str, supported: bool | None) -> MintedCitation | None:
        block_id = self.handles.get(marker)
        if block_id is None:
            self.dropped.append(marker)
            log_event(
                "run.citation_dropped",
                level="warning",
                run_id=self.run_id,
                error_code="unknown_marker",
                marker=marker,
            )
            return None
        if self.document is None or block_id not in self.document.by_id:
            self.dropped.append(marker)
            log_event(
                "run.citation_dropped",
                level="warning",
                run_id=self.run_id,
                error_code="block_not_in_generation",
                marker=marker,
            )
            return None
        citation_id = self.new_id("cit")
        anchor: dict[str, Any] = dict(
            capture_citation(self.document, block_id, citation_id=citation_id, at=now_wire())
        )
        try:  # never store a record the contract refuses (anchor-v1.schema.json == AnchorV1),
            # checked on its JSON: the wire form (strict pydantic takes a JSON array as a tuple,
            # a Python list not)
            AnchorV1.model_validate_json(json.dumps(anchor))
        except ValidationError:
            self.dropped.append(marker)
            log_event(
                "run.citation_dropped",
                level="error",
                run_id=self.run_id,
                error_code="anchor_invalid",
                marker=marker,
            )
            return None
        page_index = self.document.by_id[block_id].block.page_index
        citation = MintedCitation(
            citation_id=citation_id,
            ordinal=self._next,
            marker=marker,
            block_id=block_id,
            page_index=page_index,
            anchor=anchor,
            supported=supported,
        )
        self._next += 1
        return citation


def cite_answer(final_text: str, minter: CitationMinter) -> list[MintedCitation]:
    """An answer's citations, one per distinct known marker, in order of first appearance, each
    ``supported`` iff every claim citing it passes the verifier."""
    verdicts: dict[str, bool] = {}
    for claim in split_claims(final_text):
        cited = [m for m in markers_in(claim) if m in minter.handles]
        if not cited:
            continue
        blocks = [minter.handles[m] for m in cited]
        ok = claim_supported(claim, blocks, minter.texts)
        for marker in cited:
            verdicts[marker] = verdicts.get(marker, True) and ok
    citations: list[MintedCitation] = []
    for marker in markers_in(final_text):
        citation = minter.mint(marker, verdicts.get(marker))
        if citation is not None:
            citations.append(citation)
    return citations


@dataclass(frozen=True, slots=True)
class SummaryBulletOut:
    text: str
    citations: tuple[MintedCitation, ...]
    supported: bool


def cite_summary(final_text: str, minter: CitationMinter) -> list[SummaryBulletOut]:
    """contracts.md §3.4: bullets ``- … [bN]``; a bullet without a valid marker is
    ``supported: false``; each marker in a bullet is its own citation."""
    out: list[SummaryBulletOut] = []
    for bullet in split_bullets(final_text):
        known = [m for m in markers_in(bullet) if m in minter.handles]
        supported = bool(known) and claim_supported(
            bullet, [minter.handles[m] for m in known], minter.texts
        )
        citations = []
        for marker in markers_in(bullet):
            citation = minter.mint(marker, supported if known else False)
            if citation is not None:
                citations.append(citation)
        out.append(
            SummaryBulletOut(
                text=bullet, citations=tuple(citations), supported=supported and bool(citations)
            )
        )
    return out
