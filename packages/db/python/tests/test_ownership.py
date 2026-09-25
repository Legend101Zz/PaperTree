"""db/ownership.spec, Python half — the RUNTIME assertions.

  "Every query helper requires an owner argument. A query built without one ... raises
   (Python)."

The static half is in ``test_typing.py``: ``# type: ignore[...]`` comments on the illegal
calls, which fail ``mypy --strict`` (``warn_unused_ignores``) if the call ever becomes
legal — the exact mirror of ``@ts-expect-error`` on the TypeScript side.
"""

from __future__ import annotations

import ast
import copy
import json
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
import sqlite_vec  # type: ignore[import-untyped]
from papertree_db import (
    AnchorIn,
    OwnershipError,
    PaperNotFound,
    PaperTreeDb,
    ResolutionIn,
    generation,
    open_database,
)
from papertree_db.ids import BlockId, DerivationId, OwnerId, PaperId

from .fixtures import block_id_for, make_anchor, make_paper

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
    # 0005_reader_release.sql (contracts.md §1): user-owned state keyed to the PAPER, and the one
    # parse-keyed cache. `highlights` and `anchors` above are 0005's REBUILT tables.
    "anchor_resolutions",
    "ai_threads",
    "ai_messages",
    "ai_citations",
    "ai_runs",
    "ai_run_handles",
    "canvas_boards",
    "canvas_nodes",
    "canvas_edges",
)

#: The 9 tables contracts.md §1 says 0005 adds to the owner-FK audit.
NEW_IN_0005 = OWNED_TABLES[-9:]


@dataclass(frozen=True, slots=True)
class Tenant:
    owner: OwnerId
    user_id: str
    paper_id: PaperId
    block_id: BlockId
    highlight_id: str
    anchor_id: str
    derivation_id: DerivationId


def _seed(db: PaperTreeDb, email: str, paper_id: str, hash_char: str) -> Tenant:
    created = db.create_user(email)
    owner, user_id = created.owner, created.user_id
    pid = PaperId(paper_id)
    db.put_paper(owner, make_paper(paper_id, "sha256:" + hash_char * 64, 1, 8))
    block_id = BlockId(block_id_for(3))
    tag = "ALIC" if email.startswith("alice") else "BOBB"
    highlight_id = f"hl_0000000000000000000000{tag}"
    anchor_id = f"anc_000000000000000000000{tag}"
    anchor = make_anchor(paper_id, "sha256:" + hash_char * 64, block_id, anchor_id)
    anchor["selectors"][2]["exact"] = f"{email} selected text"
    db.create_highlight(
        owner,
        pid,
        highlight_id=highlight_id,
        color="amber",
        note=f"{email} private note",
        created_generation=1,
        anchors=[AnchorIn(anchor)],
        resolutions=[
            ResolutionIn(
                anchor_id=anchor_id,
                generation=1,
                tier=1,
                state="anchored",
                block_ids=[block_id],
                score=1.0,
                resolver_version="db-tests",
            )
        ],
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
    return Tenant(owner, user_id, pid, block_id, highlight_id, anchor_id, derivation_id)


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
        # Minting on THIS connection is the supported path, and it works.
        reminted = fresh.owner_for(alice.user_id)
        assert len(fresh.list_papers(reminted)) == 1


def test_owner_for_refuses_an_unknown_user(env: Env) -> None:
    db, _alice, _bob, _file = env.db, env.alice, env.bob, env.file
    with pytest.raises(OwnershipError, match="no such user"):
        db.owner_for("usr_nobody")


def test_owner_for_is_a_seam_and_is_meant_to_be(env: Env) -> None:
    """``owner_for`` PERFORMS NO AUTHENTICATION, and this test says so out loud.

    Gate 3 makes a user id worthless to code that holds only an owner handle - which is the code
    inside a request handler, and the whole point. But ``owner_for(bob_user_id)`` returns a
    working owner for Bob, and the user id is not secret: it appears in URLs, logs and emails,
    and ``create_user`` hands it straight back. "No auth beyond a users table" is a stated
    non-goal of Epic 0, so the seam is INTENDED - but it is a seam, the method used to be called
    ``authenticate`` (a name that asserted the opposite), and an intended seam nobody wrote down
    is indistinguishable from an oversight. The mint belongs outside the request handler.
    """
    db, _alice, bob, _file = env.db, env.alice, env.bob, env.file
    forged = db.owner_for(bob.user_id)
    got = db.get_highlight(forged, bob.paper_id, bob.highlight_id, 1)
    assert got is not None and got.note == "bob@papertree.test private note"


def test_a_forged_owner_id_is_worthless_however_it_is_built(env: Env) -> None:
    """findings.md §F1, and the three ways an adversarial review reproduced it.

    All three built a real ``OwnerId`` carrying the VICTIM'S USER ID, which the previous design
    accepted because it checked ``owner.value in self._minted`` - a set of user ids, every one of
    which is public. The handle redesign makes each of them produce an object holding a string no
    connection ever minted.
    """
    db, _alice, bob, _file = env.db, env.alice, env.bob, env.file
    from papertree_db import ids as ids_module

    # 1. import the module-private mint token and construct directly.
    with pytest.raises(OwnershipError):
        db.list_papers(ids_module.OwnerId(bob.user_id, ids_module._MINT))

    # 2. mint_owner() is PUBLIC, and that is safe: it mints a handle nobody recorded.
    _handle, unrecorded = ids_module.mint_owner()
    with pytest.raises(OwnershipError):
        db.list_papers(unrecorded)

    # 3. copy.copy of a legitimate owner, then mutate the slot. Stdlib only, no private import;
    #    __slots__ are writable and copy preserves the mint sentinel, so this passed isinstance
    #    AND the .value re-check under the old design.
    stolen = copy.copy(bob.owner)
    stolen._handle = bob.user_id  # noqa: SLF001
    with pytest.raises(OwnershipError):
        db.list_papers(stolen)

    # 4. object.__new__, the original break, still closed by the mint sentinel.
    bypassed = object.__new__(ids_module.OwnerId)
    with pytest.raises(OwnershipError):
        db.list_papers(bypassed)

    # Non-vacuous: the genuine owner works for all four calls above.
    assert len(db.list_papers(bob.owner)) == 1


def test_the_user_id_is_not_the_credential(env: Env) -> None:
    """The property the whole redesign buys: naming a tenant gets you nothing.

    ``repr`` must not leak the handle either - an owner in a log line or a traceback would
    otherwise be a working credential.
    """
    _db, _alice, bob, _file = env.db, env.alice, env.bob, env.file
    assert bob.user_id.startswith("usr_")
    assert bob.owner.handle.startswith("own_")
    assert bob.owner.handle != bob.user_id
    assert bob.user_id not in repr(bob.owner)
    assert bob.owner.handle not in repr(bob.owner)
    assert bob.owner.handle not in str(bob.owner)


def test_conn_is_a_forbidden_token_outside_papertree_db() -> None:
    """Gate 1 is language-enforced in TypeScript and CONVENTION in Python - so lint the convention.

    ``db._conn`` is one attribute lookup from a live ``sqlite3.Connection`` and therefore from an
    unscoped cross-tenant UPDATE. Nothing in Python can make that impossible, so the honest move
    is to say so (see ``database.py``'s gate 1) and to make the convention checkable.
    """
    root = Path(__file__).resolve().parents[4]
    # The only two modules entitled to touch a connection are the two that OPEN one. Everything
    # else — including the tests — must go through a method that takes an owner.
    owners_of_a_connection = {
        "packages/db/python/papertree_db/database.py",
        "packages/db/python/papertree_db/migrate.py",
        "packages/jobs/python/papertree_jobs/store.py",
        # The four feature mixins of PaperTreeDb (contracts.md §1.1). They ARE papertree_db: each
        # is a slice of the one class that owns the connection, split into files only so that one
        # slice owns each file. They hold no connection of their own (`__slots__ = ()`).
        "packages/db/python/papertree_db/library.py",
        "packages/db/python/papertree_db/highlights.py",
        "packages/db/python/papertree_db/ai.py",
        "packages/db/python/papertree_db/canvas.py",
    }
    # Parsed, not grepped: an `ast.Attribute` named `_conn` is a real access, whereas a grep also
    # hits every docstring that explains the rule — including the ones in this repo that do.
    offenders: list[str] = []
    for package in ("packages/db/python", "packages/jobs/python", "packages/document-ir/python"):
        for path in sorted((root / package).rglob("*.py")):
            relative = str(path.relative_to(root))
            if relative in owners_of_a_connection:
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            if any(
                isinstance(node, ast.Attribute) and node.attr == "_conn" for node in ast.walk(tree)
            ):
                offenders.append(relative)
    assert offenders == [], f"._conn reached outside a connection owner: {offenders}"


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
    mine = db.get_highlight(alice.owner, alice.paper_id, alice.highlight_id, 1)
    assert mine is not None and len(mine.anchors) == 1
    assert db.get_highlight(alice.owner, bob.paper_id, bob.highlight_id, 1) is None
    # Bob's highlight id under Alice's own paper is not found either.
    assert db.get_highlight(alice.owner, alice.paper_id, bob.highlight_id, 1) is None
    assert db.list_highlights(alice.owner, bob.paper_id, GEN) == []
    assert db.get_derivation(alice.owner, alice.derivation_id) is not None
    assert db.get_derivation(alice.owner, bob.derivation_id) is None


# ── cross-owner WRITE — findings.md §F1 ─────────────────────────────────────────────


def test_a_write_scoped_to_alice_cannot_mutate_bobs_row(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    before = db.get_highlight(bob.owner, bob.paper_id, bob.highlight_id, 1)
    assert before is not None and before.note == "bob@papertree.test private note"

    assert db.update_highlight(alice.owner, bob.paper_id, bob.highlight_id, note="pwned") is None
    assert db.update_highlight(alice.owner, alice.paper_id, bob.highlight_id, note="pwned") is None
    assert db.put_resolutions(alice.owner, alice.paper_id, 1, []) == 0  # her own: allowed, empty
    with pytest.raises(PaperNotFound):
        db.put_resolutions(alice.owner, bob.paper_id, 1, [])

    after = db.get_highlight(bob.owner, bob.paper_id, bob.highlight_id, 1)
    assert after is not None and after.note == before.note


def test_a_delete_scoped_to_alice_cannot_remove_bobs_rows(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    assert db.delete_highlight(alice.owner, bob.paper_id, bob.highlight_id) == 0
    assert db.delete_highlight(alice.owner, alice.paper_id, bob.highlight_id) == 0
    assert db.get_highlight(bob.owner, bob.paper_id, bob.highlight_id, 1) is not None
    assert db.delete_paper(alice.owner, bob.paper_id) == 0
    assert db.get_paper(bob.owner, bob.paper_id, GEN) is not None
    # …and the owner's own delete does work, so this is not passing vacuously.
    assert db.delete_highlight(bob.owner, bob.paper_id, bob.highlight_id) == 1


def test_alice_cannot_attach_a_highlight_to_bobs_paper(env: Env) -> None:
    """Twice over: the helper refuses (``PaperNotFound``), and so does the SCHEMA underneath it,
    because 0005's ``highlights -> paper_owners`` FK carries ``owner_id`` (gate 4)."""
    db, alice, bob, file = env.db, env.alice, env.bob, env.file
    anchor = make_anchor(
        bob.paper_id, "sha256:" + "b" * 64, bob.block_id, "anc_0000000000000000000000EVIL"
    )
    with pytest.raises(PaperNotFound):
        db.create_highlight(
            alice.owner,
            bob.paper_id,
            highlight_id="hl_0000000000000000000000EVIL",
            color="amber",
            note=None,
            created_generation=1,
            anchors=[AnchorIn(anchor)],
            resolutions=[],
        )
    raw = _raw(file)
    try:
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            raw.execute(
                "INSERT INTO highlights (highlight_id, owner_id, paper_id, color, "
                "created_generation, created_at, updated_at) "
                "VALUES (?, ?, ?, 'amber', 1, 'x', 'x')",
                ("hl_0000000000000000000000EVIL", alice.user_id, bob.paper_id),
            )
    finally:
        raw.close()


def test_alice_cannot_hang_an_anchor_or_a_cache_entry_on_bobs_rows(env: Env) -> None:
    """0005's owned chain: anchors -> highlights, anchor_resolutions -> anchors AND -> papers. Each
    FK carries ``owner_id``, so every cross-tenant attachment fails in the schema itself."""
    _db, alice, bob, file = env.db, env.alice, env.bob, env.file
    raw = _raw(file)
    try:
        foreign = make_anchor(bob.paper_id, "sha256:" + "b" * 64, bob.block_id, "anc_EVIL00000001")
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            raw.execute(
                "INSERT INTO anchors (anchor_id, owner_id, highlight_id, paper_id, ordinal, "
                "anchor_json, target_kind, provenance_class, created_generation, created_at) "
                "VALUES ('anc_EVIL00000001', ?, ?, ?, 1, ?, 'text', 'source', 1, 'x')",
                (alice.user_id, bob.highlight_id, bob.paper_id, json.dumps(foreign)),
            )
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            raw.execute(
                "INSERT INTO anchor_resolutions (owner_id, anchor_id, paper_id, generation, tier, "
                "state, block_ids, resolver_version, resolved_at) "
                "VALUES (?, ?, ?, 1, 1, 'anchored', '[]', 'x', 'x')",
                (alice.user_id, bob.anchor_id, alice.paper_id),
            )
        # Her own anchor, onto Bob's generation 1 (which exists — for Bob). Her own gen-1 entry is
        # removed first so the primary key cannot be what refuses it.
        raw.execute("DELETE FROM anchor_resolutions WHERE owner_id = ?", (alice.user_id,))
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            raw.execute(
                "INSERT INTO anchor_resolutions (owner_id, anchor_id, paper_id, generation, tier, "
                "state, block_ids, resolver_version, resolved_at) "
                "VALUES (?, ?, ?, 1, 1, 'anchored', '[]', 'x', 'x')",
                (alice.user_id, alice.anchor_id, bob.paper_id),
            )
    finally:
        raw.close()


def _raw(file: Path) -> sqlite3.Connection:
    """A connection of the TEST's own, foreign keys ON — never ``PaperTreeDb``'s (see gate 1)."""
    raw = sqlite3.connect(file, isolation_level=None)
    raw.execute("PRAGMA foreign_keys = ON")
    return raw


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
    """``list_highlights`` joins highlights -> anchors -> anchor_resolutions (findings.md §F3 is
    the version that filtered the root only)."""
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    [mine] = db.list_highlights(alice.owner, alice.paper_id, GEN)
    [anchor] = mine.anchors
    quote = next(s for s in anchor.anchor["selectors"] if s["type"] == "TextQuoteSelector")
    assert quote["exact"] == "alice@papertree.test selected text"
    assert anchor.resolution is not None and anchor.resolution.block_ids == (alice.block_id,)

    assert db.list_highlights(alice.owner, bob.paper_id, GEN) == []
    assert db.list_highlights(bob.owner, alice.paper_id, GEN) == []


def test_derivation_tree_is_owner_filtered_at_every_level(env: Env) -> None:
    db, alice, bob, _file = env.db, env.alice, env.bob, env.file
    tree = db.derivation_tree(alice.owner, alice.derivation_id)
    assert [row["depth"] for row in tree] == [0, 1]
    assert all(row["owner_id"] == alice.user_id for row in tree)
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


def test_every_foreign_key_between_owned_tables_includes_owner_id(
    env: Env, capsys: pytest.CaptureFixture[str]
) -> None:
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
    with capsys.disabled():
        print(f"\n[db/ownership] owner-FK audit: {checked} FKs between owned tables, 0 violations")
    # Guard against the audit passing because it found nothing to audit. 22 is what the judge's
    # audit counted after 0005 on the saved data roots (contracts.md §1).
    assert checked >= 22


def test_owned_tables_include_new(env: Env) -> None:
    """contracts.md §1 / §9: 0005's nine tables are in the audit, exist, and each one's FKs onto
    owned tables are among those the audit above checks (none is audited vacuously)."""
    _db, _alice, _bob, file = env.db, env.alice, env.bob, env.file
    assert NEW_IN_0005 == (
        "anchor_resolutions",
        "ai_threads",
        "ai_messages",
        "ai_citations",
        "ai_runs",
        "ai_run_handles",
        "canvas_boards",
        "canvas_nodes",
        "canvas_edges",
    )
    raw = sqlite3.connect(file)
    try:
        tables = {r[0] for r in raw.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert set(OWNED_TABLES) <= tables
        for table in NEW_IN_0005:
            parents = {str(fk[2]) for fk in raw.execute(f"PRAGMA foreign_key_list({table})")}
            assert parents & set(OWNED_TABLES), f"{table} has no FK onto an owned table"
    finally:
        raw.close()


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
        db.promote_generation(alice.owner, bob.paper_id, GEN)


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
    raw.execute("DELETE FROM users WHERE user_id = ?", (bob.user_id,))
    raw.close()

    assert db.get_paper(bob.owner, bob.paper_id, GEN) is None
    assert db.count_blocks(bob.owner, bob.paper_id, GEN) == 0
    assert db.get_highlight(bob.owner, bob.paper_id, bob.highlight_id, 1) is None
    # vec0 cannot cascade; the trigger does it, and it fires under a cascade too.
    assert db.count_block_vectors(bob.owner, bob.paper_id, GEN) == 0
    # Alice is untouched.
    assert db.get_paper(alice.owner, alice.paper_id, GEN) is not None
