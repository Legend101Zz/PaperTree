"""`eval/ptub.spec` — the metrics and the harness, on cases small enough to verify by hand.

Every expected value here is arithmetic done in the docstring, not a number recorded from a
run. A metric test whose expectation came from executing the metric proves only that the code
is deterministic.

The metrics cannot be exercised on real gold, because there is none - `benchmarks/README.md`
§7: "Gold annotations: **not started**". These miniature cases are what stops them being
written wrong in the meantime, and what makes them trustworthy on the day gold arrives.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from papertree_evaluation.adapters import AdapterOutcome, DoclingAdapter, PyMuPdfRawAdapter
from papertree_evaluation.annotate import GOLD_TYPES, stratified_pages
from papertree_evaluation.harness import (
    COLUMNS,
    HISTORICAL_ROWS,
    ComparisonMatrix,
    historical_rows_for,
    render_matrix,
)
from papertree_evaluation.metrics import (
    caption_association,
    element_detection,
    iou,
    reading_order_accuracy,
    vector_figure_recall,
)


def _region(kind: str, box: list[float], order: int | None = None, **extra: object):  # type: ignore[no-untyped-def]
    return {"type": kind, "bbox": box, "reading_order": order, **extra}


def test_iou_is_intersection_over_union() -> None:
    """Two unit squares offset by half: intersection 0.25, union 1.75, IoU = 1/7."""
    assert iou([0, 0, 1, 1], [0, 0, 1, 1]) == 1.0
    assert iou([0, 0, 1, 1], [2, 2, 3, 3]) == 0.0
    assert iou([0, 0, 1, 1], [0.5, 0.5, 1.5, 1.5]) == pytest.approx(0.25 / 1.75)


def test_element_detection_requires_the_type_to_match_too() -> None:
    """§4.1: a match needs `IoU >= 0.5` AND the same type. Identical geometry is not enough."""
    gold = [_region("paragraph", [0, 0, 10, 10])]
    assert element_detection([_region("paragraph", [0, 0, 10, 10])], gold).f1 == 1.0
    assert element_detection([_region("heading", [0, 0, 10, 10])], gold).f1 == 0.0


def test_element_detection_macro_averages_rather_than_micro() -> None:
    """The headline f1 is the MEAN OF PER-TYPE f1s, and the two differ sharply here.

    Gold: 4 table cells (all found) and 1 paragraph (missed).
      micro  = 4 matched / 4 predicted, 4/5 recall -> f1 0.888...
      macro  = (table_cell 1.0 + paragraph 0.0) / 2 = 0.5

    A micro-average over a real paper - 300 cells against 12 paragraphs - measures table-cell
    detection and calls it element detection.
    """
    gold = [_region("table_cell", [i, 0, i + 1, 1]) for i in range(4)]
    gold.append(_region("paragraph", [0, 10, 10, 20]))
    predicted = [_region("table_cell", [i, 0, i + 1, 1]) for i in range(4)]

    score = element_detection(predicted, gold)
    assert score.matched == 4
    assert score.per_type == {"table_cell": 1.0, "paragraph": 0.0}
    assert score.f1 == 0.5
    assert score.recall == pytest.approx(4 / 5)


def test_reading_order_is_pairwise_and_ignores_non_body_regions() -> None:
    """Three body regions in gold order 0,1,2; the parser returns 0,2,1.

    Pairs: (0,1) agree, (0,2) agree, (1,2) DISagree -> 2/3.

    The caption carries `reading_order: None` and must not participate at all - §2 gives
    furniture null precisely so a parser is not punished for correctly excluding it.
    """
    gold = [
        _region("paragraph", [0, 0, 10, 10], order=0),
        _region("paragraph", [0, 20, 10, 30], order=1),
        _region("paragraph", [0, 40, 10, 50], order=2),
        _region("caption", [0, 60, 10, 70], order=None),
    ]
    predicted = [
        _region("paragraph", [0, 0, 10, 10]),
        _region("paragraph", [0, 40, 10, 50]),
        _region("paragraph", [0, 20, 10, 30]),
    ]
    assert reading_order_accuracy(predicted, gold) == pytest.approx(2 / 3)


def test_reading_order_degrades_gracefully_when_regions_are_missed() -> None:
    """The property §4.1 chose pairwise FOR.

    A parser that finds 2 of 3 regions, in the right order, scores 1.0 on the single pair it can
    express rather than being undefined or punished for the miss. The miss is element-detection
    recall's job to report, and reporting it twice would double-count it.
    """
    gold = [
        _region("paragraph", [0, 0, 10, 10], order=0),
        _region("paragraph", [0, 20, 10, 30], order=1),
        _region("paragraph", [0, 40, 10, 50], order=2),
    ]
    predicted = [_region("paragraph", [0, 0, 10, 10]), _region("paragraph", [0, 40, 10, 50])]
    assert reading_order_accuracy(predicted, gold) == 1.0


def test_caption_association_separates_false_links_from_missed_ones() -> None:
    """Attaching Figure 2's caption to Figure 3 is a different failure from attaching nothing.

    Predicted: (c1,f1) correct, (c2,f3) wrong. Gold also has (c2,f2), unlinked.
      correct 1, false 1, missed 1, precision 1/2, recall 1/2
    """
    result = caption_association([("c1", "f1"), ("c2", "f3")], [("c1", "f1"), ("c2", "f2")])
    assert result["correct"] == 1
    assert result["false_links"] == 1
    assert result["missed_links"] == 1
    assert result["precision"] == 0.5
    assert result["recall"] == 0.5


def test_vector_figure_recall_isolates_the_known_catastrophic_gap() -> None:
    """Gold: 2 vector figures and 1 raster. A parser finding only the raster scores 0.0.

    Averaged into an overall figure recall it would score 1/3 and look merely weak. findings.md
    B3 measured ResNet at 0 figures from both extractors and EVERY figure in it is vector; that
    is the failure this metric exists to make unmissable.
    """
    gold = [
        _region("figure", [0, 0, 10, 10], is_vector=True),
        _region("figure", [0, 20, 10, 30], is_vector=True),
        _region("figure", [0, 40, 10, 50], is_vector=False),
    ]
    assert vector_figure_recall([_region("figure", [0, 40, 10, 50])], gold) == 0.0
    assert vector_figure_recall([_region("figure", [0, 0, 10, 10])], gold) == 0.5


# ── the harness ────────────────────────────────────────────────────────────────────────────


def test_an_unavailable_adapter_is_not_a_zero() -> None:
    """The distinction the whole benchmark's honesty rests on.

    §3 says a parser that cannot express a metric scores 0 rather than N/A. An adapter that was
    never INSTALLED has not failed at anything, and scoring it 0 would report "deterministic
    beats Docling" on the strength of a missing dependency.
    """
    adapter = DoclingAdapter(python="/nonexistent/python")
    assert not adapter.available
    outcome = adapter.parse("whatever.pdf")
    assert outcome.status == "unavailable"
    assert outcome.counts == {}
    assert not outcome.is_empty, "unavailable is not empty output"


def test_speed_ratio_is_none_when_no_paper_was_parsed_by_both() -> None:
    """A missing comparator must not silently become "infinitely faster"."""
    matrix = ComparisonMatrix(
        outcomes=[
            AdapterOutcome("fast", "p1", "ok", seconds=1.0, pages=10),
            AdapterOutcome("slow", "p1", "unavailable"),
        ]
    )
    assert matrix.speed_ratio("fast", "slow") is None


def test_speed_ratio_is_the_median_over_shared_papers() -> None:
    """fast: 0.1 s/page, slow: 1.0 s/page -> 10x on both papers, median 10."""
    matrix = ComparisonMatrix(
        outcomes=[
            AdapterOutcome("fast", "p1", "ok", seconds=1.0, pages=10),
            AdapterOutcome("slow", "p1", "ok", seconds=10.0, pages=10),
            AdapterOutcome("fast", "p2", "ok", seconds=2.0, pages=20),
            AdapterOutcome("slow", "p2", "ok", seconds=20.0, pages=20),
        ]
    )
    assert matrix.speed_ratio("fast", "slow") == pytest.approx(10.0)


def test_operational_metrics_implement_the_disqualification_rule() -> None:
    """§4.5: disqualified if crash+timeout+empty > 5 %, REGARDLESS of accuracy.

    Four papers: 2 ok, 1 crashed, 1 empty -> failure_rate 0.5.
    """
    matrix = ComparisonMatrix(
        outcomes=[
            AdapterOutcome("a", "p1", "ok", seconds=1, pages=1, document={"blocks": [1]}),
            AdapterOutcome("a", "p2", "ok", seconds=1, pages=1, document={"blocks": [1]}),
            AdapterOutcome("a", "p3", "crashed"),
            AdapterOutcome("a", "p4", "ok", seconds=1, pages=1, document={"blocks": []}),
        ]
    )
    stats = matrix.operational("a")
    assert stats["crashed"] == 1
    assert stats["empty"] == 1
    assert stats["failure_rate"] == 0.5


def test_the_matrix_renders_findings_h2s_columns() -> None:
    matrix = ComparisonMatrix(
        outcomes=[
            AdapterOutcome(
                "papertree-deterministic",
                "resnet",
                "ok",
                seconds=1.6,
                pages=12,
                document={"blocks": [1]},
                counts={c: 1 for c in COLUMNS},
            )
        ]
    )
    rendered = render_matrix(matrix, "resnet")
    for column in COLUMNS:
        assert column in rendered
    assert "papertree-deterministic" in rendered
    assert "0.13" in rendered, "s/page must be reported beside capability"


# ── the annotation tool ────────────────────────────────────────────────────────────────────


def test_gold_types_match_the_paperir_vocabulary() -> None:
    """§2: "deliberately identical to PaperIR block types so gold data is directly comparable"."""
    from papertree_document_ir import KNOWN_BLOCK_TYPES

    unknown = set(GOLD_TYPES) - set(KNOWN_BLOCK_TYPES)
    assert not unknown, f"gold vocabulary has types PaperIR does not know: {sorted(unknown)}"


def test_page_sampling_is_spread_rather_than_the_first_n() -> None:
    """§1.2: "First-10-pages sampling systematically over-weights introductions"."""
    picks = stratified_pages(75)
    assert len(picks) == 10
    assert picks[0] == 0 and picks[-1] == 74, "first and last pages are always sampled"
    assert picks != list(range(10)), "must not be the first ten pages"
    assert max(picks) > 60, "the sample must reach the end of the paper"


def test_a_short_paper_returns_every_page() -> None:
    assert stratified_pages(5) == [0, 1, 2, 3, 4]


def test_the_pymupdf_floor_expresses_no_structure() -> None:
    """Row 3 exists to be the floor, and scoring it 0 on structure is §3 working, not a bug."""
    adapter = PyMuPdfRawAdapter()
    if not adapter.available:  # pragma: no cover
        pytest.skip("pymupdf not installed")
    corpus = Path(__file__).resolve().parents[5] / "research" / "benchmarks" / "corpus"
    pdf = corpus / "resnet-cvpr-2col.pdf"
    if not pdf.is_file():
        # AGENTS.md §4: a corpus-dependent test skips LOUDLY and names the fetch script, because
        # a suite that quietly collects zero cases looks exactly like a suite that passed.
        pytest.skip(
            f"the corpus is gitignored and {pdf} is absent. "
            "Fetch it with `./research/benchmarks/fetch_corpus.sh` to run this."
        )

    outcome = adapter.parse(str(pdf))
    assert outcome.status == "ok"
    assert outcome.counts["blocks"] > 0
    assert outcome.counts["with_bbox"] == outcome.counts["blocks"]
    for column in ("headings", "figures", "tables", "table_cells", "sections", "with_stable_id"):
        assert outcome.counts[column] == 0, f"the raw floor cannot express {column}"


# ── the fourth row (issue #55) ─────────────────────────────────────────────────────────────
#
# `EPIC-01-ingest.md` asks `eval/ptub.spec` for four adapters and the same file's "Must delete"
# section orders one of the four deleted. Both were followed, so the criterion could not be met
# by any parser change. Ruled 2026-08-03: three live adapters plus a declared HISTORICAL column
# carried as data with its provenance. These tests are what stop that column becoming a
# laundered live measurement.


def test_the_matrix_carries_findings_h2s_fourth_row_where_h2_measured_one() -> None:
    """Four rows on ResNet: two live-in-this-fixture plus H2's two deleted extractors."""
    matrix = ComparisonMatrix(
        outcomes=[
            AdapterOutcome(
                "papertree-deterministic",
                "resnet-cvpr-2col",
                "ok",
                seconds=1.6,
                pages=12,
                document={"blocks": [1]},
                counts={c: 1 for c in COLUMNS},
            )
        ]
    )
    rendered = render_matrix(matrix, "resnet-cvpr-2col")
    assert "papertree-v1-extractor (DELETED)" in rendered
    assert "papertree-v1-live (DELETED)" in rendered
    assert "findings.md H2" in rendered, "a historical row without provenance is a rumour"
    assert "078d208" in rendered, "the commit that deleted the code is the provenance"
    assert "| 233 |" in rendered, "H2's block count for the dead extractor on ResNet"
    assert "0.34" in rendered, (
        "H2's `sec` column is a TOTAL: 4.1 s over 12 pp is 0.34 s/page, not 4.1"
    )


def test_a_column_h2_never_recorded_is_a_question_mark_rather_than_a_zero() -> None:
    """H2 has a `nested tree` tick, not a section COUNT. §3's "cannot express it scores 0, not
    N/A" is about a parser that ran; nothing ran here, so a 0 would be an invented measurement."""
    rendered = render_matrix(ComparisonMatrix(), "resnet-cvpr-2col")
    assert "| ? |" in rendered


def test_a_historical_row_can_never_reach_a_computed_ratio() -> None:
    """THE SEPARATION THAT MAKES THE AMENDMENT HONEST.

    `speed_ratio` and `operational` compute over `ComparisonMatrix.outcomes`. A 2026-06
    measurement of deleted code landing in either would be presented as this run's. `render_matrix`
    is the only consumer of `HISTORICAL_ROWS`, so the guard is that `outcomes` never gains one.
    """
    matrix = ComparisonMatrix(
        outcomes=[
            AdapterOutcome(
                "papertree-deterministic",
                "resnet-cvpr-2col",
                "ok",
                seconds=1.6,
                pages=12,
                document={"blocks": [1]},
                counts={c: 1 for c in COLUMNS},
            )
        ]
    )
    render_matrix(matrix, "resnet-cvpr-2col")
    assert {o.adapter for o in matrix.outcomes} == {"papertree-deterministic"}
    assert matrix.operational("papertree-v1-extractor (DELETED)")["papers"] == 0
    assert matrix.speed_ratio("papertree-deterministic", "papertree-v1-extractor (DELETED)") is None
    assert not isinstance(HISTORICAL_ROWS[0], AdapterOutcome)


def test_the_six_papers_h2_never_covered_get_three_rows_not_four() -> None:
    """H2 measured ResNet and Attention. Inventing rows for the other six would be the whole
    defect this is fixing, upside down."""
    assert historical_rows_for("gpt3-longform-singlecol") == ()
    assert len(historical_rows_for("resnet-cvpr-2col")) == 2
    assert len(historical_rows_for("attention-is-all-you-need")) == 2
    assert "DELETED" not in render_matrix(ComparisonMatrix(), "gpt3-longform-singlecol")


def test_the_historical_numbers_are_h2s_and_carry_its_central_finding() -> None:
    """Transcription guard. The row exists to preserve one measurement above all: BOTH deleted
    extractors found **0 figures** on ResNet, every one of which is vector ink (findings.md B3).
    A row that quietly acquired a non-zero there would erase the reason the benchmark exists."""
    resnet = {r.adapter: r for r in historical_rows_for("resnet-cvpr-2col")}
    dead = resnet["papertree-v1-extractor (DELETED)"]
    assert dead.counts["blocks"] == 233
    assert dead.counts["headings"] == 58
    assert dead.counts["equations"] == 86
    assert dead.counts["with_stable_id"] == 0
    assert dead.counts["figures"] == 0
    assert dead.counts["sections"] is None
    live = resnet["papertree-v1-live (DELETED)"]
    assert all(live.counts[c] == 0 for c in COLUMNS if c != "sections")
