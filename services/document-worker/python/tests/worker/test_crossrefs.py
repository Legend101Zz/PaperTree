"""`references` edges, the two payload mirrors, and the numbers behind them.

EVERY NUMBER HERE IS AN EXACT INTEGER AGAINST A REAL PARSE, AND `> 0` WOULD NOT DO.

`assemble._emit_relations` (`assemble.py:424`) drops any relation whose endpoints are missing
from `by_id` with a bare `continue` — no raise, no log, no counter. PR #127 measured what that
costs: handing `relate()` a detached block object emits ZERO edges on a document that still
reports `status: "complete"` with zero diagnostics. `> 0` catches only total failure and a
fixture the test author wrote catches not even that, because the input would be built to
succeed. That is #66's whole subject and this file inherits its discipline.

THE PAYLOADS ARE MIRRORS AND THE TEST ASSERTS THE MIRROR, NOT THE VALUE

`models.py` says the relation is authoritative for all three fields (`:995`, `:1076`, `:1082`).
So the assertions below check that each payload field AGREES WITH THE EDGES IN BOTH DIRECTIONS —
every mirrored value traceable to an emitted edge, and every eligible edge mirrored. Asserting
only that the fields are populated would pass just as happily on a second, independent
derivation, which is the drift the schema's wording exists to forbid.

THE DENOMINATOR THAT MATTERS FOR EQUATIONS IS NOT THE EQUATION COUNT

`equation payload.referenced_by` reaches 7 of 81 equations, and that reads like a failure until
the other denominator is measured: **the corpus contains only 8 in-prose callouts to a numbered
equation at all**. Papers overwhelmingly refer to equations by restating them, not by writing
"Eq. (3)". So the rate against the askable population is 7/8, and the rate against equations is
7/81, and BOTH are reported — reporting either alone would mislead in opposite directions.
`figures.spec`'s 68.2 % was one number standing in for three (#111); this is the same hazard.
"""

from __future__ import annotations

import pathlib
import tempfile
from collections import Counter
from typing import Any

import pytest
from _corpus_manifest import CORPUS_DIR as CORPUS
from _corpus_manifest import EXPECTED_CORPUS, requires_corpus
from papertree_document_ir import Paper
from papertree_document_worker.pipeline import parse_document

PAPER_ID = "ppr_CEK11Y5AX9M390QSB1724ED8KT"

#: Every corpus paper, because a producer-side claim measured on one paper is a claim about one
#: paper. `EXPECTED_CORPUS` and `requires_corpus` are the shared ones — a second skip predicate
#: beside them is the "build beside it" defect in miniature, and it would drift the day the
#: corpus list changes.
_ALL = sorted(name.removesuffix(".pdf") for name in EXPECTED_CORPUS)


@pytest.fixture(scope="module")
def parsed() -> dict[str, Paper]:
    """Parse all eight once. ~15 s total, which is why nothing here settles for a fixture."""
    out: dict[str, Paper] = {}
    for name in _ALL:
        with tempfile.TemporaryDirectory() as td:
            result = parse_document(
                CORPUS / f"{name}.pdf", paper_id=PAPER_ID, asset_root=pathlib.Path(td)
            )
        assert result.paper.status == "complete", f"{name} did not parse cleanly"
        out[name] = result.paper
    return out


def _blocks(paper: Paper, kind: str) -> list[Any]:
    return [b for b in paper.blocks if b.type == kind]


@requires_corpus
def test_references_edges_are_emitted_on_every_paper(parsed: dict[str, Paper]) -> None:
    """`references` was emitted 0 times corpus-wide before this change.

    WATCH IT FAIL: delete the `builder.relate(REFERENCES_RELATION, ...)` loop in
    `pipeline._assemble`
    and every count below goes to 0. Move the loop to hold a detached block object and it ALSO goes
    to 0 — silently, with `status: "complete"` — which is why this asserts the total rather than
    "some edges exist".
    """
    per_paper = {
        name: sum(1 for r in paper.relations if r.type == "references")
        for name, paper in parsed.items()
    }
    # S2 (#141) moved four rows. gpt3 33 -> 31: two callouts sat in text that was really a
    # caption's continuation line (`Figure 1.3: ...` is set with a bold label, and the weight rule
    # cut the caption after its first line); now inside the caption, they are not text references.
    # pdf-to-tree 7 -> 8, resnet 18 -> 19, superglue 4 -> 5: callouts in text that was dropped or
    # mistyped before - resnet's p5 table reference now comes from the recovered bottleneck
    # paragraph. Several sources also re-point to the same paragraph with its run-in lead joined
    # (`Maximum Likelihood Training A useful property ...` instead of `A useful property ...`).
    # PARAGRAPH SPLITTING (S2) raises seven rows, 116 -> 145: an edge is one per (block, float),
    # and a block that held several printed paragraphs now is several blocks, each citing the
    # table or figure its own sentences name (resnet 19 -> 34, whose section 4 paragraphs name a
    # table apiece). No callout was added or lost; they are attributed to the paragraph that
    # prints them.
    assert per_paper == {
        "a3c-algorithmheavy": 17,
        "attention-is-all-you-need": 13,
        "bert-2col": 17,
        "gpt3-longform-singlecol": 33,
        "neural-odes-mathheavy": 16,
        "pdf-to-tree-acl2col": 10,
        "resnet-cvpr-2col": 34,
        "superglue-tableheavy": 5,
    }
    assert sum(per_paper.values()) == 145


@requires_corpus
def test_the_pre_existing_relation_types_did_not_move(parsed: dict[str, Paper]) -> None:
    """A new emitter must not perturb the three types that were already there.

    `caption_of` in particular is READ by this change (it is the caption→float join) and a bug
    that consumed it destructively would show up here and nowhere else.
    """
    totals: Counter[str] = Counter()
    for paper in parsed.values():
        totals.update(r.type for r in paper.relations)
    # 142 -> 176 with paragraph splitting (S2). Measured: all 34 captions that gain an edge sat
    # in a `paragraph` block OPENED by a stray table value set just above the caption ("112.6%",
    # "84.9", "-", "3.2M" - the table's last row, outside its detected cells), so the `Table N`
    # marker was not at position 0 and nothing linked it. Split apart, 33 table captions and 1
    # figure caption carry their edge.
    assert totals["caption_of"] == 176
    # 94 -> 90 and 36 -> 37 in S2 (#141). The lost page continuations pointed INTO section heads
    # that were typed `paragraph` (`8. Experimental Setup`, `5.1. Atari 2600 Games`, `3.5 Positional
    # Encoding`, `3.9.4 News Article Generation`, `5.1 Baselines BERT`) or into a caption's second
    # line; the rest re-point to the paragraph that really continues. `cites` 525 -> 532: see
    # test_citations.BASELINE.
    # ...and 90 -> 89 in the numeric-only commit: resnet's body-flow page numbers (`2`, `3`, `6`,
    # `11`) were `paragraph`, so each was the SOURCE of a page continuation into the next page's
    # first paragraph. Typed `unknown`, they continue nothing, and six of those edges now start at
    # the paragraph that really runs over the page break; one false one is simply gone.
    # ...and 89 -> 88 with paragraph splitting, where most of these edges RE-POINT: a column or
    # page continuation used to land on a blob of table values and the caption below them ("84.9
    # Table 5: Ablation over the pre-trai...") and now lands on the paragraph that continues
    # ("ablation studies can be found in Appendix ..."); some still land on a table value outside
    # its detected table ("73.8 ResNet-101"), the pre-existing table-extent defect.
    assert totals["continues_on_next_page"] == 88
    # 37 -> 38 in the title-first commit, and the new edge is FALSE: pdf-to-tree p0's left column
    # ends "...dhSegment(Ares Oliveira et al.," (one continuation signal, confidence 0.6) and the
    # right column's first body block is now "Additionally, some applications, like RAG..." - the
    # tail of Figure 1's CAPTION, broken off because MuPDF returned "to confusion." and
    # "Additionally, ..." as two lines on one baseline and `_same_block` read the second's 63 pt
    # offset as an indent. The affiliation lines used to be read first in that column, and the
    # pair failed rule 24b's x test, which hid it. The real continuation is "2018). Later
    # research ..."; hard case `pdf-to-tree-p0-caption-tail`.
    assert totals["continues_in_next_column"] == 37  # 38 -> 37 with paragraph splitting; above
    assert totals["cites"] == 555  # 532 -> 555: see test_citations.BASELINE


@requires_corpus
def test_caption_block_mirrors_caption_of_in_both_directions(parsed: dict[str, Paper]) -> None:
    """The mirror agrees with the authoritative edge, and NOT merely by being non-empty.

    WATCH IT FAIL: point `apply_payload_mirrors` at `link.source` instead of `caption` and the
    forward direction breaks (a `caption_block` naming a non-caption); skip the write and the
    reverse breaks (an eligible edge with no mirror).
    """
    mirrored: Counter[str] = Counter()
    for paper in parsed.values():
        by_id = {b.block_id: b for b in paper.blocks}
        edges = {
            (r.from_, r.to)
            for r in paper.relations
            if r.type == "caption_of" and by_id[r.to].type in {"figure", "table"}
        }
        for _from, to in edges:
            payload = by_id[to].payload or {}
            assert payload.get("caption_block") is not None, (
                f"{to} is the target of a caption_of edge and carries no caption_block mirror"
            )
        for block in paper.blocks:
            caption_block = (block.payload or {}).get("caption_block")
            if caption_block is None:
                continue
            mirrored[block.type] += 1
            assert (caption_block, block.block_id) in edges, (
                f"{block.block_id}.caption_block names {caption_block} with no caption_of edge "
                "behind it — the payload has become a second derivation"
            )
            assert by_id[caption_block].type == "caption"
    # MEASURED, not assumed: every one of the 142 `caption_of` edges targets a figure or a
    # table, and every one is mirrored. My first guess here was 100 and the test caught it —
    # which is the only reason this comment can state the split with any confidence.
    # 142 -> 176 in S2's paragraph-splitting commit: see test_the_pre_existing_relation_types.
    assert dict(mirrored) == {"figure": 59, "table": 117}
    assert sum(mirrored.values()) == 176


@requires_corpus
def test_figure_caption_block_reaches_the_share_111_measured(parsed: dict[str, Paper]) -> None:
    """58 of 85 — the same numerator and denominator #111 measured for `figures.spec`.

    Independent corroboration rather than a coincidence: #111 counted figures whose caption the
    parser had LINKED, and this counts figures carrying the mirror of that link. They must agree,
    and if they ever diverge one of the two is wrong.
    """
    figures = [b for paper in parsed.values() for b in _blocks(paper, "figure")]
    with_caption = [b for b in figures if (b.payload or {}).get("caption_block")]
    # 59 of 85 since S2's paragraph splitting freed one figure caption from a paragraph block.
    assert (len(with_caption), len(figures)) == (59, 85)


@requires_corpus
def test_referenced_by_mirrors_the_references_edges(parsed: dict[str, Paper]) -> None:
    """Every mirrored id traces to an edge, and every eligible edge is mirrored.

    NOTE THE SCHEMA ASYMMETRY, enumerated from `models.py` rather than assumed: `referenced_by`
    exists on `EquationPayload` and `FigurePayload` and NOT on `TablePayload`. `_Model` forbids
    extra keys, so writing it onto a table is a pydantic `extra_forbidden` error at `Paper`
    construction — which is exactly what happened the first time this ran, on four blocks. The
    edges to tables are still emitted; only the mirror is unavailable there.
    """
    figures = equations = 0
    for paper in parsed.values():
        by_id = {b.block_id: b for b in paper.blocks}
        edges: dict[str, set[str]] = {}
        for r in paper.relations:
            if r.type == "references":
                edges.setdefault(r.to, set()).add(r.from_)

        for target, sources in edges.items():
            payload = by_id[target].payload or {}
            if by_id[target].type in {"figure", "equation"}:
                assert set(payload.get("referenced_by") or ()) == sources, (
                    f"{target}.referenced_by disagrees with its references edges"
                )
            else:
                assert "referenced_by" not in payload, (
                    f"{target} is a {by_id[target].type}; its payload has no referenced_by field"
                )

        for block in paper.blocks:
            listed = (block.payload or {}).get("referenced_by")
            if not listed:
                continue
            assert set(listed) == edges.get(block.block_id, set())
            if block.type == "figure":
                figures += 1
            elif block.type == "equation":
                equations += 1
    assert (figures, equations) == (44, 7)  # 43 at 18f69ec; pdf-to-tree p10's figure gained one


@requires_corpus
def test_equation_number_is_populated_and_is_what_makes_equation_referencing_possible(
    parsed: dict[str, Paper],
) -> None:
    """0 → 46 of 81. `equations._equation_number` always parsed it; `pipeline` discarded it.

    WATCH IT FAIL: drop the `payload["equation_number"] = numbered` line and this goes to 0 —
    and `test_referenced_by_mirrors_the_references_edges`'s equation count goes 7 → 0 with it,
    because a callout resolves by matching the printed number.
    """
    equations = [b for paper in parsed.values() for b in _blocks(paper, "equation")]
    numbered = [b for b in equations if (b.payload or {}).get("equation_number")]
    # 81 -> 80 equations in S2 (#141): superglue p7's `BERT++`, a model name set in the heading
    # face, is no longer an equation block. The 46 numbered ones are unchanged.
    # 80 -> 83 equations, 46 -> 48 numbered, with paragraph splitting: a display equation set
    # within the line pitch of its paragraph was one block with it, and equation detection needs
    # the block to be the equation's own.
    assert (len(numbered), len(equations)) == (48, 83)
    assert all(isinstance(b.payload["equation_number"], str) for b in numbered)


@requires_corpus
def test_the_askable_denominator_for_equations_is_8_not_81(parsed: dict[str, Paper]) -> None:
    """7 of 81 equations is the wrong shape of number on its own, and this is the control.

    Papers refer to equations by restating them far more often than by writing "Eq. (3)". The
    corpus contains 8 in-prose callouts to a numbered equation, of which 7 resolve. Both rates
    are reported; neither is reported alone.
    """
    import re

    callout = re.compile(r"\b(?:equations?|eqs?\.|eqs?\b)\s*\(?\s*[0-9]+(?:\.[0-9]+)*\s*\)?", re.I)
    prose_types = {"paragraph", "abstract", "footnote", "list_item"}
    total = sum(
        len(callout.findall(b.text or ""))
        for paper in parsed.values()
        for b in paper.blocks
        if b.type in prose_types
    )
    assert total == 8


@requires_corpus
def test_prev_id_and_next_id_are_still_empty_and_that_is_the_ruling(
    parsed: dict[str, Paper],
) -> None:
    """RULED: `prev_id`/`next_id` stay unpopulated, and this test is the ruling made checkable.

    #66 asked whether they are "intended to stay empty (derivable from flows) or unimplemented".
    They are the former, deliberately, for the reason the schema gives about `Reference`'s
    verbatim text: **duplicating a fact creates a second representation that drifts.** Reading
    order already has an authoritative representation in `Page.flows`, guaranteed by validator
    rule 15 and guarded by `papertree_api.ir._flows_for_page`, which RAISES rather than serve an
    order it cannot vouch for. `prev_id`/`next_id` would be a second one that must agree with it
    forever, with nothing checking that it does.

    And populating them buys nothing measurable: `papertree_retrieval.index.adjacent()` (`:665`)
    already rebuilds adjacency from `Page.flows` and honours `prev_id`/`next_id` only as an
    OVERRIDE (`:698-701`), with both paths tested. The day a parser emits them, retrieval output
    does not move except as a tie-break.

    If that ruling is ever reversed, this test is what fails, and whoever reverses it has to say
    so here rather than quietly adding a field.
    """
    populated = sum(
        1
        for paper in parsed.values()
        for b in paper.blocks
        if b.prev_id is not None or b.next_id is not None
    )
    total = sum(len(paper.blocks) for paper in parsed.values())
    # 9,903 at 18f69ec; S2 (#141) joins run-in leads (9,826) and title-first ordering reads
    # pdf-to-tree's three affiliation lines as one block (9,825).
    # ...and 10,642 with paragraph splitting (one block per printed paragraph).
    assert (populated, total) == (0, 10642)
