"""`python -m papertree_evaluation` — build a gold-annotation bundle, or run the comparison.

    uv run python -m papertree_evaluation annotate --out ~/ptub-gold
    uv run python -m papertree_evaluation compare  --out research/experiment-results
    uv run python -m papertree_evaluation speed    --with-docling --quiesced

The annotate subcommand is the one that matters: `research/benchmarks/README.md` §7 records gold
as *"not started — the critical path item"* and *"No parser selection is authorised until Tier B
gold exists"*, so a human being able to start in one command is the whole point.

`speed` is #53's: warm-up discarded per parser per paper, N trials, median AND spread, total
corpus wall-clock as the basis, the machine state named, and a REFUSAL to emit a ratio when the
spread exceeds the distance to the bar. `compare`'s one-shot ratio is not decision-grade and now
says so where it prints.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from papertree_evaluation.annotate import (
    build_annotator,
    render_pages,
    stratified_pages,
    write_manifest,
)
from papertree_evaluation.speed import SPEED_BAR, SpeedVerdict

REPO = Path(__file__).resolve().parents[4]
DEFAULT_CORPUS = REPO / "research" / "benchmarks" / "corpus"


def _annotate(args: argparse.Namespace) -> int:
    corpus = Path(args.corpus)
    out = Path(args.out)
    pdfs = sorted(corpus.glob("*.pdf"))
    if args.papers:
        pdfs = [p for p in pdfs if p.stem in args.papers]
    if not pdfs:
        print(f"no PDFs in {corpus}", file=sys.stderr)
        return 1

    tasks = []
    for pdf in pdfs:
        from papertree_document_worker.pdf import SourceDocument

        with SourceDocument(pdf) as document:
            page_count = document.page_count
        pages = stratified_pages(page_count, quota=args.pages)
        tasks.extend(render_pages(pdf, pages, out / "images"))
        print(f"  {pdf.stem:32s} {page_count:3d} pages -> sampled {pages}")

    html = build_annotator(tasks, out / "images" / "annotate.html")
    write_manifest(tasks, out / "manifest.json")
    print(f"\n{len(tasks)} pages ready.\n\n  open {html}\n")
    print("Draw a box, pick a type and flow, then 'download gold JSON'.")
    print(f"Save the download as {out / 'gold.json'} and the metrics will pick it up.")
    return 0


DEFAULT_GOLD = REPO / "research" / "benchmarks" / "gold" / "ptub-gold.json"


def _score(args: argparse.Namespace) -> int:
    """Run the deterministic parser over the annotated papers and score it against gold.

    Prints the report TWICE - once on the gold exactly as drawn, once through `normalise.py`.
    The two are not expected to agree, and the gap is the point: it is the only way to see how
    much of the result is the parser and how much is the repair of a tool defect. A single
    normalised number would be a claim the reader has to take on trust.
    """
    import json

    from papertree_evaluation.adapters import DeterministicAdapter, DoclingAdapter
    from papertree_evaluation.normalise import normalise_gold
    from papertree_evaluation.scoring import render_report, sanity_check_overlap, score_paper

    raw = json.loads(Path(args.gold).read_text())
    papers = sorted({page["paper_id"] for page in raw})
    corpus = Path(args.corpus)

    documents: dict[str, dict[str, Any]] = {}
    for paper in papers:
        pdf = corpus / f"{paper}.pdf"
        if not pdf.exists():
            print(f"missing corpus PDF: {pdf}", file=sys.stderr)
            return 1
        outcome = DeterministicAdapter(Path(args.assets)).parse(str(pdf))
        if outcome.status != "ok" or outcome.document is None:
            print(f"{paper}: parser {outcome.status} - {outcome.error}", file=sys.stderr)
            return 1
        documents[paper] = outcome.document
        print(f"  parsed {paper:32s} {outcome.pages:3d} pages  {outcome.seconds:6.2f}s")

    # A coordinate-frame mismatch and a parser that finds nothing both read 0.00 everywhere.
    # Say which one this is BEFORE printing a table of zeroes.
    print()
    for paper in papers:
        pages = [p for p in raw if p["paper_id"] == paper]
        touched, total = sanity_check_overlap(documents[paper], pages)
        share = touched / total if total else 0.0
        note = "" if share > 0.8 else "   <-- CHECK THE COORDINATE FRAME"
        print(f"  geometry overlap {paper:32s} {touched:4d}/{total:<4d} ({share:.0%}){note}")

    normalised = normalise_gold(
        raw,
        region_text=_region_texts(corpus, raw),
        page_rasters=_page_rasters(corpus, raw),
    )

    print("\n" + "=" * 92)
    print("GOLD AS DRAWN (raw)")
    print("=" * 92)
    print(
        render_report(
            [score_paper("papertree-deterministic", p, documents[p], raw) for p in papers]
        )
    )

    print("\n" + "=" * 92)
    print(f"GOLD NORMALISED ({len(normalised.repairs)} repairs)")
    print("=" * 92)
    ours = [
        score_paper("papertree-deterministic", p, documents[p], normalised.pages) for p in papers
    ]
    print(render_report(ours))

    # THE RATIO THE DECISION RULE ASKS FOR, when Docling is available to form it.
    if args.with_docling:
        docling = DoclingAdapter()
        if not docling.available:
            print("\ndocling: NOT RUN - probe venv absent. This is not a score of 0.")
        else:
            print("\n" + "=" * 92)
            print("DOCLING, ON THE SAME NORMALISED GOLD")
            print("=" * 92)
            scored = []
            for paper in papers:
                outcome = docling.parse(str(corpus / f"{paper}.pdf"))
                if outcome.status != "ok" or outcome.document is None:
                    print(f"  {paper}: docling {outcome.status} - {outcome.error}")
                    continue
                print(f"  parsed {paper:32s} {outcome.pages:3d} pages  {outcome.seconds:6.2f}s")
                scored.append(score_paper("docling", paper, outcome.document, normalised.pages))
            if scored:
                print(render_report(scored))
                _decision_rule(
                    {p: s for p, s in zip(papers, ours, strict=False)},
                    {s.paper: s for s in scored},
                )

    print("\nrepairs applied:", normalised.repairs_by_rule() or "none")
    print("warnings       :", normalised.warnings_by_kind() or "none")
    if args.verbose:
        for repair in normalised.repairs:
            print("  ", repair.describe())
        for warning in normalised.warnings:
            print("  ", warning.describe())
    return 0


def _decision_rule(
    ours: dict[str, Any],
    theirs: dict[str, Any],
    speed: SpeedVerdict | None = None,
) -> None:
    """The epic's fixed rule, evaluated: >= 85 % of Docling's F1 at >= the speed bar.

    Printed per paper AND as a mean, because a rule stated over three metrics on three papers has
    no single number in it and inventing one would be choosing an aggregation after seeing the
    results.

    `speed` is a measured verdict or `None`. There is no third option and there is no default
    number: the string this printer used to carry is what #53 was filed about.
    """
    bar = speed.bar if speed is not None else SPEED_BAR
    print("\n" + "-" * 92)
    print(f"DECISION RULE: deterministic >= 85 % of docling's F1, at >= {bar:.0f}x the speed")
    print("-" * 92)
    print(f"  {'paper':32s} {'ours':>7s} {'docling':>8s} {'share':>7s}  {'>=85%?':>7s}")
    shares = []
    for paper, mine in sorted(ours.items()):
        other = theirs.get(paper)
        if other is None:
            print(f"  {paper:32s} {mine.macro_f1:7.3f} {'not run':>8s}")
            continue
        share = mine.macro_f1 / other.macro_f1 if other.macro_f1 else float("inf")
        shares.append(share)
        print(
            f"  {paper:32s} {mine.macro_f1:7.3f} {other.macro_f1:8.3f} {share:6.0%}  "
            f"{'YES' if share >= 0.85 else 'NO':>7s}"
        )
    if shares:
        mean = sum(shares) / len(shares)
        print(
            f"\n  mean share of docling's F1: {mean:.0%}  ->  {'PASS' if mean >= 0.85 else 'FAIL'}"
        )
    # THE SPEED HALF IS NOT A STRING. It used to be one, here:
    #
    #     print("  speed: measured separately at 12x against a 20x bar -> FAIL")
    #
    # printed unconditionally, from no measurement, inside the tool whose job is to produce
    # numbers (#53). `score` cannot supply it either: it times ONE un-warmed run per paper, which
    # is exactly the measurement #53 records as unable to support the decision it was used for.
    if speed is None:
        print(
            "  speed: NOT MEASURED IN THIS RUN. `score` times one un-warmed run per paper and\n"
            "         cannot support the rule's speed half. Measure it with:\n"
            "           python -m papertree_evaluation speed --with-docling --quiesced"
        )
    else:
        print(speed.render())


def _page_rasters(corpus: Path, pages: list[dict[str, Any]]) -> dict[tuple[str, int], int]:
    """How many raster image XObjects each annotated page holds, for `normalise.py`'s rule 4.

    The same contract as `_region_texts`: a fact read off the PDF, handed in by the caller, so
    the normaliser never imports PyMuPDF and never sees a parser's opinion. Zero here is the only
    value that licenses a change - it makes `raster` impossible rather than merely unlikely.
    """
    from papertree_document_worker.pdf import pymupdf

    out: dict[tuple[str, int], int] = {}
    for paper in sorted({str(p["paper_id"]) for p in pages}):
        pdf = corpus / f"{paper}.pdf"
        if not pdf.exists():
            continue
        document = pymupdf.open(str(pdf))
        try:
            for page in [p for p in pages if p["paper_id"] == paper]:
                index = int(page["page"])
                out[(paper, index)] = len(document[index].get_images(full=True))
        finally:
            document.close()
    return out


def _region_texts(corpus: Path, pages: list[dict[str, Any]]) -> dict[tuple[str, int, str], str]:
    """Raw PDF text under each gold box, for `normalise.py`'s caption rule.

    Read straight from the PDF rather than from PaperIR. The normaliser must not see any parser's
    opinion of what is on the page, or the gold it produces is shaped by the very candidate it
    will be used to score - which is the one thing `ANNOTATION_GUIDE.md` §1 forbids.

    PyMuPDF arrives through `papertree_document_worker.pdf`, which is the repo's single import
    site and carries the `Any` boundary alias that keeps mypy strict everywhere else.
    """
    from papertree_document_worker.pdf import pymupdf

    out: dict[tuple[str, int, str], str] = {}
    for paper in sorted({str(p["paper_id"]) for p in pages}):
        pdf = corpus / f"{paper}.pdf"
        if not pdf.exists():
            continue
        document = pymupdf.open(str(pdf))
        try:
            for page in [p for p in pages if p["paper_id"] == paper]:
                index = int(page["page"])
                rendered = document[index]
                for region in page["regions"]:
                    clip = pymupdf.Rect(*region["bbox"])
                    text: str = rendered.get_text("text", clip=clip).strip()
                    out[(paper, index, str(region["gold_id"]))] = text
        finally:
            document.close()
    return out


def _compare(args: argparse.Namespace) -> int:
    from papertree_evaluation.harness import render_matrix, run_comparison, write_results

    out = Path(args.out)
    matrix = run_comparison(Path(args.corpus), out / "assets")
    for paper in sorted({o.paper for o in matrix.outcomes}):
        print(render_matrix(matrix, paper))
    ratio = matrix.speed_ratio("papertree-deterministic", "docling")
    if ratio:
        # SINGLE TRIAL, NO WARM-UP, NO SPREAD. Said here rather than in a docstring nobody
        # reads at a terminal, because this line is where the 12.4x / 16.8x / 18.7x in #53
        # came from and it is not decision-grade.
        print(f"\nspeed ratio vs docling: {ratio:.1f}x  (ONE un-warmed run per paper, no spread)")
        print("  NOT the decision rule's ratio. Use `python -m papertree_evaluation speed`.")
    else:
        print("\ndocling did not run")
    write_results(matrix, out / "ptub-results.jsonl")
    return 0


def _speed(args: argparse.Namespace) -> int:
    """#53's harness: warm-up discarded, N trials, spread reported, and a refusal when it must."""
    from papertree_evaluation.adapters import DeterministicAdapter, DoclingAdapter
    from papertree_evaluation.speed import (
        FETCH_SCRIPT,
        MachineState,
        measure,
        no_comparison,
        rule_on_speed,
    )

    corpus = Path(args.corpus)
    pdfs = sorted(corpus.glob("*.pdf"))
    if args.papers:
        pdfs = [p for p in pdfs if p.stem in args.papers]
    if not pdfs:
        print(f"no PDFs in {corpus}. Fetch the corpus with `{FETCH_SCRIPT}`.", file=sys.stderr)
        return 1

    machine = MachineState.observe(declared=args.quiesced, note=args.quiesce_note or "")
    print(machine.render())
    print(f"\npapers: {', '.join(p.stem for p in pdfs)}\n")

    fast = measure(
        DeterministicAdapter(Path(args.assets)),
        pdfs,
        trials=args.trials,
        warm_ups=args.warmups,
    )
    print("\n" + fast.render())

    if not args.with_docling:
        verdict = no_comparison(
            "docling was not requested (`--with-docling` absent), so no ratio exists to rule on. "
            "The deterministic timings above stand on their own.",
            bar=args.bar,
        )
    else:
        docling = DoclingAdapter()
        if not docling.available:
            verdict = no_comparison(
                f"no docling interpreter at {docling.python}; the probe venv is opt-in and "
                "lives outside this workspace's lock (set $PAPERTREE_DOCLING_PYTHON). An "
                "absent comparison arm is NOT a score, and is not a ratio either.",
                bar=args.bar,
            )
        else:
            slow = measure(docling, pdfs, trials=args.trials, warm_ups=args.warmups)
            print("\n" + slow.render())
            verdict = rule_on_speed(fast, slow, bar=args.bar)

    print("\n" + "-" * 92)
    print(f"DECISION RULE, SPEED HALF: deterministic >= {args.bar:.0f}x docling")
    print("-" * 92)
    print(verdict.render())
    print(f"\n  {machine.quiescence}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="papertree_evaluation")
    sub = parser.add_subparsers(dest="command", required=True)

    ann = sub.add_parser("annotate", help="build a gold-annotation bundle")
    ann.add_argument("--corpus", default=str(DEFAULT_CORPUS))
    ann.add_argument("--out", required=True, help="output directory (keep it OUTSIDE the repo)")
    ann.add_argument("--pages", type=int, default=10, help="pages per paper (README §1.2: 10)")
    ann.add_argument("--papers", nargs="*", help="paper stems; default all")
    ann.set_defaults(func=_annotate)

    sco = sub.add_parser("score", help="score the deterministic parser against gold")
    sco.add_argument("--corpus", default=str(DEFAULT_CORPUS))
    sco.add_argument("--gold", default=str(DEFAULT_GOLD))
    sco.add_argument("--assets", default="/tmp/ptub-assets", help="where figure crops go")
    sco.add_argument("--verbose", action="store_true", help="list every repair and warning")
    sco.add_argument(
        "--with-docling",
        action="store_true",
        help="also score docling and form the decision rule's ratio (slow: ~5 s/page)",
    )
    sco.set_defaults(func=_score)

    cmp_ = sub.add_parser("compare", help="run every adapter and emit the matrix")
    cmp_.add_argument("--corpus", default=str(DEFAULT_CORPUS))
    cmp_.add_argument("--out", required=True)
    cmp_.set_defaults(func=_compare)

    spd = sub.add_parser("speed", help="#53's speed harness: warm-up, N trials, spread, refusal")
    spd.add_argument("--corpus", default=str(DEFAULT_CORPUS))
    spd.add_argument("--assets", default="/tmp/ptub-assets", help="where figure crops go")
    spd.add_argument("--papers", nargs="*", help="paper stems; default all")
    spd.add_argument("--trials", type=int, default=3, help="counted passes per parser")
    spd.add_argument("--warmups", type=int, default=1, help="discarded passes per parser")
    spd.add_argument(
        "--bar", type=float, default=SPEED_BAR, help="the ratio bar to rule against (#53: 10x)"
    )
    spd.add_argument(
        "--quiesced",
        action="store_true",
        help="declare the machine quiesced. UNSET BY DEFAULT and printed either way: the harness "
        "cannot verify this and will not imply it.",
    )
    spd.add_argument("--quiesce-note", help="what you did to quiesce it, printed verbatim")
    spd.add_argument(
        "--with-docling",
        action="store_true",
        help="also time docling and form the ratio (slow: the probe venv measured ~7.8 s/page)",
    )
    spd.set_defaults(func=_speed)

    args = parser.parse_args(argv)
    result: int = args.func(args)
    return result


if __name__ == "__main__":
    sys.exit(main())
