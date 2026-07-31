"""Session fixtures. The corpus manifest and its skip marker live in `worker/_corpus_manifest`.

`synthetic_paper` is the one that makes CI meaningful: `research/benchmarks/corpus/*.pdf` is
gitignored, so every corpus test skips on CI, and a suite that is 100 % skipped reports as a
pass - which `ci.yml`'s own header names as this repo's recurring defect. This builds a
text-bearing two-column PDF in process instead, so the character-level guarantees are checked on
every push.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from papertree_document_worker.pdf import pymupdf

# `_corpus_manifest` lives in tests/worker/ and is imported from tests/ingest/ too. It exists
# ONCE, and this insertion is what makes the sibling import work.
#
# Not by copying the file: mypy treats two files with the same basename as one module and aborts
# the whole run ("Duplicate module named ..."), which is the constraint pytest's `prepend` import
# mode imposes across this repo. Not by a second conftest either - same collision. And not by
# making `tests` a package: packages/db/python/tests/__init__.py already claims that name.
#
# This conftest is loaded for every subdirectory of tests/, so one insertion covers them all.
_WORKER_TESTS = Path(__file__).resolve().parent / "worker"
if str(_WORKER_TESTS) not in sys.path:
    sys.path.insert(0, str(_WORKER_TESTS))


@pytest.fixture(scope="session")
def synthetic_paper(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A two-column PDF carrying every text feature the invariants are about.

    Built with PyMuPDF rather than committed, so it needs no `.gitignore` entry and no binary in
    review. It deliberately contains:

      * a soft hyphenation at a line break (`repre-` / `sentation`);
      * a hyphen that must NOT be joined, before a capital (`self-` / `Attention`);
      * U+FB01 LATIN SMALL LIGATURE FI, which must survive into `Block.text` verbatim;
      * U+2212 MINUS SIGN, the character findings.md B7's `_clean_text` silently destroyed;
      * two columns with a real gutter, so column assignment has something to assign.
    """
    out = tmp_path_factory.mktemp("synthetic") / "synthetic.pdf"
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    left = [
        "Deep networks are more di\ufb01cult to train.",
        "We present a residual learning repre-",
        "sentation that eases training, and we",
        "evaluate it on x \u2212 1 benchmarks here.",
        "It also uses self-",
        "Attention, which is a real compound.",
    ]
    right = [
        "The second column exists so that the",
        "column detector has a genuine gutter",
        "to find, and so that reading order",
        "can be wrong in a detectable way.",
        "More text so the column carries a",
        "real share of the page's lines.",
    ]
    for index, line in enumerate(left):
        page.insert_text((72, 120 + index * 14), line, fontsize=10, fontname="helv")
    for index, line in enumerate(right):
        page.insert_text((330, 120 + index * 14), line, fontsize=10, fontname="helv")
    doc.save(out)
    doc.close()
    return out
