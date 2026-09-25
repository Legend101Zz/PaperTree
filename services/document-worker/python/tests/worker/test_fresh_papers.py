"""S2 (#141): the real-parse half of "no real paper may dead-letter", on the fresh set.

Gated on `./research/benchmarks/fresh/fetch_fresh.sh` (the PDFs are gitignored), and it skips
with that script named when they are absent. `test_parse_robustness.py` builds each defect's
shape synthetically so CI still exercises the fix; this file proves it on the paper it came from,
because a producer-side fix that only passes on a fixture its author wrote is the defect class
`AGENTS.md` §4 records.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from _corpus_manifest import FRESH_DIR, FRESH_PARAMS, requires_fresh
from papertree_document_ir.validate import validate_paper
from papertree_document_worker.pipeline import parse_document

PAPER_ID = "ppr_0123456789ABCDEFGHJKMNP0TV"


@requires_fresh
def test_ddpm_parses(tmp_path: Path) -> None:
    """DDPM (arXiv 2006.11239v2) dead-lettered twice over: G7 on page 0's overhanging raster,
    then R21 after `Algorithm 3 Sending x0` was retyped as a caption and orphaned `4.2`/`4.3`.
    The judge measured the clip + re-parent at 25 pp / 463 blocks / 34 sections, complete."""
    result = parse_document(
        FRESH_DIR / "ddpm-2006.11239.pdf", paper_id=PAPER_ID, asset_root=tmp_path
    )
    paper = result.paper
    assert validate_paper(paper).ok
    assert result.page_count == 25
    assert paper.status == "complete", paper.partial_reason
    headings = {b.block_id: b.text or "" for b in paper.blocks if b.type == "heading"}
    parents = {s.heading_block_id: s.parent_heading_block_id for s in paper.sections}
    experiments = next(i for i, t in headings.items() if t.strip() == "Experiments")
    for number in ("4.2", "4.3"):
        section = next(i for i, t in headings.items() if t.startswith(number))
        assert parents[section] == experiments, f"{number} should sit under 4 Experiments"


@pytest.mark.parametrize("path", FRESH_PARAMS, ids=lambda p: p.name if p else "no-fresh-set")
def test_every_fresh_paper_parses(path: Path, tmp_path: Path) -> None:
    """Complete or partial, never raised: partial counts as parsed (slice-plan §S2 merge rule)."""
    paper = parse_document(path, paper_id=PAPER_ID, asset_root=tmp_path).paper
    assert validate_paper(paper).ok
    assert paper.blocks and paper.status in ("complete", "partial")
    assert (paper.partial_reason is None) == (paper.status == "complete")


@requires_fresh
def test_colliding_cells_salvage_to_partial_on_maskrcnn(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Rule 8 re-injected on the paper it came from: Mask R-CNN with the one-region-at-a-time
    table dedupe that let a phantom region re-emit two tables' cells (848 blocks, 842 ids).

    The salvage lane drops the LATER colliding block's region - the phantom table - and nothing
    else, so the salvaged document holds exactly the clean parse's blocks, marked `partial`."""

    from papertree_document_worker import pipeline

    def one_at_a_time(regions: list[Any]) -> list[Any]:
        kept: list[Any] = []
        for region in sorted(
            regions, key=lambda r: -(r.bbox[2] - r.bbox[0]) * (r.bbox[3] - r.bbox[1])
        ):
            area = (region.bbox[2] - region.bbox[0]) * (region.bbox[3] - region.bbox[1])
            covered = False
            for other in kept:
                w = min(region.bbox[2], other.bbox[2]) - max(region.bbox[0], other.bbox[0])
                h = min(region.bbox[3], other.bbox[3]) - max(region.bbox[1], other.bbox[1])
                covered |= w > 0 and h > 0 and area > 0 and w * h / area > 0.5
            if not covered:
                kept.append(region)
        return kept

    path = FRESH_DIR / "maskrcnn-1703.06870.pdf"
    clean = parse_document(path, paper_id=PAPER_ID, asset_root=tmp_path / "c").paper
    monkeypatch.setattr(pipeline, "_dedupe_tables", one_at_a_time)
    salvaged = parse_document(path, paper_id=PAPER_ID, asset_root=tmp_path / "s").paper
    assert validate_paper(salvaged).ok
    assert salvaged.status == "partial"
    assert salvaged.partial_reason is not None and "R8" in salvaged.partial_reason
    # The same blocks, keyed by id. Not the same ARRAY: `blocks` is emission order across flows,
    # and the floats rule writes a page's body blocks back into that page's body slots - the
    # phantom held one, so a body block and a margin note trade array places. Reading order lives
    # in `Page.flows` (AGENTS.md §4), and that is compared exactly, page by page.
    assert sorted(b.block_id for b in salvaged.blocks) == sorted(b.block_id for b in clean.blocks)
    # Payloads too: the kept tables' grids still name their own cells, whose ids the dropped
    # phantom's cells shared.
    payloads = {b.block_id: b.payload for b in clean.blocks}
    assert all(b.payload == payloads[b.block_id] for b in salvaged.blocks)
    assert [p.flows for p in salvaged.pages] == [p.flows for p in clean.pages]


@pytest.fixture(scope="module")
def yolo(tmp_path_factory: pytest.TempPathFactory) -> Any:
    """YOLO (arXiv 1506.02640v5), parsed once: the slice-plan merge rule's named paper."""
    path = FRESH_DIR / "yolo-1506.02640.pdf"
    if not path.is_file():
        pytest.skip(
            "the fresh set is gitignored; fetch it with ./research/benchmarks/fresh/fetch_fresh.sh"
        )
    root = tmp_path_factory.mktemp("yolo")
    return parse_document(path, paper_id=PAPER_ID, asset_root=root).paper


def test_unified_detection_is_a_heading_on_yolo(yolo: Any) -> None:
    """Slice-plan §S2 merge rule: '2. Unified Detection' typed `heading`. At 18f69ec it was a
    paragraph, and so were `2.1. Network Design` and three more Title-Case section heads."""
    types = {(b.text or "").replace("\n", " ").strip(): b.type for b in yolo.blocks}
    for heading in ("2. Uniﬁed Detection", "2.1. Network Design", "4.4. VOC 2012 Results"):
        assert types.get(heading) == "heading", (heading, types.get(heading))


def test_no_numeric_only_headings_on_yolo(yolo: Any) -> None:
    """Slice-plan §S2 merge rule: 0 numeric headings on YOLO. At 18f69ec it had `66.4`, a bold
    table value standing alone; in development a bare-number join also married p5's `21` (an FPS
    value, regular face) to the bold row below it, which is why the join now wants the NUMBER in
    a heading face as well."""
    numeric = [
        b.text
        for b in yolo.blocks
        if b.type == "heading" and not any(c.isalpha() for c in (b.text or ""))
    ]
    assert numeric == []


def test_the_abstract_does_not_spill_into_yolos_right_column(yolo: Any) -> None:
    """Slice-plan §S2 rule: an abstract ends at the first heading or its column's foot. At
    18f69ec the height-sorted abstract sweep typed YOLO p0's right-column introduction `abstract`
    (the judge's 6 mistyped body paragraphs; Guided labelled them OUR SUMMARY). The printed
    anchors are the fresh gold's, which was written from the page image."""

    def type_of(printed: str) -> str | None:
        wanted = printed.replace(" ", "")
        for block in yolo.blocks:
            if block.page_index == 0 and wanted in (block.text or "").replace("\n", " ").replace(
                " ", ""
            ):
                return str(block.type)
        return None

    assert type_of("We present YOLO, a new approach to object detection.") == "abstract"
    for printed in (
        "methods to ﬁrst generate potential bounding boxes",
        "We reframe object detection as a single",
        "YOLO is refreshingly simple: see Figure 1.",
        "First, YOLO is extremely fast.",
    ):
        assert type_of(printed) == "paragraph", printed


@requires_fresh
def test_sberts_introduction_is_not_front_matter(tmp_path: Path) -> None:
    """SBERT p0: `_band_rows` grouped [the abstract, `Abstract`, the right-column introduction]
    as one row below the authors, and both prose blocks became `affiliation` - hidden until the
    abstract sweep stopped overwriting it."""
    paper = parse_document(
        FRESH_DIR / "sbert-1908.10084.pdf", paper_id=PAPER_ID, asset_root=tmp_path
    ).paper

    def type_of(printed: str) -> str | None:
        wanted = printed.replace(" ", "")
        for block in paper.blocks:
            if block.page_index == 0 and wanted in (block.text or "").replace("\n", " ").replace(
                " ", ""
            ):
                return str(block.type)
        return None

    assert type_of("BERT (Devlin et al., 2018) and RoBERTa") == "abstract"
    assert type_of("BERT set new state-of-the-art performance on various") == "paragraph"
