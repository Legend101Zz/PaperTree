"""#53's speed harness: the refusal, the warm-up, the spread, the basis and the machine state.

WHAT MAKES THESE ASSERTIONS NON-VACUOUS, STATED BEFORE THEM

`AGENTS.md` §2 records `perf.spec` asserting `peak_mb < 2000` against a 500 MB bar — green for
months, measuring nothing. The same shape is available here and is avoided deliberately:

  * **No assertion here is a loose bound on a wall-clock time.** The synthetic tests feed
    *constructed* timings into `rule_on_speed` and assert the ruling it returns, so the inputs
    sit a stated distance from the bar and each one flips class under a one-character mutation
    (the table is in the PR body). `test_a_tight_measurement_above_the_bar_...` and
    `..._below_the_bar_...` are the same code path with the bar on opposite sides.
  * **No `parametrize` walks the corpus glob.** `_corpus_manifest.py` records that an empty glob
    collects ZERO cases and reports as a pass. The one corpus test names a single paper and its
    page count explicitly, so an empty corpus is a *skip with a reason*, not a silent nothing.
  * **The source-scan test carries a positive control.** It asserts its own pattern matches the
    historical defect string before asserting the module is clean, because a regex that can never
    match is the vacuous green in its purest form.
  * **The warm-up test counts adapter calls**, so "warm-up discarded" cannot be satisfied by
    never running one.

THE CORPUS IS NOT COMMITTED AND CI DOES NOT HAVE IT

`research/benchmarks/corpus/*.pdf` is gitignored. The corpus test skips on its absence with a
reason naming `./research/benchmarks/fetch_corpus.sh`, and
`test_the_corpus_skip_names_the_fetch_script` prints that status to stdout on every run —
including CI — so the absence is visible rather than inferred from a summary line.
"""

from __future__ import annotations

import ast
import re
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import pytest
from papertree_evaluation.adapters import AdapterOutcome, DeterministicAdapter
from papertree_evaluation.speed import (
    FETCH_SCRIPT,
    SPEED_BAR,
    Interval,
    MachineState,
    Measurement,
    PaperRun,
    Trial,
    corpus_ratio,
    measure,
    no_comparison,
    per_paper_ratio,
    rule_on_speed,
)

REPO = Path(__file__).resolve().parents[5]
CORPUS = REPO / "research" / "benchmarks" / "corpus"
MAIN = REPO / "packages" / "evaluation" / "python" / "papertree_evaluation" / "__main__.py"

#: The smallest corpus paper, named rather than globbed, with the page count re-derived
#: (`pymupdf.open(...).page_count`) rather than quoted.
SMALLEST = "pdf-to-tree-acl2col"
SMALLEST_PAGES = 11

requires_corpus = pytest.mark.skipif(
    not (CORPUS / f"{SMALLEST}.pdf").is_file(),
    reason=(
        f"{SMALLEST}.pdf is absent from {CORPUS}; the corpus is gitignored and fetched, not "
        f"committed. Run `{FETCH_SCRIPT}` to enable this test. CI has no corpus, so this skips "
        "there BY DESIGN and is not evidence of anything on a clean checkout."
    ),
)


def _measurement(
    adapter: str,
    per_paper: Mapping[str, Sequence[float]],
    *,
    overhead: float = 0.0,
    pages: int = 10,
    status: str = "ok",
) -> Measurement:
    """A Measurement built from constructed timings, so a ruling can be asserted exactly."""
    papers = tuple(per_paper)
    count = len(next(iter(per_paper.values())))
    trials = tuple(
        Trial(
            index=i + 1,
            runs=tuple(
                PaperRun(p, per_paper[p][i], per_paper[p][i], pages, status) for p in papers
            ),
            corpus_wall_seconds=sum(per_paper[p][i] for p in papers) + overhead,
        )
        for i in range(count)
    )
    return Measurement(adapter, papers, (), trials)


def _one_paper(adapter: str, totals: Sequence[float], **kwargs: object) -> Measurement:
    return _measurement(adapter, {"only-paper": list(totals)}, **kwargs)  # type: ignore[arg-type]


# ── the refusal, which is the whole point of the module ──────────────────────────────────────


def test_a_spread_wider_than_the_distance_to_the_bar_refuses_to_emit_a_ratio() -> None:
    """#53's central requirement, with the exact shape #53 describes.

    slow / fast over three trials is 8x, 12x, 20x. The median clears the 10x bar — a harness
    that reported a bare median would print "12x -> MET" — but the spread is 12x against a
    distance to the bar of 2x, so the next re-run can land on either side of it.
    """
    fast = _one_paper("papertree-deterministic", [1.0, 1.0, 1.0])
    slow = _one_paper("docling", [8.0, 12.0, 20.0])

    verdict = rule_on_speed(fast, slow, bar=10.0)

    assert verdict.ruling == "NOT ESTABLISHED"
    assert verdict.ratio_for_decision is None, "a refused verdict must expose no number at all"
    assert "REFUSES TO EMIT A RATIO" in verdict.render()
    # The refusal names the two numbers that produced it, not a ratio.
    assert "spread 12.00×" in verdict.reason
    assert "distance to the bar 2.00×" in verdict.reason


def test_a_tight_measurement_above_the_bar_is_met_and_does_yield_a_number() -> None:
    """The other side of the same predicate: spread 1.00x against a distance of 20.50x."""
    fast = _one_paper("papertree-deterministic", [1.0, 1.0, 1.0])
    slow = _one_paper("docling", [30.0, 30.5, 31.0])

    verdict = rule_on_speed(fast, slow, bar=10.0)

    assert verdict.ruling == "MET"
    assert verdict.ratio_for_decision == pytest.approx(30.5)
    assert "REFUSES" not in verdict.render()


def test_a_tight_measurement_below_the_bar_is_not_met_rather_than_refused() -> None:
    """A parser that is genuinely too slow still gets a verdict. Refusal is not a hiding place."""
    fast = _one_paper("papertree-deterministic", [1.0, 1.0, 1.0])
    slow = _one_paper("docling", [2.0, 2.1, 2.2])

    verdict = rule_on_speed(fast, slow, bar=10.0)

    assert verdict.ruling == "NOT MET"
    assert verdict.ratio_for_decision == pytest.approx(2.1)


def test_a_parser_that_did_not_finish_every_trial_cannot_produce_a_ratio() -> None:
    """A ratio over a partial corpus is not the corpus ratio, however tight its spread is."""
    fast = _one_paper("papertree-deterministic", [1.0, 1.0, 1.0])
    slow = _one_paper("docling", [30.0, 30.5, 31.0], status="crashed")

    verdict = rule_on_speed(fast, slow, bar=10.0)

    assert verdict.ruling == "NOT ESTABLISHED"
    assert verdict.ratio_for_decision is None
    assert "docling" in verdict.reason and "crashed" in verdict.reason


def test_no_comparison_arm_is_reported_as_no_ratio_and_never_as_a_win() -> None:
    """`adapters.py`'s rule — available is about the ENVIRONMENT — applied to the ratio."""
    verdict = no_comparison("no docling interpreter at /nowhere", bar=SPEED_BAR)

    assert verdict.ruling == "NOT ESTABLISHED"
    assert verdict.ratio_for_decision is None
    assert "/nowhere" in verdict.render()


# ── the basis: corpus wall-clock, not per-paper medians ──────────────────────────────────────


def test_the_verdict_rules_on_corpus_wall_clock_and_reports_the_per_paper_median_beside_it() -> (
    None
):
    """The two aggregations disagree here BY CONSTRUCTION, and the corpus one is the verdict.

    Three papers; the slow parser is 4x on two of them and 100x on the third. The per-paper
    median is 4.00x — under a 10x bar. The corpus total is 108s against 3s, i.e. 36.00x — over
    it. #53 asks for the corpus number because a fixed model-load cost amortised over an
    11-page paper dominates the per-paper one.
    """
    per_paper_fast = {"p1": [1.0] * 3, "p2": [1.0] * 3, "p3": [1.0] * 3}
    per_paper_slow = {"p1": [4.0] * 3, "p2": [4.0] * 3, "p3": [100.0] * 3}
    fast = _measurement("papertree-deterministic", per_paper_fast)
    slow = _measurement("docling", per_paper_slow)

    assert per_paper_ratio(fast, slow) == pytest.approx(4.0)
    assert corpus_ratio(fast, slow).median == pytest.approx(36.0)

    verdict = rule_on_speed(fast, slow, bar=10.0)

    assert verdict.ruling == "MET"
    assert verdict.ratio_for_decision == pytest.approx(36.0)
    assert "corpus wall-clock" in verdict.basis
    # Reported, so a reader can see the disagreement rather than take the aggregation on trust.
    assert verdict.per_paper_median == pytest.approx(4.0)
    assert "4.00×" in verdict.render()


# ── the spread is always reported as an interval ─────────────────────────────────────────────


def test_every_reported_number_carries_its_interval_and_never_a_bare_median() -> None:
    """`Interval.render` is the only formatter in the module, and it cannot print a bare median."""
    rendered = Interval.of([1.0, 2.0, 9.0]).render("s", 2)

    assert Interval.of([1.0, 2.0, 9.0]).spread == pytest.approx(8.0)
    assert "2.00s" in rendered and "min 1.00s" in rendered and "max 9.00s" in rendered
    assert "spread 8.00s" in rendered


def test_the_corpus_ratio_interval_is_the_widest_the_observations_admit() -> None:
    """Pessimistic pairing, chosen against the refusal rather than for it."""
    fast = _one_paper("fast", [1.0, 2.0, 4.0])
    slow = _one_paper("slow", [10.0, 20.0, 40.0])

    ratio = corpus_ratio(fast, slow)

    assert ratio.low == pytest.approx(10.0 / 4.0)  # slowest fast round vs fastest slow round
    assert ratio.median == pytest.approx(20.0 / 2.0)
    assert ratio.high == pytest.approx(40.0 / 1.0)


# ── the warm-up ──────────────────────────────────────────────────────────────────────────────


@dataclass
class _ScriptedAdapter:
    """An adapter whose first call per paper is genuinely slower, so a discard is observable."""

    name: str = "scripted"
    version: str = "0"
    calls: int = 0
    seen: tuple[str, ...] = ()

    @property
    def available(self) -> bool:
        return True

    def parse(self, pdf_path: str) -> AdapterOutcome:
        first = pdf_path not in self.seen
        self.seen = (*self.seen, pdf_path)
        self.calls += 1
        time.sleep(0.05 if first else 0.002)
        return AdapterOutcome(self.name, Path(pdf_path).stem, "ok", seconds=0.0, pages=10)


def test_the_warm_up_pass_is_run_per_paper_and_then_discarded(tmp_path: Path) -> None:
    """Both halves asserted: it RAN (call count), and it is NOT in the trials (timings).

    The 969s-then-85s cold/warm gap measured on this box for Docling's first pass over an
    11-page paper is why: a single-trial harness reports whichever of those it happened to hit.
    """
    adapter = _ScriptedAdapter()
    pdfs = [tmp_path / "a.pdf", tmp_path / "b.pdf"]

    result = measure(adapter, pdfs, trials=3, warm_ups=1, log=lambda _: None)

    assert adapter.calls == 8, "1 warm-up + 3 trials over 2 papers"
    assert len(result.warm_up) == 1
    assert len(result.trials) == 3
    assert result.warm_up[0].corpus_wall_seconds > result.corpus_wall().high, (
        "the discarded pass is the slow one; if it is inside the counted interval it was counted"
    )


def test_measure_refuses_a_trial_count_below_one() -> None:
    with pytest.raises(ValueError, match="trials must be >= 1"):
        measure(_ScriptedAdapter(), [Path("x.pdf")], trials=0, log=lambda _: None)


# ── the machine state ────────────────────────────────────────────────────────────────────────


def test_an_undeclared_machine_is_named_as_undeclared_rather_than_left_to_be_assumed() -> None:
    """#53 asks for the machine state in the output. The failure mode is silence reading as yes."""
    state = MachineState.observe()

    assert state.quiesce_declared is False
    assert "NOT DECLARED QUIESCED" in state.render()


def test_a_declared_machine_is_named_as_an_unverified_operator_claim() -> None:
    state = MachineState.observe(declared=True, note="closed everything but the shell")

    assert "DECLARED QUIESCED BY THE OPERATOR" in state.render()
    assert "closed everything but the shell" in state.render()
    assert "cannot verify" in state.render()


# ── the defect this issue was filed about ────────────────────────────────────────────────────

#: Matches a speed verdict baked into a string literal — `speed: ... 12x`, `speed ... 20×`.
HARDCODED_SPEED = re.compile(r"speed[^\"']{0,40}?\d+(?:\.\d+)?\s*[x×]", re.IGNORECASE)


def test_no_string_literal_in_the_cli_carries_a_speed_verdict() -> None:
    """The literal `_decision_rule` used to print, asserted gone — from the AST, not the text.

    Comments are invisible to `ast`, which is deliberate: the deleted line survives as a comment
    in `__main__.py` recording what it was, and a text grep would match that and never go green.
    """
    # POSITIVE CONTROL. A pattern that cannot match is the vacuous green in its purest form.
    assert HARDCODED_SPEED.search("  speed: measured separately at 12x against a 20x bar -> FAIL")

    offenders = [
        node.value
        for node in ast.walk(ast.parse(MAIN.read_text(encoding="utf-8")))
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and HARDCODED_SPEED.search(node.value)
    ]
    assert offenders == [], f"a speed verdict is hardcoded in a string literal: {offenders}"


@dataclass
class _Score:
    macro_f1: float


def test_the_decision_rule_printer_says_it_has_no_speed_measurement(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """With no measurement it must say so — not print a verdict, and not print nothing."""
    from papertree_evaluation.__main__ import _decision_rule

    _decision_rule({"resnet": _Score(0.5)}, {"resnet": _Score(0.5)}, None)

    out = capsys.readouterr().out
    assert "speed: NOT MEASURED IN THIS RUN" in out
    assert "papertree_evaluation speed" in out


def test_the_decision_rule_printer_reports_the_measurement_it_was_given(
    capsys: pytest.CaptureFixture[str],
) -> None:
    fast = _one_paper("papertree-deterministic", [1.0, 1.0, 1.0])
    slow = _one_paper("docling", [8.0, 12.0, 20.0])
    from papertree_evaluation.__main__ import _decision_rule

    _decision_rule({"resnet": _Score(0.5)}, {"resnet": _Score(0.5)}, rule_on_speed(fast, slow))

    out = capsys.readouterr().out
    assert "speed: NOT ESTABLISHED" in out
    assert "REFUSES TO EMIT A RATIO" in out
    assert "NOT MEASURED IN THIS RUN" not in out


# ── the real parser, over a real paper ───────────────────────────────────────────────────────


def test_the_corpus_skip_names_the_fetch_script(capsys: pytest.CaptureFixture[str]) -> None:
    """Always collected. Announces the corpus state on stdout, per AGENTS.md §4."""
    present = (CORPUS / f"{SMALLEST}.pdf").is_file()
    print(
        f"corpus {'present' if present else 'ABSENT'} at {CORPUS}; "
        f"the timing test {'runs' if present else 'SKIPS'}. Fetch with `{FETCH_SCRIPT}`."
    )

    assert FETCH_SCRIPT in str(requires_corpus.kwargs["reason"])
    assert FETCH_SCRIPT in capsys.readouterr().out


@requires_corpus
def test_the_harness_times_the_real_parser_over_a_real_paper(tmp_path: Path) -> None:
    """One paper, one warm-up, two trials — the smallest run that exercises the whole path.

    Asserts the PAGE COUNT, not a time: 11 is a fact about the PDF and a mutation that counted
    papers instead of pages, or lost the count entirely, turns it red. Times are asserted only
    to be positive and finite, because asserting a bound on wall-clock in a shared pytest process
    is the defect `AGENTS.md` §4 records `migrations.spec` being fixed for.
    """
    pdf = CORPUS / f"{SMALLEST}.pdf"
    result = measure(
        DeterministicAdapter(tmp_path), [pdf], trials=2, warm_ups=1, log=lambda _: None
    )

    assert result.complete
    assert len(result.warm_up) == 1
    assert len(result.trials) == 2
    assert result.trials[0].pages_total == SMALLEST_PAGES
    assert result.corpus_wall().low > 0.0
    assert result.seconds_per_page(SMALLEST).median > 0.0
    assert result.corpus_seconds_per_page().median == pytest.approx(
        result.corpus_wall().median / SMALLEST_PAGES, rel=0.2
    )
