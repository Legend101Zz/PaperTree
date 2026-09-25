-- 0005_reader_release.sql — the reader release's user-owned state (ADR-002).
--
-- Forward-only, applied by packages/db/python/papertree_db/migrate.py inside ONE transaction.
-- (The TypeScript twin runner is deleted in the same slice, before this file lands; see ADR-002.)
--
-- RULE. Parse-derived rows (papers, pages, blocks, relations, derivations, anchor_resolutions)
-- are keyed to a GENERATION and may die with it. User-owned rows (highlights, anchors, AI
-- threads, canvas) are keyed to the PAPER (paper_owners) and never die with a generation.
-- The only bridge is an Anchor (the full @papertree/anchoring record, anchor_json) plus a
-- per-generation resolution cache. Every FK between owned tables includes owner_id (0001 rule).

-- ── 1. paper_owners: what the library needs before (or without) a parse ──────────────────────
ALTER TABLE paper_owners ADD COLUMN original_filename TEXT;
--;;
ALTER TABLE paper_owners ADD COLUMN byte_size INTEGER;
--;;
ALTER TABLE paper_owners ADD COLUMN page_count INTEGER;
--;;
ALTER TABLE paper_owners ADD COLUMN latest_job_id TEXT;
--;;
-- Uploads whose parse never persisted (e.g. a dead-lettered DDPM) have a job but no
-- paper_owners row today. Give them one so the library can list them as failed + Retry.
INSERT OR IGNORE INTO paper_owners (paper_id, owner_id, source_hash, created_at)
  SELECT json_extract(j.payload, '$.paper_id'),
         j.owner_id,
         CASE WHEN json_extract(j.payload, '$.source_hash') LIKE 'sha256:%'
              THEN json_extract(j.payload, '$.source_hash')
              ELSE 'sha256:' || json_extract(j.payload, '$.source_hash') END,
         j.created_at
    FROM jobs j
   WHERE j.kind = 'parse'
     AND json_extract(j.payload, '$.paper_id') IS NOT NULL
     AND json_extract(j.payload, '$.source_hash') IS NOT NULL;
--;;
UPDATE paper_owners
   SET page_count = NULLIF((SELECT COUNT(*) FROM pages pg
                              JOIN paper_promotions pp
                                ON pp.owner_id = pg.owner_id AND pp.paper_id = pg.paper_id
                               AND pp.generation = pg.generation
                             WHERE pg.owner_id = paper_owners.owner_id
                               AND pg.paper_id = paper_owners.paper_id), 0)
 WHERE page_count IS NULL;
--;;
UPDATE paper_owners
   SET latest_job_id = (SELECT j.job_id FROM jobs j
                         WHERE j.owner_id = paper_owners.owner_id AND j.kind = 'parse'
                           AND json_extract(j.payload, '$.paper_id') = paper_owners.paper_id
                         ORDER BY j.created_at DESC, j.job_id DESC LIMIT 1);
--;;

-- ── 2. highlights + anchors, rebuilt paper-keyed (#121, N1–N3) ─────────────────────────────────
CREATE TABLE highlights_new (
  highlight_id       TEXT    PRIMARY KEY,
  owner_id           TEXT    NOT NULL,
  paper_id           TEXT    NOT NULL,
  color              TEXT    NOT NULL,
  note               TEXT,
  created_generation INTEGER NOT NULL CHECK (created_generation >= 1),
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  UNIQUE (owner_id, highlight_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE TABLE anchors_new (
  anchor_id          TEXT    PRIMARY KEY,             -- the client's Anchor.id, kept verbatim
  owner_id           TEXT    NOT NULL,
  highlight_id       TEXT    NOT NULL,
  paper_id           TEXT    NOT NULL,
  ordinal            INTEGER NOT NULL CHECK (ordinal >= 0),
  anchor_json        TEXT    NOT NULL CHECK (
                       json_valid(anchor_json)
                       AND json_extract(anchor_json, '$.anchorVersion') = 1
                       AND json_extract(anchor_json, '$.id') = anchor_id
                       AND json_extract(anchor_json, '$.doc.paperId') = paper_id
                       AND json_extract(anchor_json, '$.provenanceClass') = provenance_class
                       AND json_extract(anchor_json, '$.targetKind') = target_kind),
  target_kind        TEXT    NOT NULL,
  provenance_class   TEXT    NOT NULL CHECK (provenance_class IN ('source', 'ai_generated')),
  quote_exact        TEXT,                            -- denormalised for the tray and lists
  page_index         INTEGER CHECK (page_index IS NULL OR page_index >= 0),
  created_generation INTEGER NOT NULL CHECK (created_generation >= 1),
  created_at         TEXT    NOT NULL,
  UNIQUE (owner_id, anchor_id),
  UNIQUE (owner_id, highlight_id, ordinal),
  FOREIGN KEY (owner_id, highlight_id)
    REFERENCES highlights_new (owner_id, highlight_id) ON DELETE CASCADE
) STRICT;
--;;
-- The T0 cache that anchoring/src/types.ts says MUST be persisted. Dies with its generation.
CREATE TABLE anchor_resolutions (
  owner_id         TEXT    NOT NULL,
  anchor_id        TEXT    NOT NULL,
  paper_id         TEXT    NOT NULL,
  generation       INTEGER NOT NULL,
  tier             INTEGER NOT NULL CHECK (tier BETWEEN 0 AND 6),
  state            TEXT    NOT NULL CHECK (state IN ('anchored', 'approximate', 'orphan')),
  score            REAL    CHECK (score IS NULL OR score BETWEEN 0 AND 1),
  block_ids        TEXT    NOT NULL CHECK (json_valid(block_ids) AND json_type(block_ids) = 'array'),
  reason           TEXT,
  resolver_version TEXT    NOT NULL,
  resolved_at      TEXT    NOT NULL,
  PRIMARY KEY (owner_id, anchor_id, generation),
  FOREIGN KEY (owner_id, anchor_id) REFERENCES anchors_new (owner_id, anchor_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, paper_id, generation)
    REFERENCES papers (owner_id, paper_id, generation) ON DELETE CASCADE
) STRICT;
--;;
INSERT INTO highlights_new
  SELECT highlight_id, owner_id, paper_id, color, note, generation, created_at, updated_at
    FROM highlights;
--;;
-- Legacy rows (tier 1–3, flat columns) become a whole Anchor built from what 0001 stored plus the
-- block's own geometry (the one real legacy row has a placeholder polygon). No TextQuoteSelector:
-- normalisation is not expressible in SQL; the reader adds one on first open (PUT resolutions).
INSERT INTO anchors_new (anchor_id, owner_id, highlight_id, paper_id, ordinal, anchor_json,
                         target_kind, provenance_class, quote_exact, page_index,
                         created_generation, created_at)
  SELECT a.anchor_id, a.owner_id, a.highlight_id, a.paper_id,
         (SELECT COUNT(*) FROM anchors a2
           WHERE a2.owner_id = a.owner_id AND a2.highlight_id = a.highlight_id
             AND a2.anchor_id < a.anchor_id),
         json_object(
           'anchorVersion', 1, 'offsetUnit', 'unicode', 'id', a.anchor_id,
           'doc', json_object('paperId', a.paper_id, 'pdfSha256', po.source_hash,
                              'parserVersion', p.parser_version, 'textStreamId', 'legacy-0001'),
           'targetKind', 'text', 'provenanceClass', 'source',
           'selectors', json_array(
             CASE WHEN a.char_start IS NULL OR a.char_end IS NULL
                  THEN json_object('type', 'BlockSelector', 'blockId', a.block_id,
                                   'blockTextHash', COALESCE(a.content_hash, b.content_hash, ''))
                  ELSE json_object('type', 'BlockSelector', 'blockId', a.block_id,
                                   'blockTextHash', COALESCE(a.content_hash, b.content_hash, ''),
                                   'startOffset', a.char_start, 'endOffset', a.char_end) END,
             json_object('type', 'PageSelector', 'index', b.page_index),
             json_object('type', 'ShapeSelector', 'pageIndex', b.page_index,
                         'quads', json_array(json_array(b.bbox_x0, b.bbox_y0, b.bbox_x1, b.bbox_y1)),
                         'polygons', json_array(json(b.polygon)),
                         'pageWidth', pg.width, 'pageHeight', pg.height,
                         'rotation', pg.rotation, 'userUnit', pg.user_unit,
                         'cropBox', json(pg.crop_box))),
           'created', json_object('mode', 'source', 'at', a.resolved_at, 'client', 'legacy-0001')),
         'text', 'source', COALESCE(a.text_quote, b.text), b.page_index, a.generation, a.resolved_at
    FROM anchors a
    JOIN paper_owners po ON po.owner_id = a.owner_id AND po.paper_id = a.paper_id
    JOIN papers p  ON p.owner_id = a.owner_id AND p.paper_id = a.paper_id AND p.generation = a.generation
    JOIN blocks b  ON b.owner_id = a.owner_id AND b.paper_id = a.paper_id
                  AND b.generation = a.generation AND b.block_id = a.block_id
    JOIN pages pg  ON pg.owner_id = a.owner_id AND pg.paper_id = a.paper_id
                  AND pg.generation = a.generation AND pg.page_index = b.page_index;
--;;
INSERT INTO anchor_resolutions
  SELECT owner_id, anchor_id, paper_id, generation, tier, 'anchored', NULL,
         json_array(block_id), NULL, 'legacy-0001', resolved_at
    FROM anchors;
--;;
-- Abort the whole migration if any legacy row failed to carry (the CHECK fails on 0).
CREATE TEMP TABLE _0005_guard (ok INTEGER NOT NULL CHECK (ok = 1));
--;;
INSERT INTO _0005_guard VALUES ((SELECT COUNT(*) FROM highlights) = (SELECT COUNT(*) FROM highlights_new));
--;;
INSERT INTO _0005_guard VALUES ((SELECT COUNT(*) FROM anchors) = (SELECT COUNT(*) FROM anchors_new));
--;;
DROP TABLE _0005_guard;
--;;
DROP TABLE anchors;
--;;
DROP TABLE highlights;
--;;
ALTER TABLE highlights_new RENAME TO highlights;
--;;
ALTER TABLE anchors_new RENAME TO anchors;
--;;
CREATE INDEX highlights_by_paper ON highlights (owner_id, paper_id, created_at);
--;;
CREATE INDEX anchors_by_highlight ON anchors (owner_id, highlight_id, ordinal);
--;;
CREATE INDEX anchors_by_paper ON anchors (owner_id, paper_id);
--;;
CREATE INDEX anchor_resolutions_by_paper ON anchor_resolutions (owner_id, paper_id, generation);
--;;

-- ── 3. AI: threads, messages, citations, runs (journeys C and E; #133, #124, N11) ─────────────
CREATE TABLE ai_threads (
  thread_id          TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL,
  paper_id           TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('explain', 'ask')),
  title              TEXT NOT NULL,
  origin_anchor_json TEXT CHECK (origin_anchor_json IS NULL OR json_valid(origin_anchor_json)),
  -- Pi SessionManager entries (exportEntries) as of the last COMPLETED turn; restored per run.
  agent_state_json   TEXT CHECK (agent_state_json IS NULL OR json_valid(agent_state_json)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (owner_id, thread_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE TABLE ai_messages (
  message_id   TEXT    PRIMARY KEY,
  owner_id     TEXT    NOT NULL,
  thread_id    TEXT    NOT NULL,
  ordinal      INTEGER NOT NULL CHECK (ordinal >= 0),
  role         TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  generation   INTEGER NOT NULL CHECK (generation >= 1),   -- the parse the answer was grounded in
  content      TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('streaming', 'complete', 'partial', 'error', 'aborted')),
  error_code   TEXT,
  run_id       TEXT,
  created_at   TEXT    NOT NULL,
  completed_at TEXT,
  UNIQUE (owner_id, message_id),
  UNIQUE (thread_id, ordinal),
  FOREIGN KEY (owner_id, thread_id) REFERENCES ai_threads (owner_id, thread_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE TABLE ai_citations (
  citation_id TEXT    PRIMARY KEY,
  owner_id    TEXT    NOT NULL,
  message_id  TEXT    NOT NULL,
  ordinal     INTEGER NOT NULL CHECK (ordinal >= 0),
  marker      TEXT    NOT NULL,                    -- the handle as the model wrote it, e.g. "b3"
  anchor_json TEXT    NOT NULL CHECK (json_valid(anchor_json)),   -- server-minted Anchor (#124)
  generation  INTEGER NOT NULL,
  block_id    TEXT    NOT NULL,                    -- hint only; never an FK (AGENTS.md §4)
  page_index  INTEGER NOT NULL CHECK (page_index >= 0),
  supported   INTEGER CHECK (supported IS NULL OR supported IN (0, 1)),
  UNIQUE (owner_id, citation_id),
  UNIQUE (message_id, ordinal),
  FOREIGN KEY (owner_id, message_id) REFERENCES ai_messages (owner_id, message_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE TABLE ai_runs (
  run_id             TEXT    PRIMARY KEY,
  owner_id           TEXT    NOT NULL,
  paper_id           TEXT    NOT NULL,
  generation         INTEGER NOT NULL CHECK (generation >= 1),
  kind               TEXT    NOT NULL CHECK (kind IN ('explain', 'ask', 'summary')),
  thread_id          TEXT,
  message_id         TEXT,
  token_sha256       TEXT    NOT NULL,             -- sha256 of the run token; the token is never stored
  datamark           TEXT    NOT NULL,             -- papertree_prompts.mint_datamark(), per run
  expires_at         TEXT    NOT NULL,
  status             TEXT    NOT NULL CHECK (status IN ('running', 'done', 'error', 'aborted')),
  code_path          TEXT    NOT NULL,
  provider           TEXT,
  model              TEXT,
  agent_sdk          TEXT,
  prompt_version     TEXT,
  request_id         TEXT,
  stop_reason        TEXT,
  error_code         TEXT,
  retries            INTEGER NOT NULL DEFAULT 0 CHECK (retries >= 0),
  tool_calls         INTEGER NOT NULL DEFAULT 0 CHECK (tool_calls >= 0),
  tool_calls_json    TEXT    CHECK (tool_calls_json IS NULL OR json_valid(tool_calls_json)),
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cache_read_tokens  INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens   INTEGER,
  cost_usd_est       REAL,
  first_text_ms      INTEGER,
  latency_ms         INTEGER,
  started_at         TEXT    NOT NULL,
  finished_at        TEXT,
  UNIQUE (owner_id, run_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE TABLE ai_run_handles (
  owner_id   TEXT    NOT NULL,
  run_id     TEXT    NOT NULL,
  handle     TEXT    NOT NULL CHECK (handle GLOB 'b[0-9]*'),
  block_id   TEXT    NOT NULL,
  generation INTEGER NOT NULL,
  PRIMARY KEY (run_id, handle),
  UNIQUE (run_id, block_id),
  FOREIGN KEY (owner_id, run_id) REFERENCES ai_runs (owner_id, run_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX ai_threads_by_paper ON ai_threads (owner_id, paper_id, updated_at);
--;;
CREATE INDEX ai_runs_by_owner ON ai_runs (owner_id, started_at);
--;;
-- A paper summary is a derivation (existing table, generation-scoped on purpose). One per
-- (paper, generation, prompt version, model).
CREATE UNIQUE INDEX derivations_paper_summary
  ON derivations (owner_id, paper_id, generation, prompt_hash, model_id)
  WHERE kind = 'paper_summary';
--;;

-- ── 4. Canvas (#6 F5.1): rows, not a blob; one drag = one UPDATE ────────────────────────────────
CREATE TABLE canvas_boards (
  board_id      TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  paper_id      TEXT,                              -- NULL reserved for cross-paper boards later
  title         TEXT NOT NULL,
  viewport_json TEXT CHECK (viewport_json IS NULL OR json_valid(viewport_json)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (owner_id, board_id),
  UNIQUE (owner_id, paper_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE TABLE canvas_nodes (
  node_id            TEXT    PRIMARY KEY,            -- client-minted uuid
  owner_id           TEXT    NOT NULL,
  board_id           TEXT    NOT NULL,
  kind               TEXT    NOT NULL CHECK (kind IN ('excerpt', 'explanation', 'note', 'group')),
  group_id           TEXT,
  x                  REAL    NOT NULL,
  y                  REAL    NOT NULL,
  w                  REAL    NOT NULL CHECK (w > 0),
  h                  REAL    NOT NULL CHECK (h > 0),
  z                  INTEGER NOT NULL DEFAULT 0,
  title              TEXT,
  body               TEXT    NOT NULL DEFAULT '',
  source_anchor_json TEXT    CHECK (source_anchor_json IS NULL OR json_valid(source_anchor_json)),
  source_message_id  TEXT,
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  CHECK (kind <> 'excerpt' OR source_anchor_json IS NOT NULL),
  CHECK (kind <> 'explanation' OR source_message_id IS NOT NULL),
  CHECK (group_id IS NULL OR group_id <> node_id),
  UNIQUE (owner_id, node_id),
  FOREIGN KEY (owner_id, board_id) REFERENCES canvas_boards (owner_id, board_id) ON DELETE CASCADE,
  -- NO ACTION, not SET NULL: SET NULL on a composite key would null owner_id too. The trigger
  -- below ungroups members before a group row is deleted.
  FOREIGN KEY (owner_id, group_id) REFERENCES canvas_nodes (owner_id, node_id)
) STRICT;
--;;
CREATE TRIGGER canvas_nodes_ungroup_before_delete BEFORE DELETE ON canvas_nodes
  WHEN OLD.kind = 'group'
BEGIN
  UPDATE canvas_nodes SET group_id = NULL WHERE owner_id = OLD.owner_id AND group_id = OLD.node_id;
END;
--;;
CREATE TABLE canvas_edges (
  edge_id      TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  board_id     TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id   TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('supports', 'contradicts', 'derives_from', 'answers',
                                             'compares', 'references', 'relates')),
  label        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (from_node_id <> to_node_id),
  UNIQUE (owner_id, edge_id),
  FOREIGN KEY (owner_id, board_id) REFERENCES canvas_boards (owner_id, board_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, from_node_id) REFERENCES canvas_nodes (owner_id, node_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, to_node_id) REFERENCES canvas_nodes (owner_id, node_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX canvas_nodes_by_board ON canvas_nodes (owner_id, board_id);
--;;
CREATE INDEX canvas_edges_by_board ON canvas_edges (owner_id, board_id);
