# v0.2 UI build — STATE (resume point)

Read this first after a compaction, then `PLAN.md` and the open PRs (`gh pr list --base release/v0.2`).

- Prompt: `~/Desktop/papertree-v0.2-build-prompt.md`. Process contract: `AGENTS.md`.
- Integration branch: `release/v0.2` (from main `79f637d`, pushed 2026-10-16 15:2x IST). Every PR targets it.
- Orchestrator worktree: `/Volumes/Mrigesh SSD/PaperTree-worktrees/v02-ui` (branch `v02/research`), both installs
  done, corpus + fresh PDFs copied in (checksums OK).
- Gate script: `/Volumes/Mrigesh SSD/PaperTree-scratch/v02/gate/run-gate.sh <worktree> <outdir>`.
- Dev stack: `/Volumes/Mrigesh SSD/PaperTree-scratch/v02/stack/{start.sh,stop.sh,stack.env}` — web 18901, API 18902,
  agent 18903 (FAUX=1 default). Data root `/Volumes/Mrigesh SSD/PaperTree-scratch/v02-data` (copy of the README demo
  data). Demo login: `demo@example.test` / `e2e-s4-password` (also reader@, you@, me@example.test).
- Research clones: `/Volumes/Mrigesh SSD/PaperTree-research/v0.2/src/`; notes land in `.../v0.2/notes/`.

## Done
- Phase 0: worktree, installs, release/v0.2 pushed, pickup comments on #175 and #182.

## Running
- Baseline gate on 79f637d → `/Volumes/Mrigesh SSD/PaperTree-scratch/v02/gate/baseline-79f637d/`.
- R1/R2/R3 research agents (Sonnet), writing to `PaperTree-research/v0.2/notes/`.

## Next
- Record baseline in RESULT.md; start stack; screenshots of the current app at frame sizes.
- ADR-004 after R1–R3; review point 1 on #175.

## PIDs (process-group ids) started by this session
- (none yet)

## Open PRs
- (none yet)

## Update 15:5x
- Baseline gate 79f637d: ALL GREEN (lint, typecheck, test, prettier, ruff, mypy, web build, pytest 499 s, peak-RSS alone).
- R1/R2/R3 notes done → research/build/v0.2-ui/RESEARCH-R*.md (prototypes preserved at PaperTree-research/v0.2/prototypes/).
- ADR-004 written (research/architecture-decisions/ADR-004-v0.2-ui-stack.md).
- S0: issue #184, worktree v02-s0 branch v02/s0-tooling, commit 8157cd7 (not pushed yet; gate pending).
- Dev stack started 15:5x: process groups api 35217, worker 35218, agent 35219, web 35220 (pids.txt in stack/).
