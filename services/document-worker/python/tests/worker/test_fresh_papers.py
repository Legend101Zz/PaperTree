"""S2 (#141): the real-parse half of "no real paper may dead-letter", on the fresh set.

Gated on `./research/benchmarks/fresh/fetch_fresh.sh` (the PDFs are gitignored), and it skips
with that script named when they are absent. `test_parse_robustness.py` builds each defect's
shape synthetically so CI still exercises the fix; this file proves it on the paper it came from,
because a producer-side fix that only passes on a fixture its author wrote is the defect class
`AGENTS.md` §4 records.
"""

from __future__ import annotations

from pathlib import Path

from _corpus_manifest import FRESH_DIR, requires_fresh
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
