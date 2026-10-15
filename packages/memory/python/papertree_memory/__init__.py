"""papertree_memory — the read-only agent handle and the trust boundary (F3.8).

The write side (``MemoryStore``, ``ProposalValidator`` and the record types) was deleted in S8a
(ADR-002 section 8, R13): it had no product caller and the six 0003 tables hold no rows. What
remains is the half that is a security guard: ``AgentDataHandle``, ``guard`` and ``errors``.
Sections of this docstring that describe the deleted writer are history, kept so the guard's
reasoning stays readable.

This package exists to make one sentence true in SQLite:

    §13.1: *"there is NO arrow from PAPER, SESSION or ARTEFACT memory into USER LEARNING.
    The only ingress to the trusted store is a human click or a clean-context user utterance."*

§13.4 gets that from Postgres for nothing — two roles and four ``GRANT`` statements. SQLite has
no roles, no ``GRANT`` and no ``REVOKE``, so it has to be built. Two objects, and the whole
design is which of them a caller is holding:

    AgentDataHandle    read-only, owner-bound, sqlite-vec KNN, no write method anywhere
    MemoryStore        the privileged writer; every INSERT in this package is in store.py

They share a file and nothing else. **No route from an ``AgentDataHandle`` reaches a
``MemoryStore``**: not an attribute, not a closure, not a callback, not an import.
``agent_handle.py`` does not import ``store.py``, and that is checkable rather than asserted —
`security/isolation.spec` walks the reachable object graph, closure cells included, and fails on
anything writable in it.

────────────────────────────────────────────────────────────────────────────────────────────
THE MECHANISM, AND THE MEASUREMENT THAT MADE LAYER 2 NON-OPTIONAL
────────────────────────────────────────────────────────────────────────────────────────────

Layer 1 is ``file:<path>?mode=ro``: every INSERT/UPDATE/DELETE/DDL on the main database raises.

Layer 2 is ``conn.set_authorizer`` denying ``SQLITE_ATTACH``, and it is **not** belt-and-braces.
Reproduced on this workspace (SQLite 3.53.1 / CPython 3.12.8) before a line of this package was
written: a bare ``mode=ro`` connection runs ``ATTACH DATABASE '/tmp/side.db' AS evil`` then
``CREATE TABLE evil.x(a)`` then ``INSERT``, and the file appears on disk. ``mode=ro`` constrains
the main database, not the connection's ability to acquire a second, writable one.

A second route, measured here and **not** named in the brief: ``VACUUM INTO '<path>'`` also
succeeds on a bare ``mode=ro`` connection and writes a complete copy of the database — the whole
library — to an attacker-chosen path. It is closed by the same ``SQLITE_ATTACH`` denial
(``VACUUM INTO`` attaches internally) and is **not** closed by denying ``SQLITE_PRAGMA``; both
directions were run. Neither hole is visible to an INSERT-only test, which is why
``guard.escape_routes`` names each route as data and both spec files iterate it.

Cost of layer 2, measured on the real schema: none. sqlite-vec KNN, ``GROUP BY``, ``ORDER BY``
and JSON1 all execute unchanged with the full deny set installed.

────────────────────────────────────────────────────────────────────────────────────────────
WHAT THIS PACKAGE DOES NOT CLAIM
────────────────────────────────────────────────────────────────────────────────────────────

* **Arbitrary Python in this process defeats it**, and nothing here could prevent that:
  ``set_authorizer(None)`` and ``sqlite3.connect(path)`` are both one line. The threat model
  F3.8 is written against is a compromised MODEL OUTPUT driving a tool registry — the model
  picks a listed tool and its arguments, and cannot call what is not listed. The claim is that
  every route the registry can expose is read-only. That is what the tests assert, and the gap
  is stated here rather than left for a reviewer to find.
* **Detection is not a boundary.** ``validation.py``'s imperative/URL/tool-name rules are
  §13.6(b)'s quality gate on what a human is asked to approve. §13.6(c): *"The architecture must
  hold with detection at 0% recall."* If every rule in that module returned "clean",
  `security/injection.spec` would still pass — and it is written so that this is visible.
* **``:memory:`` is refused.** A second connection to ``:memory:`` is a second, empty database,
  so a read-only handle onto one would answer every read with "no rows" — a wrong answer
  indistinguishable from a correct one. :func:`~papertree_memory.guard.open_guarded_read_only`
  raises instead. The agent handle requires a file-backed database, always.

────────────────────────────────────────────────────────────────────────────────────────────
KNOWN GAPS, NAMED
────────────────────────────────────────────────────────────────────────────────────────────

* **Evidence offsets are into ``blocks.text``, the unrepaired reading (D4).** The sanctioned
  reader is ``resolved_text`` from ``papertree_document_ir``, and using it requires this package
  to declare that dependency — a ``uv.lock`` change this package does not own. The consequence
  is fail-closed: if a repair falls inside a quoted span and the UI showed the resolved reading,
  ``create_proposal`` auto-rejects a valid proposal rather than admitting an invalid one.
* **§13.3's "purging a session must also purge proposals citing it" is not implemented.**
  ``user_learning_memory`` has a NOT NULL FK onto ``memory_proposals``, so deleting a proposal
  that was promoted would delete the trusted row's provenance. Resolving it needs a product
  decision (tombstone the proposal, or cascade the trusted row), not a code change here.
* **No TypeScript twin.** Its consumers are the Python agent runtime and the Python API. A TS
  twin would have no caller, which is findings.md §A's failure shape, and ``papertree_jobs``'
  docstring makes the same argument for the same reason.

────────────────────────────────────────────────────────────────────────────────────────────
USAGE
────────────────────────────────────────────────────────────────────────────────────────────

    # what a tool gets: read-only, owner-bound, no write method anywhere
    handle = AgentDataHandle(path, user_id)
    blocks = handle.list_blocks_in_doc_order(paper_id, generation)
"""

from __future__ import annotations

from .agent_handle import AgentDataHandle
from .errors import (
    ConfirmationMismatch,
    MemoryCapExceeded,
    PaperTreeMemoryError,
    ProposalRejected,
    TrustBoundaryViolation,
)
from .guard import (
    DENIAL_MARKERS,
    DENIED_ACTIONS,
    DENIED_FUNCTIONS,
    EscapeRoute,
    RouteProbe,
    Row,
    assert_no_escape,
    escape_routes,
    open_guarded_read_only,
    probe_escape_routes,
)

__all__ = [
    "DENIAL_MARKERS",
    "DENIED_ACTIONS",
    "DENIED_FUNCTIONS",
    "AgentDataHandle",
    "ConfirmationMismatch",
    "EscapeRoute",
    "MemoryCapExceeded",
    "PaperTreeMemoryError",
    "ProposalRejected",
    "RouteProbe",
    "Row",
    "TrustBoundaryViolation",
    "assert_no_escape",
    "escape_routes",
    "open_guarded_read_only",
    "probe_escape_routes",
]
