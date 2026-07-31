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


DEFAULT_GOLD = REPO / "research" / "benchmarks" / "gold" / "ptub-gold.json"


def _score(args: argparse.Namespace) -> int:
    """Run the deterministic parser over the annotated papers and score it against gold.

    Prints the report TWICE - once on the gold exactly as drawn, once through `normalise.py`.
    The two are not expected to agree, and the gap is the point: it is the only way to see how
    much of the result is the parser and how much is the repair of a tool defect. A single
    normalised number would be a claim the reader has to take on trust.
    """
    import json

    from papertree_evaluation.adapters import DeterministicAdapter
    from papertree_evaluation.normalise import normalise_gold
    from papertree_evaluation.scoring import render_report, sanity_check_overlap, score_paper

    raw = json.loads(Path(args.gold).read_text())
    papers = sorted({page["paper_id"] for page in raw})
    corpus = Path(args.corpus)

    documents: dict[str, dict[str, object]] = {}
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

    normalised = normalise_gold(raw, region_text=_region_texts(corpus, raw))

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
    print(
        render_report(
            [
                score_paper("papertree-deterministic", p, documents[p], normalised.pages)
                for p in papers
            ]
        )
    )

    print("\nrepairs applied:", normalised.repairs_by_rule() or "none")
    print("warnings       :", normalised.warnings_by_kind() or "none")
    if args.verbose:
        for repair in normalised.repairs:
            print("  ", repair.describe())
        for warning in normalised.warnings:
            print("  ", warning.describe())
    return 0


def _region_texts(corpus: Path, pages: list[dict[str, object]]) -> dict[tuple[str, int, str], str]:
    """Raw PDF text under each gold box, for `normalise.py`'s caption rule.

    Read straight from the PDF rather than from PaperIR: the normaliser must not see any
    parser's opinion of what is on the page, or the gold it produces is shaped by the candidate
    it will be used to score.
    """
    import pymupdf

    out: dict[tuple[str, int, str], str] = {}
    for paper in sorted({str(p["paper_id"]) for p in pages}):
        pdf = corpus / f"{paper}.pdf"
        if not pdf.exists():
            continue
        with pymupdf.open(pdf) as document:
            for page in [p for p in pages if p["paper_id"] == paper]:
                rendered = document[int(page["page"])]  # type: ignore[index]
                for region in page["regions"]:  # type: ignore[index]
                    clip = pymupdf.Rect(*region["bbox"])
                    key = (paper, int(page["page"]), str(region["gold_id"]))  # type: ignore[index]
                    out[key] = rendered.get_text("text", clip=clip).strip()
    return out


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

    sco = sub.add_parser("score", help="score the deterministic parser against gold")
    sco.add_argument("--corpus", default=str(DEFAULT_CORPUS))
    sco.add_argument("--gold", default=str(DEFAULT_GOLD))
    sco.add_argument("--assets", default="/tmp/ptub-assets", help="where figure crops go")
    sco.add_argument("--verbose", action="store_true", help="list every repair and warning")
    sco.set_defaults(func=_score)

    cmp_ = sub.add_parser("compare", help="run every adapter and emit the matrix")
    cmp_.add_argument("--corpus", default=str(DEFAULT_CORPUS))
    cmp_.add_argument("--out", required=True)
    cmp_.set_defaults(func=_compare)

    args = parser.parse_args(argv)
    result: int = args.func(args)
    return result


if __name__ == "__main__":
    sys.exit(main())
