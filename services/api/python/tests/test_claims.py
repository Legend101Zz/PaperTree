"""contracts.md §3.4: ``final_text`` is split into claims, and ``verify_grounding`` runs PER CLAIM
over the CITED blocks' ``resolvedText``; a citation is ``supported`` iff every claim citing it is.

Two things decide a citation's flag, and both are pinned here on a real parse (the committed
``resnet-cvpr-2col`` fixture, the same document a stored generation holds):

  * WHICH claim a marker belongs to. The contract fixes the marker's shape (§3.2), not where a
    model puts it, so ``Claim. [b1]`` and ``Claim [b1].`` must attribute ``b1`` to the same claim
    (review M1: a marker after the full stop was given to the NEXT sentence, and a fabricated
    claim's citation came back ``supported: true``).
  * WHICH blocks a claim is checked against: only the ones it cites, never every block the run
    was shown (review M2: nothing failed when grounding used all of them).
"""

from __future__ import annotations

from collections.abc import Mapping

import pytest
from api_support import load_fixture
from papertree_anchoring import IndexedDocument, api_text_stream_id, index_document
from papertree_api.evidence import CitationMinter, cite_answer, split_bullets, split_claims
from papertree_db import new_id
from papertree_document_ir import Paper

FABRICATED = "The method reaches 99.9 percent accuracy on the Mars benchmark"


@pytest.fixture(scope="module")
def resnet() -> IndexedDocument:
    paper = Paper.model_validate(load_fixture("resnet-cvpr-2col"))
    return index_document(
        paper, api_text_stream_id(paper.paper_id, paper.generation, paper.parser.version)
    )


def _minter(document: IndexedDocument, handles: Mapping[str, str]) -> CitationMinter:
    texts = {block_id: document.by_id[block_id].text for block_id in handles.values()}
    return CitationMinter(
        run_id="run_claims", handles=handles, document=document, texts=texts, new_id=new_id
    )


def _two_paragraphs(document: IndexedDocument) -> tuple[str, str, str]:
    """``(b1's block id, b2's block id, b1's first sentence)``: two long paragraphs of different
    sections, and a sentence of b1's (the ``{"b2": False}`` verdicts below are what show that b2
    does not also hold it)."""
    paragraphs = [b for b in document.blocks if b.block.type == "paragraph" and len(b.text) > 200]
    first, second = paragraphs[3], paragraphs[8]
    sentence = first.text.replace("\n", " ").split(". ")[0].rstrip(".")
    return first.block.block_id, second.block.block_id, sentence


def _verdicts(document: IndexedDocument, answer: str) -> dict[str, bool | None]:
    b1, b2, _ = _two_paragraphs(document)
    minter = _minter(document, {"b1": b1, "b2": b2})
    return {c.marker: c.supported for c in cite_answer(answer, minter)}


# ── where the marker sits ────────────────────────────────────────────────────────────────────


def test_a_marker_after_the_full_stop_belongs_to_the_sentence_before_it() -> None:
    assert split_claims("Claim one. [b1] Claim two. [b2]") == [
        "Claim one. [b1]",
        "Claim two. [b2]",
    ]
    assert split_claims("Claim one [b1]. Claim two [b2].") == [
        "Claim one [b1].",
        "Claim two [b2].",
    ]
    assert split_claims("Claim one.[b1] Claim two.[b2]") == ["Claim one.[b1]", "Claim two.[b2]"]
    assert split_claims("Claim one. [b1][b2] [b3, b4] Claim two? [b5] Claim three!") == [
        "Claim one. [b1][b2] [b3, b4]",
        "Claim two? [b5]",
        "Claim three!",
    ]


def test_a_marker_line_belongs_to_the_claim_before_it() -> None:
    assert split_claims("Claim one.\n[b1]\nClaim two [b2].") == [
        "Claim one. [b1]",
        "Claim two [b2].",
    ]
    # A marker that opens the whole answer has no claim before it: it stays with its own.
    assert split_claims("[b1] Claim one. Claim two [b2].") == ["[b1] Claim one.", "Claim two [b2]."]


def test_a_summary_marker_line_belongs_to_the_bullet_before_it() -> None:
    assert split_bullets("- Bullet one.\n[b1]\n- Bullet two [b2].") == [
        "Bullet one. [b1]",
        "Bullet two [b2].",
    ]


def test_an_abbreviation_does_not_end_a_claim() -> None:
    """A split after ``Fig.`` leaves a marker-less fragment that no verifier ever reads (review
    S5): the claim's own words would go unchecked."""
    assert split_claims(
        "As Fig. 3 shows, the error drops [b2]. Eq. (4) is the loss, e.g. Sec. 3.1 [b3]. "
        "He et al. Report it [b4]."
    ) == [
        "As Fig. 3 shows, the error drops [b2].",
        "Eq. (4) is the loss, e.g. Sec. 3.1 [b3].",
        "He et al. Report it [b4].",
    ]


def test_supported_does_not_depend_on_where_the_marker_sits(resnet: IndexedDocument) -> None:
    _, _, true = _two_paragraphs(resnet)
    before = _verdicts(resnet, f"{true} [b1]. {FABRICATED} [b2].")
    after = _verdicts(resnet, f"{true}. [b1] {FABRICATED}. [b2]")
    assert before == after == {"b1": True, "b2": False}
    # The FABRICATION cites b1 now, whichever side of the stop the marker is on: b1 is not
    # supported, and the true sentence (b1's words) cites b2, which does not hold them.
    assert _verdicts(resnet, f"{FABRICATED}. [b1] {true}. [b2]") == {"b1": False, "b2": False}
    assert _verdicts(resnet, f"{FABRICATED} [b1]. {true} [b2].") == {"b1": False, "b2": False}


# ── which blocks a claim is checked against ──────────────────────────────────────────────────


def test_a_claim_is_checked_only_against_the_blocks_it_cites(resnet: IndexedDocument) -> None:
    """b1's own sentence citing b2 is not supported, although the run was shown b1: grounding
    over every block the run saw (instead of the cited ones) would pass it."""
    _, _, true = _two_paragraphs(resnet)
    assert _verdicts(resnet, f"{true} [b2].") == {"b2": False}
    assert _verdicts(resnet, f"{true} [b1]. {true} [b2].") == {"b1": True, "b2": False}
    assert _verdicts(resnet, f"{true} [b2, b1].") == {"b2": True, "b1": True}


# ── S5F: what a citation's flag is made of (honest grounding) ────────────────────────────────
#
# The old rule, "supported iff EVERY claim citing it passes", made a well-grounded citation read
# "not verified" the moment the answer also commented on the passage. The shipped rule: supported
# iff at least one claim citing it is `supported` and none is `unsupported`; commentary that reuses
# some of the passage's words and adds its own is `neutral`. These tests pin both directions.

PASSAGE = (
    "We reframe object detection as a single regression prob-\n"
    "lem, straight from image pixels to bounding box coordi-\n"
    "nates and class probabilities. Using our system, you only look once (YOLO) at an image to "
    "predict what objects are present and where they are. We use ﬁxed classiﬁers."
)
TEXTS = {"blk_a": PASSAGE}
HONEST = (
    "The authors cast object detection as one regression problem from pixels to "
    "bounding-box coordinates and class probabilities"
)
COMMENTARY = (
    "That single regression framing is a deliberate departure from the multi-stage pipelines "
    "the introduction describes next"
)
FAKE_NUMBER = "YOLO reaches 94.2 percent precision on this single regression problem"
INVENTED = "The authors recommend an anchor pyramid with a recurrent language decoder"


def test_the_pdfs_typesetting_does_not_count_against_a_faithful_claim() -> None:
    """`prob- lem`, `coordi- nates` and the `ﬁ` ligature are the PDF's, not the model's."""
    from papertree_api.evidence import claim_verdict

    assert claim_verdict(HONEST, ["blk_a"], TEXTS) == "supported"
    assert claim_verdict("The system uses fixed classifiers", ["blk_a"], TEXTS) == "supported"


def test_commentary_beside_an_honest_claim_does_not_take_the_citation_down() -> None:
    from papertree_api.evidence import citation_supported, claim_verdict

    verdicts = [claim_verdict(c, ["blk_a"], TEXTS) for c in (HONEST, COMMENTARY)]
    assert verdicts == ["supported", "neutral"]
    assert citation_supported(verdicts) is True


def test_commentary_alone_is_not_verified() -> None:
    from papertree_api.evidence import citation_supported, claim_verdict

    assert citation_supported([claim_verdict(COMMENTARY, ["blk_a"], TEXTS)]) is False


@pytest.mark.parametrize("fabricated", [FAKE_NUMBER, INVENTED])
def test_a_fabricated_claim_beside_an_honest_one_takes_the_citation_down(fabricated: str) -> None:
    from papertree_api.evidence import citation_supported, claim_verdict

    verdicts = [claim_verdict(c, ["blk_a"], TEXTS) for c in (HONEST, fabricated)]
    assert verdicts == ["supported", "unsupported"]
    assert citation_supported(verdicts) is False


def test_a_claim_citing_a_block_with_no_text_is_unsupported_not_neutral() -> None:
    from papertree_api.evidence import claim_verdict

    assert claim_verdict(HONEST, ["blk_gone"], TEXTS) == "unsupported"


def test_end_to_end_a_fabricated_second_sentence_flips_the_marker(resnet: IndexedDocument) -> None:
    _, _, true = _two_paragraphs(resnet)
    words = true.split()
    commentary = (
        " ".join(words[: len(words) // 3])
        + " is, in my reading, a notable shift in how researchers think about the broader field"
    )
    assert _verdicts(resnet, f"{true} [b1]. {commentary} [b1].") == {"b1": True}
    assert _verdicts(resnet, f"{true} [b1]. {FABRICATED} [b1].") == {"b1": False}
