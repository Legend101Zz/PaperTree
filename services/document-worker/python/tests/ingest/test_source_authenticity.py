"""`ingest/source-authenticity.spec` — the lint that catches undeclared model prose.

THE TEST THE EPIC FILE FORGOT. `packages/document-ir/DESIGN.md` §2.2 and §11 residual risk 1
both assign this to Epic 1 and both say the schema is **not** a substitute for it.
`EPIC-01-ingest.md` does not mention it, so it would have been silently dropped; issue #27
tracks that gap.

WHAT THE SCHEMA GUARANTEES, STATED EXACTLY

`SourceKind` is `pdf_text_layer | pdf_vector | pdf_raster | ocr` and has no model value, so:

> AI-in-source is **UNDECLARABLE**. It is **not undetectable**.

The gate confirmed a document of 100 % model prose stamped `source: "ocr"` passes ajv and the
semantic validator with **zero diagnostics**. `provenance.parser` is a free string, so
`{parser: "openai/gpt-4o"}` validates alongside it and corroborates the lie. JSON Schema
validates SHAPE, not AUTHORSHIP. This suite is the other half.

THE CHECK, AND WHY IT IS AN IDENTITY RATHER THAN AN EDIT DISTANCE

DESIGN.md phrases the requirement as "reconstructible from the PDF's own glyph stream within a
stated edit distance". For this parser the stated distance is **zero**, because `text.py` never
mutates: a block's text is the glyphs MuPDF returned, with U+000A between lines and nothing
else. Dehyphenation is *proposed* (`applied: false`), never applied.

THE UNIT IS THE LINE, and that is a correction the lint itself forced. The first draft asserted
each block's whole text was a contiguous substring of its page's glyph stream, and it failed on
seven of eight papers — correctly. A3C's author block reads

    "Volodymyr Mnih1Adrià Puigdomènech Badia1Mehdi Mirza1,2..."

while the page's glyph stream reads

    "...Volodymyr Mnih1VMNIH@GOOGLE.COMAdrià Puigdomènech Badia1ADRIAP@GO..."

The names and the e-mail addresses are two columns, and the parser groups the name lines
together — which is its JOB. Blocks are not contiguous in extraction order; that is what
reading order means.

So the invariant is: **every LINE of every block appears verbatim in the page's glyph stream**.
The parser may reorder and regroup lines, and may not alter a single character inside one. That
is strictly stronger than an edit-distance band — an invented sentence appears nowhere at all —
while being true of what the parser actually does.

ONE EXCEPTION, AND IT IS A REAL WEAKENING RATHER THAN A TECHNICALITY

`table_cell` text is **derived**: `tables.py` splits a row on horizontal whitespace and
concatenates the spans that fall in one column, so a cell's text is a reordered, regrouped
selection of spans and NOT a contiguous run of the glyph stream. The lint found this too, on
three papers, and the failures were genuine cell-splitting errors — `'82.391.2'` is the values
`82.3` and `91.2` from two different columns welded together by too small a gap threshold.

Cells are therefore checked at SPAN granularity: every span a cell is built from must appear in
the glyph stream. That is weaker — it would not catch prose assembled entirely out of real
spans — and it is recorded as a limitation in `EPIC-01-RESULT.md` rather than presented as
equivalent. The line-level check still covers every `paragraph`, `heading`, `caption`,
`footnote` and `equation` block, which is where prose would actually be laundered.

A future parser that DOES mutate must record it as a `Repair`, and this test will then need
`resolved_text` to unwind it before comparing.
"""

from __future__ import annotations

import tempfile
import unicodedata
from pathlib import Path

import pytest
from _corpus_manifest import CORPUS_PARAMS, requires_corpus
from papertree_document_worker.pdf import SourceDocument
from papertree_document_worker.pipeline import parse_document

pytestmark = requires_corpus

PAPER_ID = "ppr_0123456789ABCDEFGHJKMNP0TV"

#: Sources that transcribe a region rather than reading glyphs. Only `ocr` is exempt from the
#: glyph-stream check, and it owes its own evidence (the engine's raw output) - which this
#: parser never produces, because Epic 1 ships no OCR path.
GLYPH_BACKED_SOURCES = frozenset({"pdf_text_layer", "pdf_vector", "pdf_raster"})


def _page_glyphs(document: SourceDocument, page_index: int) -> str:
    """Every glyph on a page, in extraction order, with nothing normalised away."""
    page = document.page(page_index)
    return "".join(char.text for line in page.lines for span in line.spans for char in span.chars)


def _lines_of(text: str) -> list[str]:
    """A block's text split back into the lines it was assembled from.

    U+000A is the ONLY thing the assembler inserted, so splitting on it recovers exactly the
    units MuPDF produced. Nothing is stripped or folded: doing so would create the tolerance
    band this check exists to deny.
    """
    return [line for line in text.split("\n") if line]


@pytest.mark.parametrize("path", CORPUS_PARAMS, ids=lambda p: p.name if p else "no-corpus")
def test_every_block_text_is_reconstructible_from_the_glyph_stream(path: Path) -> None:
    """THE LINT. Any block whose text cannot be traced to glyphs fails the build."""
    with tempfile.TemporaryDirectory() as tmp:
        result = parse_document(path, paper_id=PAPER_ID, asset_root=Path(tmp))

    with SourceDocument(path) as document:
        glyphs_by_page = {
            index: _page_glyphs(document, index) for index in range(document.page_count)
        }

    checked = 0
    cells_checked = 0
    for block in result.paper.blocks:
        if block.text is None or block.source not in GLYPH_BACKED_SOURCES:
            continue
        stream = glyphs_by_page[block.page_index]

        if block.type == "table_cell":
            # Derived text - see the module docstring. Checked at span granularity.
            for span in block.spans or ():
                fragment = block.text[span.start : span.end]
                if not fragment.strip():
                    continue
                cells_checked += 1
                assert fragment in stream, (
                    f"{block.block_id} (table_cell, page {block.page_index}) contains a span "
                    f"absent from the glyph stream: {fragment[:60]!r}"
                )
            continue

        for line in _lines_of(block.text):
            checked += 1
            assert line in stream, (
                f"{block.block_id} ({block.type}, page {block.page_index}) carries a line that "
                f"is NOT in the page's glyph stream: {line[:80]!r}. Either the parser mutated it "
                f"without recording a Repair, or the text did not come from the document."
            )

    assert checked > 500, f"only {checked} lines were checked - the lint is not exercising"


@pytest.mark.parametrize("path", CORPUS_PARAMS, ids=lambda p: p.name if p else "no-corpus")
def test_no_block_claims_a_source_this_parser_cannot_produce(path: Path) -> None:
    """`ocr` is legitimate for a scanned page and costs a dishonest producer nothing.

    Epic 1 ships NO OCR path - it is an explicit non-goal - so this parser emitting `ocr` would
    mean the value was fabricated. Asserted because `ocr` is precisely the source a producer
    would reach for to launder model prose: it raises no signal on its own.
    """
    with tempfile.TemporaryDirectory() as tmp:
        result = parse_document(path, paper_id=PAPER_ID, asset_root=Path(tmp))

    for block in result.paper.blocks:
        assert block.source != "ocr", (
            f"{block.block_id} claims source 'ocr', but this build has no OCR path - the value "
            f"cannot have been earned"
        )
        assert block.source in GLYPH_BACKED_SOURCES


@pytest.mark.parametrize("path", CORPUS_PARAMS, ids=lambda p: p.name if p else "no-corpus")
def test_no_repair_is_applied_and_no_model_is_named(path: Path) -> None:
    """The other half of "undeclarable": a model reading must arrive as a PROPOSAL.

    D4 pins model-authored repair kinds to `applied: false` and obliges them to carry
    `model_id` + `prompt_hash`; deterministic kinds may not name a model at all. This parser
    emits only `dehyphenate` proposals, so both halves hold trivially - and that is worth
    asserting, because the day a VLM repair is added, this is the test that notices.
    """
    with tempfile.TemporaryDirectory() as tmp:
        result = parse_document(path, paper_id=PAPER_ID, asset_root=Path(tmp))

    for block in result.paper.blocks:
        for repair in block.repairs or ():
            assert repair.applied is False, "the parser proposes; it never performs"
            assert repair.kind == "dehyphenate"
            assert repair.model_id is None, "a deterministic kind may not name a model (D4)"
            assert repair.prompt_hash is None


def test_the_lint_catches_injected_model_prose() -> None:
    """A GUARD NOBODY HAS SEEN FAIL IS NOT A GUARD.

    EPIC-GATE-PROMPT §Phase 2.5 requires exactly this: deliberately break something and confirm
    the check catches it. Here the break is the thing the lint exists for - a sentence no model
    read off the page, stamped as if it came from the text layer.
    """
    glyph_stream = "Deep residual learning for image recognition.We present a framework."

    fabricated = "This paragraph was written by a language model."
    assert all(line not in glyph_stream for line in _lines_of(fabricated)), (
        "the lint's core comparison must reject text absent from the glyph stream"
    )

    # ...and must ACCEPT a genuine block whose lines are present but NOT CONTIGUOUS, or it
    # would reject every author block in the corpus and "pass" for the wrong reason.
    genuine = "Deep residual learning\nWe present a framework."
    assert all(line in glyph_stream for line in _lines_of(genuine))

    # A single fabricated line among genuine ones must still fail.
    poisoned = "Deep residual learning\n" + fabricated
    assert not all(line in glyph_stream for line in _lines_of(poisoned))


def test_undecodable_private_use_glyphs_are_not_mistaken_for_fabrication() -> None:
    """ResNet page 4 carries 48 CMEX10 glyphs at U+F8EE/F8F0/F8F9/F8FB.

    Those are TeX's PRIVATE-USE code points for the pieces of a large delimiter - real content
    with no Unicode meaning. They are in the glyph stream, so the identity check accepts them,
    and a lint that special-cased "undecodable text is suspicious" would raise a false alarm on
    every display equation in the corpus.
    """
    fragment = ""
    assert all(unicodedata.category(ch) == "Co" for ch in fragment)
    assert all(line in f"prefix{fragment}suffix" for line in _lines_of(fragment))
