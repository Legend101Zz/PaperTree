"""The parse generation and ``parsed_at`` come from the CALLER and the clock (contracts.md §2.2).

Before the reader release, ``assemble.py`` wrote ``"generation": 1`` whatever was being parsed,
``CropStore`` put every crop under ``…/1/…``, and ``parsed_at`` was the constant
``2026-07-31T00:00:00Z`` for every parse ever made. A re-parse (S1's ``POST /reparse`` makes
generation N+1) would have produced a second document claiming to be generation 1 with a
timestamp from before it existed. Now the worker takes the generation from its caller (default 1,
so every existing caller is unchanged) and stamps the real UTC time.

Producer-side fields, so asserted on a REAL parse of a corpus paper (AGENTS.md §4) as well as on
the in-process synthetic PDF CI always has. The corpus tests skip loudly, naming
``./research/benchmarks/fetch_corpus.sh``.

WATCHED FAILING on the unplumbed code: ``TypeError: parse_document() got an unexpected keyword
argument 'generation'`` for every generation test, and ``'2026-07-31T00:00:00Z'`` for the clock.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from _corpus_manifest import CORPUS_DIR, requires_corpus
from papertree_document_worker.pipeline import parse_document

PAPER_ID = "ppr_0123456789ABCDEFGHJKMNP0TV"


def _crop_uris(paper: object) -> list[str]:
    """Every ``payload.image.uri`` in the SERIALISED document — what a consumer actually reads."""
    document = paper.model_dump(mode="json", by_alias=True)  # type: ignore[attr-defined]
    uris: list[str] = []
    for block in document["blocks"]:
        image = (block.get("payload") or {}).get("image")
        if isinstance(image, dict) and isinstance(image.get("uri"), str):
            uris.append(image["uri"])
    return uris


def test_the_default_generation_is_still_1(synthetic_paper: Path, tmp_path: Path) -> None:
    paper = parse_document(synthetic_paper, paper_id=PAPER_ID, asset_root=tmp_path).paper
    assert paper.generation == 1


def test_the_callers_generation_is_the_documents(synthetic_paper: Path, tmp_path: Path) -> None:
    paper = parse_document(
        synthetic_paper, paper_id=PAPER_ID, asset_root=tmp_path, generation=3
    ).paper
    assert paper.generation == 3


def test_parsed_at_is_the_real_utc_time(synthetic_paper: Path, tmp_path: Path) -> None:
    before = datetime.now(UTC)
    paper = parse_document(synthetic_paper, paper_id=PAPER_ID, asset_root=tmp_path).paper
    after = datetime.now(UTC)
    stamp = paper.parser.parsed_at
    assert stamp.endswith("Z"), stamp  # contracts.md §0: ISO-8601 UTC, `…Z`
    parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    # Millisecond precision (contracts.md §0's shape), so allow the truncation.
    assert before.replace(microsecond=before.microsecond // 1000 * 1000) <= parsed <= after


def test_an_explicit_parsed_at_is_kept(synthetic_paper: Path, tmp_path: Path) -> None:
    """Tests (and a replay) may still pin it; only the DEFAULT became the clock."""
    paper = parse_document(
        synthetic_paper,
        paper_id=PAPER_ID,
        asset_root=tmp_path,
        parsed_at="2026-09-25T15:09:25.123Z",
    ).paper
    assert paper.parser.parsed_at == "2026-09-25T15:09:25.123Z"


@requires_corpus
def test_a_real_parse_writes_generation_2_everywhere(tmp_path: Path) -> None:
    """ResNet has figures, so its crops show the generation reaching ``CropStore`` too — and
    D13 (content-derived block ids, IDENTICAL across generations) shows it reaching nothing else."""
    pdf = CORPUS_DIR / "resnet-cvpr-2col.pdf"
    first = parse_document(pdf, paper_id=PAPER_ID, asset_root=tmp_path / "a").paper
    result = parse_document(pdf, paper_id=PAPER_ID, asset_root=tmp_path / "b", generation=2)
    paper = result.paper
    assert (first.generation, paper.generation) == (1, 2)

    uris = _crop_uris(paper)
    assert uris, "resnet's figures produced no crops — the assertion below would be vacuous"
    assert all(uri.startswith(f"asset://{PAPER_ID}/2/") for uri in uris), uris[:3]
    assert all(uri.startswith(f"asset://{PAPER_ID}/1/") for uri in _crop_uris(first))
    pngs = list((tmp_path / "b").rglob("*.png"))
    assert pngs and {p.relative_to(tmp_path / "b").parts[:2] for p in pngs} == {(PAPER_ID, "2")}
    assert result.crops_written == len(pngs)

    assert [b.block_id for b in paper.blocks] == [b.block_id for b in first.blocks]
    datetime.fromisoformat(paper.parser.parsed_at.replace("Z", "+00:00"))  # a real timestamp
