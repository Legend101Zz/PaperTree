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
                       PaperTree's caption heuristic against a copy of itself. STILL NOT
                       EVALUABLE, and it is not a dropdown away: gold holds 51 floats against 1
                       drawn caption, so the caption boxes have to be drawn before there is
                       anything for a `parent` to point at.
  Vector-figure recall needs `is_vector` on gold figures. NOW EVALUABLE as of 2026-08-01 - the
                       annotator collects it and the second pass supplied it, so `vector_recall`
                       carries a number instead of a reason. **On every paper as of #86**: the
                       guard tested truthiness rather than presence, so an all-raster paper -
                       `is_vector: false` on every figure, which is a complete annotation -
                       reported NOT EVALUABLE. a3c and bert both did, over gold that fully
                       supports the metric.

AND THE HEADLINE IS A POOLED RECALL, NOT A MEAN OF PER-PAGE RATES

§4.1 says *"Recall over gold figures with `is_vector: true`"*. It used to be reported as the mean
of per-page recalls **including every page with no vector gold as a 0.0**, which is neither that
definition nor a number a parser can move: `attention-is-all-you-need` holds its vector gold on
one page of six, so its printed recall had a ceiling of 0.333 whatever the parser did. See
`metrics.vector_figure_recall` for the per-paper table. Both figures are printed now, pooled
first, because the gap between them says how concentrated a paper's vector gold is.

What is not evaluable comes back as `None`, and `render_report` prints "not evaluable" with the
reason rather than a number - a zero is a claim about the parser.

ONE CAVEAT ON THE VECTOR NUMBER. `normalise.py` rule 4 repairs `is_vector` on pages whose PDF
holds no raster XObjects, so the LABEL is no longer independent of PyMuPDF's image inventory,
which is also where the parser's own `is_vector` comes from. What stays independently measured is
the thing §4.1 asks for - RECALL, whether `figures.py` clustered a region there at all. The
inventory does not predict that: findings.md B3 measured both old extractors finding 0 of
ResNet's figures while `get_images()` returned nothing for them.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from papertree_evaluation.metrics import (
    IOU_MATCH,
    IOU_STRICT,
    caption_association,
    iou,
    match_regions,
    reading_order_accuracy,
    vector_figure_hits,
    vector_figure_recall,
)

__all__ = [
    "CONVENTION_SUBSTITUTES",
    "ConventionGap",
    "PaperScore",
    "TypeScore",
    "blocks_to_regions",
    "render_report",
    "sanity_check_overlap",
    "score_paper",
]

#: Gold TYPES whose annotation CONVENTION this parser deliberately does not follow, each naming
#: the block type it emits over the same region instead.
#:
#: RULED IN `research/benchmarks/ANNOTATION_GUIDE.md` §"citation vs reference_entry" (issue #55).
#: Gold boxes a whole reference page as ONE `citation` region; the parser emits one
#: `reference_entry` per entry. The schema decides it and not this table: `Span.role`'s
#: documented vocabulary (DESIGN.md D17, `models.py::Span.role`) lists `citation` beside
#: `footnote_marker` as an IN-TEXT construct, and semantic rule 23 makes `cites.to` point at a
#: `reference_entry`. So a `citation` is the marker that cites and a `reference_entry` is the
#: bibliography entry cited, and the four gold `citation` regions - each 421-505 pt wide and up
#: to 749 pt tall, i.e. an entire reference page - are the second thing wearing the first
#: thing's name.
#:
#: WHAT THIS DOES AND DOES NOT DO. It does NOT change `macro_f1`: §4.1 fixes that metric and a
#: score that moves because someone declared a type inconvenient is worth nothing. It records
#: the disagreement, SUBSTANTIATES it against the parser's own output, and prints it. A gap that
#: cannot be substantiated - no substitute block anywhere inside the gold region - is a plain
#: detection failure and is reported as one.
CONVENTION_SUBSTITUTES: dict[str, tuple[str, ...]] = {"citation": ("reference_entry",)}

#: Share of a predicted block that must fall inside a gold region to count as substituting for
#: it. Half, deliberately loose: the question is "did the parser put content there", not "did it
#: box it the way gold did" - the second question is what the gap is ABOUT.
SUBSTITUTE_CONTAINMENT = 0.5


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
class ConventionGap:
    """One declared granularity disagreement between gold and the parser, with its evidence.

    DECLARED IS NOT THE SAME AS TRUE, which is the whole point of `substantiated`. Saying "the
    parser deliberately does not follow this convention" is free; showing that it put
    `reference_entry` blocks inside every gold `citation` region is a measurement, and if it did
    not, the type is a plain miss and this object says so by leaving `substantiated` short of
    `gold_regions`.
    """

    kind: str
    substitutes: tuple[str, ...]
    gold_regions: int = 0
    #: Gold regions of `kind` holding at least one predicted block of a substitute type.
    substantiated: int = 0
    #: Predicted substitute blocks found inside those regions, pooled over the paper.
    substitute_blocks: int = 0

    @property
    def is_substantiated(self) -> bool:
        return self.gold_regions > 0 and self.substantiated == self.gold_regions


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
    #: Declared granularity disagreements, keyed by gold type. See `CONVENTION_SUBSTITUTES`.
    convention_gaps: dict[str, ConventionGap] = field(default_factory=dict)
    #: §4.1's caption association, pooled over the paper. Kept as raw counts rather than as a
    #: single score because the metric is DIRECTIONAL by requirement: "report FALSE LINKS
    #: separately from MISSED LINKS". One number would hide the difference between attaching
    #: Figure 2's caption to Figure 3 and attaching nothing, and the first is worse - it is
    #: confidently wrong, and everything downstream would believe it.
    caption_correct: int = 0
    caption_false: int = 0
    caption_missed: int = 0
    #: §4.1's ISOLATED vector-figure recall, per page, for pages whose gold HAS a vector figure.
    #:
    #: Isolated rather than folded into figure F1 because vector blindness is the specific defect
    #: this benchmark was built around: findings.md B3 measured BOTH old extractors finding 0 of
    #: ResNet's figures, all of which are vector ink, while the overall figure numbers looked
    #: merely poor rather than catastrophic. Averaged in, that distinction disappears.
    #:
    #: Kept per page for the spread. The HEADLINE is `vector_recall_pooled` below, because §4.1
    #: says "recall over gold FIGURES" and a mean of per-page rates is not that: it weights a
    #: page holding one vector figure the same as a page holding twelve.
    vector_recall: list[float] = field(default_factory=list)
    #: ...and the counts those rates came from, which are what pools.
    vector_matched: int = 0
    vector_gold: int = 0

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
    def macro_f1_excluding_convention_gaps(self) -> float:
        """`macro_f1` with the SUBSTANTIATED convention-gap rows dropped from the mean.

        NOT §4.1's metric and never reported instead of it. §4.1 fixes the headline and moving it
        after seeing results is what the decision rule was written in advance to prevent - so
        `macro_f1` above is untouched and this sits beside it, named for exactly what it removes,
        in the same way the report already prints raw beside normalised and pooled beside
        per-page. It answers one question: how much of the headline is the parser missing regions
        and how much is it disagreeing with the annotator about where one region ends.

        A gap that is DECLARED but not SUBSTANTIATED stays in the mean. A type the parser simply
        failed to find does not get to leave the average by being written down in a dict.
        """
        dropped = {k for k, gap in self.convention_gaps.items() if gap.is_substantiated}
        scored = [t for t in self.by_type.values() if t.gold and t.kind not in dropped]
        return sum(t.f1 for t in scored) / len(scored) if scored else 0.0

    @property
    def mean_reading_order(self) -> float:
        pages = [score for score in self.reading_order if score >= 0]
        return sum(pages) / len(pages) if pages else 0.0

    @property
    def vector_recall_pooled(self) -> float | None:
        """§4.1's metric as written: matched ÷ gold over the paper's VECTOR FIGURES.

        None when the paper's annotated pages hold no vector figure at all — absent, not zero,
        because a zero is a claim about the parser.
        """
        return self.vector_matched / self.vector_gold if self.vector_gold else None

    @property
    def mean_vector_recall(self) -> float | None:
        """The mean of the per-page rates, over EVALUABLE pages only. Reported beside the pooled
        figure rather than instead of it, because the two disagree and the gap is informative:
        a paper whose vector gold is concentrated on one page reads very differently either way.

        This used to average in every page with no vector gold as a 0.0, because
        `metrics.vector_figure_recall` returned `0.0` rather than `None` and the `is not None`
        guard in `score_paper` could never fire. See that function for the measured damage.
        """
        return sum(self.vector_recall) / len(self.vector_recall) if self.vector_recall else None

    @property
    def caption_links_gold(self) -> int:
        return self.caption_correct + self.caption_missed

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
        # Counts, then the rate — and the rate only for pages that HAVE vector gold. Both halves
        # of that sentence were broken: `vector_figure_recall` returned 0.0 rather than None for
        # a page with none, so the guard below never fired and every prose page was averaged in
        # as a miss; and the paper's headline was a mean of rates where §4.1 asks for a recall
        # over figures. See `metrics.vector_figure_recall` for the per-paper damage.
        matched, gold_vector = vector_figure_hits(predicted, gold, IOU_MATCH)
        score.vector_matched += matched
        score.vector_gold += gold_vector
        page_vector = vector_figure_recall(predicted, gold, IOU_MATCH)
        if page_vector is not None:
            score.vector_recall.append(page_vector)

        links, gold_links = _caption_links(document, predicted, gold)
        association = caption_association(links, gold_links)
        score.caption_correct += int(association["correct"])
        score.caption_false += int(association["false_links"])
        score.caption_missed += int(association["missed_links"])

        _pool_convention_gaps(score.convention_gaps, predicted, gold)

        score.gold_only_types |= {str(r["type"]) for r in gold}
        score.predicted_only_types |= {str(p["type"]) for p in predicted}

    overlap = score.gold_only_types & score.predicted_only_types
    score.gold_only_types -= overlap
    score.predicted_only_types -= overlap

    # PRESENCE, NOT TRUTH. Both guards tested `any(r.get(field))`, which is falsy for a value
    # that is present and legitimately `False` — and `is_vector: false` on every figure is a
    # COMPLETE annotation, not a missing one. Measured on the 2026-08-02 gold: all 55 figures
    # carry an explicit `is_vector`, and a3c (0 vector / 5 raster) and bert (0 / 2) both made
    # that `any()` false, so 2 of 6 papers reported NOT EVALUABLE over gold that fully supports
    # the metric — while printing the sentence "the annotator tool did not collect it", which
    # was simply untrue of them. An all-raster paper is the case the flag exists to record and
    # it was the one case the guard ate. Issue #86.
    #
    # The `parent` guard has the same shape and is currently harmless — a `parent` is a
    # `gold_id` string and is never legitimately falsy-but-present (39 of 39 gold captions
    # carry one) — but it is one empty-string annotation away from the same bug, and the two
    # should read alike.
    if not any(r.get("parent") is not None for p in pages for r in p["regions"]):
        score.not_evaluable["caption_association"] = (
            "gold carries no `parent` links; inferring them would score the parser's own "
            "caption heuristic against a copy of itself"
        )
    if not any(r.get("is_vector") is not None for p in pages for r in p["regions"]):
        score.not_evaluable["vector_figure_recall"] = (
            "gold carries no `is_vector` flag on figures; the annotator tool did not collect it "
            "on this pass"
        )
    return score


#: A gold region overlapping a same-type prediction by at least this much, but less than
#: `IOU_MATCH`, is in the right PLACE and the wrong SHAPE.
IOU_NEAR = 0.25


def _covered_share(inner: Sequence[float], outer: Sequence[float]) -> float:
    """Share of `inner`'s own area that lies inside `outer`. Zero for a degenerate `inner`."""
    lo_x, hi_x = max(inner[0], outer[0]), min(inner[2], outer[2])
    lo_y, hi_y = max(inner[1], outer[1]), min(inner[3], outer[3])
    if hi_x <= lo_x or hi_y <= lo_y:
        return 0.0
    area = (inner[2] - inner[0]) * (inner[3] - inner[1])
    return (hi_x - lo_x) * (hi_y - lo_y) / area if area > 0 else 0.0


def _pool_convention_gaps(
    into: dict[str, ConventionGap],
    predicted: list[dict[str, Any]],
    gold: list[dict[str, Any]],
) -> None:
    """Accumulate one page's evidence for each declared granularity disagreement.

    This does not touch a score. It answers the question the `citation` row's 0.00 cannot: is
    the parser silent over that part of the page, or did it put the same content there under a
    different name and a finer granularity.
    """
    for kind, substitutes in CONVENTION_SUBSTITUTES.items():
        regions = [r for r in gold if r["type"] == kind]
        if not regions:
            continue
        gap = into.setdefault(kind, ConventionGap(kind=kind, substitutes=substitutes))
        candidates = [p for p in predicted if p["type"] in substitutes and p.get("bbox")]
        for region in regions:
            gap.gold_regions += 1
            inside = [
                p
                for p in candidates
                if _covered_share(p["bbox"], region["bbox"]) >= SUBSTITUTE_CONTAINMENT
            ]
            if inside:
                gap.substantiated += 1
                gap.substitute_blocks += len(inside)


def _caption_links(
    document: dict[str, Any],
    predicted: list[dict[str, Any]],
    gold: list[dict[str, Any]],
) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Caption -> float edges on one page, BOTH SIDES EXPRESSED IN GOLD IDS.

    The join nobody can skip: gold links are `(caption gold_id, parent gold_id)` and the parser's
    are `(caption block_id, float block_id)`. Two different id spaces naming the same page, so
    comparing them directly would score **zero on a perfect parser**. Every predicted block is
    first matched to a gold region by IoU and type - the same matcher the F1 uses - and each link
    is translated into gold ids or dropped.

    DROPPED, not counted as wrong. A link whose caption the parser boxed too differently to match
    is a *detection* failure, and the `caption` row's F1 already counts it. Counting it again here
    would report one defect as two and make the linking heuristic look worse than it is.
    """
    pairs = match_regions(predicted, gold, IOU_MATCH)
    block_to_gold = {
        str(predicted[pi]["block_id"]): str(gold[gi]["gold_id"])
        for pi, gi in pairs
        if predicted[pi].get("block_id") and gold[gi].get("gold_id")
    }

    gold_links = [
        (str(region["gold_id"]), str(region["parent"]))
        for region in gold
        if region.get("type") == "caption" and region.get("parent")
    ]
    predicted_links = []
    for rel in document.get("relations") or []:
        if rel.get("type") != "caption_of":
            continue
        source, target = str(_relation_source(rel)), str(rel.get("to"))
        if source in block_to_gold and target in block_to_gold:
            predicted_links.append((block_to_gold[source], block_to_gold[target]))
    return predicted_links, gold_links


def _relation_source(relation: dict[str, Any]) -> object:
    """`Relation.from` under EITHER spelling, because the two dump modes disagree.

    `from` is a Python keyword, so the model field is `from_` and the schema alias is `from`.
    `model_dump(by_alias=True)` - what `DeterministicAdapter` uses - emits `from`, while a plain
    `model_dump_json()` emits `from_`. Reading only one of them means a caller who dumped the
    other way gets **zero caption links and no error**, which reads exactly like a parser that
    never links anything. Accepting both is two lines; the alternative is a silent zero.
    """
    return relation.get("from", relation.get("from_"))


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
        # A DECLARED CONVENTION GAP IS PRINTED WITH ITS EVIDENCE OR NOT AT ALL.
        #
        # The `citation` row scores 0.00 and reads as "the parser found nothing there". It found
        # 18 things there on `attention` and called every one of them a `reference_entry`, which
        # is what ANNOTATION_GUIDE.md asks an annotator for. Printing the 0.00 alone reports a
        # granularity disagreement as a detection failure and sends the next person to fix the
        # parser. §4.1's headline above is UNCHANGED; this is the decomposition, not a rescore.
        substantiated = [g for g in score.convention_gaps.values() if g.is_substantiated]
        for gap in sorted(score.convention_gaps.values(), key=lambda g: g.kind):
            state = "substantiated" if gap.is_substantiated else "NOT substantiated"
            lines.append(
                f"  {'convention gap':18s} {gap.kind + ': ' + state:>34s}"
                f"    ({gap.substantiated}/{gap.gold_regions} gold regions hold "
                f"{gap.substitute_blocks} {'/'.join(gap.substitutes)} block(s); "
                "granularity, not detection - ANNOTATION_GUIDE.md)"
            )
        if substantiated:
            excluded = ", ".join(sorted(g.kind for g in substantiated))
            lines.append(
                f"  {'MACRO F1 excl. gap':18s} {score.macro_f1_excluding_convention_gaps:>34.3f}"
                f"    (drops {excluded}; NOT §4.1's metric - the line above is)"
            )
        lines.append(f"  {'reading order':18s} {score.mean_reading_order:>34.3f}")
        # A METRIC IS EITHER A NUMBER OR A REASON, NEVER BOTH IN ONE REPORT.
        #
        # It used to be both. On `a3c` the detail block printed `vector fig recall 0.000` and
        # `vector_figure_recall: NOT EVALUABLE` for the same adapter on the same paper, three
        # lines apart — one saying the parser found nothing and the other saying nothing was
        # measurable. Two sections of one report disagreeing about whether a number exists is
        # worse than either answer, because a reader takes whichever one they saw first. #86.
        if score.caption_links_gold and "caption_association" not in score.not_evaluable:
            correct = f"{score.caption_correct}/{score.caption_links_gold}"
            lines.append(
                f"  {'caption links':18s} {correct:>34s}"
                f"    (false {score.caption_false}, missed {score.caption_missed}"
                " - §4.1 wants these apart)"
            )
        pooled = score.vector_recall_pooled
        if pooled is not None and "vector_figure_recall" not in score.not_evaluable:
            spread = score.mean_vector_recall
            lines.append(
                f"  {'vector fig recall':18s} {pooled:>34.3f}"
                f"    ({score.vector_matched}/{score.vector_gold} gold vector figures"
                f"; per-page mean {spread:.3f} over {len(score.vector_recall)} evaluable pages)"
            )
        elif "vector_figure_recall" not in score.not_evaluable:
            # Evaluable gold, no vector figure on the annotated pages. Absent, not zero.
            gold_figures = score.by_type["figure"].gold if "figure" in score.by_type else 0
            lines.append(
                f"  {'vector fig recall':18s} {'no vector gold on these pages':>34s}"
                f"    (annotated and complete - 0 of {gold_figures} gold figures are vector)"
            )
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
