"""The corpus manifest and its absence guard. Imported by every corpus-dependent test module.

`.gitignore` line 33 is `research/benchmarks/corpus/*.pdf`. The 8 papers are fetched, not
committed (`research/benchmarks/README.md` §1.3: "the repo stores IDs, not PDFs, except the small
seed set"). CI therefore has **no corpus**, and the first CI run on this branch showed exactly
what that does:

    5 failed, 759 passed, 7 skipped

Two different failures, and the second is the dangerous one:

  * tests naming a corpus file directly raised `FileNotFoundError` - loud, fine;
  * tests parametrised over `glob(corpus/*.pdf)` got an **empty list**, and a `parametrize` over
    an empty sequence collects **zero cases**. `test_spans_satisfy_rules_25_and_26_on_every_block`
    did not fail in CI. It did not run. It reported nothing at all.

That is the failure this repo has already been bitten by twice - #26's fixture script that passed
while validating nothing, and the cross-language test that skipped and reported green - arriving
a third time. `ci.yml`'s own header calls it out.

So there are two mechanisms here, and they do different jobs:

  1. `corpus_files` / `corpus` SKIP with a stated reason when the corpus is absent, and
     `test_corpus_presence_is_all_or_nothing` fails on a PARTIAL corpus, so "I fetched 3 of 8"
     is an error rather than a quietly reduced test suite.
  2. `synthetic_paper` builds a text-bearing PDF **in process**, committed to nothing, so the
     invariants that matter - span offsets, dehyphenation, ligature and U+2212 survival, two
     columns - are checked on every CI run whether or not the corpus was fetched.

(2) is the one that makes CI meaningful. (1) only keeps the richer local runs honest about
being local.
"""

from __future__ import annotations

import glob
from pathlib import Path

import pytest
from _pytest.mark.structures import ParameterSet

REPO = Path(__file__).resolve().parents[5]
CORPUS_DIR = REPO / "research" / "benchmarks" / "corpus"
FIXTURE_PDFS = REPO / "packages" / "document-ir" / "test" / "fixtures-pdf"

#: The manifest, so a partial fetch is detectable. From `research/benchmarks/README.md` §1.3.
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

#: Applied to every corpus-dependent module, for the tests that name a paper directly.
requires_corpus = pytest.mark.skipif(
    not HAVE_CORPUS,
    reason=(
        f"the 8-paper corpus is gitignored and not present ({len(CORPUS_FILES)} of "
        f"{len(EXPECTED_CORPUS)} found in {CORPUS_DIR}). Fetch it with "
        f"`./research/benchmarks/fetch_corpus.sh` to run these; the synthetic-PDF suite covers "
        f"the same invariants everywhere. (AGENTS.md §4: name the script, do not just say "
        f"'fetch it'.)"
    ),
)


def test_corpus_presence_is_all_or_nothing() -> None:
    """A PARTIAL corpus is a broken environment, not a smaller test run.

    Always runs. With 0 files this passes and says so; with 8 it passes; with anything between
    it fails, because a suite quietly parametrised over 3 papers looks identical in the summary
    line to one parametrised over 8.
    """
    found = {p.name for p in CORPUS_FILES}
    expected = set(EXPECTED_CORPUS)
    assert found in (set(), expected), (
        f"partial corpus: {len(found)} of {len(expected)} papers present. "
        f"Missing {sorted(expected - found)}; unexpected {sorted(found - expected)}."
    )


#: THE PARAMETER LIST FOR EVERY `@pytest.mark.parametrize("path", ...)` OVER THE CORPUS.
#:
#: Never `CORPUS_FILES` directly. A module-level `skipif` does NOT save a parametrised test from
#: an empty corpus: the mark is applied to the cases pytest COLLECTS, and an empty parameter
#: sequence collects **zero cases**, so there is nothing to mark and nothing to report. Measured
#: on this branch's second CI run - 755 passed, 25 skipped, and **48 parametrised cases that
#: appeared in neither number**. A first fix that only added the module mark did not close it.
#:
#: This substitutes one explicitly-skipped placeholder case so the absence always shows up in
#: the summary line as a skip with a reason, which is the whole point.
#: Typed as the union pytest actually accepts: real paths, or one skipped placeholder.
CORPUS_PARAMS: list[Path | ParameterSet] = list(CORPUS_FILES) or [
    pytest.param(
        None,
        marks=pytest.mark.skip(
            reason=f"corpus absent: 0 of {len(EXPECTED_CORPUS)} papers in {CORPUS_DIR}"
        ),
    )
]


# ── the S2 fresh set (#141): six out-of-sample arXiv papers, fetched the same way ──────────────

FRESH_DIR = REPO / "research" / "benchmarks" / "fresh" / "pdfs"

#: `research/benchmarks/fresh/fresh.sha256`, by name, so a partial fetch is detectable.
EXPECTED_FRESH = (
    "adam-1412.6980.pdf",
    "ddpm-2006.11239.pdf",
    "flashattention-2205.14135.pdf",
    "maskrcnn-1703.06870.pdf",
    "sbert-1908.10084.pdf",
    "yolo-1506.02640.pdf",
)

FRESH_FILES: list[Path] = sorted(Path(p) for p in glob.glob(str(FRESH_DIR / "*.pdf")))
HAVE_FRESH = len(FRESH_FILES) == len(EXPECTED_FRESH)

_FRESH_ABSENT = (
    f"the S2 fresh set is gitignored and not present ({len(FRESH_FILES)} of "
    f"{len(EXPECTED_FRESH)} found in {FRESH_DIR}). Fetch it with "
    f"`./research/benchmarks/fresh/fetch_fresh.sh` to run these real-parse tests; the synthetic "
    f"cases in test_parse_robustness.py cover the same defects everywhere."
)

#: For tests that name a fresh paper directly.
requires_fresh = pytest.mark.skipif(not HAVE_FRESH, reason=_FRESH_ABSENT)

#: Same trap as `CORPUS_PARAMS`: an empty parametrisation collects ZERO cases and reports nothing,
#: so an absent fresh set becomes ONE explicitly skipped placeholder with the reason attached.
FRESH_PARAMS: list[Path | ParameterSet] = list(FRESH_FILES) or [
    pytest.param(None, marks=pytest.mark.skip(reason=_FRESH_ABSENT))
]


def test_fresh_presence_is_all_or_nothing() -> None:
    """A PARTIAL fresh set is a broken environment, exactly like a partial corpus."""
    found = {p.name for p in FRESH_FILES}
    expected = set(EXPECTED_FRESH)
    assert found in (set(), expected), (
        f"partial fresh set: {len(found)} of {len(expected)} papers present. "
        f"Missing {sorted(expected - found)}; unexpected {sorted(found - expected)}."
    )
