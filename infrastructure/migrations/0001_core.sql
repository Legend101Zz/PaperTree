-- 0001_core.sql — PaperTree v2 core schema (EPIC-00 F0.5).
--
-- ONE SOURCE OF TRUTH. Both the TypeScript runner (packages/db/src/migrate.ts) and the
-- Python runner (packages/db/python/papertree_db/migrate.py) read THIS file. Neither
-- language holds a second copy of the DDL, so the two cannot drift.
--
-- Forward-only. Never edit an applied migration: the runner records a checksum and
-- refuses to run against a database whose recorded checksum differs.
--
-- Statements are separated by a line containing only `--;;` (see migrate.ts
-- `splitStatements`). A naive split on ';' would cut TRIGGER bodies in half.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE KEYS LOOK LIKE THIS
--
-- 1. GENERATIONS (DESIGN.md D13). Block ids are CONTENT-DERIVED, so an unchanged
--    block has the SAME id in generation 1 and generation 2 — that is their entire
--    purpose. Therefore ADR-001's `blocks(block_id PRIMARY KEY)` collides outright the
--    first time the rollback plan is exercised, and its `papers(source_hash UNIQUE)`
--    makes two generations of one PDF unstorable. Everything derived from a parse is
--    keyed on (paper_id, generation, …).
--
-- 2. OWNERSHIP (findings.md §F). Every owned table carries `owner_id NOT NULL`, and
--    EVERY foreign key between owned tables is COMPOSITE AND INCLUDES owner_id. That is
--    the structural claim: an anchor cannot reference a block with a different owner_id,
--    a highlight cannot reference another owner's paper, and a derivation's
--    parent_derivation_id cannot leave the owner — not by convention, but because the
--    INSERT raises FOREIGN KEY constraint failed. It also means every join key is
--    owner-qualified, so a join that "forgot" the owner filter on a joined table (the
--    findings.md §F3 bug class) cannot cross tenants either.
--    packages/db/test/ownership.spec.ts asserts this property by reading
--    PRAGMA foreign_key_list, so a future migration cannot quietly drop it.
--
-- 3. STRICT tables everywhere SQLite allows them, so a REAL written into an INTEGER
--    column is an error rather than a silent affinity conversion.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE users (
  user_id    TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
--;;
CREATE UNIQUE INDEX users_email_unique ON users (email);
--;;

-- paper_owners — the identity anchor for a PDF, independent of how many times it has
-- been parsed. A paper_id is minted ONCE per (owner, source_hash) and held fixed across
-- every re-parse (generated types: PaperId, "minted ONCE per source_hash"), so its owner
-- and its source_hash belong here rather than being repeated per generation.
--
-- UNIQUE(owner_id, source_hash) is ADR-001's `papers(source_hash UNIQUE)` dedup —
-- CORRECTED IN TWO WAYS. (a) It is per-tenant: a global source_hash unique would let one
-- tenant's upload block another's, and would leak the existence of another tenant's
-- document through a constraint violation — the exact failure class F0.5 exists to make
-- impossible. (b) It sits above the generation axis, so it dedupes the PDF rather than
-- the parse, which `UNIQUE(source_hash, generation)` cannot do (that constraint permits
-- two paper_ids for one PDF as long as their generations differ).
CREATE TABLE paper_owners (
  paper_id    TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (owner_id, paper_id),
  UNIQUE (owner_id, source_hash)
) STRICT;
--;;
CREATE INDEX paper_owners_by_owner ON paper_owners (owner_id);
--;;

-- papers — ONE PARSE GENERATION of one PDF. Immutable once written (Paper is immutable;
-- a re-parse writes generation N+1 alongside N). Which generation is PROMOTED is mutable
-- state and deliberately not here — see paper_promotions (DESIGN.md D13/R13).
--
-- Paper.sections and Paper.references are required arrays with no table of their own in
-- the F0.5 list; DESIGN.md §10 says "add either two tables or two JSON columns". They are
-- MATERIALISED VIEWS over blocks ("derived, never authoritative: if it disagrees with the
-- blocks, the blocks win"), so they are stored as JSON columns — normalising a derived
-- view into tables invites querying it as if it were authoritative.
-- Page.flows is NOT stored: DESIGN.md §10 says it is reconstructable from
-- blocks(page_index, flow, "order") filtered to top-level blocks and should not be.
CREATE TABLE papers (
  owner_id           TEXT    NOT NULL,
  paper_id           TEXT    NOT NULL,
  generation         INTEGER NOT NULL CHECK (generation >= 1),
  source_hash        TEXT    NOT NULL,
  ir_version         TEXT    NOT NULL,
  coordinate_space   TEXT    NOT NULL CHECK (coordinate_space = 'pdf_user_space_topleft'),
  parser_name        TEXT    NOT NULL,
  parser_version     TEXT    NOT NULL,
  parser_config_hash TEXT    NOT NULL,
  parser_profile     TEXT,
  parsed_at          TEXT    NOT NULL,
  status             TEXT    NOT NULL CHECK (status IN ('partial', 'complete', 'failed')),
  partial_reason     TEXT,
  metadata           TEXT    NOT NULL CHECK (json_valid(metadata)),
  sections           TEXT    NOT NULL CHECK (json_valid(sections)),
  references_json    TEXT    NOT NULL CHECK (json_valid(references_json)),
  confidence         TEXT    NOT NULL CHECK (json_valid(confidence)),
  created_at         TEXT    NOT NULL,
  PRIMARY KEY (paper_id, generation),
  -- D13, per-tenant: two generations of one PDF are storable, two PDFs are not conflated.
  UNIQUE (owner_id, source_hash, generation),
  -- The composite FK target every child table below points at. This is what makes
  -- "child.owner_id must equal papers.owner_id" a database constraint.
  UNIQUE (owner_id, paper_id, generation),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX papers_by_owner ON papers (owner_id, created_at DESC);
--;;

-- paper_promotions — the promoted generation. Mutable state that packages/db owns because
-- the PaperIR document is immutable and recording promotion inside it would guarantee a
-- stale field (DESIGN.md R13). The composite FK means you can only promote a generation
-- that exists AND that you own.
CREATE TABLE paper_promotions (
  owner_id    TEXT    NOT NULL,
  paper_id    TEXT    NOT NULL,
  generation  INTEGER NOT NULL,
  promoted_at TEXT    NOT NULL,
  PRIMARY KEY (owner_id, paper_id),
  FOREIGN KEY (owner_id, paper_id, generation)
    REFERENCES papers (owner_id, paper_id, generation) ON DELETE CASCADE
) STRICT;
--;;

-- pages. crop_box is always [0, 0, width, height] in this coordinate space (D23) but is
-- stored anyway: it is a field of the document and rule G4 is a check on stored data, not
-- an excuse to drop it. media_box coordinates are frequently NEGATIVE and that is correct.
CREATE TABLE pages (
  owner_id       TEXT    NOT NULL,
  paper_id       TEXT    NOT NULL,
  generation     INTEGER NOT NULL,
  page_id        TEXT    NOT NULL,
  page_index     INTEGER NOT NULL CHECK (page_index >= 0),
  width          REAL    NOT NULL,
  height         REAL    NOT NULL,
  rotation       INTEGER NOT NULL CHECK (rotation IN (0, 90, 180, 270)),
  user_unit      REAL    NOT NULL,
  crop_box       TEXT    NOT NULL CHECK (json_valid(crop_box)),
  media_box      TEXT    NOT NULL CHECK (json_valid(media_box)),
  image          TEXT             CHECK (image IS NULL OR json_valid(image)),
  has_text_layer INTEGER NOT NULL CHECK (has_text_layer IN (0, 1)),
  is_scanned     INTEGER NOT NULL CHECK (is_scanned IN (0, 1)),
  confidence     REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY (paper_id, generation, page_index),
  UNIQUE (paper_id, generation, page_id),
  FOREIGN KEY (owner_id, paper_id, generation)
    REFERENCES papers (owner_id, paper_id, generation) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX pages_by_owner ON pages (owner_id, paper_id, generation, page_index);
--;;

-- blocks — the addressable unit. Keyed (paper_id, generation, block_id) because
-- content-derived ids repeat across generations by design (D13).
--
-- bbox is exploded into four REAL columns rather than kept as JSON: it exists purely for
-- cheap indexing and hit-testing, and a JSON bbox can be neither indexed nor range-scanned.
-- polygon stays JSON — it is 3..512 points and is never a query predicate.
CREATE TABLE blocks (
  owner_id        TEXT    NOT NULL,
  paper_id        TEXT    NOT NULL,
  generation      INTEGER NOT NULL,
  block_id        TEXT    NOT NULL,
  page_index      INTEGER NOT NULL CHECK (page_index >= 0),
  type            TEXT    NOT NULL,
  flow            TEXT    NOT NULL
                    CHECK (flow IN ('body', 'caption', 'footnote', 'header', 'footer', 'margin')),
  "order"         INTEGER NOT NULL,
  doc_order       INTEGER,
  parent_id       TEXT,
  prev_id         TEXT,
  next_id         TEXT,
  child_ids       TEXT             CHECK (child_ids IS NULL OR json_valid(child_ids)),
  polygon         TEXT    NOT NULL CHECK (json_valid(polygon)),
  bbox_x0         REAL    NOT NULL,
  bbox_y0         REAL    NOT NULL,
  bbox_x1         REAL    NOT NULL,
  bbox_y1         REAL    NOT NULL,
  text            TEXT,
  text_normalised TEXT,
  content_hash    TEXT,
  spans           TEXT             CHECK (spans IS NULL OR json_valid(spans)),
  payload         TEXT             CHECK (payload IS NULL OR json_valid(payload)),
  -- SourceKind is a CLOSED enum with no model/LLM member: that is what makes AI-authored
  -- text in a source field unrepresentable rather than merely discouraged. The CHECK
  -- carries that guarantee down into storage. Model-authored content lives in
  -- `derivations` and nowhere else.
  source          TEXT    NOT NULL
                    CHECK (source IN ('pdf_text_layer', 'pdf_vector', 'pdf_raster', 'ocr')),
  confidence      REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  provenance      TEXT    NOT NULL CHECK (json_valid(provenance)),
  repairs         TEXT             CHECK (repairs IS NULL OR json_valid(repairs)),
  alternatives    TEXT             CHECK (alternatives IS NULL OR json_valid(alternatives)),
  PRIMARY KEY (paper_id, generation, block_id),
  -- FK target for anchors: an anchor's block must belong to the anchor's owner.
  UNIQUE (owner_id, paper_id, generation, block_id),
  FOREIGN KEY (owner_id, paper_id, generation)
    REFERENCES papers (owner_id, paper_id, generation) ON DELETE CASCADE
) STRICT;
--;;
-- Reading order (Guided view, TTS).
CREATE INDEX blocks_doc_order ON blocks (owner_id, paper_id, generation, doc_order)
  WHERE doc_order IS NOT NULL;
--;;
-- Page rendering.
CREATE INDEX blocks_page_render ON blocks (owner_id, paper_id, generation, page_index, flow, "order");
--;;
-- Subtree fetch (table cells under a table, paragraphs under a heading).
CREATE INDEX blocks_by_parent ON blocks (owner_id, paper_id, generation, parent_id)
  WHERE parent_id IS NOT NULL;
--;;
-- Anchoring tier 2: find a block by content when its id changed under a re-parse.
CREATE INDEX blocks_content_hash ON blocks (owner_id, paper_id, generation, content_hash)
  WHERE content_hash IS NOT NULL;
--;;

-- relations. Identity is (type, from, to) within a generation — a relation carries no id
-- and cannot be duplicated.
CREATE TABLE relations (
  owner_id   TEXT    NOT NULL,
  paper_id   TEXT    NOT NULL,
  generation INTEGER NOT NULL,
  type       TEXT    NOT NULL,
  from_block TEXT    NOT NULL,
  to_block   TEXT    NOT NULL,
  confidence REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  provenance TEXT    NOT NULL,
  PRIMARY KEY (paper_id, generation, type, from_block, to_block),
  FOREIGN KEY (owner_id, paper_id, generation)
    REFERENCES papers (owner_id, paper_id, generation) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX relations_from ON relations (owner_id, paper_id, generation, from_block);
--;;
CREATE INDEX relations_to ON relations (owner_id, paper_id, generation, to_block);
--;;

-- highlights — findings.md §F1 is the reason this table exists in Epic 0 at all: the v1
-- system read AND WROTE another user's highlight because two queries filtered on _id only.
-- Here a highlight is reachable only through (owner_id, highlight_id), and it cannot be
-- attached to a paper its owner does not own.
CREATE TABLE highlights (
  highlight_id TEXT    PRIMARY KEY,
  owner_id     TEXT    NOT NULL,
  paper_id     TEXT    NOT NULL,
  generation   INTEGER NOT NULL,
  color        TEXT    NOT NULL,
  note         TEXT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  UNIQUE (owner_id, highlight_id),
  FOREIGN KEY (owner_id, paper_id, generation)
    REFERENCES papers (owner_id, paper_id, generation) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX highlights_by_paper ON highlights (owner_id, paper_id, generation, created_at);
--;;

-- anchors — the multi-selector anchor (ADR-001 §E.2: content hash, text quote, geometric
-- fallback; tier 1 = block_id, and a tier-1 hit MUST be confirmed against content_hash).
-- One highlight has one or more anchors.
--
-- The two composite FKs are the point: an anchor's owner must own BOTH its highlight and
-- its block. There is no INSERT that produces a cross-tenant anchor.
CREATE TABLE anchors (
  anchor_id    TEXT    PRIMARY KEY,
  owner_id     TEXT    NOT NULL,
  highlight_id TEXT    NOT NULL,
  paper_id     TEXT    NOT NULL,
  generation   INTEGER NOT NULL,
  block_id     TEXT    NOT NULL,
  tier         INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
  char_start   INTEGER,
  char_end     INTEGER,
  text_quote   TEXT,
  quote_prefix TEXT,
  quote_suffix TEXT,
  content_hash TEXT,
  polygon      TEXT    NOT NULL CHECK (json_valid(polygon)),
  bbox_x0      REAL    NOT NULL,
  bbox_y0      REAL    NOT NULL,
  bbox_x1      REAL    NOT NULL,
  bbox_y1      REAL    NOT NULL,
  resolved_at  TEXT    NOT NULL,
  UNIQUE (owner_id, anchor_id),
  CHECK (char_start IS NULL OR char_end IS NULL OR char_start <= char_end),
  FOREIGN KEY (owner_id, highlight_id)
    REFERENCES highlights (owner_id, highlight_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, paper_id, generation, block_id)
    REFERENCES blocks (owner_id, paper_id, generation, block_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX anchors_by_highlight ON anchors (owner_id, highlight_id);
--;;
CREATE INDEX anchors_by_block ON anchors (owner_id, paper_id, generation, block_id);
--;;

-- derivations — the ONE place model-authored content may live. author_kind is CHECKed to
-- 'model' because the Derivation schema's ModelAuthor has no human or source option: a
-- human note is not a derivation and source text belongs in `blocks`.
--
-- parent_derivation_id + its OWNER-QUALIFIED self-FK is the direct fix for findings.md
-- §F3, where explanation trees walked parent_id chains with no user_id filter and no
-- depth or cycle guard. Here the edge cannot leave the owner at all; the depth guard is
-- in the traversal helper.
CREATE TABLE derivations (
  derivation_id        TEXT    PRIMARY KEY,
  owner_id             TEXT    NOT NULL,
  paper_id             TEXT    NOT NULL,
  generation           INTEGER NOT NULL,
  parent_derivation_id TEXT,
  kind                 TEXT    NOT NULL,
  author_kind          TEXT    NOT NULL CHECK (author_kind = 'model'),
  model_id             TEXT    NOT NULL,
  prompt_hash          TEXT    NOT NULL,
  content              TEXT    NOT NULL CHECK (json_valid(content)),
  -- minItems 1 is load-bearing: a derivation that cannot point at a source block is
  -- ungrounded, which is exactly what the v1 product shipped (findings.md C4).
  derived_from         TEXT    NOT NULL
                         CHECK (json_valid(derived_from) AND json_array_length(derived_from) >= 1),
  created_at           TEXT    NOT NULL,
  UNIQUE (owner_id, derivation_id),
  CHECK (parent_derivation_id IS NULL OR parent_derivation_id <> derivation_id),
  FOREIGN KEY (owner_id, paper_id, generation)
    REFERENCES papers (owner_id, paper_id, generation) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, parent_derivation_id)
    REFERENCES derivations (owner_id, derivation_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX derivations_by_paper ON derivations (owner_id, paper_id, generation, kind);
--;;
CREATE INDEX derivations_by_parent ON derivations (owner_id, parent_derivation_id)
  WHERE parent_derivation_id IS NOT NULL;
--;;

-- block_vectors — sqlite-vec vec0 virtual table. Epic 0 computes NO embeddings: no model,
-- no embedding calls. The table exists, migrates, and is exercised by a test that inserts
-- a dummy vector and queries it, so Epic 3 inherits an extension proven to load in both
-- runtimes.
--
-- THREE MEASURED CONSTRAINTS shaped this (probed against sqlite-vec v0.1.9, SQLite 3.49/3.53):
--
--   (a) vec0's `text primary key` is GLOBALLY unique, not per-partition. Inserting
--       block_id 'blk_1' for a second paper fails with "UNIQUE constraint failed on bv
--       primary key". So the primary key is a COMPOSITE STRING vec_key, not block_id —
--       the same D13 collision, reproduced inside the vector table.
--   (b) `integer partition key` requires a BigInt bind from better-sqlite3 (a plain JS
--       number arrives as FLOAT and is rejected). Folding generation into a single TEXT
--       partition key sidesteps a footgun the two runtimes would otherwise hit differently.
--   (c) A vec0 table takes no foreign keys and has no owner_id column, so the composite-FK
--       mechanism used by every other table does not reach it. Instead OWNERSHIP IS IN THE
--       PARTITION KEY: paper_key = owner_id/paper_id@generation. A KNN query is executed
--       against one partition, and the only code that can name a partition is
--       paperKey(owner: OwnerId, …). A search physically cannot return another owner's
--       vector because it never visits their partition.
--
-- The dimension is fixed at 768 (the common local sentence-embedding width). Epic 3 picks
-- the model; if it picks a different width, that is a NEW numbered migration that drops
-- and recreates this table — cheap, because vectors are always recomputable and are the
-- only thing in the schema that is.
CREATE VIRTUAL TABLE block_vectors USING vec0 (
  paper_key TEXT PARTITION KEY,
  vec_key   TEXT PRIMARY KEY,
  block_id  TEXT,
  model     TEXT,
  embedding FLOAT[768]
);
--;;
-- vec0 cannot participate in ON DELETE CASCADE, so the cascade is re-established by hand.
-- Verified: this trigger fires when the papers row is removed by a CASCADE from users,
-- not only by a direct DELETE.
CREATE TRIGGER papers_after_delete_prune_vectors AFTER DELETE ON papers
BEGIN
  DELETE FROM block_vectors
   WHERE paper_key = old.owner_id || '/' || old.paper_id || '@' || old.generation;
END;
