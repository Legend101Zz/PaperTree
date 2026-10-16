-- 0006_library.sql — what the v0.2 library needs the server to remember (issue #192).
--
-- Forward-only, applied by packages/db/python/papertree_db/migrate.py inside ONE transaction.
-- Additive only: one new table and one nullable column, so no existing row is rebuilt and no
-- pre-migration backup is needed (BACKUP_BEFORE_VERSIONS stays {5}).
--
-- reading_state is USER-OWNED, so it is keyed to the PAPER (paper_owners), never to a generation,
-- and it dies only with the paper. Every FK between owned tables carries owner_id (0001 rule).
-- Pages are zero-based, as the reader writes them. There is no anchor column on purpose: the
-- reader keeps its exact place locally, and a stored place would have to be an Anchor.

CREATE TABLE reading_state (
  owner_id      TEXT    NOT NULL,
  paper_id      TEXT    NOT NULL,
  last_page     INTEGER NOT NULL CHECK (last_page >= 0),
  -- The furthest page ever reached. It only grows (papertree_db.reading), and it is what decides
  -- "finished": scrolling back to page 2 must not un-finish a paper.
  furthest_page INTEGER NOT NULL CHECK (furthest_page >= last_page),
  mode          TEXT    CHECK (mode IS NULL OR mode IN ('source', 'guided', 'split')),
  opened_at     TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  -- Set by the progress rule or explicitly; never cleared by a later write.
  finished_at   TEXT,
  PRIMARY KEY (owner_id, paper_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
--;;

-- Nullable; 1-60 characters is enforced by the API, not a CHECK, so relaxing it later needs no
-- table rebuild. Never derived from the email.
ALTER TABLE users ADD COLUMN display_name TEXT;
