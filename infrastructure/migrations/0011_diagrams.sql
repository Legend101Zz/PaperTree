-- 0011 (v0.2, S7a, #216): AI diagrams. The thread and run kinds gain 'diagram' (and 'topic', the
-- topic Flash run of #242, which is NOT built here: only the CHECKs allow it); a diagram's parts
-- get a table of their own; a message gets `diagram_json` for the plate's title and its links.
--
-- Numbered 0011: 0009 (S2b topics) and 0010 (S3 paper plate) are other slices' and touch no AI
-- table; the runner applies by version, so a gap is fine and this file depends on neither.
--
-- A CHECK cannot be altered in SQLite, so ai_threads and ai_runs are REBUILT (the 0005/0008
-- pattern): this version is in BACKUP_BEFORE_VERSIONS. Their children are rebuilt too, because
-- DROP TABLE under foreign_keys=ON is an implicit DELETE that would cascade into them:
--   ai_threads <- ai_messages <- ai_citations,   ai_runs <- ai_run_handles.
-- Every new table points at the other new tables' *_new names; nothing is dropped until a guard
-- has compared every row count; RENAME then rewrites the references. One transaction, so a
-- failure leaves the old schema untouched. Old columns keep their order; new ones are appended.
CREATE TABLE ai_threads_new (
  thread_id          TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL,
  paper_id           TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('explain', 'ask', 'diagram', 'topic')),
  title              TEXT NOT NULL,
  origin_anchor_json TEXT CHECK (origin_anchor_json IS NULL OR json_valid(origin_anchor_json)),
  agent_state_json   TEXT CHECK (agent_state_json IS NULL OR json_valid(agent_state_json)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (owner_id, thread_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
--;;
INSERT INTO ai_threads_new
  (thread_id, owner_id, paper_id, kind, title, origin_anchor_json, agent_state_json, created_at,
   updated_at)
  SELECT thread_id, owner_id, paper_id, kind, title, origin_anchor_json, agent_state_json,
         created_at, updated_at
    FROM ai_threads;
--;;
CREATE TABLE ai_messages_new (
  message_id   TEXT    PRIMARY KEY,
  owner_id     TEXT    NOT NULL,
  thread_id    TEXT    NOT NULL,
  ordinal      INTEGER NOT NULL CHECK (ordinal >= 0),
  role         TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  generation   INTEGER NOT NULL CHECK (generation >= 1),
  content      TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('streaming', 'complete', 'partial', 'error', 'aborted')),
  error_code   TEXT,
  run_id       TEXT,
  created_at   TEXT    NOT NULL,
  completed_at TEXT,
  -- A diagram answer's plate: {"title": str|null, "links": [{source, target, label}]}. NULL on
  -- every other message. The parts are rows (ai_diagram_parts): they carry the Anchors.
  diagram_json TEXT    CHECK (diagram_json IS NULL OR
                              (json_valid(diagram_json) AND json_type(diagram_json) = 'object')),
  UNIQUE (owner_id, message_id),
  UNIQUE (thread_id, ordinal),
  FOREIGN KEY (owner_id, thread_id) REFERENCES ai_threads_new (owner_id, thread_id)
    ON DELETE CASCADE
) STRICT;
--;;
INSERT INTO ai_messages_new
  (message_id, owner_id, thread_id, ordinal, role, generation, content, status, error_code, run_id,
   created_at, completed_at)
  SELECT message_id, owner_id, thread_id, ordinal, role, generation, content, status, error_code,
         run_id, created_at, completed_at
    FROM ai_messages;
--;;
CREATE TABLE ai_citations_new (
  citation_id TEXT    PRIMARY KEY,
  owner_id    TEXT    NOT NULL,
  message_id  TEXT    NOT NULL,
  ordinal     INTEGER NOT NULL CHECK (ordinal >= 0),
  marker      TEXT    NOT NULL,
  anchor_json TEXT    NOT NULL CHECK (json_valid(anchor_json)),
  generation  INTEGER NOT NULL,
  block_id    TEXT    NOT NULL,                    -- hint only; never an FK (AGENTS.md §4)
  page_index  INTEGER NOT NULL CHECK (page_index >= 0),
  supported   INTEGER CHECK (supported IS NULL OR supported IN (0, 1)),
  UNIQUE (owner_id, citation_id),
  UNIQUE (message_id, ordinal),
  FOREIGN KEY (owner_id, message_id) REFERENCES ai_messages_new (owner_id, message_id)
    ON DELETE CASCADE
) STRICT;
--;;
INSERT INTO ai_citations_new
  (citation_id, owner_id, message_id, ordinal, marker, anchor_json, generation, block_id,
   page_index, supported)
  SELECT citation_id, owner_id, message_id, ordinal, marker, anchor_json, generation, block_id,
         page_index, supported
    FROM ai_citations;
--;;
CREATE TABLE ai_runs_new (
  run_id             TEXT    PRIMARY KEY,
  owner_id           TEXT    NOT NULL,
  paper_id           TEXT    NOT NULL,
  generation         INTEGER NOT NULL CHECK (generation >= 1),
  kind               TEXT    NOT NULL CHECK (kind IN ('explain', 'ask', 'summary', 'diagram',
                                                      'topic')),
  thread_id          TEXT,
  message_id         TEXT,
  token_sha256       TEXT    NOT NULL,
  datamark           TEXT    NOT NULL,
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
INSERT INTO ai_runs_new
  (run_id, owner_id, paper_id, generation, kind, thread_id, message_id, token_sha256, datamark,
   expires_at, status, code_path, provider, model, agent_sdk, prompt_version, request_id,
   stop_reason, error_code, retries, tool_calls, tool_calls_json, input_tokens, output_tokens,
   cache_read_tokens, cache_write_tokens, reasoning_tokens, cost_usd_est, first_text_ms,
   latency_ms, started_at, finished_at)
  SELECT run_id, owner_id, paper_id, generation, kind, thread_id, message_id, token_sha256,
         datamark, expires_at, status, code_path, provider, model, agent_sdk, prompt_version,
         request_id, stop_reason, error_code, retries, tool_calls, tool_calls_json, input_tokens,
         output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, cost_usd_est,
         first_text_ms, latency_ms, started_at, finished_at
    FROM ai_runs;
--;;
CREATE TABLE ai_run_handles_new (
  owner_id   TEXT    NOT NULL,
  run_id     TEXT    NOT NULL,
  handle     TEXT    NOT NULL CHECK (handle GLOB 'b[0-9]*'),
  block_id   TEXT    NOT NULL,
  generation INTEGER NOT NULL,
  PRIMARY KEY (run_id, handle),
  UNIQUE (run_id, block_id),
  FOREIGN KEY (owner_id, run_id) REFERENCES ai_runs_new (owner_id, run_id) ON DELETE CASCADE
) STRICT;
--;;
INSERT INTO ai_run_handles_new (owner_id, run_id, handle, block_id, generation)
  SELECT owner_id, run_id, handle, block_id, generation FROM ai_run_handles;
--;;
-- Abort the whole migration if any row failed to carry (the CHECK fails on 0).
CREATE TEMP TABLE _0011_guard (ok INTEGER NOT NULL CHECK (ok = 1));
--;;
INSERT INTO _0011_guard VALUES
  ((SELECT COUNT(*) FROM ai_threads) = (SELECT COUNT(*) FROM ai_threads_new)),
  ((SELECT COUNT(*) FROM ai_messages) = (SELECT COUNT(*) FROM ai_messages_new)),
  ((SELECT COUNT(*) FROM ai_citations) = (SELECT COUNT(*) FROM ai_citations_new)),
  ((SELECT COUNT(*) FROM ai_runs) = (SELECT COUNT(*) FROM ai_runs_new)),
  ((SELECT COUNT(*) FROM ai_run_handles) = (SELECT COUNT(*) FROM ai_run_handles_new));
--;;
DROP TABLE _0011_guard;
--;;
-- Children before parents: each DROP then cascades into nothing that is kept.
DROP TABLE ai_citations;
--;;
DROP TABLE ai_messages;
--;;
DROP TABLE ai_threads;
--;;
DROP TABLE ai_run_handles;
--;;
DROP TABLE ai_runs;
--;;
ALTER TABLE ai_threads_new RENAME TO ai_threads;
--;;
ALTER TABLE ai_messages_new RENAME TO ai_messages;
--;;
ALTER TABLE ai_citations_new RENAME TO ai_citations;
--;;
ALTER TABLE ai_runs_new RENAME TO ai_runs;
--;;
ALTER TABLE ai_run_handles_new RENAME TO ai_run_handles;
--;;
CREATE INDEX ai_threads_by_paper ON ai_threads (owner_id, paper_id, updated_at);
--;;
CREATE INDEX ai_runs_by_owner ON ai_runs (owner_id, started_at);
--;;
-- One row per part of a diagram answer, in arrival order: the Nth valid part line IS letter N
-- (the agent assigns it, so a model's miscount is corrected, not trusted). A part is CITED (an
-- Anchor the API minted over the block its quote was found in; `supported` 1 when the quote is
-- verbatim, 0 when it is there with differences), NOT VERIFIED (a quote found nowhere: no Anchor,
-- `supported` 0, the quote kept to show), or INFERRED (no quote at all: every cite column NULL).
-- Never a bare block id: `block_id` is a hint beside the Anchor (AGENTS.md §4).
CREATE TABLE ai_diagram_parts (
  part_id     TEXT    PRIMARY KEY,
  owner_id    TEXT    NOT NULL,
  message_id  TEXT    NOT NULL,
  letter      TEXT    NOT NULL CHECK (letter GLOB '[A-L]'),
  ordinal     INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 11),
  label       TEXT    NOT NULL CHECK (length(label) >= 1),
  note        TEXT    NOT NULL DEFAULT '',          -- the part's one-line text (`text` on the wire)
  part_kind   TEXT    NOT NULL CHECK (part_kind IN ('input', 'step', 'output', 'concept')),
  -- Edges INTO this part, from earlier letters only (acyclic by construction).
  after_json  TEXT    NOT NULL CHECK (json_valid(after_json) AND json_type(after_json) = 'array'),
  -- One label (or null) per `after` entry, same order.
  edge_json   TEXT    NOT NULL CHECK (json_valid(edge_json) AND json_type(edge_json) = 'array'),
  cite_quote  TEXT,                                 -- the model's quote, kept to show "not verified"
  anchor_json TEXT    CHECK (anchor_json IS NULL OR json_valid(anchor_json)),
  supported   INTEGER CHECK (supported IS NULL OR supported IN (0, 1)),
  generation  INTEGER NOT NULL CHECK (generation >= 1),
  block_id    TEXT,                                 -- hint only; never an FK
  page_index  INTEGER CHECK (page_index IS NULL OR page_index >= 0),
  CHECK (letter = char(65 + ordinal)),
  CHECK (json_array_length(edge_json) = json_array_length(after_json)),
  CHECK ((cite_quote IS NULL) = (supported IS NULL)),
  CHECK (anchor_json IS NULL OR cite_quote IS NOT NULL),
  CHECK (supported IS NOT 1 OR anchor_json IS NOT NULL),
  CHECK ((anchor_json IS NULL) = (block_id IS NULL) AND (anchor_json IS NULL) = (page_index IS NULL)),
  UNIQUE (owner_id, part_id),
  UNIQUE (message_id, letter),
  FOREIGN KEY (owner_id, message_id) REFERENCES ai_messages (owner_id, message_id)
    ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX ai_diagram_parts_by_message ON ai_diagram_parts (owner_id, message_id, ordinal);
