"""db/ownership.spec, Python half — the RUNTIME assertions.

  "Every query helper requires an owner argument. A query built without one ... raises
   (Python)."

The static half is in ``test_typing.py``: ``# type: ignore[...]`` comments on the illegal
calls, which fail ``mypy --strict`` (``warn_unused_ignores``) if the call ever becomes
legal — the exact mirror of ``@ts-expect-error`` on the TypeScript side.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
import sqlite_vec  # type: ignore[import-untyped]
from papertree_db import OwnershipError, PaperTreeDb, generation, open_database
from papertree_db.ids import BlockId, DerivationId, HighlightId, OwnerId, PaperId

from .fixtures import block_id_for, make_paper

GEN = generation(1)

OWNED_TABLES = (
    "papers",
    "paper_owners",
    "paper_promotions",
    "pages",
    "blocks",
    "relations",
    "highlights",
    "anchors",
    "derivations",
)


@dataclass(frozen=True, slots=True)
class Tenant:
    owner: OwnerId
    paper_id: PaperId
    block_id: BlockId
    highlight_id: HighlightId
    derivation_id: DerivationId


def _seed(db: PaperTreeDb, email: str, paper_id: str, hash_char: str) -> Tenant:
    owner = db.create_user(email)
    pid = PaperId(paper_id)
    db.put_paper(owner, make_paper(paper_id, "sha256:" + hash_char * 64, 1, 8))
    block_id = BlockId(block_id_for(3))
    highlight_id = db.create_highlight(owner, pid, GEN, "yellow", f"{email} private note")
    db.create_anchor(
        owner,
        highlight_id,
        pid,
        GEN,
        block_id,
        1,
        [[72, 100], [540, 100], [540, 110], [72, 110]],
        [72, 100, 540, 110],
        text_quote=f"{email} selected text",
        content_hash="sha256:" + format(3, "x").rjust(64, "0"),
    )
    derivation_id = db.create_derivation(
        owner,
        pid,
        GEN,
        "explanation",
        "anthropic/claude-haiku-4.5",
        "sha256:deadbeefdeadbeef",
        {"text": f"{email} explanation root"},
        [block_id],
    )
    db.create_derivation(
        owner,
        pid,
        GEN,
        "explanation",
        "anthropic/claude-haiku-4.5",
        "sha256:deadbeefdeadbeef",
        {"text": f"{email} explanation child"},
        [block_id],
        parent_derivation_id=derivation_id,
    )
    return Tenant(owner, pid, block_id, highlight_id, derivation_id)


@dataclass(frozen=True, slots=True)
class Env:
    """Fully annotated on purpose: an untyped fixture makes `db` an implicit Any, and then
    every `# type: ignore` in this file would silently become decoration."""

    db: PaperTreeDb
    alice: Tenant
    bob: Tenant
    file: Path


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    file = tmp_path / "papertree.sqlite"
    db = open_database(file)
    db.migrate()
    alice = _seed(db, "alice@papertree.test", "ppr_0000000000000000000000ALIC", "a")
    bob = _seed(db, "bob@papertree.test", "ppr_00000000000000000000000BOB", "b")
    yield Env(db, alice, bob, file)
    db.close()


# ── the owner cannot be forged ──────────────────────────────────────────────────────


def test_owner_id_cannot_be_constructed_directly() -> None:
    with pytest.raises(OwnershipError, match="cannot be constructed directly"):
        OwnerId("usr_not_a_real_owner")


def test_helpers_reject_a_bare_string_at_runtime(env: Env) -> None:
    db, _alice, _bob, _file = env.db, env.alice, env.bob, env.file
    # mypy rejects this statically (test_typing.py); this is the runtime half.
    with pytest.raises(OwnershipError):
        db.list_papers("usr_not_a_real_owner")  # type: ignore[arg-type]


def test_helpers_raise_when_the_owner_argument_is_omitted(env: Env) -> None:
    db, alice, _bob, _file = env.db, env.alice, env.bob, env.file
    with pytest.raises(TypeError, match="required positional argument"):
        db.list_papers()  # type: ignore[call-arg]
    with pytest.raises(TypeError, match="required positional argument"):
        db.get_paper(alice.paper_id, GEN)  # type: ignore[call-arg]


def test_an_owner_from_another_connection_is_not_trusted(env: Env) -> None:
    _db, alice, _bob, file = env.db, env.alice, env.bob, env.file
    with open_database(file) as fresh:
        fresh.migrate()
        with pytest.raises(OwnershipError):
            fresh.list_papers(alice.owner)
        # Authenticating is the supported path, and it works.
        reauthenticated = fresh.authenticate(alice.owner.value)
        assert len(fresh.list_papers(reauthenticated)) == 1


def test_authenticate_refuses_an_unknown_user(env: Env) -> None:
    db, _alice, _bob, _file = env.db, env.alice, env.bob, env.file
    with pytest.raises(OwnershipError, match="no such user"):
        db.authenticate("usr_nobody")


# ── cross-owner READ ────────────────────────────────────────────────────────────────


def test_cannot_read_another_owners_paper(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    assert db.get_paper(alice.owner, alice.paper_id, GEN) is not None
    assert db.get_paper(alice.owner, bob.paper_id, GEN) is None
    assert [p["paper_id"] for p in db.list_papers(alice.owner)] == [alice.paper_id]
    assert db.list_generations(alice.owner, bob.paper_id) == []


def test_cannot_read_another_owners_blocks_or_pages(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    assert db.get_block(alice.owner, alice.paper_id, GEN, alice.block_id) is not None
    # Same block_id string — content-derived ids are not secret — but Bob's paper.
    assert db.get_block(alice.owner, bob.paper_id, GEN, bob.block_id) is None
    assert db.list_blocks_in_doc_order(alice.owner, bob.paper_id, GEN) == []
    assert db.list_blocks_on_page(alice.owner, bob.paper_id, GEN, 0) == []
    assert db.list_pages(alice.owner, bob.paper_id, GEN) == []
    assert db.count_blocks(alice.owner, bob.paper_id, GEN) == 0
    assert db.list_relations(alice.owner, bob.paper_id, GEN) == []


def test_cannot_read_another_owners_highlights_anchors_derivations(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    assert db.get_highlight(alice.owner, alice.highlight_id) is not None
    assert db.get_highlight(alice.owner, bob.highlight_id) is None
    assert db.list_highlights(alice.owner, bob.paper_id, GEN) == []
    assert len(db.list_anchors(alice.owner, alice.highlight_id)) == 1
    assert db.list_anchors(alice.owner, bob.highlight_id) == []
    assert db.get_derivation(alice.owner, alice.derivation_id) is not None
    assert db.get_derivation(alice.owner, bob.derivation_id) is None


# ── cross-owner WRITE — findings.md §F1 ─────────────────────────────────────────────


def test_a_write_scoped_to_alice_cannot_mutate_bobs_row(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    before = db.get_highlight(bob.owner, bob.highlight_id)
    assert before is not None and before["note"] == "bob@papertree.test private note"

    assert db.update_highlight_note(alice.owner, bob.highlight_id, "pwned") == 0

    after = db.get_highlight(bob.owner, bob.highlight_id)
    assert after is not None and after["note"] == before["note"]


def test_a_delete_scoped_to_alice_cannot_remove_bobs_rows(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    assert db.delete_highlight(alice.owner, bob.highlight_id) == 0
    assert db.get_highlight(bob.owner, bob.highlight_id) is not None
    assert db.delete_paper(alice.owner, bob.paper_id) == 0
    assert db.get_paper(bob.owner, bob.paper_id, GEN) is not None
    # …and the owner's own delete does work, so this is not passing vacuously.
    assert db.delete_highlight(bob.owner, bob.highlight_id) == 1


def test_alice_cannot_attach_a_highlight_to_bobs_paper(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        db.create_highlight(alice.owner, bob.paper_id, GEN, "red")


def test_alice_cannot_anchor_onto_bobs_block(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        db.create_anchor(
            alice.owner,
            alice.highlight_id,
            bob.paper_id,
            GEN,
            bob.block_id,
            1,
            [[0, 0], [1, 0], [1, 1]],
            [0, 0, 1, 1],
        )


def test_alice_cannot_claim_a_paper_id_bound_to_bob(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    with pytest.raises(OwnershipError, match="belongs to another owner"):
        db.put_paper(alice.owner, make_paper(bob.paper_id, "sha256:" + "f" * 64, 2, 2))


def test_alice_cannot_parent_onto_bobs_derivation_tree(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        db.create_derivation(
            alice.owner,
            alice.paper_id,
            GEN,
            "explanation",
            "m",
            "sha256:abcdabcd",
            {},
            [alice.block_id],
            parent_derivation_id=bob.derivation_id,
        )


# ── joins keep the owner on EVERY table — findings.md §F3 ───────────────────────────


def test_join_across_three_tables_is_owner_scoped_throughout(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    mine = db.resolve_highlights(alice.owner, alice.paper_id, GEN)
    assert len(mine) == 1
    assert mine[0]["text_quote"] == "alice@papertree.test selected text"
    assert "Paragraph 3" in str(mine[0]["block_text"])
    # The join also surfaces the tier-1 confirmation ADR-001 §E.2 makes mandatory.
    assert mine[0]["anchor_content_hash"] == mine[0]["block_content_hash"]

    assert db.resolve_highlights(alice.owner, bob.paper_id, GEN) == []
    assert db.resolve_highlights(bob.owner, alice.paper_id, GEN) == []


def test_derivation_tree_is_owner_filtered_at_every_level(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    tree = db.derivation_tree(alice.owner, alice.derivation_id)
    assert [row["depth"] for row in tree] == [0, 1]
    assert all(row["owner_id"] == alice.owner.value for row in tree)
    assert db.derivation_tree(alice.owner, bob.derivation_id) == []


def test_derivation_tree_is_depth_bounded(env: Env) -> None:
    db, alice, _bob, _file = env.db, env.alice, env.bob, env.file
    parent = alice.derivation_id
    for i in range(6):
        parent = db.create_derivation(
            alice.owner,
            alice.paper_id,
            GEN,
            "explanation",
            "m",
            "sha256:abcdabcd",
            {"i": i},
            [alice.block_id],
            parent_derivation_id=parent,
        )
    assert len(db.derivation_tree(alice.owner, alice.derivation_id)) == 8
    assert len(db.derivation_tree(alice.owner, alice.derivation_id, 2)) == 4


# ── vectors ─────────────────────────────────────────────────────────────────────────


def test_vector_search_never_visits_another_owners_partition(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    a_vec = [0.0] * 768
    a_vec[0] = 1.0
    b_vec = [0.0] * 768
    b_vec[1] = 1.0
    db.put_block_vector(alice.owner, alice.paper_id, GEN, alice.block_id, "test-model", a_vec)
    db.put_block_vector(bob.owner, bob.paper_id, GEN, bob.block_id, "test-model", b_vec)

    assert db.count_block_vectors(alice.owner, alice.paper_id, GEN) == 1
    # Alice naming Bob's paper_id addresses "alice/<bob's paper>@1", which does not exist.
    assert db.count_block_vectors(alice.owner, bob.paper_id, GEN) == 0

    hits = db.search_block_vectors(alice.owner, alice.paper_id, GEN, a_vec, 5)
    assert [h["block_id"] for h in hits] == [alice.block_id]
    assert db.search_block_vectors(alice.owner, bob.paper_id, GEN, a_vec, 5) == []


# ── the schema itself carries the owner (gate 4) ────────────────────────────────────


def test_every_owned_table_has_a_not_null_owner_id(env: Env) -> None:
    _db, _alice, _bob, file = env.db, env.alice, env.bob, env.file
    raw = sqlite3.connect(file)
    try:
        for table in OWNED_TABLES:
            columns = raw.execute(f"PRAGMA table_info({table})").fetchall()
            owner_column = next((c for c in columns if c[1] == "owner_id"), None)
            assert owner_column is not None, f"{table} has no owner_id column"
            assert owner_column[3] == 1, f"{table}.owner_id is nullable"
    finally:
        raw.close()


def test_every_foreign_key_between_owned_tables_includes_owner_id(env: Env) -> None:
    _db, _alice, _bob, file = env.db, env.alice, env.bob, env.file
    raw = sqlite3.connect(file)
    checked = 0
    try:
        for table in OWNED_TABLES:
            grouped: dict[int, tuple[str, list[str], list[str]]] = {}
            for fk in raw.execute(f"PRAGMA foreign_key_list({table})").fetchall():
                fk_id, _seq, parent, from_col, to_col = fk[0], fk[1], fk[2], fk[3], fk[4]
                entry = grouped.setdefault(int(fk_id), (str(parent), [], []))
                entry[1].append(str(from_col))
                entry[2].append(str(to_col if to_col is not None else from_col))
            for parent, from_cols, to_cols in grouped.values():
                if parent not in OWNED_TABLES:
                    continue  # FKs onto `users` are the definition of an owner.
                checked += 1
                assert "owner_id" in from_cols, f"{table} -> {parent} drops owner_id (child)"
                assert "owner_id" in to_cols, f"{table} -> {parent} drops owner_id (parent)"
    finally:
        raw.close()
    # Guard against the audit passing because it found nothing to audit.
    assert checked >= 8


def test_foreign_keys_are_off_by_default_in_python_and_on_in_papertreedb(env: Env) -> None:
    db, alice, bob, file = env.db, env.alice, env.bob, env.file
    raw = sqlite3.connect(file)
    try:
        # Python's sqlite3 defaults foreign_keys OFF. Gate 4 is inert without the pragma,
        # which is exactly why PaperTreeDb.__init__ sets it explicitly.
        assert raw.execute("PRAGMA foreign_keys").fetchone()[0] == 0
    finally:
        raw.close()
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        db.create_highlight(alice.owner, bob.paper_id, GEN, "red")


def test_deleting_a_user_cascades_to_papers_blocks_highlights_and_vectors(env: Env) -> None:
    db, alice, bob, file = env.db, env.alice, env.bob, env.file
    vec = [0.0] * 768
    vec[0] = 1.0
    db.put_block_vector(bob.owner, bob.paper_id, GEN, bob.block_id, "test-model", vec)
    assert db.count_block_vectors(bob.owner, bob.paper_id, GEN) == 1

    raw = sqlite3.connect(file, isolation_level=None)
    raw.enable_load_extension(True)
    sqlite_vec.load(raw)  # the papers AFTER DELETE trigger touches the vec0 table
    raw.enable_load_extension(False)
    raw.execute("PRAGMA foreign_keys = ON")
    raw.execute("DELETE FROM users WHERE user_id = ?", (bob.owner.value,))
    raw.close()

    assert db.get_paper(bob.owner, bob.paper_id, GEN) is None
    assert db.count_blocks(bob.owner, bob.paper_id, GEN) == 0
    assert db.get_highlight(bob.owner, bob.highlight_id) is None
    # vec0 cannot cascade; the trigger does it, and it fires under a cascade too.
    assert db.count_block_vectors(bob.owner, bob.paper_id, GEN) == 0
    # Alice is untouched.
    assert db.get_paper(alice.owner, alice.paper_id, GEN) is not None
