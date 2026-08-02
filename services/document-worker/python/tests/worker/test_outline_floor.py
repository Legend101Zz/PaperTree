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
BAND rather than equality.

THE OTHER FOUR PAPERS NOW HAVE HAND GOLD (#54 item 4), and the method matters more than the
numbers:

  * The section list was read off the PDF's own glyph stream — not off parser output, and not
    off a numbering regex. Deriving it either way would score `hierarchy.py` against a
    reimplementation of itself, which `ANNOTATION_GUIDE.md` §1 forbids and which would make the
    resulting figure worthless as an independent floor.
  * What was counted: numbered sections and subsections at every depth, plus `Abstract`,
    `References` and each lettered appendix head — i.e. what `hyperref` puts in a TOC, so the
    two halves of the corpus are counted the same way. NOT counted: run-in bold paragraph leads
    (`Task #1: Masked LM`, `Residual Representations.`), author and affiliation lines, table
    headers, or the supplement's own title page.
  * **ONE annotator, no inter-annotator agreement** — the same limitation #54 records for the
    region gold. These numbers measure; they do not authorise.
"""

from __future__ import annotations

import pytest
from _corpus_manifest import CORPUS_DIR, requires_corpus
from test_pipeline_end_to_end import _parse

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


#: The four papers with no `hyperref` outline, hand-counted. See this module's docstring for
#: what was and was not counted, and for the single-annotator caveat.
#:
#: `(sections, low, high)`. The band is `hierarchy.spec`'s ±20 % where the parser meets it and a
#: RECORDED RATCHET where it does not — the same convention `OUTLINE_EXPECTATIONS` uses, so a
#: failing paper cannot drift further while its real fix is outstanding.
HAND_COUNTED_OUTLINE = {
    # Abstract, 1-6, 5.1-5.6, References, and the supplement's 7-9. Measured 17 against 17.
    "a3c-algorithmheavy": (17, 0.80, 1.20),
    # Abstract, 1-6 with 2.1-2.3/3.1-3.2/4.1-4.4/5.1-5.3, References, A-C with A.1-A.5/B.1/
    # C.1-C.2. Measured 32 against 31. The extra one is the supplement's own title.
    "bert-2col": (31, 0.80, 1.20),
    # Abstract, 1-4 with 3.1-3.4/4.1-4.3, References, appendices A-C. Measured 13 against 16.
    "resnet-cvpr-2col": (16, 0.80, 1.20),
    # Abstract, 1-8 with 2.1-2.2/2.2.1-2.2.4/3.1-3.4/4.1-4.5/5.1-5.3, References, appendix A.
    # Measured 19 against 29 = 0.66x — UNDER-detection, and the only one of the four outside the
    # band. Its subsection heads are bold at body size in a two-column ACL layout, which is the
    # weakest signal `detect_headings` has. Ratcheted, not excused.
    "pdf-to-tree-acl2col": (29, 0.60, 0.80),
}


@pytest.mark.parametrize("paper", sorted(HAND_COUNTED_OUTLINE))
def test_outline_size_against_a_hand_count_for_the_papers_with_no_bookmarks(  # type: ignore[no-untyped-def]
    paper: str,
    capsys: pytest.CaptureFixture[str],
    tmp_path,
) -> None:
    """#54 item 4. Closes `hierarchy.spec`'s ±20 % clause on the half of the corpus that had no
    independent floor at all.

    MUTATION THAT TURNS THIS RED: change any hand count by more than its band allows — e.g.
    a3c 17 -> 25. Watched: a3c 1.00x -> 0.68x, red. And on the parser side, reverting #102's
    `_CAPTION_START` fix reds nothing here but reds gpt3 in the test above, which is the point:
    these two tests cover different papers and neither substitutes for the other.
    """
    sections, low, high = HAND_COUNTED_OUTLINE[paper]
    result = _parse(CORPUS_DIR / f"{paper}.pdf", tmp_path)
    document = result.paper.model_dump(mode="json", by_alias=True)
    headings = sum(1 for block in document["blocks"] if block["type"] == "heading")
    ratio = headings / sections
    with capsys.disabled():
        print(
            f"\n[worker/outline] {paper}: {headings} headings against {sections} hand-counted "
            f"sections = {ratio:.2f}x (allowed {low}-{high}x, ONE annotator, no IAA)"
        )
    assert low <= ratio <= high, (
        f"{paper}: {headings} headings against {sections} hand-counted sections "
        f"({ratio:.2f}x, allowed {low}-{high}x)"
    )


def test_every_corpus_paper_now_has_an_outline_floor() -> None:
    """The clause is closed on coverage: all 8 papers have a floor, 4 from the authors'
    bookmarks and 4 by hand. Closed on COVERAGE is not closed on RESULT — 3 of the 8 sit
    outside ±20 % and carry a ratchet instead."""
    import glob
    import os

    have = {os.path.basename(p)[:-4] for p in glob.glob(str(CORPUS_DIR / "*.pdf"))}
    covered = set(OUTLINE_EXPECTATIONS) | set(HAND_COUNTED_OUTLINE)
    assert not (have - covered), f"no outline floor for {sorted(have - covered)}"
    assert not (set(OUTLINE_EXPECTATIONS) & set(HAND_COUNTED_OUTLINE)), (
        "a paper is in both tables - it would be asserted against two different golds"
    )
    # Anti-vacuity: an empty corpus would satisfy the subset check above and assert nothing.
    assert len(have) == 8, f"{len(have)} corpus papers, expected 8"
