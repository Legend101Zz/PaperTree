"""What the Python side can prove on its own — and the vectors that hand the rest to TypeScript.

Nothing in this module asserts that a selector RESOLVES. It cannot: the resolver is TypeScript and
#72 option 2 is the decision that it stays there. ``test/python-conformance.spec.ts`` runs the real
ladder over the vectors written here, and that is the graded assertion.
"""

from __future__ import annotations

import hashlib
import json
import os
import unicodedata
from collections import Counter

import pytest
from _fixtures import (
    FIXTURE_SLUGS,
    VECTOR_FILE,
    build_vectors,
    load_document,
    load_paper,
    render_vectors,
)
from papertree_anchoring import capture_selectors, normalise_for_match
from papertree_anchoring.quotenorm import HYPHENS, NEWLINES

#: Re-derived here rather than quoted: 57 + 81 + 61. ``fixtures/README.md`` states 199 and it holds.
EXPECTED_BLOCKS = {
    "attention-is-all-you-need": 57,
    "neural-odes-mathheavy": 81,
    "resnet-cvpr-2col": 61,
}


@pytest.mark.parametrize("slug", FIXTURE_SLUGS)
def test_reading_order_reaches_every_block_exactly_once(slug: str) -> None:
    """Step 4 of the order exists so a block no flow lists is included rather than dropped.

    Losing a block from the stream is how offsets silently shift for everything after it, so the
    denominator is asserted and not eyeballed.
    """
    doc = load_document(slug)
    ids = [indexed.block.block_id for indexed in doc.blocks]
    assert len(ids) == EXPECTED_BLOCKS[slug] == len(load_paper(slug).blocks)
    assert len(set(ids)) == len(ids)


@pytest.mark.parametrize("slug", FIXTURE_SLUGS)
def test_every_block_slices_out_of_the_stream_as_its_own_text(slug: str) -> None:
    """``stream[start:end] == text`` for every block — the invariant T2's offsets are.

    If the cursor and the concatenation ever disagree by one, this is the only place it is visible
    before the offsets reach a stored anchor, where they are permanent.
    """
    doc = load_document(slug)
    for indexed in doc.blocks:
        assert doc.stream[indexed.stream_start : indexed.stream_end] == indexed.text


@pytest.mark.parametrize("slug", FIXTURE_SLUGS)
def test_block_text_hash_is_the_shipped_one(slug: str) -> None:
    """``BlockSelector.blockTextHash`` is ``Block.content_hash`` VERBATIM, absence included.

    Absence is the load-bearing half and the reason a recomputation cannot substitute. 15 of the
    199 blocks (figure, table, unknown) ship no ``content_hash`` at all; ``document.ts:384`` maps
    that to the empty string on the resolver side, so capture must too. A Python capture that
    recomputed would emit ``content_hash("")`` for those and T1 would stop matching — measured, and
    it is the mutation recorded in the PR body.
    """
    doc = load_document(slug)
    for indexed in doc.blocks:
        selector = capture_selectors(doc, indexed.block.block_id)[0]
        assert selector["type"] == "BlockSelector"
        assert selector["blockTextHash"] == (indexed.block.content_hash or "")


@pytest.mark.parametrize("slug", FIXTURE_SLUGS)
def test_whole_block_position_selector_is_the_blocks_own_stream_range(slug: str) -> None:
    doc = load_document(slug)
    for indexed in doc.blocks:
        position = next(
            s
            for s in capture_selectors(doc, indexed.block.block_id)
            if s["type"] == "TextPositionSelector"
        )
        assert (position["start"], position["end"]) == (indexed.stream_start, indexed.stream_end)


def test_de_hyphenation_joins_a_broken_word_and_leaves_a_range_alone() -> None:
    """The hyphen rule from ``quotenorm.ts:22-30``, with the three cases it names.

    THE SPACES ARE MISSING ON PURPOSE, and the reason is a finding about the TypeScript module
    rather than a Python defect. ``normaliseForMatch`` says it collapses whitespace runs to one
    U+0020 (and ``types.ts:116`` calls the result "ws-collapsed"), but pass 3 folds every collapsed
    code point through ``normalise_text`` INDIVIDUALLY, and ``normalise_text(" ")`` is ``""``
    because step 3 of the identity fold strips whitespace at both ends of its input. So every
    internal space is deleted and the normalised form is ws-DELETED, not ws-collapsed. Verified
    against the TypeScript module directly: ``"2015-\\n2016"`` → ``"2015-2016"`` and ``"a b"`` →
    ``"ab"`` in BOTH bindings, offset maps included. Asserted here as the measured behaviour so that
    the day it is fixed on one side, this fails on the other instead of drifting silently.
    """
    assert normalise_for_match("transduc-\ntion").text == "transduction"
    assert normalise_for_match("2015-\n2016").text == "2015-2016"
    assert normalise_for_match("Kaiming-\nHe").text == "kaiming-he"
    # A hyphen that is not at a line end is a real hyphen and must survive.
    assert normalise_for_match("state-of-the-art").text == "state-of-the-art"
    assert normalise_for_match("a b").text == "ab"
    # The map is the half a resolver depends on: normalised offset -> raw offset, one longer.
    folded = normalise_for_match("ﬁne  text")
    assert (folded.text, folded.raw_offset_at) == ("finetext", (0, 0, 1, 2, 5, 6, 7, 8, 9))


def test_no_hyphen_site_reaches_the_property_divergence() -> None:
    """``str.isalpha()`` is not ``\\p{Alphabetic}``, so measure the gap instead of assuming it away.

    The two can only disagree where the character beside a line-break hyphen is ``Nl`` (added back)
    or ``Other_Alphabetic`` (not). Measured on all three streams: 84 sites, 0 of them exposed.
    """
    sites = 0
    exposed = 0
    for slug in FIXTURE_SLUGS:
        stream = load_document(slug).stream
        for i, char in enumerate(stream):
            if char not in HYPHENS or i + 1 >= len(stream) or stream[i + 1] not in NEWLINES:
                continue
            sites += 1
            j = i + 1
            while j < len(stream) and stream[j] in NEWLINES:
                j += 1
            neighbours = [stream[i - 1] if i > 0 else None, stream[j] if j < len(stream) else None]
            exposed += sum(
                1
                for c in neighbours
                if c is not None
                and not c.isalpha()
                and unicodedata.category(c) in ("Mn", "Mc", "So", "Nl")
            )
    assert (sites, exposed) == (84, 0)


def test_capture_refuses_a_block_this_parse_does_not_contain() -> None:
    """An anchor over a block that is not here is not a partial anchor, it is a wrong one."""
    with pytest.raises(KeyError):
        capture_selectors(load_document("resnet-cvpr-2col"), "blk_notinthisdocument")


def test_conformance_vectors_are_current() -> None:
    """The committed vectors are exactly what this code produces today.

    Regenerate with ``PAPERTREE_WRITE_VECTORS=1``. It never writes on a normal run, because CI's
    drift step is a whole-tree ``git status --porcelain --untracked-files=all`` and a test that
    rewrites a tracked file turns it red for a reason nobody can read.
    """
    rendered = render_vectors(build_vectors())
    if os.environ.get("PAPERTREE_WRITE_VECTORS") == "1":
        VECTOR_FILE.parent.mkdir(parents=True, exist_ok=True)
        VECTOR_FILE.write_text(rendered, encoding="utf-8")
    assert VECTOR_FILE.read_text(encoding="utf-8") == rendered


def test_committed_vectors_cover_every_block_type_and_carry_the_stream_digest() -> None:
    """46 vectors, one per (fixture, block type) — and the digest the TypeScript side checks.

    The digest is the whole cross-language contract in one field: if the two readings of
    ``Page.flows`` ever diverge by one block, the stream differs and this fails on both sides at
    once instead of surfacing later as an anchor that lands a paragraph away.
    """
    payload = json.loads(VECTOR_FILE.read_text(encoding="utf-8"))
    vectors = payload["vectors"]
    assert len(vectors) == 46
    assert len({(v["fixture"], v["blockType"]) for v in vectors}) == 46
    # The textless blocks must be IN here; they are the ones every text tier declines.
    assert {v["blockType"] for v in vectors} >= {
        "figure",
        "table",
        "unknown",
        "page_number",
        "table_cell",
    }
    for slug in FIXTURE_SLUGS:
        digest = "sha256:" + hashlib.sha256(load_document(slug).stream.encode("utf-8")).hexdigest()
        assert payload["stream_sha256"][slug] == digest


def test_the_vectors_actually_carry_the_selectors_they_claim_to() -> None:
    """A census with hard denominators, and it exists to close a hole in the vector design.

    ``_expectations`` derives the predicted tier from the anchor, so DELETING a selector would move
    the claim and the outcome together and the TypeScript side would stay green — the drop would be
    invisible on both. These counts are not derived from anything: 46 blocks, all six selector kinds
    where the block supports them, 39 with text and 18 inside a section. Delete an emit and this is
    the test that goes red.
    """
    payload = json.loads(VECTOR_FILE.read_text(encoding="utf-8"))
    census = Counter(s["type"] for v in payload["vectors"] for s in v["anchor"]["selectors"])
    assert dict(census) == {
        "BlockSelector": 46,
        "PageSelector": 46,
        "TextPositionSelector": 46,
        "TextQuoteSelector": 39,
        "ShapeSelector": 46,
        "SectionPathSelector": 18,
    }
