"""Every exception ``papertree_memory`` raises, and what each one MEANS to a caller.

There are four, and they are deliberately not interchangeable, because the three layers of
this package fail for three different reasons and a caller has to be able to tell them apart:

  * :class:`TrustBoundaryViolation` — the STRUCTURAL layer refused. Something reached a write
    route it should not have been able to reach, or a guard that is supposed to be closed was
    found open. This is a control failure or an attack, never a user error, and §13.6(d)'s
    "one alert, and it should page someone" is written against exactly this class.
  * :class:`ProposalRejected` — the POLICY layer refused (§13.6(b)'s validator). This is an
    ordinary, expected outcome and it is NOT how ``create_proposal`` reports a rejection —
    that returns a :class:`~papertree_memory.records.ProposalOutcome`, because a rejected
    proposal must still be a row. It is raised only where a rejection cannot be represented
    as a return value (``confirm_proposal`` on an already-auto-rejected proposal).
  * :class:`ConfirmationMismatch` — gate 3 of §13.6(b) refused. The confirmation handed to
    ``confirm_proposal`` did not carry the exact evidence quote stored on the proposal, so we
    cannot claim the human was shown what they were asked to approve.
  * :class:`MemoryCapExceeded` — the RETENTION layer refused. §13.4's ~100 KB / 200-record cap
    on user-learning memory, which `0003_memory.sql` says out loud it cannot express (a SQLite
    CHECK cannot see other rows) and which therefore has to live here or nowhere.

``OwnershipError`` is deliberately NOT redefined here. It is ``papertree_db``'s, and a second
spelling of "you are not the owner" is how this repo ended up with two ``Highlight`` types
(findings.md §G5).
"""

from __future__ import annotations


class PaperTreeMemoryError(Exception):
    """Base class, so a caller can catch everything this package raises in one clause."""


class TrustBoundaryViolation(PaperTreeMemoryError):
    """A structural guard was reached, or was found open when it should have been shut.

    Carries the ROUTE NAME rather than only a message, because the audit row written for a
    denial records the route and an unstructured string cannot be indexed or alerted on.
    """

    def __init__(self, route: str, detail: str) -> None:
        super().__init__(f"{route}: {detail}")
        self.route = route
        self.detail = detail


class ProposalRejected(PaperTreeMemoryError):
    """A proposal failed §13.6(b) validation and cannot be promoted."""

    def __init__(self, proposal_id: str, rule: str) -> None:
        super().__init__(f"proposal {proposal_id} was rejected by rule {rule!r}")
        self.proposal_id = proposal_id
        self.rule = rule


class ConfirmationMismatch(PaperTreeMemoryError):
    """The user confirmation does not match the proposal it claims to confirm.

    Raised when the quote carried by the confirmation is not byte-identical to the proposal's
    stored ``evidence_quote``. §13.6(b) gate 3 is "a UI confirmation that shows the user the
    exact quote the proposal was derived from"; a confirmation that cannot reproduce that quote
    is not evidence the user saw it, so the promotion is refused rather than trusted.
    """


class MemoryCapExceeded(PaperTreeMemoryError):
    """The write would push user-learning memory past §13.4's hard cap.

    §13.7 rec. 7: the response to hitting this is consolidation and expiry, never a bigger cap.
    Auditability by a human in a couple of minutes is the property the cap protects.
    """

    def __init__(self, kind: str, current: int, limit: int) -> None:
        super().__init__(
            f"user-learning memory {kind} cap exceeded: {current} would exceed the limit {limit}"
        )
        self.kind = kind
        self.current = current
        self.limit = limit
