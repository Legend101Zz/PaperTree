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

## Done (merged into release/v0.2), as of 2026-10-17 ~01:00 IST
- Phases 0–3 (#223), S0 #186, Prettier #220.
- S1 complete: S1a #227, S1b #228/#229, S1c #230/#231, S1d #238/#239.
- Backends: S2a #236 (0006), S5a #243/#244 (0007), S6a #241 (0008), S2b #251 (0009), S2c #254, S4a #235, S5b #225/#232/#233.
- UI: S4b #247/#248 (+ #253 follow-up), S2d #249/#250. Test bound: #259.
- RESULT.md has a row per merged PR with its evidence.

## Open PRs (all reviewed, gate + full e2e run locally; waiting on CI)
- S6b #260 → #261 (board cards, pins, threads; one CI e2e failure on #261 being fixed: `s7/screens` Link disabled).
- S4c #262 → #263 (reader header, selection toolbar; full e2e 62/62).
- S5c #264 → #265 (notebook page; three review rounds; full e2e 62/62). Part 1 is ~3,990 lines: stated in the PR.

## In progress
- S2e #196 (library states): review fixes (two blockers).
- S4d #204 (explain states): in review.
- S7a #216 (diagram backend, migration 0011, no live calls): implementing.
- S6c #213 (Link as): implementing, stacked on S6b.

## Next
- S5d ink and lasso (#209) on S5c; S5e Dive in, tablet, phone (#210); S6d frames/minimap/toolbar/empty (#214);
  S6e undo and scale (#215); S2f table (#197); S2g topics and map (#198); S2h phone library (#199);
  S4e phone + lamp-lit reader + one live explain smoke (#205); S7b the plate + one live diagram smoke (#217);
  S2b-2 Flash topic run + live smoke (#242); S3 pull out and open (#200, migration 0010); S8 the whole flow (#218).
- Follow-ups filed: #234 #245 #246 #255 #256 #257 #258.

## Ports
- 18900–18909 are for agent dev servers only. e2e runs leave `PAPERTREE_E2E_*_PORT` unset (the harness picks OS
  ports) and always run in an idle detached review worktree, never in a worktree an agent is editing.
- The shared v0.1 web/API (18901/18902) were stopped by PGID at ~22:30 IST to free ports; the faux agent 18903 runs.

## Worktrees
- v02-ui: the dev stack (v0.1 code; web 18901, API 18902, agent 18903; never run e2e here).
- v02-docs: this file and RESULT.md (branch v02/docs-progress). v02-review, v02-review2: detached review trees.
- Slice trees: v02-s1d, v02-s2a, v02-s2d, v02-s4b, v02-s5a, v02-s6a.

## PIDs (process-group ids) started by this session
- Dev stack: api 35217, worker 35218, agent 35219, web 46866. `stack/pids.txt` is authoritative.
