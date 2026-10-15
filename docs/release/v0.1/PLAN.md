# PaperTree v0.1 release plan

Tracker: #141. Prompt: `research/build/reader-release/V0.1-RELEASE-PROMPT.md`. Started 2026-10-15 12:00 IST,
hard stop 22:00 IST. The orchestrator (Opus 5.5) keeps the plan, the contracts, merges, gates and the final
product judgement; every implementer, reviewer and fixer is a Sonnet workflow agent. This file is updated as
the release moves; the numbers in it are re-measured, never carried over.

## Owner decisions (2026-10-15)

| Question                               | Decision                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-002 §10 defaults                   | Accepted: Guided = verbatim paper text with a "Reflowed from the PDF" marker (⊙ only for AI); pymupdf-layout not shipped; memory write side (R13) deleted in S8 with every security guard kept; `PAPERTREE_DAILY_BUDGET_USD=1.00`                                                                  |
| Datamark the seed quote                | Yes                                                                                                                                                                                                                                                                                                |
| Summary with no valid citation markers | `partial` with a warning, not `failed`                                                                                                                                                                                                                                                             |
| Where the release goes                 | GitHub release `v0.1.0` + a README quick start verified on a fresh checkout; no hosting                                                                                                                                                                                                            |
| Already decided                        | Pi harness SDK only; canvas in (minimal), Epic 4 audio out; prefer MiniMax-M3.1-Flash-Preview where an A/B shows it holds quality; v0.1 UI = decent, v0.2 revamps it with Claude Design; every release shows its metrics; the release ends with a hands-on test of every feature in a real browser |

## Branches and gates

- `release/v0.1` was cut from `main` at `4a29bc7`. Every track lands by PR into it, with CI green and an
  independent adversarial review. `release/v0.1` → `main` and the `v0.1.0` tag happen only after the
  release gate (prompt §5) holds.
- Gate 1: CI green on `release/v0.1` including the new prettier / build / corpus / e2e jobs; the model decision
  recorded; one live journey A–D in CI and one watched locally; screenshots reviewed.
- Gate 2 (release): prompt §5 items 1–6.

## Tracks

| Track                              | Branch              | Owns (exclusive)                                                                                                                                                                                                                                                                   | Ports (api/agent/web; reviewer +5) |
| ---------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| T0 model policy                    | `model/m31-flash`   | `services/agent/**` (except the two S5F files below), ADR-003, `docs/release/v0.1/MODEL-AB.md`                                                                                                                                                                                     | 18140 / 18240 / 18340              |
| S3 library, upload, auth UI        | `s3/library-ui`     | `app/{page,dashboard,login,register}`, `components/{library,auth,ui}`, `store/authStore.ts`, `lib/{auth.ts,api/papers.ts}`, `e2e/s3`                                                                                                                                               | 18110 / 18210 / 18310              |
| S6 explain panel                   | `s6/explain-panel`  | `components/explain`, `components/inspector` (deleted), `lib/api/{threads,summary,usage}.ts`, the ReaderWorkspace mount lines, `e2e/s6`                                                                                                                                            | 18120 / 18220 / 18320              |
| S7 canvas                          | `s7/canvas`         | `app/paper/[id]/canvas`, `components/canvas`, `lib/api/boards.ts`, `routers/boards.py`, `papertree_db/canvas.py`, `e2e/s7`, the reader-header link                                                                                                                                 | 18130 / 18230 / 18330              |
| CI                                 | `ci/v0.1`           | `.github/workflows/**`, `e2e/playwright.config.ts`, `e2e/harness/**` (CI only), `e2e/live/**`                                                                                                                                                                                      | 18150 / 18250 / 18350              |
| S5F live AI path                   | `s5f/ai-api-fixes`  | the API's AI routers, `agent_client.py`, `evidence.py`, `deps.py`, `settings.py`, `routers/jobs.py`, `packages/{agent-tools,prompts,retrieval}`, `papertree_db/ai.py`, `contracts/agent`, and in `services/agent` only `src/prompts.ts` + the tool-budget handling in `src/run.ts` | 18170 / 18270 / 18370              |
| S2R parser review                  | `s2r/parser-review` | `services/document-worker/python/**` (except `job.py`), `packages/evaluation`, `READER-RELEASE-PARSER.md`                                                                                                                                                                          | 18160 / 18260 / 18360              |
| S8 cleanup, README, docs (Phase 2) | `s8/cleanup`        | README, both `.env.example`, Docker files (deleted), AGENTS.md, `reachable.spec`, `packages/memory`, dead deps                                                                                                                                                                     | 18180 / 18280 / 18380              |
| Orchestrator live stack            | (detached)          | none                                                                                                                                                                                                                                                                               | 18100 / 18200 / 18300              |

`packages/ui` is shared by S3, S6 and S7: additive edits only. Reserved ports that nothing binds: 3000, 3100,
8000, 8788, 27018.

## Cut list (in order, if behind)

UI polish beyond "decent" → latency work beyond measuring → canvas extras beyond F5.1/F5.3/F5.7/F5.8 (groups
first) → S2R fixes beyond deciding the two regressions → parser hard cases → the memory write-side removal
(deferred as an issue). Never cut: the S9 hands-on test, honesty.

## Baseline gate (re-measured 2026-10-15 12:00–12:11 IST on `main` `4a29bc7`, uncached, load 2.1 → 4.8)

| Check                                           | Result                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| turbo lint / typecheck / test (`--force`)       | 5/5, 10/10, 9/9 green, 0 cached                                                                                         |
| TS tests                                        | document-ir 864, anchoring 336, web 262, agent 113 (M5/M6 killed), ui 50 = **1,625**                                    |
| pytest                                          | **2,136 passed, 1 skipped, 1 xfailed, 0 failed** (460 s); the #80 test now passes (alone: 518–526 ms, 3 runs, load 2.1) |
| ruff, ruff format, mypy, prettier, `next build` | green                                                                                                                   |
| `pnpm e2e` with the YOLO PDF                    | 5/5                                                                                                                     |

## First live journey (2026-10-15 12:10 IST, live MiniMax-M3, YOLO, over HTTP)

| Step               | Result                                                    | First text | Total     | Tokens in/out | Cost est. | Citations (supported) |
| ------------------ | --------------------------------------------------------- | ---------- | --------- | ------------- | --------- | --------------------- |
| upload → ready     | PASS (queued → reading → ready)                           | –          | 1.6–2.1 s | –             | –         | –                     |
| explain            | complete                                                  | 7.9 s      | 12.4 s    | 3,349 / 795   | $0.0020   | 6 (0)                 |
| follow-up ("that") | complete                                                  | 8.9 s      | 14.0 s    | 4,183 / 1,224 | $0.0027   | 7 (0)                 |
| free question      | complete, 4 tool calls                                    | 8.6 s      | 11.2 s    | 4,568 / 623   | $0.0023   | 6 (1)                 |
| summary            | **FAIL**: 14 tool calls, `tool_budget_exhausted`, no text | –          | 26.3 s    | 38,199 / 466  | $0.0148   | 0                     |
| cancel             | PASS (aborted, partial kept); usage recorded as 0 tokens  | 12.6 s     | 12.6 s    | 0 / 0         | $0.0003   | 1                     |

Journey E: every `ai_runs` row carries code_path, provider, model, agent_sdk, tokens and cost; one run id
appears in both services' logs; `~/.pi` unchanged (hash of the tree's mtimes and sizes before = after).
Defects → track S5F: summary never answers; the grounding check marks well-grounded citations "not
verified"; the follow-up run kind is undefined; aborted runs record 0 tokens. First text is 7.9–8.9 s
against the ≤ 5 s bar (thinking dominates; T0 measures Flash).

## Spend and token ledger (MiniMax; cap $15 for the release)

| When        | Who                                                                                                                 | Runs | Input tok | Output tok | Cost est.                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ---- | --------- | ---------- | -------------------------- |
| 12:10       | orchestrator live journey                                                                                           | 5    | 50,299    | 3,108      | $0.0221                    |
| 12:04–19:06 | every local live run with real token counts: tracks, review agents, orchestrator walks, S9 (includes the row above) | 161  | 1,311,074 | 129,731    | ≈ $0.59                    |
| 13:27–18:39 | CI live journey (the 9 runs that ran; 25 were skipped)                                                              | 9    | –         | –          | ≈ $0.157                   |
| **total**   |                                                                                                                     |      |           |            | **≈ $0.75 of the $15 cap** |

How the local figure was counted:

- **Source:** `ai_runs` rows with `provider = minimax`, summed across every data root in the evidence store
  and the worktrees, and de-duplicated by `run_id`.
- **What is excluded:** rows from e2e scratch roots and pytest temporary directories (test fixtures); rows
  with first text under 500 ms; and rows with 0 or no tokens (faux-agent runs). Faux-agent rows otherwise
  look real; see the v0.2 issue on faux labelling.
- **Who counted:** the release's number-check review re-ran the count and corrected the first figure
  (222 rows, $0.64), which still held about 29 pytest-fixture and 32 faux rows.
- **Flash costs** are estimates on M3 rates.
- **CI live runs:** the cost is summed from each run's `ai_runs` dump in its log.
- **Not counted:** the judge-panel calls behind `QUALITY.md`, which did not go through PaperTree's agent.
