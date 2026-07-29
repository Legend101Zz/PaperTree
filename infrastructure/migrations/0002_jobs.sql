-- 0002_jobs.sql — the durable job runner's two tables (EPIC-00 F0.6).
--
-- Applied by the SAME runner as 0001_core.sql (packages/db/{src/migrate.ts,
-- python/papertree_db/migrate.py}). F0.6 does not ship a second migration runner, and the
-- statement separator is the same `--;;` line.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THESE TWO TABLES AND NOTHING ELSE
--
-- The durability claim is small and mechanical: a job is a row, and every step it has
-- completed is a row. A worker that dies loses nothing that was committed, and a worker
-- that starts finds the completed steps already there. There is no queue server, no event
-- log, no replay engine — research/literature/21-durable-workflows.md priced those and
-- none of them fits "SQLite, no Docker, laptop".
--
--   jobs       — one row per unit of work. Carries the state machine, the retry budget,
--                the cancellation flag and the progress counter.
--   job_steps  — one row per (job, step name). A succeeded row is a CHECKPOINT: the
--                runner returns its recorded `result` instead of calling the step body
--                again. That is what makes a restart resume at the interrupted step and
--                what makes an already-committed side effect not happen twice.
--
-- OWNERSHIP (findings.md §F). A job is tenant data: its payload names a paper, its
-- `error` can quote document content, and its progress leaks what a tenant is doing.
-- So `jobs.owner_id` is NOT NULL with an FK to `users`, `job_steps` reaches `jobs`
-- through the COMPOSITE key (owner_id, job_id) — the same rule every FK in 0001 obeys,
-- so a step cannot belong to a different tenant than its job — and the idempotency key
-- is unique PER TENANT. A globally unique idempotency key would let one tenant's enqueue
-- silently return another tenant's job, which is findings.md §F1 with a different noun.
--
-- TIME IS STORED TWICE, ON PURPOSE. `run_after` and `lease_expires_at` are REAL unix
-- epoch seconds because they are PREDICATES — the claim query range-scans them, and
-- lexicographic comparison of ISO-8601 strings is not safe when `isoformat()` drops a
-- zero microsecond field. `created_at`/`updated_at`/`started_at`/`finished_at` are ISO
-- TEXT because they are only ever displayed. It is the same split 0001 makes between the
-- exploded `bbox` columns (indexed, range-scanned) and the JSON `polygon` (never a
-- predicate).
-- ─────────────────────────────────────────────────────────────────────────────

-- jobs — the state machine.
--
--                      enqueue
--                         │
--                         ▼
--                    ┌─────────┐   claim (takes a lease)   ┌─────────┐
--                    │ pending │ ────────────────────────► │ running │
--                    └─────────┘                           └─────────┘
--                      ▲     ▲                              │ │ │
--   step raised and    │     │  lease expired (the worker    │ │ └─ handler returned
--   attempt < max:     │     │  was SIGKILLed): reclaimed    │ │    ──► succeeded
--   run_after =        │     │  by the next worker ──────────┘ │
--   now + backoff  ────┘     └──────────────────────────────────┘
--                                                            │
--                        cancel_requested seen at a step boundary ──► cancelled
--                        step raised and attempt >= max_attempts  ──► dead_letter
--
-- succeeded / cancelled / dead_letter are terminal: nothing claims them again.
-- There is deliberately no `failed` state — "failed but will retry" is `pending` with a
-- future run_after, and "failed for good" is `dead_letter`. A third spelling would be a
-- state nothing ever reads.
CREATE TABLE jobs (
  job_id           TEXT    PRIMARY KEY,
  owner_id         TEXT    NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  kind             TEXT    NOT NULL,
  -- The caller's dedup key. Enqueuing twice with the same (owner, kind, key) returns the
  -- FIRST job_id and creates nothing — so an HTTP retry does not parse a PDF twice.
  idempotency_key  TEXT    NOT NULL,
  payload          TEXT    NOT NULL CHECK (json_valid(payload)),
  state            TEXT    NOT NULL
                     CHECK (state IN ('pending', 'running', 'succeeded', 'cancelled',
                                      'dead_letter')),
  -- Set by a DIFFERENT process than the one running the job. The runner reads it at every
  -- step boundary, which is what "honoured within one step" means.
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  -- Incremented BY THE CLAIM, not by the failure: a job whose worker was SIGKILLed has
  -- consumed an attempt exactly like one whose step raised. Otherwise a job that reliably
  -- kills its worker retries for ever.
  attempt          INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts     INTEGER NOT NULL CHECK (max_attempts >= 1),
  run_after        REAL    NOT NULL,
  lease_owner      TEXT,
  lease_expires_at REAL,
  progress_done    INTEGER NOT NULL DEFAULT 0 CHECK (progress_done >= 0),
  progress_total   INTEGER NOT NULL DEFAULT 0 CHECK (progress_total >= 0),
  progress_note    TEXT,
  error            TEXT,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  UNIQUE (owner_id, kind, idempotency_key),
  -- The composite FK target for job_steps. Same rule as every table in 0001.
  UNIQUE (owner_id, job_id)
) STRICT;
--;;
-- TWO partial indexes, one per branch of the claim query's OR, not one index over
-- (state, run_after). MEASURED with EXPLAIN QUERY PLAN: a single (state, run_after) index
-- partial on state IN ('pending','running') is NOT USED — the planner reports `SCAN jobs`,
-- because the second branch predicates on lease_expires_at and SQLite's OR optimisation
-- needs every branch independently indexable. With these two the plan is `MULTI-INDEX OR`
-- over both, at 0 rows and at 5,000 rows after ANALYZE. An index the planner ignores is
-- worse than no index: it costs every write and reads as coverage that is not there.
CREATE INDEX jobs_due ON jobs (run_after) WHERE state = 'pending';
--;;
CREATE INDEX jobs_expired_lease ON jobs (lease_expires_at) WHERE state = 'running';
--;;
CREATE INDEX jobs_by_owner ON jobs (owner_id, created_at DESC);
--;;

-- job_steps — the checkpoint ledger, and the only reason any of this is durable.
--
-- PRIMARY KEY (job_id, step_name): THE STEP NAME IS THE STEP'S IDEMPOTENCY KEY. A step
-- name is claimed once per job; re-running the job finds the succeeded row and returns
-- `result` without calling the body. A failed row is overwritten by the next attempt, so
-- `error`/`attempt` describe the most recent failure.
--
-- HONEST BOUNDARY: the checkpoint is committed AFTER the step body returns, so the
-- guarantee is "a step whose checkpoint committed never runs again" — at-least-once, not
-- exactly-once, for a side effect that lands in the window between the effect and the
-- commit. Buying exactly-once would mean handing the step body a transaction handle it
-- must enlist in, i.e. a framework. The named test measures the guarantee that is
-- actually made: the killed step re-runs, the completed step does not.
CREATE TABLE job_steps (
  job_id      TEXT    NOT NULL,
  owner_id    TEXT    NOT NULL,
  step_name   TEXT    NOT NULL,
  -- Ordinal within the job, for reading the ledger back in execution order.
  step_index  INTEGER NOT NULL CHECK (step_index >= 0),
  state       TEXT    NOT NULL CHECK (state IN ('running', 'succeeded', 'failed')),
  attempt     INTEGER NOT NULL CHECK (attempt >= 1),
  result      TEXT             CHECK (result IS NULL OR json_valid(result)),
  error       TEXT,
  started_at  TEXT    NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (job_id, step_name),
  FOREIGN KEY (owner_id, job_id) REFERENCES jobs (owner_id, job_id) ON DELETE CASCADE
) STRICT;
--;;
CREATE INDEX job_steps_by_job ON job_steps (owner_id, job_id, step_index);
