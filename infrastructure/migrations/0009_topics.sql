-- 0009_topics.sql — the shelf's topics and which paper sits under which (issue #193, part 1).
--
-- Forward-only, applied by packages/db/python/papertree_db/migrate.py inside ONE transaction.
-- Additive only (two new tables, one trigger), so no existing row is rebuilt and
-- BACKUP_BEFORE_VERSIONS is unchanged. 0007 (notebook) and 0008 (board) are separate branches;
-- the runner allows the gap in numbering.
--
-- A TOPIC is the person's own name for a shelf ("Transformers & attention"), optionally dyed one
-- of the six cloth colours of the design. Names are unique per owner, case-insensitively.
--
-- paper_topics holds ONE row per (owner, paper), the paper's relationship to a topic:
--   suggested  an offer (never shelved until accepted); topic_id names an existing topic, or
--              suggested_name proposes a NEW one that does not exist yet
--   accepted   the paper is shelved under topic_id; decided_at is when the person said yes
--   rejected   the person said no, or took the paper off a shelf; the row stays (topic_id = the
--              topic turned down or left) so that topic is never offered again. The API shows
--              no topic for it.
-- A paper with no row is "unshelved". The row dies with its paper (CASCADE through paper_owners).
-- Every FK between owned tables carries owner_id (0001 rule).

CREATE TABLE topics (
  topic_id   TEXT    NOT NULL PRIMARY KEY,
  owner_id   TEXT    NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  -- name.casefold(), written by papertree_db.topics: ONE Unicode-aware rule for "same name"
  -- (NOCASE would fold ASCII only: "ÀB" and "àb" would both be accepted).
  name_key   TEXT    NOT NULL,
  -- Length (1-60 characters) is enforced by the API, not a CHECK, so relaxing it needs no rebuild.
  cloth      TEXT    CHECK (cloth IS NULL OR cloth IN
                       ('transformers', 'vision', 'generative', 'optimization', 'language', 'rl')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  UNIQUE (owner_id, name_key),
  -- The target of paper_topics' composite FK: it must carry owner_id too.
  UNIQUE (owner_id, topic_id)
) STRICT;
--;;

CREATE TABLE paper_topics (
  owner_id       TEXT NOT NULL,
  paper_id       TEXT NOT NULL,
  topic_id       TEXT,
  status         TEXT NOT NULL CHECK (status IN ('suggested', 'accepted', 'rejected')),
  source         TEXT NOT NULL CHECK (source IN ('arxiv_category', 'manual', 'model')),
  -- 'cs.CL' for arxiv_category, the model id for model, NULL for manual.
  source_detail  TEXT,
  -- A NEW topic a suggestion proposes, before it exists.
  suggested_name TEXT,
  decided_at     TEXT,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (owner_id, paper_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, topic_id) REFERENCES topics (owner_id, topic_id),
  CHECK (status <> 'accepted' OR (topic_id IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'suggested' OR topic_id IS NOT NULL OR suggested_name IS NOT NULL)
) STRICT;
--;;

CREATE INDEX paper_topics_by_topic ON paper_topics (owner_id, topic_id);
--;;

-- Deleting a topic unshelves its papers instead of failing on the FK (SQLite cannot SET NULL one
-- column of a composite key whose other column is NOT NULL). Accepted placements and offers of
-- that topic are removed (the paper is "unshelved" and may be offered a shelf again); a rejection
-- is kept, without its topic, so the person's no is not forgotten. The papers' own rows, reading
-- state and highlights are never touched.
CREATE TRIGGER topics_before_delete BEFORE DELETE ON topics
BEGIN
  DELETE FROM paper_topics
   WHERE owner_id = OLD.owner_id AND topic_id = OLD.topic_id
     AND status IN ('accepted', 'suggested');
  UPDATE paper_topics SET topic_id = NULL
   WHERE owner_id = OLD.owner_id AND topic_id = OLD.topic_id;
END;
