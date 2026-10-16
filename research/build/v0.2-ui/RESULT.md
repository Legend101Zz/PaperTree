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

**The two e2e failures are not product defects, but their cause was not isolated.** Both are in `e2e/s7/w2ui-canvas.spec.ts`
("a phone opens on the whole board…" and "a stale-version refusal…"), both timed out waiting 30 s for
`.react-flow__node`, and both ran at 15:44, the moment this session started its own `next dev` in the same worktree
(which shares `apps/web/.next` with the harness's server; see STATE.md) while three audit agents loaded the machine.
Re-run alone at 15:46 the whole file passed 4 of 4 (14.5 s and 12.7 s for the two). So either the shared `.next` or
the load caused it; the passing re-run shows the specs and the code are fine. They are the baseline, not a red.

Known pre-existing warning: `pnpm add` reports an unmet peer, `@typescript-eslint/parser@^8.65.0` wanted by
`@typescript-eslint/eslint-plugin@8` (v0.1's devDependency) against the 6.21.0 that `eslint-config-next` 14.1 brings.
Lint runs green with it.

## Slices

Each row: merged into `release/v0.2` (head verified an ancestor with `git merge-base --is-ancestor`), CI green on the
head, the local uncached gate, and a code review whose findings were fixed before merge.

| Slice | Issue | PR | Merged | Notes |
| --- | --- | --- | --- | --- |
| S0 tooling | #184 | #186 | e435bb6 | full gate on 8157cd7 (pytest 2,235); review fixes cf2d0a6 |
| Prettier on apps/web | #187 | #220 | 3fe504b | mechanical: identical TS emit on all 98 files (review); found #219 |
| S5b notebook model: page, stroke, outline | #207 | #225 | d02e4d0 | full gate on b3fdefa (pytest 2,235); review fixes 679bde2 (encoder bounds, strict decoder) |
| S5b-2 lasso and eraser hit-testing | #221 | #232 | d51d7b3 | lasso by length inside; 50-vertex lasso over 500 × 80-point strokes ≈ 11 ms at load ~50 |
| S5b-3 undo history | #222 | #233 | cf959cd | cap validated, duplicate ids refused, exact move undo |
| S4a exchanges API | #201 | #235 | 5175a02 | full gate on 4e147f2 (pytest 2,261); ¶ rules re-measured on fresh Attention/ResNet/BERT parses; known limit #234 |
| S1a tokens, faces, theme switch | #188 | #227 | f092ac2 | full gate on ebbd9bd (pytest 2,235); contrast test of 30 pairs in both schemes; zoom-select floor for the new faces (CI found it on Linux) |
| S1b interface components | #189 | #228 | 8aae920 | Button md 40 (the mock-up won over the brief); toast region mounts empty |
| S1b-2 sprout, label holder, reading-now row | #226 | #229 | f315851 | the design's own sprout paths |
| S1c voices, markers, page tabs, coverage | #190 | #230 | 64f15c6 | banned-words scan over source strings with probes |
| S1c-2 call slip, AI slip, trace list | #224 | #231 | 942ed7e | AiParagraph rows for per-paragraph margins; Show in paper on the shared Button |

## Live AI spend (estimates)

| When | Slice | Kind | Model | Tokens | Cost (estimate) |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | $0.0000 |
