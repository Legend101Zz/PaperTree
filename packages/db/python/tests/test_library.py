"""``papertree_db.library`` — S1 owns this file and the module (slice-plan.md §3).

S0 commits the contract test contracts.md §9 names, ``test_list_library_one_row_per_paper``, as a
STRICT xfail on the stub: it passes as "xfailed" only while ``list_library`` raises
``NotImplementedError``. Any other failure (a wrong answer) is a real FAIL, and the day S1's
implementation makes it pass, ``strict=True`` turns the XPASS into a FAIL so the marker cannot be
forgotten. S1 deletes the marker in the PR that implements the method.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from papertree_db import PaperId, generation, open_database

from .saved_shapes import build_baseline_shape, load_fixture_paper


@pytest.mark.xfail(
    strict=True,
    raises=NotImplementedError,
    reason="S1 implements list_library (contracts.md §1.1); delete this marker in that PR",
)
def test_list_library_one_row_per_paper(tmp_path: Path) -> None:
    """N4: one row per GENERATION today. After 0005: one row per ``paper_owners`` row — the
    promoted paper once although it has two generations, and the dead-lettered upload once
    although it has no generation at all."""
    shape = build_baseline_shape(tmp_path)
    assert shape.ghost is not None
    user_id, paper_id = shape.promoted[0]
    with open_database(shape.file) as db:
        db.migrate()
        owner = db.owner_for(user_id)
        document = load_fixture_paper()
        document["generation"] = 2
        db.put_paper(owner, document)
        db.promote_generation(owner, PaperId(paper_id), generation(2))

        rows = db.list_library(owner)

    by_paper = {row.paper_id: row for row in rows}
    assert len(rows) == len(by_paper) == 2
    assert by_paper[paper_id].generation == 2
    ghost = by_paper[shape.ghost[1]]
    assert ghost.generation is None and ghost.job_state == "dead_letter"
