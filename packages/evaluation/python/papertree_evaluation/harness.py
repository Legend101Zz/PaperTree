"""`eval/ptub.spec`: run every adapter over the corpus and emit the comparison matrix.

WHAT THIS CAN AND CANNOT DECIDE, STATED BEFORE THE CODE

The epic's decision rule is: *"if deterministic reaches ≥85 % of Docling's F1 on element
detection, reading order and figure recall at ≥20× the speed, zero-ML ships as default."*

Its two halves are not equally available:

  **Speed** — measurable now, needs no gold, and is measured here.
  **F1**    — needs Tier B gold annotations, which `benchmarks/README.md` §7 records as
              *"not started — the critical path item; ~60 expert-hours"*, and §7 closes with
              *"No parser selection is authorised until Tier B gold exists."*

So this harness reports **capability and cost**, exactly as findings.md H2 did, and does NOT
compute F1 or claim the decision. `metrics.py` implements the gold-based metrics so they run
the day gold exists; until then the honest output is a matrix plus an explicit statement that
the accuracy half was not evaluable.

Producing an F1 here by annotating the corpus with this parser's own output, or by treating
Docling as gold, would be the "tune the benchmark to produce the preferred answer" failure the
epic names and forbids in advance.
"""

from __future__ import annotations

import json
import platform
import statistics
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from papertree_evaluation.adapters import AdapterOutcome, ParserAdapter, all_adapters

__all__ = ["ComparisonMatrix", "run_comparison", "render_matrix"]

#: The capability columns, in the order findings.md H2 prints them, so the two are readable
#: side by side without re-deriving which column is which.
COLUMNS = (
    "blocks",
    "with_bbox",
    "with_page",
    "with_stable_id",
    "headings",
    "equations",
    "equations_with_latex",
    "figures",
    "captions_linked",
    "tables",
    "table_cells",
    "sections",
)


@dataclass(slots=True)
class ComparisonMatrix:
    outcomes: list[AdapterOutcome] = field(default_factory=list)
    machine: dict[str, str] = field(default_factory=dict)

    def for_paper(self, paper: str) -> list[AdapterOutcome]:
        return [o for o in self.outcomes if o.paper == paper]

    def speed_ratio(self, fast: str, slow: str) -> float | None:
        """How many times faster `fast` is than `slow`, over papers BOTH parsed.

        `None` when they share no successful paper - which is the honest answer, and is what a
        missing Docling produces. Returning a number there would compare against nothing.
        """
        pairs = []
        for paper in {o.paper for o in self.outcomes}:
            runs = {o.adapter: o for o in self.for_paper(paper) if o.status == "ok"}
            if fast in runs and slow in runs and runs[fast].seconds_per_page > 0:
                pairs.append(runs[slow].seconds_per_page / runs[fast].seconds_per_page)
        return statistics.median(pairs) if pairs else None

    def operational(self, adapter: str) -> dict[str, float]:
        """§4.5's operational metrics. Reported next to accuracy, always."""
        runs = [o for o in self.outcomes if o.adapter == adapter]
        ok = [o for o in runs if o.status == "ok"]
        per_page = sorted(o.seconds_per_page for o in ok if o.pages)
        total = len(runs) or 1
        return {
            "papers": len(runs),
            "ok": len(ok),
            "crashed": sum(1 for o in runs if o.status == "crashed"),
            "timeout": sum(1 for o in runs if o.status == "timeout"),
            "unavailable": sum(1 for o in runs if o.status == "unavailable"),
            "empty": sum(1 for o in runs if o.is_empty),
            "p50_s_per_page": per_page[len(per_page) // 2] if per_page else 0.0,
            "p95_s_per_page": per_page[int(len(per_page) * 0.95)] if per_page else 0.0,
            # §4.5: disqualified if crash+timeout+empty > 5 %, regardless of accuracy.
            "failure_rate": sum(1 for o in runs if o.status in ("crashed", "timeout") or o.is_empty)
            / total,
        }


def run_comparison(
    corpus: Path,
    asset_root: Path,
    *,
    adapters: list[ParserAdapter] | None = None,
    papers: list[str] | None = None,
) -> ComparisonMatrix:
    """Run every adapter over every corpus paper."""
    chosen = adapters if adapters is not None else all_adapters(asset_root)
    pdfs = sorted(corpus.glob("*.pdf"))
    if papers:
        pdfs = [p for p in pdfs if p.stem in papers]

    matrix = ComparisonMatrix(
        machine={
            "platform": platform.platform(),
            "python": platform.python_version(),
            "processor": platform.processor() or "unknown",
        }
    )
    for adapter in chosen:
        for pdf in pdfs:
            if not adapter.available:
                matrix.outcomes.append(
                    AdapterOutcome(
                        adapter.name, pdf.stem, "unavailable", error="adapter not installed"
                    )
                )
                continue
            matrix.outcomes.append(adapter.parse(str(pdf)))
    return matrix


def render_matrix(matrix: ComparisonMatrix, paper: str) -> str:
    """One paper's capability table, in findings.md H2's column order."""
    runs = [o for o in matrix.for_paper(paper) if o.status == "ok"]
    if not runs:
        return f"### {paper}\n\n_no adapter produced output_\n"

    header = "| Candidate | " + " | ".join(COLUMNS) + " | s/page |"
    divider = "|---" * (len(COLUMNS) + 2) + "|"
    rows = [
        "| "
        + o.adapter
        + " | "
        + " | ".join(str(o.counts.get(column, 0)) for column in COLUMNS)
        + f" | {o.seconds_per_page:.2f} |"
        for o in sorted(runs, key=lambda o: o.adapter)
    ]
    return "\n".join([f"### {paper}", "", header, divider, *rows, ""])


def write_results(matrix: ComparisonMatrix, destination: Path) -> None:
    """Append one JSONL record per outcome, per §5.2.

    The DOCUMENT is dropped - it is the parse output, not a result - and only counts, timings
    and status are kept, so the file stays readable and diffable across runs.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("a", encoding="utf-8") as handle:
        for outcome in matrix.outcomes:
            record: dict[str, Any] = asdict(outcome)
            record.pop("document", None)
            record["machine"] = matrix.machine
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
