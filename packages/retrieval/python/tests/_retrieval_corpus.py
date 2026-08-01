"""The corpus guard for this package's tests. A LOCAL copy, deliberately, not an import.

`research/benchmarks/corpus/*.pdf` is gitignored (.gitignore line 33) — the repo stores IDs, not
PDFs. **This machine has the 8 papers and CI does not.** A test that reads one passes here and
fails on a clean checkout with `ENOENT`; that is how CI run 30712541335 went red after a fully
green local gate, and AGENTS.md §4 names it as the trap this repo has hit three times.

`services/document-worker/python/tests/worker/_corpus_manifest.py` is the pattern this copies, and
copying rather than importing is the right call for two independent reasons:

  1. it computes `REPO = Path(__file__).resolve().parents[5]`, which is correct at ITS depth
     (services/document-worker/python/tests/worker/) and wrong at this one
     (packages/retrieval/python/tests/) — it would resolve one directory above the repo and
     silently report "no corpus" forever, which looks exactly like a clean CI run;
  2. pytest's `prepend` import mode plus mypy's duplicate-module detection make a shared sibling
     module a cross-package sys.path insertion, which that file's own conftest had to be written
     to support. Ten lines duplicated beats a load-bearing path hack.

The number this file exists to protect: the assertions that matter run on a SYNTHETIC PDF built in
process (`_retrieval_fixtures.py`), so they execute on every push whether or not the corpus was
fetched. Corpus tests are an additional, skippable layer that keeps the richer local runs honest
about being local — never the only place a guarantee is checked.
"""

from __future__ import annotations

import glob
from pathlib import Path

import pytest

#: packages/retrieval/python/tests/_retrieval_corpus.py -> parents[4] is the repo root.
REPO = Path(__file__).resolve().parents[4]
CORPUS_DIR = REPO / "research" / "benchmarks" / "corpus"
FETCH_SCRIPT = "./research/benchmarks/fetch_corpus.sh"

#: From `research/benchmarks/README.md` §1.3, so a partial fetch is detectable.
EXPECTED_CORPUS = (
    "a3c-algorithmheavy.pdf",
    "attention-is-all-you-need.pdf",
    "bert-2col.pdf",
    "gpt3-longform-singlecol.pdf",
    "neural-odes-mathheavy.pdf",
    "pdf-to-tree-acl2col.pdf",
    "resnet-cvpr-2col.pdf",
    "superglue-tableheavy.pdf",
)

CORPUS_FILES: list[Path] = sorted(Path(p) for p in glob.glob(str(CORPUS_DIR / "*.pdf")))
HAVE_CORPUS = len(CORPUS_FILES) == len(EXPECTED_CORPUS)

#: The paper the corpus-backed retrieval tests use. 12 pages, 974 blocks, 14 sections, 53
#: reference entries, 25 relations — the richest structure in the corpus for the price.
CORPUS_PAPER = CORPUS_DIR / "resnet-cvpr-2col.pdf"

requires_corpus = pytest.mark.skipif(
    not HAVE_CORPUS,
    reason=(
        f"the 8-paper corpus is gitignored and absent ({len(CORPUS_FILES)} of "
        f"{len(EXPECTED_CORPUS)} in {CORPUS_DIR}). Fetch it with `{FETCH_SCRIPT}` to run these. "
        f"The synthetic-PDF tests in this package cover the same guarantees on every push."
    ),
)


def test_corpus_presence_is_all_or_nothing() -> None:
    """A PARTIAL corpus is a broken environment, not a smaller test run. Always runs.

    With 0 files this passes and prints the absence; with 8 it passes; with anything in between it
    FAILS, because a suite quietly reduced to 3 papers is indistinguishable in the summary line
    from one that ran all 8.
    """
    found = {path.name for path in CORPUS_FILES}
    expected = set(EXPECTED_CORPUS)
    if not found:
        print(
            f"\n[retrieval] corpus absent (0 of {len(expected)} in {CORPUS_DIR}). "
            f"Corpus-backed retrieval tests will SKIP. Fetch with `{FETCH_SCRIPT}`."
        )
    assert found in (set(), expected), (
        f"partial corpus: {len(found)} of {len(expected)} present. "
        f"Missing {sorted(expected - found)}; unexpected {sorted(found - expected)}. "
        f"Re-run `{FETCH_SCRIPT}`."
    )
