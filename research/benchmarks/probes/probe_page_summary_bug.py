"""
Verify the page-summary text-slicing path end to end, using the REAL repo code.

Hypothesis: llm_service.extract_page_text() looks for "[Page N]" markers that no
extractor ever writes, so every page summary is generated from the wrong text.
"""
import os, sys, json
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "apps", "api"))

from papertree_api.papers import extraction as EX
from papertree_api.papers import services as SV
from papertree_api.papers import llm_service as LS

out = {}
for pdf in sys.argv[1:]:
    name = os.path.basename(pdf)
    # the two producers of "extracted_text" in the repo
    res = EX.extract_pdf_content(pdf, "probe")
    new_text = res.plain_text
    legacy_text, _, legacy_pages, _ = SV.extract_pdf_content(pdf)

    entry = {"real_page_count": res.page_count}
    for label, text in (("extraction.py plain_text", new_text),
                        ("services.py full_text", legacy_text)):
        detected = LS.count_pages_in_text(text)
        slices = {}
        for p in range(0, min(res.page_count, 5)):
            t = LS.extract_page_text(text, p)
            slices[f"page_{p}"] = {
                "chars_returned": len(t),
                "is_empty": len(t.strip()) == 0,
                "first_60": t[:60].replace("\n", " "),
            }
        entry[label] = {
            "total_chars": len(text),
            "contains_page_markers": "[Page " in text,
            "count_pages_in_text_says": detected,
            "REAL_page_count": res.page_count,
            "slices": slices,
            "n_pages_that_would_get_EMPTY_placeholder":
                sum(1 for p in range(res.page_count) if not LS.extract_page_text(text, p).strip()),
        }
    out[name] = entry
    print(f"=== {name}  ({res.page_count} real pages) ===")
    for label in ("extraction.py plain_text", "services.py full_text"):
        e = entry[label]
        print(f"  {label}: {e['total_chars']} chars, markers={e['contains_page_markers']}, "
              f"count_pages_in_text()={e['count_pages_in_text_says']} (real {e['REAL_page_count']})")
        print(f"    pages that return EMPTY text -> canned 'page is empty' summary: "
              f"{e['n_pages_that_would_get_EMPTY_placeholder']}/{e['REAL_page_count']}")
        print(f"    page_0 gets {e['slices']['page_0']['chars_returned']} chars "
              f"(= whole document?) -> then truncated to 5000 before the LLM sees it")
    print()

with open(os.path.join(REPO, "research", "experiment-results", "page-summary-slicing-bug.json"), "w") as f:
    json.dump(out, f, indent=2)
print("wrote research/experiment-results/page-summary-slicing-bug.json")
