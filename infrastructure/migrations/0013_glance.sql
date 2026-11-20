-- 0013 (v0.3, #337): the spread's "At a glance" sheet. The run kinds gain 'glance' (the Flash run
-- that writes it, services/agent/src/glance.ts), and the sheet gets a table of its own: a derived,
-- cached thing, one row per (paper, generation, prompt version), written when the paper is added.
--
-- A CHECK cannot be altered in SQLite, so ai_runs is REBUILT (the 0005/0008/0011 pattern): this
-- version is in BACKUP_BEFORE_VERSIONS. Its only child, ai_run_handles, is rebuilt with it, because
-- DROP TABLE under foreign_keys=ON is an implicit DELETE that would cascade into it. Nothing is
-- dropped until a guard has compared every row count; RENAME then rewrites the references. One
-- transaction, so a failure leaves the old schema untouched. Old columns keep their order.
CREATE TABLE ai_runs_new (
  run_id             TEXT    PRIMARY KEY,
  owner_id           TEXT    NOT NULL,
  paper_id           TEXT    NOT NULL,
  generation         INTEGER NOT NULL CHECK (generation >= 1),
  kind               TEXT    NOT NULL CHECK (kind IN ('explain', 'ask', 'summary', 'diagram',
                                                      'topic', 'glance')),
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
CREATE TEMP TABLE _0013_guard (ok INTEGER NOT NULL CHECK (ok = 1));
--;;
INSERT INTO _0013_guard VALUES
  ((SELECT COUNT(*) FROM ai_runs) = (SELECT COUNT(*) FROM ai_runs_new)),
  ((SELECT COUNT(*) FROM ai_run_handles) = (SELECT COUNT(*) FROM ai_run_handles_new));
--;;
DROP TABLE _0013_guard;
--;;
-- The child before the parent: the DROP then cascades into nothing that is kept.
DROP TABLE ai_run_handles;
--;;
DROP TABLE ai_runs;
--;;
ALTER TABLE ai_runs_new RENAME TO ai_runs;
--;;
ALTER TABLE ai_run_handles_new RENAME TO ai_run_handles;
--;;
CREATE INDEX ai_runs_by_owner ON ai_runs (owner_id, started_at);
--;;
CREATE TABLE paper_glance (
  owner_id       TEXT    NOT NULL,
  paper_id       TEXT    NOT NULL,
  -- The parse the sheet was written from. A re-parse is a new generation, and so a new sheet: the
  -- page each block links to is a page of THAT parse.
  generation     INTEGER NOT NULL CHECK (generation >= 1),
  prompt_version TEXT    NOT NULL CHECK (length(prompt_version) > 0),
  -- The model that wrote it (ai_runs.model without the provider prefix), shown as a quiet line.
  model          TEXT    NOT NULL CHECK (length(model) > 0),
  -- The sheet as the API serves it (papertree_api.glance.GlanceContent): every cap applied, every
  -- block's page already resolved from its cited handle. NEVER the model's raw text.
  content_json   TEXT    NOT NULL CHECK (json_valid(content_json) AND json_type(content_json) = 'object'),
  -- The run that made it. Not a foreign key: a run row is the usage ledger's, and the sheet outlives
  -- the sweep of an old one.
  run_id         TEXT,
  created_at     TEXT    NOT NULL,
  PRIMARY KEY (owner_id, paper_id, generation, prompt_version),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE
) STRICT;
