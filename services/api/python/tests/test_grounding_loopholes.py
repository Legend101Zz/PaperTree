"""W2API item 3 (S5F reviewer): the two loopholes in the lexical check, and what stays allowed.

  (a) ``_STRUCTURE_REF`` folded "Table 9 on page 14" away, so a sentence naming a table, figure,
      section, equation or page the paper does not have was SUPPORTED. A reference now has to be in
      the cited blocks or somewhere in the paper.
  (b) A name absent from the cited blocks ("Google Brain", "Geoffrey Hinton" cited to the YOLO
      abstract) was only ``neutral``. A name that is in neither the cited blocks nor the paper is
      ``unsupported``; one the paper has elsewhere stays ``neutral`` (uncited, not invented).

``supported`` stays a lexical check (contracts.md §3.4): none of this makes it entailment.
"""

from __future__ import annotations

import pytest
from papertree_agent_tools import named_entities, paper_vocabulary, structure_refs
from papertree_api.evidence import citation_supported, claim_verdict

CORE = "A single network predicts boxes and class probabilities from full images"
ABSTRACT = (
    "We present YOLO, a new approach to object detection. Prior work on object detection "
    "repurposes classifiers to perform detection. Instead, we frame object detection as a "
    "regression problem to spatially separated bounding boxes and associated class "
    "probabilities. A single neural network predicts bounding boxes and class probabilities "
    "directly from full images in one evaluation. Our unified architecture is extremely fast, "
    "processing images in real-time."
)
RESULTS = (
    "Table 1 compares YOLO to other detectors on Pascal VOC 2007. Figure 3 shows the speed and "
    "accuracy trade-off. Section 4.2 describes the comparison to Fast R-CNN."
)
HEADING = "4.2 Comparison to Fast R-CNN"
TEXTS = {"blk_abs": ABSTRACT, "blk_res": RESULTS, "blk_h": HEADING}
PAPER = paper_vocabulary(TEXTS, heading_ids=frozenset({"blk_h"}), page_count=10)


def verdict(claim: str, *blocks: str) -> str:
    return claim_verdict(claim, list(blocks), TEXTS, PAPER)


@pytest.mark.parametrize(
    "claim",
    [
        "YOLO frames detection as one regression problem, as shown in Table 9 on page 14.",
        f"{CORE} (Figure 12).",
        "The real-time architecture is analysed in Section 7.3 of the paper.",
        "The paper's Table 9 lists the per-class results.",
    ],
)
def test_a_reference_to_a_place_the_paper_does_not_have_is_unsupported(claim: str) -> None:
    assert verdict(claim, "blk_abs") == "unsupported"
    assert citation_supported([verdict(claim, "blk_abs")]) is False  # type: ignore[list-item]


@pytest.mark.parametrize(
    "claim",
    [
        f"{CORE}.",
        # The paper has a Table 1, a Figure 3 and a section 4.2 (a heading) even though the cited
        # abstract carries none of them: the old behaviour (the reference is not demanded of the
        # block) is kept for what exists.
        f"{CORE} (Table 1).",
        f"{CORE} (Fig. 3).",
        f"{CORE} (Section 4.2).",
        f"{CORE}, on page 3.",
    ],
)
def test_a_reference_the_paper_has_is_still_fine(claim: str) -> None:
    assert verdict(claim, "blk_abs") == "supported"


def test_a_page_beyond_the_papers_last_page_is_missing_and_the_last_page_is_not() -> None:
    assert verdict(f"{CORE} on page 10.", "blk_abs") == "supported"
    assert verdict(f"{CORE} on page 11.", "blk_abs") == "unsupported"


def test_a_reference_in_the_cited_blocks_needs_no_paper_vocabulary() -> None:
    claim = "Table 1 compares YOLO to other detectors on Pascal VOC 2007"
    assert claim_verdict(claim, ["blk_res"], TEXTS, None) == "supported"
    assert claim_verdict(claim.replace("Table 1", "Table 2"), ["blk_res"], TEXTS, None) == (
        "unsupported"
    )


@pytest.mark.parametrize(
    "claim",
    [
        "YOLO was developed at Google Brain by Geoffrey Hinton.",
        "The detector predicts bounding boxes and class probabilities from full images, a design "
        "Geoffrey Hinton pioneered at Google Brain.",
    ],
)
def test_a_name_in_neither_the_cited_blocks_nor_the_paper_is_unsupported(claim: str) -> None:
    assert verdict(claim, "blk_abs") == "unsupported"


def test_a_name_the_paper_has_elsewhere_is_not_called_invented() -> None:
    claim = "YOLO is compared with Fast R-CNN and Pascal VOC, where it is extremely fast."
    assert verdict(claim, "blk_abs") != "unsupported"


def test_a_name_in_the_cited_block_is_fine_and_a_sentence_opening_capital_is_not_a_name() -> None:
    assert verdict("YOLO predicts bounding boxes and class probabilities directly.", "blk_abs") == (
        "supported"
    )
    assert named_entities("Instead, it frames detection as regression.") == ()
    assert named_entities("**Reproduce** the ablation. Then compare.") == ()
    assert named_entities("It was built at Google Brain by Geoffrey Hinton.") == (
        "Google Brain",
        "Geoffrey Hinton",
    )
    assert named_entities("It uses ML and AI methods.") == ()


def test_structure_refs_are_normalised() -> None:
    assert structure_refs("see Fig. 3, Figures 4, tables 2 and Section 4.2; Eq. (14), pp. 7") == {
        "figure 3",
        "figure 4",
        "table 2",
        "section 4.2",
        "equation 14",
        "page 7",
    }


def test_the_vocabulary_forgives_equations_when_the_text_layer_carries_no_tags() -> None:
    plain = paper_vocabulary({"b": "No equation tags here."})
    assert plain.has_ref("equation 14")
    tagged = paper_vocabulary({"b": "the update rule (3) is applied"})
    assert tagged.has_ref("equation 3") and not tagged.has_ref("equation 14")


def test_a_list_items_own_number_is_not_a_number_the_claim_states() -> None:
    """Found live (W2API): "2. **Amplify** …" in a follow-up read as the number 2 missing from
    the cited block. A list item's own ordinal is dropped; a number inside the claim is not."""
    assert verdict(f"2. {CORE}.", "blk_abs") == "supported"
    assert verdict(f"1) {CORE}.", "blk_abs") == "supported"
    assert verdict(f"{CORE} in 2 passes.", "blk_abs") == "unsupported"
    assert verdict(f"2. {CORE} in 7 passes.", "blk_abs") == "unsupported"


# ---- W2API fix round (review must_fix A, B, C): the real layouts that regressed -----------------

#: DDPM's headings as the index delivers them: the number trails (``...LT\n3.1``), leads on its
#: own line (``3.4\nSimplified ...``), or is missing (``Introduction``, ``Background``).
DDPM_TEXTS = {
    "h_abs": "Abstract",
    "h_intro": "Introduction",
    "h_bg": "Background",
    "h_models": "Diffusion models and denoising autoencoders",
    "h_31": "Forward process and LT\n3.1",
    "h_33": "Data scaling, reverse process decoder, and L0\n3.3",
    "h_34": "3.4\nSimpliﬁed training objective",
    "h_exp": "Experiments",
    "h_41": "4.1\nSample quality",
    "h_44": "4.4\nInterpolation",
    "h_rel": "Related Work",
    "h_con": "Conclusion",
    "h_ref": "References",
    "h_a": "A\nExtended derivations",
    "b_fwd": (
        "The forward process variances are held constant and the KL divergence compares two "
        "Gaussian distributions in closed form, so no Monte Carlo estimate is needed."
    ),
}
DDPM_HEADS = frozenset(k for k in DDPM_TEXTS if k.startswith("h_"))
DDPM = paper_vocabulary(DDPM_TEXTS, heading_ids=DDPM_HEADS, page_count=14)


@pytest.mark.parametrize("ref", ["1", "2", "3", "3.1", "3.3", "3.4", "4", "4.1", "5", "6"])
def test_a_ddpm_section_that_exists_is_in_the_vocabulary(ref: str) -> None:
    assert DDPM.has_ref(f"section {ref}")


@pytest.mark.parametrize("ref", ["12", "9.9", "30"])
def test_a_ddpm_section_that_cannot_exist_is_not(ref: str) -> None:
    assert not DDPM.has_ref(f"section {ref}")


def test_a_fully_numbered_paper_stays_strict() -> None:
    clean = paper_vocabulary(
        {"a": "1. Introduction", "b": "2. Method", "c": "2.1. Network", "d": "3. Results"},
        heading_ids=frozenset("abcd"),
    )
    assert clean.has_ref("section 2.1") and clean.has_ref("section 3")
    assert not clean.has_ref("section 4") and not clean.has_ref("section 2.2")


@pytest.mark.parametrize(
    "claim",
    [
        "Section 2 rewrites the variational bound as a sum of KL terms.",
        "The riskiest choice in Section 3.1 is fixing the forward process variances.",
        "Section 5 compares the approach with related work.",
    ],
)
def test_a_real_ddpm_section_reference_does_not_make_a_claim_unsupported(claim: str) -> None:
    got = claim_verdict(claim, ["b_fwd"], DDPM_TEXTS, DDPM)
    assert got != "unsupported"


def test_an_invented_ddpm_section_still_does() -> None:
    claim = "Section 30 rewrites the variational bound as a sum of KL terms."
    assert claim_verdict(claim, ["b_fwd"], DDPM_TEXTS, DDPM) == "unsupported"


@pytest.mark.parametrize(
    "claim",
    [
        "Every KL divergence here is Gaussian-vs-Gaussian, so it can be computed in closed form.",
        "The forward process uses a Rao-Blackwellized Gaussian-based estimate in closed form.",
    ],
)
def test_a_capitalised_hyphen_compound_of_a_present_word_is_not_an_absent_name(
    claim: str,
) -> None:
    assert claim_verdict(claim, ["b_fwd"], DDPM_TEXTS, DDPM) != "unsupported"


def test_a_hyphen_compound_of_absent_words_is_still_an_absent_name() -> None:
    claim = "The forward process uses Hinton-Bengio style pretraining with closed form updates."
    assert claim_verdict(claim, ["b_fwd"], DDPM_TEXTS, DDPM) == "unsupported"


def test_a_numeric_part_of_a_compound_does_not_vouch_for_the_name() -> None:
    claim = "Evaluation on Zork-10 shows closed form updates."
    texts = {"b": "Closed form updates on 10 datasets."}
    assert claim_verdict(claim, ["b"], texts, paper_vocabulary(texts)) == "unsupported"


def test_roman_numeral_tables_are_tables() -> None:
    assert structure_refs("TABLE II lists the results and Fig. IV the curves") >= {
        "table 2",
        "figure 4",
    }
    texts = {"b": "TABLE II lists the results of the models, with scores."}
    paper = paper_vocabulary(texts)
    claim = "Table 2 lists the results of the models, with scores."
    assert claim_verdict(claim, ["b"], texts, paper) == "supported"
    assert (
        claim_verdict("Table 3 lists the results of the models, with scores.", ["b"], texts, paper)
        == "unsupported"
    )
