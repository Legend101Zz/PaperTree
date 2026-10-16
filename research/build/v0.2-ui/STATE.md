# v0.2 UI build — STATE (resume point)

Read this first after a compaction, then `PLAN.md` and the open PRs (`gh pr list --base release/v0.2`).

- Prompt: `~/Desktop/papertree-v0.2-build-prompt.md`. Process contract: `AGENTS.md`.
- Integration branch: `release/v0.2` (from main `79f637d`). Every PR targets it; release → main is the owner's.
- Orchestrator worktree: `/Volumes/Mrigesh SSD/PaperTree-worktrees/v02-ui` (branch `v02/research`, the docs PR
  for #185). Slice worktrees: `PaperTree-worktrees/v02-<slug>`. Review worktree: `PaperTree-worktrees/v02-review`
  (detached; move it to each PR head before a review).
- Gate: `/Volumes/Mrigesh SSD/PaperTree-scratch/v02/gate/run-gate.sh <worktree> <outdir>` (logs + SUMMARY.txt).
- Dev stack: `/Volumes/Mrigesh SSD/PaperTree-scratch/v02/stack/{start.sh,stop.sh,restart-web.sh,stack.env}`:
  web 18901, API 18902, agent 18903 (FAUX=1 default), data root `PaperTree-scratch/v02-data` (README demo copy).
  Login `demo@example.test` / `e2e-s4-password` (also reader@, you@, me@example.test). A second web server for a
  slice worktree can run on 18904 against the same API.
- **Never run `pnpm e2e` in the worktree that serves the dev stack**: the harness's `next dev` shares
  `apps/web/.next` and inlines its own API port into the chunks (happened 15:44; fixed by stopping web by pgid,
  removing `.next`, `restart-web.sh`). Run e2e with `PAPERTREE_E2E_{API,WEB,AGENT}_PORT=18905/18906/18907`.
- Screenshot tool: `/Volumes/Mrigesh SSD/PaperTree-scratch/v02/tools/shoot.mjs`. Agent briefs:
  `PaperTree-scratch/v02/briefs/`. Issue specs: `PaperTree-scratch/v02/issues/` (issues.json = key → number).

## Owner rulings during the build
- 2026-10-16: any OSI open-source code may be used, whole or in part (ADR-004 §4).
- 2026-10-16: the live MiniMax budget for this build is **$10** (was $1.00). Spend so far: $0.00 (estimate method: tokens × list price, logged per smoke in RESULT.md).

## Done (merged into release/v0.2)
- Phases 0–3: #223 (research, ADR-004, GAP-AUDIT, PLAN; review points 1 and 2 on #175). Owner ruling mid-build: any
  OSI open-source code may be used, whole or in part (ADR-004 §4).
- S0 #186, Prettier on apps/web #220, S5b notebook model #225/#232/#233, S4a exchanges API #235,
  S1a #227, S1b #228/#229, S1c #230/#231.

## Open PRs
- #236 S2a reading state (migration 0006; gate green except the #80 flake, re-run passes).
- #238 S1d token board → #239 S1d-2 component states (review fixed; ThreadSwatch added to packages/ui).

## In progress
- S5a #206/#240: a fresh agent splits the 1,940-line commit into two branches in v02-s5a (migration 0007). The first
  S5a agent ran `pkill -f "until \["` on its own loop (no collateral found; stopped; recorded in memory).
- S6a #211 (0008): review fixed (d0d59ec), full gate running; merges after 0006 and 0007.
- S4b #202 (Opus) in v02-s4b: web 18904, API 18909. S2d #195 (Opus) in v02-s2d, stacked on S2a: web 18908, API 18900.

## Next
- Merge #236 → S5a (0007) → S6a (0008); #238 → #239.
- Then S2b topics (0009), S4c reader chrome, S5c notebook page, S6b board cards; S2e–S2h after S2d.

## Worktrees
- v02-ui: the dev stack (v0.1 code; web 18901, API 18902, agent 18903; never run e2e here).
- v02-docs: this file and RESULT.md (branch v02/docs-progress). v02-review, v02-review2: detached review trees.
- Slice trees: v02-s1d, v02-s2a, v02-s2d, v02-s4b, v02-s5a, v02-s6a.

## PIDs (process-group ids) started by this session
- Dev stack: api 35217, worker 35218, agent 35219, web 46866. `stack/pids.txt` is authoritative.
