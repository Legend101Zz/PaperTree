"""`fresh.py`: the S2 fresh-set scorer, on hand-built documents whose answers are known.

The gold unit is an ANCHOR (the first printed words of a paragraph), so every metric here is a
statement about which parser BLOCK each anchor lands in. The documents below are built so each
metric has exactly one right answer, including the two ways a scorer silently lies: a merged
paragraph counted as found-and-fine, and a split one counted as missing.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from papertree_evaluation.fresh import (
    FRESH_GOLD,
    FRESH_PDFS,
    is_numeric_only,
    linearise,
    load_fresh_gold,
    normalise_anchor,
    render_fresh_report,
    score_fresh_paper,
)


def _block(
    block_id: str,
    kind: str,
    text: str,
    *,
    page: int = 0,
    flow: str = "body",
    children: list[str] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "block_id": block_id,
        "type": kind,
        "text": text,
        "page_index": page,
        "flow": flow,
    }
    if children:
        out["child_ids"] = children
    return out


def _document(
    blocks: list[dict[str, Any]], relations: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    pages: dict[int, dict[str, list[str]]] = {}
    for block in blocks:
        if block.get("nested"):
            continue
        flows = pages.setdefault(
            block["page_index"],
            {k: [] for k in ("body", "caption", "footnote", "header", "footer", "margin")},
        )
        flows[block["flow"]].append(block["block_id"])
    return {
        "blocks": blocks,
        "pages": [{"index": i, "flows": f} for i, f in sorted(pages.items())],
        "relations": relations or [],
    }


GOLD: dict[str, Any] = {
    "toy": {
        "order": [
            [1, "front", "A Toy Paper About Things"],
            [1, "heading", "Abstract"],
            [1, "body", "We study toys."],
            [1, "heading", "1 Introduction"],
            [1, "body", "Toys are everywhere in the world"],
            [1, "body", "Second paragraph starts here"],
            [2, "cont", "and it continues on the second page"],
            [2, "body", "After the display the text resumes", {"alt_kind": "cont"}],
            [2, "cont", "which gives us a continuation", {"alt_kind": "body"}],
        ],
        "floats": [[2, "caption", "Figure 1: A toy figure", "figure"]],
        "headings": ["Abstract", "1 Introduction"],
        "run_in_headings": [],
    }
}


def _clean() -> dict[str, Any]:
    """A parse that gets everything right: one block per gold unit, right types, gold order."""
    return _document(
        [
            _block("t", "title", "A Toy Paper About Things"),
            _block("h0", "heading", "Abstract"),
            _block("a", "abstract", "We study toys."),
            _block("h1", "heading", "1 Introduction"),
            _block("p1", "paragraph", "Toys are everywhere in the world, it is known."),
            _block("p2", "paragraph", "Second paragraph starts here and goes on."),
            _block("c1", "paragraph", "and it continues on the second page.", page=1),
            _block("p3", "paragraph", "After the display the text resumes.", page=1),
            _block("c2", "paragraph", "which gives us a continuation.", page=1),
            _block("cap", "caption", "Figure 1: A toy figure.", page=1, flow="caption"),
            _block("fig", "figure", "", page=1),
        ],
        [{"type": "caption_of", "from": "cap", "to": "fig"}],
    )


class TestNormalisation:
    def test_case_hyphens_ligatures_and_spaces_do_not_decide_a_match(self) -> None:
        assert normalise_anchor("Uniﬁed  De-\ntection") == normalise_anchor("UNIFIED detection")

    def test_numeric_only(self) -> None:
        assert is_numeric_only("66.4") and is_numeric_only("(3)") and is_numeric_only(" 830 ")
        assert not is_numeric_only("2.1 Network Design") and not is_numeric_only("")


class TestACleanParse:
    def test_scores_perfectly(self) -> None:
        score = score_fresh_paper("toy", _clean(), GOLD)
        assert score.found == score.units == 9
        assert score.merged_paragraphs == {"gold": 0, "alt_kind": 0}
        assert score.mistyped == [] and score.false_headings == []
        assert (score.headings_typed, score.headings_gold) == (2, 2)
        assert score.title_first
        assert score.pairwise == 1.0
        assert (score.captions_paired, score.captions_gold) == (1, 1)
        assert score.unanchored_prose == [] and score.split_anchors == []

    def test_paragraph_counts_follow_both_readings_of_the_open_ruling(self) -> None:
        score = score_fresh_paper("toy", _clean(), GOLD)
        # gold: four `body` units open four paragraphs and the two conts join theirs. alt_kind:
        # "After the display" becomes a cont (joining "Second paragraph"'s chain) and "which gives
        # us" a body - four again, but not the same four, which the merge test below relies on.
        assert score.paragraphs == {"gold": 4, "alt_kind": 4}


class TestMerges:
    def test_two_gold_paragraphs_in_one_block_are_two_merged_paragraphs(self) -> None:
        document = _clean()
        document["blocks"][4]["text"] = (
            "Toys are everywhere in the world, it is known. Second paragraph starts here."
        )
        document["blocks"] = [b for b in document["blocks"] if b["block_id"] != "p2"]
        document["pages"][0]["flows"]["body"].remove("p2")
        score = score_fresh_paper("toy", document, GOLD)
        assert score.merged_paragraphs["gold"] == 2
        assert score.merged_blocks["gold"] == 1

    def test_a_paragraph_kept_whole_across_its_display_is_a_merge_only_under_one_reading(
        self,
    ) -> None:
        """The open owner ruling, made measurable: "which gives us" is `cont` in the gold and
        `body` under `alt_kind`, so a block holding both sides of the display merges nothing
        under the first reading and two paragraphs under the second."""
        document = _clean()
        document["blocks"][7]["text"] = (
            "After the display the text resumes. which gives us a continuation."
        )
        document["blocks"] = [b for b in document["blocks"] if b["block_id"] != "c2"]
        document["pages"][1]["flows"]["body"].remove("c2")
        score = score_fresh_paper("toy", document, GOLD)
        assert score.merged_paragraphs == {"gold": 0, "alt_kind": 2}

    def test_a_continuation_in_its_own_block_is_not_a_merge(self) -> None:
        assert score_fresh_paper("toy", _clean(), GOLD).merged_paragraphs["gold"] == 0


class TestSplitsAndFragments:
    def test_an_anchor_split_across_blocks_is_found_and_flagged_not_missing(self) -> None:
        document = _clean()
        document["blocks"][0]["text"] = "A Toy Paper"
        document["blocks"].insert(1, _block("t2", "title", "About Things"))
        document["pages"][0]["flows"]["body"].insert(1, "t2")
        score = score_fresh_paper("toy", document, GOLD)
        assert score.missing == []
        assert len(score.split_anchors) == 1 and "front" in score.split_anchors[0]

    def test_a_fragment_starting_at_no_gold_unit_is_counted_whatever_its_type(self) -> None:
        document = _clean()
        document["blocks"].insert(5, _block("frag", "heading", "T"))
        document["blocks"].insert(5, _block("frag2", "paragraph", "mid-sentence fragment"))
        document["pages"][0]["flows"]["body"][5:5] = ["frag2", "frag"]
        score = score_fresh_paper("toy", document, GOLD)
        assert sorted(score.unanchored_prose) == ["T", "mid-sentence fragment"]


class TestTypesAndOrder:
    def test_prose_outside_the_abstract_typed_abstract_is_mistyped(self) -> None:
        document = _clean()
        document["blocks"][5]["type"] = "abstract"
        score = score_fresh_paper("toy", document, GOLD)
        assert [kind for _, kind in score.mistyped] == ["abstract"]

    def test_a_numeric_heading_is_false_and_counted_numeric(self) -> None:
        document = _clean()
        document["blocks"].append(_block("n", "heading", "66.4"))
        document["pages"][0]["flows"]["body"].append("n")
        score = score_fresh_paper("toy", document, GOLD)
        assert score.false_headings == ["66.4"]
        assert score.numeric_headings_whole_paper == ["66.4"]

    def test_a_title_read_after_the_abstract_is_not_first(self) -> None:
        document = _clean()
        body = document["pages"][0]["flows"]["body"]
        body.remove("t")
        body.insert(3, "t")
        score = score_fresh_paper("toy", document, GOLD)
        assert not score.title_first
        assert score.pairwise is not None and score.pairwise < 1.0

    def test_a_caption_linked_to_the_wrong_kind_of_float_is_not_paired(self) -> None:
        document = _clean()
        document["blocks"][-1]["type"] = "table"
        assert score_fresh_paper("toy", document, GOLD).captions_paired == 0


def test_linearise_reads_flows_in_order_and_descends_into_children() -> None:
    document = _document(
        [
            _block("p", "paragraph", "prose", children=["i"]),
            _block("f", "footnote", "note", flow="footnote"),
        ]
    )
    document["blocks"].append({**_block("i", "inline_equation", "x"), "nested": True})
    assert [item.block_id for item in linearise(document)] == ["p", "i", "f"]


def test_the_report_carries_the_provenance_in_every_row() -> None:
    report = render_fresh_report([score_fresh_paper("toy", _clean(), GOLD)])
    rows = [line for line in report.splitlines() if line.startswith("| toy") or "pooled" in line]
    assert rows and all("owner review pending" in row for row in rows)


def test_the_committed_gold_is_the_one_scored_and_says_it_is_unreviewed() -> None:
    gold = load_fresh_gold(FRESH_GOLD)
    assert gold["_provenance"]["owner_review"] == "pending"
    papers = [k for k in gold if not k.startswith("_")]
    assert len(papers) == 6 and all(gold[p]["order"] for p in papers)


@pytest.mark.skipif(
    not (FRESH_PDFS / "yolo-1506.02640.pdf").is_file(),
    reason="the fresh set is gitignored; fetch it with ./research/benchmarks/fresh/fetch_fresh.sh",
)
def test_a_real_parse_of_yolo_is_scored_on_every_unit(tmp_path: Path) -> None:
    """The scorer on a REAL parse: every one of YOLO's 34 units is found (split or whole)."""
    from papertree_document_worker.pipeline import parse_document

    paper = parse_document(
        FRESH_PDFS / "yolo-1506.02640.pdf",
        paper_id="ppr_0123456789ABCDEFGHJKMNP0TV",
        asset_root=tmp_path,
    ).paper
    score = score_fresh_paper(
        "yolo-1506.02640",
        paper.model_dump(mode="json", by_alias=True, exclude_unset=True),
        load_fresh_gold(FRESH_GOLD),
    )
    assert (score.found, score.units) == (34, 34), score.missing


def test_the_cli_refuses_without_the_pdfs_and_names_the_fetch_script(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    from papertree_evaluation.__main__ import main

    assert main(["fresh", "--pdfs", str(tmp_path), "--assets", str(tmp_path / "a")]) == 1
    assert "fetch_fresh.sh" in capsys.readouterr().err


FRESH_SET = (
    "ddpm-2006.11239",
    "yolo-1506.02640",
    "flashattention-2205.14135",
    "sbert-1908.10084",
    "adam-1412.6980",
    "maskrcnn-1703.06870",
)
#: Merged gold paragraphs on pp1-2 at 7051862 (`s2/parse-robustness`, the first commit at which all
#: six parse - DDPM and Mask R-CNN dead-lettered at 18f69ec), scored by THIS module on THIS gold:
#: DDPM 3, YOLO 21, FlashAttention 6, SBERT 13, Adam 5, Mask R-CNN 10.
MERGED_AT_BRANCH_1 = 58
#: (gold reading, `alt_kind` reading) per paper, after paragraph splitting.
MERGED_PINS = {
    "ddpm-2006.11239": (0, 0),
    "yolo-1506.02640": (4, 4),
    "flashattention-2205.14135": (0, 0),
    "sbert-1908.10084": (2, 2),
    "adam-1412.6980": (2, 2),
    "maskrcnn-1703.06870": (2, 2),
}
#: Running-text blocks on pp1-2 starting at no gold unit (13/9/8/6/12/8 = 56 at 7051862).
UNANCHORED_PINS = {
    "ddpm-2006.11239": 13,
    "yolo-1506.02640": 8,
    "flashattention-2205.14135": 8,
    "sbert-1908.10084": 5,
    "adam-1412.6980": 12,
    "maskrcnn-1703.06870": 8,
}


@pytest.mark.skipif(
    not all((FRESH_PDFS / f"{name}.pdf").is_file() for name in FRESH_SET),
    reason="the fresh set is gitignored; fetch it with ./research/benchmarks/fresh/fetch_fresh.sh",
)
def test_merged_paragraphs_on_the_fresh_set_are_at_most_half_of_branch_1(tmp_path: Path) -> None:
    """Slice-plan §S2 merge rule: "merged gold paragraphs on fresh pages 1-2 reduced by at least
    half against the baseline", on a REAL parse of all six papers. Pinned exactly (the parser is
    deterministic) under BOTH readings of the open `cont`-after-display ruling, with the
    over-segmentation guard beside it: a parser that cut every line into a block would merge
    nothing, and `unanchored_prose` is what would say so. Provisional: 2 model annotators +
    adjudicator, owner review pending."""
    from papertree_document_worker.pipeline import parse_document

    gold = load_fresh_gold(FRESH_GOLD)
    merged: dict[str, tuple[int, int]] = {}
    unanchored: dict[str, int] = {}
    for name in FRESH_SET:
        paper = parse_document(
            FRESH_PDFS / f"{name}.pdf",
            paper_id="ppr_0123456789ABCDEFGHJKMNP0TV",
            asset_root=tmp_path / name,
        ).paper
        score = score_fresh_paper(
            name, paper.model_dump(mode="json", by_alias=True, exclude_unset=True), gold
        )
        merged[name] = (score.merged_paragraphs["gold"], score.merged_paragraphs["alt_kind"])
        unanchored[name] = len(score.unanchored_prose)
    assert sum(gold_reading for gold_reading, _ in merged.values()) <= MERGED_AT_BRANCH_1 // 2
    assert merged == MERGED_PINS
    assert unanchored == UNANCHORED_PINS
