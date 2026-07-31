"""PTUB §4.1's gold-based metrics. Implemented now so they run the day gold exists.

None of these can be computed today: `benchmarks/README.md` §7 records Tier B gold as *"not
started — the critical path item; ~60 expert-hours"*. They are written anyway, and tested
against hand-built miniature cases, for two reasons: the annotation tool is useless without
something to consume its output, and a metric written AFTER seeing a parser's results is a
metric shaped by them.

DEFINITIONS ARE THE README'S, NOT CONVENIENT ONES

  Element detection  a predicted region matches gold if **IoU ≥ 0.5 AND the type matches**.
                     Reported per type and macro-averaged; IoU ≥ 0.75 as a strictness check.
  Reading order      **pairwise**: the fraction of gold body-flow region PAIRS whose predicted
                     relative order matches. Chosen over Kendall's τ because it "degrades
                     gracefully when a parser misses regions" - a parser that finds 8 of 10
                     regions still scores on the 28 pairs it can express.
  Caption assoc.     directional: **false links are reported separately from missed links**,
                     because attaching Figure 2's caption to Figure 3 and attaching nothing are
                     different failures.
  Vector-figure      recall over gold figures with `is_vector: true`, ISOLATED because it is
                     PaperTree's known catastrophic gap (ResNet: 0 found by both old extractors).

MACRO-AVERAGE, NOT MICRO. A micro-average over a paper whose gold is 300 table cells and 12
paragraphs measures table-cell detection and calls it "element detection". §4.1 says "report per
type; macro-average", and the two differ by more than a rounding on this corpus.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import combinations
from typing import Any

__all__ = [
    "DetectionScore",
    "caption_association",
    "element_detection",
    "iou",
    "reading_order_accuracy",
    "vector_figure_recall",
]

BBox = Sequence[float]

#: §4.1's primary matching threshold, and the strictness check reported beside it.
IOU_MATCH = 0.5
IOU_STRICT = 0.75


def iou(a: BBox, b: BBox) -> float:
    """Intersection over union of two `[x0, y0, x1, y1]` boxes."""
    lo_x, hi_x = max(a[0], b[0]), min(a[2], b[2])
    lo_y, hi_y = max(a[1], b[1]), min(a[3], b[3])
    if hi_x <= lo_x or hi_y <= lo_y:
        return 0.0
    intersection = (hi_x - lo_x) * (hi_y - lo_y)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - intersection
    return intersection / union if union > 0 else 0.0


@dataclass(slots=True)
class DetectionScore:
    precision: float
    recall: float
    f1: float
    matched: int
    predicted: int
    gold: int
    per_type: dict[str, float] = field(default_factory=dict)


def _match(
    predicted: list[dict[str, Any]], gold: list[dict[str, Any]], threshold: float
) -> list[tuple[int, int]]:
    """Greedy one-to-one matching by descending IoU, type-constrained.

    Greedy rather than optimal (Hungarian): §4.1 does not specify, greedy is what every layout
    benchmark in the literature uses, and the difference is negligible when IoU ≥ 0.5 already
    makes double-matching nearly impossible - two predictions cannot both overlap one gold box
    by half.
    """
    candidates = [
        (iou(p["bbox"], g["bbox"]), pi, gi)
        for pi, p in enumerate(predicted)
        for gi, g in enumerate(gold)
        if p.get("type") == g.get("type")
    ]
    candidates.sort(reverse=True)
    used_p: set[int] = set()
    used_g: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for score, pi, gi in candidates:
        if score < threshold or pi in used_p or gi in used_g:
            continue
        used_p.add(pi)
        used_g.add(gi)
        pairs.append((pi, gi))
    return pairs


def element_detection(
    predicted: list[dict[str, Any]], gold: list[dict[str, Any]], threshold: float = IOU_MATCH
) -> DetectionScore:
    """§4.1: match on `IoU >= threshold AND type`. Macro-averaged F1 per type."""
    pairs = _match(predicted, gold, threshold)
    matched = len(pairs)
    precision = matched / len(predicted) if predicted else 0.0
    recall = matched / len(gold) if gold else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    per_type: dict[str, float] = {}
    for kind in {g.get("type", "?") for g in gold}:
        gold_of = [g for g in gold if g.get("type") == kind]
        predicted_of = [p for p in predicted if p.get("type") == kind]
        hits = len(_match(predicted_of, gold_of, threshold))
        p = hits / len(predicted_of) if predicted_of else 0.0
        r = hits / len(gold_of) if gold_of else 0.0
        per_type[kind] = 2 * p * r / (p + r) if p + r else 0.0

    return DetectionScore(
        precision=precision,
        recall=recall,
        # The HEADLINE number is the macro-average, not the micro f1 above. A micro-average over
        # gold that is 300 table cells and 12 paragraphs measures table-cell detection.
        f1=sum(per_type.values()) / len(per_type) if per_type else 0.0,
        matched=matched,
        predicted=len(predicted),
        gold=len(gold),
        per_type=per_type,
    )


def reading_order_accuracy(
    predicted: list[dict[str, Any]], gold: list[dict[str, Any]], threshold: float = IOU_MATCH
) -> float:
    """§4.1: PAIRWISE accuracy over gold BODY-FLOW regions.

    Pairwise because it "degrades gracefully when a parser misses regions": a parser that finds
    8 of 10 still scores on the 28 pairs it can express, where a rank correlation would be
    undefined or wildly punished.

    Only regions with a non-null `reading_order` participate - §2 gives captions, footnotes and
    furniture `null` precisely so a parser is not punished for correctly excluding them.
    """
    body = [g for g in gold if g.get("reading_order") is not None]
    if len(body) < 2:
        return 0.0

    pairs = dict(_match(predicted, body, threshold))
    gold_to_predicted = {gi: pi for pi, gi in pairs.items()}

    agree = total = 0
    for left, right in combinations(range(len(body)), 2):
        if left not in gold_to_predicted or right not in gold_to_predicted:
            continue
        total += 1
        gold_before = body[left]["reading_order"] < body[right]["reading_order"]
        predicted_before = gold_to_predicted[left] < gold_to_predicted[right]
        agree += gold_before == predicted_before
    return agree / total if total else 0.0


def caption_association(
    predicted_links: list[tuple[str, str]], gold_links: list[tuple[str, str]]
) -> dict[str, float]:
    """§4.1: "Directional: report FALSE LINKS separately from MISSED LINKS."

    One number would hide the difference between attaching Figure 2's caption to Figure 3 and
    attaching nothing at all. The first is worse - it is confidently wrong.
    """
    predicted_set = set(predicted_links)
    gold_set = set(gold_links)
    correct = predicted_set & gold_set
    return {
        "correct": len(correct),
        "false_links": len(predicted_set - gold_set),
        "missed_links": len(gold_set - predicted_set),
        "precision": len(correct) / len(predicted_set) if predicted_set else 0.0,
        "recall": len(correct) / len(gold_set) if gold_set else 0.0,
    }


def vector_figure_recall(
    predicted: list[dict[str, Any]], gold: list[dict[str, Any]], threshold: float = IOU_MATCH
) -> float:
    """§4.1's isolated metric: recall over gold figures with `is_vector: true`.

    Isolated "because vector-figure blindness is the single defect that most damages PaperTree"
    - findings.md B3 measured ResNet at 0 figures from both extractors, every one of them
    vector. Averaged into an overall figure recall, that catastrophe is invisible.
    """
    vector_gold = [g for g in gold if g.get("type") == "figure" and g.get("is_vector")]
    if not vector_gold:
        return 0.0
    figures = [p for p in predicted if p.get("type") == "figure"]
    return len(_match(figures, vector_gold, threshold)) / len(vector_gold)
