-- 0007 (v0.2, S5a, #206): the notebook. Pages, the items placed on them, and ink strokes.
--
-- Numbered 0007 because 0006 is reading state (S2a), built in parallel. The runner applies by
-- version, so a gap is fine and neither slice depends on the other.
--
-- Three NEW tables, nothing rebuilt, so this version is NOT in BACKUP_BEFORE_VERSIONS.
-- Every FK between owned tables carries owner_id (0005 rule); ids are client-minted; a quote
-- card stores the full Anchor, never a bare block id (AGENTS.md section 4).
CREATE TABLE notebook_pages (
  page_id           TEXT    PRIMARY KEY,
  owner_id          TEXT    NOT NULL,
  paper_id          TEXT    NOT NULL,
  title             TEXT    NOT NULL,
  template          TEXT    NOT NULL DEFAULT 'dot'
                    CHECK (template IN ('blank', 'dot', 'lined', 'cornell', 'derivation')),
  -- Where "Dive in" started. Plain columns, not FKs: deleting the thread must not delete the page.
  source_thread_id  TEXT,
  source_message_id TEXT,
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  UNIQUE (owner_id, page_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE TABLE notebook_items (
  item_id     TEXT    PRIMARY KEY,
  owner_id    TEXT    NOT NULL,
  page_id     TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('exchange', 'text', 'sticky', 'quote', 'shape')),
  x           REAL    NOT NULL,
  y           REAL    NOT NULL,
  w           REAL    NOT NULL CHECK (w > 0),
  h           REAL    NOT NULL CHECK (h > 0),
  z           INTEGER NOT NULL DEFAULT 0,
  -- text / sticky: the typed text. exchange / shape: JSON. quote: the display cache of the passage.
  body        TEXT    NOT NULL DEFAULT '',
  anchor_json TEXT    CHECK (anchor_json IS NULL OR json_valid(anchor_json)),
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  CHECK (kind <> 'quote' OR anchor_json IS NOT NULL),
  UNIQUE (owner_id, item_id),
  FOREIGN KEY (owner_id, page_id) REFERENCES notebook_pages (owner_id, page_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE TABLE notebook_strokes (
  stroke_id  TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  page_id    TEXT NOT NULL,
  tool       TEXT NOT NULL CHECK (tool IN ('pen', 'highlighter')),
  nib        TEXT NOT NULL CHECK (nib IN ('EF', 'F', 'M')),
  colour     TEXT NOT NULL,                  -- a token name such as 'pen' or 'hl-amber', never a hex
  points     BLOB NOT NULL,                  -- the web's encodeStroke bytes; the API never decodes
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, stroke_id),
  FOREIGN KEY (owner_id, page_id) REFERENCES notebook_pages (owner_id, page_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX notebook_pages_by_paper ON notebook_pages (owner_id, paper_id, updated_at);
--;;
CREATE INDEX notebook_items_by_page ON notebook_items (owner_id, page_id);
--;;
CREATE INDEX notebook_strokes_by_page ON notebook_strokes (owner_id, page_id, created_at);
