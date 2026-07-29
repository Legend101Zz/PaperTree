"""
Empirical probe of PaperTree's CURRENT extraction code.

Imports the real modules from apps/api and measures the specific failure modes
suspected during the code audit. Writes JSON + a markdown summary.

Usage: .audit/venv/bin/python .audit/probe_extractor.py <pdf> [<pdf> ...]
"""
import json
import os
import sys
import time
from collections import Counter, defaultdict

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "apps", "api"))

import fitz  # noqa: E402
from papertree_api.papers import extraction as EX  # noqa: E402
from papertree_api.papers import services as SV  # noqa: E402


def font_census(path):
    """What fonts does this PDF actually use, and how do the two MATH_FONTS sets judge them?"""
    doc = fitz.open(path)
    fonts = Counter()
    for page in doc:
        for blk in page.get_text("dict")["blocks"]:
            if blk["type"] != 0:
                continue
            for line in blk.get("lines", []):
                for span in line.get("spans", []):
                    fonts[span.get("font", "")] += len(span.get("text", ""))
    doc.close()
    total = sum(fonts.values()) or 1
    rows = []
    for f, chars in fonts.most_common():
        rows.append({
            "font": f,
            "chars": chars,
            "pct_of_doc": round(100 * chars / total, 2),
            "is_math_font__extraction_py": EX.is_math_font(f),
            "is_math_font__services_py": SV.is_math_font(f),
        })
    mislabeled = sum(r["chars"] for r in rows if r["is_math_font__extraction_py"])
    return {
        "fonts": rows,
        "total_chars": total,
        "pct_chars_in_fonts_extraction_py_calls_math": round(100 * mislabeled / total, 2),
    }


def column_probe(path):
    """Detect 2-column layout and whether PyMuPDF sort=True interleaves columns."""
    doc = fitz.open(path)
    out = []
    for pno in range(min(len(doc), 6)):
        page = doc[pno]
        pw = page.rect.width
        blocks = [b for b in page.get_text("dict", sort=True)["blocks"] if b["type"] == 0]
        # classify each block as left / right / full width
        sides = []
        for b in blocks:
            x0, _, x1, _ = b["bbox"]
            if x1 < pw * 0.55:
                sides.append("L")
            elif x0 > pw * 0.45:
                sides.append("R")
            else:
                sides.append("F")
        # count L->R->L alternations: evidence sort=True is interleaving columns
        seq = [s for s in sides if s in ("L", "R")]
        alternations = sum(1 for i in range(1, len(seq)) if seq[i] != seq[i - 1])
        two_col = sides.count("L") >= 3 and sides.count("R") >= 3
        out.append({
            "page": pno,
            "n_text_blocks": len(blocks),
            "sides": "".join(sides),
            "looks_two_column": two_col,
            "column_alternations_in_sort_order": alternations,
        })
    doc.close()
    return out


def vector_figure_probe(path):
    """How many figures are vector drawings (invisible to page.get_images)?"""
    doc = fitz.open(path)
    per_page = []
    for pno in range(len(doc)):
        page = doc[pno]
        rasters = len([r for r in page.get_images(full=True)])
        try:
            drawings = page.get_drawings()
        except Exception:
            drawings = []
        # crude: cluster drawing rects; count "significant" vector ink
        big = [d for d in drawings if (d["rect"].width > 40 and d["rect"].height > 40)]
        per_page.append({
            "page": pno,
            "embedded_raster_images": rasters,
            "vector_draw_ops": len(drawings),
            "significant_vector_ops": len(big),
        })
    doc.close()
    return per_page


def run_current_extractor(path, paper_id="probe"):
    t0 = time.time()
    res = EX.extract_pdf_content(path, paper_id)
    dt = time.time() - t0
    blocks = res.blocks  # NOTE: despite the type hint, these are dicts
    types = Counter(b["type"] for b in blocks)

    # Reading-order sanity: are figure blocks emitted before the text of their page?
    order_violations = 0
    first_text_index_per_page = {}
    for i, b in enumerate(blocks):
        pg = b.get("source", {}).get("page")
        if b["type"] in ("text", "heading") and pg not in first_text_index_per_page:
            first_text_index_per_page[pg] = i
    for i, b in enumerate(blocks):
        if b["type"] == "figure":
            pg = b.get("source", {}).get("page")
            if pg in first_text_index_per_page and i < first_text_index_per_page[pg]:
                order_violations += 1

    # Page monotonicity of reading order
    pages_seq = [b.get("source", {}).get("page") for b in blocks]
    non_monotonic = sum(1 for i in range(1, len(pages_seq))
                        if pages_seq[i] is not None and pages_seq[i - 1] is not None
                        and pages_seq[i] < pages_seq[i - 1])

    math_blocks = [b for b in blocks if b["type"] == "math"]
    latex_present = sum(1 for b in math_blocks if b.get("latex"))
    figures = [b for b in blocks if b["type"] == "figure"]
    captioned = sum(1 for b in figures if b.get("caption"))

    # do the returned images carry pixel data?
    img_entries = res.images
    image_has_bytes = any("data" in v for v in img_entries.values()) if img_entries else False

    # text block length distribution -> giant merged blobs indicate column/paragraph merging
    text_lens = sorted(len(b.get("content", "")) for b in blocks if b["type"] == "text")

    return {
        "seconds": round(dt, 3),
        "page_count": res.page_count,
        "n_blocks": len(blocks),
        "block_types": dict(types),
        "pct_blocks_classified_math": round(100 * types.get("math", 0) / max(len(blocks), 1), 1),
        "math_blocks_with_latex": latex_present,
        "figures": len(figures),
        "figures_with_caption": captioned,
        "figure_before_page_text_violations": order_violations,
        "non_monotonic_page_transitions": non_monotonic,
        "images_dict_carries_pixel_bytes": image_has_bytes,
        "text_block_chars_min": text_lens[0] if text_lens else 0,
        "text_block_chars_median": text_lens[len(text_lens) // 2] if text_lens else 0,
        "text_block_chars_max": text_lens[-1] if text_lens else 0,
        "outline_items": len(res.outline),
        "plain_text_chars": len(res.plain_text),
        "sample_math": [
            {"alt_text": b.get("alt_text", "")[:180], "latex": (b.get("latex") or "")[:180]}
            for b in math_blocks[:6]
        ],
        "sample_text_blocks": [b.get("content", "")[:400] for b in blocks if b["type"] == "text"][:3],
        "sample_headings": [b.get("content", "") for b in blocks if b["type"] == "heading"][:25],
    }


def run_legacy_services(path):
    t0 = time.time()
    text, outline, pages, structured = SV.extract_pdf_content(path)
    dt = time.time() - t0
    types = Counter(b["type"] for b in structured.get("blocks", []))
    return {
        "seconds": round(dt, 3),
        "page_count": pages,
        "plain_text_chars": len(text),
        "outline_items": len(outline),
        "n_blocks": len(structured.get("blocks", [])),
        "block_types": dict(types),
    }


def pymupdf_baseline(path):
    t0 = time.time()
    doc = fitz.open(path)
    txt = "".join(p.get_text("text", sort=True) for p in doc)
    n = len(doc)
    doc.close()
    return {"seconds": round(time.time() - t0, 3), "page_count": n, "plain_text_chars": len(txt)}


def main():
    paths = sys.argv[1:]
    report = {}
    for p in paths:
        name = os.path.basename(p)
        print(f"=== {name} ===", flush=True)
        entry = {"path": p, "size_bytes": os.path.getsize(p)}
        for label, fn in [
            ("font_census", font_census),
            ("column_probe", column_probe),
            ("vector_figures", vector_figure_probe),
            ("current_extractor", run_current_extractor),
            ("legacy_services_extractor", run_legacy_services),
            ("pymupdf_baseline", pymupdf_baseline),
        ]:
            try:
                entry[label] = fn(p)
            except Exception as e:
                entry[label] = {"ERROR": f"{type(e).__name__}: {e}"}
                print(f"  !! {label} failed: {e}", flush=True)
        report[name] = entry
        ce = entry.get("current_extractor", {})
        print(f"  blocks={ce.get('n_blocks')} types={ce.get('block_types')} "
              f"math%={ce.get('pct_blocks_classified_math')} "
              f"mathfont%={entry.get('font_census',{}).get('pct_chars_in_fonts_extraction_py_calls_math')}",
              flush=True)

    out = os.path.join(REPO, "research", "experiment-results", "current-extractor-probe.json")
    with open(out, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
