"""The numbers `papertree_agent_tools.grounding`'s docstring quotes, re-derived (AGENTS.md §2:
numbers get re-derived, not quoted).

`data/grounding_labelled.json` is 88 (claim, cited blocks) pairs from 11 live MiniMax-M3 answers on
the YOLO paper (2026-10-15) plus 16 claims written to be false while citing real blocks. Each is
labelled by hand, by one person: S = the cited blocks state the claim's main assertion, I =
interpretation or commentary, N = asserts something they do not (fabricated or misattributed). The
set is small, single-labeller and was used to choose the rule, so it pins the rule's behaviour on
those pairs; it does not measure how it generalises.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import pytest
from papertree_api.evidence import citation_supported, claim_verdict

ROWS: list[dict[str, Any]] = json.loads(
    (Path(__file__).parent / "data" / "grounding_labelled.json").read_text(encoding="utf-8")
)


def _verdict(row: dict[str, Any]) -> str:
    return claim_verdict(row["claim"], list(row["blocks"]), row["blocks"])


def test_the_labelled_set_is_what_the_docstring_says() -> None:
    labels = [r["label"] for r in ROWS]
    assert (len(ROWS), labels.count("S"), labels.count("I"), labels.count("N")) == (88, 53, 17, 18)
    assert sum(1 for r in ROWS if r.get("fab")) == 16


def test_genuine_claims_pass_and_fabricated_numbers_and_inventions_do_not() -> None:
    verdicts = {r["id"]: _verdict(r) for r in ROWS}
    genuine = [r for r in ROWS if r["label"] == "S"]
    assert sum(verdicts[r["id"]] == "supported" for r in genuine) == 25
    numbers = [r["id"] for r in ROWS if r.get("fab") == "number"]
    assert len(numbers) == 4 and all(verdicts[i] == "unsupported" for i in numbers)
    for kind in ("entity", "quote"):
        assert all(verdicts[r["id"]] == "unsupported" for r in ROWS if r.get("fab") == kind)
    invented = [r["id"] for r in ROWS if r.get("fab") == "invented"]
    assert sorted(i for i in invented if verdicts[i] == "unsupported") == ["F06", "F07", "F11"]
    assert verdicts["F12"] == "neutral", "the one invented finding that reuses the passage's words"
    # Both live misattributions are caught.
    assert verdicts["base1.10"] == "unsupported" and verdicts["base4.7"] == "unsupported"


def test_the_known_blind_spots_are_asserted_as_blind_spots() -> None:
    """A comparator swap, a half-true claim and a role swap reuse the passage's words, so a
    lexical check passes them. Written as an equality so that a rule that learns to see them
    fails this test and forces the docstring to be rewritten."""
    verdicts = {r["id"]: _verdict(r) for r in ROWS}
    leaks = sorted(r["id"] for r in ROWS if r["label"] == "N" and verdicts[r["id"]] == "supported")
    assert leaks == ["F09", "F10", "F15"]


def test_citation_level_precision_and_recall() -> None:
    verdicts = {r["id"]: _verdict(r) for r in ROWS}
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in ROWS:
        if row["id"].startswith(("orch", "base")):
            for marker in row["blocks"]:
                groups[(row["id"].split(".")[0], marker)].append(row)
    tp = fp = fn = tn = 0
    for rows in groups.values():
        truth = all(r["label"] != "N" for r in rows) and any(r["label"] == "S" for r in rows)
        pred = citation_supported([verdicts[r["id"]] for r in rows])  # type: ignore[misc]
        tp += pred and truth
        fp += pred and not truth
        fn += (not pred) and truth
        tn += (not pred) and not truth
    assert (len(groups), tp, fp, fn, tn) == (55, 26, 0, 20, 9)


@pytest.mark.parametrize("row", [r for r in ROWS if r.get("fab") in ("number", "entity", "quote")])
def test_a_fabricated_claim_alone_never_reads_supported(row: dict[str, Any]) -> None:
    assert citation_supported([_verdict(row)]) is False  # type: ignore[list-item]
