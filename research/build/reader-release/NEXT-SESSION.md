# PaperTree — next session prompt (reader release, continue from S3/S6/S7/S8/S9)

Paste everything below the line into a new Claude Code session (ultracode recommended).

---

ultracode: Continue the PaperTree **reader release** from where the 2026-09-25/26 session stopped. Goal (unchanged): a
beautiful, fast research-paper reader — upload a real PDF → durable parse → read real pages with selectable text →
persistent highlights with stable anchors → grounded MiniMax summaries/explanations whose citations navigate back to the
passage → an intentional infinite canvas — **proven by real journeys in a real foreground browser**, not by green tests.

Repository: `/Volumes/Mrigesh SSD/PaperTree` (remote github.com/Legend101Zz/PaperTree). **Quote every path (space).**
Tracker: **#141** (read it and its latest comment first). This prompt is also committed at
`research/build/reader-release/NEXT-SESSION.md`. State at the stop: `main` = `45fb2db` (+ the commit adding this file). Decision + contracts + plan are ON MAIN:
- `research/architecture-decisions/ADR-002-reader-release.md` — the architecture (focused repair of the v2 core +
  stored-quad paint rule; Pi agent service; canvas IN; audio/Epic 4 OUT).
- `research/build/reader-release/contracts.md` — NORMATIVE shared contracts (DB 0005, API, SSE, agent, anchors, config).
- `research/build/reader-release/slice-plan.md` — slices with owned paths, acceptance walks, regression tests.
- `contracts/README.md` — the committed wire contracts, who writes/checks them, and the §2.9 status mapping additions.
- `AGENTS.md` — process rules (§2 honesty, §4 hazards). Some of it is stale; ADR-002 §8 lists the conflicts (S8 fixes).

## Owner rulings (binding)
- **Agent SDK = Pi harness SDK**: `@earendil-works/pi-coding-agent@0.87.1` `createAgentSession()` with MiniMax-M3, paper
  tools only, built-in file/shell tools unregistered, in `services/agent` (Node) brokered by `services/api`. (Asked twice;
  a first "Pydantic AI" pick was retracted.) Key: macOS Keychain `minimax_api_key` → only into the agent process env as
  `PAPERTREE_MINIMAX_API_KEY`; never print/log/write it.
- Canvas (Epic 5 minimal) IN; Epic 4 audio OUT of this release.
- ADR-002 §10 defaults are applied but **not yet confirmed by the owner** (ask once, don't block): Guided = paper register
  with "Reflowed" marker (⊙ only for AI); pymupdf-layout not shipped; TS db twin deleted (done) + memory write side deleted
  in S8; spend cap `PAPERTREE_DAILY_BUDGET_USD=1.00`.
- The fresh parser gold (`research/benchmarks/fresh/gold-pp12.json` after S2 merges; 2 model annotators + adjudicator,
  IAA kappa 0.986) needs **owner review** and 3 convention rulings (cont-after-display-equation, front-unit granularity,
  small-caps case) before it gates anything.

## What is DONE (merged to main — verify with `git log`, don't trust this list blindly)
| PR | Slice | Content |
|---|---|---|
| #140 | PR0 | prettier green (#118 format half) |
| #142 | docs | ADR-002, contracts, slice plan |
| #143 | S0a | migration 0005 (paper-keyed highlights/anchors/AI/canvas tables, pre-0005 backup, migrate lock), db mixins, TS db twin + worker VLM removed, `apps/api/` gitignored. Closes #121 |
| #144 | S0d/e | web `lib/api` over the §5 types, R1–R4 dead v1 files removed, PaperText/ReflowedText/AiText registers, system font (offline build), Pi/xyflow/ajv/Playwright deps, e2e harness (env allowlist) |
| #145–#147 | S0b/S0c | API router split, §0 error envelope, request ids, JSON logs, gzip, /healthz, strict pydantic wire models + 501 stubs, `contracts/**` (api schemas export + drift test, agent run schemas + 8 SSE fixtures, anchor-v1 schema), e2e typecheck in turbo |
| #148 | S1 | ingest loop: library states queued→reading(step n/3)→ready/partial/failed, retry/reparse/delete, durable parse→persist→promote, /file before promotion, signed asset URLs, gzip /ir, worker JSON logs |
| #149 | S5b | AI API: threads/follow-ups/cancel/summary/usage over SSE, internal paper tools (run token, 16-call cap, BM25, datamark), server-minted citation Anchors + per-claim grounding, ai_runs usage/cost; Python turn loop/provider/18-tool registry/ask.py removed |
| #150 | S5a | `services/agent`: Pi SDK locked down (isolation audited), 11 host guards, faux mode, 113 offline tests incl. M5/M6 isolation mutants |
| #151 | S4 | reader: persisted highlights (#138) painted from stored quads, toolbar portal, one getDocument (no blank PDF on mode switch), position across zoom/modes (#132), Guided paper register, focusAnchor, table-cell capture, #122 |
| #152 | S2 | parser: G7 clip, R21 re-parent, table dedupe, salvage→partial (14/14 real papers parse; was 12/14), quality rules (numeric headings, abstract bound, title first, paragraph split, floats in order, captions), fresh set + gold + `research/benchmarks/READER-RELEASE-PARSER.md` |

Every slice above except S2 had an independent adversarial review + fixes (mutation-checked). **S2 was NOT reviewed**
(the account session limit hit) and it **misses its own merge rule on two papers** (resnet pooled reading order
0.932→0.906; gpt3 macro-F1 −0.0013) — review it first (see "Next" #1).

## Final uncached gate on merged main `45fb2db` (2026-09-26 10:54–11:25 IST, shared box, load 10→60)
Logs: `/Volumes/Mrigesh SSD/PaperTree-evidence/05-final-gate/`.
- turbo lint 5/5, typecheck 10/10 (incl. e2e), test 9/9 — all 0 cached, green. TS tests: document-ir 864, anchoring 336,
  web 262, agent 113 (offline, M5/M6 mutants killed), ui 50 = **1,625**.
- `uv run pytest`: **2,135 passed, 1 failed, 1 skipped, 1 xfailed** (23 min). The one failure is the #80 wall-clock test
  `test_30k_blocks_insert_scales_linearly` (2,656 ms vs 2,000 ms at load ~15); re-run alone it also failed at load **60**
  (other sessions). Earlier solo runs at load ≤ 8 passed (1.0–2.1 s) and the S0 review measured no base→head slowdown —
  **re-run it alone on a quiet box first thing; do not loosen it.**
- ruff, ruff format, mypy (225 files), prettier, `next build`: green.
- `pnpm e2e` with the YOLO PDF: **5/5 passed** (S0 harness env + smoke, S4 Journey B on an uploaded YOLO, S4 F1/F2
  regressions, toolbar hit test).
- NOT yet observed anywhere: journeys C (live MiniMax through the real API + agent + UI) and D (canvas — not built), and
  a foreground-Chrome walk of the merged product.

## What is LEFT (in this order)
1. **Review S2** (independent reviewer re-runs the per-paper numbers on base vs main; decide on the two regressions; the
   report is `research/benchmarks/READER-RELEASE-PARSER.md`; evidence + hard-case crops in
   `/Volumes/Mrigesh SSD/PaperTree-evidence/04-slices/s2/`). Known: `layout._CAPTION_START` is case-sensitive; text lost
   beside a table is a strict xfail.
2. **S3 — library/upload/auth UI** (slice-plan §S3). URGENT: since S1 merged, the dashboard still reads the old row shape —
   every card reads "Queued", is titled with its `ppr_` id, shows "0 pages", no Retry; a failed paper opens a dead end.
   Also: upload progress (XHR), Cancel, polling only while non-terminal, Failed+Retry, Delete, login honours `?next=`,
   `authStore.checkAuth` must not sign out on network/5xx, #137 (no fixture cards; flag default is already off), audio
   claims gone, 390 px. Closes #137, #133 (card).
3. **Live integration (S5a+S5b) — never run yet.** Start api + worker + agent (real key) + web; over real HTTP on an
   uploaded YOLO: explain → follow-up → summary → cancel; confirm `ai_runs` rows carry code_path/provider/model/agent_sdk/
   tokens/cost, one `run_id` in both services' logs, agent sockets only to api.minimax.io + 127.0.0.1, `~/.pi` unchanged.
   Known: first-text p50 5.51 s vs the ≤5 s bar (thinking level `low` dominates); datamarking costs +128–141% input tokens
   and the seed quote is not datamarked (injection surface — decide); spend cap counts only finished runs; runs orphaned by a
   crashed API are not swept; a summary with no valid markers reads `failed` on GET (contract decision); follow-up run kind
   unspecified in contracts.
4. **S6 — explain panel UI** (slice-plan §S6): replaces the old Inspector (still mounted at xl, unstyled); toolbar Ask →
   drawer (desktop) / Sheet (390); streaming with tool status; follow-ups; citation chips → `focusAnchor` flash; summary
   bullets cached; designed errors + Retry + partial kept; usage "≈ $ (estimate)"; PaperText vs AiText ⊙ both themes.
5. **S7 — minimal intentional canvas** (slice-plan §S7): `@xyflow/react`, rows via `/papers/{id}/board`+`/boards/*`
   (routes are 501 stubs with final models; db `canvas.py` stubs), send passage/explanation, drag = one PATCH, labelled
   edges, groups, edit, delete, reload persistence, "Open source" → reader focusAnchor, never auto-populate, 390 px.
6. **S8 — cleanup, ONE accurate README, CI** (slice-plan §S8): CI must run prettier, `next build`, the agent tests, the
   corpus, and Playwright A–D against the faux agent (today CI runs NONE of these); README quick start verified verbatim on
   a fresh worktree; `.env.example` files = contracts §7 exactly; delete docker-compose.yml + apps/web/Dockerfile (v1);
   memory write side (R13) with every security guard kept; `reachable.spec` extended; AGENTS.md corrections (current
   phase = #141, Python anchoring now wired, 955 blocks/176 relations, the stacked-PR trap below, the paint rule).
7. **S9 — final verification walk A–F** in a real FOREGROUND Chrome (claude-in-chrome) with the real worker and live
   MiniMax on YOLO, DDPM and one more fresh paper; 1440 + 390 screenshots; axe; E evidence per step; every gate uncached;
   PASS/PARTIAL/FAIL table in `research/build/READER-RELEASE-RESULT.md`. Say "finished" only if the full journey passes.
8. Tracker hygiene: update #141's checklist; close #138/#132/#122/#121 if their PRs didn't auto-close; correct #7 gate
   item 2 and #139 §2.1; owner items: #54 (gold review), #62 (Tier C questions), #136 (delete `apps/api/` — owner only).

## How to work (what worked, and the traps)
- Worktrees on the SSD only: `git -C "/Volumes/Mrigesh SSD/PaperTree" worktree add "/Volumes/Mrigesh SSD/PaperTree-worktrees/<slug>" -b <branch> origin/main`,
  then BOTH `uv sync --locked --all-packages` and `pnpm install --frozen-lockfile`, and copy the corpus:
  `cp "/Volumes/Mrigesh SSD/PaperTree/research/benchmarks/corpus/"*.pdf "<wt>/research/benchmarks/corpus/"`.
  All slice worktrees were removed at the stop; only `PaperTree-worktrees/reader-release` (detached at `45fb2db`, used for
  the final gate) remains — remove or reuse it. The main checkout was fast-forwarded to `45fb2db` (its untracked user
  files are untouched; `apps/api/` is now gitignored). The 6 fresh PDFs are preserved in
  `/Volumes/Mrigesh SSD/PaperTree-evidence/fresh-pdfs/` (YOLO for `PAPERTREE_E2E_YOLO_PDF`).
- **Never touch** the main checkout's untracked files (`apps/api/` has user PDFs, `.agents/`, `.claude/`,
  `research/build/preamble-prompt.md`) or `~/.papertree-demo`. Never `git add -A` there.
- Per slice: one workflow = implement (own worktree, owned paths) → independent adversarial review (re-runs acceptance on a
  fresh data root, mutation-tests key tests, full uncached gate) → fix only if must-fix. The lead opens PRs, merges, and
  re-runs checks after each rebase.
- **Account session limit**: ~4–5 concurrent long agents hit "You've hit your session limit" (it killed this session's last
  reviews). Keep ≤3 concurrent implementers; agents write reports incrementally; after a reset, resume the workflow with
  `resumeFromRunId` (completed agents replay from cache).
- Gate (uncached, every PR): `pnpm exec turbo run lint --force` · `typecheck --force` · `test --force` ·
  `uv run pytest -q` · `uv run ruff check packages services` · `uv run ruff format --check packages services` ·
  `uv run mypy <shell-expanded packages/*/python services/*/python>` · `pnpm exec prettier --check .` ·
  `pnpm --filter papertree-web build` · `pnpm e2e` (set `PAPERTREE_E2E_YOLO_PDF=<path to yolo-1506.02640.pdf>` or the
  Journey B specs skip loudly; the fresh set downloads with `research/benchmarks/fresh/fetch_fresh.sh` once S2 is merged).
  CI does not run prettier/next build/e2e/corpus yet — run them locally.
- After changing a pydantic model: `uv run python -m papertree_api.contracts export` then
  `pnpm exec prettier --write contracts/api`; an omittable() field refuses explicit null (add rows to
  `tests/omittable_cases.py`).
- `#80` `test_30k_*` wall-clock tests flake under load on this shared box — re-run alone before diagnosing; never loosen.
- **Stacked-PR trap (verified):** `gh pr merge N --delete-branch` on a stack base CLOSES the dependent PR. Merge stacked PRs
  without `--delete-branch` (repo auto-delete retargets). Recovery: push the base ref back, `gh pr reopen`, `gh pr edit --base main`.
- Lockfile conflicts on rebase: `git checkout --theirs pnpm-lock.yaml && pnpm install --lockfile-only && git add pnpm-lock.yaml`.
- Ports: :3000 is the owner's Hermes WhatsApp bridge — never kill. Use scratch ports (18xxx–19xxx) for agents; the agent
  service defaults to 8200. In Chrome browse `127.0.0.1:<port>` (saved 33% zoom on localhost); the MCP tab must be the
  window's active tab (`document.visibilityState === 'visible'`) or pdf.js renders nothing.
- `grep` in this shell is a wrapper; two files contain NUL bytes — use `/usr/bin/grep -a`.

## Evidence (durable, not committed)
`/Volumes/Mrigesh SSD/PaperTree-evidence/`: `01-discovery/` (baseline maps, issue triage, baseline journey + screenshots),
`02-pi-spike/` (Pi SDK spike + verification, code), `03-architecture/` (proposals A/B/C, judge evidence, 0005 probe),
`04-slices/<slice>/` (implementer reports, reviews, fix logs, screenshots; S2 hard-case crops; `s2-gold/`).

Final report expectations: architecture, code/docs removed, issue mapping, journeys PASS/FAIL/BLOCKED with evidence,
uncached check results, screenshots, remaining defects, exact next action. Never round PARTIAL up.
