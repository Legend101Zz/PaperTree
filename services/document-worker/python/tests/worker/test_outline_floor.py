"""`hierarchy.spec`'s ±20 % outline clause, against gold nobody had to draw.

The clause reads *"Outline size within ±20% of gold"* and there was no gold for it: the PTUB
annotation is region-level and states no section count anywhere. So the clause sat unmeasurable
while the parser drifted — a3c reached **193 headings on a 19-page paper** and nothing said so.

**4 of the 8 corpus papers carry an embedded PDF outline**, written by `hyperref` at compile
time: the author's own section list, independent of both parsers and of the annotator. That is
about as clean a ground truth as this repo will ever get for free.

IT IS A FLOOR, NOT THE DEFINITION. A TOC lists what the author bookmarked, which is not always
every visual heading — an unnumbered "Acknowledgements" or a run-in paragraph heading may be
missing from it, and a paper may bookmark an appendix the body never titles. So this asserts a
BAND rather than equality, and the four papers with no TOC still need hand gold before the
clause is fully closed.
"""

from __future__ import annotations

import pytest
from test_pipeline_end_to_end import _parse

from _corpus_manifest import CORPUS_DIR, requires_corpus

pytestmark = requires_corpus

#: Papers whose PDF carries a `hyperref` outline, and how far the parser may sit from it.
#:
#: The band is ±20 % where `hierarchy.spec` sets it, and RECORDED-BUT-WIDER where the parser is
#: still known to be wrong. A test that asserts the bar on a paper that fails it is a red suite
#: nobody can act on; a test that asserts the CURRENT number stops the number getting worse and
#: says out loud that it is not yet the bar.
OUTLINE_EXPECTATIONS = {
    "superglue-tableheavy": (0.80, 1.20),
    "attention-is-all-you-need": (0.80, 1.20),
    # Known over-detection, measured 2026-08-01. Not the spec band - a ratchet, so the number
    # cannot silently drift further while the real fix is outstanding.
    "gpt3-longform-singlecol": (0.80, 2.10),
    "neural-odes-mathheavy": (0.80, 2.40),
}


def _embedded_outline(paper: str) -> int:
    from papertree_document_worker.pdf import pymupdf

    document = pymupdf.open(str(CORPUS_DIR / f"{paper}.pdf"))
    try:
        return len(document.get_toc())
    finally:
        document.close()


@pytest.mark.parametrize("paper", sorted(OUTLINE_EXPECTATIONS))
def test_outline_size_against_the_authors_own_bookmarks(paper: str, tmp_path) -> None:  # type: ignore[no-untyped-def]
    expected = _embedded_outline(paper)
    assert expected > 0, f"{paper} was listed as having a TOC and does not"

    result = _parse(CORPUS_DIR / f"{paper}.pdf", tmp_path)
    document = result.paper.model_dump(mode="json", by_alias=True)
    headings = sum(1 for block in document["blocks"] if block["type"] == "heading")

    low, high = OUTLINE_EXPECTATIONS[paper]
    ratio = headings / expected
    assert low <= ratio <= high, (
        f"{paper}: {headings} headings against {expected} bookmarked sections "
        f"({ratio:.2f}x, allowed {low}-{high}x)"
    )


def test_the_papers_without_an_embedded_outline_are_named_not_forgotten() -> None:
    """Half the corpus has no TOC, and the clause is not closed until they have hand gold."""
    import glob
    import os

    have = {os.path.basename(p)[:-4] for p in glob.glob(str(CORPUS_DIR / "*.pdf"))}
    without = sorted(have - set(OUTLINE_EXPECTATIONS))
    assert without == [
        "a3c-algorithmheavy",
        "bert-2col",
        "pdf-to-tree-acl2col",
        "resnet-cvpr-2col",
    ], "the no-TOC list changed; hierarchy.spec's coverage changed with it"
