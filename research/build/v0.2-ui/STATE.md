# v0.2 UI build — STATE (resume point)

Read this first after a compaction, then `PLAN.md` and the open PRs (`gh pr list --base release/v0.2`).

- Prompt: `~/Desktop/papertree-v0.2-build-prompt.md`. Process contract: `AGENTS.md`.
- Integration branch: `release/v0.2` (from main `79f637d`). Every PR targets it; release → main is the owner's.
- Orchestrator worktree: `/Volumes/Mrigesh SSD/PaperTree-worktrees/v02-ui`. Slice worktrees:
  `PaperTree-worktrees/v02-<slug>` (made with `PaperTree-scratch/v02/tools/mkwt.sh <slug> <branch> [base]`).
  Review/e2e worktrees: `v02-review`, `v02-review2` … `v02-review5` (detached; move to a PR head before use).
- Gate: `/Volumes/Mrigesh SSD/PaperTree-scratch/v02/gate/run-gate.sh <worktree> <outdir>` (logs + SUMMARY.txt,
  TMPDIR on the SSD per run). `queue-gate.sh` chains gates; `tools/ci-watch.sh` reports CI on open v02 PRs.
- Agent briefs: `PaperTree-scratch/v02/briefs/` (`implement-common.md`, `review-common.md`, `slice-*.md`).
- Screenshot tool: `/Volumes/Mrigesh SSD/PaperTree-scratch/v02/tools/shoot.mjs`.

## Owner rulings during the build
- 2026-10-16: any OSI open-source code may be used, whole or in part (ADR-004 §4).
- 2026-10-17: the live MiniMax budget for this build is **$10** (was $1.00). Spend so far ≈ **$0.0043** (estimate:
  S7b diagram $0.0020 merged; S4e explain $0.0017 and S2b-2 topic ≈ $0.0006 on open branches; each logged in
  RESULT.md's "Live AI spend" table when its PR merges).

## Done (merged into release/v0.2), as of 2026-10-17 ~07:00 IST
- Phases 0–3 (#223), S0 #186, Prettier #220.
- S1 complete: S1a #227, S1b #228/#229, S1c #230/#231, S1d #238/#239.
- Backends: S2a #236 (0006), S5a #243/#244 (0007), S6a #241 (0008), S2b #251 (0009), S2c #254, S4a #235,
  S5b #225/#232/#233, S7a #274/#275 (0011).
- Library: S2d #249/#250, S2e #266/#267, S2f #287/#288.
- Reader: S4b #247/#248 (+ #253), S4c #262/#263, S4d #271/#272.
- Notebook: S5c #264/#265, S5d #285/#286.
- Board: S6b #260/#261, S6c #273, S6d #280/#281.
- Diagrams: S7b #290/#291 (live diagram smoke).
- Fixes and bounds: #259 (lasso bench), #270 (links scale), #278 (usage fixture; release typecheck), #289 (heartbeat).
- RESULT.md has a row per merged PR with its evidence.

## Open PRs
- S4e #294 → #295 (phone explain sheet + lamp-lit page; phone header, live explain smoke). #295 CI green.
- S2g #296 → #297 (Topics; the Map). S2h is stacked on #297's head.

## In progress (local branches, not pushed until gate + review are done)
- S3 #200 (plate backend 0010 + the book): gate and full e2e queued.
- S2b-2 #242 (Flash topic run, background task): review fixes done (`1edd39f`), gate queued.
- S2h #199 (phone library): review fixes in progress. Conflicts with S3 in `CatalogueCard.tsx`,
  `ShelfSection.tsx`, `useRovingShelf.ts`: merge order S2g → S3 → S2h (rebased onto both, checked at 390).
- S5e #210 (Dive in, tablet, phone): review fixes in progress (blocker: hidden tappable delete on the phone;
  internal Next router context → `useRouter`/callback). Filed #292 (pinch zoom), #293 (Dive in in S4e's footer).
- S6e #215 (board undo and scale): review fixes in progress.

## Next
- S8 the whole flow (#218): the 14-step prototype flow as one e2e at 1440/390 × light/dark with axe,
  reduced motion, the v0.1 e2e suite green, perf numbers, RESULT.md per frame.
- Then: comments on #175/#182, the `release/v0.2` → `main` PR for the owner, all dev servers stopped by PID.
- Follow-ups filed: #234 #245 #246 #255 #256 #257 #258 #268 #279 #292 #293 #298.

## Load and flakes (the Mac runs at load 40–60, much of it its own Chrome helpers)
- A full e2e takes 1–1.7 h at that load (20 min at load ~5). Triage: re-run failures alone in an idle tree.
- Known load-only failures (pass alone): #80's 30k migration timing (`LOCAL_BOUND_MS`, local-only by design),
  the peak-RSS ratchet, the parse budget, `journey-b` and `explain-faux` text-layer timeouts,
  `s4-table-cell-capture` (live ResNet parse, vitest 5 s), the idle-watchdog ratio (#181).
- After each merge batch, run `pnpm exec turbo run typecheck` on `release/v0.2` itself (#278 lesson).

## Ports
- 18900–18909 are for agent dev servers only (each brief names its two). e2e runs leave
  `PAPERTREE_E2E_*_PORT` unset (the harness picks OS ports) and always run in an idle detached review
  worktree, never in a worktree an agent is editing (an agent's edits trigger HMR mid-run).
- Reserved and never touched: 3000, 3100, 8000, 8788, 27018.

## Disk
- The internal disk filled on 2026-10-17 (#268): the e2e harness leaves `$TMPDIR/papertree-e2e-*` (~1.1 GB a
  run). Every gate and e2e run now sets TMPDIR under `PaperTree-scratch/v02/tmp/` and removes it after.

## PIDs
- The shared v0.1 dev stack (18901/18902/18903) was stopped by PGID on 2026-10-16 ~22:30 IST.
- Agents start and stop their own servers by recorded PID; no orchestrator server runs now.
