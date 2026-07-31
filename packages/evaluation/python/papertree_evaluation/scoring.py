"""Score a PaperIR document against PTUB gold. The half of the decision rule that was missing.

`EPIC-01-RESULT.md` has carried *"not evaluable — no gold"* against element detection F1, reading
order and figure recall since the epic began. Gold now exists (18 pages, 249 regions), so this is
the module that turns it into numbers.

THREE JOINS, AND THE ONE THAT IS EASY TO GET SILENTLY WRONG

  Coordinates  Both sides are `[x0, y0, x1, y1]` in PDF user space with the origin TOP-LEFT -
               the gold tool records it that way (`annotate.py`, "independent of your window
               size and of any parser") and PaperIR's `BBox` says the same. No conversion. If
               that ever stops being true the IoUs collapse to zero and every score reads 0.00,
               so `sanity_check_overlap` exists to say WHICH failure it is.
  Types        `GOLD_TYPES` was built "deliberately identical to PaperIR block types", so the
               join is identity. Types present on one side only are REPORTED rather than
               quietly scoring zero - `unmatched_types` is how a vocabulary drift shows up as a
               vocabulary drift instead of as a bad parser.
  Order        THE TRAP. `metrics.reading_order_accuracy` compares *positions in the predicted
               list* - `gold_to_predicted[left] < gold_to_predicted[right]`. It does not read a
               rank field. So the predicted list MUST arrive sorted into reading order or the
               metric silently measures the order blocks happen to sit in the array. Everything
               here goes through `blocks_to_regions`, which sorts by `doc_order`, and there is a
               test that shuffling the input does not change the score.

WHAT THIS DOES NOT MEASURE, AND WHY IT SAYS SO

Two of §4.1's four metrics are still not evaluable, and reporting them as 0.00 would be worse
than reporting nothing - a zero is a claim about the parser.

  Caption association  needs caption -> float edges. Gold's `parent` is null everywhere; the
                       tool never collected them. Inferring the nearest float would score
                       PaperTree's caption heuristic against a copy of itself.
  Vector-figure recall needs `is_vector` on gold figures. The tool never collected that either.
                       `annotate.py` now offers the checkbox, so the NEXT annotation pass fixes
                       it; this one cannot be rescued after the fact.

Both come back as `None`, and `render_report` prints "not evaluable" with the reason rather than
a number.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from papertree_evaluation.metrics import (
    IOU_MATCH,
    IOU_STRICT,
    iou,
    match_regions,
    reading_order_accuracy,
)

__all__ = [
    "PaperScore",
    "TypeScore",
    "blocks_to_regions",
    "render_report",
    "sanity_check_overlap",
    "score_paper",
]


@dataclass(slots=True)
class TypeScore:
    """Pooled counts for one block type across every page of one paper."""

    kind: str
    matched: int = 0
    predicted: int = 0
    gold: int = 0

    @property
    def precision(self) -> float:
        return self.matched / self.predicted if self.predicted else 0.0

    @property
    def recall(self) -> float:
        return self.matched / self.gold if self.gold else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r else 0.0


@dataclass(slots=True)
class PaperScore:
    """Everything measurable about one adapter on one paper, plus what was not measurable."""

    adapter: str
    paper: str
    pages: int = 0
    by_type: dict[str, TypeScore] = field(default_factory=dict)
    by_type_strict: dict[str, TypeScore] = field(default_factory=dict)
    #: Pairwise reading-order accuracy per page, in page order.
    reading_order: list[float] = field(default_factory=list)
    #: Gold regions with a SAME-TYPE prediction that overlaps well but misses the bar. Counted
    #: per type, because "not detected" and "detected, boxed to a different convention" are
    #: different failures and the headline F1 cannot tell them apart.
    near_misses: dict[str, int] = field(default_factory=dict)
    #: Types gold uses that the parser never emits, and vice versa.
    gold_only_types: set[str] = field(default_factory=set)
    predicted_only_types: set[str] = field(default_factory=set)
    #: §4.1 metrics this gold set cannot express, with the reason.
    not_evaluable: dict[str, str] = field(default_factory=dict)

    @property
    def macro_f1(self) -> float:
        """§4.1's headline: the MEAN of the per-type F1s, over types that appear in GOLD.

        Types the parser invents and gold never uses are excluded from the mean but counted in
        `predicted_only_types`. Including them would let a parser lower its own macro-average by
        emitting a type nobody asked for, which is a scoring artefact rather than a finding.
        """
        scored = [t for t in self.by_type.values() if t.gold]
        return sum(t.f1 for t in scored) / len(scored) if scored else 0.0

    @property
    def macro_f1_strict(self) -> float:
        scored = [t for t in self.by_type_strict.values() if t.gold]
        return sum(t.f1 for t in scored) / len(scored) if scored else 0.0

    @property
    def mean_reading_order(self) -> float:
        pages = [score for score in self.reading_order if score >= 0]
        return sum(pages) / len(pages) if pages else 0.0

    @property
    def total_matched(self) -> int:
        return sum(t.matched for t in self.by_type.values())

    @property
    def total_gold(self) -> int:
        return sum(t.gold for t in self.by_type.values())

    @property
    def total_predicted(self) -> int:
        return sum(t.predicted for t in self.by_type.values())


def blocks_to_regions(document: dict[str, Any], page_index: int) -> list[dict[str, Any]]:
    """PaperIR blocks on one page, as gold-shaped regions, SORTED INTO READING ORDER.

    The sort is not cosmetic. `metrics.reading_order_accuracy` reads positions in this list, not
    a rank field, so returning blocks in storage order would make the reading-order metric report
    whatever `assemble.py` happened to append in - a number that looks plausible and means
    nothing.

    `doc_order` is the right key rather than `order`: rule 15 makes `doc_order` the body reading
    sequence, which is exactly what gold's `reading_order` ranks. Blocks without one (furniture,
    by rule 15) sort last on their bbox, and are excluded from the ranking anyway because gold
    gives their counterparts a null `reading_order`.
    """
    blocks = [b for b in (document.get("blocks") or []) if b.get("page_index") == page_index]

    def key(block: dict[str, Any]) -> tuple[int, float, float, float]:
        order = block.get("doc_order")
        box = block.get("bbox") or [0.0, 0.0, 0.0, 0.0]
        # Sort key, not a score: `doc_order` when present, else top-to-bottom then left-to-right.
        return (0, float(order), 0.0, 0.0) if order is not None else (1, box[1], box[0], box[3])

    return [
        {
            "block_id": block.get("block_id"),
            "type": block.get("type"),
            "flow": block.get("flow"),
            "bbox": block.get("bbox"),
            "doc_order": block.get("doc_order"),
        }
        for block in sorted(blocks, key=key)
        if block.get("bbox")
    ]


def sanity_check_overlap(
    document: dict[str, Any], gold_pages: Sequence[dict[str, Any]]
) -> tuple[int, int]:
    """How many gold boxes overlap ANY predicted box at all, ignoring type.

    A coordinate-system mismatch and a parser that finds nothing both produce 0.00 across the
    board. This separates them: near-total overlap with near-zero F1 means the geometry is
    aligned and the TYPES disagree; near-zero overlap means the frames do not match and no
    score on the page means anything.
    """
    touched = total = 0
    for page in gold_pages:
        predicted = blocks_to_regions(document, int(page["page"]))
        for region in page["regions"]:
            total += 1
            box = region["bbox"]
            touched += any(
                not (p["bbox"][2] <= box[0] or p["bbox"][0] >= box[2])
                and not (p["bbox"][3] <= box[1] or p["bbox"][1] >= box[3])
                for p in predicted
            )
    return touched, total


def score_paper(
    adapter: str,
    paper: str,
    document: dict[str, Any],
    gold_pages: Iterable[dict[str, Any]],
) -> PaperScore:
    """Pool per-type counts across a paper's pages; score reading order per page."""
    pages = [p for p in gold_pages if p["paper_id"] == paper]
    score = PaperScore(adapter=adapter, paper=paper, pages=len(pages))

    for page in pages:
        index = int(page["page"])
        predicted = blocks_to_regions(document, index)
        gold = [r for r in page["regions"] if r.get("bbox")]

        _pool(score.by_type, predicted, gold, IOU_MATCH)
        _count_near_misses(score.near_misses, predicted, gold)
        _pool(score.by_type_strict, predicted, gold, IOU_STRICT)
        score.reading_order.append(reading_order_accuracy(predicted, gold))

        score.gold_only_types |= {str(r["type"]) for r in gold}
        score.predicted_only_types |= {str(p["type"]) for p in predicted}

    overlap = score.gold_only_types & score.predicted_only_types
    score.gold_only_types -= overlap
    score.predicted_only_types -= overlap

    if not any(r.get("parent") for p in pages for r in p["regions"]):
        score.not_evaluable["caption_association"] = (
            "gold carries no `parent` links; inferring them would score the parser's own "
            "caption heuristic against a copy of itself"
        )
    if not any(r.get("is_vector") for p in pages for r in p["regions"]):
        score.not_evaluable["vector_figure_recall"] = (
            "gold carries no `is_vector` flag on figures; the annotator tool did not collect it "
            "on this pass"
        )
    return score


#: A gold region overlapping a same-type prediction by at least this much, but less than
#: `IOU_MATCH`, is in the right PLACE and the wrong SHAPE.
IOU_NEAR = 0.25


def _count_near_misses(
    into: dict[str, int], predicted: list[dict[str, Any]], gold: list[dict[str, Any]]
) -> None:
    """Gold regions found but boxed differently, per type.

    Reported because the first scored run made the distinction matter. `attention`'s title was
    detected correctly and scored 0.00: gold drew it 31 pt tall, the parser boxes it 16 pt tall
    from the font's own typographic band, and the IoU came to **0.474** against a 0.5 bar. That
    is not a detection failure and reporting it as one would send the next person to fix the
    wrong thing.

    This does NOT change the headline. §4.1 fixes the threshold at IoU >= 0.5 and it stays there;
    moving a bar after seeing the results is how a benchmark stops meaning anything. This is a
    separate column that says which side of the miss to investigate.
    """
    for region in gold:
        kind = str(region["type"])
        same_type = [p for p in predicted if p["type"] == kind]
        best = max((iou(p["bbox"], region["bbox"]) for p in same_type), default=0.0)
        if IOU_NEAR <= best < IOU_MATCH:
            into[kind] = into.get(kind, 0) + 1


def _pool(
    into: dict[str, TypeScore],
    predicted: list[dict[str, Any]],
    gold: list[dict[str, Any]],
    threshold: float,
) -> None:
    """Accumulate one page's matches into the paper's per-type totals.

    Matching runs PER PAGE - a figure on page 3 must not satisfy a gold figure on page 7 - while
    the counts pool across pages, because a per-type F1 computed on a single page is dominated by
    types that appear once there.
    """
    kinds = {str(r["type"]) for r in gold} | {str(p["type"]) for p in predicted}
    for kind in kinds:
        gold_of = [g for g in gold if g["type"] == kind]
        predicted_of = [p for p in predicted if p["type"] == kind]
        bucket = into.setdefault(kind, TypeScore(kind))
        bucket.matched += len(match_regions(predicted_of, gold_of, threshold))
        bucket.predicted += len(predicted_of)
        bucket.gold += len(gold_of)


def render_report(scores: Sequence[PaperScore]) -> str:
    """A fixed-width table per paper, then the aggregate the decision rule reads."""
    lines: list[str] = []
    for score in scores:
        lines.append(f"\n{score.adapter}  ·  {score.paper}  ({score.pages} pages)")
        lines.append(
            f"  {'type':18s} {'gold':>5s} {'pred':>5s} {'hit':>5s} {'P':>6s} {'R':>6s} {'F1':>6s}"
            f" {'near':>5s}"
        )
        for kind, bucket in sorted(score.by_type.items(), key=lambda kv: -kv[1].gold):
            if not bucket.gold and not bucket.predicted:
                continue
            lines.append(
                f"  {kind:18s} {bucket.gold:5d} {bucket.predicted:5d} {bucket.matched:5d} "
                f"{bucket.precision:6.2f} {bucket.recall:6.2f} {bucket.f1:6.2f} "
                f"{score.near_misses.get(kind, 0):5d}"
            )
        lines.append(
            f"  {'MACRO F1 @0.5':18s} {score.macro_f1:>34.3f}"
            f"    (strict @0.75: {score.macro_f1_strict:.3f})"
        )
        lines.append(f"  {'reading order':18s} {score.mean_reading_order:>34.3f}")
        near = sum(score.near_misses.values())
        if near:
            lines.append(
                f"  {'near misses':18s} {near:>34d}"
                f"    (right place, IoU {IOU_NEAR}-{IOU_MATCH} - a boxing convention gap)"
            )
        if score.gold_only_types:
            lines.append(f"  gold-only types      : {', '.join(sorted(score.gold_only_types))}")
        if score.predicted_only_types:
            lines.append(
                f"  parser-only types    : {', '.join(sorted(score.predicted_only_types))}"
            )
        for metric, reason in sorted(score.not_evaluable.items()):
            lines.append(f"  {metric}: NOT EVALUABLE - {reason}")
    return "\n".join(lines)
