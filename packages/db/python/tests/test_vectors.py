"""block_vectors — proves sqlite-vec loads under uv-managed CPython and the vec0 table works.

Epic 0 computes NO embeddings: every vector here is a hand-written dummy. There is no model,
no embedding call and no network in this file, and that is a scope boundary, not an omission.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from papertree_db import VECTOR_DIMENSIONS, generation, open_database, to_vector_blob
from papertree_db.ids import BlockId, PaperId

from .fixtures import block_id_for, make_paper

GEN = generation(1)


def unit(index: int) -> list[float]:
    v = [0.0] * VECTOR_DIMENSIONS
    v[index] = 1.0
    return v


def test_insert_and_search_a_dummy_vector(tmp_path: Path) -> None:
    with open_database(tmp_path / "vec.sqlite") as db:
        db.migrate()
        owner = db.create_user("vec@papertree.test")
        paper_id = PaperId("ppr_0000000000000000000000VEC1")
        db.put_paper(owner, make_paper(paper_id, "sha256:" + "d" * 64, 1, 4))

        for i in range(4):
            db.put_block_vector(
                owner, paper_id, GEN, BlockId(block_id_for(i)), "dummy-768", unit(i)
            )
        assert db.count_block_vectors(owner, paper_id, GEN) == 4

        hits = db.search_block_vectors(owner, paper_id, GEN, unit(2), 2)
        assert len(hits) == 2
        assert hits[0]["block_id"] == block_id_for(2)
        assert hits[0]["distance"] == pytest.approx(0.0, abs=1e-5)
        assert hits[1]["distance"] > 0


def test_put_replaces_rather_than_duplicates(tmp_path: Path) -> None:
    with open_database(tmp_path / "vec.sqlite") as db:
        db.migrate()
        owner = db.create_user("vec2@papertree.test")
        paper_id = PaperId("ppr_0000000000000000000000VEC2")
        db.put_paper(owner, make_paper(paper_id, "sha256:" + "e" * 64, 1, 2))
        block_id = BlockId(block_id_for(0))

        db.put_block_vector(owner, paper_id, GEN, block_id, "dummy-768", unit(0))
        db.put_block_vector(owner, paper_id, GEN, block_id, "dummy-768", unit(5))
        assert db.count_block_vectors(owner, paper_id, GEN) == 1
        hits = db.search_block_vectors(owner, paper_id, GEN, unit(5), 1)
        assert hits[0]["distance"] == pytest.approx(0.0, abs=1e-5)


def test_generations_of_the_same_block_do_not_collide(tmp_path: Path) -> None:
    """vec0's `text primary key` is GLOBALLY unique, so `block_id` alone would collide the
    moment generation 2 exists — the D13 collision inside the vector table. The composite
    vec_key is what makes this pass."""
    with open_database(tmp_path / "vec.sqlite") as db:
        db.migrate()
        owner = db.create_user("vec3@papertree.test")
        paper_id = PaperId("ppr_0000000000000000000000VEC3")
        source_hash = "sha256:" + "0" * 64
        db.put_paper(owner, make_paper(paper_id, source_hash, 1, 2))
        db.put_paper(owner, make_paper(paper_id, source_hash, 2, 2))
        block_id = BlockId(block_id_for(0))

        db.put_block_vector(owner, paper_id, generation(1), block_id, "dummy-768", unit(0))
        db.put_block_vector(owner, paper_id, generation(2), block_id, "dummy-768", unit(1))

        assert db.count_block_vectors(owner, paper_id, generation(1)) == 1
        assert db.count_block_vectors(owner, paper_id, generation(2)) == 1
        g1 = db.search_block_vectors(owner, paper_id, generation(1), unit(0), 1)
        g2 = db.search_block_vectors(owner, paper_id, generation(2), unit(0), 1)
        assert g1[0]["distance"] == pytest.approx(0.0, abs=1e-5)
        assert g2[0]["distance"] > 0


def test_wrong_width_is_rejected_before_sqlite_sees_it() -> None:
    with pytest.raises(ValueError, match="768 dimensions"):
        to_vector_blob([0.0, 1.0])
