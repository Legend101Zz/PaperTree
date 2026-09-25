# Reader release: slice plan

Companion to `ADR-002-reader-release.md` (the decision) and `contracts.md` (the shared contracts). **MEASURED** means the judge re-ran it (`judge-evidence/` (the architecture session's local evidence store, not committed; the migration probe is ported to `packages/db/python/tests/test_0005_saved_shapes.py` in S0)). **QUOTED** means it comes from a named report.

## 0. Conventions for every slice

- **Ownership.** One slice is one issue family, split into PRs of about 600 changed lines or fewer (AGENTS.md §1). "Owns" is **exclusive write access**. Anything outside it gets an issue, not an edit.
  - `contracts/**`, both lockfiles and `infrastructure/migrations/**` belong to S0. After S0 they change only through a contracts PR.
  - Every PR is a flat series rebased on `main`. After a merge, check it with `git merge-base --is-ancestor <head> origin/main` (AGENTS.md §4).
- **Gate at the end of every PR, run uncached:**
  ```
  pnpm exec turbo run lint --force && pnpm exec turbo run typecheck --force && pnpm exec turbo run test --force
  uv run pytest && uv run ruff check packages services && uv run ruff format --check packages services
  uv run mypy packages/*/python services/*/python && pnpm exec prettier --check . && pnpm --filter papertree-web build
  ```
  From S5 on, also `pnpm --filter @papertree/agent test`. From S0 on, also the slice's own `e2e/<slice>/*` Playwright specs.
- **Walk.** A slice is accepted **only** by its journey step, observed with:
  - a real **foreground** browser, with `document.visibilityState === 'visible'` recorded;
  - a real API and worker on a fresh data root under the slice's scratch dir;
  - the real agent with real MiniMax-M3 where AI is involved.

  The PR body carries the screenshots, the network log excerpt and the DB rows.
- **Data.** Never touch `~/.papertree-demo`. Migration checks run on backup copies only (`judge-evidence/migrate_probe.py`).
- **Worktrees.** Each slice gets its own worktree on the SSD, and runs **both** installs (`uv sync --locked --all-packages`, `pnpm install --frozen-lockfile`).

## 1. Order and parallelism

```
PR0 ─▶ S0 (serial: S0a…S0f) ─┬─▶ S1 ingest API+worker ──────┐
                             ├─▶ S2 parser + measurement ───┤   wave 1, 5 worktrees,
                             ├─▶ S3 library/upload/auth UI ─┤   owned paths disjoint (§3)
                             ├─▶ S4 reader + highlights ────┤   (S3/S4 walks need S1 merged)
                             └─▶ S5 agent + AI API ─────────┤
                                                            ├─▶ S6 explain UI   (needs S4 toolbar + S5)   wave 2
                                                            ├─▶ S7 canvas       (needs S4; AI cards need S5)
                                                            └─▶ S8 cleanup, one README, CI   (after S1–S7)
                                                                   └─▶ S9 final verification walk A–F
```

- **Merge order:** PR0 → S0 → S1 → {S2, S5} → S3 → S4 → S6 → S7 → S8 → S9. S2 may merge at any point after S0.
- **Effort** (agent-days, including walks): PR0 0.5 · S0 3 · S1 2–3 · S2 3–5 (time-boxed) · S3 2–3 · S4 4–5 · S5 4–5 · S6 3 · S7 3–4 · S8 2 · S9 1–2.
  - That is about **28–38 serial**, and about **12–15 calendar days** with 5 worktrees.
  - Add 30 % for defect classes the walks find. The baseline walk found 7 that no issue had (QUOTED, triage).

## 2. Slices

### PR0: Format only
- **depends_on:** none.
- **Owns:** the 25 files `prettier --check .` names at `6ff15ad` (QUOTED, gates §7: `AGENTS.md`, 18 in `packages/anchoring`, 1 in `packages/db/test`, 5 in `packages/ui`).
- **Closes:** #118 (format half).
- **Acceptance:** `pnpm exec prettier --check .` exits 0. There are no other diffs (`git diff --stat` shows only those files). It lands alone, because S4 edits `packages/anchoring`.

### S0: Contracts and foundations (serial; six PRs)
- **depends_on:** PR0.
- **Owns:**
  - `infrastructure/migrations/0005_reader_release.sql`;
  - `packages/db/**`, which is split into `papertree_db/{database.py (core), library.py, highlights.py, ai.py, canvas.py}`. Each module is committed as stubs, and each module plus its tests is handed to one later slice (§3);
  - `services/api/python/papertree_api/{app.py, routers/*.py (stubs), schemas.py, errors.py, logging.py, contracts.py, settings.py (new fields only)}`;
  - `services/document-worker/.../{assemble.py, pipeline.py}`, only for the `generation` parameter plumbing (default 1) and the vlm removal;
  - `services/agent/{package.json, README.md}` (dependencies only);
  - `contracts/**`;
  - `apps/web/src/lib/api/**` (the split: `client.ts`, `types.ts` and typed stubs), with `lib/papertree.ts` deleted and its importers repointed;
  - `apps/web/src/components/reader/actions.ts`, plus stubs `components/explain/{index.tsx, useExplainActions.ts}` and `components/canvas/sendToCanvas.ts`;
  - the `ReaderWorkspace.tsx` mount lines only;
  - `packages/ui/src/{styles.css, provenance.tsx}`: the three registers `PaperText`, `ReflowedText` and `AiText`, plus the missing `--pt-page-ground` and `--pt-panel-ground` tokens;
  - `apps/web/src/app/layout.tsx` (a system font stack replaces `next/font/google`);
  - `e2e/{playwright.config.ts, harness/*}`;
  - both lockfiles;
  - `.gitignore`;
  - `.github/workflows/ci.yml`, only to delete the better-sqlite3 preflight;
  - the zero-importer deletions in §R rows R1–R6.
- **PRs:**
  - **S0a:** delete the TS db twin (R5), then add 0005 and implement the Python ★ accessors.
  - **S0b:** the `app.py` router split (the route table before and after shows **additions only**) and the pydantic models for every route in `contracts.md` §2, as 501 stubs; GZip; the request-id middleware; the error envelope.
  - **S0c:** `contracts/` schemas and fixtures, and the agent run-request and run-events schemas.
  - **S0d:** the web `lib/api` split, the `ReaderActions` context, the UI registers, the font; R1–R4 deleted.
  - **S0e:** lockfile dependencies:
    - `@earendil-works/pi-coding-agent@0.87.1`, `@earendil-works/pi-ai@0.87.1` and `typebox@1.3.27` for `services/agent`;
    - `@xyflow/react@12.x` and `ajv` for web;
    - `@playwright/test` for the root;
    - `httpx` promoted to runtime for `services/api`.

    The PR body records the lockfile delta (the anti-slop rule in the root README).
  - **S0f:** vlm removal (R6), `apps/api/` in `.gitignore` (#136), and the e2e harness skeleton. The harness starts the API, worker, agent (faux mode, a stub until S5) and web on scratch ports, and foregrounds the tab.
- **Closes:** #121, #136 (gitignore part), N1, N2, N3, N4 (at the DB level), N27 (in part). It unblocks everything else.
- **Acceptance:**
  1. `judge-evidence/migrate_probe.py`, ported to `packages/db/python/tests/test_0005_saved_shapes.py`, builds both data-root shapes from fixtures and asserts every check in `contracts.md` §1. The probe is also run once by hand on **backup copies** of `~/.papertree-demo` and `baseline-data`, and its output is pasted in the PR.
  2. `test_ownership.py`'s owner-FK audit, extended to the 9 new tables, passes with at least 22 FKs checked.
  3. The route table diff shows additions only.
  4. `contracts.spec.ts` and `test_contract_schemas_match_models` pass.
  5. The full uncached gate is green, including prettier and `next build`.
  6. The existing reader still opens a fixture paper (smoke only).
- **Regression tests added:** atomic highlight write, `anchors: []` → 422, anchor mismatch → 422, re-parse keeps highlights, library one row per paper, contract drift.

### S1: Ingest loop (API and worker)
- **depends_on:** S0.
- **Owns:**
  - `services/api/python/papertree_api/{routers/papers.py, routers/jobs.py, library.py, assets.py, worker.py, __init__.py (docstring)}`;
  - `services/document-worker/python/papertree_document_worker/job.py`;
  - `packages/jobs/**`;
  - `packages/db/python/papertree_db/library.py` and `packages/db/python/tests/test_library.py`;
  - `services/api/python/tests/test_ingest_*.py`.
- **Closes:** #133 (page count), N12 and N14 (server side), N21, backend-map §2.3 (durable promotion, dead-letter retry, one row per generation, staging growth, unbounded upload), `parsed_at` constant, `asset://` for `<img>`.
- **Acceptance (Journey A and B.7, server side)**, in-process with the real worker, observed through HTTP responses and DB rows:
  - Upload YOLO: 202 with `page_count` 10, then `GET /papers` shows `queued`, then `reading` with step and done/total, then `ready`, with no client state.
  - `GET /papers/{id}/file` is 200 **before** the parse finishes.
  - A garbage `%PDF-` upload ends `failed`, `error_code: pdf_unreadable`, and `POST /retry` makes a **new** job.
  - Killing the worker process between persist and promote, then restarting it, still leaves the paper promoted.
  - `POST /reparse` makes gen 2, which is promoted. Gen 1 rows are kept. `GET /papers` still has 1 row.
  - A signed asset URL returns 200, and the same URL unsigned without Bearer returns 401.
  - `/ir` is sent gzip.
- **Regression tests:**
  - `test_dead_letter_upload_can_be_retried`;
  - `test_promote_is_a_durable_step` (kill between steps);
  - `test_reparse_creates_generation_2`;
  - `test_library_lists_pending_and_failed`;
  - `test_file_served_before_promotion`;
  - `test_upload_size_cap_413`;
  - `test_signed_asset_url`.

### S2: Parser fidelity, salvage, and the measured quality report
- **depends_on:** S0.
- **Owns:**
  - `services/document-worker/python/**` except `job.py`;
  - `packages/evaluation/**`;
  - `research/benchmarks/fresh/**` (new: `fetch_fresh.sh`, `fresh.sha256`, `gold-pp12.json`);
  - `research/benchmarks/probes/region-model/**` (new, outside every workspace);
  - `research/benchmarks/READER-RELEASE-PARSER.md` (the report).
- **Closes:** new issues "DDPM dead-letters on G7 image overhang" and "R21 after heading retype". **Advances** #2 and #103. **Needs the owner** for #54 (review of the fresh gold).
- **Work items:**
  1. G7: clip image placements to the crop box in `pdf._images`. MEASURED: the clip alone leaves 2× R21.
  2. R21: re-parent orphaned sections to the nearest preceding section one level up. MEASURED: clip + re-parent gives DDPM **25 pp, 463 blocks, 34 sections, complete, 4.0 s**.
  3. The salvage lane: when validation fails after repairs, emit `status: partial` text-only, never a dead-letter.
  4. Numeric-only heading suppression ("66.4", "830", …).
  5. The abstract-spill bound: an abstract ends at the first heading or at a column boundary.
  6. Column-aware paragraph splitting, using indent and line-gap cues.
  7. Title-first ordering on page 0.
  8. The scorer reports pooled reading order and the zero-pair page count beside the per-page mean.
- **Measurement protocol** (the report must follow it, and must never claim universal accuracy):
  - **Paper sets.**
    - (a) The 8 corpus papers.
    - (b) The fresh set: DDPM 2006.11239, YOLO 1506.02640, plus **4 more born-digital arXiv papers of different layouts** (a single-column NeurIPS style, an ACL two-column, an IEEE two-column, and one maths-heavy single-column), each fetched with sha256 pinned. PDFs are not committed, as with the corpus.
  - **Gold.**
    - Pages 1–2 of every fresh paper, written **from page images before any parser output is viewed** (the `ANNOTATION_GUIDE.md` rule; C's 71-anchor `gold.json` for YOLO/DDPM/ResNet is the seed).
    - The annotator and date are recorded **in the data**, and the owner reviews the gold before it gates anything.
    - The PDF's own outline (bookmarks) gives author heading gold where it exists (DDPM has 18).
  - **Per-paper table**, with n and "1 annotator, no IAA" in every row:
    - parse outcome (`complete` / `partial` / failed) and seconds per page;
    - peak RSS in a fresh subprocess (`/usr/bin/time -l`);
    - distinct gold paragraphs merged into one block;
    - body blocks mistyped;
    - headings typed / gold headings, and false headings;
    - title first (yes/no);
    - pairwise order within a page;
    - numbered captions paired with the right float kind (regex-label proxy);
    - Guided text cards under 60 chars, as a share;
    - **text-layer stamping by block type** (`judge-evidence/stamp_by_type.py`), prose share and table-cell share;
    - on the repo gold: `score_paper` per-page reading order, **pooled** reading order, zero-pair pages, macro-F1 and per-type F1.
  - **Baselines to beat** (MEASURED at `6ff15ad`):
    - repo gold: per-page reading order 0.586, pooled **0.900 (235/261)**, 11/36 zero-pair pages, macro-F1 0.320;
    - fresh pages 1–2: YOLO 23 gold paragraphs in 9 blocks with 6 mistyped; ResNet 14 in 5 with 4 mistyped (C's DDPM row is QUOTED: 3 in 1);
    - prose stamping 88.7 / 90.3 / 98.2 %;
    - table cells 2.1 / 4.9 / 0.6 % (YOLO / ResNet / Attention).
  - **Hard-case list:** every paper or page where a metric regresses or stays bad, with a screenshot and the block dump. Known today: YOLO title order and tables; ResNet run-in headings and the architecture table's private-use glyphs; Attention visualisation pages; neural-odes' 26 `undecodable_glyphs` spans.
- **Merge rule:**
  - The corpus plus the fresh set parse at **100 %** (partial counts as parsed).
  - No per-paper regression on the repo gold, on pooled reading order or on macro-F1. The parser is deterministic, so this is exact.
  - YOLO: title first, 0 numeric headings, and "2. Unified Detection" typed `heading`.
  - Merged gold paragraphs on fresh pages 1–2 reduced by at least half against the baseline.
  - Determinism: 20 runs byte-identical.
  - Peak-RSS ratchet of 520 MB holds on a quiesced machine (#129: note the load average).
- **RegionModel probe** (time-box **2 days** inside S2; never added to `uv.lock`, following DOCLING.md):
  - `regions.py` protocol plus a pymupdf-layout adapter in `research/benchmarks/probes/region-model/`, filling regions with PaperTree's own spans. It must emit **validating PaperIR**, not a scoring projection. C's prototype emitted items only.
  - It is scored on the same protocol against the S2 heuristic branch.
  - **Adopt only if all of these hold:**
    - merged plus mistyped on fresh pages 1–2 are at most 50 % of the heuristic branch;
    - no per-type F1 drop above 0.05 on heading, paragraph, caption, table or figure;
    - determinism holds, 20 runs on 2 machines;
    - peak RSS is under an **owner-approved** bar. MEASURED today: 844 MB on YOLO with pymupdf-layout.

    Otherwise record the numbers in the report and defer. Note that the typed hybrid prototype still mistyped 6 YOLO body paragraphs (MEASURED).
- **Regression tests:**
  - `test_ddpm_parses` (corpus-gated, fetch script named in the skip message);
  - `test_image_overhang_is_clipped` (a synthetic PDF, so CI has no corpus dependence);
  - `test_retyped_heading_reparents`;
  - `test_invalid_ir_salvages_to_partial`;
  - `test_no_numeric_only_headings[yolo]`;
  - `test_title_first[yolo]`;
  - the determinism and RSS tests, still passing.

### S3: Library, upload and auth UI
- **depends_on:** S0. Its walk needs S1.
- **Owns:**
  - `apps/web/src/app/{page.tsx, dashboard/**, login/**, register/**}`;
  - `apps/web/src/components/{library,auth,ui}/**`;
  - `apps/web/src/store/authStore.ts` and `apps/web/src/lib/{auth.ts, api/papers.ts}`;
  - the web tests `a11y.spec.tsx`, `touch.spec.tsx`, `library-cases.tsx`, `journey-wiring.spec.tsx`, and new `test/s3-*.spec.tsx`;
  - `e2e/s3/**`.
- **Closes:** #137; #133 (card); N12, N13, N14 (UI), N17 (audio claims out), N20 (write the missing auth-wiring test). Also the StrictMode `mountedRef` freeze, the login and register `detail` display, and the unassociated `<label>`s.
- **Acceptance (Journey A, real foreground Chrome, fixtures flag at its default `off`):**
  - Register, sign out (a `POST /auth/logout` is seen), sign in.
  - Upload YOLO and DDPM through the real `<input type=file>`. The progress bar moves.
  - Cancel mid-upload shows Cancelled, and no `paper_owners` row appears.
  - Both cards show Queued, then Reading (step n/3), then Ready, **without a reload**. The network log shows `GET /papers` polling only while a row is non-terminal.
  - A garbage PDF shows Failed with a readable reason, and Retry re-enqueues.
  - Delete removes the card.
  - At 390 px: `scrollWidth == 390`, and no audio claim or `SAMPLE_PAPERS` card is visible.
  - Opening a card requests `/papers/<that id>/file` and `/ir`, and no `/fixtures/`.
- **Regression tests:**
  - `e2e/s3/upload-row-updates.spec.ts` (the StrictMode freeze: the row leaves "Waiting to upload" after the 202);
  - `s3-library-states.spec.tsx` (queued, reading, failed with Retry, from API rows);
  - `s3-auth-wiring.spec.tsx` (the server `detail` is shown; a network error does not sign out).

### S4: Reader (selection, highlights, position, modes, paint)
- **depends_on:** S0. The re-parse and orphan steps of the walk need S1.
- **Owns:**
  - `apps/web/src/app/paper/[id]/read/**`, except the S0 mount lines;
  - `apps/web/src/components/reader/**`, except `actions.ts`;
  - `apps/web/src/lib/{paperSource.ts, fixtures.ts, pdf/**, api/highlights.ts}`;
  - `packages/anchoring/**`, except `python/**`;
  - `packages/ui/**`, except what S0 delivered. It is the owner after S0;
  - `services/api/python/papertree_api/routers/highlights.py`;
  - `packages/db/python/papertree_db/highlights.py` and its tests;
  - the web tests `stamp.spec.ts`, `reflow.spec.ts`, `perf.spec.ts`, `capture-wire.spec.tsx`, `citation-scroll.spec.tsx` and `citation-nav.spec.ts`, plus new `s4-*`;
  - `e2e/s4/**`.
- **Closes:** #138, #132, #122 (docstrings and a TS pin); N5, N6, N7, N15, N22. Also:
  - the detached `ArrayBuffer`: a hoisted `PdfDocumentProvider` (one `getDocument` per session) plus a copy per open;
  - the toolbar under the text layer (a portal);
  - the 17x whole-block paint;
  - T2 multi-block, and the `document.ts:462` no-op;
  - Guided crops (signed URLs) and the Guided register;
  - the PDF error and loading state;
  - the 390 px reader toolbar;
  - the dead Pages tab, and the removal of the Notes and Chapters tabs.
- **Work items:**
  1. The capture fallback: pdf.js item geometry through `bridge.ts` for unstamped items; `locateByText` first-occurrence is removed.
  2. The paint rule of `contracts.md` §6.
  3. One highlight holding N anchors.
  4. Load and re-resolve on mount, then `PUT …/resolutions`.
  5. Guided shows marks through `resolveCrossMode`, or "not available in this view".
  6. Position `{page, yPt, blockId}`.
  7. `focusAnchor`, with a 1.2 s flash.
  8. Enable the toolbar's Ask (→ `openExplain`) and Send to canvas (→ `sendToCanvas`).
- **Acceptance (Journey B, real foreground Chrome, an uploaded YOLO):**
  - **Mouse**-drag and **mouse**-click Highlight on:
    - (a) a body sentence;
    - (b) the table cell "66.4";
    - (c) a Figure 1 label.

    The overlay bbox is within 2 px of the selection's own line rects. `POST /highlights` returns 201, and the rows are visible in sqlite.
  - After a reload, the same polygons repaint (quads equal within 0.5 pt), and the Navigator's Highlights tab lists all three.
  - Zoom 100 → 150 % and "fit width" keep the same line at the top (±1 line).
  - Source → Guided → Source and Source → Split keep pages rendering, the position and the highlight. A debug counter shows `getDocument` was called once. Guided shows mark (a), or says "not available in this view" for (b) and (c).
  - After S1's `POST /reparse`, the highlights repaint **byte-identically** (the stored-quad rule), and `anchor_resolutions` gains gen-2 rows.
  - An anchor from a test DB with a foreign `pdfSha256` and an absent quote appears in the Unanchored tray with its reason, and is **not** painted anywhere.
  - At 390 px the toolbar fits and the page defaults to fit-width.
- **Regression tests:**
  - `e2e/s4/toolbar-hit-test.spec.ts`: `elementFromPoint` at the Highlight button's centre is the button;
  - `s4-remount-arraybuffer.spec.ts`;
  - `s4-overpaint.spec.ts`: painted over selected area ≤ 1.05 on real parses (corpus-gated). MEASURED baseline: median 17.3x;
  - `s4-stored-quads.spec.ts`: re-parse gives identical paint. MEASURED motivation: re-derived quads drift by a median of 0.00 pt, but up to 5.6 pt;
  - `s4-reanchor-cross-parser.spec.ts`: A's probe, ported. Baseline 201 anchors, 0 orphans, 199 verified by text; the 2 T2 boundary cases get fixed;
  - `s4-table-cell-capture.spec.ts`: an unstamped item yields quads inside its item box;
  - `quotenorm` TS pin (#122).

### S5: Pi agent service and the AI API
- **depends_on:** S0.
- **Owns:**
  - `services/agent/**`;
  - `services/api/python/papertree_api/{routers/threads.py, routers/summary.py, routers/usage.py, routers/internal.py, agent_client.py, evidence.py, deps.py, settings.py (LLM field removal)}`;
  - deletes `ask.py` and `tests/test_ask.py`;
  - `packages/agent-tools/**`, `packages/prompts/**`, `packages/retrieval/**` and `packages/anchoring/python/**`;
  - `packages/db/python/papertree_db/ai.py` and its tests;
  - `contracts/agent/fixtures/*`, additive only.
- **Closes:** #133 (AI half), #124, #120 (the model-facing "974" strings go with `tools.py`); N11, N25, N26 (`ask.py` / `liveAnswerSource` comments), N28. Also the `ProviderError` → 500 bug, and the 4096-token 504, which becomes `partial` / `output_truncated`.
- **Acceptance:**
  1. **Install:** `pnpm ls @earendil-works/pi-ai` shows 0.87.1 only (or the documented npm fallback).
  2. **Offline** (`node --test`, network denied with `sandbox-exec` on macOS or `unshare -n` in CI), on the faux provider:
     - the tool loop;
     - the tool cap: 10 requested gives 8 served, then the stop (A's live run fired it: QUOTED);
     - the idle watchdog aborts a stall at 20 s ± 1;
     - the deadline;
     - error mapping for every row of `contracts.md` §3.3, on mock-anthropic;
     - a 400 containing "500" is **not** retried;
     - seen-handle citation validation;
     - `exportEntries` restore;
     - abort restores the pre-prompt entries (verify must-fix 5);
     - a disposed session throws;
     - the M5 and M6 isolation mutants fail the suite;
     - 0 reads of `~/.pi` and 0 DNS lookups;
     - emitted events equal the fixtures.
  3. **API:** a `FakeAgent` replaying the fixtures drives create, follow-up, cancel, partial, error, `busy`, `budget_exhausted` and the tool-token checks: expired → 401, foreign run → 401, the 17th call → 429.
  4. **Live smoke** (gated on the key; it skips loudly), on YOLO through HTTP: explain, follow-up and summary, **10 explain runs** reporting p50 and p90 time to first text.
     - QUOTED A live: 3.8 s first text, 7.7 s done, $0.0011.
     - Bar: p50 first text ≤ 5 s.
     - It also reports the input-token overhead of datamarking, with and without, on the same seed.
  5. **Journey E:**
     - the `ai_runs` row carries `code_path`, `provider`, `model`, `agent_sdk`, tokens and cost;
     - one `run_id` appears in both services' logs;
     - the agent's sockets reach only `api.minimax.io` and 127.0.0.1;
     - `~/.pi` is unchanged (mtime/size/atime snapshot);
     - `PAPERTREE_MINIMAX_API_KEY` appears in no file, and is absent from the API process environment.
- **Regression tests:** all of the above, as committed tests.

### S6: Explain panel UI
- **depends_on:** S4 (toolbar and `focusAnchor`), S5.
- **Owns:**
  - `apps/web/src/components/explain/**`;
  - `apps/web/src/components/inspector/**` (deleted; `AnswerView` and `CitationChip` move into `explain/`, and chip keys become `citation_id`);
  - `apps/web/src/lib/api/{threads.ts, summary.ts, usage.ts}`;
  - the web tests `ask-wiring.spec.tsx` and `interpretation.spec.tsx` (rewritten), plus new `s6-*`;
  - `e2e/s6/**`.
- **Closes:** #133 (UI), N8, N9, N10. The fixture echo presented as an answer is removed.
- **Acceptance (Journey C, real foreground Chrome, real MiniMax, YOLO):**
  - Select, then toolbar Ask: a right drawer at 1440, a bottom `Sheet` at 390 (`scrollWidth 390`).
  - Streamed text, with a status label for the tool step. No raw JSON, no block ids and no verifier word lists appear.
  - Type a follow-up that says "that": the answer uses the prior turn.
  - **Click a chip:** the cited block scrolls on screen and flashes. `elementFromPoint` at the flash centre lies inside the cited block's text-layer span.
  - Summary: the progress label, then 5–8 bullets, each with working chips. A reload shows the cached summary without a new run (`ai_runs` count unchanged).
  - The agent is killed mid-answer: the designed error appears, with Retry, and the partial text is kept (`status: partial`).
  - A revoked key → `provider_auth`, with guidance.
  - The usage line shows tokens and "≈ $ (estimate)".
  - Paper quotes render in `PaperText` and the model's text in `AiText` ⊙. A screenshot pair shows the distinction in both themes.
- **Regression tests:**
  - `s6-one-ask-per-mount.spec.tsx`: a second ask and a new selection reset the panel;
  - `s6-sse-client.spec.ts`;
  - `e2e/s6/explain-faux.spec.ts` on the faux agent.

### S7: Minimal intentional canvas
- **depends_on:** S4. The explanation nodes need S5.
- **Owns:**
  - `apps/web/src/app/paper/[id]/canvas/**`;
  - `apps/web/src/components/canvas/**` (including `sendToCanvas.ts`);
  - `apps/web/src/lib/api/boards.ts`;
  - `services/api/python/papertree_api/routers/boards.py`;
  - `packages/db/python/papertree_db/canvas.py` and its tests;
  - new `s7-*` tests and `e2e/s7/**`.
- **Closes:** #6 (F5.1, F5.3, F5.7, F5.8, plus groups and 7 labelled edge kinds; F5.2's full node family, minimap, frames, deep undo and 500-node performance are deferred). N16.
- **Acceptance (Journey D, real foreground Chrome):**
  - Send a passage and then an explanation. Open the canvas: exactly 2 nodes.
  - Drag a node: the network shows **one** PATCH.
  - Connect them with "supports", and the label is visible.
  - Edit a note. Group two nodes.
  - Reload: positions, edge, label and group are identical.
  - Delete a node, reload: it is gone, with its edges.
  - "Open source" on the excerpt goes to the reader, which scrolls to and flashes the passage.
  - Keyboard reachable. Usable at 390 px (pan and zoom by touch, no hover-only action).
- **Regression tests:**
  - `s7-no-autogen`: a paper with 30 highlights and 20 threads gives `GET /board` → `board: null`, 0 nodes, and 0 rows written;
  - `e2e/s7/settled-canvas.spec.ts`: 0 requests in 30 s after load;
  - `s7-stale-version-409`;
  - `s7-group-delete-ungroups` (the trigger; MEASURED on the copy).

### S8: Cleanup, one README, CI
- **depends_on:** S1–S7.
- **Owns:**
  - `README.md`;
  - `.env.example` and `apps/web/.env.example`;
  - `docker-compose.yml` and `apps/web/Dockerfile` (deleted);
  - `.github/workflows/ci.yml`;
  - `AGENTS.md`;
  - `apps/web/test/reachable.spec.ts`;
  - `packages/memory/**`;
  - `apps/web/src/lib/utils.ts`;
  - `apps/web/src/app/globals.css` (the v1 canvas CSS);
  - `apps/web/package.json` (dependency removals) and both lockfiles (removals only);
  - `research/build/README.md`;
  - the tracker text (#7 gate item 2, #139 §2.1, #2, #54: corrections by comment).
- **Closes:** N18, N19, N23, N24, N26 (the rest), #118 (CI step), #129 (the AGENTS note plus a load-aware skip in the RSS test), #128 (close), #120 (docs).
- **Acceptance (Journey F):**
  - CI runs, uncached:
    - lint, typecheck, test, pytest, ruff, mypy, **prettier**, **next build** and the agent tests;
    - the corpus fetch, so that about 220 Python tests and the 10 `stamp.spec` tests run in CI (QUOTED, gates §9);
    - a Playwright A–D job against the API, worker, faux agent and web on a PyMuPDF-generated PDF plus one corpus PDF.
  - The README quick start, followed **verbatim** on a fresh worktree, brings up all four processes, and an A→D smoke passes (walked).
  - The extended `reachable.spec` covers `lib/`, `store/`, `types/` and dead exports, and fails on a planted dead module.
  - `/usr/bin/grep -a` finds no references to any §R module.
  - The memory security tests keep **every** guard assertion (count before = count after) after the fixtures are re-seeded with raw INSERTs.

### S9: Final verification walk, A–F
- **depends_on:** S8.
- **Owns:** `research/build/READER-RELEASE-RESULT.md` and `PaperTree-evidence/04-release-walk/**` (screenshots, logs, DB dumps). It writes no product code. Each defect found becomes an issue, fixed by the slice that owns the path.
- **The walk:**
  - a fresh data root;
  - `migrate_probe` on a backup copy of `~/.papertree-demo`: the legacy highlight opens painted over "Microsoft Research", p. 1;
  - A–D exactly as in S3, S4, S6 and S7, on YOLO, DDPM and one fresh non-corpus paper from the S2 set;
  - E: for every journey step, the request id, job and run rows, and the provider seen at socket level;
  - F: every gate uncached, with counts compared against the baseline (1,733 py + 1,389 ts QUOTED; the new totals reported);
  - 1440 and 390 px screenshots of the library, the upload states, the reader in 3 modes, the selection, highlights, the explain panel, the summary and the canvas, in both themes;
  - axe run with 0 serious violations.
- **Output:** a verdict table per journey step (PASS / PARTIAL / FAIL, with evidence). PARTIAL is never rounded up (AGENTS.md §2).

## 3. Ownership disjointness check (wave 1)

| Path | S1 | S2 | S3 | S4 | S5 |
|---|---|---|---|---|---|
| `services/api/.../routers/` | papers, jobs | – | – | highlights | threads, summary, usage, internal |
| `services/api/.../` other | library, assets, worker | – | – | – | agent_client, evidence, deps, settings |
| `services/document-worker/**` | `job.py` | everything else | – | – | – |
| `packages/db/python/papertree_db/` | `library.py` | – | – | `highlights.py` | `ai.py` |
| `packages/jobs`, `packages/evaluation` | jobs | evaluation | – | – | – |
| `packages/anchoring` | – | – | – | TS (`src`, `test`) | `python/` |
| `packages/agent-tools`, `prompts`, `retrieval` | – | – | – | – | all |
| `packages/ui` | – | – | – | yes (after S0) | – |
| `apps/web/src/app` | – | – | `page`, `dashboard`, `login`, `register` | `paper/[id]/read` | – |
| `apps/web/src/components` | – | – | `library`, `auth`, `ui` | `reader` | – |
| `apps/web/src/lib` | – | – | `auth.ts`, `api/papers.ts` | `paperSource`, `fixtures`, `pdf`, `api/highlights.ts` | – |
| `e2e/` | – | – | `s3/` | `s4/` | (faux agent mode in `services/agent`) |
| `research/benchmarks/` | – | fresh, probes, report | – | – | – |

Wave 2: S6 owns `components/explain`, `components/inspector` and `lib/api/{threads,summary,usage}`. S7 owns `app/paper/[id]/canvas`, `components/canvas`, `lib/api/boards`, `routers/boards` and `papertree_db/canvas`. Neither overlaps the other, or any wave-1 path.

## §R. Removal list (all references checked with `/usr/bin/grep -a -rl` over `apps packages services .github` plus root configs, excluding node_modules, .next, dist, archive, .venv and __pycache__)

| # | Path | When | Why | References found (MEASURED) |
|---|---|---|---|---|
| R1 | `apps/web/src/lib/api.ts` (v1 client) | S0d | Dead. Its 401 interceptor targets the old `token` key. | Only `test/journey-wiring.spec.tsx:111`, a negative assertion that is deleted with it, and a comment in `lib/papertree.ts` |
| R2 | `apps/web/src/store/readerStore.ts` | S0d | v1 store | none |
| R3 | `apps/web/src/lib/anchorStore.ts` | S0d | A duplicate in-memory store (NUL bytes) | none (`grep -a`) |
| R4 | `apps/web/src/types/index.ts` | S0d | v1 types | `store/authStore.ts:30` (`User` moves into `authStore.ts`), plus the dead R1 and R2; a comment in `components/library/types.ts` and in root `package.json` prose |
| R5 | `packages/db/{src,test,package.json}` (TS twin), the `ci.yml:108-124` preflight, and `test_migrations.py::test_a_database_migrated_by_typescript_is_a_noop_for_python` | S0a, before 0005 | Doubles every schema change; its tests encode the 0001 highlight shape | No `@papertree/db` importer outside `packages/db`. The Python owner-FK audit exists (`test_ownership.py:438`). |
| R6 | `services/document-worker/.../vlm.py`, the VLM branch and `vlm_*` fields in `pipeline.py`, the VLM case in `tests/worker/test_equations.py`, and the `KNOWN_CONSTANT_COPIES` vlm entry | S0f | Gated off (`vlm_max_calls=0`, no setter). A second MiniMax client and a second key, which bypass the Pi ruling. | `pipeline.py:51,75-95,840`, `tests/worker/test_equations.py`, `agent-tools/tests/test_runtime_swappable.py:325` (a ledger that fails if it outlives the file, so it is removed in the same PR), a comment in `provider.py` |
| R7 | `components/library/types.ts` `ApiPaperRow` / `libraryPaperFromApi`; `SAMPLE_PAPERS` default listing; `audio:'ready'`; offline "generated audio" copy | S3 | v1 bridge; #137; Epic 4 deferred | Comments only in `journey-wiring.spec.tsx:117` and `services/api/tests/test_end_to_end.py:66` |
| R8 | `lib/fixtures.ts` `loadPaper` and its cache; `NotParsedYet` copy; Navigator Notes and Chapters tabs | S4 | Duplicate loader; stale copy; placeholder tabs (Chapters promises audio) | `loadPaper`: comments in `read/page.tsx:29` and `lib/paperSource.ts:9-30` only |
| R9 | `services/api/.../ask.py` and `tests/test_ask.py` | S5 | Replaced by threads plus the agent | `app.py` (the mount) only |
| R10 | `packages/agent-tools/.../{turn,provider,runtime,registry,results,tools}.py` and tests `test_turn_loop`, `test_runtime_swappable`, `test_live_provider`, `test_registry`, `test_tools` | S5 | The Python turn loop, the OpenAI-compatible provider and the 18-tool registry (6 tools could never return data, QUOTED) | `services/api/{ask,deps,settings,app}.py` (rewired), each other, and the package `__init__`. **Kept:** `answer.py`, `grounding.py`, `paperview.py`, `schema.py`, `_agent_tools_fixtures.py`. `packages/evaluation/.../grounding.py:68,73` imports `answer` and `schema`, and `test_grounding_verifier.py` imports the fixtures. |
| R11 | `packages/prompts/.../{caps,system,advisory}.py` and tests `test_caps`, `test_system_prompt`, `test_advisory` | S5 | The seven-toolset matrix is used by nothing after R9 and R10. `advisory` has 0 runtime importers. | agent-tools `registry`, `tools`, `runtime` (R10), `ask.py` (R9), the prompts `__init__` (trimmed). **Kept:** `untrusted`, `sanitise`, `channels`. |
| R12 | `apps/web/src/components/inspector/{Inspector.tsx, liveAnswerSource.ts, fixtureAnswerSource.ts, citations.ts, types.ts, index.ts}` | S6 | The one-ask state machine, the unlabelled fixture echo, and client-side citation minting (replaced by server Anchors) | `ReaderWorkspace.tsx` (the S0 mount is repointed), the tests `ask-wiring`, `interpretation` and `citation-nav` (rewritten by S6 and S4), `lib/papertree.ts` (removed in S0). `AnswerView` and `CitationChip` move, not deleted. |
| R13 | `packages/memory/.../{store,validation,records}.py` and tests `test_memory_stores`, `test_proposal_validation` | S8 | The write side, with 0 product callers. The six 0003 tables hold 0 rows in the demo data (QUOTED). | `MemoryStore(`: an `__init__.py:83` docstring, `test_security_injection.py` and `test_security_isolation.py` (re-seeded with raw INSERTs), `agent-tools/tests/test_tools.py` (R10). `ProposalValidator`: `tools.py` (R10). `records` in `errors.py` is a docstring mention only. **Kept:** `agent_handle`, `guard`, `errors`. |
| R14 | `docker-compose.yml`, `apps/web/Dockerfile` | S8 | v1 (Mongo, OpenRouter, npm) and cannot build | `README.md` only |
| R15 | `.env.example`, `apps/web/.env.example` (**replaced**), `README.md` (**rewritten**) | S8 | Wrong variables (`LLM_API_KEY`, `NEXT_PUBLIC_API_URL`); v1 run instructions | – |
| R16 | `lib/utils.ts` `formatDate`, `truncateText`, `getTextContext`; the `react-katex` dependency, plus any of `react-markdown`/`remark-*`/`rehype-katex` that S6 did not import; `globals.css` v1 react-flow/`.canvas-*` rules; `touch.spec.tsx` stale `V1_QUARANTINE` | S8 | Unused | `utils`: none (`cn` is kept). The dependencies had 0 imports at `6ff15ad` (QUOTED, frontend-map §8.3; re-checked in S8 after S6). |
| R17 | Runtime data: `<root>/staging/*.paperir.json` after promotion | S1 (worker) | It grows forever (QUOTED, backend-map §2.3) | – |

**Not removed.** Each of these was checked and has a live consumer:
- `packages/anchoring/python`, wired for citations in S5;
- `packages/document-ir` `validate.ts` (test-only, conformance);
- `packages/anchoring/src/perturb.ts` (test support);
- `packages/evaluation` (the S2 scorer);
- the 0003 memory tables (forward-only; an optional drop later);
- `apps/api/` in the main checkout: **owner action** (#136). Agents only gitignore it.
