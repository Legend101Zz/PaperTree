"""``MemoryStore`` — the privileged writer, and every SQL statement that touches memory.

WHAT THIS CLASS IS THE OTHER HALF OF
    ``guard.py`` builds an object that cannot write. This is the object that can. §13.4's
    Postgres form is two database roles — ``papertree_agent`` with ``SELECT`` and
    ``papertree_api`` with ``INSERT, UPDATE, DELETE`` — and in SQLite the pair is
    :class:`~papertree_memory.agent_handle.AgentDataHandle` and this class. They share a file
    and share **nothing else**: not a connection, not a cache, not a reference. That is the
    whole trust boundary, and it is why this class must never be reachable from that one.

    Concretely, the rule a reviewer should check this file against: **nothing in this module
    accepts, returns or stores an ``AgentDataHandle``, and nothing in ``agent_handle.py``
    imports this module.** The import graph is the boundary's shape.

WHY THE AGENT DOES NOT WRITE PROPOSALS EITHER, WHICH IS STRONGER THAN §13.1 ASKS
    §13.1's table says the agent may write proposals. `0003_memory.sql` deliberately does not
    allow even that: the agent's connection is read-only, so it cannot write ``memory_proposals``
    any more than it can write ``user_learning_memory``. A proposal is created HERE, by the
    privileged runtime, out of the agent's schema-validated structured output. The agent's
    maximum achievable outcome under full model compromise is therefore "the runtime chose to
    create a proposal row", and that row still has to survive validation and then a human.

THE PROMOTION PATH, WHICH IS THE ONLY WAY INTO THE TRUSTED STORE
    ``create_proposal`` -> (validator + evidence check) -> ``confirm_proposal(…, confirmation)``
    -> one row in ``user_learning_memory``. §13.6(b)'s gate is all three of: (1) no write grant
    for the agent — ``guard.py``; (2) a proposal row carrying the verbatim evidence span —
    ``create_proposal``, which refuses to mark a proposal ``pending`` unless the quote is
    actually at those offsets in that block; (3) a UI confirmation showing the user that exact
    quote — ``confirm_proposal``, which refuses unless the confirmation reproduces it
    byte-for-byte. All three are here or in ``guard.py``; none is in a comment.

WHAT THIS CLASS ENFORCES THAT THE SCHEMA CANNOT
    `0003_memory.sql` says so itself, twice, and both are implemented here:

      * **The ~100 KB / 200-record cap** on user-learning memory (§13.4). A SQLite CHECK cannot
        see other rows, so a per-user aggregate is not expressible in DDL. ``confirm_proposal``
        and ``edit_user_learning_memory`` both count first and raise
        :class:`~papertree_memory.errors.MemoryCapExceeded` rather than write.
      * **Session-memory expiry** (§13.1: 90 days). SQLite has no TTL. ``expires_at`` is
        computed on write and ``purge_expired_session_memory`` is what actually deletes.

WHY ``purge_expired_session_memory`` TAKES ``now`` AND HAS NO DEFAULT
    A default of "the real clock" makes the expiry test unable to fail: the only rows it could
    delete are rows the test would have had to wait 90 days to create. Passing the instant
    explicitly means the boundary condition is reachable in a unit test, and a caller in
    production writes one line to supply it. This is the "prefer required arguments" rule
    doing real work rather than being cited.

EVERY WRITE APPENDS TO ``memory_audit`` — INCLUDING THE ONES THAT DID NOT HAPPEN
    §13.6(d)'s per-write stream. Denials and auto-rejections are audited too, and that is the
    half people forget: a log that records only successes cannot answer "did anything try?".
    ``memory_audit`` has BEFORE UPDATE / BEFORE DELETE triggers that RAISE(ABORT), so this
    class cannot rewrite its own trail either. Note the consequence, which is a feature: the
    agent's read-only connection **cannot append to the audit log**, so a denial is recorded by
    the privileged runtime that caught it, never by the thing that was denied.

TRANSACTIONS
    ``isolation_level=None`` and explicit ``BEGIN IMMEDIATE`` / ``COMMIT``, the same shape as
    ``papertree_db`` and ``papertree_jobs``. IMMEDIATE because every write here is a
    read-then-write (count the rows, then insert; read the proposal, then promote it) and a
    deferred transaction upgrades its lock mid-way, which is where SQLite returns
    ``SQLITE_BUSY`` to the writer that has already done its reading.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import Any, Final, final

import sqlite_vec  # type: ignore[import-untyped]
from papertree_db import (
    Generation,
    MigrationResult,
    OwnerId,
    OwnershipError,
    PaperId,
    migrate,
    mint_owner,
    new_id,
)

from .errors import (
    ConfirmationMismatch,
    MemoryCapExceeded,
    ProposalRejected,
    TrustBoundaryViolation,
)
from .guard import RouteProbe, Row, row_to_dict
from .records import (
    SESSION_MEMORY_RETENTION_DAYS,
    TRUST_LABELS,
    USER_LEARNING_MAX_BYTES,
    USER_LEARNING_MAX_RECORDS,
    USER_LEARNING_RECONFIRM_DAYS,
    Actor,
    AuditAction,
    EvidenceSpan,
    ProposalOutcome,
    ProposalState,
    StoreName,
    UserConfirmation,
    WriteProvenance,
    canonical_json,
    now_iso,
    shift_iso,
)
from .validation import ProposalValidator, RejectionRule

#: Column lists written out once. Restating them at each call site is how a column gets added
#: to the table and forgotten by one of three INSERTs — the reason ``papertree_jobs`` derives
#: its own from the dataclass fields.
_PAPER_MEMORY_COLUMNS: Final = (
    "memory_id, owner_id, paper_id, generation, kind, content, derived_from, trust_label, "
    "provenance, source_session, confidence, version, created_at, updated_at"
)
_ARTEFACT_MEMORY_COLUMNS: Final = _PAPER_MEMORY_COLUMNS
_SESSION_MEMORY_COLUMNS: Final = (
    "memory_id, owner_id, session_id, paper_id, generation, kind, content, trust_label, "
    "provenance, source_session, confidence, version, created_at, updated_at, expires_at"
)
_PROPOSAL_COLUMNS: Final = (
    "proposal_id, owner_id, paper_id, generation, session_id, kind, content, "
    "evidence_block_id, evidence_quote, evidence_char_start, evidence_char_end, state, "
    "rejection_rule, model_id, prompt_hash, created_at, decided_at"
)
_USER_LEARNING_COLUMNS: Final = (
    "memory_id, owner_id, kind, content, trust_label, provenance, confidence, version, "
    "source_proposal_id, confirmed_at, confirmed_by, created_at, updated_at, reconfirm_due"
)
_AUDIT_COLUMNS: Final = (
    "audit_id, owner_id, store, memory_id, actor, action, trust_label, source_paper, "
    "source_session, gate_decision, detail, created_at"
)


@dataclass(frozen=True, slots=True)
class UserLearningUsage:
    """How much of §13.4's cap one user has spent. Both halves, because both are capped."""

    records: int
    content_bytes: int


@final
class MemoryStore:
    """The read-write half of the trust boundary. One per process; never handed to a tool."""

    __slots__ = ("_conn", "_handles", "_migrations_dir", "_validator")

    _conn: sqlite3.Connection

    def __init__(
        self,
        database_path: str | Path,
        *,
        validator: ProposalValidator,
        migrations_dir: Path | None = None,
    ) -> None:
        """Opens the privileged connection.

        ``validator`` is REQUIRED and keyword-only. It could have defaulted to
        ``ProposalValidator(tool_names=())``, and that default would have made §13.6(b)'s
        ``tool_name`` rule inert while leaving every call site and every green test looking
        identical. See ``validation.py``'s module docstring: an optional prop is this repo's
        recorded failure shape, and a silently-inert security rule is its worst instance.
        """
        conn = sqlite3.connect(str(database_path), isolation_level=None)
        conn.row_factory = row_to_dict
        # `block_vectors` is a vec0 virtual table, so the migration runner this class reuses
        # cannot apply 0001 without the extension. Not a new dependency: sqlite-vec is
        # declared by papertree-db, which papertree-memory requires.
        conn.enable_load_extension(True)
        sqlite_vec.load(conn)
        conn.enable_load_extension(False)
        # PER-CONNECTION and never persisted; Python defaults it OFF. Every composite FK in
        # 0003 is inert without this line, including the one that makes a trusted row name a
        # real proposal.
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        # WAL is what lets an AgentDataHandle read this file while this connection holds the
        # write lock; without a busy timeout the loser of a race raises "database is locked".
        conn.execute("PRAGMA busy_timeout = 5000")
        self._conn = conn
        self._migrations_dir = migrations_dir
        self._validator = validator
        # handle -> user_id for the handles THIS connection minted. See `_resolve`, and see
        # `JobStore.owner_for` for why the binding cannot be borrowed from another connection.
        self._handles: dict[str, str] = {}

    # ── lifecycle and ownership ──────────────────────────────────────────────────────

    def migrate(self) -> MigrationResult:
        """Applies ``infrastructure/migrations/*.sql``. This package ships no DDL of its own."""
        return migrate(self._conn, self._migrations_dir)

    def owner_for(self, user_id: str) -> OwnerId:
        """Turns an ALREADY-VERIFIED user id into an owner handle for THIS connection.

        THIS PERFORMS NO AUTHENTICATION — the exact mirror of ``PaperTreeDb.owner_for`` and
        ``JobStore.owner_for``, and it exists for the same reason ``JobStore``'s does: an owner
        handle is minted by a connection and resolvable only by that connection, so a handle
        from a ``PaperTreeDb`` over the same file is correctly refused here.
        """
        row = self._conn.execute(
            "SELECT user_id FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row is None:
            raise OwnershipError(f"no such user: {user_id}")
        handle, owner = mint_owner()
        self._handles[handle] = user_id
        return owner

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> MemoryStore:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    # ── PAPER memory (trust: untrusted) ──────────────────────────────────────────────

    def write_paper_memory(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: Generation,
        *,
        kind: str,
        content: Mapping[str, Any],
        derived_from: Sequence[str],
        provenance: WriteProvenance,
    ) -> str:
        """Writes one derived document fact for ONE parse generation. Returns its ``memory_id``.

        ``derived_from`` is required and must be non-empty — the same CHECK the column carries,
        raised here so the message names the argument rather than the constraint. A memory
        record that cannot point at a source block is ungrounded, which is findings.md C4, the
        v1 defect this whole epic exists to not repeat.
        """
        owner_id = self._resolve(owner)
        self._require_derived_from(derived_from)
        memory_id = new_id("mem")
        stamp = now_iso()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            self._conn.execute(
                f"INSERT INTO paper_memory ({_PAPER_MEMORY_COLUMNS}) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
                (
                    memory_id,
                    owner_id,
                    paper_id,
                    generation,
                    kind,
                    canonical_json(dict(content)),
                    _json_array(derived_from),
                    TRUST_LABELS["paper"],
                    provenance.as_json(written_at=stamp),
                    provenance.source_session,
                    provenance.confidence,
                    stamp,
                    stamp,
                ),
            )
            self._audit(
                owner_id,
                store="paper",
                memory_id=memory_id,
                actor=provenance.actor,
                action="write",
                source_paper=paper_id,
                source_session=provenance.source_session,
                gate_decision="allowed:untrusted_store_has_no_gate",
                detail={"kind": kind, "derived_from": list(derived_from)},
                stamp=stamp,
            )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return memory_id

    def update_paper_memory(
        self, owner: OwnerId, memory_id: str, *, content: Mapping[str, Any], actor: Actor
    ) -> int:
        """F3.7's "user-editable": bumps ``version`` and ``updated_at``. Returns rows changed."""
        return self._update_record(owner, "paper_memory", "paper", memory_id, content, actor)

    def list_paper_memory(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation
    ) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM paper_memory WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "ORDER BY created_at",
            (owner_id, paper_id, generation),
        )

    # ── SESSION memory (trust: tainted, retention 90 days) ───────────────────────────

    def write_session_memory(
        self,
        owner: OwnerId,
        *,
        kind: str,
        content: Mapping[str, Any],
        provenance: WriteProvenance,
        paper_id: PaperId | None = None,
        generation: Generation | None = None,
        retention_days: int = SESSION_MEMORY_RETENTION_DAYS,
    ) -> str:
        """Writes one row of what the agent learned during ONE conversation.

        There is no ``session_id`` argument: the session is ``provenance.source_session``, which
        is required to be non-``None`` here. Two arguments naming the same session is two
        arguments that can disagree, and ``session_memory`` has both a ``session_id`` scope
        column and a NOT NULL ``source_session`` provenance column — they are the same session
        by definition, so one value fills both.

        ``retention_days`` defaults to §13.1's 90 and is a parameter so that the boundary is
        reachable: a test passes 0 and the row expires immediately. That is the difference
        between an expiry path that is exercised and one that is merely present.
        """
        owner_id = self._resolve(owner)
        session_id = provenance.source_session
        if session_id is None:
            raise ValueError(
                "session memory requires provenance.source_session — the column is NOT NULL, "
                "and §13.3's taint model is per-session, so a row that cannot name its session "
                "cannot be purged with it either"
            )
        if (paper_id is None) != (generation is None):
            raise ValueError(
                "paper_id and generation are both optional but not independently: a "
                "half-scoped session row cannot be joined and cannot be cascaded (the same "
                "CHECK exists on session_memory)"
            )
        memory_id = new_id("mem")
        stamp = now_iso()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            self._conn.execute(
                f"INSERT INTO session_memory ({_SESSION_MEMORY_COLUMNS}) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)",
                (
                    memory_id,
                    owner_id,
                    session_id,
                    paper_id,
                    generation,
                    kind,
                    canonical_json(dict(content)),
                    TRUST_LABELS["session"],
                    provenance.as_json(written_at=stamp),
                    session_id,
                    provenance.confidence,
                    stamp,
                    stamp,
                    shift_iso(stamp, days=retention_days),
                ),
            )
            self._audit(
                owner_id,
                store="session",
                memory_id=memory_id,
                actor=provenance.actor,
                action="write",
                source_paper=paper_id,
                source_session=session_id,
                gate_decision="allowed:tainted_and_cannot_be_promoted",
                detail={"kind": kind, "retention_days": retention_days},
                stamp=stamp,
            )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return memory_id

    def update_session_memory(
        self, owner: OwnerId, memory_id: str, *, content: Mapping[str, Any], actor: Actor
    ) -> int:
        return self._update_record(owner, "session_memory", "session", memory_id, content, actor)

    def list_session_memory(self, owner: OwnerId, session_id: str) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM session_memory WHERE owner_id = ? AND session_id = ? "
            "ORDER BY created_at",
            (owner_id, session_id),
        )

    def purge_expired_session_memory(self, owner: OwnerId, *, now: str) -> int:
        """Deletes every session row whose ``expires_at`` has passed. Returns the count.

        ``now`` has no default on purpose — see this module's docstring. The comparison is a
        string comparison, which is correct because every timestamp in this database is
        ISO-8601 with an offset and ISO-8601 sorts lexicographically within a fixed offset;
        :func:`~papertree_memory.records.shift_iso` is what keeps the offset fixed.

        §13.3 also requires that purging a session purges the proposals derived from it. That
        is NOT done here and is stated rather than implied: ``memory_proposals`` rows are the
        evidence trail for anything already promoted, and deleting them would violate
        ``user_learning_memory``'s NOT NULL FK onto them. See the package docstring's
        "known gaps".
        """
        owner_id = self._resolve(owner)
        stamp = now_iso()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            doomed = self._conn.execute(
                "SELECT memory_id, session_id FROM session_memory "
                "WHERE owner_id = ? AND expires_at <= ?",
                (owner_id, now),
            ).fetchall()
            self._conn.execute(
                "DELETE FROM session_memory WHERE owner_id = ? AND expires_at <= ?",
                (owner_id, now),
            )
            for row in doomed:
                self._audit(
                    owner_id,
                    store="session",
                    memory_id=str(row["memory_id"]),
                    actor="system",
                    action="delete",
                    source_paper=None,
                    source_session=str(row["session_id"]),
                    gate_decision="allowed:retention_expiry",
                    detail={"expired_at_or_before": now},
                    stamp=stamp,
                )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return len(doomed)

    # ── ARTEFACT memory (trust: derived_untrusted) ───────────────────────────────────

    def write_artefact_memory(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: Generation,
        *,
        kind: str,
        content: Mapping[str, Any],
        derived_from: Sequence[str],
        provenance: WriteProvenance,
    ) -> str:
        """Writes one generated artefact as CONTENT ONLY. Returns its ``memory_id``.

        §13.5 rule 3 (findings.md C5) is a RENDERER rule and cannot be enforced here: whether
        an artefact is visually distinguishable from the paper's own figures is a property of
        the component that draws it. This method stores the body and the anchors; the reserved
        AI-derived marker lives in ``@papertree/ui`` and is asserted by
        `reader/provenance.spec`. Said out loud because "artefacts are marked" is easy to
        believe is handled somewhere.
        """
        owner_id = self._resolve(owner)
        self._require_derived_from(derived_from)
        memory_id = new_id("mem")
        stamp = now_iso()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            self._conn.execute(
                f"INSERT INTO artefact_memory ({_ARTEFACT_MEMORY_COLUMNS}) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
                (
                    memory_id,
                    owner_id,
                    paper_id,
                    generation,
                    kind,
                    canonical_json(dict(content)),
                    _json_array(derived_from),
                    TRUST_LABELS["artefact"],
                    provenance.as_json(written_at=stamp),
                    provenance.source_session,
                    provenance.confidence,
                    stamp,
                    stamp,
                ),
            )
            self._audit(
                owner_id,
                store="artefact",
                memory_id=memory_id,
                actor=provenance.actor,
                action="write",
                source_paper=paper_id,
                source_session=provenance.source_session,
                gate_decision="allowed:content_only_derived_untrusted",
                detail={"kind": kind, "derived_from": list(derived_from)},
                stamp=stamp,
            )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return memory_id

    def update_artefact_memory(
        self, owner: OwnerId, memory_id: str, *, content: Mapping[str, Any], actor: Actor
    ) -> int:
        return self._update_record(owner, "artefact_memory", "artefact", memory_id, content, actor)

    def list_artefact_memory(
        self, owner: OwnerId, paper_id: PaperId, generation: Generation
    ) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM artefact_memory WHERE owner_id = ? AND paper_id = ? "
            "AND generation = ? ORDER BY created_at",
            (owner_id, paper_id, generation),
        )

    # ── the proposal queue: the ONLY route towards the trusted store ─────────────────

    def create_proposal(
        self,
        owner: OwnerId,
        paper_id: PaperId,
        generation: Generation,
        *,
        session_id: str,
        kind: str,
        content: Mapping[str, Any],
        evidence: EvidenceSpan,
        model_id: str,
        prompt_hash: str,
    ) -> ProposalOutcome:
        """Creates a proposal row, ``pending`` or ``auto_rejected``, and audits which.

        TWO GATES RUN HERE, IN THIS ORDER, AND THEY ARE DIFFERENT KINDS OF THING:

          1. **Evidence verification** (structural-ish, and the stronger of the two). The quote
             must be exactly ``blocks.text[char_start:char_end]`` of the named block, in the
             named paper generation, owned by this owner. A proposal whose evidence does not
             resolve cannot be displayed to the user with the words "found in this PDF" next to
             it, which is §13.6(e) attack 1's step 4 — the step that makes a user reject it.
             Failing this writes ``rejection_rule = 'evidence_not_verbatim'``.

          2. **Content validation** (policy). §13.6(b)'s four rules, in ``validation.py``,
             which is explicit that it is worth nothing on its own.

        Evidence runs first because it is a fact about the database rather than a guess about
        text, and because a proposal with unresolvable evidence is unshowable regardless of how
        clean its wording is.

        A REJECTION IS A ROW, NOT AN EXCEPTION. §13.6(d) logs the gate decision per write; a
        rejection that raised before inserting would be a decision with no record, and the
        rejected proposal is exactly the artefact a security reviewer wants to read.
        """
        owner_id = self._resolve(owner)
        rule = self._verify_evidence(owner_id, paper_id, generation, evidence)
        detail = ""
        if rule is None:
            outcome = self._validator.check(content)
            rule = outcome.rule
            detail = outcome.detail
        else:
            detail = "quote is not at those offsets in that block's unrepaired text"

        proposal_id = new_id("prp")
        stamp = now_iso()
        state: ProposalState = "auto_rejected" if rule is not None else "pending"
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            self._conn.execute(
                f"INSERT INTO memory_proposals ({_PROPOSAL_COLUMNS}) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    proposal_id,
                    owner_id,
                    paper_id,
                    generation,
                    session_id,
                    kind,
                    canonical_json(dict(content)),
                    evidence.block_id,
                    evidence.quote,
                    evidence.char_start,
                    evidence.char_end,
                    state,
                    rule,
                    model_id,
                    prompt_hash,
                    stamp,
                    stamp if rule is not None else None,
                ),
            )
            self._audit(
                owner_id,
                store="proposal",
                memory_id=proposal_id,
                actor="agent",
                action="auto_reject" if rule is not None else "propose",
                source_paper=paper_id,
                source_session=session_id,
                gate_decision=f"auto_rejected:{rule}"
                if rule is not None
                else "pending:awaiting_user",
                detail={"kind": kind, "rule": rule, "why": detail, "model_id": model_id},
                stamp=stamp,
            )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return ProposalOutcome(proposal_id=proposal_id, state=state, rejection_rule=rule)

    def get_proposal(self, owner: OwnerId, proposal_id: str) -> Row | None:
        owner_id = self._resolve(owner)
        return self._one(
            "SELECT * FROM memory_proposals WHERE owner_id = ? AND proposal_id = ?",
            (owner_id, proposal_id),
        )

    def list_proposals(self, owner: OwnerId, *, state: ProposalState | None = None) -> list[Row]:
        owner_id = self._resolve(owner)
        if state is None:
            return self._all(
                "SELECT * FROM memory_proposals WHERE owner_id = ? ORDER BY created_at",
                (owner_id,),
            )
        return self._all(
            "SELECT * FROM memory_proposals WHERE owner_id = ? AND state = ? ORDER BY created_at",
            (owner_id, state),
        )

    def confirm_proposal(self, owner: OwnerId, confirmation: UserConfirmation) -> str:
        """Promotes ONE proposal into ``user_learning_memory``. The only write path there is.

        ``confirmation`` is required, positional and carries the quote the UI displayed. There
        is no overload without it and no ``auto_confirm`` flag, because §13.7 rec. 3's response
        to rubber-stamping is explicitly *"fewer, higher-confidence proposals, not an auto-apply
        threshold"* — an auto-apply parameter here would be the first thing switched on under
        product pressure and the last thing anyone revisited.

        Refuses, in this order:

          * the proposal does not exist for this owner -> ``OwnershipError``;
          * it was already decided -> ``ProposalRejected`` (an ``auto_rejected`` proposal is
            never promotable, and re-confirming an ``accepted`` one would create a second
            trusted row from one human decision);
          * the confirmation's quote is not byte-identical to the stored evidence ->
            :class:`~papertree_memory.errors.ConfirmationMismatch`, audited as a denial;
          * §13.4's cap would be exceeded -> :class:`~papertree_memory.errors.MemoryCapExceeded`,
            audited as a denial.
        """
        owner_id = self._resolve(owner)
        proposal = self._one(
            "SELECT * FROM memory_proposals WHERE owner_id = ? AND proposal_id = ?",
            (owner_id, confirmation.proposal_id),
        )
        if proposal is None:
            raise OwnershipError(
                f"no proposal {confirmation.proposal_id} for this owner. A confirmation names "
                "the proposal it confirms, so it cannot be replayed onto another one."
            )
        if proposal["state"] != "pending":
            raise ProposalRejected(
                confirmation.proposal_id, str(proposal["rejection_rule"] or proposal["state"])
            )
        if confirmation.evidence_quote != proposal["evidence_quote"]:
            self._record_denial(
                owner_id,
                store="user_learning",
                memory_id=confirmation.proposal_id,
                actor="user",
                gate_decision="denied:confirmation_quote_mismatch",
                detail={
                    "why": (
                        "the confirmation did not reproduce the proposal's evidence quote, so "
                        "there is no evidence the user was shown what they approved"
                    ),
                    "expected_length": len(str(proposal["evidence_quote"])),
                    "received_length": len(confirmation.evidence_quote),
                },
                source_paper=str(proposal["paper_id"]),
                source_session=str(proposal["session_id"]),
            )
            raise ConfirmationMismatch(
                "the confirmation's evidence quote does not match the proposal's stored quote"
            )

        content = str(proposal["content"])
        usage = self.user_learning_usage(owner)
        added = len(content.encode("utf-8"))
        if usage.records + 1 > USER_LEARNING_MAX_RECORDS:
            self._deny_for_cap(
                owner_id, proposal, "records", usage.records + 1, USER_LEARNING_MAX_RECORDS
            )
        if usage.content_bytes + added > USER_LEARNING_MAX_BYTES:
            self._deny_for_cap(
                owner_id,
                proposal,
                "content_bytes",
                usage.content_bytes + added,
                USER_LEARNING_MAX_BYTES,
            )

        memory_id = new_id("mem")
        stamp = now_iso()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            self._conn.execute(
                "UPDATE memory_proposals SET state = 'accepted', decided_at = ? "
                "WHERE owner_id = ? AND proposal_id = ? AND state = 'pending'",
                (confirmation.confirmed_at, owner_id, confirmation.proposal_id),
            )
            self._conn.execute(
                f"INSERT INTO user_learning_memory ({_USER_LEARNING_COLUMNS}) "
                "VALUES (?,?,?,?,?,?,?,1,?,?,'user',?,?,?)",
                (
                    memory_id,
                    owner_id,
                    str(proposal["kind"]),
                    content,
                    TRUST_LABELS["user_learning"],
                    canonical_json(
                        {
                            # §13.4: the provenance of a trusted row is a HUMAN DECISION, not a
                            # block id. `derived_from` is deliberately absent from this table,
                            # and the evidence lives on the proposal this row names.
                            "actor": "user",
                            "origin": "user_confirmed_proposal",
                            "proposal_id": confirmation.proposal_id,
                            "written_at": stamp,
                        }
                    ),
                    # A trusted row's confidence is the human's, not the model's. The proposal
                    # keeps the model's own numbers; promoting them here would let a confident
                    # injection arrive pre-trusted.
                    1.0,
                    confirmation.proposal_id,
                    confirmation.confirmed_at,
                    stamp,
                    stamp,
                    shift_iso(confirmation.confirmed_at, days=USER_LEARNING_RECONFIRM_DAYS),
                ),
            )
            self._audit(
                owner_id,
                store="user_learning",
                memory_id=memory_id,
                actor="user",
                action="accept",
                source_paper=str(proposal["paper_id"]),
                source_session=str(proposal["session_id"]),
                gate_decision="allowed:human_confirmation_with_matching_evidence",
                detail={
                    "proposal_id": confirmation.proposal_id,
                    "kind": str(proposal["kind"]),
                    "confirmed_at": confirmation.confirmed_at,
                },
                stamp=stamp,
            )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return memory_id

    def reject_proposal(self, owner: OwnerId, proposal_id: str, *, decided_at: str) -> int:
        """The user said no. Moves ``pending`` -> ``rejected``. Returns rows changed.

        ``rejection_rule`` stays NULL: `memory_proposals` CHECKs that only ``auto_rejected``
        carries a rule, because "a human declined" is not a rule failure and conflating the two
        would make §13.7 rec. 3's rubber-stamping telemetry unreadable.
        """
        owner_id = self._resolve(owner)
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = self._conn.execute(
                "UPDATE memory_proposals SET state = 'rejected', decided_at = ? "
                "WHERE owner_id = ? AND proposal_id = ? AND state = 'pending'",
                (decided_at, owner_id, proposal_id),
            )
            changed = cursor.rowcount
            if changed:
                self._audit(
                    owner_id,
                    store="proposal",
                    memory_id=proposal_id,
                    actor="user",
                    action="reject",
                    source_paper=None,
                    source_session=None,
                    gate_decision="rejected:declined_by_user",
                    detail={"decided_at": decided_at},
                    stamp=now_iso(),
                )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return changed

    # ── USER LEARNING memory (trust: trusted) ────────────────────────────────────────

    def list_user_learning_memory(self, owner: OwnerId) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM user_learning_memory WHERE owner_id = ? ORDER BY kind, created_at",
            (owner_id,),
        )

    def user_learning_usage(self, owner: OwnerId) -> UserLearningUsage:
        """§13.4's cap, measured. ``length(cast(content AS BLOB))`` is BYTES, not characters.

        ``length()`` on a TEXT value counts characters, which under-counts every non-ASCII
        payload by up to 4x — a cap that a CJK or emoji preference walks straight through. The
        cast is what makes the number the same one the ~100 KB figure was derived from.
        """
        owner_id = self._resolve(owner)
        row = self._one(
            "SELECT count(*) AS n, coalesce(sum(length(cast(content AS BLOB))), 0) AS b "
            "FROM user_learning_memory WHERE owner_id = ?",
            (owner_id,),
        )
        if row is None:  # pragma: no cover - aggregate always returns a row
            return UserLearningUsage(records=0, content_bytes=0)
        return UserLearningUsage(records=int(row["n"]), content_bytes=int(row["b"]))

    def edit_user_learning_memory(
        self, owner: OwnerId, memory_id: str, *, content: Mapping[str, Any], edited_at: str
    ) -> int:
        """The settings-UI edit path. Bumps ``version`` and ``updated_at``. Returns rows changed.

        F3.7's "user-editable" made real: §13.4 says the store is *"fully user-visible and
        user-editable — ChatGPT's saved-memories pattern is the right product precedent"*, and
        a store the user can only delete from is not that.

        The actor is ``user`` and is not a parameter. There is no ``actor='agent'`` edit of a
        trusted row that this package will express — that would be the arrow §13.1's diagram
        does not have, reintroduced through the update path instead of the insert path, which
        is exactly where it would be missed.

        THIS IS ALSO THE ONLY PATH ON WHICH THE BYTE CAP CAN FIRE, and the arithmetic is worth
        writing down because it decides where the check belongs. §13.4's cap is "200 records ×
        512 bytes"; 200 × 512 is exactly 102,400, which is exactly ``USER_LEARNING_MAX_BYTES``.
        Every content promoted through ``confirm_proposal`` has already passed the validator's
        512-byte cap, so the RECORD cap always trips first there and the byte cap is
        unreachable by construction. Here it is reachable in one paste, because a user editing
        their own record is not model output and the validator does not run. Both caps are
        checked in both places anyway — an equality that holds today is not a control.
        """
        owner_id = self._resolve(owner)
        rendered = canonical_json(dict(content))
        usage = self.user_learning_usage(owner)
        existing = self._one(
            "SELECT length(cast(content AS BLOB)) AS b FROM user_learning_memory "
            "WHERE owner_id = ? AND memory_id = ?",
            (owner_id, memory_id),
        )
        if existing is None:
            return 0
        projected = usage.content_bytes - int(existing["b"]) + len(rendered.encode("utf-8"))
        if projected > USER_LEARNING_MAX_BYTES:
            self._record_denial(
                owner_id,
                store="user_learning",
                memory_id=memory_id,
                actor="user",
                gate_decision="denied:user_learning_cap",
                detail={"kind": "content_bytes", "projected": projected},
                source_paper=None,
                source_session=None,
            )
            raise MemoryCapExceeded("content_bytes", projected, USER_LEARNING_MAX_BYTES)
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = self._conn.execute(
                "UPDATE user_learning_memory SET content = ?, version = version + 1, "
                "updated_at = ? WHERE owner_id = ? AND memory_id = ?",
                (rendered, edited_at, owner_id, memory_id),
            )
            changed = cursor.rowcount
            if changed:
                self._audit(
                    owner_id,
                    store="user_learning",
                    memory_id=memory_id,
                    actor="user",
                    action="update",
                    source_paper=None,
                    source_session=None,
                    gate_decision="allowed:user_edited_own_record",
                    detail={"edited_at": edited_at},
                    stamp=now_iso(),
                )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return changed

    def delete_user_learning_memory(self, owner: OwnerId, memory_id: str) -> int:
        """Immediate hard delete (§13.4, GDPR Art. 17). Returns rows changed.

        §13.4 adds: if these records are ever embedded, the vectors must be hard-deleted and
        the index REBUILT, not filtered — soft deletion leaves the vector recoverable from a
        live HNSW index. Nothing in this package embeds user-learning memory, so there is
        nothing to rebuild yet; the requirement is recorded here because the moment someone
        adds an embedding it stops being satisfied by accident.
        """
        owner_id = self._resolve(owner)
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = self._conn.execute(
                "DELETE FROM user_learning_memory WHERE owner_id = ? AND memory_id = ?",
                (owner_id, memory_id),
            )
            changed = cursor.rowcount
            if changed:
                self._audit(
                    owner_id,
                    store="user_learning",
                    memory_id=memory_id,
                    actor="user",
                    action="delete",
                    source_paper=None,
                    source_session=None,
                    gate_decision="allowed:user_deleted_own_record",
                    detail={"note": "hard delete; no vectors exist for this store"},
                    stamp=now_iso(),
                )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return changed

    # ── the audit trail (§13.6d) ─────────────────────────────────────────────────────

    def list_audit(self, owner: OwnerId, *, limit: int = 200) -> list[Row]:
        owner_id = self._resolve(owner)
        return self._all(
            "SELECT * FROM memory_audit WHERE owner_id = ? ORDER BY created_at, audit_id LIMIT ?",
            (owner_id, limit),
        )

    def record_denied_routes(
        self,
        owner: OwnerId,
        probes: Sequence[RouteProbe],
        *,
        source_paper: str | None,
        source_session: str | None,
    ) -> int:
        """Records one ``denied`` audit row per escape route a guarded handle was refused.

        WHY THIS LIVES ON THE WRITER AND NOT ON THE HANDLE: the handle's connection is
        read-only, so it physically cannot append to an append-only log. That is not an
        inconvenience to route around — it is the boundary working. The thing that was denied
        never gets to write the record of its own denial.

        RAISES if any probe ESCAPED, after writing the audit rows. §13.6(d): *"That condition
        should be structurally impossible; if it fires, a control has failed."* Returning
        quietly would leave a service running with an open boundary and a log entry nobody
        reads.
        """
        owner_id = self._resolve(owner)
        escaped: list[str] = []
        for probe in probes:
            if probe.escaped:
                escaped.append(probe.route)
            self._record_denial(
                owner_id,
                store="user_learning",
                memory_id=None,
                actor="agent",
                gate_decision=("ESCAPED:" if probe.escaped else "denied:") + probe.route,
                detail={
                    "route": probe.route,
                    "statement": probe.statement,
                    "error": probe.error,
                    "artefact_created": probe.artefact_created,
                },
                source_paper=source_paper,
                source_session=source_session,
            )
        if escaped:
            raise TrustBoundaryViolation(
                ", ".join(escaped),
                "a read-only agent connection reached a write route; the audit rows are "
                "written and this is a control failure, not a caller error",
            )
        return len(probes)

    def record_denial(
        self,
        owner: OwnerId,
        *,
        route: str,
        detail: Mapping[str, Any],
        actor: Actor,
        source_paper: str | None,
        source_session: str | None,
    ) -> str:
        """Records one ``denied`` row for a refusal the runtime caught above the database.

        The general case of :meth:`record_denied_routes`: a tool that tried to call a write
        method that does not exist, a Rule-of-Two violation, a turn that asked for a capability
        its toolset did not include. Returns the ``audit_id`` so the caller can quote it in an
        error surfaced to the user.
        """
        owner_id = self._resolve(owner)
        return self._record_denial(
            owner_id,
            store="user_learning",
            memory_id=None,
            actor=actor,
            gate_decision=f"denied:{route}",
            detail={"route": route, **dict(detail)},
            source_paper=source_paper,
            source_session=source_session,
        )

    # ── internals ────────────────────────────────────────────────────────────────────

    def _resolve(self, owner: OwnerId) -> str:
        """Turns an owner HANDLE into the ``user_id`` every statement binds, or refuses.

        Refuses unless THIS connection minted it. A handle from a ``PaperTreeDb`` or a
        ``JobStore`` over the same file is not one this store can resolve, which is the point:
        an owner handle is minted BY a connection and means nothing on any other. Borrowing the
        class without borrowing the binding is the defect ``JobStore``'s docstring records.
        """
        if not isinstance(owner, OwnerId):
            raise OwnershipError(
                f"expected an OwnerId minted by this MemoryStore, got {type(owner).__name__}"
            )
        user_id = self._handles.get(owner.handle)
        if user_id is None:
            raise OwnershipError(
                "that value was not minted by this MemoryStore. An OwnerId is an opaque "
                "per-connection handle from MemoryStore.owner_for(); a handle minted by a "
                "PaperTreeDb or a JobStore — even one over the same file — is not one."
            )
        return user_id

    def _verify_evidence(
        self,
        owner_id: str,
        paper_id: PaperId,
        generation: Generation,
        evidence: EvidenceSpan,
    ) -> RejectionRule | None:
        """§13.6(b) gate 2: does the quote actually sit at those offsets in that block?

        Offsets are into ``blocks.text``, the UNREPAIRED reading (deviation D4) — see
        :class:`~papertree_memory.records.EvidenceSpan` for why that is the right column and
        what it costs. Returns the rule name on failure so the caller can store it, rather than
        raising: a failed evidence check produces a row, like every other rejection.
        """
        row = self._one(
            "SELECT text FROM blocks WHERE owner_id = ? AND paper_id = ? AND generation = ? "
            "AND block_id = ?",
            (owner_id, paper_id, generation, evidence.block_id),
        )
        if row is None or row["text"] is None:
            return "evidence_not_verbatim"
        text = str(row["text"])
        if evidence.char_end > len(text):
            return "evidence_not_verbatim"
        if text[evidence.char_start : evidence.char_end] != evidence.quote:
            return "evidence_not_verbatim"
        return None

    def _update_record(
        self,
        owner: OwnerId,
        table: str,
        store: StoreName,
        memory_id: str,
        content: Mapping[str, Any],
        actor: Actor,
    ) -> int:
        """The shared update path for the three agent-writable stores.

        ``table`` is interpolated into the SQL. It is NOT caller data: every call site in this
        module passes one of three literals, and the three tables have identical
        ``content``/``version``/``updated_at`` columns. Interpolating a name that came from
        outside this module would be an injection; this one cannot.
        """
        owner_id = self._resolve(owner)
        stamp = now_iso()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = self._conn.execute(
                f"UPDATE {table} SET content = ?, version = version + 1, updated_at = ? "  # noqa: S608
                "WHERE owner_id = ? AND memory_id = ?",
                (canonical_json(dict(content)), stamp, owner_id, memory_id),
            )
            changed = cursor.rowcount
            if changed:
                self._audit(
                    owner_id,
                    store=store,
                    memory_id=memory_id,
                    actor=actor,
                    action="update",
                    source_paper=None,
                    source_session=None,
                    gate_decision="allowed:version_bumped",
                    detail={"table": table},
                    stamp=stamp,
                )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return changed

    def _deny_for_cap(
        self, owner_id: str, proposal: Row, kind: str, projected: int, limit: int
    ) -> None:
        self._record_denial(
            owner_id,
            store="user_learning",
            memory_id=str(proposal["proposal_id"]),
            actor="user",
            gate_decision="denied:user_learning_cap",
            detail={"kind": kind, "projected": projected, "limit": limit},
            source_paper=str(proposal["paper_id"]),
            source_session=str(proposal["session_id"]),
        )
        raise MemoryCapExceeded(kind, projected, limit)

    def _record_denial(
        self,
        owner_id: str,
        *,
        store: StoreName,
        memory_id: str | None,
        actor: Actor,
        gate_decision: str,
        detail: Mapping[str, Any],
        source_paper: str | None,
        source_session: str | None,
    ) -> str:
        """Writes ONE denial row in its own transaction.

        Its own transaction because a denial is usually followed by an exception, and an audit
        row that rolls back with the failure it was recording is an audit row that never
        existed. ``memory_audit.store`` names the store the GATE PROTECTS, not the table the
        refused statement mentioned — the CHECK admits five values and ``memory_audit`` is not
        one of them, and inventing a sixth would mean editing an applied migration.
        """
        audit_id = new_id("aud")
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            self._write_audit_row(
                audit_id,
                owner_id,
                store=store,
                memory_id=memory_id,
                actor=actor,
                action="denied",
                source_paper=source_paper,
                source_session=source_session,
                gate_decision=gate_decision,
                detail=detail,
                stamp=now_iso(),
            )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return audit_id

    def _audit(
        self,
        owner_id: str,
        *,
        store: StoreName,
        memory_id: str | None,
        actor: Actor,
        action: AuditAction,
        source_paper: str | None,
        source_session: str | None,
        gate_decision: str,
        detail: Mapping[str, Any],
        stamp: str,
    ) -> None:
        """Appends inside the CALLER'S transaction, so the row and the write commit together."""
        self._write_audit_row(
            new_id("aud"),
            owner_id,
            store=store,
            memory_id=memory_id,
            actor=actor,
            action=action,
            source_paper=source_paper,
            source_session=source_session,
            gate_decision=gate_decision,
            detail=detail,
            stamp=stamp,
        )

    def _write_audit_row(
        self,
        audit_id: str,
        owner_id: str,
        *,
        store: StoreName,
        memory_id: str | None,
        actor: Actor,
        action: AuditAction,
        source_paper: str | None,
        source_session: str | None,
        gate_decision: str,
        detail: Mapping[str, Any],
        stamp: str,
    ) -> None:
        self._conn.execute(
            f"INSERT INTO memory_audit ({_AUDIT_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                audit_id,
                owner_id,
                store,
                memory_id,
                actor,
                action,
                TRUST_LABELS[store],
                source_paper,
                source_session,
                gate_decision,
                canonical_json(dict(detail)),
                stamp,
            ),
        )

    @staticmethod
    def _require_derived_from(derived_from: Sequence[str]) -> None:
        if not derived_from:
            raise ValueError(
                "derived_from must name at least one source block. The column carries the same "
                "CHECK; raising here names the argument instead of the constraint. An "
                "ungrounded memory record is findings.md C4."
            )

    def _one(self, sql: str, params: tuple[Any, ...]) -> Row | None:
        row: Row | None = self._conn.execute(sql, params).fetchone()
        return row

    def _all(self, sql: str, params: tuple[Any, ...]) -> list[Row]:
        rows: list[Row] = self._conn.execute(sql, params).fetchall()
        return rows


def _json_array(values: Sequence[str]) -> str:
    """A JSON array of block ids for the ``derived_from`` columns.

    Separate from :func:`~papertree_memory.records.canonical_json`, which takes a Mapping:
    ``derived_from`` is CHECKed with ``json_array_length(...) >= 1`` and an object would fail
    that check at INSERT time with a message naming neither the column nor the value.
    """
    return json.dumps(list(values), separators=(",", ":"), ensure_ascii=False)
