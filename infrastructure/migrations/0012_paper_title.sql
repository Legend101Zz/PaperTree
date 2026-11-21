-- 0012_paper_title.sql — the name a person gave a paper (v0.3 #337: Rename on the opened book).
--
-- Forward-only, applied by packages/db/python/papertree_db/migrate.py inside ONE transaction.
-- Additive only (one new table), so no existing row is rebuilt and BACKUP_BEFORE_VERSIONS is
-- unchanged.
--
-- USER-OWNED, so it is keyed to the PAPER (paper_owners), never to a generation: a re-parse finds
-- a new `metadata.title` and the person's own name must survive it. The library reads it with a
-- LEFT JOIN and lets it win over the parsed title and the filename. No row = the parsed title,
-- the default. The 1 to 300 character rule is the API's (trimmed first), not a CHECK, so relaxing
-- it later needs no table rebuild; the CHECK only refuses a blank name.

CREATE TABLE paper_title (
  owner_id   TEXT NOT NULL,
  paper_id   TEXT NOT NULL,
  title      TEXT NOT NULL CHECK (length(trim(title)) > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, paper_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
