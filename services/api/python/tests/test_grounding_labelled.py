"""The numbers `papertree_agent_tools.grounding`'s docstring quotes, re-derived (AGENTS.md §2:
numbers get re-derived, not quoted).

`data/grounding_labelled.json` holds two sets of (claim, cited blocks) pairs, each labelled by hand
by one person: S = the cited blocks state the claim's main assertion, I = interpretation or
commentary, N = asserts something they do not (fabricated or misattributed).

  * `first` (88 pairs): 11 live MiniMax-M3 answers on the YOLO paper (2026-10-15, before the change)
    plus 16 claims written to be false while citing real blocks. The rule was chosen on it.
  * `holdout` (50 pairs): the 8 answers and 2 summaries of the post-change live journey (YOLO and
    DDPM), labelled by reading them before any verdict was computed. It found three defects in the
    first version of the rule (digits invented by NFKC, section numbers demanded of a block, framing
    words counted as content), which were fixed; so it is a held-out set only for the version
    before those fixes.

Both are small and single-labeller: they pin the rule's behaviour on these pairs and say nothing
about how it generalises.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import pytest
from papertree_agent_tools import PaperVocabulary, paper_vocabulary
from papertree_api.evidence import citation_supported, claim_verdict

ROWS: list[dict[str, Any]] = json.loads(
    (Path(__file__).parent / "data" / "grounding_labelled.json").read_text(encoding="utf-8")
)
FIRST = [r for r in ROWS if r["set"] == "first"]
HOLDOUT = [r for r in ROWS if r["set"] == "holdout"]
DDPM = [r for r in ROWS if r["set"] == "ddpm"]
#: DDPM's real heading blocks as the index delivers them (``Forward process and LT\n3.1``,
#: ``Introduction``, ``3.4\nSimplified ...``), in reading order.
DDPM_HEADINGS: list[dict[str, str]] = json.loads(
    (Path(__file__).parent / "data" / "ddpm_headings.json").read_text(encoding="utf-8")
)
#: The other DDPM blocks the live runs had in their handle tables (a slice of the paper's body).
DDPM_BLOCKS: dict[str, str] = json.loads(
    (Path(__file__).parent / "data" / "ddpm_blocks.json").read_text(encoding="utf-8")
)


def _proxy_paper(rows: list[dict[str, Any]], with_ddpm_headings: bool = False) -> PaperVocabulary:
    """What the API passes in production is the WHOLE paper's vocabulary (``evidence.
    vocabulary_of``). The labelled sets keep only the cited blocks, so the proxy for a paper is the
    union of every block the set cites, plus the structure references of the real papers' headings
    that no cited block carries (``Section 4.2`` is DDPM's heading, not a sentence): when asked,
    DDPM's real heading blocks, run through the same ``paper_vocabulary`` as production (the
    hand-added references this used to carry hid how DDPM's headings really arrive)."""
    texts = {f"{r['set']}:{k}": t for r in rows for k, t in r["blocks"].items()}
    heading_ids: frozenset[str] = frozenset()
    if with_ddpm_headings:
        headings = {h["id"]: h["text"] for h in DDPM_HEADINGS}
        heading_ids = frozenset(headings)
        texts = {**headings, **DDPM_BLOCKS, **texts}
    return paper_vocabulary(texts, heading_ids=heading_ids)


PAPERS = {
    "first": _proxy_paper(FIRST),
    "holdout": _proxy_paper(HOLDOUT, with_ddpm_headings=True),
    "ddpm": _proxy_paper(DDPM, with_ddpm_headings=True),
}


def _verdict(row: dict[str, Any]) -> str:
    return claim_verdict(row["claim"], list(row["blocks"]), row["blocks"], PAPERS[row["set"]])


def _citations(rows: list[dict[str, Any]]) -> tuple[int, int, int, int, int]:
    """`(citations, tp, fp, fn, tn)`: a citation is truly supported when no claim carrying it is N
    and at least one is S; threaded answers only (a summary bullet is one claim)."""
    verdicts = {r["id"]: _verdict(r) for r in rows}
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("src") != "summary" and not row.get("fab"):
            for marker in row["blocks"]:
                groups[(row["id"].split(".")[0], marker)].append(row)
    tp = fp = fn = tn = 0
    for members in groups.values():
        truth = all(r["label"] != "N" for r in members) and any(r["label"] == "S" for r in members)
        pred = citation_supported([verdicts[r["id"]] for r in members]) is True  # type: ignore[misc]
        tp += pred and truth
        fp += pred and not truth
        fn += (not pred) and truth
        tn += (not pred) and not truth
    return len(groups), tp, fp, fn, tn


def test_the_labelled_sets_are_what_the_docstring_says() -> None:
    first = [r["label"] for r in FIRST]
    assert (len(first), first.count("S"), first.count("I"), first.count("N")) == (88, 53, 17, 18)
    assert sum(1 for r in FIRST if r.get("fab")) == 16
    hold = [r["label"] for r in HOLDOUT]
    assert (len(hold), hold.count("S"), hold.count("I"), hold.count("N")) == (50, 45, 5, 0)


def test_genuine_claims_pass_and_fabricated_numbers_and_inventions_do_not() -> None:
    verdicts = {r["id"]: _verdict(r) for r in FIRST}
    genuine = [r for r in FIRST if r["label"] == "S"]
    assert sum(verdicts[r["id"]] == "supported" for r in genuine) == 31
    numbers = [r["id"] for r in FIRST if r.get("fab") == "number"]
    assert len(numbers) == 4 and all(verdicts[i] == "unsupported" for i in numbers)
    for kind in ("entity", "quote"):
        assert all(verdicts[r["id"]] == "unsupported" for r in FIRST if r.get("fab") == kind)
    invented = [r["id"] for r in FIRST if r.get("fab") == "invented"]
    assert sorted(i for i in invented if verdicts[i] == "unsupported") == ["F06", "F07", "F11"]
    assert verdicts["F12"] == "neutral", "the one invented finding that reuses the passage's words"
    # Both live misattributions are caught.
    assert verdicts["base1.10"] == "unsupported" and verdicts["base4.7"] == "unsupported"


def test_the_known_blind_spots_are_asserted_as_blind_spots() -> None:
    """A comparator swap, a half-true claim and a role swap reuse the passage's words, so a
    lexical check passes them. Written as an equality so that a rule that learns to see them
    fails this test and forces the docstring to be rewritten."""
    verdicts = {r["id"]: _verdict(r) for r in FIRST}
    leaks = sorted(r["id"] for r in FIRST if r["label"] == "N" and verdicts[r["id"]] == "supported")
    assert leaks == ["F09", "F10", "F15"]


def test_citation_level_precision_and_recall_on_the_first_set() -> None:
    assert _citations(FIRST) == (55, 30, 0, 16, 9)


def test_the_holdout_set_genuine_claims_and_citations() -> None:
    verdicts = {r["id"]: _verdict(r) for r in HOLDOUT}
    genuine = [r for r in HOLDOUT if r["label"] == "S"]
    assert sum(verdicts[r["id"]] == "supported" for r in genuine) == 38
    bullets = [r for r in genuine if r["src"] == "summary"]
    assert len(bullets) == 14 and all(verdicts[r["id"]] == "supported" for r in bullets)
    assert _citations(HOLDOUT) == (34, 23, 0, 7, 4)


@pytest.mark.parametrize("row", [r for r in FIRST if r.get("fab") in ("number", "entity", "quote")])
def test_a_fabricated_claim_alone_never_reads_supported(row: dict[str, Any]) -> None:
    assert citation_supported([_verdict(row)]) is False  # type: ignore[list-item]


def test_genuine_ddpm_claims_with_section_references_and_hyphen_compounds_are_not_flagged() -> None:
    """Three claims from the live DDPM answers (W2API review, 2026-10-15) that an earlier version
    of the rules called unsupported: ``Section 2`` and ``Section 3.1`` name headings that reach the
    index without a number of their own or with it on a trailing line, and ``Gaussian-vs-Gaussian``
    is a compound of a word the paper is full of. Each cites the right block."""
    assert len(DDPM) == 3 and all(r["label"] == "S" for r in DDPM)
    verdicts = {r["id"]: _verdict(r) for r in DDPM}
    assert verdicts["ddpm0.0"] == "supported"
    assert verdicts["ddpm0.1"] != "unsupported"
    assert verdicts["ddpm1.0"] != "unsupported"
