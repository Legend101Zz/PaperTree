"""
PTUB row 1/2/3/5: measure what each candidate parser actually preserves.

This does NOT measure accuracy (that needs Tier B gold annotations). It measures
CAPABILITY — which of PaperTree's hard requirements each parser can even express.
A parser that cannot emit a bbox scores 0 on geometry, not N/A.

Usage: .audit/venv/bin/python research/benchmarks/harness/compare_parsers.py <pdf>...
"""
import json, os, sys, time, traceback
from collections import Counter

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "apps", "api"))
import fitz


def cap(**kw):
    """Capability record with PaperTree's hard requirements as the columns."""
    base = dict(blocks=0, with_bbox=0, with_page=0, with_stable_id=0, headings=0,
                sections_nested=False, equations=0, equations_with_latex=0,
                figures=0, figures_vector=0, captions_linked=0, tables=0,
                table_cells=0, refs=0, reading_order=False, confidence=False,
                seconds=0.0, error=None)
    base.update(kw)
    return base


# ---------- Row 1: PaperTree LIVE (routes.extract_text_from_pdf) ----------
def run_papertree_live(pdf):
    t0 = time.time()
    doc = fitz.open(pdf)
    parts = []
    for page in doc:
        t = page.get_text("text", sort=True)
        if t:
            parts.append(f"[Page {page.number + 1}]\n{t}")
    doc.close()
    text = "\n\n".join(parts)
    # A flat string. It has literally none of the required properties.
    return cap(blocks=0, seconds=time.time() - t0,
               error=None, reading_order=False,
               **{"_note": f"flat string, {len(text)} chars, no addressable objects"})


# ---------- Row 2: PaperTree DEAD structured extractor ----------
def run_papertree_dead(pdf):
    from papertree_api.papers import extraction as EX
    t0 = time.time()
    r = EX.extract_pdf_content(pdf, "bench")
    b = r.blocks
    figs = [x for x in b if x["type"] == "figure"]
    eqs = [x for x in b if x["type"] == "math"]
    return cap(
        blocks=len(b),
        with_bbox=sum(1 for x in b if x.get("source", {}).get("bbox")),
        with_page=sum(1 for x in b if x.get("source", {}).get("page") is not None),
        with_stable_id=0,  # uuid4 per run -> NOT stable across re-parse
        headings=sum(1 for x in b if x["type"] == "heading"),
        sections_nested=False,  # flat list, no parent/child links
        equations=len(eqs),
        equations_with_latex=sum(1 for x in eqs if x.get("latex")),
        figures=len(figs), figures_vector=0,
        captions_linked=sum(1 for x in figs if x.get("caption")),
        tables=0, table_cells=0, refs=0,
        reading_order=True,  # implicit list order (measured broken elsewhere)
        confidence=False,
        seconds=time.time() - t0,
    )


# ---------- Row 3: PyMuPDF raw ----------
def run_pymupdf_raw(pdf):
    t0 = time.time()
    doc = fitz.open(pdf)
    n = 0
    for page in doc:
        n += len([b for b in page.get_text("dict")["blocks"] if b["type"] == 0])
    toc = len(doc.get_toc() or [])
    doc.close()
    return cap(blocks=n, with_bbox=n, with_page=n, with_stable_id=0,
               headings=toc, sections_nested=bool(toc),
               reading_order=True, seconds=time.time() - t0,
               **{"_note": "geometry present, semantics absent; TOC only if embedded"})


# ---------- Row 5: Docling ----------
def run_docling(pdf):
    from docling.document_converter import DocumentConverter
    t0 = time.time()
    conv = DocumentConverter()
    res = conv.convert(pdf)
    d = res.document
    dt = time.time() - t0

    texts = list(getattr(d, "texts", []) or [])
    pics = list(getattr(d, "pictures", []) or [])
    tabs = list(getattr(d, "tables", []) or [])

    def has_prov(it):
        p = getattr(it, "prov", None)
        return bool(p) and getattr(p[0], "bbox", None) is not None

    labels = Counter(str(getattr(t, "label", "?")) for t in texts)
    heads = sum(v for k, v in labels.items() if "section_header" in k or "title" in k)
    eqs = sum(v for k, v in labels.items() if "formula" in k)
    caps = sum(v for k, v in labels.items() if "caption" in k)

    ncells = 0
    for tb in tabs:
        dta = getattr(tb, "data", None)
        cells = getattr(dta, "table_cells", None) if dta else None
        if cells:
            ncells += len(cells)

    linked_caps = 0
    for p in pics + tabs:
        try:
            if getattr(p, "captions", None):
                linked_caps += 1
        except Exception:
            pass

    allitems = texts + pics + tabs
    return cap(
        blocks=len(allitems),
        with_bbox=sum(1 for it in allitems if has_prov(it)),
        with_page=sum(1 for it in allitems
                      if getattr(it, "prov", None) and getattr(it.prov[0], "page_no", None) is not None),
        with_stable_id=len(allitems),   # self_ref JSON-pointer, stable within a parse
        headings=heads,
        sections_nested=True,           # DoclingDocument keeps a body tree with children
        equations=eqs,
        equations_with_latex=sum(1 for t in texts
                                 if "formula" in str(getattr(t, "label", ""))
                                 and (getattr(t, "text", "") or "").strip()),
        figures=len(pics),
        figures_vector=-1,              # not distinguishable from the API
        captions_linked=linked_caps,
        tables=len(tabs), table_cells=ncells,
        refs=sum(v for k, v in labels.items() if "reference" in k or "footnote" in k),
        reading_order=True, confidence=False,
        seconds=dt,
        **{"_labels": dict(labels)},
    )


ROWS = [
    ("1. PaperTree LIVE (routes.py:25)", run_papertree_live),
    ("2. PaperTree DEAD (extraction.py)", run_papertree_dead),
    ("3. PyMuPDF raw", run_pymupdf_raw),
    ("5. Docling", run_docling),
]

COLS = [("blocks", "blocks"), ("with_bbox", "bbox"), ("with_page", "page"),
        ("with_stable_id", "id"), ("headings", "head"), ("equations", "eq"),
        ("equations_with_latex", "eq+tex"), ("figures", "fig"),
        ("captions_linked", "cap→"), ("tables", "tbl"), ("table_cells", "cells"),
        ("seconds", "sec")]


def main():
    out = {}
    for pdf in sys.argv[1:]:
        name = os.path.basename(pdf)
        print(f"\n{'='*104}\n{name}\n{'='*104}")
        hdr = f"{'candidate':<36}" + "".join(f"{lbl:>8}" for _, lbl in COLS)
        print(hdr); print("-" * len(hdr))
        out[name] = {}
        for label, fn in ROWS:
            try:
                r = fn(pdf)
            except Exception as e:
                r = cap(error=f"{type(e).__name__}: {e}")
                traceback.print_exc(limit=1)
            out[name][label] = r
            cells = "".join(
                f"{(round(r[k],1) if k=='seconds' else r[k]):>8}" if r.get("error") is None else f"{'ERR':>8}"
                for k, _ in COLS)
            print(f"{label:<36}{cells}")
            if r.get("_note"):
                print(f"{'':<36}  ↳ {r['_note']}")
            if r.get("error"):
                print(f"{'':<36}  ↳ {r['error']}")
        # nested-hierarchy column reported separately (boolean)
        print(f"\n{'':<36}nested section tree: " + ", ".join(
            f"{lbl.split('.')[0]}={out[name][lbl]['sections_nested']}" for lbl, _ in ROWS))

    dest = os.path.join(REPO, "research", "experiment-results", "ptub-capability-matrix.json")
    with open(dest, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\nwrote {dest}")


if __name__ == "__main__":
    main()
