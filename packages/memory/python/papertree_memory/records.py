"""The record shape F3.7 requires, and the retention numbers `0003_memory.sql` cannot express.

F3.7, verbatim: *"Every agent-written record carries provenance, timestamp, source session,
confidence, version, and is user-editable."* Five of those six are columns on the three
agent-writable tables; the sixth ("user-editable") is `updated_at` plus an update path that
bumps `version`. This module is what makes the five MANDATORY at the call site rather than
merely present in the schema.

WHY :class:`WriteProvenance` IS ONE OBJECT AND NOT FIVE KEYWORD ARGUMENTS
    Because five optional keyword arguments is exactly the shape that lets a caller supply
    three of them. The Epic 2 post-mortem is quoted in this epic's brief: four of five
    unreachable-feature defects involved an optional prop, and none would have survived being
    mandatory. Every write method on :class:`~papertree_memory.store.MemoryStore` takes one
    `WriteProvenance`, positionally required, and there is no overload without it — so
    "provenance was forgotten" is not a state this package can reach. The dataclass validates
    its own contents in ``__post_init__``, so an out-of-range confidence fails at the call
    site with a readable message rather than as a SQLite CHECK deep inside a transaction.

WHY THE TRUST LABELS ARE A CLOSED ``Literal`` AND THE STORE NAMES ARE TOO
    `0003_memory.sql` CHECKs each table's `trust_label` to a single literal value, so the
    label is not a parameter at all — it is a property of the table you wrote to. These
    aliases exist so the Python side agrees with the SQL by construction: a store constant is
    read from :data:`TRUST_LABELS` rather than typed out at each INSERT, which is how the
    label and the CHECK stay the same string.

WHY :class:`UserConfirmation` IS A PLAIN FROZEN DATACLASS AND NOT A GUARDED-CONSTRUCTOR TOKEN
    The obvious move is a token with a module-private mint sentinel, so that "only the UI can
    build one". `packages/db/python/papertree_db/ids.py` records, at length, that this exact
    design was broken three ways in one afternoon — `_MINT` is importable, `copy.copy`
    preserves the sentinel, and `object.__new__` skips `__init__`. Repeating it here would be
    security theatre with a documented failure history in the same repository.

    So the honest claim is smaller and true: `UserConfirmation` is a REQUIRED ARGUMENT to
    ``confirm_proposal`` that carries the exact quote the UI displayed, and the store refuses
    the promotion unless that quote is byte-identical to the proposal's stored
    `evidence_quote`. Its weight is that no code path — including a future refactor that
    forgets why — can promote a proposal without a caller that named the proposal and
    reproduced its evidence. The thing an agent genuinely cannot do is reach
    ``MemoryStore`` at all; that is `guard.py`'s job, and it is structural rather than
    conventional. See §13.6(b): the gate is all three of grant, proposal row, and UI
    confirmation, and this class is the third one only.

RETENTION NUMBERS AND WHERE EACH CAME FROM
    Every constant below cites §13.1's table or §13.4. None is invented here, and none is
    expressible in the migration:

      * 90 days for session memory — §13.1 "Retention: 90 days". The schema has an
        `expires_at` column but SQLite has no TTL, so something has to compute and enforce it.
      * ~100 KB / 200 records for user-learning memory — §13.4 "hard cap 200 records × 512
        bytes ≈ 100 KB per user". `0003_memory.sql`'s header states plainly that a SQLite
        CHECK cannot see other rows, so a per-user aggregate cap is not expressible there.
      * 512 bytes per proposal content — §13.4's `value_shape` CHECK,
        `length(value::text) <= 512`.
      * 64 characters per content key — §13.4's `key text NOT NULL CHECK (length(key) <= 64)`.
      * 365 days to re-confirmation — §13.4 "Retention until deleted, with an annual
        re-confirmation prompt driven by `expires_at`".
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Literal

#: The four trust labels from §13.1's table. Closed, because `0003_memory.sql` CHECKs each
#: table's column to exactly one of them.
TrustLabel = Literal["untrusted", "tainted", "derived_untrusted", "trusted"]

#: `memory_audit.actor`'s CHECK, verbatim.
Actor = Literal["user", "agent", "system"]

#: `memory_audit.store`'s CHECK, verbatim.
StoreName = Literal["paper", "session", "user_learning", "artefact", "proposal"]

#: `memory_audit.action`'s CHECK, verbatim.
AuditAction = Literal[
    "write", "update", "delete", "propose", "accept", "reject", "auto_reject", "denied"
]

#: `memory_proposals.state`'s CHECK, verbatim.
ProposalState = Literal["pending", "accepted", "rejected", "auto_rejected"]

#: store name -> the single trust label its table's CHECK permits. Read, never retyped.
TRUST_LABELS: Final[Mapping[StoreName, TrustLabel]] = {
    "paper": "untrusted",
    "session": "tainted",
    "artefact": "derived_untrusted",
    "user_learning": "trusted",
    # A proposal is not a memory record and has no trust_label column; the audit row for one
    # records the label of the store it is a proposal FOR, which is always the trusted one.
    "proposal": "trusted",
}

#: §13.1: session memory retention is 90 days.
SESSION_MEMORY_RETENTION_DAYS: Final = 90

#: §13.4: "annual re-confirmation prompt".
USER_LEARNING_RECONFIRM_DAYS: Final = 365

#: §13.4: "hard cap 200 records × 512 bytes ≈ 100 KB per user". Both halves are enforced —
#: 200 rows of 4 bytes is under the byte cap and still unreadable on one settings screen,
#: and one 100 KB row is one record and still not auditable by a human.
USER_LEARNING_MAX_RECORDS: Final = 200
USER_LEARNING_MAX_BYTES: Final = 100 * 1024

#: §13.4's `value_shape` CHECK: `length(value::text) <= 512`.
MAX_PROPOSAL_CONTENT_BYTES: Final = 512

#: §13.4's `key text NOT NULL CHECK (length(key) <= 64)`.
MAX_CONTENT_KEY_LENGTH: Final = 64


def now_iso() -> str:
    """The one timestamp format this package writes. Matches ``papertree_db._now``."""
    return datetime.now(UTC).isoformat()


def _parse_iso(value: str, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:  # pragma: no cover - message is the whole point
        raise ValueError(f"{field} must be an ISO-8601 timestamp, got {value!r}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must carry a timezone offset, got {value!r}")
    return parsed


def shift_iso(stamp: str, *, days: int) -> str:
    """Adds ``days`` to an ISO-8601 timestamp, preserving the offset.

    Used for `session_memory.expires_at` and `user_learning_memory.reconfirm_due`. Both are
    computed here rather than in SQL because SQLite's `datetime()` returns a space-separated
    string with no offset, which would not compare correctly against the ISO-8601 timestamps
    every other column in this database already holds.
    """
    return (_parse_iso(stamp, "stamp") + timedelta(days=days)).isoformat()


def canonical_json(value: Mapping[str, Any]) -> str:
    """The single serialisation used for every JSON column and every length check.

    Sorted keys and no whitespace, so the byte length a validator measures is the byte length
    the row stores. Two spellings would let a proposal pass the 512-byte cap and then store
    more than 512 bytes.
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


@dataclass(frozen=True, slots=True)
class WriteProvenance:
    """F3.7's five mandatory fields, as one required argument.

    ``actor`` is who CAUSED the write, not who executed it. Every write in this package is
    executed by :class:`~papertree_memory.store.MemoryStore`, which is privileged by
    construction; recording "the privileged writer did it" on every row would make the audit
    log unable to answer the only question anyone asks of it. `agent` means the content came
    out of a model, `user` means it came out of a human action, `system` means neither (a
    purge, a migration, a scheduled consolidation).

    ``source_session`` is nullable on paper and artefact memory and NOT NULL on session
    memory; the store enforces the difference rather than the dataclass, because it is a
    property of the destination table and not of the provenance.

    ``generator`` is §13.5's `generator` column shape — `{model, prompt_version, run_id}` —
    and is stored inside the `provenance` JSON rather than as columns, because the three
    agent-writable tables share one `provenance` column and inventing three sets of columns
    for one vocabulary is how findings.md §G5 happened.
    """

    actor: Actor
    source_session: str | None
    confidence: float
    generator: Mapping[str, Any]

    def __post_init__(self) -> None:
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError(
                f"confidence must be between 0 and 1 inclusive, got {self.confidence!r} "
                "(the same bound as the CHECK on every memory table)"
            )
        if self.actor == "agent" and not self.generator:
            raise ValueError(
                "an agent-attributed write must name its generator "
                "({'model': ..., 'prompt_version': ...}); §13.6(d) logs the model per write, "
                "and a row that cannot name the model that produced it is unauditable"
            )
        # Fail here rather than at json.dumps inside a transaction, where the rollback hides
        # which field was at fault.
        canonical_json(dict(self.generator))

    def as_json(self, *, written_at: str) -> str:
        """The `provenance` column value. §13.4: "one provenance vocabulary across the system"."""
        return canonical_json(
            {
                "actor": self.actor,
                "generator": dict(self.generator),
                "source_session": self.source_session,
                "written_at": written_at,
            }
        )


@dataclass(frozen=True, slots=True)
class EvidenceSpan:
    """§13.6(b) gate 2: the verbatim span a proposal was derived from, and where it is.

    All four fields are required and none is nullable, mirroring `memory_proposals`, whose
    header says why: "a proposal the user cannot be shown the source of is a proposal the
    user cannot meaningfully accept. The confirmation UI has no fallback rendering for a
    missing quote, by design."

    OFFSETS ARE INTO ``blocks.text``, THE UNREPAIRED READING. That is deviation D4's column
    and it is the right one for this job: the evidence span must be verbatim from the SOURCE,
    and `Block.text` is defined to be the source reading permanently. The known interaction is
    stated rather than hidden — if a repair applies inside the quoted range and the UI shows
    the resolved reading, the offsets will not match and
    :meth:`~papertree_memory.store.MemoryStore.create_proposal` auto-rejects. That direction
    is fail-closed (a valid proposal is refused; an invalid one is never admitted), which is
    the direction to fail in. Moving to ``resolved_text`` requires this package to declare a
    dependency on ``papertree-document-ir``, which is a lockfile change this package does not
    own; see the module docstring of ``papertree_memory``.
    """

    block_id: str
    quote: str
    char_start: int
    char_end: int

    def __post_init__(self) -> None:
        if not self.block_id:
            raise ValueError("evidence must name the block it came from")
        if not self.quote:
            raise ValueError("evidence must carry the verbatim quote the user will be shown")
        if self.char_start < 0:
            raise ValueError(f"char_start must be >= 0, got {self.char_start}")
        if self.char_end < self.char_start:
            raise ValueError(
                f"char_end {self.char_end} precedes char_start {self.char_start}; the same "
                "CHECK exists on memory_proposals"
            )


@dataclass(frozen=True, slots=True)
class UserConfirmation:
    """Gate 3 of §13.6(b), as the argument ``confirm_proposal`` cannot be called without.

    Read this class's entry in the module docstring before assuming it is unforgeable. It is
    not, and it is not meant to be: the unforgeable layer is that an agent holds an
    :class:`~papertree_memory.agent_handle.AgentDataHandle` and no route from it reaches a
    ``MemoryStore``.

    What this object DOES buy, and it is checkable:

      * ``confirm_proposal`` has no default for it, so promotion cannot happen by omission;
      * it names the proposal, so a confirmation cannot be replayed onto a different one;
      * it carries the quote the UI displayed, and the store refuses unless that string is
        byte-identical to the proposal's stored `evidence_quote` — so a caller that never
        read the evidence cannot produce a confirmation that passes.
    """

    proposal_id: str
    evidence_quote: str
    confirmed_at: str

    def __post_init__(self) -> None:
        if not self.proposal_id:
            raise ValueError("a confirmation must name the proposal it confirms")
        if not self.evidence_quote:
            raise ValueError(
                "a confirmation must carry the evidence quote the user was shown; §13.6(b) "
                "gate 3 is that the user saw the exact span, and an empty quote asserts "
                "nothing about what was on screen"
            )
        _parse_iso(self.confirmed_at, "confirmed_at")


@dataclass(frozen=True, slots=True)
class ProposalOutcome:
    """What ``create_proposal`` returns, including when it rejected the proposal.

    A rejection is a RETURN VALUE and not an exception because `0003_memory.sql` requires the
    rejected proposal to exist as a row carrying its `rejection_rule`: §13.6(d) logs the gate
    decision per write, and a rejection that raised before inserting would be a gate decision
    with no record. The caller gets `state == "auto_rejected"` and a rule name it can show.
    """

    proposal_id: str
    state: ProposalState
    rejection_rule: str | None
