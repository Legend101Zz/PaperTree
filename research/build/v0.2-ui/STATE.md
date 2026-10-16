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

## Done
- Phase 0–3 (see PLAN, GAP-AUDIT). Review points 1 and 2 posted on #175. Owner (mid-build): any OSI open-source
  code is allowed, whole or in part (ADR-004 §4).
- Merged into release/v0.2: #186 (S0, e435bb6), #220 (Prettier on apps/web, d445409).

## Open PRs (base → head)
- #223 docs (v02/research). #227 S1a (v02/s1a-tokens, review fixed at 41cbc93).
- #228 S1b-1 ← #229 S1b-2; #230 S1c-1 ← #231 S1c-2 (all stacked on #227; one reviewer on all four).
- #225 S5b-1 ← #232 S5b-2, #233 S5b-3 (S5b-1 gate running in v02-s5b; do not switch that worktree's branch).

## In progress (agents)
- S2a #192 implementer in v02-s2a (migration 0006). S4a #201: review findings being fixed in v02-s4a (¶ rules,
  section titles, coverage units); its gate must re-run after.

## Next
- Merge #227 on green CI → the stacked PRs retarget; merge chains bottom-up without --delete-branch.
- Launch S5a #206 (0007) and S6a #211 (0008) when agent slots free (briefs ready); then S1d, S4b, S2d.
- Migration order: 0006 S2a, 0007 S5a, 0008 S6a, 0009 S2b, 0010 S3, 0011 S7a (PLAN.md).

## PIDs (process-group ids) started by this session
- Dev stack: api 35217, worker 35218, agent 35219, web 46866. `stack/pids.txt` is authoritative.
