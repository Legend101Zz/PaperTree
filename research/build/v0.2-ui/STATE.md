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
- Phase 0: worktree, installs, release/v0.2, pickup comments; baseline gate green; e2e 58/60 with 2 load flakes
  that pass alone (RESULT.md).
- Phase 1: R1–R3 notes, ADR-004; review point 1 posted on #175.
- Phase 2: GAP-AUDIT.md (+ audit/GAP-A1..A3, shots, reference frames).
- Phase 3: PLAN.md; slice issues #188–#218 filed; #187 (Prettier on apps/web) filed.
- S0 #184: PR #186 open (head cf2d0a6), full gate green on 8157cd7, review done and fixed; CI running.
- S1a #188: in progress in worktree `v02-s1` (branch `v02/s1a-tokens`, stacked on S0): tokens, contrast test,
  fonts, theme switch done locally; not committed yet.

## Next
- Merge #186 after CI → #187 mechanical format PR → rebase S1a onto release/v0.2 → S1a PR.
- Start backend slices beside S1: S2a #192, S4a #201, S5b #207 (implementer agents, own worktrees).

## PIDs (process-group ids) started by this session
- Dev stack: api 35217, worker 35218, agent 35219, web 46866 (restarted 16:0x). `stack/pids.txt` is authoritative.

## Open PRs
- #186 S0 tooling (base release/v0.2).
