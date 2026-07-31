"""Normalise hand-drawn gold into scoreable gold — deterministically, and on the record.

The first real annotation pass (18 pages, 249 regions, `research/benchmarks/gold/ptub-gold.json`)
came back with excellent geometry and 55 regions whose `flow` contradicted their `type`. The
cause was a tool defect, not an annotator one: `annotate.py` shipped the type and flow selects as
two INDEPENDENT sticky controls, so flow kept whatever the previous region left behind. A run of
figures typed with `flow: "caption"` is what a sticky dropdown looks like from the outside.

That defect is fixed at source in `annotate.py`. This module exists for the data drawn BEFORE the
fix, and as a standing validator afterwards.

WHY AUTOMATED REPAIR IS ALLOWED HERE, AND WHERE IT STOPS

`ANNOTATION_GUIDE.md` §1 and the epic brief both forbid the parser annotating its own benchmark:
gold produced with knowledge of a candidate's behaviour scores that candidate, not the task. That
constraint is real and this module is deliberately built to stay inside it:

  * Every rule is a function of the ANNOTATOR'S OWN LABEL and of the RAW PDF TEXT under the box.
    Nothing here reads PaperIR, PaperTree's output, Docling's output, or any metric.
  * Every rule was already written down in `ANNOTATION_GUIDE.md` before this data existed - the
    flow table and *"a caption is its own region, typed `caption`"*. This applies the guide; it
    does not invent a standard after seeing results.
  * Every change is RECORDED as a `GoldRepair` and reported. `normalise_gold` returns the repairs
    alongside the gold, `__main__` prints them, and the result document carries the count.
  * The metrics are reported BOTH WAYS - raw and normalised - so the repair's effect on the
    numbers is visible rather than assumed harmless.

What is NOT repaired is as important. Three defects are detected and reported as warnings, and
deliberately left alone, because fixing them needs a judgement only the annotator can make:

  1. A float box that SWALLOWED its caption ("( ) ( ) Figure 4. Training on ImageNet..." - the
     box starts with axis labels, so the caption is inside the figure region). Splitting it means
     choosing a y-coordinate, which is annotation, not normalisation.
  2. Missing `parent` links. Caption association needs caption -> float edges and the tool never
     collected them, so that metric stays not-evaluable. Guessing the nearest float would be
     scoring PaperTree's own caption heuristic against a copy of itself.
  3. Whole-page boxes over reference lists (one `citation` region covering 15 bibliography
     entries). Under-segmented against a parser that emits one block per entry - real, and only
     the annotator can decide whether the page was meant to be scored at entry granularity.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "CANONICAL_FLOW",
    "GoldRepair",
    "GoldWarning",
    "NormalisedGold",
    "normalise_gold",
]

#: The flow each type belongs to, straight out of `ANNOTATION_GUIDE.md`'s flow table.
#:
#: `figure` and `table` map to `body` rather than `float`. The guide offers `float` for "a figure
#: or table sitting outside the text column", but the distinction is not one an annotator can draw
#: reliably and nothing in `metrics.py` consumes it: reading order ranks whatever gold gives a
#: non-null `reading_order`, and element detection matches on bbox and type alone. Mapping both to
#: `body` keeps floats IN the reading order, which is what PaperIR's `doc_order` does (rule 15) -
#: so the two sides are at least measuring the same thing.
CANONICAL_FLOW: dict[str, str] = {
    "title": "body",
    "author": "body",
    "affiliation": "body",
    "abstract": "body",
    "heading": "body",
    "paragraph": "body",
    "list": "body",
    "code": "body",
    "equation": "body",
    "inline_equation": "body",
    "table": "body",
    "table_cell": "body",
    "figure": "body",
    "algorithm": "body",
    "citation": "body",
    "reference_entry": "body",
    "unknown": "body",
    "caption": "caption",
    "footnote": "footnote",
    "page_number": "footer",
    "margin_note": "margin",
    "header": "header",
    "footer": "footer",
}

#: A caption OPENS with its marker: `Figure 2:`, `Table 1.`, `Fig. 5:`, `Algorithm 3.`.
#:
#: The punctuation after the number is load-bearing and not decoration. Without it this matches
#: `"Figure 8 shows examples of spiral reconstructions..."`, which is a PARAGRAPH that mentions a
#: figure - present verbatim in this corpus at neural-odes p7, and retyping it `caption` would
#: delete a real paragraph from the gold and invent a caption that is not there.
_CAPTION_OPENER = re.compile(
    r"^\s*(?:figure|fig\.|table|algorithm|listing)\s*\d+\s*[.:]",
    re.IGNORECASE,
)

#: The same marker anywhere BUT the start - the signature of a float box that ate its caption.
_CAPTION_INSIDE = re.compile(
    r"(?:figure|fig\.|table|algorithm|listing)\s*\d+\s*[.:]",
    re.IGNORECASE,
)

#: Types that name a float, and so may legitimately be mistyped onto that float's caption.
_FLOAT_TYPES = frozenset({"figure", "table", "algorithm"})

#: A box covering more of the page than this is a whole-page box, not a region.
_WHOLE_PAGE_AREA_SHARE = 0.55


@dataclass(frozen=True, slots=True)
class GoldRepair:
    """One field of one region, changed, with the rule that changed it."""

    paper_id: str
    page: int
    gold_id: str
    field_name: str
    before: object
    after: object
    rule: str

    def describe(self) -> str:
        return (
            f"{self.paper_id} p{self.page} {self.gold_id}: "
            f"{self.field_name} {self.before!r} -> {self.after!r}  [{self.rule}]"
        )


@dataclass(frozen=True, slots=True)
class GoldWarning:
    """A defect that is reported and NOT repaired, because repairing it would be annotating."""

    paper_id: str
    page: int
    gold_id: str
    kind: str
    detail: str

    def describe(self) -> str:
        return f"{self.paper_id} p{self.page} {self.gold_id}: {self.kind} - {self.detail}"


@dataclass(slots=True)
class NormalisedGold:
    """Scoreable gold, plus the complete record of what was done to get there."""

    pages: list[dict[str, Any]]
    repairs: list[GoldRepair] = field(default_factory=list)
    warnings: list[GoldWarning] = field(default_factory=list)

    @property
    def region_count(self) -> int:
        return sum(len(page["regions"]) for page in self.pages)

    def repairs_by_rule(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for repair in self.repairs:
            counts[repair.rule] = counts.get(repair.rule, 0) + 1
        return dict(sorted(counts.items(), key=lambda kv: -kv[1]))

    def warnings_by_kind(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for warning in self.warnings:
            counts[warning.kind] = counts.get(warning.kind, 0) + 1
        return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def normalise_gold(
    pages: Iterable[dict[str, Any]],
    region_text: dict[tuple[str, int, str], str] | None = None,
) -> NormalisedGold:
    """Apply the guide's own rules to hand-drawn gold, recording every change.

    `region_text` maps `(paper_id, page, gold_id)` to the RAW PDF text under that box - supplied
    by the caller so this module stays free of PyMuPDF and so the caller decides what "the text
    under a box" means. Omit it and rule 1 is skipped: retyping a caption cannot be done from
    labels alone, and guessing from the box's shape would be a heuristic dressed as a fact.

    Rules run in order, because rule 2 depends on rule 1's output and rule 3 on rule 2's.
    """
    texts = region_text or {}
    out: list[dict[str, Any]] = []
    repairs: list[GoldRepair] = []
    warnings: list[GoldWarning] = []

    for page in pages:
        regions = [dict(region) for region in page["regions"]]
        paper_id = page["paper_id"]
        index = int(page["page"])

        for region in regions:
            key = (paper_id, index, region["gold_id"])
            text = texts.get(key, "")
            _rule_1_caption_typed_as_subject(paper_id, index, region, text, repairs, warnings)
            _rule_2_flow_from_type(paper_id, index, region, repairs)
            _check_whole_page_box(paper_id, index, region, page, warnings)

        _rule_3_renumber_reading_order(paper_id, index, regions, repairs)
        _check_caption_links(paper_id, index, regions, warnings)

        out.append({**page, "regions": regions})

    return NormalisedGold(pages=out, repairs=repairs, warnings=warnings)


def _rule_1_caption_typed_as_subject(
    paper_id: str,
    page: int,
    region: dict[str, Any],
    text: str,
    repairs: list[GoldRepair],
    warnings: list[GoldWarning],
) -> None:
    """A box whose text OPENS `Figure 2:` is a caption, whatever it was typed.

    Only fires on the float types. A `paragraph` whose text opens with a caption marker is far
    likelier to be a genuine caption the annotator typed loosely, but retyping paragraphs would
    also catch a paragraph that legitimately begins by naming a figure - so paragraphs are left
    alone and the ambiguity stays with the annotator rather than being resolved silently.
    """
    if not text:
        return
    kind = region.get("type")

    if kind in _FLOAT_TYPES and _CAPTION_OPENER.match(text):
        repairs.append(
            GoldRepair(
                paper_id,
                page,
                region["gold_id"],
                "type",
                kind,
                "caption",
                "caption-typed-as-subject",
            )
        )
        region["type"] = "caption"
        return

    # The box did not START with the marker but contains it: the float swallowed its caption.
    # Not repairable without choosing a split coordinate, which is annotation.
    if kind in _FLOAT_TYPES and _CAPTION_INSIDE.search(text):
        warnings.append(
            GoldWarning(
                paper_id,
                page,
                region["gold_id"],
                "caption-absorbed-into-float",
                f"{kind} box contains a caption marker but does not open with it: {text[:60]!r}",
            )
        )


def _rule_2_flow_from_type(
    paper_id: str, page: int, region: dict[str, Any], repairs: list[GoldRepair]
) -> None:
    """`ANNOTATION_GUIDE.md`'s flow table, applied. Unknown types are left untouched."""
    canonical = CANONICAL_FLOW.get(str(region.get("type")))
    if canonical is None or region.get("flow") == canonical:
        return
    repairs.append(
        GoldRepair(
            paper_id,
            page,
            region["gold_id"],
            "flow",
            region.get("flow"),
            canonical,
            "flow-contradicts-type",
        )
    )
    region["flow"] = canonical


def _rule_3_renumber_reading_order(
    paper_id: str, page: int, regions: Sequence[dict[str, Any]], repairs: list[GoldRepair]
) -> None:
    """Rank the body flow 0..n-1 in DRAW ORDER; null everything else.

    Draw order is reading order by instruction - `ANNOTATION_GUIDE.md` §3 rule 1 says *"draw body
    regions in reading order"* - and `gold_id` is allocated monotonically as boxes are drawn, so
    sorting by it recovers the sequence the annotator intended. This has to run after rule 2:
    a region that just became body-flow needs a rank, and one that just left needs its rank gone.
    """
    ordered = sorted(regions, key=lambda r: str(r["gold_id"]))
    rank = 0
    for region in ordered:
        wanted = rank if region.get("flow") == "body" else None
        if wanted is not None:
            rank += 1
        if region.get("reading_order") != wanted:
            repairs.append(
                GoldRepair(
                    paper_id,
                    page,
                    region["gold_id"],
                    "reading_order",
                    region.get("reading_order"),
                    wanted,
                    "reading-order-renumber",
                )
            )
            region["reading_order"] = wanted


def _check_whole_page_box(
    paper_id: str,
    page: int,
    region: dict[str, Any],
    page_data: dict[str, Any],
    warnings: list[GoldWarning],
) -> None:
    """A region covering most of the page is under-segmented, not a region."""
    size = page_data.get("page_size") or {}
    width, height = float(size.get("width", 0)), float(size.get("height", 0))
    if width <= 0 or height <= 0:
        return
    box = region.get("bbox") or []
    if len(box) != 4:
        return
    area = max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])
    share = area / (width * height)
    if share >= _WHOLE_PAGE_AREA_SHARE:
        warnings.append(
            GoldWarning(
                paper_id,
                page,
                region["gold_id"],
                "whole-page-box",
                f"{region.get('type')} covers {share:.0%} of the page - "
                "a parser emitting one block per entry cannot match it",
            )
        )


def _check_caption_links(
    paper_id: str, page: int, regions: Sequence[dict[str, Any]], warnings: list[GoldWarning]
) -> None:
    """Caption association needs caption -> float edges. Report their absence once per page."""
    captions = [r for r in regions if r.get("type") == "caption"]
    unlinked = [r for r in captions if not r.get("parent")]
    if unlinked:
        warnings.append(
            GoldWarning(
                paper_id,
                page,
                ",".join(str(r["gold_id"]) for r in unlinked),
                "caption-without-parent",
                f"{len(unlinked)} caption region(s) carry no `parent` - "
                "caption association is not evaluable on this page",
            )
        )
