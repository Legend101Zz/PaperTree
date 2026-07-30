"""The invariants, checked on a PDF built in process - so CI checks them at all.

WHY THIS FILE EXISTS. `research/benchmarks/corpus/*.pdf` is gitignored (the repo stores IDs, not
PDFs). Every other worker test needs it, so on CI they all skip. A suite that is 100 % skipped
reports as a pass, which `ci.yml`'s own header names as this repo's recurring defect.

So the load-bearing invariants are asserted here too, against a two-column PDF assembled by
PyMuPDF at test time. It is small and artificial and cannot replace the corpus for anything
statistical - reading-order accuracy, block counts, figure recall all need real papers. What it
CAN do is prove that the code paths execute and that the character-level guarantees hold, on
every push, on a machine with no corpus.

Coverage split, stated so neither half is mistaken for the other:

    here (always runs)     span offsets, dehyphenation decisions, ligature/U+2212 survival,
                           two-column detection, geometry finiteness
    corpus (local only)    counts, ratios, per-paper thresholds, performance
    fixtures-pdf (always)  the coordinate contract - see test_geometry_contract.py
"""

from __future__ import annotations

from pathlib import Path

from papertree_document_ir import Repair
from papertree_document_ir.identity import content_hash, normalise_text, resolved_text
from papertree_document_ir.validate import _dehyphenate
from papertree_document_worker.classify import PageKind, classify_page
from papertree_document_worker.layout import layout_document
from papertree_document_worker.pdf import Char, Line, SourceDocument
from papertree_document_worker.pdf import Span as PdfSpan
from papertree_document_worker.text import build_block_text


def _all_blocks(path: Path) -> list[tuple[str, list[Repair]]]:
    out: list[tuple[str, list[Repair]]] = []
    with SourceDocument(path) as doc:
        for page in doc.pages():
            for block in page.text_blocks:
                built = build_block_text(block.lines)
                out.append((built.text, list(built.repairs)))
    return out


def test_the_synthetic_page_is_classified_digital(synthetic_paper: Path) -> None:
    with SourceDocument(synthetic_paper) as doc:
        profile = classify_page(doc.page(0))
    assert profile.kind is PageKind.DIGITAL
    assert profile.has_text_layer
    assert profile.glyph_count > 100


def _line(text: str, y: float = 100.0, x: float = 72.0, size: float = 10.0) -> Line:
    """A `Line` built directly, bypassing the PDF.

    NOT laziness - necessity. The first draft of this test put U+FB01 and U+2212 into a PDF via
    `insert_text` with the base-14 `helv` face, and MuPDF **substituted them**: the round trip
    produced `di·cult`, because Helvetica's WinAnsi encoding has no `fi` ligature glyph. The test
    would then have been measuring PyMuPDF's font fallback, not the parser.

    `build_block_text` is a pure function of `Line`/`Span`, so feeding it the exact code points
    tests the exact code path that findings.md B7's `_clean_text` corrupted, with no font in the
    way. The corpus suite covers the same characters end-to-end through a real PDF.
    """
    span = PdfSpan(
        text=text,
        bbox=[x, y - size, x + size * len(text) * 0.5, y],
        size=size,
        font="Test",
        flags=0,
        color=0,
        origin=[x, y],
        ascender=0.8,
        descender=-0.2,
        direction="ltr",
        chars=tuple(
            Char(text=ch, bbox=[x + i, y - size, x + i + 1, y], origin=[x + i, y], synthetic=False)
            for i, ch in enumerate(text)
        ),
    )
    return Line(bbox=list(span.bbox), direction="ltr", spans=(span,))


def test_ligature_and_minus_reach_block_text_unchanged() -> None:
    """findings.md B7's regression, on the exact code points it destroyed.

    `_clean_text` mapped U+2212 MINUS to ASCII hyphen inside the same table as its ligature
    repair, silently. Both must arrive in `Block.text` untouched.
    """
    built = build_block_text([_line("more diﬃcult: x − 1 and ﬁnally ﬂow")])

    assert "ﬃ" in built.text, "U+FB03 must survive verbatim into Block.text"
    assert "ﬁ" in built.text and "ﬂ" in built.text, "U+FB01/U+FB02 must survive"
    assert "−" in built.text, "U+2212 MINUS must not be rewritten to ASCII hyphen"
    assert "-" not in built.text, "no ASCII hyphen should appear - that is the B7 corruption"
    assert "difficult" not in built.text, "the ligature must not be silently expanded in `text`"
    assert not built.repairs, "nothing here is a repair, because nothing was changed"

    # Expansion belongs to the normaliser, and only there. This is the half that shows the fix is
    # "do not rewrite" rather than "rewrite somewhere else".
    normalised = normalise_text(built.text)
    assert "difficult" in normalised and "finally" in normalised and "flow" in normalised
    assert "−" in normalised, "U+2212 is not a ligature and normalisation leaves it alone"


def test_span_offsets_are_valid_and_ordered(synthetic_paper: Path) -> None:
    with SourceDocument(synthetic_paper) as doc:
        for block in doc.page(0).text_blocks:
            built = build_block_text(block.lines)
            previous = 0
            for span in built.spans:
                assert 0 <= span.start < span.end <= len(built.text)
                assert span.start >= previous
                assert span.size is not None and span.size > 0
                previous = span.end


def test_the_soft_hyphen_is_proposed_and_the_compound_is_not(synthetic_paper: Path) -> None:
    """The two hyphens on the page are deliberately different, and must be treated differently.

    `repre-` / `sentation` is a soft break and must be proposed. `self-` / `Attention` is a real
    compound and must be left alone - it is the case that caught a live bug in
    `is_dehyphenatable`, where a disjunction on the PRECEDING character fired and would have
    produced "selfAttention".
    """
    proposals = [(text, repairs) for text, repairs in _all_blocks(synthetic_paper) if repairs]
    assert proposals, "the synthetic page contains a soft hyphenation and none was proposed"

    for text, repairs in proposals:
        for repair in repairs:
            assert repair.applied is False
            assert repair.kind == "dehyphenate"
            assert repair.at is not None
            assert text[repair.at : repair.at + len(repair.from_)] == repair.from_, "rule 27"
            assert _dehyphenate(repair.from_) == repair.to, "rule 30b"

    joined = "".join(text for text, _ in _all_blocks(synthetic_paper))
    assert "repre-" in joined, "Block.text keeps the hyphen; the repair only proposes"

    class _Block:
        def __init__(self, text: str, repairs: list[Repair]) -> None:
            self.text = text
            self.repairs = repairs

    for text, repairs in proposals:
        applied = resolved_text(_Block(text, list(repairs)), apply_proposed=True)
        assert not applied.skipped_proposals
        if "repre-\nsentation" in text:
            assert "representation" in applied.text


def test_two_columns_are_detected_and_no_block_spans_the_gutter(synthetic_paper: Path) -> None:
    """The reading-order property, on a page whose column structure is known by construction.

    Not a substitute for `worker/reading-order.spec` - that needs gold on real papers - but it
    does catch the total failure, where the gutter is missed and both columns merge into one
    block. That is findings.md B5.3's 4,673-character blob.
    """
    with SourceDocument(synthetic_paper) as doc:
        layout = layout_document(doc.pages())
    page = layout.pages[0]
    assert page.column_count == 2, "a 258 pt gutter must be found"

    body = [b for b in page.blocks if b.flow == "body"]
    assert body, "the page has body text"
    for block in body:
        if block.column is None:
            continue
        column = page.columns[block.column]
        centre = (block.bbox[0] + block.bbox[2]) / 2
        assert column.x0 <= centre < column.x1

    columns = [b.column for b in body if b.column is not None]
    assert columns == sorted(columns), (
        "column 1 content appeared between column 0 blocks - this is the interleaving the "
        "acceptance criterion forbids outright"
    )


def test_geometry_is_finite_and_inside_the_page(synthetic_paper: Path) -> None:
    """Validator rules G5 and G7's precondition, cheaply."""
    with SourceDocument(synthetic_paper) as doc:
        page = doc.page(0)
    width, height = page.frame.width, page.frame.height
    assert (width, height) == (612.0, 792.0)
    for span in page.spans:
        box = span.bbox
        assert all(v == v and abs(v) < 20000 for v in box), "G5: finite and within schema bounds"
        assert 0 <= box[0] <= box[2] <= width
        assert 0 <= box[1] <= box[3] <= height


def test_content_hash_is_the_librarys_and_folds_what_it_should(synthetic_paper: Path) -> None:
    joined = "".join(text for text, _ in _all_blocks(synthetic_paper))
    digest = content_hash(joined)
    assert digest.startswith("sha256:") and len(digest) == len("sha256:") + 64
    assert content_hash("  Deep   Networks ") == content_hash("deep networks")
    assert content_hash("x − 1") != content_hash("x - 1")
