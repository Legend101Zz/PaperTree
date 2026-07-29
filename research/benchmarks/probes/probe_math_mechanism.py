"""Nail down WHY prose lines are classified as math by the current extractor."""
import os, sys, json
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "apps", "api"))
import fitz
from papertree_api.papers import extraction as EX

def analyse(path, limit=12):
    doc = fitz.open(path)
    rows = []
    for pno in range(len(doc)):
        page = doc[pno]
        for blk in page.get_text("dict", sort=True)["blocks"]:
            if blk["type"] != 0:
                continue
            for line in blk.get("lines", []):
                line_text, total, mathc = "", 0, 0
                by_font = {}
                for span in line.get("spans", []):
                    t = span.get("text", ""); f = span.get("font", "")
                    hit_font = EX.is_math_font(f)
                    n_char_hits = 0
                    for ch in t:
                        total += 1
                        if EX.is_math_char(ch) or hit_font:
                            mathc += 1
                            n_char_hits += 1
                    by_font[f] = by_font.get(f, 0) + len(t)
                    line_text += t
                line_text = line_text.strip()
                if not line_text or total == 0:
                    continue
                ratio = mathc / total
                if ratio > 0.4:  # what the extractor calls math
                    # how much of the "math" came purely from font attribution?
                    font_only = sum(n for f, n in by_font.items() if EX.is_math_font(f))
                    char_only = sum(1 for ch in line_text if EX.is_math_char(ch))
                    rows.append({
                        "page": pno, "text": line_text[:120], "ratio": round(ratio, 3),
                        "chars": total, "math_chars": mathc,
                        "chars_from_math_FONT": font_only,
                        "chars_that_are_math_SYMBOLS": char_only,
                        "fonts": {f: n for f, n in sorted(by_font.items(), key=lambda kv: -kv[1])[:3]},
                        "verdict": "FONT-DRIVEN" if font_only >= mathc * 0.6 else
                                   ("SYMBOL-DRIVEN" if char_only >= mathc * 0.6 else "MIXED"),
                        "is_prose": len([w for w in line_text.split() if w.isalpha() and len(w) > 3]) >= 4,
                    })
    doc.close()
    return rows

for p in sys.argv[1:]:
    rows = analyse(p)
    prose = [r for r in rows if r["is_prose"]]
    print("=" * 90)
    print(f"{os.path.basename(p)}: {len(rows)} lines classified MATH, of which "
          f"{len(prose)} ({100*len(prose)//max(len(rows),1)}%) are ENGLISH PROSE")
    from collections import Counter
    print("  drivers:", dict(Counter(r["verdict"] for r in rows)))
    print("  --- prose wrongly called math ---")
    for r in prose[:8]:
        print(f"   p{r['page']} ratio={r['ratio']} ({r['math_chars']}/{r['chars']}) "
              f"font={r['chars_from_math_FONT']} sym={r['chars_that_are_math_SYMBOLS']} [{r['verdict']}]")
        print(f"      {r['text']!r}")
        print(f"      fonts={r['fonts']}")
