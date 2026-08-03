"""The real parser, over the real corpus, against the real gold — as an ASSERTION.

WHY THIS FILE EXISTS, WHICH IS THE MOST IMPORTANT THING IN IT

Before it, **nothing in this repository scored the corpus against the gold set.** Every
gold-based test — `test_ptub.py`, `test_scoring.py`, `test_normalise.py` — runs against
hand-written three-region dicts and proves the metric functions compute what they claim.
The corpus × gold numbers existed only as the stdout of

    uv run --project packages/evaluation/python python -m papertree_evaluation score

which a human then transcribed into `research/build/EPIC-01-RESULT.md`.

So `worker/figures.spec`'s ">=80% captioned", `worker/reading-order.spec`'s ">=0.90" and
`worker/equations.spec`'s ">=80% of gold" were **not executable anywhere**. A session could
improve a number, or fail to, or quietly regress one, and no command in the repository would
disagree — `pytest`, `turbo --force` and CI included. That is `findings.md` §A's defect class
(code with no callers) and #66's shape (a field nothing populates) arriving one layer up: the
metric is written, the metric is tested, and nothing runs it on the thing it was built for.

WHAT THIS IS, AND WHAT IT IS DELIBERATELY NOT

It is a **regression guard at measured values**, in the sense `test_migrations.py` uses the
phrase. It is **not** a second acceptance criterion. The bars live in
`research/build/EPIC-01-ingest.md` and this file does not assert against them, does not
mention them, and must never be edited to make one appear met. `AGENTS.md` §2: *"do not round
a PARTIAL up to a MET"*, and the corollary is that a test file is not the place to do it.

EQUALITY, NOT A FLOOR, AND THAT IS ON PURPOSE

`worker/determinism.spec` proves this parser does byte-identical work over 20 runs, and the
scorer's matching is a deterministic sort. So every number below is EXACT, not noisy, and a
floor would let a silent regression hide under an unrelated improvement. Equality means any
change to a headline number has to move the baseline **in the same diff a reviewer reads**,
which is the property that was missing.

An improvement therefore goes red. That is the intended cost: an improvement nobody recorded
is indistinguishable from a measurement nobody took.

THE CORPUS IS NOT COMMITTED AND CI DOES NOT HAVE IT

`.gitignore` covers `research/benchmarks/corpus/*.pdf`. `AGENTS.md` §4: a test that needs the
corpus must skip on its absence **and say so on stdout, naming the fetch script** — because a
suite that quietly collects zero cases looks exactly like a suite that passed. See
`services/document-worker/python/tests/worker/_corpus_manifest.py`, which documents the two
separate ways that has already bitten this repo.

REPRODUCE THE NUMBERS BELOW

    uv run --project packages/evaluation/python python -m papertree_evaluation score

The `RAW` table is the report's "GOLD AS DRAWN" section; `NORMALISED` is the section under it.
Both are kept because they disagree — on `resnet` the caption count is 3 correct / 0 false as
drawn and 1 / 2 normalised — and a number quoted without saying which one it came from is not
a number. `normalise.py` is this package's code too, so a regression in it belongs here.

WHAT THE GOLD DOES NOT AUTHORISE

n = 36 pages, 6 of 8 corpus papers, 442 regions, **one annotator, no inter-annotator agreement**
(#54, and `AGENTS.md` §4: *"the gold set measures; it does not authorise"*). Additionally **26
of the `is_vector` values in the NORMALISED table are not the annotator's** — `normalise.py`
rule 4 repairs them on pages holding zero raster XObjects, and emits a warning on each saying
so. Every verdict derived from these numbers carries that n in the row, not in a footnote.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

REPO = Path(__file__).resolve().parents[5]
CORPUS = REPO / "research" / "benchmarks" / "corpus"
GOLD = REPO / "research" / "benchmarks" / "gold" / "ptub-gold.json"
FETCH = "./research/benchmarks/fetch_corpus.sh"

#: The six papers the gold set covers. Two of the eight corpus papers (`pdf-to-tree-acl2col`,
#: `superglue-tableheavy`) carry no gold at all — #54's second open item.
ANNOTATED = (
    "a3c-algorithmheavy",
    "attention-is-all-you-need",
    "bert-2col",
    "gpt3-longform-singlecol",
    "neural-odes-mathheavy",
    "resnet-cvpr-2col",
)

_missing = [p for p in ANNOTATED if not (CORPUS / f"{p}.pdf").is_file()]
requires_corpus = pytest.mark.skipif(
    bool(_missing),
    reason=(
        f"the corpus is gitignored and {len(_missing)} of {len(ANNOTATED)} annotated papers are "
        f"absent from {CORPUS} ({', '.join(_missing)}). Fetch it with `{FETCH}` to run these. "
        "CI has no corpus, so this file skips there BY DESIGN and is not evidence of anything "
        "on a clean checkout."
    ),
)


# ── the baseline ─────────────────────────────────────────────────────────────────────────────
#
# Measured 2026-08-02 on `main` at `c8bf62e` plus #95's scoring corrections; re-derived
# 2026-08-03 on `main` at `dff69e5` (i.e. INCLUDING #102) plus issue #55's equation
# right-margin extension. Emitted by a script rather than transcribed by hand.
#
# TO UPDATE: run the scorer, confirm you understand WHY each number moved, and change it here
# in the same commit as the code that moved it. A baseline edited in its own commit is a
# baseline nobody reviewed.
#
# WHAT MOVED, AND WHY (issue #55, `pipeline._extend_to_right_margin`)
#
# A display equation's block now runs out to its column's right text margin, so it contains the
# right-margin equation number that gold boxes with it. Corpus-wide: **21 gold equations, 21
# predicted, 0 matched at IoU 0.5 -> 8 matched**. Nothing about detection changed; the predicted
# count is identical, which is the property that distinguishes this from the vertical merge that
# was measured and reverted (`pipeline._merge_equation_blocks`). Every delta below is against
# `origin/main` at `dff69e5`, re-derived after rebasing onto #102 rather than carried across it:
#
#   RAW          neural-odes  equation_matched 0 -> 6 · macro_f1 0.1967 -> 0.2175 ·
#                             macro_f1_strict 0.1079 -> 0.1183 · reading_order 0.6667 -> 0.6111
#                resnet       equation_matched 0 -> 2 · macro_f1 0.2542 -> 0.3257 ·
#                             reading_order 0.9278 -> 0.9288 · strict unmoved at 0.1588
#   NORMALISED   neural-odes  equation_matched 0 -> 6 · macro_f1 0.1929 -> 0.2137 ·
#                             macro_f1_strict 0.1087 -> 0.1191
#                resnet       equation_matched 0 -> 2 · macro_f1 0.2469 -> 0.3184 ·
#                             strict unmoved at 0.1561
#
# a3c, bert and gpt3 do not move on any field: their gold holds no `equation` region at all.
# `attention-is-all-you-need` does not move either, and that one IS about the parser - its single
# gold equation's best IoU went 0.063 -> 0.293, a real improvement that is still short of 0.5.
#
# THE READING-ORDER MOVEMENT IS NOT AN ORDERING CHANGE AND ONE HALF OF IT IS DOWN. Stated
# plainly because a fall in a headline number inside a change that claims an improvement is
# exactly what a baseline update can hide. `metrics.reading_order_accuracy` scores PAIRS of gold
# body regions that BOTH matched a prediction, so a newly matched region adds pairs:
#
#   neural-odes p3   matched body regions 2 -> 3, pairs 1 -> 3, agreeing 1 -> 2. Page 1.000 ->
#                    0.667, paper mean 0.6667 -> 0.6111. The one disagreement is (r438 figure,
#                    r439 equation): gold reads the figure first and `doc_order` puts the
#                    equation first. A page scored on ONE pair was reporting nothing; it now
#                    reports three, and one of them is wrong. That defect was always there.
#   resnet p2        matched body regions 10 -> 12, pairs 45 -> 66, agreeing 42 -> 62. Page
#                    0.9333 -> 0.9394. The new wrong pair is (r190 footnote, r192 equation) -
#                    the same footnote already misplaced against three paragraphs.

RAW: dict[str, dict[str, Any]] = {
    "a3c-algorithmheavy": {
        "macro_f1": 0.3932,
        "macro_f1_strict": 0.35,
        "reading_order": 0.6667,
        "caption_correct": 4,
        "caption_false": 0,
        "caption_gold": 7,
        "vector_matched": 0,
        "vector_gold": 0,
        "equation_matched": 0,
        "equation_gold": 0,
        "equation_predicted": 0,
        "figure_matched": 4,
        "figure_gold": 5,
        "figure_predicted": 4,
    },
    "attention-is-all-you-need": {
        "macro_f1": 0.2899,
        "macro_f1_strict": 0.0941,
        "reading_order": 0.3889,
        "caption_correct": 1,
        "caption_false": 0,
        "caption_gold": 1,
        "vector_matched": 1,
        "vector_gold": 3,
        "equation_matched": 0,
        "equation_gold": 1,
        "equation_predicted": 3,
        "figure_matched": 2,
        "figure_gold": 5,
        "figure_predicted": 3,
    },
    "bert-2col": {
        "macro_f1": 0.3523,
        "macro_f1_strict": 0.2098,
        "reading_order": 0.6992,
        "caption_correct": 4,
        "caption_false": 0,
        "caption_gold": 6,
        "vector_matched": 0,
        "vector_gold": 0,
        "equation_matched": 0,
        "equation_gold": 0,
        "equation_predicted": 0,
        "figure_matched": 2,
        "figure_gold": 2,
        "figure_predicted": 2,
    },
    "gpt3-longform-singlecol": {
        "macro_f1": 0.3429,
        "macro_f1_strict": 0.1817,
        "reading_order": 0.2222,
        "caption_correct": 2,
        "caption_false": 1,
        "caption_gold": 10,
        "vector_matched": 0,
        "vector_gold": 6,
        "equation_matched": 0,
        "equation_gold": 0,
        "equation_predicted": 0,
        "figure_matched": 2,
        "figure_gold": 8,
        "figure_predicted": 2,
    },
    "neural-odes-mathheavy": {
        "macro_f1": 0.2175,
        "macro_f1_strict": 0.1183,
        "reading_order": 0.6111,
        "caption_correct": 0,
        "caption_false": 0,
        "caption_gold": 5,
        "vector_matched": 0,
        "vector_gold": 7,
        "equation_matched": 6,
        "equation_gold": 18,
        "equation_predicted": 16,
        "figure_matched": 1,
        "figure_gold": 18,
        "figure_predicted": 8,
    },
    "resnet-cvpr-2col": {
        "macro_f1": 0.3257,
        "macro_f1_strict": 0.1588,
        "reading_order": 0.9288,
        "caption_correct": 3,
        "caption_false": 0,
        "caption_gold": 10,
        "vector_matched": 0,
        "vector_gold": 4,
        "equation_matched": 2,
        "equation_gold": 2,
        "equation_predicted": 2,
        "figure_matched": 2,
        "figure_gold": 17,
        "figure_predicted": 2,
    },
}

NORMALISED: dict[str, dict[str, Any]] = {
    "a3c-algorithmheavy": {
        "macro_f1": 0.3932,
        "macro_f1_strict": 0.35,
        "reading_order": 0.6667,
        "caption_correct": 4,
        "caption_false": 0,
        "caption_gold": 7,
        "vector_matched": 4,
        "vector_gold": 5,
        "equation_matched": 0,
        "equation_gold": 0,
        "equation_predicted": 0,
        "figure_matched": 4,
        "figure_gold": 5,
        "figure_predicted": 4,
    },
    "attention-is-all-you-need": {
        "macro_f1": 0.2832,
        "macro_f1_strict": 0.0997,
        "reading_order": 0.3889,
        "caption_correct": 1,
        "caption_false": 0,
        "caption_gold": 1,
        "vector_matched": 1,
        "vector_gold": 1,
        "equation_matched": 0,
        "equation_gold": 1,
        "equation_predicted": 3,
        "figure_matched": 2,
        "figure_gold": 3,
        "figure_predicted": 3,
    },
    "bert-2col": {
        "macro_f1": 0.3523,
        "macro_f1_strict": 0.2098,
        "reading_order": 0.6992,
        "caption_correct": 4,
        "caption_false": 0,
        "caption_gold": 6,
        "vector_matched": 2,
        "vector_gold": 2,
        "equation_matched": 0,
        "equation_gold": 0,
        "equation_predicted": 0,
        "figure_matched": 2,
        "figure_gold": 2,
        "figure_predicted": 2,
    },
    "gpt3-longform-singlecol": {
        "macro_f1": 0.3429,
        "macro_f1_strict": 0.1817,
        "reading_order": 0.2222,
        "caption_correct": 2,
        "caption_false": 1,
        "caption_gold": 10,
        "vector_matched": 0,
        "vector_gold": 6,
        "equation_matched": 0,
        "equation_gold": 0,
        "equation_predicted": 0,
        "figure_matched": 2,
        "figure_gold": 8,
        "figure_predicted": 2,
    },
    "neural-odes-mathheavy": {
        "macro_f1": 0.2137,
        "macro_f1_strict": 0.1191,
        "reading_order": 0.3889,
        "caption_correct": 0,
        "caption_false": 0,
        "caption_gold": 5,
        "vector_matched": 0,
        "vector_gold": 9,
        "equation_matched": 6,
        "equation_gold": 18,
        "equation_predicted": 16,
        "figure_matched": 1,
        "figure_gold": 14,
        "figure_predicted": 8,
    },
    "resnet-cvpr-2col": {
        "macro_f1": 0.3184,
        "macro_f1_strict": 0.1561,
        "reading_order": 0.9667,
        "caption_correct": 1,
        "caption_false": 2,
        "caption_gold": 10,
        "vector_matched": 2,
        "vector_gold": 16,
        "equation_matched": 2,
        "equation_gold": 2,
        "equation_predicted": 2,
        "figure_matched": 2,
        "figure_gold": 16,
        "figure_predicted": 2,
    },
}

#: The gold set's own shape. Asserted separately from the scores, because a gold edit and a
#: parser change produce the same red row and they are entirely different events.
GOLD_SHAPE = {
    "pages": 36,
    "papers": 6,
    "regions": 442,
    "figures": 55,
    "figures_with_is_vector": 55,
    "captions": 39,
    "captions_with_parent": 39,
}


# ── fixtures ─────────────────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def gold_pages() -> list[dict[str, Any]]:
    return json.loads(GOLD.read_text())  # type: ignore[no-any-return]


@pytest.fixture(scope="module")
def parsed(tmp_path_factory: pytest.TempPathFactory) -> dict[str, dict[str, Any]]:
    """Every annotated paper, parsed ONCE. ~13 s for the six; parsing per test would be six
    times that for no extra coverage, since the parser is deterministic."""
    from papertree_evaluation.adapters import DeterministicAdapter

    root = tmp_path_factory.mktemp("corpus-gold-assets")
    documents: dict[str, dict[str, Any]] = {}
    for paper in ANNOTATED:
        outcome = DeterministicAdapter(root).parse(str(CORPUS / f"{paper}.pdf"))
        assert outcome.status == "ok", f"{paper}: {outcome.status} — {outcome.error}"
        assert outcome.document is not None
        documents[paper] = outcome.document
    return documents


@pytest.fixture(scope="module")
def normalised_pages(gold_pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from papertree_evaluation.__main__ import _page_rasters, _region_texts
    from papertree_evaluation.normalise import normalise_gold

    return list(
        normalise_gold(
            gold_pages,
            region_text=_region_texts(CORPUS, gold_pages),
            page_rasters=_page_rasters(CORPUS, gold_pages),
        ).pages
    )


def _measure(paper: str, document: dict[str, Any], pages: list[dict[str, Any]]) -> dict[str, Any]:
    from papertree_evaluation.scoring import score_paper

    score = score_paper("papertree-deterministic", paper, document, pages)

    def of(kind: str, field: str) -> int:
        bucket = score.by_type.get(kind)
        return int(getattr(bucket, field)) if bucket else 0

    return {
        "macro_f1": round(score.macro_f1, 4),
        "macro_f1_strict": round(score.macro_f1_strict, 4),
        "reading_order": round(score.mean_reading_order, 4),
        "caption_correct": score.caption_correct,
        "caption_false": score.caption_false,
        "caption_gold": score.caption_links_gold,
        "vector_matched": score.vector_matched,
        "vector_gold": score.vector_gold,
        "equation_matched": of("equation", "matched"),
        "equation_gold": of("equation", "gold"),
        # `equation_predicted` IS THE GUARD AGAINST THE FIX THAT ALREADY FAILED ONCE.
        #
        # `pipeline._merge_equation_blocks` records an approach that closed the same extent gap
        # by absorbing any non-prose block sharing an equation region's VERTICAL band. It raised
        # the IoU-0.5 match count and took `neural-odes-mathheavy` from 16 predicted against 17
        # gold to **6**, chaining distinct equations into one block. With only `matched` and
        # `gold` recorded, that trade reads as a pure improvement: the matches go up and nothing
        # in this file disagrees. The predicted count is the number that fell, so it is the
        # number that has to be asserted. `figure_predicted` was already here for the same
        # reason and `equation` was the type that needed it.
        "equation_predicted": of("equation", "predicted"),
        "figure_matched": of("figure", "matched"),
        "figure_gold": of("figure", "gold"),
        "figure_predicted": of("figure", "predicted"),
    }


# ── the gold set's shape ─────────────────────────────────────────────────────────────────────


def test_the_gold_set_is_the_one_these_numbers_were_measured_against(
    gold_pages: list[dict[str, Any]],
) -> None:
    """Always runs — it needs no corpus. A gold edit must be loud HERE rather than showing up
    as six mysteriously red score rows.

    442 regions over 36 pages, 6 of 8 papers, one annotator: #54's n, asserted so that a
    verdict written against this file cannot silently acquire a different denominator.
    """
    regions = [r for page in gold_pages for r in page["regions"]]
    census = Counter(r["type"] for r in regions)
    figures = [r for r in regions if r["type"] == "figure"]
    captions = [r for r in regions if r["type"] == "caption"]
    measured = {
        "pages": len(gold_pages),
        "papers": len({p["paper_id"] for p in gold_pages}),
        "regions": len(regions),
        "figures": census["figure"],
        "figures_with_is_vector": sum(1 for r in figures if r.get("is_vector") is not None),
        "captions": census["caption"],
        "captions_with_parent": sum(1 for r in captions if r.get("parent")),
    }
    assert measured == GOLD_SHAPE, (
        "the gold set changed. Re-run the scorer, understand every moved score, and update "
        "GOLD_SHAPE and the baselines in this file together — a gold change and a parser "
        "change look identical from a red assertion and are not the same event."
    )
    assert {p["paper_id"] for p in gold_pages} == set(ANNOTATED)
    #: #86's premise, asserted rather than assumed: `is_vector` is present on figures and only
    #: on figures, so testing PRESENCE cannot be satisfied by some other type carrying the key.
    assert {r["type"] for r in regions if r.get("is_vector") is not None} == {"figure"}
    assert {r["type"] for r in regions if r.get("parent")} == {"caption"}


# ── the scores ───────────────────────────────────────────────────────────────────────────────


@requires_corpus
@pytest.mark.parametrize("paper", ANNOTATED)
def test_scores_against_gold_as_drawn(
    paper: str,
    parsed: dict[str, dict[str, Any]],
    gold_pages: list[dict[str, Any]],
    capsys: pytest.CaptureFixture[str],
) -> None:
    measured = _measure(paper, parsed[paper], gold_pages)
    with capsys.disabled():
        print(f"\n[eval/corpus-gold RAW] {paper:32s} {measured}")
    assert measured == RAW[paper], _drift(paper, "RAW", measured, RAW[paper])


@requires_corpus
@pytest.mark.parametrize("paper", ANNOTATED)
def test_scores_against_normalised_gold(
    paper: str,
    parsed: dict[str, dict[str, Any]],
    normalised_pages: list[dict[str, Any]],
    capsys: pytest.CaptureFixture[str],
) -> None:
    measured = _measure(paper, parsed[paper], normalised_pages)
    with capsys.disabled():
        print(f"\n[eval/corpus-gold NORM] {paper:32s} {measured}")
    assert measured == NORMALISED[paper], _drift(paper, "NORMALISED", measured, NORMALISED[paper])


def _drift(paper: str, table: str, measured: dict[str, Any], expected: dict[str, Any]) -> str:
    moved = {k: (expected[k], measured[k]) for k in expected if expected[k] != measured[k]}
    return (
        f"{paper} moved against the {table} baseline: "
        + ", ".join(f"{k} {was} -> {now}" for k, (was, now) in sorted(moved.items()))
        + ". This parser is deterministic (worker/determinism.spec), so it moved because "
        "something changed. If the change is yours and you understand it, update the "
        f"{table} table in this file IN THE SAME COMMIT."
    )


# ── the corpus-wide figures the RESULT document quotes ───────────────────────────────────────

#: Floats found at IoU >= 0.5 IGNORING type, against floats found with the type matching too.
#: `(type_blind, type_aware, gold_floats)` pooled over the six annotated papers.
FLOAT_DETECTION = (29, 22, 80)
#: ...and per paper, because the corpus figure hides where the gap is.
FLOAT_DETECTION_BY_PAPER = {
    "a3c-algorithmheavy": (5, 5, 7),
    "attention-is-all-you-need": (3, 3, 6),
    "bert-2col": (6, 6, 6),
    "gpt3-longform-singlecol": (9, 3, 10),
    "neural-odes-mathheavy": (1, 1, 22),
    "resnet-cvpr-2col": (5, 4, 29),
}


@requires_corpus
def test_floats_found_in_the_right_place_against_floats_found_with_the_right_type(
    parsed: dict[str, dict[str, Any]],
    gold_pages: list[dict[str, Any]],
    capsys: pytest.CaptureFixture[str],
) -> None:
    """#51 says "region detection, not linking, is what blocks `figures.spec`". Half of that is
    now wrong, and the headline F1 cannot show which half.

    §4.1 matches on `IoU >= 0.5 AND type`, so a region boxed exactly right but typed differently
    scores identically to one that was never found at all. Those are different defects with
    different owners — the first is a convention disagreement (#54: one annotator, no IAA,
    "Docling's own absolute F1 against this gold is 0.168-0.308"), the second is a parser bug —
    and the report could not previously tell them apart.

    Splitting the whole-page false table (`tables._group_rules`) moved gpt3 from **3/10 to 9/10
    type-blind** while type-aware stayed at 3/10: those six regions are gold `figure` and the
    parser calls them `table`, because they are GPT-3's boxed qualitative examples, which are
    literally booktabs tables in the source. The parser is not wrong about what it found. Nobody
    should spend another session trying to make the parser's figure detector see them.

    bert moved 4/6 -> 6/6 on BOTH, which is the half that was a real detection defect.

    neural-odes at 1/22 and resnet at 5/29 are unmoved and are still genuine detection failures —
    stated here so this test is not read as saying detection is solved.
    """
    from papertree_evaluation.metrics import iou, match_regions
    from papertree_evaluation.scoring import blocks_to_regions

    float_types = {"figure", "table", "algorithm"}
    by_paper: dict[str, tuple[int, int, int]] = {}
    for paper in ANNOTATED:
        blind = aware = gold_n = 0
        for page in (p for p in gold_pages if p["paper_id"] == paper):
            gold = [r for r in page["regions"] if r["type"] in float_types and r.get("bbox")]
            pred = [
                b
                for b in blocks_to_regions(parsed[paper], int(page["page"]))
                if b["type"] in float_types
            ]
            gold_n += len(gold)
            aware += len(match_regions(pred, gold, 0.5))
            used: set[int] = set()
            for g in gold:
                ranked = sorted(
                    ((iou(p["bbox"], g["bbox"]), i) for i, p in enumerate(pred) if i not in used),
                    reverse=True,
                )
                if ranked and ranked[0][0] >= 0.5:
                    used.add(ranked[0][1])
                    blind += 1
        by_paper[paper] = (blind, aware, gold_n)

    totals = tuple(sum(v[i] for v in by_paper.values()) for i in range(3))
    with capsys.disabled():
        print(
            f"\n[eval/corpus-gold] float detection, gold as drawn: "
            f"TYPE-BLIND {totals[0]}/{totals[2]}, type-aware {totals[1]}/{totals[2]}. "
            f"Per paper (blind, aware, gold): {by_paper}"
        )
    assert by_paper == FLOAT_DETECTION_BY_PAPER
    assert totals == FLOAT_DETECTION
    # Anti-vacuity: if these two were equal the test would assert nothing about the distinction
    # it exists to draw, and would pass unchanged on a scorer that ignored `type` entirely.
    assert totals[0] > totals[1], "type-blind and type-aware agree - the split is not measurable"


#: The caption pipeline's two stages, separately. `(caption_detected, caption_gold,
#: linked_given_both_ends, both_ends_detected)` per paper, pooled below. Issue #111.
#:
#: WHY THIS EXISTS. `test_the_share_of_floats_carrying_a_caption` reports ONE rate — 58/85 =
#: 68.2% — and `research/build/README.md`'s gate item 5 quotes it as though it measured caption
#: LINKING. It does not. It is a sum over three unlike failures:
#:
#:     float detection      a float never found cannot carry a caption   FLOAT_DETECTION above
#:     caption detection    a caption never boxed cannot be linked       this table, cols 1-2
#:     linking              both ends present, no `caption_of` emitted   this table, cols 3-4
#:
#: ...and its DENOMINATOR IS PARSER REGIONS, so `figures._merge_panels` splitting one document
#: figure into five adds 5 to it while at most 1 can ever be captioned. A pure extent bug (#103)
#: is charged to it as four caption failures.
#:
#: This is #102's defect one metric to the left. #102 split float detection into type-blind and
#: type-aware because "never found" and "found and typed differently" are different failures with
#: different owners. The caption rate was left conflated in the same way.
#:
#: WHAT THE SPLIT SHOWS, and it changes the verdict on gate item 5: linking given both ends is
#: **14/15**, which is ABOVE the 80% bar the gate quotes. The residual is detection, on both
#: sides. #51 reached the same conclusion by classifying 17 misses BY HAND and got 7/8; this is
#: the same finding as an assertion, over all six annotated papers rather than a subset.
#:
#: n = 15 of 39 gold links, and that is the number to be careful with. The other 24 links have an
#: end the parser never detected, so this rate is measured on the 38% of the gold set where the
#: question is even askable. It is reported with its n for that reason and MUST NOT be quoted as
#: "caption linking is 93%" without it (`AGENTS.md` §4: the n goes in the row, not a footnote).
#:
#: WATCHED FAILING. Four mutations, each applied in a worktree and re-run; the script verifies the
#: edit LANDED before believing the result, because a mutation that silently does nothing reports
#: "no failures" and that is indistinguishable from a test that asserts nothing (#109).
#:
#:   mutation                                    DETECTION  LINK|both  composite   this  composite
#:                                                                     (8 papers)  test  test
#:   -----------------------------------------  ---------  ---------  ----------  ----  ---------
#:   baseline                                       25/39      14/15       58/85  pass  pass
#:   A  drop the appendix label from                17/39      11/12       50/85  RED   RED
#:      `figures._CAPTION_START`
#:   B  `CAPTION_MIN_X_OVERLAP` 0.35 -> 0.99        25/39      14/15       56/85  pass  RED
#:   C  `figures._merge_panels` -> no-op            25/39      14/15      58/171  pass  RED
#:   D  `CAPTION_MAX_GAP_PT` 90.0 -> 0.4            25/39       1/15        1/85  RED   RED
#:
#: READ ROW C. The numerator does not move — 58 before, 58 after — and the composite falls from
#: 68.2% to 33.9% because the denominator DOUBLES. `_merge_panels` alone swings gate item 5's
#: headline by 34 points without changing one caption link. That is #111's claim as an experiment
#: rather than an argument, and it is why the gate table may not quote 68.2% as a caption number.
#:
#: ROW D is the one that proves the linking half asserts anything: linking collapses to 1/15 while
#: detection stays EXACTLY at 25/39. Single-axis, in the direction the split claims to isolate.
#:
#: ROW B IS RECORDED BECAUSE IT DID NOT WORK, which is the more useful kind of entry. It was the
#: mutation this test was designed against, and it moves the composite by two links while leaving
#: this test green — both of those links are outside the six annotated papers, so no gold covers
#: them. The linking assertion was therefore UNPROVEN until D was run. Recorded so that nobody
#: re-derives B, concludes the split is vacuous, and deletes it.
CAPTION_PIPELINE_BY_PAPER = {
    "a3c-algorithmheavy": (5, 7, 4, 4),
    "attention-is-all-you-need": (1, 1, 1, 1),
    "bert-2col": (4, 6, 4, 4),
    "gpt3-longform-singlecol": (9, 10, 2, 3),
    #: Zero askable links: float detection is 1/22, so no gold link on this paper has both ends.
    #: A rate over an empty denominator is NOT EVALUABLE and is recorded as (0, 0), not as 0%.
    "neural-odes-mathheavy": (1, 5, 0, 0),
    "resnet-cvpr-2col": (5, 10, 3, 3),
}
CAPTION_PIPELINE = (25, 39, 14, 15)


@requires_corpus
def test_caption_detection_and_caption_linking_are_measured_separately(
    parsed: dict[str, dict[str, Any]],
    gold_pages: list[dict[str, Any]],
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Issue #111. The two stages of the caption pipeline, each with its own denominator.

    THE JOIN, which is the part that is easy to get wrong. Gold links are
    `(caption gold_id, parent gold_id)`; the parser's are `(caption block_id, float block_id)`.
    Two id spaces naming the same page, so comparing them directly scores ZERO ON A PERFECT
    PARSER. Both sides are translated into gold ids through the same IoU-and-type matcher the F1
    uses — `scoring._caption_links` already does exactly this and is reused rather than
    re-derived.

    "Both ends detected" means both the caption region and its parent float matched a prediction
    at IoU >= 0.5 WITH THE TYPE AGREEING. That is deliberately the strict matcher: it makes the
    denominator smaller and the rate more conservative, because gpt3's six figure-vs-table
    convention disagreements (#54) are excluded from it rather than counted as linkable.
    """
    from papertree_evaluation.metrics import IOU_MATCH, match_regions
    from papertree_evaluation.scoring import _relation_source, blocks_to_regions

    by_paper: dict[str, tuple[int, int, int, int]] = {}
    for paper in ANNOTATED:
        detected = cap_gold = linked = both_ends = 0
        for page in (p for p in gold_pages if p["paper_id"] == paper):
            gold = [r for r in page["regions"] if r.get("bbox")]
            predicted = blocks_to_regions(parsed[paper], int(page["page"]))
            pairs = match_regions(predicted, gold, IOU_MATCH)
            matched = {gi for _, gi in pairs}
            block_to_gold = {
                str(predicted[pi]["block_id"]): str(gold[gi]["gold_id"])
                for pi, gi in pairs
                if predicted[pi].get("block_id") and gold[gi].get("gold_id")
            }
            index_of = {str(r["gold_id"]): i for i, r in enumerate(gold) if r.get("gold_id")}

            captions = [(i, r) for i, r in enumerate(gold) if r.get("type") == "caption"]
            cap_gold += len(captions)
            detected += sum(1 for i, _ in captions if i in matched)

            askable = {
                (str(r["gold_id"]), str(r["parent"]))
                for _, r in captions
                if r.get("parent")
                and index_of.get(str(r["gold_id"])) in matched
                and index_of.get(str(r["parent"])) in matched
            }
            both_ends += len(askable)
            emitted = {
                (block_to_gold[src], block_to_gold[dst])
                for rel in parsed[paper].get("relations") or []
                if rel.get("type") == "caption_of"
                for src, dst in [(str(_relation_source(rel)), str(rel.get("to")))]
                if src in block_to_gold and dst in block_to_gold
            }
            linked += len(askable & emitted)
        by_paper[paper] = (detected, cap_gold, linked, both_ends)

    totals = tuple(sum(v[i] for v in by_paper.values()) for i in range(4))
    with capsys.disabled():
        print(
            f"\n[eval/corpus-gold] caption pipeline, gold as drawn, six papers: "
            f"DETECTION {totals[0]}/{totals[1]} = {totals[0] / totals[1]:.1%}; "
            f"LINKING GIVEN BOTH ENDS {totals[2]}/{totals[3]} = {totals[2] / totals[3]:.1%} "
            f"(n = {totals[3]} of 39 gold links — the rest have an end the parser never found). "
            f"Per paper (detected, gold, linked, askable): {by_paper}"
        )
    assert by_paper == CAPTION_PIPELINE_BY_PAPER
    assert totals == CAPTION_PIPELINE

    # ANTI-VACUITY, and it is not decoration. If detection and linking moved together this would
    # be one rate printed twice, which is the defect #111 is about arriving inside its own fix.
    # The two must be numerically distinguishable AND the linking rate must be the higher one —
    # that ordering is the whole finding, and a scorer that conflated them again would lose it.
    detection_rate = totals[0] / totals[1]
    linking_rate = totals[2] / totals[3]
    assert linking_rate > detection_rate, (
        f"linking {linking_rate:.3f} is not above detection {detection_rate:.3f} — the split has "
        "stopped separating the two failures and gate item 5's residual can no longer be named"
    )
    # ...and the composite these decompose is lower than BOTH, which is what makes quoting it as
    # a caption-linking number wrong. 14/39 is the same numerator over an undecomposed denominator.
    composite = totals[2] / totals[1]
    assert composite < detection_rate < linking_rate


@requires_corpus
def test_the_corpus_wide_caption_association(
    parsed: dict[str, dict[str, Any]],
    gold_pages: list[dict[str, Any]],
    capsys: pytest.CaptureFixture[str],
) -> None:
    """§4.1's caption association pooled over all six papers — the number #51 is about.

    Reported as correct / false / missed rather than as one rate, because §4.1 requires it:
    attaching Figure 2's caption to Figure 3 and attaching nothing are different failures and
    the first is worse.

    #51 moved this from **10/39 correct, 1 false** to **14/39, 1 false** — and the false count
    did NOT rise, which is the half that matters. §4.1 treats a false link as the more expensive
    error, so four recovered links bought at the cost of a fifth false one would have been a
    worse result reported as a better one.
    """
    correct = sum(_measure(p, parsed[p], gold_pages)["caption_correct"] for p in ANNOTATED)
    false = sum(_measure(p, parsed[p], gold_pages)["caption_false"] for p in ANNOTATED)
    total = sum(_measure(p, parsed[p], gold_pages)["caption_gold"] for p in ANNOTATED)
    with capsys.disabled():
        print(
            f"\n[eval/corpus-gold] caption association, gold as drawn, all six papers: "
            f"{correct}/{total} correct, {false} false "
            f"(n = 36 pages / 6 of 8 papers / 1 annotator, #54)"
        )
    assert (correct, false, total) == (14, 1, 39)


@requires_corpus
def test_the_share_of_floats_carrying_a_caption(
    capsys: pytest.CaptureFixture[str],
    tmp_path: pytest.TempPathFactory,
) -> None:
    """`worker/figures.spec`'s ">=80% have a linked caption", measured the way the gate table
    reports it — and with its DENOMINATOR STATED, which it never was.

    `research/build/README.md`'s gate item 5 said "captions 58% against an 80% bar". That
    reproduced only over FIGURES, and at the time it was 48 of 83 = 57.8%. Over floats — figures
    **and** tables, both of which rule 22 permits as `caption_of` targets, and roughly half this
    corpus's captions read "Table N" — it was 85 of 173 = 49.1%. Two different numbers for one
    sentence, which is why the denominator is now named in the assertion.

    #51 moved both. Over figures **58 of 85 = 68.2%**; over floats **142 of 226 = 62.8%**. The
    numerator rose because `figures._CAPTION_START` could not match an APPENDIX label, so gpt3's
    34 `Figure G.N:` captions were never captions at all and could link to nothing. STILL UNDER
    THE 80% BAR, on both denominators.

    Runs over the whole 8-paper corpus, not the 6 annotated ones, because this metric reads the
    parser's own relations and needs no gold.

    THIS IS A COMPOSITE AND MUST NOT BE QUOTED AS A CAPTION-LINKING RATE — issue #111.

    Its denominator is PARSER REGIONS. One caption links to one float, so a document figure the
    parser splits into five panels adds 5 here while at most 1 can ever be captioned: an extent
    defect (#103) is charged to this number as four caption failures. Measured, not argued —
    making `figures._merge_panels` a no-op takes it from **58/85 to 58/171**, an identical
    numerator and a 34-point fall.

    So 68.2% is float detection, caption detection and caption linking added together.
    `test_caption_detection_and_caption_linking_are_measured_separately` reports the last two
    against GOLD denominators, and `..._floats_found_in_the_right_place_...` the first. Linking
    given both ends is **14/15**, above the 80% bar. Read those three before concluding anything
    about the parser's captioning from the number below.
    """
    from papertree_evaluation.adapters import DeterministicAdapter

    root = Path(str(tmp_path))
    figures = figures_captioned = floats = floats_captioned = 0
    for pdf in sorted(CORPUS.glob("*.pdf")):
        outcome = DeterministicAdapter(root).parse(str(pdf))
        assert outcome.status == "ok" and outcome.document is not None, outcome.error
        blocks = outcome.document["blocks"]
        captioned = {
            r.get("to")
            for r in (outcome.document.get("relations") or [])
            if r.get("type") == "caption_of"
        }
        page_figures = [b for b in blocks if b["type"] == "figure"]
        page_floats = [b for b in blocks if b["type"] in ("figure", "table")]
        figures += len(page_figures)
        floats += len(page_floats)
        figures_captioned += sum(1 for b in page_figures if b["block_id"] in captioned)
        floats_captioned += sum(1 for b in page_floats if b["block_id"] in captioned)

    with capsys.disabled():
        print(
            f"\n[eval/corpus-gold] figures.spec's captioned share, 8-paper corpus: "
            f"over FIGURES {figures_captioned}/{figures} = {figures_captioned / figures:.1%}; "
            f"over FLOATS (figures+tables) {floats_captioned}/{floats} = "
            f"{floats_captioned / floats:.1%}. The bar is 80%."
        )
    assert (figures_captioned, figures) == (58, 85)
    assert (floats_captioned, floats) == (142, 226)
