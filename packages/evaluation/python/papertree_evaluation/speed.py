"""The speed half of the decision rule, measured so it can carry the decision — or refused.

WHAT THIS EXISTS TO FIX, STATED BEFORE THE CODE

`EPIC-01-RESULT.md` §1 records the rule's speed half as **NOT ESTABLISHED**, not as a failure.
Three controlled re-runs of the same comparison, same machine, same code, produced median ratios
of 12.4× / 16.8× / 18.7×; the gap from the lowest of those to the then-bar of 20× was 1.6×,
against a measured 3.3× cross-process spread. **A number whose spread exceeds the distance to its
bar cannot support the decision it is being used for** — the same principle #80 was fixed on.

So this module's central feature is not a timer. It is `rule_on_speed`'s **refusal**: when the
spread of the observed ratio exceeds the distance from the observed ratio to the bar, it returns
no ratio at all and names the two numbers that made it refuse. `SpeedVerdict.ratio_for_decision`
is `None` in that case, so a caller cannot accidentally quote one.

FIVE PROPERTIES #53 ASKS FOR, AND WHERE EACH LIVES

  1. warm-up discarded per parser per paper      `measure(..., warm_ups=)`; `Measurement.warm_up`
  2. N trials, median AND spread                 `Interval` — never a bare median
  3. refuse a ratio the spread cannot support    `rule_on_speed`
  4. total corpus wall-clock, not per-paper p50  `Measurement.corpus_wall`, and `basis`
  5. the machine state named in the output       `MachineState`

WHY TOTAL CORPUS WALL-CLOCK IS THE RATIO THAT DECIDES

Both parsers pay a fixed import/model-load cost amortised over 11–75 page papers, which is how
run *order* alone moved the ratio from 10.3× to 18.7×. A per-paper median weights an 11-page
paper equally with a 75-page one and lets that fixed cost dominate the short ones. The corpus
total pays it once per round and divides it over all 195 pages. Both are reported; only the
corpus one feeds the verdict, and `SpeedVerdict.basis` says so in the output.

WHY THE RATIO INTERVAL IS FORMED PESSIMISTICALLY

`corpus_ratio` pairs the slow parser's *slowest* round with the fast parser's *fastest* to get
its upper bound, and the reverse for its lower. That is the widest interval the observations
admit. Pairing trial *i* with trial *i* would be narrower and would make the refusal in (3)
easier to clear — i.e. it would be an aggregation chosen to defeat the guard. The guard is the
point, so the aggregation is chosen against it.

THE BAR

`SPEED_BAR` is **10.0**, on the owner's ruling of 2026-08-02 recorded in #53's first comment,
which drops it from 20×. That ruling states in terms that **the 20× bar's provenance is
documented nowhere** — it appears in `EPIC-01-ingest.md`'s decision rule and in no measurement,
derivation or ADR. Neither number is derived here and this module does not pretend otherwise:
the bar is an input, and `rule_on_speed` takes it as an argument so a caller can rule against
either.
"""

from __future__ import annotations

import os
import platform
import statistics
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from papertree_evaluation.adapters import ParserAdapter

__all__ = [
    "SPEED_BAR",
    "Interval",
    "MachineState",
    "Measurement",
    "PaperRun",
    "SpeedVerdict",
    "Trial",
    "corpus_ratio",
    "measure",
    "no_comparison",
    "per_paper_ratio",
    "rule_on_speed",
]

#: The speed bar the rule is read against. See the module docstring: ruled down from 20× by the
#: owner on 2026-08-02 (#53), and the 20× it replaced has no documented provenance.
SPEED_BAR = 10.0

FETCH_SCRIPT = "./research/benchmarks/fetch_corpus.sh"


@dataclass(frozen=True, slots=True)
class Interval:
    """A measurement reported as a central value AND the range it was drawn from.

    Every number this module reports is one of these. A bare median is what #53 was filed about.
    """

    low: float
    median: float
    high: float

    @classmethod
    def of(cls, values: Sequence[float]) -> Interval:
        ordered = sorted(values)
        return cls(low=ordered[0], median=statistics.median(ordered), high=ordered[-1])

    @property
    def spread(self) -> float:
        return self.high - self.low

    def render(self, unit: str = "", digits: int = 3) -> str:
        return (
            f"{self.median:.{digits}f}{unit} "
            f"(min {self.low:.{digits}f}{unit} – max {self.high:.{digits}f}{unit}, "
            f"spread {self.spread:.{digits}f}{unit})"
        )


@dataclass(frozen=True, slots=True)
class MachineState:
    """What the machine was, and whether anybody *claimed* it was quiet.

    #53: *"run on a quiesced machine and say so in the output"*. The half of that which is easy
    to get wrong is the saying: a report that omits the question reads as if the answer were yes.
    So `quiesce_declared` defaults to **False** and renders as a loud NOT DECLARED, and a
    declaration renders as an operator claim the harness cannot verify — because it cannot.
    """

    platform: str
    python: str
    processor: str
    cpu_count: int
    load_average: tuple[float, float, float]
    quiesce_declared: bool
    quiesce_note: str

    @classmethod
    def observe(cls, *, declared: bool = False, note: str = "") -> MachineState:
        try:
            one, five, fifteen = os.getloadavg()
        except OSError:  # pragma: no cover - getloadavg is unavailable on some platforms
            one = five = fifteen = float("nan")
        return cls(
            platform=platform.platform(),
            python=platform.python_version(),
            processor=platform.processor() or "unknown",
            cpu_count=os.cpu_count() or 0,
            load_average=(one, five, fifteen),
            quiesce_declared=declared,
            quiesce_note=note.strip(),
        )

    @property
    def quiescence(self) -> str:
        if not self.quiesce_declared:
            return (
                "NOT DECLARED QUIESCED — `--quiesced` was not passed, so every number below was "
                "taken on a machine of UNKNOWN load and must be read that way."
            )
        note = f' — "{self.quiesce_note}"' if self.quiesce_note else ""
        return (
            f"DECLARED QUIESCED BY THE OPERATOR{note}. This is an operator claim the harness "
            "cannot verify; the load average above is the only machine-side evidence here."
        )

    def render(self) -> str:
        one, five, fifteen = self.load_average
        return "\n".join(
            [
                "MACHINE STATE",
                f"  platform     : {self.platform}",
                f"  python       : {self.python}",
                f"  processor    : {self.processor}  ({self.cpu_count} logical cpus)",
                f"  load average : {one:.2f} / {five:.2f} / {fifteen:.2f}  (1/5/15 min, at start)",
                f"  quiescence   : {self.quiescence}",
            ]
        )


@dataclass(frozen=True, slots=True)
class PaperRun:
    """One parser over one paper, once.

    `wall_seconds` is measured by THIS module around `adapter.parse`; `adapter_seconds` is what
    the adapter reported for itself. They differ for Docling by a whole interpreter start-up,
    because that adapter shells out to a probe venv. Both are kept so the difference is visible
    rather than assumed away.
    """

    paper: str
    wall_seconds: float
    adapter_seconds: float
    pages: int
    status: str


@dataclass(frozen=True, slots=True)
class Trial:
    """One complete pass over the whole paper set by one parser."""

    index: int
    runs: tuple[PaperRun, ...]
    #: Timed around the entire pass, so per-paper gaps are inside the number the ratio uses.
    corpus_wall_seconds: float

    @property
    def ok(self) -> bool:
        return bool(self.runs) and all(run.status == "ok" for run in self.runs)

    @property
    def pages_total(self) -> int:
        return sum(run.pages for run in self.runs)

    @property
    def adapter_seconds_total(self) -> float:
        return sum(run.adapter_seconds for run in self.runs)

    @property
    def failures(self) -> tuple[str, ...]:
        return tuple(f"{r.paper}:{r.status}" for r in self.runs if r.status != "ok")


@dataclass(frozen=True, slots=True)
class Measurement:
    """Every trial one parser ran, plus the warm-ups that were discarded."""

    adapter: str
    papers: tuple[str, ...]
    #: Run and thrown away — kept only so the report can show what was discarded and why.
    warm_up: tuple[Trial, ...]
    trials: tuple[Trial, ...]

    @property
    def complete(self) -> bool:
        return bool(self.trials) and all(trial.ok for trial in self.trials)

    @property
    def failures(self) -> tuple[str, ...]:
        return tuple(f for trial in self.trials for f in trial.failures)

    def corpus_wall(self) -> Interval:
        """THE number the decision ratio is formed from. Total seconds for the whole paper set."""
        return Interval.of([trial.corpus_wall_seconds for trial in self.trials])

    def seconds_per_page(self, paper: str) -> Interval:
        values = [
            run.wall_seconds / run.pages
            for trial in self.trials
            for run in trial.runs
            if run.paper == paper and run.pages
        ]
        return Interval.of(values) if values else Interval(0.0, 0.0, 0.0)

    def corpus_seconds_per_page(self) -> Interval:
        """Corpus wall-clock divided by the pages in one pass — the amortised figure."""
        pages = self.trials[0].pages_total if self.trials else 0
        if not pages:
            return Interval(0.0, 0.0, 0.0)
        return Interval.of([trial.corpus_wall_seconds / pages for trial in self.trials])

    def per_paper_median_seconds_per_page(self) -> dict[str, float]:
        return {paper: self.seconds_per_page(paper).median for paper in self.papers}

    def render(self) -> str:
        lines = [
            f"{self.adapter}: {len(self.trials)} trials over {len(self.papers)} papers, "
            f"{len(self.warm_up)} warm-up pass(es) DISCARDED"
        ]
        for warm in self.warm_up:
            lines.append(
                f"  warm-up (discarded) : {warm.corpus_wall_seconds:8.2f}s corpus wall-clock"
            )
        for trial in self.trials:
            note = "" if trial.ok else f"   <-- FAILURES: {', '.join(trial.failures)}"
            lines.append(
                f"  trial {trial.index:<14d}: {trial.corpus_wall_seconds:8.2f}s corpus wall-clock, "
                f"{trial.pages_total} pages{note}"
            )
        lines.append(f"  corpus wall-clock   : {self.corpus_wall().render('s', 2)}")
        lines.append(f"  corpus s/page       : {self.corpus_seconds_per_page().render('s', 4)}")
        for paper in self.papers:
            lines.append(f"    {paper:34s}{self.seconds_per_page(paper).render('s/page', 4)}")
        return "\n".join(lines)


def measure(
    adapter: ParserAdapter,
    pdfs: Sequence[Path],
    *,
    trials: int = 3,
    warm_ups: int = 1,
    log: Callable[[str], None] = print,
) -> Measurement:
    """Run `adapter` over `pdfs` `warm_ups + trials` times and keep only the trials.

    The warm-up is per parser per paper by construction: a warm-up pass covers every paper, so
    every (parser, paper) pair has had one discarded run before any counted one. It is not
    cosmetic — measured on this box, Docling's first pass over an 11-page paper took **969 s**
    wall and its second took **85 s**, a 11.4× difference from page cache and dylib loading
    alone. A single-trial harness reports whichever of those it happened to hit.
    """
    if trials < 1:
        raise ValueError(f"trials must be >= 1, got {trials}")
    if warm_ups < 0:
        raise ValueError(f"warm_ups must be >= 0, got {warm_ups}")
    warm = tuple(_pass(adapter, pdfs, -(i + 1), log, discarded=True) for i in range(warm_ups))
    counted = tuple(_pass(adapter, pdfs, i + 1, log, discarded=False) for i in range(trials))
    return Measurement(adapter.name, tuple(p.stem for p in pdfs), warm, counted)


def _pass(
    adapter: ParserAdapter,
    pdfs: Sequence[Path],
    index: int,
    log: Callable[[str], None],
    *,
    discarded: bool,
) -> Trial:
    label = "warm-up (discarded)" if discarded else f"trial {index}"
    runs: list[PaperRun] = []
    started = time.perf_counter()
    for pdf in pdfs:
        at = time.perf_counter()
        outcome = adapter.parse(str(pdf))
        wall = time.perf_counter() - at
        runs.append(PaperRun(pdf.stem, wall, outcome.seconds, outcome.pages, str(outcome.status)))
        log(f"  {adapter.name:26s} {label:20s} {pdf.stem:34s} {wall:8.2f}s  {outcome.status}")
    return Trial(index, tuple(runs), time.perf_counter() - started)


def corpus_ratio(fast: Measurement, slow: Measurement) -> Interval:
    """How many times faster `fast` is than `slow` over total corpus wall-clock.

    Pessimistic on purpose — see the module docstring. The endpoints pair the extremes that
    disagree most, so the spread reported is the widest the observations admit.
    """
    quick, sluggish = fast.corpus_wall(), slow.corpus_wall()
    return Interval(
        low=sluggish.low / quick.high,
        median=sluggish.median / quick.median,
        high=sluggish.high / quick.low,
    )


def per_paper_ratio(fast: Measurement, slow: Measurement) -> float | None:
    """The median over papers of per-paper s/page ratios — REPORTED, never the verdict's basis.

    This is the shape `ComparisonMatrix.speed_ratio` computes and the shape #53 rejects for the
    decision, because a fixed model-load cost amortised over an 11-page paper dominates it.
    """
    mine = fast.per_paper_median_seconds_per_page()
    theirs = slow.per_paper_median_seconds_per_page()
    ratios = [theirs[p] / mine[p] for p in sorted(set(mine) & set(theirs)) if mine[p] > 0]
    return statistics.median(ratios) if ratios else None


Ruling = Literal["MET", "NOT MET", "NOT ESTABLISHED"]


@dataclass(frozen=True, slots=True)
class SpeedVerdict:
    """The rule's speed half, as a verdict that may legitimately be "I cannot tell"."""

    bar: float
    ruling: Ruling
    #: What the ratio was formed from, printed so no reader has to guess.
    basis: str
    observed: Interval | None
    per_paper_median: float | None
    reason: str

    @property
    def ratio_for_decision(self) -> float | None:
        """The ratio a caller may quote — `None` whenever the measurement cannot discriminate.

        This is the refusal in #53, expressed so it cannot be worked around by reading a field.
        """
        if self.ruling == "NOT ESTABLISHED" or self.observed is None:
            return None
        return self.observed.median

    def render(self) -> str:
        head = f"  speed: {self.ruling}   (bar {self.bar:.1f}×, basis: {self.basis})"
        if self.ratio_for_decision is not None and self.observed is not None:
            body = [f"         corpus ratio      : {self.observed.render('×', 2)}"]
        else:
            body = ["         THE HARNESS REFUSES TO EMIT A RATIO."]
            if self.observed is not None:
                body.append(
                    f"         observed interval : {self.observed.render('×', 2)}"
                    "   <-- observed, NOT a verdict; do not quote this as the ratio"
                )
        body.append(f"         {self.reason}")
        if self.per_paper_median is not None:
            body.append(
                f"         per-paper median ratio (reported, not the basis): "
                f"{self.per_paper_median:.2f}×"
            )
        return "\n".join([head, *body])


def rule_on_speed(fast: Measurement, slow: Measurement, *, bar: float = SPEED_BAR) -> SpeedVerdict:
    """Rule on the bar, or refuse to.

    THE REFUSAL, WHICH IS THE POINT OF THIS FUNCTION

        spread   = the width of the observed corpus-ratio interval
        distance = |median observed ratio - bar|
        refuse when spread > distance

    A spread wider than the distance to the bar means the next re-run can land on the other side
    of it, so the ratio decides nothing. Note this is strictly stronger than "the interval
    straddles the bar": if the bar lies inside the interval then `|median - bar| <= spread`
    already, so every straddling interval also refuses, and some non-straddling ones do too.
    """
    incomplete = [m.adapter for m in (fast, slow) if not m.complete]
    if incomplete:
        failures = ", ".join(fast.failures + slow.failures) or "no trials were run"
        return SpeedVerdict(
            bar=bar,
            ruling="NOT ESTABLISHED",
            basis="none — a parser did not complete every trial",
            observed=None,
            per_paper_median=None,
            reason=(
                f"{' and '.join(incomplete)} did not complete every trial over every paper "
                f"({failures}). A ratio over a partial corpus is not the corpus ratio."
            ),
        )

    observed = corpus_ratio(fast, slow)
    per_paper = per_paper_ratio(fast, slow)
    basis = (
        f"total corpus wall-clock over {len(fast.papers)} papers / "
        f"{fast.trials[0].pages_total} pages, {len(fast.trials)} trials"
    )
    distance = abs(observed.median - bar)
    if observed.spread > distance:
        return SpeedVerdict(
            bar=bar,
            ruling="NOT ESTABLISHED",
            basis=basis,
            observed=observed,
            per_paper_median=per_paper,
            reason=(
                f"spread {observed.spread:.2f}× EXCEEDS the distance to the bar "
                f"{distance:.2f}× (bar {bar:.1f}×, observed median {observed.median:.2f}×). "
                "A re-run can land on the other side of the bar, so this number cannot support "
                "the decision it would be used for. Re-run with more trials on a quiesced "
                "machine, or rule on the bar rather than on this measurement."
            ),
        )
    if observed.median >= bar:
        return SpeedVerdict(
            bar=bar,
            ruling="MET",
            basis=basis,
            observed=observed,
            per_paper_median=per_paper,
            reason=(
                f"spread {observed.spread:.2f}× is within the distance to the bar "
                f"{distance:.2f}×, and the whole interval clears {bar:.1f}×."
            ),
        )
    return SpeedVerdict(
        bar=bar,
        ruling="NOT MET",
        basis=basis,
        observed=observed,
        per_paper_median=per_paper,
        reason=(
            f"spread {observed.spread:.2f}× is within the distance to the bar {distance:.2f}×, "
            f"and the whole interval falls short of {bar:.1f}×."
        ),
    )


def no_comparison(reason: str, *, bar: float = SPEED_BAR) -> SpeedVerdict:
    """No comparison arm ran. NOT the same fact as a parser that lost, and reported differently.

    `adapters.py` already draws this line for capability columns — *"`available` is about the
    ENVIRONMENT; a `0` is about the PARSER"*. It matters at least as much for a ratio: an absent
    Docling scored as infinitely slow would report the deterministic path winning on the strength
    of a missing dependency.
    """
    return SpeedVerdict(
        bar=bar,
        ruling="NOT ESTABLISHED",
        basis="none — no comparison arm ran",
        observed=None,
        per_paper_median=None,
        reason=reason,
    )
