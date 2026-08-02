-- 0003_memory.sql — agent memory stores (EPIC-03 F3.7) and the trust boundary they carry (F3.8).
--
-- OWNERSHIP NOTE. infrastructure/migrations/ is Epic 0's. This file is the one edit outside
-- Epic 3's declared paths that the epic could not avoid: F3.7 is "paper / session /
-- user-learning / artefact stores", a forward-only migration system has no other way to add a
-- table, and 0001_core.sql has none of them. Same shape as Epic 1's #45, and filed as an issue
-- rather than done quietly. Nothing in 0001 or 0002 is edited — editing an applied migration is
-- what the recorded checksum exists to refuse.
--
-- Statements are separated by a line containing only `--;;` (migrate.ts `splitStatements`).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THESE FIVE TABLES, AND WHY user_learning_memory IS SHAPED DIFFERENTLY
--
-- research/synthesis-13-memory.md §13.1 fixes four stores with different trust labels, and one
-- load-bearing property of its diagram:
--
--     there is NO arrow from PAPER, SESSION or ARTEFACT memory into USER LEARNING.
--
-- The only ingress to the trusted store is a human click or a clean-context user utterance.
-- §13.1 puts that on "a separate DB role"; SQLite has no roles and no GRANT, so the equivalent
-- has to be built out of what SQLite does have. It is built in packages/memory, in two layers,
-- and BOTH are load-bearing:
--
--   1. The agent's handle opens `file:<path>?mode=ro` — every INSERT/UPDATE/DELETE on the main
--      database fails with "attempt to write a readonly database".
--
--   2. An sqlite3 authorizer additionally denies SQLITE_ATTACH.
--
-- Layer 2 is NOT belt-and-braces. Measured against this workspace's own Python and SQLite:
-- a mode=ro connection can still `ATTACH DATABASE '/tmp/side.db' AS evil` and then
-- `CREATE TABLE evil.x(a)` — mode=ro constrains the main database, not the connection's ability
-- to acquire a writable second one. An implementation that stops at layer 1 has a hole that no
-- INSERT-only test can see. security/injection.spec asserts the ATTACH route by name.
--
-- WHAT THE SCHEMA ITSELF CONTRIBUTES. A schema cannot express "this connection may not write
-- this table" — that is why the guard is in packages/memory rather than here. What the schema
-- CAN do, and does:
--
--   * user_learning_memory carries `confirmed_at` and `confirmed_by` NOT NULL. There is no such
--     thing as an unconfirmed row: a write with no human confirmation is not merely against
--     policy, it violates a CHECK. An agent that somehow reached a writable connection would
--     still have to forge a confirmation timestamp AND a proposal id that resolves.
--   * Its FK to memory_proposals means every trusted row names the proposal it was promoted
--     from, and that proposal carries the verbatim evidence span the user was shown (§13.6b's
--     gate 2 and 3). A trusted row whose provenance cannot be displayed cannot be inserted.
--   * Ownership follows 0001's rule exactly: owner_id NOT NULL everywhere, and every FK between
--     owned tables is composite and includes owner_id, so packages/db/test/ownership.spec's
--     PRAGMA foreign_key_list audit covers these tables the day they land.
--
-- F3.7 requires every agent-written record to carry provenance, timestamp, source session,
-- confidence, version, and to be user-editable. Those are the five columns repeated across the
-- agent-writable stores, and `updated_at` is what makes "user-editable" a fact about the data
-- rather than a promise about the UI.
-- ─────────────────────────────────────────────────────────────────────────────

-- paper_memory — derived document facts for ONE parse generation: section summaries, symbol
-- glossary entries, figure/equation notes. Trust label `untrusted`: it is derived from the PDF,
-- which is attacker-controlled, so it is never promoted and never treated as authority.
--
-- Scoped to (owner_id, paper_id, generation) rather than to paper_id, because a re-parse
-- produces generation N+1 whose block ids may differ, and a summary that cites blocks from
-- generation 1 is not valid for generation 2. Cascading from `papers` is what makes that
-- automatic.
--
-- `derived_from` mirrors derivations.derived_from and carries the same minItems 1 CHECK: a
-- memory record that cannot point at a source block is ungrounded, which is the v1 defect
-- (findings.md C4). It is a JSON array of block_ids and is deliberately NOT a foreign key —
-- block ids are content-derived and a repair can retire one, so an FK here would delete
-- history rather than mark it stale.
CREATE TABLE paper_memory (
  memory_id     TEXT    PRIMARY KEY,
  owner_id      TEXT    NOT NULL,
  paper_id      TEXT    NOT NULL,
  generation    INTEGER NOT NULL,
  kind          TEXT    NOT NULL,
  content       TEXT    NOT NULL CHECK (json_valid(content)),
  derived_from  TEXT    NOT NULL
                  CHECK (json_valid(derived_from) AND json_array_length(derived_from) >= 1),
  -- The four stores' labels from §13.1's table. CHECKed rather than documented so a record
  -- cannot acquire a trust it was not created with.
  trust_label   TEXT    NOT NULL CHECK (trust_label = 'untrusted'),
  provenance    TEXT    NOT NULL CHECK (json_valid(provenance)),
  source_session TEXT,
  confidence    REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  version       INTEGER NOT NULL CHECK (version >= 1),
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  UNIQUE (owner_id, memory_id),
  FOREIGN KEY (owner_id, paper_id, generation)
    REFERENCES papers (owner_id, paper_id, generation) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX paper_memory_by_paper ON paper_memory (owner_id, paper_id, generation, kind);
--;;

-- session_memory — what the agent learned during ONE conversation. §13.1: retention 90 days,
-- trust label `tainted`, and "cannot be promoted".
--
-- "Cannot be promoted" is enforced by absence: there is no column here that user_learning_memory
-- will accept, and no code path in packages/memory that reads this table and writes that one.
-- The taint is sticky because the label is CHECKed to a single value — a row cannot be
-- relabelled by an UPDATE that a compromised caller might attempt.
CREATE TABLE session_memory (
  memory_id      TEXT    PRIMARY KEY,
  owner_id       TEXT    NOT NULL,
  session_id     TEXT    NOT NULL,
  paper_id       TEXT,
  generation     INTEGER,
  kind           TEXT    NOT NULL,
  content        TEXT    NOT NULL CHECK (json_valid(content)),
  trust_label    TEXT    NOT NULL CHECK (trust_label = 'tainted'),
  provenance     TEXT    NOT NULL CHECK (json_valid(provenance)),
  source_session TEXT    NOT NULL,
  confidence     REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  version        INTEGER NOT NULL CHECK (version >= 1),
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  expires_at     TEXT    NOT NULL,
  UNIQUE (owner_id, memory_id),
  -- paper_id and generation are optional (a session need not be about a paper), but if one is
  -- present both must be — a half-scoped row cannot be joined and cannot be cascaded.
  CHECK ((paper_id IS NULL) = (generation IS NULL)),
  FOREIGN KEY (owner_id) REFERENCES users (user_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX session_memory_by_session ON session_memory (owner_id, session_id, created_at);
--;;

-- artefact_memory — generated artefacts (explanations, narrations, canvas nodes) as CONTENT
-- ONLY. §13.1 labels it `derived_untrusted`: it came out of a model that had read the paper, so
-- it inherits the paper's taint and never gains authority by being written down.
--
-- `derived_from` is required and non-empty for the same reason as paper_memory.
CREATE TABLE artefact_memory (
  memory_id     TEXT    PRIMARY KEY,
  owner_id      TEXT    NOT NULL,
  paper_id      TEXT    NOT NULL,
  generation    INTEGER NOT NULL,
  kind          TEXT    NOT NULL,
  content       TEXT    NOT NULL CHECK (json_valid(content)),
  derived_from  TEXT    NOT NULL
                  CHECK (json_valid(derived_from) AND json_array_length(derived_from) >= 1),
  trust_label   TEXT    NOT NULL CHECK (trust_label = 'derived_untrusted'),
  provenance    TEXT    NOT NULL CHECK (json_valid(provenance)),
  source_session TEXT,
  confidence    REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  version       INTEGER NOT NULL CHECK (version >= 1),
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  UNIQUE (owner_id, memory_id),
  FOREIGN KEY (owner_id, paper_id, generation)
    REFERENCES papers (owner_id, paper_id, generation) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX artefact_memory_by_paper ON artefact_memory (owner_id, paper_id, generation, kind);
--;;

-- memory_proposals — the queue, and the ONLY route from anything the agent produced towards the
-- trusted store. §13.6(b)'s gate is all three of: no INSERT grant for the agent, a proposal row
-- carrying the verbatim evidence span and its paper_id/offsets, and a UI confirmation that shows
-- the user that exact quote before they accept.
--
-- Note what this table is NOT: it is not written by the agent either. The agent's connection is
-- read-only, so it cannot write here any more than it can write user_learning_memory. A
-- proposal is created by the privileged runtime FROM the agent's schema-validated structured
-- output. That is strictly stronger than §13.1's "agent may write proposals" and costs nothing.
--
-- evidence_quote/evidence_block_id/evidence_char_start/end are NOT NULL because a proposal the
-- user cannot be shown the source of is a proposal the user cannot meaningfully accept. The
-- confirmation UI has no fallback rendering for a missing quote, by design.
CREATE TABLE memory_proposals (
  proposal_id         TEXT    PRIMARY KEY,
  owner_id            TEXT    NOT NULL,
  paper_id            TEXT    NOT NULL,
  generation          INTEGER NOT NULL,
  session_id          TEXT    NOT NULL,
  kind                TEXT    NOT NULL,
  content             TEXT    NOT NULL CHECK (json_valid(content)),
  -- The verbatim span the proposal was derived from — gate 2. Attacker-controlled by
  -- definition, so it is rendered as quoted evidence and never as instruction.
  evidence_block_id   TEXT    NOT NULL,
  evidence_quote      TEXT    NOT NULL,
  evidence_char_start INTEGER NOT NULL CHECK (evidence_char_start >= 0),
  evidence_char_end   INTEGER NOT NULL,
  -- Why the validator let it through, or the rule that rejected it. §13.6(b): proposals are
  -- rejected for imperative language, URLs, tool names, or exceeding the length cap.
  state               TEXT    NOT NULL
                        CHECK (state IN ('pending', 'accepted', 'rejected', 'auto_rejected')),
  rejection_rule      TEXT,
  model_id            TEXT    NOT NULL,
  prompt_hash         TEXT    NOT NULL,
  created_at          TEXT    NOT NULL,
  decided_at          TEXT,
  UNIQUE (owner_id, proposal_id),
  CHECK (evidence_char_start <= evidence_char_end),
  -- A decided proposal has a decision time; a pending one does not. Keeps "accepted with no
  -- timestamp" out of the audit trail.
  CHECK ((state = 'pending') = (decided_at IS NULL)),
  -- auto_rejected is the only state that may carry a rule, and it must.
  CHECK ((rejection_rule IS NOT NULL) = (state = 'auto_rejected')),
  FOREIGN KEY (owner_id, paper_id, generation)
    REFERENCES papers (owner_id, paper_id, generation) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX memory_proposals_pending
  ON memory_proposals (owner_id, state, created_at) WHERE state = 'pending';
--;;

-- user_learning_memory — the TRUSTED store. §13.1: "Agent may write: Never."
--
-- Everything unusual about this table is that sentence made structural.
--
--   * trust_label is CHECKed to 'trusted' alone, so a tainted row cannot be inserted even by a
--     caller holding a writable connection.
--   * confirmed_at and confirmed_by are NOT NULL: there is no representable unconfirmed row.
--   * source_proposal_id is NOT NULL with an FK, so every row names the proposal it was
--     promoted from, and that proposal carries the evidence the user was shown. A row whose
--     provenance cannot be displayed cannot exist.
--   * There is no `derived_from` here on purpose. Deriving a user preference from the paper is
--     precisely the attack (§13.6(e) attack 1, MINJA's model). The provenance of a trusted row
--     is a human decision, not a block id.
--
-- §13.1's hard cap of ~100 KB per user is enforced in packages/memory rather than here: SQLite
-- CHECK constraints cannot see other rows, so a per-user aggregate cap is not expressible.
-- That is stated rather than silently dropped.
CREATE TABLE user_learning_memory (
  memory_id          TEXT    PRIMARY KEY,
  owner_id           TEXT    NOT NULL,
  kind               TEXT    NOT NULL,
  content            TEXT    NOT NULL CHECK (json_valid(content)),
  trust_label        TEXT    NOT NULL CHECK (trust_label = 'trusted'),
  provenance         TEXT    NOT NULL CHECK (json_valid(provenance)),
  confidence         REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  version            INTEGER NOT NULL CHECK (version >= 1),
  source_proposal_id TEXT    NOT NULL,
  confirmed_at       TEXT    NOT NULL,
  -- Who clicked. 'user' is the only value the promotion path writes; the CHECK is what stops a
  -- future caller inventing 'agent' or 'system'.
  confirmed_by       TEXT    NOT NULL CHECK (confirmed_by = 'user'),
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  reconfirm_due      TEXT    NOT NULL,
  UNIQUE (owner_id, memory_id),
  FOREIGN KEY (owner_id) REFERENCES users (user_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, source_proposal_id)
    REFERENCES memory_proposals (owner_id, proposal_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX user_learning_by_owner ON user_learning_memory (owner_id, kind);
--;;

-- memory_audit — §13.6(d)'s per-write stream, append-only.
--
-- "Append-only" is enforced by two triggers rather than by convention, because the value of an
-- audit log is exactly its resistance to the caller who most wants to edit it. SQLite has no
-- table-level permissions, but RAISE(ABORT) in a BEFORE trigger is absolute: there is no
-- statement, pragma or connection mode that bypasses it.
--
-- §13.6(d)'s alert condition — "any INSERT or UPDATE on the trusted store where trust_label <>
-- 'trusted' or the actor is not the API" — is unrepresentable here by construction, since both
-- are CHECKed on user_learning_memory itself. What this table records is the decision trail:
-- which gate ran, what it decided, and which proposal it was about.
CREATE TABLE memory_audit (
  audit_id      TEXT    PRIMARY KEY,
  owner_id      TEXT    NOT NULL,
  store         TEXT    NOT NULL
                  CHECK (store IN ('paper', 'session', 'user_learning', 'artefact', 'proposal')),
  memory_id     TEXT,
  actor         TEXT    NOT NULL CHECK (actor IN ('user', 'agent', 'system')),
  action        TEXT    NOT NULL
                  CHECK (action IN ('write', 'update', 'delete', 'propose', 'accept',
                                    'reject', 'auto_reject', 'denied')),
  trust_label   TEXT    NOT NULL,
  source_paper  TEXT,
  source_session TEXT,
  gate_decision TEXT    NOT NULL,
  detail        TEXT    NOT NULL CHECK (json_valid(detail)),
  created_at    TEXT    NOT NULL,
  UNIQUE (owner_id, audit_id),
  FOREIGN KEY (owner_id) REFERENCES users (user_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX memory_audit_by_owner ON memory_audit (owner_id, created_at);
--;;
CREATE TRIGGER memory_audit_is_append_only_update BEFORE UPDATE ON memory_audit
BEGIN
  SELECT RAISE(ABORT, 'memory_audit is append-only: UPDATE is not permitted');
END;
--;;
-- The DELETE guard is CONDITIONAL, and the condition is the whole point.
--
-- Measured, because the obvious unconditional version is wrong in a way no test of the audit
-- table would catch: a plain `BEFORE DELETE ... RAISE(ABORT)` also fires for the ON DELETE
-- CASCADE from `users`, so erasing a user raises 'append-only' and GDPR erasure becomes
-- impossible. An append-only log that cannot be erased is not a stricter log, it is a
-- compliance defect — and it would have surfaced as a failing user-deletion test in some later
-- epic, far from here.
--
-- `WHEN EXISTS (SELECT 1 FROM users ...)` separates the two cases exactly, because SQLite
-- removes the parent row before running the child cascade:
--
--   * direct DELETE  — the owning user still exists, WHEN is true, ABORT.
--   * erasure cascade — the users row is already gone, WHEN is false, the row goes with it.
--
-- Verified both directions, plus that a second user's rows survive the first user's erasure and
-- remain immutable afterwards.
CREATE TRIGGER memory_audit_is_append_only_delete BEFORE DELETE ON memory_audit
WHEN EXISTS (SELECT 1 FROM users WHERE user_id = old.owner_id)
BEGIN
  SELECT RAISE(ABORT, 'memory_audit is append-only: DELETE is not permitted');
END;
