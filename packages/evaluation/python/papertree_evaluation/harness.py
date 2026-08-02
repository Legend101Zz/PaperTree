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

THE FOURTH ROW IS HISTORICAL, AND IT SAYS SO ON EVERY LINE IT PRINTS

`EPIC-01-ingest.md`'s `eval/ptub.spec` asks for four adapters - deterministic, Docling,
PyMuPDF-raw and current-PaperTree - and the SAME FILE's "Must delete" section orders the
current-PaperTree extractor removed. Both were followed: the extractor is deleted (commit
`078d208`, `EPIC-01-RESULT.md` §5) and the fourth adapter therefore has nothing to call. That is
a contradiction in the brief rather than an omission in the work, and it left an acceptance test
permanently PARTIAL for a reason no parser change could fix.

Ruled 2026-08-03 (issue #55): the criterion is AMENDED to three live adapters plus a declared
historical column, and the historical column is carried HERE as data with its provenance rather
than left as prose in a result document nothing executes. `HISTORICAL_ROWS` is
`findings.md` H2's measurement of the two deleted extractors, on the two papers H2 covers.

The alternative - vendoring the deleted extractor into `research/benchmarks/baselines/` and
restoring a live fourth adapter - was rejected on two measured grounds. It is v1 code
(`archive/README.md`: "Do not read it. Do not import from it."), and `research/` appears in
none of the allow-lists that drive uv, pytest, ruff and mypy (`pyproject.toml`: members
`packages/*/python`, `services/*/python`; `testpaths = ["packages", "services"]`), so 1,698
lines of it would sit in the tree unlinted, untyped and untested while a linted package imported
them.

`HISTORICAL_ROWS` IS NOT IN `ComparisonMatrix.outcomes` AND MUST NEVER BE. `speed_ratio` and
`operational` compute over `outcomes`; a historical number leaking into either would put a
2026-06 measurement of deleted code into a ratio presented as this run's. `render_matrix`
appends them to the printed table only, labelled and dated, and a test asserts the separation.
"""

from __future__ import annotations

import json
import platform
import statistics
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from papertree_evaluation.adapters import AdapterOutcome, ParserAdapter, all_adapters

__all__ = [
    "HISTORICAL_ROWS",
    "ComparisonMatrix",
    "HistoricalRow",
    "historical_rows_for",
    "render_matrix",
    "run_comparison",
]

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


@dataclass(frozen=True, slots=True)
class HistoricalRow:
    """A capability row measured before the code that produced it was deleted.

    Deliberately NOT an `AdapterOutcome`. The two are structurally similar and mixing them is
    exactly the mistake this type exists to make impossible: an `AdapterOutcome` goes into
    `ComparisonMatrix.outcomes`, and everything in `outcomes` is treated as a measurement of THIS
    run on THIS machine by `speed_ratio`, `operational` and `write_results`.
    """

    adapter: str
    paper: str
    #: `None` where H2 did not record the column. Absent, not zero - a zero is a claim.
    counts: dict[str, int | None]
    pages: int
    seconds_total: float
    #: Where the numbers came from and when, printed with every row.
    source: str

    @property
    def seconds_per_page(self) -> float:
        return self.seconds_total / self.pages if self.pages else 0.0


#: `findings.md` §H2's measurement of the two PaperTree extractors that Epic 1 deleted, on the
#: two corpus papers H2 covers. Page counts re-derived from the corpus PDFs 2026-08-03
#: (`resnet-cvpr-2col` 12, `attention-is-all-you-need` 15), which is what turns H2's TOTAL
#: seconds into a per-page figure.
#:
#: H2's `sec` column is a TOTAL, and `EPIC-01-RESULT.md` §1 transcribed it into an `s/page`
#: column for the dead-extractor row without dividing: it prints **4.1** where the arithmetic is
#: 4.1 s / 12 pp = **0.34**. Corrected here and in that file, which is why the total is stored
#: and the rate is derived rather than the other way round.
HISTORICAL_ROWS: tuple[HistoricalRow, ...] = (
    HistoricalRow(
        adapter="papertree-v1-live (DELETED)",
        paper="resnet-cvpr-2col",
        counts={c: 0 for c in COLUMNS} | {"sections": None},
        pages=12,
        seconds_total=2.0,
        source="findings.md H2, 2026-06, code deleted in 078d208",
    ),
    HistoricalRow(
        adapter="papertree-v1-extractor (DELETED)",
        paper="resnet-cvpr-2col",
        counts={
            "blocks": 233,
            "with_bbox": 233,
            "with_page": 233,
            "with_stable_id": 0,
            "headings": 58,
            "equations": 86,
            "equations_with_latex": 26,
            "figures": 0,
            "captions_linked": 0,
            "tables": 0,
            "table_cells": 0,
            "sections": None,
        },
        pages=12,
        seconds_total=4.1,
        source="findings.md H2, 2026-06, code deleted in 078d208",
    ),
    HistoricalRow(
        adapter="papertree-v1-live (DELETED)",
        paper="attention-is-all-you-need",
        counts={c: 0 for c in COLUMNS} | {"sections": None},
        pages=15,
        seconds_total=0.8,
        source="findings.md H2, 2026-06, code deleted in 078d208",
    ),
    HistoricalRow(
        adapter="papertree-v1-extractor (DELETED)",
        paper="attention-is-all-you-need",
        counts={
            "blocks": 181,
            "with_bbox": 181,
            "with_page": 181,
            "with_stable_id": 0,
            "headings": 42,
            "equations": 60,
            "equations_with_latex": 12,
            "figures": 3,
            "captions_linked": 1,
            "tables": 0,
            "table_cells": 0,
            "sections": None,
        },
        pages=15,
        seconds_total=3.7,
        source="findings.md H2, 2026-06, code deleted in 078d208",
    ),
)


def historical_rows_for(paper: str) -> tuple[HistoricalRow, ...]:
    """H2's rows for one paper, or empty for the six papers H2 never covered."""
    return tuple(row for row in HISTORICAL_ROWS if row.paper == paper)


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
    """One paper's capability table, in findings.md H2's column order.

    The live adapters first, then any HISTORICAL row for the paper, each carrying `(DELETED)` in
    its name and its provenance in a footnote. Four rows where H2 measured four; three where it
    measured none, which is the honest count for the six papers it never covered.
    """
    runs = [o for o in matrix.for_paper(paper) if o.status == "ok"]
    historical = historical_rows_for(paper)
    if not runs and not historical:
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
    # `?` rather than `0` for a column H2 never recorded. §3's "cannot express it scores 0, not
    # N/A" is about a PARSER that ran and could not represent something; nothing ran here.
    rows += [
        "| "
        + row.adapter
        + " | "
        + " | ".join(
            "?" if row.counts.get(column) is None else str(row.counts[column]) for column in COLUMNS
        )
        + f" | {row.seconds_per_page:.2f} |"
        for row in historical
    ]
    footnotes = [
        f"_{row.adapter}: {row.source}; {row.seconds_total:g} s over {row.pages} pp. "
        "Not run in this comparison and excluded from every ratio it reports._"
        for row in historical
    ]
    return "\n".join([f"### {paper}", "", header, divider, *rows, "", *footnotes, ""])


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
