# v0.2 UI build — RESULT

Filled in as slices merge. The final section lists every frame as done, partial (with what is missing) or not
done, and every gap left has an issue.

## Baseline (pre-existing state), `main` = `release/v0.2` = `79f637d`, 2026-10-16

Run uncached in worktree `v02-ui` with `PaperTree-scratch/v02/gate/run-gate.sh`; raw logs in
`PaperTree-scratch/v02/gate/baseline-79f637d/` (outside the repo).

| Step | Result | Time | Load (1/5/15 min) at start |
| --- | --- | --- | --- |
| `turbo run lint --force` | pass | 8 s | 4.99 3.62 3.08 |
| `turbo run typecheck --force` | pass | 11 s | 5.00 3.66 3.10 |
| `turbo run test --force` | pass: vitest 1,716 (document-ir 864, web 466, anchoring 336, ui 50), agent node tests 142 | 25 s | 5.57 3.84 3.17 |
| `prettier --check .` | pass | 4 s | 26.29 8.81 4.98 |
| `ruff check`, `ruff format --check` | pass | 2 s | 24.75 8.78 4.99 |
| `mypy` (strict) | pass | 9 s | 24.75 8.78 4.99 |
| `pnpm --filter papertree-web build` | pass | 22 s | 24.31 9.20 5.18 |
| `pytest` (peak-RSS test deselected) | pass, 4 skips (the 3 empty parametrize sets and negative-mediabox, CI's allow-list) | 499 s | 22.30 9.65 5.43 |
| peak-RSS test, own process | pass | 29 s | 4.03 4.94 4.74 |
| `pnpm e2e` (faux agent, YOLO PDF set) | **58 passed, 2 failed** in 15.9 min | — | 3.57 4.69 4.66 at start |

**The two e2e failures are load flakes, not defects.** Both are in `e2e/s7/w2ui-canvas.spec.ts` ("a phone opens on
the whole board…" and "a stale-version refusal…"), both timed out waiting 30 s for `.react-flow__node`, and both ran
at 15:44 while this session was starting its dev stack (`next dev` compiling) and three audit agents. Re-run alone
at 15:46 the whole file passed 4 of 4 (14.5 s and 12.7 s for the two). They are the baseline to beat, not a red.

Known pre-existing warning: `pnpm add` reports an unmet peer, `@typescript-eslint/parser@^8.65.0` wanted by
`@typescript-eslint/eslint-plugin@8` (v0.1's devDependency) against the 6.21.0 that `eslint-config-next` 14.1 brings.
Lint runs green with it.

## Slices

(see PLAN.md; filled in at each merge)

## Live AI spend (estimates)

| When | Slice | Kind | Model | Tokens | Cost (estimate) |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | $0.0000 |
