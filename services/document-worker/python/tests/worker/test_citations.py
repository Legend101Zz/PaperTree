"""`cites` and `Span.role="citation"`, asserted against REAL PARSES of the real corpus (#66).

EVERY NUMBER BELOW IS AN EXACT INTEGER, AND `> 0` WOULD NOT DO.

`assemble._emit_relations` drops any relation whose endpoints are missing from `by_id` with
`continue` - no raise, no log, no counter. An emitter that runs one phase too early, or that holds
a block object assembly has since replaced, therefore emits ZERO `cites` and the document is still
perfectly valid: verified by mutation, `status: "complete"`, zero warnings, zero edges. That
silence IS #66. `> 0` would catch nothing but a total failure, and a fixture-only assertion would
catch not even that - the mutation that matters is one where the detector still works and the
EMISSION does not.

So these are exact equalities against a real parse, in the shape
`packages/evaluation/.../test_corpus_gold.py` uses and for its stated reason: the parser is
byte-deterministic (`worker/determinism.spec`), so a floor would let a regression hide under an
unrelated improvement, and equality forces any change to a headline number to move the baseline in
the same diff a reviewer reads.

THE CORPUS IS NOT COMMITTED, so every corpus test here SKIPS on CI, loudly, naming
`./research/benchmarks/fetch_corpus.sh` (`_corpus_manifest`). `test_smoke_*` runs everywhere - and
is labelled a SMOKE because a suite that only had it would pass while the corpus produced nothing,
which is #66 in disguise.

BASELINE MEASURED 2026-08-03 off `main` at `ee8308b`, where the whole table was zero: `cites` 0
corpus-wide, `Span.role` 37 of 63,368 (all `undecodable_glyphs`), `Span.block_id` 0 of 63,368.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, cast

import pytest
from _corpus_manifest import CORPUS_DIR as CORPUS
from _corpus_manifest import EXPECTED_CORPUS, requires_corpus
from papertree_document_ir import Paper
from papertree_document_ir.identity import BlockIdInput, block_id, content_hash, normalise_text
from papertree_document_worker.assemble import AssembledBlock
from papertree_document_worker.citations import (
    CITATION_ROLE,
    CitationLink,
    _author_year_markers,
    _bracketed_markers,
    bracketed_marker_keys,
    detect_citations,
)
from papertree_document_worker.pipeline import ParserConfig, parse_document

# `build_synthetic_pdf` is REUSED, not copied. It is the PDF `packages/retrieval` already parses,
# it contains "See also He et al. [1] for background." on page 1 and a bracketed bibliography on
# page 2, and a second copy of it would drift from that one silently. Inserted the way
# `tests/conftest.py` already inserts `tests/worker` for `_corpus_manifest`, so this works when the
# file is run on its own and does not depend on retrieval's tests being collected first.
_REPO = Path(__file__).resolve().parents[5]
_RETRIEVAL_TESTS = _REPO / "packages" / "retrieval" / "python" / "tests"
if str(_RETRIEVAL_TESTS) not in sys.path:
    sys.path.insert(0, str(_RETRIEVAL_TESTS))

from _retrieval_fixtures import build_synthetic_pdf  # noqa: E402

PAPER_ID = "ppr_0123456789ABCDEFGHJKMNP0TV"

#: `cites` RELATIONS by provenance, and `role="citation"` SPANS, per paper.
#:
#: Relations and spans differ on purpose and the gap is not slack: `_emit_relations` de-duplicates
#: on `(type, from, to)`, so a paragraph citing [16] three times contributes ONE relation, while
#: each printed marker keeps its own span. Spans also outnumber markers, because a marker that
#: straddles several PDF style runs is clipped to each - see `apply_citation_roles`.
BASELINE: dict[str, dict[str, int]] = {
    "a3c-algorithmheavy": {"printed_label": 0, "author_year": 3, "spans": 19},
    "attention-is-all-you-need": {"printed_label": 73, "author_year": 0, "spans": 60},
    "bert-2col": {"printed_label": 0, "author_year": 49, "spans": 298},
    "gpt3-longform-singlecol": {"printed_label": 219, "author_year": 0, "spans": 478},
    "neural-odes-mathheavy": {"printed_label": 0, "author_year": 10, "spans": 43},
    "pdf-to-tree-acl2col": {"printed_label": 0, "author_year": 29, "spans": 156},
    "resnet-cvpr-2col": {"printed_label": 133, "author_year": 0, "spans": 150},
    "superglue-tableheavy": {"printed_label": 0, "author_year": 9, "spans": 17},
}

#: MARKERS RESOLVED / MARKERS DETECTED, per mechanism, per paper. THE TWO MECHANISMS ARE NEVER
#: SUMMED INTO ONE RATE: a blended figure would average a 494/501 mechanism over three papers with
#: a 111/325 one over five and describe neither - the composite-denominator defect #111 found in
#: `figures.spec`. The n is in the row. `citations.py` records why the `author_year` column is low
#: and why the cause is upstream of it.
MARKER_RATES: dict[str, dict[str, tuple[int, int]]] = {
    "a3c-algorithmheavy": {"printed_label": (0, 2), "author_year": (3, 62)},
    "attention-is-all-you-need": {"printed_label": (78, 78), "author_year": (0, 0)},
    "bert-2col": {"printed_label": (0, 33), "author_year": (55, 71)},
    "gpt3-longform-singlecol": {"printed_label": (236, 241), "author_year": (0, 1)},
    "neural-odes-mathheavy": {"printed_label": (0, 2), "author_year": (11, 56)},
    "pdf-to-tree-acl2col": {"printed_label": (0, 21), "author_year": (31, 61)},
    "resnet-cvpr-2col": {"printed_label": (180, 182), "author_year": (0, 0)},
    "superglue-tableheavy": {"printed_label": (0, 2), "author_year": (11, 75)},
}

#: The three whose bibliography prints a label on the entry. `printed_label` is scored on these.
LABELLED_PAPERS = ("attention-is-all-you-need", "gpt3-longform-singlecol", "resnet-cvpr-2col")
#: The other five. `author_year` is scored on these.
AUTHOR_YEAR_PAPERS = tuple(p[:-4] for p in EXPECTED_CORPUS if p[:-4] not in LABELLED_PAPERS)


@pytest.fixture(scope="module")
def parsed(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Paper]:
    """All eight papers, parsed ONCE. 15.1 s measured; per-test parsing would be eight times that
    for no extra coverage, since the parser is deterministic."""
    root = tmp_path_factory.mktemp("citations-assets")
    return {
        name: parse_document(
            CORPUS / f"{name}.pdf",
            paper_id=PAPER_ID,
            asset_root=root / name,
            config=ParserConfig(vlm_max_calls=0),
        ).paper
        for name in BASELINE
    }


def _citation_spans(paper: Paper) -> list[tuple[Any, Any]]:
    return [
        (block, span)
        for block in paper.blocks
        for span in (block.spans or ())
        if span.role == CITATION_ROLE
    ]


# ── the corpus assertions ────────────────────────────────────────────────────────────────────


@requires_corpus
def test_cites_relations_and_citation_spans_per_paper(parsed: dict[str, Paper]) -> None:
    """The headline table. EXACT, per paper, per provenance.

    Was 0 `cites` on all eight and 0 citation spans; `caption_of` 142 +
    `continues_on_next_page` 94 + `continues_in_next_column` 36 = 272 relations corpus-wide.
    """
    measured = {}
    for name, paper in parsed.items():
        cites = [r for r in paper.relations if r.type == "cites"]
        measured[name] = {
            "printed_label": sum(1 for r in cites if r.provenance == "printed_label"),
            "author_year": sum(1 for r in cites if r.provenance == "author_year"),
            "spans": len(_citation_spans(paper)),
        }
    assert measured == BASELINE
    assert sum(v["printed_label"] + v["author_year"] for v in measured.values()) == 525
    assert sum(v["spans"] for v in measured.values()) == 1221


@requires_corpus
def test_marker_resolution_rates_are_reported_per_mechanism(parsed: dict[str, Paper]) -> None:
    """Resolved / detected, per mechanism, per paper - the denominators the rate needs."""
    measured: dict[str, dict[str, tuple[int, int]]] = {}
    for name, paper in parsed.items():
        detected = {"printed_label": 0, "author_year": 0}
        for block in paper.blocks:
            if not block.text or block.type == "reference_entry":
                continue
            detected["printed_label"] += len(_bracketed_markers(block.text))
            detected["author_year"] += len(_author_year_markers(block.text))
        resolved = {"printed_label": 0, "author_year": 0}
        for link in _links(paper):
            resolved[link.provenance] += 1
        measured[name] = {k: (resolved[k], detected[k]) for k in detected}

        # THE NUMERATOR IS TIED TO THE EMITTED DOCUMENT RATHER THAN LEFT AS A SECOND OPINION.
        # `_emit_relations` de-duplicates on `(type, from, to)`, so the resolved markers must
        # collapse to EXACTLY the relations the parser wrote - equal, not merely no fewer.
        pairs = {(link.source.block_id, link.target.block_id) for link in _links(paper)}
        assert len(pairs) == sum(1 for r in paper.relations if r.type == "cites")

    assert measured == MARKER_RATES
    labelled = [measured[p]["printed_label"] for p in LABELLED_PAPERS]
    assert (sum(a for a, _ in labelled), sum(b for _, b in labelled)) == (494, 501)
    author_year = [measured[p]["author_year"] for p in AUTHOR_YEAR_PAPERS]
    assert (sum(a for a, _ in author_year), sum(b for _, b in author_year)) == (111, 325)


def _links(paper: Paper) -> list[CitationLink]:
    """The detector, re-run over the EMITTED blocks. An IR `Block` carries the three attributes
    `detect_citations` reads - `type`, `text`, `block_id` - so this is the same computation on the
    same text, which is what makes it a denominator rather than a reimplementation."""
    return detect_citations(cast("list[AssembledBlock]", list(paper.blocks)))


@requires_corpus
def test_a_resolved_marker_with_no_span_is_always_in_a_block_that_has_no_spans(
    parsed: dict[str, Paper],
) -> None:
    """58 of 605 resolved markers get no `citation` span, and the reason is not this module.

    `table_cell` blocks carry `text` and NO spans at all, so there is no run to split and no
    geometry to apportion; 18 of attention's markers and 30 of resnet's sit in result tables
    ("ByteNet [18]", "GNMT + RL [38]"). The `cites` edge still stands and inventing a box would be
    worse than leaving the location absent. Asserted rather than described, so a marker losing its
    span for ANY OTHER reason is a failure.
    """
    unspanned: Counter[str] = Counter()
    spanned = 0
    for paper in parsed.values():
        by_id = {b.block_id: b for b in paper.blocks}
        for link in _links(paper):
            block = by_id[link.source.block_id]
            covered = any(
                span.role == CITATION_ROLE and span.start < link.end and link.start < span.end
                for span in block.spans or ()
            )
            if covered:
                spanned += 1
            else:
                assert not block.spans, "a block WITH spans must be able to carry the marker"
                unspanned[block.type] += 1
    assert (spanned, dict(unspanned)) == (547, {"table_cell": 58})


@requires_corpus
def test_every_cites_edge_satisfies_rule_23_and_its_blind_spots(parsed: dict[str, Paper]) -> None:
    """Rule 23 says `cites.to` must be a `reference_entry`. It has two holes, closed here.

    It is SILENT when `to` names nothing at all (`ctx.by_id.get(...) is not None` guards the
    check), and it constrains `cites.from` not at all. `parse_document` calls `assert_valid_paper`,
    so rule 23 itself already ran; these are the two things it would not have caught.
    """
    seen = 0
    for name, paper in parsed.items():
        by_id = {b.block_id: b for b in paper.blocks}
        for relation in paper.relations:
            if relation.type != "cites":
                continue
            seen += 1
            assert relation.to in by_id, f"{name}: dangling cites.to {relation.to}"
            assert by_id[relation.to].type == "reference_entry"
            assert relation.from_ in by_id, f"{name}: dangling cites.from {relation.from_}"
            assert by_id[relation.from_].type != "reference_entry", (
                f"{name}: a reference_entry citing another is not what this detects"
            )
            assert relation.provenance in ("printed_label", "author_year")
    assert seen == 525


@requires_corpus
def test_citation_spans_carry_the_reference_entry_they_resolve_to(
    parsed: dict[str, Paper],
) -> None:
    """`Span.block_id` was 0-populated on 63,368 spans. Every citation span now names its entry."""
    total = 0
    for name, paper in parsed.items():
        by_id = {b.block_id: b for b in paper.blocks}
        for block, span in _citation_spans(paper):
            total += 1
            assert span.block_id is not None, f"{name}: citation span with no target"
            assert by_id[span.block_id].type == "reference_entry"
            assert block.text is not None
            marked = block.text[span.start : span.end]
            assert marked and "\n" not in marked, f"{name}: implausible marker text {marked!r}"
    assert total == 1221


@requires_corpus
def test_splitting_a_style_run_retires_no_block_id_and_changes_no_content_hash(
    parsed: dict[str, Paper],
) -> None:
    """The claim `apply_citation_roles` runs after `assign_ids()` on, re-derived not assumed.

    `block_id` hashes (source_hash, page_index, quantised top-left, block TYPE, normalised text
    prefix); `content_hash` hashes the normalised text. Neither reads spans. Recomputed here from
    the emitted block, so a future change that started feeding spans into either would fail.
    """
    checked = 0
    for name, paper in parsed.items():
        source_hash = paper.source_hash.removeprefix("sha256:")
        for block, _span in _citation_spans(paper):
            checked += 1
            assert block.block_id == block_id(
                BlockIdInput(
                    source_hash=source_hash,
                    page_index=block.page_index,
                    x0=block.bbox[0],
                    y0=block.bbox[1],
                    block_type=block.type,
                    text=block.text or "",
                )
            ), f"{name}: id changed under span splitting"
            assert block.content_hash == content_hash(normalise_text(block.text or ""))
    assert checked == 1221


@requires_corpus
def test_the_worker_detector_finds_every_label_retrieval_finds(parsed: dict[str, Paper]) -> None:
    """THE DRIFT GUARD FOR THE SECOND IMPLEMENTATION.

    `packages/retrieval` has its own marker scanner (`expansion._citation_labels`) and
    `document-worker` MUST NOT import it - retrieval consumes the IR, so the dependency would run
    backwards. Two implementations of one idea drift; this converts that risk into a red test, on a
    real parse rather than on strings either author chose. The SUBSET direction is the one that
    matters: retrieval's `cited-label:` fallback fires for any label it finds, so a label it sees
    and the worker does not is a marker the worker will never emit an edge for while the fallback
    keeps quietly covering it up.
    """
    from papertree_retrieval.expansion import _citation_labels

    blocks = labels = 0
    for name, paper in parsed.items():
        for block in paper.blocks:
            text = block.text or ""
            blocks += 1
            theirs = set(_citation_labels(text))
            labels += len(theirs)
            assert theirs <= set(bracketed_marker_keys(text)), f"{name}: {block.block_id}"
    # Without this the assertion above is satisfied by an empty set on every block.
    assert (blocks, labels) == (9903, 300)


# ── the CI smoke ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def smoke(tmp_path_factory: pytest.TempPathFactory) -> Paper:
    root = tmp_path_factory.mktemp("citations-smoke")
    # `ParseResult.paper` is declared `Any` (pipeline.py:96), so it is narrowed here rather than
    # returned straight out of a function that promises a `Paper`.
    paper: Paper = parse_document(
        build_synthetic_pdf(root / "synthetic.pdf"),
        paper_id=PAPER_ID,
        asset_root=root / "assets",
        config=ParserConfig(vlm_max_calls=0),
    ).paper
    return paper


def test_smoke_the_emitter_runs_on_ci_where_there_is_no_corpus(smoke: Paper) -> None:
    """A SMOKE, and the word is load-bearing.

    A REAL parse of a real PDF - PyMuPDF builds it in process, page 1 says "See also He et al. [1]
    for background.", page 2 carries a bracketed bibliography - so it proves the emitter EXECUTES
    where CI can see it. It is NOT evidence that the producer works on real papers: a suite
    containing only this test would be fully green while the corpus yielded zero `cites`, which is
    #66 wearing a different hat. The corpus tests above are the evidence.
    """
    cites = [r for r in smoke.relations if r.type == "cites"]
    assert len(cites) == 1
    assert cites[0].provenance == "printed_label"
    entries = {b.block_id for b in smoke.blocks if b.type == "reference_entry"}
    assert cites[0].to in entries
    assert cites[0].from_ not in entries

    spans = _citation_spans(smoke)
    assert len(spans) == 1
    block, span = spans[0]
    assert block.text is not None
    assert block.text[span.start : span.end] == "1"
    assert span.block_id == cites[0].to


def test_smoke_the_marker_span_splits_its_run_rather_than_overlapping_it(smoke: Paper) -> None:
    """Rule 26 wants ascending, non-overlapping spans, so the covering run had to be SPLIT.

    Asserted from the outside as well as by `assert_valid_paper`, because the interesting failure
    is a role span laid on top of an intact run: that is one extra span, still ascending by start,
    and only the overlap clause catches it.
    """
    block, span = _citation_spans(smoke)[0]
    spans = list(block.spans or ())
    assert len(spans) > 1
    for previous, current in zip(spans, spans[1:], strict=False):
        assert previous.end <= current.start
        assert previous.start < current.start
    before = [s for s in spans if s.end == span.start]
    after = [s for s in spans if s.start == span.end]
    assert before and after, "the marker should sit between the two halves of its own run"
    assert before[0].bbox[0] < span.bbox[0] < after[0].bbox[0]
    assert before[0].size == span.size == after[0].size


def test_smoke_bert_style_bracket_tokens_are_not_citations() -> None:
    """`[MASK]`, `[CLS]` and `[SEP]` occur 33 times across bert-2col and cite nothing.

    Pure detector, no parse: the guard is not the pattern - all three match the alphanumeric marker
    shape - it is that resolution goes through labels the bibliography actually PRINTED, and an
    author-year bibliography prints none. Asserted here so the reason is executable.
    """
    text = "the [MASK] token and the [CLS] token, plus [12] and [ADG+16]."
    assert bracketed_marker_keys(text) == ("MASK", "CLS", "12", "ADG+16")
    assert re.search(r"\[\.5, \.95\]", "IoU [.5, .95]")
    assert bracketed_marker_keys("IoU [.5, .95] averaged") == ()
