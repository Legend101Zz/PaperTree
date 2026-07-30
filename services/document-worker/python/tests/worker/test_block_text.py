"""F1.2 - `worker/repairs.spec`: every text mutation is recorded, and there are almost none.

The acceptance criterion is "Every text mutation appears in `repairs[]` with `from` and `to`.
No mutation is silent." This suite proves the stronger property that makes it trivially true:
**the parser does not mutate at all.** `Block.text` is the PDF's own glyph stream with U+000A
between lines, which is exactly what the three golden fixtures contain.

The one deviation the parser proposes - dehyphenation at a line break - is emitted as a repair
with `applied: false`, so `Block.text` still carries the hyphen and the reading is *declared*
rather than *performed*. That is checked here against the validator's OWN rule-30b transform
(`validate._dehyphenate`), not against a second copy of the rule written for the test: 30b's
whole point is that a deterministic repair must be reproducible, and a test that re-implements
the transform would agree with a wrong implementation.

findings.md B7 is the failure being replaced: `_clean_text` mapped U+2212 MINUS to ASCII hyphen
inside the ligature table, with no record. `test_minus_sign_and_ligatures_survive_verbatim` is
the direct regression.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from _corpus_manifest import CORPUS_DIR as CORPUS
from _corpus_manifest import CORPUS_FILES, requires_corpus
from papertree_document_ir import Repair
from papertree_document_ir.identity import content_hash, normalise_text, resolved_text
from papertree_document_ir.validate import _dehyphenate
from papertree_document_worker.pdf import SourceDocument
from papertree_document_worker.text import build_block_text, is_dehyphenatable

# EVERY test below needs the corpus, which is gitignored. Module-level so the skip carries a
# reason even for the parametrised ones - a `parametrize` over an empty glob collects ZERO
# cases and reports nothing at all, which is how the first CI run on this branch "passed"
# these while running none of them. See tests/conftest.py.
pytestmark = requires_corpus


class _BlockLike:
    """The duck type `resolved_text` needs - it takes any object with `.text` and `.repairs`."""

    def __init__(self, text: str, repairs: list[Repair]) -> None:
        self.text = text
        self.repairs = repairs


@pytest.mark.parametrize("path", CORPUS_FILES, ids=lambda p: p.name)
def test_spans_satisfy_rules_25_and_26_on_every_block(path: Path) -> None:
    """Rule 25: `0 <= start < end <= len(text)`. Rule 26: non-overlapping, ascending."""
    with SourceDocument(path) as doc:
        for page in doc.pages():
            for block in page.text_blocks:
                built = build_block_text(block.lines)
                previous_end = 0
                for span in built.spans:
                    assert 0 <= span.start < span.end <= len(built.text)
                    assert span.start >= previous_end, "rule 26: spans overlap or run backwards"
                    previous_end = span.end


@pytest.mark.parametrize("path", CORPUS_FILES, ids=lambda p: p.name)
def test_every_span_carries_a_positive_size(path: Path) -> None:
    """EPIC-02-RESULT §2.3's actual ask, met at source.

    `size` is optional in the schema and absent on 118 of 727 spans in Epic 0's hand-built
    fixtures. It is never absent from MuPDF, so there is no reason for it to be absent here.
    """
    with SourceDocument(path) as doc:
        for page in doc.pages():
            for block in page.text_blocks:
                for span in build_block_text(block.lines).spans:
                    assert span.size is not None and span.size > 0


@pytest.mark.parametrize("path", CORPUS_FILES, ids=lambda p: p.name)
def test_every_repair_satisfies_rules_27_and_30b(path: Path) -> None:
    """The two rules that stop a "deterministic repair" from being an arbitrary rewrite.

    Rule 27 (`applied: false`): `text[at : at+len(from)] == from`.
    Rule 30b: `dehyphenate(from) == to`, recomputed by the validator's own transform.
    """
    seen = 0
    with SourceDocument(path) as doc:
        for page in doc.pages():
            for block in page.text_blocks:
                built = build_block_text(block.lines)
                for repair in built.repairs:
                    seen += 1
                    assert repair.applied is False, "the parser proposes, it does not perform"
                    assert repair.kind == "dehyphenate"
                    assert repair.at is not None
                    assert built.text[repair.at : repair.at + len(repair.from_)] == repair.from_
                    assert _dehyphenate(repair.from_) == repair.to
                    # D4: a deterministic kind may not name a model. The schema enforces it too;
                    # asserted here because the reverse mistake is what makes a model edit look
                    # deterministic.
                    assert repair.model_id is None
                    assert repair.prompt_hash is None
    assert seen > 0, f"{path.name} produced no hyphenation at all, which is implausible"


@pytest.mark.parametrize("path", CORPUS_FILES, ids=lambda p: p.name)
def test_no_repair_is_ever_applied_so_text_is_the_glyph_stream(path: Path) -> None:
    """The whole criterion, stated as the property that makes it hold.

    If nothing is ever applied, `Block.text` is by construction the concatenation of the PDF's
    own glyphs, and a silent mutation is not merely forbidden - it is unrepresentable.
    """
    with SourceDocument(path) as doc:
        for page in doc.pages():
            for block in page.text_blocks:
                built = build_block_text(block.lines)
                assert not any(r.applied for r in built.repairs)
                glyphs = "".join(s.text for line in block.lines for s in line.spans)
                assert built.text.replace("\n", "") == glyphs


def test_minus_sign_and_ligatures_survive_verbatim() -> None:
    """The direct regression for findings.md B7.

    The old `_clean_text` mapped U+2212 MINUS SIGN to ASCII hyphen in the same table as its
    ligature repair, silently. Both must reach `Block.text` unchanged - and the ligature must
    still be expanded by `normalise_text`, because that is where normalisation belongs.
    """
    found_ligature = False
    found_minus = False
    with SourceDocument(CORPUS / "neural-odes-mathheavy.pdf") as doc:
        for page in doc.pages():
            for block in page.text_blocks:
                text = build_block_text(block.lines).text
                if "ﬁ" in text or "ﬂ" in text:
                    found_ligature = True
                if "−" in text:
                    found_minus = True
                    assert "−" in text, "U+2212 must not become ASCII hyphen"
    assert found_ligature, "expected U+FB01/U+FB02 to survive into Block.text"
    assert found_minus, "expected U+2212 MINUS to survive into Block.text"

    # And the normalisation half, which is where ligature expansion is SUPPOSED to happen.
    assert normalise_text("classiﬁcation") == "classification"
    # U+2212 is NOT a ligature and NOT whitespace, so normalisation leaves it alone too. This is
    # the assertion that says the fix is "do not rewrite", not "rewrite somewhere else".
    assert "−" in normalise_text("x − 1")


def test_a_hyphen_proposal_round_trips_through_resolved_text() -> None:
    """`resolved_text(..., apply_proposed=True)` is the sanctioned way to read the joined word.

    Asserted end-to-end rather than by inspecting the repair, because the point of proposing
    instead of applying is that a consumer can actually get the other reading.
    """
    with SourceDocument(CORPUS / "resnet-cvpr-2col.pdf") as doc:
        page = doc.page(0)
    built = next(b for b in (build_block_text(t.lines) for t in page.text_blocks) if b.repairs)

    default = resolved_text(_BlockLike(built.text, list(built.repairs)))
    assert default.text == built.text, "default must return text verbatim"
    assert not default.contains_proposed_text

    applied = resolved_text(_BlockLike(built.text, list(built.repairs)), apply_proposed=True)
    assert applied.contains_proposed_text
    assert len(applied.applied_proposals) == len(built.repairs)
    assert not applied.skipped_proposals, "a proposal that does not verify is a rule-27 breach"
    assert len(applied.text) == len(built.text) - 2 * len(built.repairs)
    assert "-\n" not in applied.text


def test_content_hash_and_normalised_text_come_from_the_library() -> None:
    """Rules 28 and 29: both must be the library's exact output, never a local reimplementation."""
    with SourceDocument(CORPUS / "resnet-cvpr-2col.pdf") as doc:
        page = doc.page(0)
    text = build_block_text(page.text_blocks[3].lines).text

    digest = content_hash(text)
    assert digest.startswith("sha256:"), "the algorithm prefix is mandatory and is NOT blake2s"
    assert len(digest) == len("sha256:") + 64, "the full 32 bytes; unlike block_id, untruncated"

    # The substantive claim: `content_hash` digests `normalise_text(text)`, so any two strings
    # with the same normalisation MUST collide. If the worker ever grew its own normaliser, or
    # pre-normalised before hashing, these stop being equal.
    assert content_hash("  Deep   Residual\tLearning  ") == content_hash("deep residual learning")
    assert content_hash("classiﬁcation") == content_hash("CLASSIFICATION"), (
        "ligature expansion and case folding both happen inside normalise_text"
    )
    # ...and strings that differ in a way normalisation does NOT erase must not collide. Without
    # this, a normaliser that returned "" for everything would pass the line above.
    assert content_hash("x − 1") != content_hash("x - 1"), "U+2212 is not folded to ASCII hyphen"

    # `content_hash` takes RAW text: hashing pre-normalised text would digest a doubly-normalised
    # string. Idempotence is what makes that mistake invisible, so it is asserted rather than
    # relied on.
    assert normalise_text(normalise_text(text)) == normalise_text(text)


@pytest.mark.parametrize(
    ("line", "next_line", "expected", "why"),
    [
        ("residual learn-", "ing framework", True, "ordinary soft hyphenation"),
        ("com-", "plicated", True, "the neural-odes fixture case"),
        ("self-", "Attention", False, "a proper noun after a hyphen is a real compound"),
        ("ImageNet-", "1k", False, "a digit is not a word continuation"),
        ("2015-", "2016", False, "a year range is not hyphenation"),
        ("end --", "dash", False, "a double hyphen is an em-dash, not a break"),
        ("trailing ", "word", False, "no hyphen at all"),
        ("word-", "", False, "nothing follows"),
        ("non‑", "breaking", False, "U+2011 means never break here"),
    ],
)
def test_hyphenation_detection_is_conservative(
    line: str, next_line: str, expected: bool, why: str
) -> None:
    """A false positive welds two words together silently; a false negative leaves a visible
    hyphen a reader can interpret. The asymmetry is why every clause here is a conjunction."""
    assert is_dehyphenatable(line, next_line) is expected, why
