"""`python -m papertree_evaluation` — build a gold-annotation bundle, or run the comparison.

    uv run python -m papertree_evaluation annotate --out ~/ptub-gold
    uv run python -m papertree_evaluation compare  --out research/experiment-results

The annotate subcommand is the one that matters: `research/benchmarks/README.md` §7 records gold
as *"not started — the critical path item"* and *"No parser selection is authorised until Tier B
gold exists"*, so a human being able to start in one command is the whole point.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from papertree_evaluation.annotate import (
    build_annotator,
    render_pages,
    stratified_pages,
    write_manifest,
)

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


def _compare(args: argparse.Namespace) -> int:
    from papertree_evaluation.harness import render_matrix, run_comparison, write_results

    out = Path(args.out)
    matrix = run_comparison(Path(args.corpus), out / "assets")
    for paper in sorted({o.paper for o in matrix.outcomes}):
        print(render_matrix(matrix, paper))
    ratio = matrix.speed_ratio("papertree-deterministic", "docling")
    print(f"\nspeed ratio vs docling: {ratio:.1f}x" if ratio else "\ndocling did not run")
    write_results(matrix, out / "ptub-results.jsonl")
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

    cmp_ = sub.add_parser("compare", help="run every adapter and emit the matrix")
    cmp_.add_argument("--corpus", default=str(DEFAULT_CORPUS))
    cmp_.add_argument("--out", required=True)
    cmp_.set_defaults(func=_compare)

    args = parser.parse_args(argv)
    result: int = args.func(args)
    return result


if __name__ == "__main__":
    sys.exit(main())
