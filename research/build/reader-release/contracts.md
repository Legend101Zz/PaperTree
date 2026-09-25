# Reader release: shared contracts (fixed in slice S0, before any parallel slice starts)

Companion to `ADR-002-reader-release.md` and `slice-plan.md`. Everything here is normative. A slice that needs to change any of it opens a contracts PR first and does not change the contract inside its own feature PR.

Evidence labels: **MEASURED** means the judge ran it (scripts in `judge-evidence/` (the architecture session's local evidence store, not committed; the migration probe is ported to `packages/db/python/tests/test_0005_saved_shapes.py` in S0)). **QUOTED** means it comes from a named report.

## 0. Conventions

- **IDs.**
  - Server-minted ids are `<prefix>_<ULID>`: `usr_`, `ppr_` (the existing deterministic `derive_paper_id`), `job_`, `thr_`, `msg_`, `run_`, `cit_`, `brd_`.
  - Client-minted ids are sent on create, which makes the create idempotent:
    - `highlight_id`: `hl_` + 26 Crockford chars or a UUID;
    - `anchor.id`: `crypto.randomUUID()`, as `captureAnchor` already does;
    - `node_id`: `cn_` + uuid;
    - `edge_id`: `ce_` + uuid.
  - Validated with the regex `^[a-z]{2,4}_[0-9A-Za-z-]{8,64}$`, or a bare UUID for `anchor.id`.
- **Times** are ISO-8601 UTC strings (`2026-09-25T15:09:25.123Z`). **Geometry** is IR space: PDF points, top-left origin (ADR-001 Commitment 2). It never contains pixels.
- **Auth.**
  - Browser → API: `Authorization: Bearer <opaque session token>`, unchanged from `security.py`.
  - API → agent: header `X-PaperTree-Agent-Secret: <PAPERTREE_AGENT_SECRET>`.
  - Agent → API internal tools: `Authorization: Bearer <run token>`.
  - **No `OwnerId`, no `user_id` and no model key crosses any wire** (AGENTS.md §4). The API maps a token to a `user_id` and calls `owner_for(user_id)` in-process.
- **JSON errors** (every non-2xx JSON response from `services/api`):

  ```json
  { "detail": "human-readable sentence, safe to show", "code": "<ErrorCode, §2.9>", "retryable": false }
  ```

  FastAPI's own 422 is re-wrapped with `code: "validation_failed"`, and `detail` names the first failing field.
- **SSE framing** (API → browser and agent → API): `event: <name>\ndata: <one-line JSON>\n\n`. There is a comment heartbeat `: ping\n\n` every 10 s. `EventSource` cannot send a Bearer header, so the browser reads SSE with `fetch` + `ReadableStream`.
- **Request ids.** The API accepts or mints `X-Request-Id` (`req_<ULID>`), echoes it on every response, and forwards it to the agent. It goes into every log line (§8).
- **Wire-contract files** live in `contracts/` at the repo root and are committed:
  - `contracts/api/*.schema.json` is exported from the pydantic models by `uv run python -m papertree_api.contracts export`. A pytest fails if the committed copy drifts.
  - `contracts/agent/run-request.schema.json`, `run-events.schema.json` and `internal-tools.schema.json` are hand-written.
  - `contracts/agent/fixtures/*.sse` are recorded event streams: `explain-ok`, `followup-ok`, `summary-ok`, `tool-budget`, `stall-timeout`, `auth-error`, `aborted-partial`, `upstream-503-retry-ok`.
  - `contracts/anchor/anchor-v1.schema.json` is the persisted Anchor (§6).
  - **No new Python dependency.** The Python side is the pydantic models. A drift test compares the committed schemas with `model_json_schema()`, and the API's `FakeAgent` parses the agent fixtures through the pydantic event models.
  - The TS tests validate with `ajv`, which is already locked at 8.20.0; S0 adds it as a devDependency of `apps/web` and `services/agent`.
  - The agent's tests assert that it **emits** the fixtures, and the API's `FakeAgent` **replays** them. That makes the contract two-sided.

## 1. Database: migration `0005_reader_release.sql`

- The next number after `infrastructure/migrations/0001_core.sql`, `0002_jobs.sql`, `0003_memory.sql` and `0004_auth.sql` (checked with `ls`).
- **Python runner only.** S0 deletes the TypeScript twin (`packages/db/src`, `packages/db/test`, `packages/db/package.json`, plus CI's better-sqlite3 preflight and `test_a_database_migrated_by_typescript_is_a_noop_for_python`) **before** this file lands. The reasons:
  - 0 importers of `@papertree/db` outside `packages/db` (MEASURED, `grep -a`);
  - the owner-FK audit exists in Python (`packages/db/python/tests/test_ownership.py:438`);
  - the twin's own tests insert rows in the 0001 highlight/anchor shape, which 0005 replaces.
- **MEASURED** on backup copies of `~/.papertree-demo` and `PaperTree-evidence/runtime/baseline-data` (`judge-evidence/migrate_probe.py`):
  - applied in 13.4 ms and 10.7 ms;
  - counts identical, except that baseline `paper_owners` goes from 1 to 2 (the dead-lettered DDPM, as intended);
  - `foreign_key_check` returns `[]` and `integrity_check` returns `ok`;
  - a re-run is a no-op;
  - the legacy highlight is carried as a full Anchor;
  - gen 2 promoted plus gen 1 deleted keeps the highlight;
  - a real `captureAnchor` record (5,303 B) is stored;
  - a wrong-paper anchor and an excerpt without an anchor are both rejected;
  - deleting a group ungroups its members;
  - deleting a node cascades to its edges;
  - an owner-FK audit of 22 FKs finds 0 violations.
- After 0005, `OWNED_TABLES` in `test_ownership.py` gains `anchor_resolutions, ai_threads, ai_messages, ai_citations, ai_runs, ai_run_handles, canvas_boards, canvas_nodes, canvas_edges`.

Exact SQL (sha256 `fee40d8f919d246b24c299c1c5ccb7fd5638e61de087e0c509125b323703d5d0`, 360 lines; the copy in `judge-evidence/0005_reader_release.sql` is the tested one):

```sql
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
```

### 1.1 Python DB layer (`packages/db/python/papertree_db/`), signatures fixed in S0

S0 splits the layer into modules, each owned by one later slice (`slice-plan.md` §3): `database.py` (the core, plus `transaction()`), `library.py` (S1), `highlights.py` (S4), `ai.py` (S5) and `canvas.py` (S7). They are mixins on `PaperTreeDb`, so call sites keep `db.<method>`.

- Every method takes `owner: OwnerId` first. Every multi-row write runs in **one** `BEGIN IMMEDIATE … COMMIT`, through a new `db.transaction()` context manager. The connection stays in autocommit outside it.
- These are **stubs raising `NotImplementedError`** until the owning slice fills them in. S0 implements the ones marked ★, because tests and the migration probe need them.

| Method | Returns | Owner slice |
|---|---|---|
| `register_upload(owner, paper_id, source_hash, original_filename, byte_size, page_count)` | `None`. It is an INSERT OR IGNORE into `paper_owners`, then an UPDATE of the four new columns. | S1 |
| `set_latest_job(owner, paper_id, job_id)` / `next_generation(owner, paper_id) -> int` | – | S1 |
| `list_library(owner) -> list[LibraryRow]` | One row per `paper_owners` row. The query is a LEFT JOIN of `paper_promotions` → `papers` (promoted generation), a LEFT JOIN of `jobs` on `latest_job_id`, and `COUNT(highlights)`. It fixes N4 (one row per generation today). | S1 |
| ★ `create_highlight(owner, paper_id, *, highlight_id, color, note, created_generation, anchors: Sequence[AnchorIn], resolutions: Sequence[ResolutionIn]) -> HighlightRow` | Atomic. On an existing `highlight_id` with the same body it returns the stored row. | S0 → S4 |
| ★ `list_highlights(owner, paper_id, generation: int \| None) -> list[HighlightWithAnchors]` | A LEFT JOIN of anchors and `anchor_resolutions` for that generation. An anchorless or orphaned row is **still listed** (fixes N2). | S0 → S4 |
| `update_highlight(owner, paper_id, highlight_id, *, color=None, note=None)` / `delete_highlight(owner, paper_id, highlight_id)` | Checks that `paper_id` matches (fixes the path-ignoring defect) | S4 |
| `put_resolutions(owner, paper_id, generation, items)` / `upgrade_legacy_anchor(owner, paper_id, anchor_id, anchor_json)` | Upsert on `(owner_id, anchor_id, generation)`. The upgrade is allowed only when the stored `doc.textStreamId == 'legacy-0001'`. | S4 |
| `create_thread`, `append_message`, `update_message`, `list_threads`, `get_thread` | – | S5 |
| `create_run(owner, *, run_id, paper_id, generation, kind, thread_id, message_id, token_sha256, datamark, expires_at, code_path, request_id, prompt_version)` / `finish_run(owner, run_id, **usage)` / `put_run_handles(owner, run_id, generation, pairs)` | – | S5 |
| `run_grant(run_id, token_sha256) -> RunGrant \| None` | **The one un-owned read**, the same exception class as `AgentDataHandle`. It returns `user_id, paper_id, generation, kind, status, expires_at, datamark`. The caller then calls `owner_for(user_id)`. | S5 |
| `cost_since(owner, since) -> float` / `usage_since(owner, since) -> UsageTotals` | – | S5 |
| `get_board(owner, paper_id)`, `create_node(owner, paper_id, node)` (creates the board inside the same transaction), `patch_node(owner, board_id, node_id, version, fields) -> NodeRow \| StaleVersion`, `delete_node`, `create_edge`, `patch_edge`, `delete_edge`, `patch_board` | – | S7 |
| summaries: the existing `create_derivation(kind='paper_summary')` + `get_summary(owner, paper_id, generation, prompt_hash, model_id)` | – | S5 |

## 2. Public HTTP API (`services/api`, browser → API)

- Base URL: `NEXT_PUBLIC_PAPERTREE_API_URL` (default `http://localhost:8000`).
- Every route except register and login needs Bearer auth. Responses never contain `owner_id` (`_public()` is kept).
- `app.py` is split in S0 into `routers/{auth,papers,jobs,highlights,threads,summary,usage,boards,internal}.py`. Existing routes keep their paths.
- New routes exist as **501 stubs with their final pydantic models** from S0 onwards.
- `GZipMiddleware(minimum_size=1024)` covers JSON responses.
- CORS stays at the localhost regex, plus an optional `PAPERTREE_CORS_ORIGINS` (comma list).

### 2.1 Auth (unchanged shapes)

| Method, path | Request | 2xx | Errors |
|---|---|---|---|
| POST `/auth/register` | `{email, password}` (password 8–1024; the web's client-side minimum becomes **8**, today it is 6) | 201 `{token, user_id, email}` | 409 `email_taken`, 422 |
| POST `/auth/login` | `{email, password}` | 200 `{token, user_id, email}` | 401 `invalid_credentials` |
| POST `/auth/logout` | – | 204. The web now **calls it** on sign-out. | – |
| GET `/auth/me` | – | 200 `{user_id, email}` | 401 `auth_required` |

### 2.2 Papers, library, jobs

`LibraryPaper` is the row shape used everywhere a paper is listed:

```json
{
  "paper_id": "ppr_C425DTWW1KYMYDSWR205HB2069",
  "title": "You Only Look Once: Unified, Real-Time Object Detection",
  "authors": ["Joseph Redmon", "Santosh Divvala"],
  "original_filename": "yolo-1506.02640.pdf",
  "source_hash": "sha256:54bcd2dd05dc618849e8a94d8b88fe3eeb37f80e96e200600d38f1f733931678",
  "page_count": 10,
  "processing": "queued | reading | ready | partial | failed",
  "job": { "job_id": "job_…", "kind": "parse", "state": "pending|running|succeeded|dead_letter|cancelled",
           "step": "parse|persist|promote|null", "done": 1, "total": 3, "attempt": 1, "max_attempts": 3,
           "error_code": "pdf_unreadable|validation_failed|timeout|internal|null" },
  "generation": 1,
  "parser_version": "1.0.0",
  "highlight_count": 3,
  "created_at": "…", "updated_at": "…"
}
```

- `title` is `metadata.title.value` of the promoted generation. Otherwise it is `original_filename` without `.pdf`, and otherwise the `paper_id`. PDFs' `/Title` was empty in 4 of 4 papers (MEASURED), so it is not used.
- `processing` is derived from the latest job and the promotion. `queued` means pending. `reading` means running. `ready` or `partial` follows the promoted `papers.status`. `failed` means dead_letter with no promoted generation.
- A paper that has a promoted generation **and** a running re-parse stays `ready`, and `job` shows the re-parse.

| Method, path | Request | 2xx | Errors / notes |
|---|---|---|---|
| POST `/papers` | multipart `file` | 202 `{paper_id, job_id, created: bool, paper: LibraryPaper}` | 400 `empty_upload`, 413 `payload_too_large` (`PAPERTREE_MAX_UPLOAD_MB`, default 100), 415 `unsupported_media_type` (bytes not starting with `%PDF-`). `page_count` comes from one PyMuPDF open, 0.19–0.58 ms (MEASURED). If the latest job for these bytes is `dead_letter`, a **new** job is created. The idempotency key is `parse:{source_hash}:{paper_id}:g{generation}:a{attempt_seq}`. |
| GET `/papers` | – | 200 `LibraryPaper[]`, newest first | – |
| GET `/papers/{id}` | – | 200 `LibraryPaper` | 404 `not_found` |
| DELETE `/papers/{id}` | – | 204. Deletes the DB rows (the `delete_paper` cascade) plus `uploads/<id>.pdf`, `assets/<id>/` and staging. | 404 |
| POST `/papers/{id}/retry` | – | 202 `{job_id, generation}`: the same generation, a new `attempt_seq` | 409 `not_failed` if the latest job is not `dead_letter` |
| POST `/papers/{id}/reparse` | `{reason?: string}` | 202 `{job_id, generation}`, with generation = `next_generation` | 409 `busy` if a parse job is pending or running |
| GET `/jobs/{job_id}` | – | 200: the existing shape plus `error_code` (the raw `error` text stays in logs and the DB) | 404 |
| GET `/papers/{id}/file` | – | 200 `application/pdf`, `ETag: "<source_hash>"`, `Cache-Control: private, max-age=31536000, immutable`. **Gated on ownership, not on promotion.** | 404 |
| GET `/papers/{id}/ir` | `?gen=` optional | 200 PaperIR 1.0.0 (gzip). Every `asset://<paper>/<gen>/<kind>/<block>@3x.png` in payloads is rewritten to a signed absolute URL (§2.3). | 409 `not_parsed` (no promoted generation). The reader shows its "Still reading…" state and keeps Source mode working. 404. |
| GET `/papers/{id}/assets/{kind}/{block_id}` | `?gen=&exp=&sig=` **or** Bearer | 200 `image/png` | 401 `auth_required` if neither is valid |

- **Worker job contract.**
  - Payload: `{paper_id, source_path, source_hash, generation, attempt_seq}`.
  - Steps are, in order, `parse` → `persist` → `promote`:
    - `promote` promotes gen N only if the stored gen N validated;
    - it deletes the staging JSON.
  - Salvage (S2) makes an invalid IR `status: partial`, not a dead-letter.
  - `assemble.py` takes the generation from the payload instead of the hard-coded `1`.
  - `parsed_at` is the real UTC time.

### 2.3 Signed asset URLs

- The format is `sig = base64url(HMAC-SHA256(PAPERTREE_SIGNING_SECRET, "{paper_id}|{gen}|{kind}|{block_id}|{exp}"))`, where `exp` is a Unix time 1 h ahead.
- Owner check: the API resolves `paper_id → owner` through `paper_owners`, so the signature stands in for the Bearer only for that single object.
- If `PAPERTREE_SIGNING_SECRET` is unset, the API mints a random secret at boot, so signed URLs stop working across a restart. That is acceptable: the reader re-fetches `/ir`.

### 2.4 Highlights

`AnchorWire` = `{anchor_id, ordinal, anchor: Anchor (§6), resolution: ResolutionWire | null}`

`ResolutionWire` = `{generation, tier: 0-6, state: "anchored|approximate|orphan", block_ids: string[], score: number|null, reason: AnchorFailureReason|null, resolver_version}`

`Highlight` = `{highlight_id, color: "amber|green|blue|pink|purple", note: string|null, created_generation, created_at, updated_at, anchors: AnchorWire[]}`

| Method, path | Request | 2xx | Errors |
|---|---|---|---|
| GET `/papers/{id}/highlights` | `?gen=` (default: promoted; if none, resolutions are `null`) | 200 `Highlight[]`, including orphans and legacy rows | 404 |
| POST `/papers/{id}/highlights` | `{highlight_id, color, note?, anchors: [{anchor: Anchor}] (1..64, ordinal = index), resolutions?: [{anchor_id, generation, tier, state, block_ids, score, reason?, resolver_version}]}` | 201 `Highlight`; 200 when the same `highlight_id` and body already exist | 422 `validation_failed`; 422 `anchor_incomplete` (a new anchor lacks a `TextQuoteSelector` or a `ShapeSelector` with ≥1 quad); 422 `anchor_mismatch` (`doc.paperId ≠ id` or `doc.pdfSha256 ≠ paper_owners.source_hash`); 409 `not_parsed` (no promoted generation: in this release the reader enables Highlight only once the IR is loaded, and `created_generation` = the promoted generation); 404. **Never 500 on a bad body**, and never a partial write. |
| PATCH `/papers/{id}/highlights/{hid}` | `{color?, note?}` | 200 `Highlight` | 404 when the hid is not on this paper |
| DELETE `/papers/{id}/highlights/{hid}` | – | 204 | 404 |
| PUT `/papers/{id}/highlights/resolutions` | `{generation, items: [{anchor_id, tier, state, block_ids, score, reason?, resolver_version, upgraded_anchor?: Anchor}] (≤500)}` | 204 | 422, 409 `generation_not_found` |

- The server strips any `resolution` field from an incoming Anchor before storing `anchor_json`. The T0 cache lives only in `anchor_resolutions`.
- The server validates the Anchor against `contracts/anchor/anchor-v1.schema.json`.

### 2.5 AI threads (explain, ask, follow-up)

`Message` = `{message_id, thread_id, ordinal, role: "user|assistant", content, status: "streaming|complete|partial|error|aborted", error: {code, retryable, message}|null, generation, run: RunSummary|null, citations: Citation[], created_at, completed_at}`

`Citation` = `{citation_id, ordinal, marker: "b3", page_index, anchor: Anchor, supported: boolean|null}`

`RunSummary` = `{run_id, model: "MiniMax-M3", provider: "minimax", agent_sdk: "pi-coding-agent@0.87.1", input_tokens, output_tokens, cache_read_tokens, reasoning_tokens, cost_usd_est, first_text_ms, latency_ms, retries, tool_calls}`

`Thread` = `{thread_id, kind: "explain|ask", title, origin_anchor: Anchor|null, created_at, updated_at, message_count}`

| Method, path | Request | Response | Pre-stream errors (JSON, before any SSE byte) |
|---|---|---|---|
| POST `/papers/{id}/threads` | `{kind: "explain"\|"ask", anchor?: Anchor (required for explain), question?: string (1..2000; default "Explain this passage.")}` + `Accept: text/event-stream` | 200 SSE (§2.6) | 409 `not_parsed`, 429 `budget_exhausted`, 503 `agent_unavailable`, 503 `not_configured`, 422 |
| POST `/papers/{id}/threads/{tid}/messages` | `{question, retry_of?: message_id}` | 200 SSE | the same, plus 409 `busy` (a run is live on this thread) |
| GET `/papers/{id}/threads` | – | 200 `Thread[]` | – |
| GET `/papers/{id}/threads/{tid}` | – | 200 `{thread: Thread, messages: Message[]}` | 404 |
| POST `/runs/{run_id}/cancel` | – | 202; propagates `DELETE agent /v1/runs/{run_id}`. A browser disconnect does the same. | 404 |
| GET `/papers/{id}/summary` | – | 200 `{state: "none\|running\|ready\|partial\|failed", summary: Summary\|null}` | 404 |
| POST `/papers/{id}/summary` | `{regenerate?: boolean}` | 200 SSE, the same events. If a cached summary exists and `regenerate` is not set, the answer is 200 JSON `{state:"ready", summary}`. | the same as threads |
| GET `/usage` | `?since=ISO (default now-24h)` | 200 `{since, runs, input_tokens, output_tokens, cost_usd_est, budget_usd, by_kind: {explain, ask, summary}}` | – |

`Summary` = `{generation, model, prompt_version, created_at, bullets: [{text, citations: Citation[], supported: boolean}], status: "complete|partial"}`. It is stored as `derivations(kind='paper_summary', content=Summary JSON, derived_from=[cited block_ids], prompt_hash=prompt_version, model_id='MiniMax-M3')`.

### 2.6 Browser-facing SSE events (from the threads and summary routes)

| event | data | when |
|---|---|---|
| `run` | `{run_id, thread_id, user_message_id, message_id, generation}` | first |
| `status` | `{phase: "thinking"\|"tool"\|"retrying"\|"writing", label?: "Reading p. 4 · §2.1", attempt?, delay_ms?}` | as the agent reports |
| `text` | `{delta}` | text of the **final** assistant message only |
| `citations` | `{items: Citation[]}` | once, after `done` from the agent and after persistence |
| `usage` | `RunSummary` | once, before `done` |
| `done` | `{status: "complete"\|"partial"\|"error"\|"aborted", error: {code, retryable, message}\|null, message_id}` | last |

The API writes `ai_messages.content` at most every 500 ms while streaming, and once more on `done`.

### 2.7 Canvas

`Board` = `{board_id, paper_id, title, viewport: {x, y, zoom}|null, created_at, updated_at}`

`CanvasNode` = `{node_id, board_id, kind: "excerpt|explanation|note|group", group_id|null, x, y, w, h, z, title|null, body, source_anchor: Anchor|null, source_message_id|null, version, created_at, updated_at}`

`CanvasEdge` = `{edge_id, board_id, from_node_id, to_node_id, kind: "supports|contradicts|derives_from|answers|compares|references|relates", label|null}`

| Method, path | Request | 2xx | Errors |
|---|---|---|---|
| GET `/papers/{id}/board` | – | 200 `{board: Board\|null, nodes: CanvasNode[], edges: CanvasEdge[]}`. **Never writes.** | 404 |
| POST `/papers/{id}/board/nodes` | `{node_id, kind, x, y, w, h, title?, body?, source_anchor?, source_message_id?, group_id?}` | 201 `{board, node}`. The board is created in the same transaction on the first send. | 422 (an excerpt without `source_anchor`, an explanation without `source_message_id`, or a `source_anchor.doc.paperId` that is not this paper) |
| PATCH `/boards/{bid}/nodes/{nid}` | `{version, x?, y?, w?, h?, z?, title?, body?, group_id?}` | 200 `CanvasNode` (version + 1) | 409 `stale_version` (the body carries the current node), 404 |
| DELETE `/boards/{bid}/nodes/{nid}` | – | 204. Edges cascade; deleting a group ungroups its members (trigger). | 404 |
| POST `/boards/{bid}/edges` | `{edge_id, from_node_id, to_node_id, kind, label?}` | 201 `CanvasEdge` | 422 when the nodes are not on this board |
| PATCH / DELETE `/boards/{bid}/edges/{eid}` | `{kind?, label?}` | 200 / 204 | 404 |
| PATCH `/boards/{bid}` | `{title?, viewport?}` | 200 `Board` | – |

The client writes only on explicit actions: drag-end (one PATCH per node moved), edit commit, connect, group and delete. It writes the viewport on pan or zoom **end** only. A settled canvas makes 0 requests.

### 2.8 Health

`GET /healthz` returns `{ok, version, db: "ok", migrations: [1,2,3,4,5], agent: {reachable, key_present, sdk}}`. It needs no auth and carries no secrets.

### 2.9 Error codes (the `code` field; one enum in `services/api/.../errors.py` and `apps/web/src/lib/api/types.ts`)

`auth_required` 401 · `invalid_credentials` 401 · `email_taken` 409 · `not_found` 404 · `validation_failed` 422 · `empty_upload` 400 · `payload_too_large` 413 · `unsupported_media_type` 415 · `not_parsed` 409 · `not_failed` 409 · `busy` 409 · `stale_version` 409 · `generation_not_found` 409 · `anchor_incomplete` 422 · `anchor_mismatch` 422 · `budget_exhausted` 429 · `agent_unavailable` 503 · `not_configured` 503 · `internal` 500.

SSE `done.error.code` (from the agent, §3.4) takes one of these values:
- `provider_auth` · `rate_limited` · `quota` · `upstream_unavailable` · `timeout` · `aborted`;
- `bad_request` · `tool_failed` · `tool_budget_exhausted` · `output_truncated`;
- `agent_unavailable` · `internal`.

## 3. Agent service (`services/agent`, API → agent)

### 3.1 Process and wiring (fixed, and asserted at boot)

- **Runtime.** Node ≥ 22.19 (the repo pins 22.23). The dependencies are `@earendil-works/pi-coding-agent@0.87.1`, `@earendil-works/pi-ai@0.87.1` and `typebox@1.3.27`, all **exact**. pi-ai and pi-coding-agent are bumped together (QUOTED spike §11).
- **Install check.** `services/agent` is a pnpm workspace member (`pnpm-workspace.yaml` already lists `services/*`). S0 adds the dependencies. S5's first acceptance item is `pnpm ls` showing exactly one pi-ai 0.87.1, or two byte-identical copies (the spike used npm and a shrinkwrap). If pnpm cannot install Pi faithfully, the fallback is a standalone `npm ci` with its own `package-lock.json`, with `services/agent` excluded from the pnpm workspace. That fallback is decided in S5 and recorded in the README.
- **Binding.** It binds only `127.0.0.1:${PAPERTREE_AGENT_PORT:-8200}`. Start it with `pnpm --filter @papertree/agent start`, which runs `node --experimental-strip-types src/server.ts` or the built JS.
- **Session construction.** One wrapper, `createPaperSession()`, is the **only** caller of `createAgentSession`. Every option is supplied (QUOTED spike §13 and verify must-fix 7):
  - `modelRuntime`: `ModelRuntime.create({credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false})`, then `setRuntimeApiKey("minimax", PAPERTREE_MINIMAX_API_KEY)`;
  - `settingsManager`: `SettingsManager.inMemory({defaultTools: [], compaction: {enabled: false}, cacheWarming: "off", enableInstallTelemetry: false, httpIdleTimeoutMs: 60000, retry: {enabled: true, maxRetries: 1, baseDelayMs: 1000, maxAgentDelayMs: 4000, provider: {maxRetries: 0, timeoutMs: 30000, maxRetryDelayMs: 4000}}})`;
  - `sessionManager`: `SessionManager.inMemory("/", {id: thread_id}, entries)`;
  - `resourceLoader`: the empty one from spike §13;
  - `cwd: "/"`;
  - `tools: [the 4 tool names]` and `customTools: [the 4 tools]`;
  - `model: {...m3, maxTokens: limits.max_output_tokens}`;
  - `thinkingLevel: "low"`.
  
  `prompt()` is always called with `{expandPromptTemplates: false}`.
- **Boot refuses to start** in any of these cases:
  - `PAPERTREE_MINIMAX_API_KEY` or `PAPERTREE_AGENT_SECRET` is missing;
  - after `delete process.env.MINIMAX_API_KEY` (spike-verify S4), `session.getAllTools().map(t => t.name)` is not exactly `["get_outline","get_section","get_passage","search_passages"]`.

  It also sets `PI_OFFLINE=1`, `PI_TELEMETRY=0` and `PI_CODING_AGENT_DIR=<empty dir owned by the service>`.

### 3.2 `POST /v1/runs`

Headers: `X-PaperTree-Agent-Secret`, `X-Request-Id`, `Content-Type: application/json`, `Accept: text/event-stream`. Body (`contracts/agent/run-request.schema.json`):

```json
{
  "run_id": "run_01J…",
  "request_id": "req_01J…",
  "kind": "explain | ask | summary",
  "prompt_version": "explain-v1 | ask-v1 | summary-v1",
  "tool": { "base_url": "http://127.0.0.1:8000/internal/agent/runs/run_01J…", "token": "<43-char base64url, 32 random bytes>" },
  "datamark": "^1a2b3c4d",
  "paper": { "title": "You Only Look Once: …", "page_count": 10, "generation": 1 },
  "seed": {
    "quote": "<the exact selected text, verbatim>",
    "page_label": "p. 1",
    "section": "1. Introduction",
    "passages": [ { "handle": "b1", "label": "p. 1 · ¶", "text": "<datamarked block text>" } ]
  },
  "question": "Explain this passage.",
  "history": { "session_id": "thr_01J…", "entries": [ "…Pi exportEntries() JSON…" ] },
  "limits": { "deadline_ms": 45000, "idle_ms": 20000, "max_tool_calls": 8, "max_turns": 6,
              "max_output_tokens": 4096, "max_retries": 1 }
}
```

- `seed` is `null` for summary runs. `history` is `null` on a thread's first turn.
- Limits by kind (the API fills them in):

  | kind | deadline | idle | tool calls | max output tokens |
  |---|---|---|---|---|
  | explain | 45 s | 20 s | 8 | 4096 |
  | ask | 60 s | 20 s | 8 | 4096 |
  | summary | 90 s | 20 s | 12 | 6144 |

- The seed passages are the selected blocks, expanded by `packages/retrieval`'s structure-aware expansion under a budget of **≤ 3,000 estimated tokens**. The exact selected text goes first. This fixes the baseline answer that opened with the title and authors.

Response: `200 text/event-stream`, with events from `contracts/agent/run-events.schema.json`:

| event | data |
|---|---|
| `run` | `{run_id, model: "minimax/MiniMax-M3", sdk: "pi-coding-agent@0.87.1"}` |
| `status` | `{phase: "thinking"\|"tool"\|"retrying"\|"writing", tool?: "get_section", label?: string, attempt?: int, delay_ms?: int}` |
| `text` | `{delta}`, from the final assistant message only. The text of any message ending `stopReason:"toolUse"` is buffered and dropped (spike §6). |
| `usage` | `{input, output, cache_read, cache_write, reasoning, cost_usd_est}`, per assistant message |
| `done` | `{status: "complete"\|"partial"\|"error"\|"aborted", stop_reason, error: {code, retryable, message}\|null, final_text, handles_seen: string[], markers: string[], usage_totals: {input, output, cache_read, cache_write, reasoning, cost_usd_est}, tool_calls: int, turns: int, retries: int, first_text_ms: int\|null, latency_ms: int, entries: [...]}` |

- `entries` is `exportEntries()` after this turn. When the status is `aborted` or `error` with **no** final text, it is instead the entries from **before** this prompt, so a cancelled task is not resumed (spike-verify must-fix 5).
- `markers` holds the `[bN]` handles parsed from `final_text` with `/\[(b\d+(?:\s*,\s*b\d+)*)\]/g`, deduplicated.
- A comment heartbeat `: ping` goes out every 5 s.

Other endpoints:
- `DELETE /v1/runs/{run_id}` returns 204. It calls `session.abort()`, which resolves in about 2 ms (QUOTED). It is idempotent, and returns 404 for an unknown run.
- `GET /healthz` returns `{ok, sdk: "pi-coding-agent@0.87.1", pi_ai: "0.87.1", model: "minimax/MiniMax-M3", key_present, wiring_ok, active_runs}`.

Rules:
- **One run per thread at a time.** A second concurrent run for the same `history.session_id` gets 409 `busy`.
- A disposed session is never prompted. The wrapper tracks `disposed` and throws before any `prompt()` (must-fix 4).

### 3.3 Host guards (all tested offline; items from spike-verify "Must fix")

| Guard | Rule |
|---|---|
| Tool-call cap | Count `tool_execution_start`. Past `max_tool_calls` a tool returns "Tool budget exhausted; answer from what you have." At cap + 2, or past `max_turns`, the wrapper calls `session.abort()` → `error.code = tool_budget_exhausted`, and the status is `partial` if there is any final text. |
| Idle watchdog | Reset on every session event. After `idle_ms` of silence it calls `session.abort()` → `timeout` (spike b4 hung with no body-idle timeout). |
| Deadline | `AbortSignal.any([AbortSignal.timeout(deadline_ms), requestClosed])` → `session.abort()` → `timeout` or `aborted`. |
| Error classification | This is the agent's own classification, never Pi's regex. It uses the last assistant message's `stopReason` plus a leading `^(\d{3}) ` in `errorMessage`. |
| Citations | `markers` ⊆ handles the API issued **in this run** (the seed plus tool responses). The API re-checks this. |
| Tool errors | Tools throw short, user-safe text only, for example "Passage b9 is not available." They never include URLs, ids or stacks. |
| Raw messages | A raw `errorMessage` (provider JSON, request ids, install paths) is logged at debug level only. It is never sent in SSE. |

Error mapping:

| Condition | code | retryable |
|---|---|---|
| status 401 or 403 | `provider_auth` | false |
| 429 with `insufficient_quota\|quota\|billing\|balance` in the text | `quota` | false |
| other 429 | `rate_limited` | true |
| 5xx, "timed out" or "fetch failed" before any text | `upstream_unavailable` | true |
| 400 | `bad_request` | false |
| `stopReason: "length"` | `output_truncated` (status `partial`) | true |
| watchdog or deadline | `timeout` | true |
| client abort | `aborted` | true |
| tool HTTP failure | `tool_failed` | true |
| anything else | `internal` | false |

### 3.4 API side of the broker (`services/api/.../agent_client.py`)

- It uses `httpx.AsyncClient` streaming. `httpx` is promoted from the dev group to a runtime dependency; the lock is unchanged.
- Timeouts: connect 2 s → `agent_unavailable`. Read `idle_ms + 5 s`. Total `deadline_ms + 10 s`.
- **Retries.** Exactly one retry, only when the agent reports `upstream_unavailable` **before** any `text`. There is no retry after any text has reached the browser.
- **Spend cap.** Before a run, `cost_since(owner, now-24h) ≥ PAPERTREE_DAILY_BUDGET_USD` → 429 `budget_exhausted`.
- **Run token.** `secrets.token_urlsafe(32)`. The API stores `sha256`, `expires_at = now + deadline + 30 s` and `status='running'`. On `done` the status is set to `done`, `error` or `aborted`, and the token dies.
- **Datamark.** Minted with `papertree_prompts.mint_datamark()`, stored on `ai_runs` and sent in the request, so that the agent's system prompt can name it.
- **On `done`:**
  - map `markers` to block ids through `ai_run_handles`, dropping unknown markers and logging them;
  - mint each citation Anchor with `papertree_anchoring.capture_anchor(doc, block_id, anchor_id=cit_…, at, client="papertree-api/citations", target_kind="citation")`;
  - split `final_text` into sentences or bullets, and run `papertree_agent_tools.grounding.verify_grounding` per claim over the cited blocks' `resolvedText`, which sets `supported`. The verifier's word lists are **not** shown to the reader;
  - persist the message, citations, `ai_runs` usage and `ai_threads.agent_state_json = entries`, then emit `citations`, `usage` and `done`.
- **Summary** content is parsed from bullets `- … [bN]`. A bullet without a valid marker gets `supported: false`, and the summary status is `partial` if any bullet lacks one.

## 4. Internal paper tools (agent → API)

- All tools are mounted at `/internal/agent/runs/{run_id}/…` on the API app. They are rejected unless `request.client.host ∈ {127.0.0.1, ::1}`. Tests set `PAPERTREE_INTERNAL_ALLOW_TESTCLIENT=1`.
- Auth: `Authorization: Bearer <run token>`. The API looks up `run_grant(run_id, sha256(token))`, which requires `status == 'running'` and `now < expires_at`. It then calls `owner_for(grant.user_id)` and reads through `AgentDataHandle` (read-only, authorizer-guarded) plus a `PaperIndex`. The index is LRU-cached by `(user_id, paper_id, generation)`, 8 entries; the rebuild cost is 38–420 ms per request today (QUOTED, proposal A).
- **Server-side cap: 16 tool requests per run → 429 `tool_budget_exhausted`.**
- Every response is `200 application/json` `{text, handles: string[], next_cursor?: string|null}`:
  - `text` is model-facing, datamarked with the run's datamark through `render_untrusted_with_datamark`;
  - every block is headed `[bN] (p. {page_label} · {section title} · {type})`;
  - `handles` are assigned first-seen and persisted to `ai_run_handles`.

| Tool (TypeBox params) | Route | Returns |
|---|---|---|
| `get_outline()` | `GET …/outline` | The section tree: heading text from `blocks[heading_block_id]` (a `Section` has no title, AGENTS §4), level, page, and a handle for each heading block |
| `get_section({handle, cursor?})` | `GET …/sections/{handle}?cursor=` | The body blocks of the section that the heading or block belongs to, in `Page.flows` order, ≤ 6,000 characters per page, with `next_cursor` |
| `get_passage({handle})` | `GET …/passages/{handle}` | One block's `resolvedText`, plus its caption, figure or table relation if there is one |
| `search_passages({query, limit ≤ 8})` | `GET …/search?q=&limit=` | Top blocks by a new BM25 over `PaperIndex.reading_order()` text blocks (`packages/retrieval/.../lexical.py`). **On zero hits it returns the outline** (spike §3 lesson). |

Errors:
- 401 `auth_required` (bad or expired token);
- 404 `not_found` (unknown handle): the agent's tool throws "Passage bN is not available.";
- 429 `tool_budget_exhausted`.

## 5. Web client (`apps/web/src/lib/api/`)

- `client.ts` holds `API_BASE_URL`, `request<T>()` (Bearer, JSON, `ApiError`), `streamSse(url, body, signal): AsyncGenerator<SseEvent>` and `uploadWithProgress(file, {onProgress, signal})` (XHR).
- The 401 policy: **only** a 401 clears the session and goes to `/login?next=`. A network error or a 5xx never signs the user out (fixes frontend-map §1.3).
- Feature modules: `papers.ts`, `highlights.ts`, `threads.ts`, `summary.ts`, `usage.ts` and `boards.ts`. `lib/papertree.ts` is removed in S0 and its importers point at `lib/api/*`.

```ts
// apps/web/src/lib/api/types.ts, hand-written mirror of contracts/api/*.schema.json (ajv contract test in apps/web/test/contracts.spec.ts)
export type ErrorCode = 'auth_required'|'invalid_credentials'|'email_taken'|'not_found'|'validation_failed'|'empty_upload'
  |'payload_too_large'|'unsupported_media_type'|'not_parsed'|'not_failed'|'busy'|'stale_version'|'generation_not_found'
  |'anchor_incomplete'|'anchor_mismatch'|'budget_exhausted'|'agent_unavailable'|'not_configured'|'internal';
export type RunErrorCode = 'provider_auth'|'rate_limited'|'quota'|'upstream_unavailable'|'timeout'|'aborted'|'bad_request'
  |'tool_failed'|'tool_budget_exhausted'|'output_truncated'|'agent_unavailable'|'internal';
export class ApiError extends Error { constructor(readonly status: number, readonly code: ErrorCode, readonly detail: string, readonly retryable: boolean) { super(detail); } }
export type Processing = 'queued'|'reading'|'ready'|'partial'|'failed';
export interface JobSummary { job_id: string; kind: 'parse'; state: 'pending'|'running'|'succeeded'|'dead_letter'|'cancelled';
  step: 'parse'|'persist'|'promote'|null; done: number; total: number; attempt: number; max_attempts: number; error_code: string|null }
export interface LibraryPaper { paper_id: string; title: string; authors: string[]; original_filename: string|null; source_hash: string; page_count: number|null;
  processing: Processing; job: JobSummary|null; generation: number|null; parser_version: string|null; highlight_count: number;
  created_at: string; updated_at: string }
export interface ResolutionWire { generation: number; tier: 0|1|2|3|4|5|6; state: 'anchored'|'approximate'|'orphan';
  block_ids: string[]; score: number|null; reason: AnchorFailureReason|null; resolver_version: string }
export interface AnchorWire { anchor_id: string; ordinal: number; anchor: Anchor; resolution: ResolutionWire|null }
export type HighlightColor = 'amber'|'green'|'blue'|'pink'|'purple';
export interface Highlight { highlight_id: string; color: HighlightColor; note: string|null; created_generation: number;
  created_at: string; updated_at: string; anchors: AnchorWire[] }
export interface Citation { citation_id: string; ordinal: number; marker: string; page_index: number; anchor: Anchor; supported: boolean|null }
export interface RunSummary { run_id: string; model: string; provider: string; agent_sdk: string; input_tokens: number|null;
  output_tokens: number|null; cache_read_tokens: number|null; reasoning_tokens: number|null; cost_usd_est: number|null;
  first_text_ms: number|null; latency_ms: number|null; retries: number; tool_calls: number }
export interface Message { message_id: string; thread_id: string; ordinal: number; role: 'user'|'assistant'; content: string;
  status: 'streaming'|'complete'|'partial'|'error'|'aborted'; error: {code: RunErrorCode|ErrorCode; retryable: boolean; message: string}|null;
  generation: number; run: RunSummary|null; citations: Citation[]; created_at: string; completed_at: string|null }
export interface Thread { thread_id: string; kind: 'explain'|'ask'; title: string; origin_anchor: Anchor|null;
  created_at: string; updated_at: string; message_count: number }
export type SseEvent =
  | { event: 'run'; data: { run_id: string; thread_id: string|null; user_message_id: string|null; message_id: string; generation: number } }
  | { event: 'status'; data: { phase: 'thinking'|'tool'|'retrying'|'writing'; label?: string; attempt?: number; delay_ms?: number } }
  | { event: 'text'; data: { delta: string } }
  | { event: 'citations'; data: { items: Citation[] } }
  | { event: 'usage'; data: RunSummary }
  | { event: 'done'; data: { status: 'complete'|'partial'|'error'|'aborted'; error: {code: RunErrorCode|ErrorCode; retryable: boolean; message: string}|null; message_id: string } };
export interface Summary { generation: number; model: string; prompt_version: string; created_at: string; status: 'complete'|'partial';
  bullets: { text: string; citations: Citation[]; supported: boolean }[] }
export interface Board { board_id: string; paper_id: string; title: string; viewport: {x: number; y: number; zoom: number}|null; created_at: string; updated_at: string }
export interface CanvasNode { node_id: string; board_id: string; kind: 'excerpt'|'explanation'|'note'|'group'; group_id: string|null;
  x: number; y: number; w: number; h: number; z: number; title: string|null; body: string; source_anchor: Anchor|null;
  source_message_id: string|null; version: number; created_at: string; updated_at: string }
export type EdgeKind = 'supports'|'contradicts'|'derives_from'|'answers'|'compares'|'references'|'relates';
export interface CanvasEdge { edge_id: string; board_id: string; from_node_id: string; to_node_id: string; kind: EdgeKind; label: string|null }
// Anchor, AnchorFailureReason: re-exported from @papertree/anchoring (types.ts), never redeclared.
```

The following is fixed in S0 so that no two slices edit the same file:
- **`components/reader/actions.ts`**:
  - `ReaderActions = { openExplain(input: {anchor: Anchor; quote: string}): void; sendToCanvas(input: {kind: 'excerpt'; anchor: Anchor} | {kind: 'explanation'; messageId: string}): Promise<void>; focusAnchor(anchor: Anchor, opts?: {flash?: boolean}): void }`;
  - `<ReaderActionsProvider>` is mounted by `ReaderWorkspace`. `SourcePane`'s toolbar calls `openExplain` and `sendToCanvas`.
- The implementations live in:
  - `components/explain/useExplainActions.ts` (S6);
  - `components/canvas/sendToCanvas.ts` (S7).
  
  S0 commits both as stubs, together with `<ExplainPanel/>` exported from `components/explain/index.tsx`, which `ReaderWorkspace` mounts.
- **Reader position** (per viewer, `localStorage` in try/catch; a convenience, not data):
  - key `papertree/reader/<paper_id>`;
  - value `{v: 1, mode: 'source'|'guided'|'split', zoomMode, page: number, yPt: number, blockId?: string}`;
  - restore after a zoom or layout change: `{page, yPt}`. Restore across Source↔Guided: `blockId`.

## 6. Anchor persistence format

- **Record.** The persisted record is **`@papertree/anchoring` `Anchor` v1, verbatim** (`packages/anchoring/src/types.ts:216-233`), minus `resolution`. It is stored in `anchors.anchor_json`, `ai_citations.anchor_json`, `canvas_nodes.source_anchor_json` and `ai_threads.origin_anchor_json`. `contracts/anchor/anchor-v1.schema.json` is **hand-written** in S0, because no TS-to-schema generator is locked, and it is kept honest from both sides. `packages/anchoring/test/anchor-schema.spec.ts` validates every `captureAnchor` output with ajv and writes `contracts/anchor/examples/*.json`, and the API's pydantic `AnchorV1` model must accept every example.
- **Rules for new anchors (release):**
  - `id`: a client UUID. `doc.paperId`: the paper. `doc.pdfSha256`: the paper's `paper_owners.source_hash` (`sha256:<hex>`).
  - `doc.textStreamId` takes one of three forms:
    - `api/<paper_id>/g<generation>/<parser_version>` when the capture used IR offsets. This fixes N22, where every API paper was labelled `fixture/…`;
    - `pdfjs@5.7.284/page-text` when it used pdf.js item geometry;
    - `legacy-0001` for rows converted by 0005.
  - **User highlights must include** `PageSelector`, `TextQuoteSelector` and a `ShapeSelector` with ≥ 1 quad in IR space. `BlockSelector` and `TextPositionSelector` are included only when the capture was IR-stamped. `SectionPathSelector` is included when known.
  - **Quads come from glyph geometry, never from DOM rects.** On the IR path that is `quadsForRange` over the spans. On the pdf.js path it is the item `transform` and `width`, interpolated by the range's character ratio inside the item, through `bridge.ts`.
  - `provenanceClass` is `source` for highlights and excerpts. `targetKind` is `text`, or `table_cell` / `figure_region` when the pdf.js path's quads fall inside a table-cell or figure block by geometry. `created.mode` is `source` or `guided`.
- **Resolution (client, `resolveAnchor`), the paint rule.**
  - In Source mode an anchor with a `ShapeSelector` and `doc.pdfSha256 === paper.source_hash` **paints its stored quads**.
  - The ladder (T0 cache → T1 block + content hash → T2 → T3 quote → T4 shape → T5 section → T6 orphan) supplies `block_ids` and `state` for Guided marks, the Navigator, AI seeds and canvas "open source".
  - Confirmed tiers paint the matched range with `quadsForRange`, not the block polygon (fixes the 17x over-paint; MEASURED). This applies only when no usable ShapeSelector exists (legacy rows, citations).
  - **Orphan** means the stored quads are unusable (`pdfSha256` differs, or there are none) **and** the ladder finds nothing, or, in Guided, that the ladder finds nothing. An orphan goes to `UnanchoredTray` with its quote and reason, and is never painted on other text.
- **Normalisation (#122).** `normaliseForMatch` keeps its current behaviour: whitespace is deleted. The docstrings are fixed, and TS pins it with the same cases Python pins. `*Normalised` fields are persisted as produced.
- **Citations** are whole-block anchors minted server-side by Python `capture_anchor(..., target_kind="citation")`. They carry a BlockSelector, TextQuote, Shape and SectionPath. A chip click runs `focusAnchor`, which resolves the anchor, scrolls to it, and flashes the block polygon (or the quote range, if found) for 1.2 s.

## 7. Configuration (the only variables; both `.env.example` files are rewritten to exactly this list)

| Variable | Process | Default | Notes |
|---|---|---|---|
| `PAPERTREE_DATA_ROOT` | api, worker | `~/.papertree` | SQLite plus `uploads/ assets/ staging/` |
| `PAPERTREE_HOST` / `PAPERTREE_PORT` | api | `127.0.0.1` / `8000` | |
| `PAPERTREE_SESSION_HOURS` | api | 24 | |
| `PAPERTREE_MAX_UPLOAD_MB` | api | 100 | |
| `PAPERTREE_SIGNING_SECRET` | api | random per boot | asset URL HMAC |
| `PAPERTREE_AGENT_URL` | api | `http://127.0.0.1:8200` | |
| `PAPERTREE_AGENT_SECRET` | api, agent | **required for AI** | shared secret; the API answers 503 `not_configured` without it |
| `PAPERTREE_DAILY_BUDGET_USD` | api | `1.00` | per user, rolling 24 h, from `ai_runs.cost_usd_est` |
| `PAPERTREE_CORS_ORIGINS` | api | empty | extra origins, beyond the localhost regex |
| `PAPERTREE_AGENT_PORT` | agent | 8200 | binds 127.0.0.1 only |
| `PAPERTREE_API_INTERNAL_URL` | agent | `http://127.0.0.1:8000` | tool base (the API also sends `tool.base_url`) |
| `PAPERTREE_MINIMAX_API_KEY` | **agent only** | **required** | never `MINIMAX_API_KEY` (Pi's ambient fallback is deleted at boot) |
| `PI_OFFLINE=1`, `PI_TELEMETRY=0`, `PI_CODING_AGENT_DIR` | agent | set by the start script | defence in depth |
| `NEXT_PUBLIC_PAPERTREE_API_URL` | web | `http://localhost:8000` | the only base-URL variable (`NEXT_PUBLIC_API_URL` is deleted) |
| `NEXT_PUBLIC_PAPERTREE_FIXTURES` | web | **`off`** | `on` only in tests and demos; it gates `SAMPLE_PAPERS` too (#137) |

Removed: `PAPERTREE_LLM_API_KEY`, `PAPERTREE_LLM_MODEL`, `PAPERTREE_LLM_BASE_URL`, `PAPERTREE_LLM_TIMEOUT_SECONDS`, `PAPERTREE_VLM_API_KEY` and `LLM_API_KEY`.

## 8. Observability (journey E)

- **Log format.** One JSON line per event on stdout, in all three processes: `{ts, level, service: "api"|"worker"|"agent", event, request_id?, run_id?, job_id?, paper_id?, user_ref?: sha256(user_id)[:12], route?, status?, ms?, code_path?, provider?, model?, error_code?}`. Keys and emails are never logged.
- **API events:** `http.request`, `run.start`, `run.done`, `internal.tool`.
- **Worker events:** `job.claim` and `job.step` (`{step, ms, parser_version, status}`), `job.done`.
- **Agent events:** `agent.run.start`, `agent.tool` (`{name, handle?, ms}`), `agent.retry` and `agent.run.done` (`{stop_reason, tokens, cost_usd_est, retries, tool_calls}`).
- **`ai_runs.code_path` literals:**
  - `api.threads.explain>agent.v1.runs>pi.createAgentSession>minimax.anthropic-messages`;
  - `…ask…`;
  - `api.summary>…`.
- `GET /papers/{id}` and `GET /jobs/{id}` expose `parser_version`, `generation` and the step state. Both `/healthz` endpoints report versions and `key_present`.

## 9. Tests that pin these contracts (created in S0; each owner slice keeps them green)

- **pytest:**
  - `test_0005_on_saved_shapes` (the judge probe, ported, on fixture-built DBs shaped like both data roots);
  - `test_owned_tables_include_new`;
  - `test_highlight_write_is_atomic`;
  - `test_empty_anchors_is_422`;
  - `test_anchor_mismatch_is_422`;
  - `test_reparse_keeps_highlights`;
  - `test_list_library_one_row_per_paper`;
  - `test_contract_schemas_match_models` (drift);
  - `test_error_envelope_shape`.
- **vitest:**
  - `apps/web/test/contracts.spec.ts` (ajv against `contracts/api` and `contracts/agent` fixtures);
  - `packages/anchoring/test/anchor-schema.spec.ts`: every `captureAnchor` output validates against `anchor-v1.schema.json`.
- **agent (`node --test`):**
  - the emitted SSE for the faux-provider scripts equals `contracts/agent/fixtures/*.sse` in event order and shape;
  - wiring assertions, including the M5 and M6 isolation mutants: removing either the `tools` allowlist or `defaultTools: []` **must fail** the suite (spike-verify).
