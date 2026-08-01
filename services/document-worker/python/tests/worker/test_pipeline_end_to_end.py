"""The whole parse: `worker/determinism.spec` and `worker/robustness.spec`.

WHAT "VALIDATED" MEANS HERE. `parse_document` calls `assert_valid_paper`, which raises on any
Tier-A ERROR. So every test below that simply parses a paper is also asserting that the document
is well-FORMED (Pydantic) **and** internally CONSISTENT (all 50 semantic rules). There is no
separate "and then check it validates" step because an invalid document never returns.

DETERMINISM IS TESTED THROUGH THE LIBRARY'S OWN CANONICALISER, not through a local one.
`canonical_json_for_determinism` is what DESIGN.md §7.1 defines byte-identity against - keys
sorted, ECMAScript number formatting, `parser.parsed_at` excluded because it is the one field
that legitimately varies between runs. Re-deriving that here would let a bug in this test agree
with a bug in the parser.
"""

from __future__ import annotations

import resource
from pathlib import Path

import pytest
from _corpus_manifest import CORPUS_DIR as CORPUS
from _corpus_manifest import CORPUS_PARAMS, requires_corpus
from papertree_document_ir.canonical import canonical_json_for_determinism
from papertree_document_ir.identity import BLOCK_ID_PATTERN
from papertree_document_worker.pipeline import ParserConfig, parse_document

pytestmark = requires_corpus

PAPER_ID = "ppr_0123456789ABCDEFGHJKMNP0TV"


def _parse(path: Path, root: Path, paper_id: str = PAPER_ID):  # type: ignore[no-untyped-def]
    return parse_document(path, paper_id=paper_id, asset_root=root)


@pytest.mark.parametrize("path", CORPUS_PARAMS, ids=lambda p: p.name if p else "no-corpus")
def test_every_corpus_paper_parses_to_a_valid_document(path: Path, tmp_path: Path) -> None:
    """`worker/robustness.spec`: zero crashes, timeouts or empty outputs on the Tier A corpus.

    "Empty output" is checked explicitly. DESIGN.md §11 residual risk 10 notes that
    `status: "complete"` with zero blocks is legal - a genuinely empty PDF exists - but is also
    exactly the shape of a total extraction failure, so the ingest epic must treat it as a red
    flag rather than a pass.
    """
    result = _parse(path, tmp_path)
    paper = result.paper

    assert paper.blocks, f"{path.name} produced NO blocks - a silent total-extraction failure"
    assert paper.pages, "a document with blocks must have pages (rule 40)"
    assert paper.status in ("complete", "partial")
    # Rule 41, from the other side: the two must agree.
    assert (paper.partial_reason is None) == (paper.status == "complete")
    assert paper.coordinate_space == "pdf_user_space_topleft"
    assert paper.source_hash.startswith("sha256:")


@pytest.mark.parametrize("path", CORPUS_PARAMS, ids=lambda p: p.name if p else "no-corpus")
def test_block_ids_are_well_formed_and_unique(path: Path, tmp_path: Path) -> None:
    """Rule 8, plus the frozen id shape `^blk_[a-z2-7]{16}$`."""
    paper = _parse(path, tmp_path).paper
    ids = [b.block_id for b in paper.blocks]
    assert len(ids) == len(set(ids)), "duplicate block ids"
    for block_id in ids:
        assert BLOCK_ID_PATTERN.fullmatch(block_id), block_id


@pytest.mark.parametrize("path", CORPUS_PARAMS, ids=lambda p: p.name if p else "no-corpus")
def test_doc_order_is_present_on_exactly_the_top_level_body_blocks(
    path: Path, tmp_path: Path
) -> None:
    """Rule 15, asserted from the outside because issue #49 records that the brief offers a
    choice here which is not actually open: anything else is an ERROR."""
    paper = _parse(path, tmp_path).paper
    with_order = {b.block_id for b in paper.blocks if b.doc_order is not None}
    expected = {b.block_id for b in paper.blocks if b.flow == "body" and b.parent_id is None}
    assert with_order == expected
    # Dense across the whole document, 0..n-1.
    values = sorted(b.doc_order for b in paper.blocks if b.doc_order is not None)
    assert values == list(range(len(values)))


def test_re_parsing_is_byte_identical_and_ids_do_not_move(tmp_path: Path) -> None:
    """`worker/determinism.spec`.

    Five runs, not twenty: the epic asks for 20, and 20 runs of a 12-page paper is ~30 s of CI
    for a property that is deterministic by construction (no clock, no RNG, no dict-order
    dependence, no filesystem iteration). This asserts the property; `test_determinism_20_runs`
    below does the full count and is the one the acceptance criterion names.
    """
    first = _parse(CORPUS / "resnet-cvpr-2col.pdf", tmp_path)
    baseline = canonical_json_for_determinism(first.paper.model_dump(mode="json", by_alias=True))
    ids = [b.block_id for b in first.paper.blocks]

    for run in range(4):
        again = _parse(CORPUS / "resnet-cvpr-2col.pdf", tmp_path)
        current = canonical_json_for_determinism(again.paper.model_dump(mode="json", by_alias=True))
        assert current == baseline, f"run {run + 2} differs from run 1"
        assert [b.block_id for b in again.paper.blocks] == ids


@pytest.mark.slow
def test_determinism_over_twenty_runs(tmp_path: Path) -> None:
    """The acceptance criterion as written: 20 runs, byte-identical, identical ids.

    Marked slow and kept separate so the fast suite still covers the property.
    """
    baseline: str | None = None
    ids: list[str] | None = None
    for run in range(20):
        result = _parse(CORPUS / "attention-is-all-you-need.pdf", tmp_path)
        canonical = canonical_json_for_determinism(
            result.paper.model_dump(mode="json", by_alias=True)
        )
        current_ids = [b.block_id for b in result.paper.blocks]
        if baseline is None:
            baseline, ids = canonical, current_ids
            continue
        assert canonical == baseline, f"run {run + 1} is not byte-identical"
        assert current_ids == ids, f"run {run + 1} moved block ids"


def test_a_different_config_produces_a_different_config_hash(tmp_path: Path) -> None:
    """`config_hash` is what makes "re-parsing is a no-op" checkable.

    Two runs that agree on it and disagree on their output are a determinism bug; two runs that
    disagree on it are not comparable at all. A hash that ignored a knob would silently merge
    those two cases.
    """
    default = parse_document(
        CORPUS / "resnet-cvpr-2col.pdf", paper_id=PAPER_ID, asset_root=tmp_path
    )
    scaled = parse_document(
        CORPUS / "resnet-cvpr-2col.pdf",
        paper_id=PAPER_ID,
        asset_root=tmp_path,
        config=ParserConfig(crop_scale=2.0),
    )
    assert default.paper.parser.config_hash != scaled.paper.parser.config_hash


def test_every_equation_and_figure_retains_its_crop(tmp_path: Path) -> None:
    """Rule 36, and ADR-001's "equations and figures always retain the rendered source region".

    This is what makes `payload.latex` acceptable as a *declared interpretation*: the crop beside
    it is what the page actually says. findings.md B4 measured the old extractor discarding every
    one - `images_dict_carries_pixel_bytes` was false for all 8 papers, so every `image_id` was a
    dangling reference.
    """
    result = _parse(CORPUS / "resnet-cvpr-2col.pdf", tmp_path)
    # Asserted against the SERIALISED document, which is what `packages/db` stores and every
    # consumer reads. `Block.payload` is reached through an if/then binding and arrives as plain
    # data rather than a typed model, so inspecting the model here would test the binding.
    document = result.paper.model_dump(mode="json", by_alias=True, exclude_unset=True)
    cropped = [
        b for b in document["blocks"] if b["type"] in ("equation", "inline_equation", "figure")
    ]
    assert cropped, "ResNet has display equations"
    for block in cropped:
        image = block.get("payload", {}).get("image")
        assert image is not None, f"{block['block_id']} ({block['type']}) has no crop"
        assert image["uri"].startswith("asset://"), image["uri"]
        assert image["rendered_from"] in ("raster", "vector", "page")
        # The bytes must actually be ON DISK. findings.md B4 measured every FigureBlock.image_id
        # in the old extractor being a dangling reference, so a URI is not evidence of a crop.
        relative = image["uri"].split("://", 1)[1]
        assert (tmp_path / relative).is_file(), f"{image['uri']} names no file"
    assert result.crops_written == len(cropped)


def test_the_parse_stays_inside_the_performance_budget(tmp_path: Path) -> None:
    """`worker/perf.spec`: <=1.5 s/page p95, peak RSS <500 MB.

    One paper, not the corpus: RSS is process-wide and a loop over all eight in one process
    measures the loop, not the parser. The corpus-wide p50/p95 is reported in EPIC-01-RESULT.md
    from a dedicated run.
    """
    import time

    started = time.perf_counter()
    result = _parse(CORPUS / "resnet-cvpr-2col.pdf", tmp_path)
    elapsed = time.perf_counter() - started
    per_page = elapsed / result.page_count
    assert per_page < 1.5, f"{per_page * 1000:.0f} ms/page exceeds the 1500 ms budget"

    peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024)
    # ru_maxrss is the HIGH-WATER MARK for the whole pytest process, so this is an upper bound
    # that includes every other test's allocations. Asserted loosely for that reason; the tight
    # per-document figure is `test_peak_rss_on_the_largest_paper_is_inside_the_budget` below,
    # which runs in a SUBPROCESS and can therefore assert the bar the brief actually states.
    assert peak_mb < 2000, f"peak RSS {peak_mb:.0f} MB is implausibly high"


#: `worker/perf.spec`, memory half. The brief says peak RSS < 500 MB.
PEAK_RSS_BUDGET_MB = 500

#: The LARGEST paper in the corpus, 75 pages. Peak RSS scales with page count, so measuring the
#: budget on anything else measures nothing: `resnet-cvpr-2col` above is 12 pages and peaks around
#: 141 MB, which would pass a 500 MB bar no matter how badly the parser leaked.
LARGEST_PAPER = "gpt3-longform-singlecol.pdf"


@pytest.mark.skipif(not (CORPUS / LARGEST_PAPER).is_file(), reason="corpus not fetched")
def test_peak_rss_on_the_largest_paper_is_inside_the_budget(tmp_path: Path) -> None:
    """`worker/perf.spec`: peak RSS < 500 MB, measured properly. Issue #52.

    WHY A SUBPROCESS. `ru_maxrss` is a high-water mark for the whole process and never falls, so
    inside a shared pytest run it reports the largest allocation ANY test made. That is why the
    assertion above is 2000 MB — four times the real bar — on the second-smallest paper in the
    corpus. It passed for months and measured nothing, and `EPIC-01-RESULT.md` §3 records it as
    the third time on that branch a green test turned out to assert less than it appeared to.

    A fresh interpreter has no such history, so the number it reports is this parse's own.
    """
    import json
    import subprocess
    import sys
    import textwrap

    program = textwrap.dedent("""
        import json, resource, sys
        from pathlib import Path
        from papertree_document_worker.pipeline import parse_document
        pdf, root, paper_id = sys.argv[1], sys.argv[2], sys.argv[3]
        result = parse_document(Path(pdf), paper_id=paper_id, asset_root=Path(root))
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # Linux reports ru_maxrss in KiB, macOS in bytes.
        peak_mb = rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024
        print(json.dumps({"peak_mb": peak_mb, "pages": result.page_count}))
    """)

    completed = subprocess.run(
        [sys.executable, "-c", program, str(CORPUS / LARGEST_PAPER), str(tmp_path), PAPER_ID],
        capture_output=True,
        text=True,
        check=True,
    )
    measured = json.loads(completed.stdout.strip().splitlines()[-1])
    peak_mb, pages = measured["peak_mb"], measured["pages"]

    assert pages > 50, f"{LARGEST_PAPER} should be the long paper; got {pages} pages"
    assert peak_mb < PEAK_RSS_BUDGET_MB, (
        f"peak RSS {peak_mb:.0f} MB over {pages} pages exceeds the {PEAK_RSS_BUDGET_MB} MB budget. "
        "The two known terms are pdf.RAWDICT_NO_IMAGES (get_text must not preserve images) and "
        "the per-page TOOLS.store_shrink in SourceDocument.pages; see issue #52."
    )
