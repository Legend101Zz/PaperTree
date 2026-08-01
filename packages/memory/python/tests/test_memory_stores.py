"""F3.7 — the four stores, the record shape they must carry, and the retention the schema cannot.

    "Paper / session / user-learning / artefact, per `research/synthesis-13-memory.md`. Every
     agent-written record carries provenance, timestamp, source session, confidence, version,
     and is user-editable."

That sentence has six clauses and every one of them is asserted below against a REAL database
built from a REAL parsed PDF — ``papers``' composite foreign keys mean paper and artefact
memory cannot even be inserted without a genuine paper generation to hang off, so a fixture
made of hand-written rows would not have exercised the constraint that makes the store
owner-scoped in the first place.

The two things `0003_memory.sql` says it cannot express — session expiry and §13.4's ~100 KB /
200-record cap — have a test each, and both are written so that the boundary is REACHABLE:
``retention_days=0`` and an explicit ``now`` rather than a real 90-day wait. A retention test
that cannot construct an expired row is a retention test that asserts the DELETE ran and
nothing about what it deleted.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
import sqlite_vec  # type: ignore[import-untyped]
from _memory_fixtures import SeededDatabase, SeededPaper, seed_benign_database
from papertree_db import BlockId, OwnerId, OwnershipError, PaperTreeDb
from papertree_memory import (
    SESSION_MEMORY_RETENTION_DAYS,
    USER_LEARNING_MAX_BYTES,
    USER_LEARNING_MAX_RECORDS,
    USER_LEARNING_RECONFIRM_DAYS,
    ConfirmationMismatch,
    EvidenceSpan,
    MemoryCapExceeded,
    MemoryStore,
    ProposalRejected,
    ProposalValidator,
    UserConfirmation,
    WriteProvenance,
    now_iso,
    shift_iso,
)

TOOL_NAMES = frozenset({"get_block", "search_blocks", "cite_span"})
SESSION_ID = "ses_f37"

AGENT = WriteProvenance(
    actor="agent",
    source_session=SESSION_ID,
    confidence=0.72,
    generator={"model": "anthropic/claude-haiku-4.5", "prompt_version": "v3"},
)


@pytest.fixture(scope="module")
def benign(tmp_path_factory: pytest.TempPathFactory) -> SeededDatabase:
    return seed_benign_database(tmp_path_factory.mktemp("stores"))


@pytest.fixture
def store(benign: SeededDatabase) -> Iterator[MemoryStore]:
    memory = MemoryStore(benign.path, validator=ProposalValidator(tool_names=TOOL_NAMES))
    yield memory
    memory.close()


@pytest.fixture
def owner(store: MemoryStore, benign: SeededDatabase) -> OwnerId:
    return store.owner_for(benign.user_id)


@pytest.fixture
def paper(benign: SeededDatabase) -> SeededPaper:
    return benign.papers["benign"]


def _fork_database(source: Path, destination: Path) -> Path:
    """A private copy of a database, taken through SQLite's own backup API.

    NOT ``Path.read_bytes``. The seeded file is in WAL mode with a live writer, so the bytes of
    the main file are not the database — recent commits live in the ``-wal`` sidecar, and a
    byte copy silently loses or half-copies them. ``Connection.backup`` takes a consistent
    snapshot including the WAL, which is the difference between a fork that has the rows and a
    fork that has some of them.
    """
    source_connection = sqlite3.connect(str(source))
    destination_connection = sqlite3.connect(str(destination))
    try:
        source_connection.backup(destination_connection)
    finally:
        destination_connection.close()
        source_connection.close()
    return destination


def _a_block(benign: SeededDatabase, paper: SeededPaper) -> tuple[str, str]:
    """A real block id and its real text, from the parsed document."""
    with PaperTreeDb(benign.path) as database:
        blocks = database.list_blocks_on_page(
            database.owner_for(benign.user_id), paper.paper_id, paper.generation, 0
        )
    with_text = [block for block in blocks if block["text"]]
    assert with_text, "the parsed document has no text-bearing block to quote"
    return str(with_text[0]["block_id"]), str(with_text[0]["text"])


# ── the record shape (F3.7's six clauses) ───────────────────────────────────────────────


def test_a_paper_memory_record_carries_every_mandatory_field(
    store: MemoryStore, owner: OwnerId, paper: SeededPaper, benign: SeededDatabase
) -> None:
    block_id, _ = _a_block(benign, paper)
    memory_id = store.write_paper_memory(
        owner,
        paper.paper_id,
        paper.generation,
        kind="section_summary",
        content={"summary": "Residual connections ease optimisation."},
        derived_from=[block_id],
        provenance=AGENT,
    )
    rows = store.list_paper_memory(owner, paper.paper_id, paper.generation)
    row = next(r for r in rows if r["memory_id"] == memory_id)

    # provenance, timestamp, source session, confidence, version — all five, all populated.
    provenance = json.loads(str(row["provenance"]))
    assert provenance["actor"] == "agent"
    assert provenance["generator"]["model"] == "anthropic/claude-haiku-4.5"
    assert row["created_at"] and row["updated_at"]
    assert row["source_session"] == SESSION_ID
    assert row["confidence"] == pytest.approx(0.72)
    assert row["version"] == 1
    # …and the trust label is the table's, not the caller's.
    assert row["trust_label"] == "untrusted"
    assert json.loads(str(row["derived_from"])) == [block_id]


def test_an_ungrounded_record_is_refused_before_it_reaches_the_check(
    store: MemoryStore, owner: OwnerId, paper: SeededPaper
) -> None:
    """findings.md C4: a memory record that cannot point at a source block is ungrounded."""
    with pytest.raises(ValueError, match="at least one source block"):
        store.write_paper_memory(
            owner,
            paper.paper_id,
            paper.generation,
            kind="section_summary",
            content={"summary": "…"},
            derived_from=[],
            provenance=AGENT,
        )


def test_provenance_refuses_an_out_of_range_confidence_and_a_nameless_generator() -> None:
    """Fails at the call site rather than as a CHECK inside a rolled-back transaction."""
    with pytest.raises(ValueError, match="between 0 and 1"):
        WriteProvenance(actor="agent", source_session="s", confidence=1.5, generator={"model": "m"})
    with pytest.raises(ValueError, match="name its generator"):
        WriteProvenance(actor="agent", source_session="s", confidence=0.5, generator={})
    # A user-attributed write has no model to name, so the same rule must NOT apply to it.
    assert WriteProvenance(actor="user", source_session=None, confidence=1.0, generator={})


def test_the_update_path_bumps_version_and_updated_at(
    store: MemoryStore, owner: OwnerId, paper: SeededPaper, benign: SeededDatabase
) -> None:
    """F3.7's "user-editable", made a fact about the data rather than a promise about the UI."""
    block_id, _ = _a_block(benign, paper)
    memory_id = store.write_artefact_memory(
        owner,
        paper.paper_id,
        paper.generation,
        kind="summary",
        content={"body": "first"},
        derived_from=[block_id],
        provenance=AGENT,
    )
    before = next(
        row
        for row in store.list_artefact_memory(owner, paper.paper_id, paper.generation)
        if row["memory_id"] == memory_id
    )
    assert store.update_artefact_memory(owner, memory_id, content={"body": "edited"}, actor="user")

    after = next(
        row
        for row in store.list_artefact_memory(owner, paper.paper_id, paper.generation)
        if row["memory_id"] == memory_id
    )
    assert after["version"] == before["version"] + 1
    assert after["updated_at"] >= before["updated_at"]
    assert json.loads(str(after["content"])) == {"body": "edited"}
    assert after["created_at"] == before["created_at"]
    assert after["trust_label"] == "derived_untrusted"

    # Updating a memory_id that is not this owner's changes nothing and says so.
    assert store.update_artefact_memory(owner, "mem_nope", content={}, actor="user") == 0


# ── session memory: taint and the 90-day retention SQLite cannot express ─────────────────


def test_session_memory_is_tainted_and_expires_on_a_computed_schedule(
    store: MemoryStore, owner: OwnerId
) -> None:
    memory_id = store.write_session_memory(
        owner, kind="turn_summary", content={"text": "asked about residuals"}, provenance=AGENT
    )
    row = next(
        r for r in store.list_session_memory(owner, SESSION_ID) if r["memory_id"] == memory_id
    )
    assert row["trust_label"] == "tainted"
    assert row["source_session"] == SESSION_ID
    assert row["session_id"] == SESSION_ID
    # §13.1: 90 days. Recomputed here rather than quoted, per AGENTS.md §2.
    assert row["expires_at"] == shift_iso(
        str(row["created_at"]), days=SESSION_MEMORY_RETENTION_DAYS
    )


def test_a_session_row_without_a_session_is_refused(store: MemoryStore, owner: OwnerId) -> None:
    anonymous = WriteProvenance(
        actor="agent", source_session=None, confidence=0.5, generator={"model": "m"}
    )
    with pytest.raises(ValueError, match="requires provenance.source_session"):
        store.write_session_memory(owner, kind="turn", content={}, provenance=anonymous)


def test_purge_deletes_expired_rows_only_and_audits_each(
    store: MemoryStore, owner: OwnerId
) -> None:
    """The boundary is REACHABLE: ``retention_days=0`` makes an expired row now, not in 90 days."""
    expired_session = WriteProvenance(
        actor="agent", source_session="ses_expired", confidence=0.5, generator={"model": "m"}
    )
    expired = store.write_session_memory(
        owner, kind="turn", content={"n": 1}, provenance=expired_session, retention_days=0
    )
    live = store.write_session_memory(
        owner, kind="turn", content={"n": 2}, provenance=expired_session, retention_days=90
    )
    rows = {row["memory_id"]: row for row in store.list_session_memory(owner, "ses_expired")}
    cutoff = shift_iso(str(rows[expired]["expires_at"]), days=1)

    assert store.purge_expired_session_memory(owner, now=cutoff) == 1
    survivors = [row["memory_id"] for row in store.list_session_memory(owner, "ses_expired")]
    assert survivors == [live]

    deletions = [
        row
        for row in store.list_audit(owner)
        if row["action"] == "delete" and row["memory_id"] == expired
    ]
    assert len(deletions) == 1
    assert deletions[0]["actor"] == "system"
    assert deletions[0]["gate_decision"] == "allowed:retention_expiry"

    # A second purge at the same instant is a no-op, so the count is a real count and not
    # "the DELETE statement executed".
    assert store.purge_expired_session_memory(owner, now=cutoff) == 0


# ── the proposal queue and the promotion gate ───────────────────────────────────────────


def _evidence(benign: SeededDatabase, paper: SeededPaper) -> tuple[EvidenceSpan, str]:
    """A span that really is at those offsets in that block's ``blocks.text``."""
    block_id, text = _a_block(benign, paper)
    quote = text[:20]
    return EvidenceSpan(block_id, quote, 0, 20), quote


def test_a_clean_proposal_is_pending_and_promotes_on_confirmation(
    store: MemoryStore, owner: OwnerId, paper: SeededPaper, benign: SeededDatabase
) -> None:
    evidence, quote = _evidence(benign, paper)
    outcome = store.create_proposal(
        owner,
        paper.paper_id,
        paper.generation,
        session_id=SESSION_ID,
        kind="preferred_depth",
        content={"level": "grad"},
        evidence=evidence,
        model_id="anthropic/claude-haiku-4.5",
        prompt_hash="sha256:" + "a" * 64,
    )
    assert outcome.state == "pending" and outcome.rejection_rule is None

    confirmed_at = now_iso()
    memory_id = store.confirm_proposal(
        owner, UserConfirmation(outcome.proposal_id, quote, confirmed_at)
    )
    row = next(r for r in store.list_user_learning_memory(owner) if r["memory_id"] == memory_id)
    assert row["trust_label"] == "trusted"
    assert row["confirmed_by"] == "user"
    assert row["confirmed_at"] == confirmed_at
    assert row["source_proposal_id"] == outcome.proposal_id
    assert row["version"] == 1
    # §13.4's annual re-confirmation, recomputed rather than quoted.
    assert row["reconfirm_due"] == shift_iso(confirmed_at, days=USER_LEARNING_RECONFIRM_DAYS)
    # The trusted row's confidence is the human's, not the model's 0.72.
    assert row["confidence"] == pytest.approx(1.0)

    decided = store.get_proposal(owner, outcome.proposal_id)
    assert decided is not None and decided["state"] == "accepted"
    assert store.delete_user_learning_memory(owner, memory_id) == 1


def test_a_confirmation_that_cannot_reproduce_the_quote_is_refused_and_audited(
    store: MemoryStore, owner: OwnerId, paper: SeededPaper, benign: SeededDatabase
) -> None:
    """§13.6(b) gate 3. A caller that never read the evidence cannot pass this."""
    evidence, quote = _evidence(benign, paper)
    outcome = store.create_proposal(
        owner,
        paper.paper_id,
        paper.generation,
        session_id=SESSION_ID,
        kind="preferred_depth",
        content={"level": "undergrad"},
        evidence=evidence,
        model_id="m",
        prompt_hash="sha256:" + "b" * 64,
    )
    assert outcome.state == "pending"

    with pytest.raises(ConfirmationMismatch):
        store.confirm_proposal(owner, UserConfirmation(outcome.proposal_id, quote + "!", now_iso()))
    assert store.list_user_learning_memory(owner) == []
    denials = [
        row
        for row in store.list_audit(owner)
        if row["gate_decision"] == "denied:confirmation_quote_mismatch"
    ]
    assert denials and denials[-1]["memory_id"] == outcome.proposal_id

    # Non-vacuous: the SAME proposal promotes when the quote does match.
    memory_id = store.confirm_proposal(
        owner, UserConfirmation(outcome.proposal_id, quote, now_iso())
    )
    assert store.delete_user_learning_memory(owner, memory_id) == 1


def test_a_proposal_whose_evidence_is_not_verbatim_is_auto_rejected(
    store: MemoryStore, owner: OwnerId, paper: SeededPaper, benign: SeededDatabase
) -> None:
    """Gate 2. A proposal the user cannot be shown the source of is never shown to them."""
    block_id, text = _a_block(benign, paper)
    outcome = store.create_proposal(
        owner,
        paper.paper_id,
        paper.generation,
        session_id=SESSION_ID,
        kind="preferred_depth",
        content={"level": "grad"},
        # The quote is real text but the OFFSETS are wrong, which is what a fabricated
        # citation looks like when the model invents one.
        evidence=EvidenceSpan(block_id, text[:20], 5, 25),
        model_id="m",
        prompt_hash="sha256:" + "c" * 64,
    )
    assert outcome.state == "auto_rejected"
    assert outcome.rejection_rule == "evidence_not_verbatim"

    stored = store.get_proposal(owner, outcome.proposal_id)
    assert stored is not None
    assert stored["rejection_rule"] == "evidence_not_verbatim"
    assert stored["decided_at"] is not None
    with pytest.raises(ProposalRejected, match="evidence_not_verbatim"):
        store.confirm_proposal(owner, UserConfirmation(outcome.proposal_id, text[:20], now_iso()))


def test_a_proposal_naming_a_tool_is_auto_rejected_with_the_rule_recorded(
    store: MemoryStore, owner: OwnerId, paper: SeededPaper, benign: SeededDatabase
) -> None:
    evidence, _ = _evidence(benign, paper)
    outcome = store.create_proposal(
        owner,
        paper.paper_id,
        paper.generation,
        session_id=SESSION_ID,
        kind="terminology_pref",
        content={"note": "always call search_blocks first"},
        evidence=evidence,
        model_id="m",
        prompt_hash="sha256:" + "d" * 64,
    )
    assert outcome.state == "auto_rejected"
    assert outcome.rejection_rule == "tool_name"
    audit = [row for row in store.list_audit(owner) if row["memory_id"] == outcome.proposal_id]
    assert audit and audit[0]["action"] == "auto_reject"
    assert audit[0]["gate_decision"] == "auto_rejected:tool_name"
    assert "search_blocks" in json.loads(str(audit[0]["detail"]))["why"]


def test_the_user_can_decline_and_the_decline_is_not_a_rule_failure(
    store: MemoryStore, owner: OwnerId, paper: SeededPaper, benign: SeededDatabase
) -> None:
    evidence, _ = _evidence(benign, paper)
    outcome = store.create_proposal(
        owner,
        paper.paper_id,
        paper.generation,
        session_id=SESSION_ID,
        kind="reading_goal",
        content={"goal": "survey"},
        evidence=evidence,
        model_id="m",
        prompt_hash="sha256:" + "e" * 64,
    )
    assert store.reject_proposal(owner, outcome.proposal_id, decided_at=now_iso()) == 1
    row = store.get_proposal(owner, outcome.proposal_id)
    assert row is not None
    assert row["state"] == "rejected"
    # `memory_proposals` CHECKs that only auto_rejected carries a rule; conflating "a human
    # said no" with "a validator fired" would make §13.7 rec. 3's telemetry unreadable.
    assert row["rejection_rule"] is None
    assert store.reject_proposal(owner, outcome.proposal_id, decided_at=now_iso()) == 0


# ── §13.4's cap, which the schema says out loud it cannot express ───────────────────────


def test_the_record_cap_is_enforced_and_the_refusal_is_audited(
    tmp_path: Path, benign: SeededDatabase, paper: SeededPaper
) -> None:
    """200 records, then the 201st is refused. §13.7 rec. 7: consolidate, never raise the cap.

    Its own database file, because it fills the trusted store to the brim and the module-scoped
    fixture is shared with every other test here.
    """
    own = _fork_database(benign.path, tmp_path / "capped.sqlite")
    evidence, quote = _evidence(benign, paper)

    with MemoryStore(own, validator=ProposalValidator(tool_names=TOOL_NAMES)) as store:
        owner = store.owner_for(benign.user_id)
        for index in range(USER_LEARNING_MAX_RECORDS):
            outcome = store.create_proposal(
                owner,
                paper.paper_id,
                paper.generation,
                session_id=SESSION_ID,
                kind="understood_concept",
                content={"concept": f"c{index}"},
                evidence=evidence,
                model_id="m",
                prompt_hash="sha256:" + "f" * 64,
            )
            assert outcome.state == "pending", outcome.rejection_rule
            store.confirm_proposal(owner, UserConfirmation(outcome.proposal_id, quote, now_iso()))

        assert store.user_learning_usage(owner).records == USER_LEARNING_MAX_RECORDS
        one_too_many = store.create_proposal(
            owner,
            paper.paper_id,
            paper.generation,
            session_id=SESSION_ID,
            kind="understood_concept",
            content={"concept": "overflow"},
            evidence=evidence,
            model_id="m",
            prompt_hash="sha256:" + "f" * 64,
        )
        with pytest.raises(MemoryCapExceeded, match="records"):
            store.confirm_proposal(
                owner, UserConfirmation(one_too_many.proposal_id, quote, now_iso())
            )
        assert store.user_learning_usage(owner).records == USER_LEARNING_MAX_RECORDS
        denials = [
            row
            for row in store.list_audit(owner, limit=2000)
            if row["gate_decision"] == "denied:user_learning_cap"
        ]
        assert denials and denials[-1]["memory_id"] == one_too_many.proposal_id


def test_the_byte_cap_guards_the_edit_path_which_the_validator_never_sees(
    tmp_path: Path, benign: SeededDatabase, paper: SeededPaper
) -> None:
    """Where the byte cap actually earns its place, and it is not the promotion path.

    Arithmetic first, because it decides what this test can be about: §13.4's cap is
    "200 records × 512 bytes", and 200 × 512 is exactly 102,400 == ``USER_LEARNING_MAX_BYTES``.
    So through ``confirm_proposal`` — where every content is validated against the 512-byte
    proposal cap — the RECORD cap always trips first and the byte cap is unreachable.

    It is reachable through ``edit_user_learning_memory``, which does not run the validator:
    that is the settings UI, where the user is editing their own record and §13.6(b)'s rules
    about model output do not apply. One paste of 200 KB is all it takes, and that is exactly
    the case §13.7 rec. 7 protects — a store a human can read end to end in a couple of
    minutes.
    """
    assert USER_LEARNING_MAX_RECORDS * 512 == USER_LEARNING_MAX_BYTES

    own = _fork_database(benign.path, tmp_path / "byte-capped.sqlite")
    evidence, quote = _evidence(benign, paper)

    with MemoryStore(own, validator=ProposalValidator(tool_names=TOOL_NAMES)) as store:
        owner = store.owner_for(benign.user_id)
        outcome = store.create_proposal(
            owner,
            paper.paper_id,
            paper.generation,
            session_id=SESSION_ID,
            kind="terminology_pref",
            content={"note": "short"},
            evidence=evidence,
            model_id="m",
            prompt_hash="sha256:" + "0" * 64,
        )
        memory_id = store.confirm_proposal(
            owner, UserConfirmation(outcome.proposal_id, quote, now_iso())
        )

        # A modest edit is fine, and bumps the version — the non-vacuous half.
        assert store.edit_user_learning_memory(
            owner, memory_id, content={"note": "a little longer"}, edited_at=now_iso()
        )
        row = store.list_user_learning_memory(owner)[0]
        assert row["version"] == 2

        with pytest.raises(MemoryCapExceeded, match="content_bytes"):
            store.edit_user_learning_memory(
                owner,
                memory_id,
                content={"note": "x" * (USER_LEARNING_MAX_BYTES + 1)},
                edited_at=now_iso(),
            )
        # Refused, not truncated: the record is unchanged and still at version 2.
        after = store.list_user_learning_memory(owner)[0]
        assert after["version"] == 2
        assert json.loads(str(after["content"])) == {"note": "a little longer"}


# ── the audit trail is append-only, and the store cannot rewrite it either ───────────────


def test_memory_audit_refuses_update_and_delete_even_on_a_privileged_connection(
    tmp_path: Path, benign: SeededDatabase, paper: SeededPaper
) -> None:
    """The append-only triggers, exercised from a connection with every privilege there is.

    The value of an audit log is its resistance to the caller who most wants to edit it, and
    that caller is the privileged writer — so the test uses a bare read-write connection, not
    the agent's handle. A guard that only stops the agent stops the wrong actor.
    """
    own = _fork_database(benign.path, tmp_path / "audited.sqlite")
    with MemoryStore(own, validator=ProposalValidator(tool_names=TOOL_NAMES)) as store:
        owner = store.owner_for(benign.user_id)
        store.record_denial(
            owner,
            route="a_tool_tried_to_write",
            detail={"tool": "remember_preference"},
            actor="agent",
            source_paper=paper.paper_id,
            source_session=SESSION_ID,
        )
        mine = [
            row
            for row in store.list_audit(owner, limit=5000)
            if row["gate_decision"] == "denied:a_tool_tried_to_write"
        ]
        assert len(mine) == 1 and mine[0]["actor"] == "agent"
        before = len(store.list_audit(owner, limit=5000))

    raw = sqlite3.connect(str(own), isolation_level=None)
    # `papers` has an AFTER DELETE trigger that reaches the vec0 table, so a cascade from
    # `users` fails with "no such module: vec0" unless the extension is loaded. Same reason
    # packages/db's own erasure test loads it.
    raw.enable_load_extension(True)
    sqlite_vec.load(raw)
    raw.enable_load_extension(False)
    raw.execute("PRAGMA foreign_keys = ON")
    try:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            raw.execute("UPDATE memory_audit SET gate_decision = 'allowed'")
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            raw.execute("DELETE FROM memory_audit")
        # …but erasing the USER still works, because the DELETE guard is conditional on the
        # users row still existing. An append-only log that blocks GDPR erasure is a compliance
        # defect, not a stricter log.
        assert raw.execute("SELECT count(*) FROM memory_audit").fetchone()[0] == before
        raw.execute("DELETE FROM users WHERE user_id = ?", (benign.user_id,))
        assert raw.execute("SELECT count(*) FROM memory_audit").fetchone()[0] == 0
    finally:
        raw.close()


# ── ownership ───────────────────────────────────────────────────────────────────────────


def test_an_owner_handle_from_another_connection_is_refused(
    store: MemoryStore, benign: SeededDatabase, paper: SeededPaper
) -> None:
    """An owner handle is minted BY a connection and means nothing on any other.

    Borrowing ``OwnerId`` without borrowing the binding is the defect ``JobStore``'s docstring
    records, and it left that store with no gate at all.
    """
    with PaperTreeDb(benign.path) as database:
        foreign = database.owner_for(benign.user_id)
    with pytest.raises(OwnershipError, match="not minted by this MemoryStore"):
        store.list_user_learning_memory(foreign)
    with pytest.raises(OwnershipError):
        store.list_paper_memory(foreign, paper.paper_id, paper.generation)
    with pytest.raises(OwnershipError, match="got str"):
        store.list_user_learning_memory(benign.user_id)  # type: ignore[arg-type]
    # Non-vacuous: a handle this store minted works for the same calls.
    assert store.list_user_learning_memory(store.owner_for(benign.user_id)) == []


def test_a_block_id_is_not_a_capability(store: MemoryStore, benign: SeededDatabase) -> None:
    """Content-derived ids are not secret, and naming one buys nothing without the owner."""
    with PaperTreeDb(benign.path) as database:
        owner = database.owner_for(benign.user_id)
        paper = benign.papers["benign"]
        assert (
            database.get_block(owner, paper.paper_id, paper.generation, BlockId("blk_invented"))
            is None
        )
