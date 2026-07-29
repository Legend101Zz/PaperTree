"""db/ownership.spec, Python static half — "a query built without an owner is rejected".

HOW THIS IS A REAL ASSERTION AND NOT A COMMENT:

``mypy --strict`` turns on ``warn_unused_ignores``. Every ``# type: ignore[...]`` below MUST
suppress a real error; if the call ever starts typechecking, mypy reports
``error: Unused "type: ignore" comment`` and exits non-zero. That is the exact mirror of
``@ts-expect-error`` in packages/db/test/ownership-types.spec.ts, and it fails the same way
round: weakening the API turns the typecheck red rather than turning this file into a stale
claim.

THE FIXTURES ARE FULLY ANNOTATED ON PURPOSE. An unannotated pytest fixture makes ``db`` an
implicit ``Any``, every call on it typechecks, and every ignore below silently becomes
decoration. The assertion is only worth anything if ``db`` is known to be a ``PaperTreeDb``.

Each call is ALSO executed inside ``pytest.raises``, because the Python half of the
acceptance criterion is "raises", not "does not typecheck". Both are asserted here.
"""

from __future__ import annotations

import inspect
from collections.abc import Iterator
from pathlib import Path

import pytest
from papertree_db import OwnershipError, PaperTreeDb, generation, open_database
from papertree_db.ids import BlockId, DerivationId, OwnerId, PaperId

from .fixtures import make_paper

GEN = generation(1)


@pytest.fixture
def db(tmp_path: Path) -> Iterator[PaperTreeDb]:
    handle = open_database(tmp_path / "typing.sqlite")
    handle.migrate()
    yield handle
    handle.close()


def test_owner_cannot_be_conjured_from_a_string() -> None:
    # OwnerId's constructor is typed, so this is the RUNTIME guard. It is the reason
    # OwnerId is a class and not a NewType — a NewType cannot raise.
    with pytest.raises(OwnershipError):
        OwnerId("usr_01JABCDEF")


def test_an_owner_whose_constructor_was_BYPASSED_authorises_nothing(db: PaperTreeDb) -> None:
    """THE REGRESSION THIS TEST EXISTS FOR.

    A guarded ``__init__`` is not a gate on its own: ``object.__new__`` skips it entirely.
    An adversarial review built a working ``OwnerId`` this way and used it to read AND
    write another tenant's highlight — findings.md §F1, reproduced through the one hole
    the design admitted to. ``ids.OwnerId.value`` now re-checks the mint token, so a
    bypassed constructor is rejected at the gate rather than trusted at the bind site.
    """
    victim = db.create_user("victim@papertree.test")
    paper_id = PaperId("ppr_000000000000000000000FORGE")
    db.put_paper(victim, make_paper(paper_id, "sha256:" + "7" * 64, 1, 2))
    highlight_id = db.create_highlight(victim, paper_id, GEN, "yellow", "victim private note")

    forged = object.__new__(OwnerId)  # never calls __init__, still isinstance(OwnerId)
    object.__setattr__(forged, "_value", victim.value)
    assert isinstance(forged, OwnerId)

    with pytest.raises(OwnershipError):
        _ = forged.value
    with pytest.raises(OwnershipError):
        db.get_highlight(forged, highlight_id)
    with pytest.raises(OwnershipError):
        db.update_highlight_note(forged, highlight_id, "pwned")
    with pytest.raises(OwnershipError):
        db.list_papers(forged)

    row = db.get_highlight(victim, highlight_id)
    assert row is not None and row["note"] == "victim private note"


def test_omitting_the_owner_does_not_typecheck_and_does_not_run(db: PaperTreeDb) -> None:
    paper_id = PaperId("ppr_x")
    with pytest.raises(TypeError):
        db.list_papers()  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        db.get_paper(paper_id, GEN)  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        db.list_blocks_in_doc_order(paper_id, GEN)  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        db.resolve_highlights(paper_id, GEN)  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        db.search_block_vectors(paper_id, GEN, [0.0] * 768, 5)  # type: ignore[call-arg]


def test_a_bare_string_is_not_an_owner(db: PaperTreeDb) -> None:
    paper_id = PaperId("ppr_x")
    with pytest.raises(OwnershipError):
        db.list_papers("usr_01JABCDEF")  # type: ignore[arg-type]
    with pytest.raises(OwnershipError):
        # A user id read out of a request body is still just a string.
        db.get_paper("usr_01JABCDEF", paper_id, GEN)  # type: ignore[arg-type]


def test_ids_are_not_interchangeable(db: PaperTreeDb) -> None:
    owner = db.create_user("typing@papertree.test")
    paper_id = PaperId("ppr_00000000000000000000TYPING")
    db.put_paper(owner, make_paper(paper_id, "sha256:" + "9" * 64, 1, 2))

    with pytest.raises(OwnershipError):
        db.list_papers(paper_id)  # type: ignore[arg-type]
    # The next two are PURE mypy assertions and are stated as such. A NewType IS its base
    # type at runtime, so passing a BlockId where a PaperId belongs merely finds nothing,
    # and passing a bare `1` where a Generation belongs succeeds outright. Only the static
    # check catches them — which is exactly why this file exists rather than leaning on
    # runtime behaviour, and exactly why the OWNER is a guarded class and not a NewType.
    assert db.get_paper(owner, BlockId("blk_x"), GEN) is None  # type: ignore[arg-type]
    assert db.get_paper(owner, paper_id, 1) is not None  # type: ignore[arg-type]


def test_the_write_vectors_from_findings_f1_and_f3_do_not_typecheck(db: PaperTreeDb) -> None:
    owner = db.create_user("typing2@papertree.test")
    paper_id = PaperId("ppr_0000000000000000000TYPING2")
    db.put_paper(owner, make_paper(paper_id, "sha256:" + "8" * 64, 1, 2))
    highlight_id = db.create_highlight(owner, paper_id, GEN, "yellow")

    with pytest.raises(TypeError):
        # §F1: update by id alone, no owner filter.
        db.update_highlight_note(highlight_id, "pwned")  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        db.delete_highlight(highlight_id)  # type: ignore[call-arg,arg-type]
    with pytest.raises(TypeError):
        # §F3: walk an explanation tree without an owner.
        db.derivation_tree(DerivationId("drv_x"))  # type: ignore[call-arg,arg-type]


def test_there_is_no_connection_to_reach(db: PaperTreeDb) -> None:
    # Gate 1: no execute(), no cursor, no connection accessor on the public object, and
    # __slots__ prevents one being attached later.
    assert not hasattr(db, "execute")
    assert not hasattr(db, "cursor")
    assert not hasattr(db, "connection")
    assert PaperTreeDb.__slots__ == ("_conn", "_migrations_dir", "_minted")
    with pytest.raises(AttributeError):
        db.connection = object()  # type: ignore[attr-defined]


def test_every_public_helper_takes_the_owner_first(db: PaperTreeDb) -> None:
    """Mechanical audit of gate 2, so it is enforced rather than merely intended.

    A new helper that forgets the owner parameter fails here the moment it is added.
    """
    exempt = {"migrate", "close", "create_user", "authenticate"}
    checked = 0
    for name in dir(db):
        if name.startswith("_") or name in exempt:
            continue
        member = getattr(db, name)
        if not callable(member):
            continue
        params = list(inspect.signature(member).parameters)
        checked += 1
        assert params and params[0] == "owner", f"{name}() does not take owner first"
    assert checked >= 20
