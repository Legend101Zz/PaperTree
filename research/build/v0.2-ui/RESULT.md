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
| S1d token board (frame 10) | #191 | #238 | 2c7e00c | guard answers 404 in production (next build + start); ratios floored, never rounded up |
| S1d-2 component states | #237 | #239 | ebf43d2 | ThreadSwatch (7 kinds, colour + drawn second cue) added to packages/ui; demo copies inert |
| S2a reading state, library facts | #192 | #236 | 825379d | migration 0006; full gate on c0ba54f (pytest green after one #80 flake re-run) |
| S5a notebook backend part 1 | #206 | #243 | e676ee3 | migration 0007; Dive in keyed by S4a's passage_key; review fixes a4bb324 |
| S5a-2 strokes and search | #240 | #244 | 64db2df | stroke cap = encoder worst case (180,005 B); whole-blob validation; full gate on d4c8442 (pytest 2,338) |
| S6a board backend | #211 | #241 | c432eb9 | migration 0008 (rebuild, row-count guard); pin table from frame 06; full gate on baf9001 (pytest 2,369) |
| S4b-1 exchange model, stored threads | #202 | #247 | e715a98 | golden numbering on the real Attention thread (b1,b6,b7,b8 → 1–4) |
| S4b-2 the exchange on screen, the flash | #202 | #248 | 9db4411 | full gate on 4ec0518 (pytest 2,338); full e2e 60/60 |
| S4b follow-up: markers stay through settling | #252 | #253 | ce37eda | found by CI on another PR; stored "not verified" overlays the kept markers |
| S2d-1 the shelf | #195 | #249 | 65d0084 | spine width 26 + 0.85 × pages fits all 24 spines of frame 01; gilt ≥ 4.7:1 on every cloth |
| S2d-2 header, search, catalogue card | #195 | #250 | 6f56765 | full gate on 400ce3c (pytest 2,338); full e2e 60 + 1 baseline flake (passes 4/4 alone) |
| S2c library links (backend) | #194 | #254 | 83e65c7 | 3 real links on the corpus, all by title, 0 by arXiv id; full gate on 8d8c0e4 (pytest 2,386) |
| S2b topics (backend, part 1) | #193 | #251 | da20ded | migration 0009; full gate on ccda80a (pytest 2,404); part 2 (Flash run) is #242 |
| lasso benchmark bound | (#182) | #259 | 516897f | 50 ms target logged, 250 ms asserted: it failed two gates at load 25–50 |
| S6b-1 board cards | #212 | #260 | fcbb27b | merged together with part 2 (part 1's CI fixes live in part 2) |
| S6b-2 brass pins, seven threads, legend | #212 | #261 | 7cb3ade | full gate on c59378a: 9 of 11 (two timing flakes, pass alone); full e2e 61 passed, 1 failed (triage in the PR) |
| S4c-1 reader header and desk (04) | #203 | #262 | 77dd5d8 | see part 2 |
| S4c-2 selection toolbar, Contents, highlights | #203 | #263 | da7e9c6 | full gate on b9f11d9: 10 of 11; full e2e 62/62 |
| S5c-1 the notebook page | #208 | #264 | 0dc1821 | three review rounds; ~3,990 lines (stated in the PR) |
| S5c-2 side panel, Send page to board, shapes | #208 | #265 | d567b3b | full gate 11 of 11 (pytest 2,387); full e2e 62/62 |
| S2e-1 Reading now, the empty library, covers | #196 | #266 | b4aa0ea | see part 2 |
| S2e-2 the library at scale | #196 | #267 | bed7c47 | full gate 10 of 11 (#80 flake, passed 2/2 alone); full e2e 63/63 |
| library links scale bound | (#182) | #270 | f53e9fd | 10 s bound; 3 s failed a gate at load |
| S4d-1 explain states, Stop, daily cap | #204 | #271 | f516304 | see part 2 |
| S4d-2 the summary as an exchange (04d) | #204 | #272 | 39c91e1 | full gate 11 of 11 (pytest 2,422); full e2e 62 passed, 1 failed (load; triage in the PR) |
| S6c "Link as" | #213 | #273 | 43210eb | full gate 10 of 11 (pytest 2,369); full e2e 63/63 |
| S7a-1 diagram threads, migration 0011 | #216 | #274 | e474bca | see part 2 |
| S7a-2 diagram runs (agent, NDJSON parts) | #216 | #275 | 5e83853 | full gate 10 of 11 (pytest 2,518; #80 flake); full e2e 62/62; no live calls |
| usage fixture for diagram/topic rows | (#182) | #278 | 2c87297 | release typecheck went red after #271/#272 and #274/#275 merged in one batch; since then release is typechecked after every batch |
| S6d-1 board header, toolbar, frames, minimap | #214 | #280 | efd21f9 | merged together with part 2 |
| S6d-2 "Board" everywhere, /board route | #214 | #281 | 06e9ed2 | full gate on eab4916: 9 of 11 (load flakes); full e2e 69 passed, 1 failed (triage in the PR) |
| S5d-1 notebook ink | #209 | #285 | 84aafd7 | see part 2 |
| S5d-2 the lasso and its menu | #209 | #286 | 1bf0bab | full gate on 24996a9: 9 of 11 (load flakes, no Python touched); full e2e 68 passed, 1 failed (`journey-b` load timeout; passed alone) |
| S2f-1 shared library actions | #197 | #287 | 652813c | see part 2 |
| S2f-2 the Table (01d) | #197 | #288 | 522d30a | full gate 10 of 11 (pytest 2,521; agent heartbeat flake → #289); full e2e 69/69 |
| agent heartbeat bound | (#182) | #289 | 0dd978e | frames every 30 ms, a 60 % floor; a 200 ms interval still fails it |
| S7b-1 the engraved plate | #217 | #290 | 6959a97 | see part 2 |
| S7b-2 plate actions, board card, 07d, live smoke | #217 | #291 | 508cd75 | full gate on fce062f: 10 of 11 (two pytest load timings, no Python touched); full e2e 68 passed, 1 failed (`s6/explain-faux` load; passed alone at load 19); live ≈ $0.0020 |
| S4e-1 phone explain sheet (08b), lamp-lit page (09b) | #205 | #294 | fe7d048 | see part 2 |
| S4e-2 phone header, 08b e2e, live explain smoke | #205 | #295 | 0c9ba3d | full gate on 3733800: 10 of 11 (two pytest load timings, no Python touched); full e2e 74 passed, 2 failed (`canvas-journey` load, passed alone; `guided-position` at 390 real, fixed in ff5ba73); then 26/26 on the affected specs; CI green; live ≈ $0.0017 |
| S2g-1 Topics view | #198 | #296 | b640ba8 | see part 2 |
| S2g-2 the Map (only real links) | #198 | #297 | 81af91a | full gate 9 of 11 (#80 30k timing; live ResNet table-cell timeout; no Python touched); full e2e 69 passed, 3 failed (reader specs at load ~57: two passed alone, `journey-b` the known timeout); CI green |
| S3-1 the book's backend, migration 0010 | #200 | #301 | 3cfc29a | 0010 applies after 0011 (tested); gate with part 2 |
| S2b-2 the Flash topic run | #242 | #303 | 127773c | full gate 11 of 11 on a650d7f (pytest 2,543); CI e2e found the faux agent's default answer racing S2g's spec, fixed in 57d8b38; CI green; live ≈ $0.0006 (2 calls) |
| S5e-1 Dive in, its motion, the tablet (05b) | #210 | #304 | e6504f8 | CI e2e found S4e's spec asserting no Dive in on the phone sheet (#293 adds it): spec fixed in 37114fa; CI green |
| S5e-2 the phone notebook (08c) | #210 | #305 | 5730edf | full gate 11 of 11 on a9c6030 (pytest 2,521); CI green (full e2e in GitHub Actions from here on, owner rule) |
| S6e-1 board undo and redo | #215 | #306 | e76ef4d | see part 2 |
| S6e-2 the 500-card board, lamp-lit board (09c) | #215 | #307 | 61e95ab | full gate 11 of 11 (pytest 2,521); CI e2e found spawnSync's 1 MiB buffer killing the 500-anchor helper, fixed in 7493786; CI green |
| S3-2 the pulled-out and opened book (02a, 02) | #200 | #302 | 5da0742 | full gate 11 of 11 (pytest 2,540); CI e2e found an axe contrast hit just after a scheme switch: the shared button rule eased its fill over 120 ms (not S3's colours, 11.96:1); buttons now ease only shadow and transform, guarded by a test; CI green (#308 for two more transitions) |
| S2h the phone library (08a), lamp-lit (09a) | #199 | #311 | b10ce90 | full gate 11 of 11 (pytest 2,562); desktop 0 px against S3's head over 14 views; on a phone Enter/tap opens the sheet and "Open the book" the spread; CI green |
| no-network guard for web unit tests | #310 | #312 | a8eb3e5 | 97 connection attempts to port 8000 in a full run → 0, measured by a counting stub and again by the reviewer; 8 specs given mocks; CI green |
| S8 the whole flow, reduced motion, numbers, RESULT per frame | #218 | #320 | 91857a4 | full gate 11 of 11 (pytest 2,562); CI full e2e 88/88 in 30.1 min (job timeout raised to 60); the flow found a stale-board placement bug in Send page to board and the lasso's send, fixed with tests; 32 frames: 16 done, 16 partial (see below) |

## Live AI spend (estimates)

| When | Slice | Kind | Model | Tokens | Cost (estimate) |
| --- | --- | --- | --- | --- | --- |
| 2026-10-17 02:09 IST | S4e #205 | explain, one live smoke at 390 ([shots/S4e/live-smoke.md](shots/S4e/live-smoke.md)) | MiniMax-M3.1-Flash-Preview, effort low | 4,004 in (plus 190 cache reads) / 394 out | ≈ $0.0017 (on M3 rates) |
| 2026-10-17 02:45 IST | S7b #217 | diagram (the one live smoke, [shots/S7b/live-smoke.md](shots/S7b/live-smoke.md)) | MiniMax-M3.1-Flash-Preview, effort low | 4,487 in (4,416 cache reads) / 351 out | ≈ $0.0020 (on M3 rates) |
| 2026-10-17 | S2b2 (#242) | topic (2 calls: the API run, and the same request again to capture the answer) | MiniMax-M3.1-Flash-Preview | 748 in / 67 out, then 699 in / 81 out | $0.0006 (see live-smokes/S2b2-topic.md) |
| 2026-10-17 14:20 IST | README v0.2 (#182) | diagram, one run for the README's plate shot (Attention §3.2.1 ¶1; 5 parts, 5 cited; no retries; the agent was stopped right after) | MiniMax-M3.1-Flash-Preview, effort low | 4,048 in (plus 178 cache reads) / 270 out | ≈ $0.0015 (on M3 rates) |

## S8: the whole flow, reduced motion and the numbers at scale (#218), 2026-10-17

**The flow.** `e2e/v02/prototype-flow.spec.ts` walks frame 12's 14 steps (library → search "atten" → pull out
→ open → Read → select → Explain → marker 2 flashes passage 2 → Dive in → the notebook page → the board → a
thread from the plate's brass pin → Link as → supports) at 1440 and 390, daylight and lamp-lit: four journeys.
After every step the motion has settled, the scheme's own `--pt-page` token is on (#269), no "verified",
"fact-checked" or "accurate" is on screen, and axe finds nothing serious or critical. On the way it asserts the
three voices, that the flashed polygons lie over passage 2's own words, the "(estimate)" usage line, and the
supports thread's colour (the stroke is `--pt-wire-supports`) and second cue (solid with +, its tag). At 390
the phone's own path: Enter takes the book down into its sheet (no pull-out on a phone, #199) and "Open the
book" opens the spread; the reader's controls are in "Reading options"; the usage line and Dive in are in the
sheet's pinned footer; the notebook is the phone stack, which says lasso, shapes and templates are for a tablet
or computer; the thread is made by tapping the brass pin, then the open one. The board's plate (a faux diagram
run on §3.2.1 ¶1) and passage card are placed through the API just before the board, as the prototype's board
already holds them. Shots: [shots/S8/](shots/S8/).

**Reduced motion.** `e2e/v02/reduced-motion.spec.ts` (1440, `reducedMotion: 'reduce'`) records every animation
the page starts (`document.getAnimations()` on every frame) and checks each moment completes and runs no
animation longer than DESIGN.md §6's reduced column. What ran (run 2): pull out, open, put back and Read one
120 ms fade each; Explain none; the flash none on the ring and wash (they stay until the next action; only the
120 ms colour change of marker ↔ trace); Dive in one 120 ms fade; Back to the paper none; the plate's parts none;
the board's thread none (the picker and the thread appear at once). The one motion `getAnimations()` cannot see is
the flash's scroll to an off-screen passage (`tweenScroll` in `components/reader/flash.ts`, a frame loop of 240 ms).
After the review the spec scrolls the reader half the paper away before marker 2 and reads `scrollTop` on every
frame: under reduced motion it must reach the passage with at most one position on the way. Checked first with a
probe running the spec's steps against S8's dev server (`probe/scripts/p7-scroll.mjs`): the reduced path jumped
from 7,569 to 222 px with no position between; with `prefersReducedMotion() ||` removed from `tweenScroll` it
passed through 5 positions (7,344 … 2,873) before the flash, which fails the check. A unit test
(`test/s4b-exchange.spec.tsx`, "jumps to an off-screen passage under reduced motion") fails on the same mutation.

**Targeted e2e runs (owner rule: never the full suite here; all 3 allowed were used).**

| Run | Started (load 1/5/15) | Result |
| --- | --- | --- |
| 1 | 13:13 (3.42 8.16 9.24; 21.03 10.50 9.84 at the end) | 3 passed, 2 failed: both 390 journeys at step 12. The tap on the plate's brass pin landed on the notebook card's pin, because "Send page to board" had put the page's card on top of the plate (a product defect, fixed below) |
| 2 | 13:19 (2.93 6.85 8.46; 3.65 6.02 7.97 at the end) | **5 passed** in 1.4 min (flow 18.0, 15.2, 13.4, 13.4 s; reduced motion 19.1 s) |
| 3, after the review | 14:16 (18.06 9.49 6.75; 7.45 8.21 6.52 at the end) | **5 passed** in 1.4 min (flow 17.8, 14.2, 12.7, 12.7 s; reduced motion 16.5 s); the flash's scroll went 7,569 → 222 px in one frame, nothing between |

**Fixed on the way (found by the flow).** "Send page to board" placed the page's card below everything on the
board AS THE PAGE HAD READ IT when it opened, so a card added since (another tab, the reader's Send to board)
was covered (at 1440 the plate was hidden under the page's card). It now reads the board again first
(`features/notebook/hooks/useBoardCard.ts`); `test/s5c-notebook-panel.spec.tsx` places a card from "another
tab" and fails without the fix (`expected +0 to be 340`); the flow asserts no two cards on the board overlap. The
review found the same defect in the lasso's Send to board (`hooks/useLasso.ts`); both now read the board through
one `freshBoard` (the board as last read if that read fails), and `test/s5d-notebook-lasso.spec.tsx` fails on the
old lasso code the same way.

**CI time.** The e2e job took 28 min 57 s on S3's PR (#302), and 31 min 14 s on S8's own PR (#320: 88 passed
in 30.1 min; S8's five tests 116.5 s of it), so its `timeout-minutes` goes from 40 to 60
(`.github/workflows/ci.yml`). The "at least 11 specs" floor is unchanged.

### Performance at scale

Production build (`next build` + `next start` on 127.0.0.1:18904, API 18909, a copy of the v0.2 data), headless
Chromium 1440 × 900. The probe scripts are in `PaperTree-scratch/v02/tmp/s8/probe/scripts/` and their raw outputs
in `PaperTree-scratch/v02/tmp/s8/probe/` (outside the repo, and that scratch is removed when the build ends), except
the ink probe, which is the committed `apps/web/scripts/ink-latency.mjs`. The box was nearly idle this time (load about 2–4),
much quieter than the slices' own runs, so a lower number here is mostly the load, not a gain.

| What | Measured (S8) | Load (1/5/15) | Slice's own number (its load) |
| --- | --- | --- | --- |
| **400 spines** (the demo account's rows repeated to 400 by a route on `GET /papers`, as S2e did; 403 drawn with the 3 sample papers), 3 runs | render, from the `GET /papers` answer to the shelf drawn: 18–23 ms (the probe rounds it to the ms); a search keystroke ("a" … "atten" and back, 10 keys): 3.0–31.0 ms to the frame drawn (median 15.3–17.85), 1–15 ms of script (CDP `ScriptDuration`); Arrange by Year / Title / Topic: 42.5–56.6 / 31.3–45.8 / 17.8–27.7 ms to the frame, 11–28 ms of script | 2.02–2.30 / 4.62–4.86 / 7.13–7.30 | S2e (54–80, `ScriptDuration` only): render 25–26 ms, keystroke 2–8 ms, re-arrange 14–31 ms |
| **400 rows** (the Table, same rows), 3 runs | open the Table: 62.5–80.5 ms to the frame (33–43 ms script); sort by Year, twice: 26.0–48.4 ms (5–14); a keystroke: 2.8–57.2 ms (median 10.45–11.95; 1–27 script); back to the Shelf: 32.5–49.3 ms | same runs | S2f (6–12): open 96–142, sort 48–69, keystroke 6–50 (median 16), back 47–52 ms |
| **500 cards** (S6e's recipe: 500 passage cards, real ResNet paragraphs with `capture_anchor` anchors, 167 supports threads; S6e's own probe re-pointed), 2 runs | first card 198–245 ms after navigation; 500 glances, 6,371–6,375 elements, 1 long task (66–82 ms); at the first view (20 %) pan, wheel zoom and a card drag p50 / p95 / max 16.7 / 16.7 / 17 ms, Fit all max 33; at 106 % 30 full cards in the page, the same gestures 16.7 / 16.7 / 17, Fit all max 67; a settled board 0 requests in 15 s | 2.26–4.00 / 4.30–4.77 / 6.80–7.11 | S6e after the review (21.7 / 29.7 / 30.7): first card 1,322 ms, every gesture one frame at p95 (max 33–83), Fit all max 67 |
| **Ink latency** (a blank page on Attention, 2 sets × 3 runs of scripted 200-point strokes at 240 Hz) | `cdp` driver: written median 13.5–14.2 / p95 15.2–16.0 ms, next frame (proxy) 28.1–29.0 / 30.4–31.3, script work 1.7–2.1 / 2.4–2.6; `page` driver: written 8.3–9.3 / 15.8–16.0 | 2.22–2.69 / 3.98–4.24 / 6.56–6.75 | S5d (11–81): `cdp` written 13.2–15.2 / 15.6–16.8 ms |

How each number is taken: "to the frame" is in-page, from the action's dispatch to the second animation frame
after it (render, style, layout and paint; it includes the wait for the next frame, so it is never under one
frame's remainder); "script" is the CDP `ScriptDuration` delta over the action (S2e's method); the 500-card
numbers are rAF frame intervals during each gesture (S6e's). Keystrokes and clicks are dispatched in the page
(the native value setter and an `input` event, or `click()`), not through CDP input.

NOT MEASURED: a real phone or tablet (every number is headless Chromium at 60 Hz, no display), style, layout
and paint for the ink path on their own (the probe's own caveat), glass-to-pixel time, and the library at 400
on a phone.

### Frames

Every frame in `reference/`, as the release stands with all slices merged (S2h's #311 included). **done**: what
the frame draws is built, and its differences are deliberate and recorded in the slice's shots README;
**partial**: something it draws is not built (the issue says what). "Seen by S8" means the frame's surface is in
S8's flow shots at that size and scheme; the other verdicts rest on the slice's own shots and notes, not on a
new comparison here.

| Frame | Verdict | Built by | Shots | What is missing, or the note | Seen by S8 |
| --- | --- | --- | --- | --- | --- |
| 00-strip | done | S1a #188, S1b #189, S1c #190 | [s1a](shots/s1a/), [S1d](shots/S1d/) | | not checked |
| 01-shelf-1440 | done | S2d #195, S2e #196 | [S2d](shots/S2d/), [S2e](shots/S2e/) | "N need a look" opens the Table filtered (owner default); gilt lighter for 4.5:1 | no (the flow's library is face-out) |
| 01b-shelf-empty-1440 | partial | S2e #196 | [S2e](shots/S2e/) | the footnote on topic suggestions (#315) | no |
| 01c-shelf-3-papers-1440 | done | S2e #196 | [S2e](shots/S2e/) | the topic line under each cover is not shot: S2e's shots predate topics, and S8's account has none | yes, 1440 both schemes (four books, no topics) |
| 01d-table-1440 | done | S2f #197 | [S2f](shots/S2f/) | 400 rows measured above | no |
| 01e-map-1440 | done | S2g #198, S2c #194 | [S2g](shots/S2g/) | only real citation links, drawn dotted (the frame has none to draw) | no |
| 01f-shelf-at-scale-1440 | done | S2e #196 | [S2e](shots/S2e/) | 400 spines measured above | no |
| 02-book-open-1440 | done | S3 #200 | [S3](shots/S3/) | | yes, 1440 both schemes; 390 stacked |
| 02a-book-pulled-1440 | done | S3 #200 | [S3](shots/S3/) | the frame shows two variants; the build pulls out one | yes, 1440 both schemes |
| 03-topics-1440 | partial | S2g #198 | [S2g](shots/S2g/) | no Figure 1 plate on a banner (#314) | no |
| 04-reader-explain-1440 | partial | S4b #202, S4c #203 | [S4b](shots/S4b/), [S4c](shots/S4c/) | "Summarize paper" for "Summary", no first-text time (#318); the flash in Guided (#245) | yes, 1440 both schemes |
| 04b-explain-streaming-1440 | partial | S4d #204 | [S4d](shots/S4d/) | no live trace while a first answer streams (#318) | no |
| 04c-explain-error-1440 | partial | S4d #204 | [S4d](shots/S4d/) | "Change the daily cap" (#256) | no |
| 04d-summary-1440 | partial | S4d #204 | [S4d](shots/S4d/) | no ¶ on the summary's tabs (#257); Dive in and Send to board on a summary (#258) | no |
| 05-notebook-1440 | partial | S5c #208, S5d #209 | [S5c](shots/S5c/), [S5d](shots/S5d/) | no figure crop tool; ink under the cards (#317) | yes, 1440 both schemes |
| 05b-notebook-tablet-1180 | partial | S5e #210 | [S5e](shots/S5e/) | no crop tool (#317); pinch zoom (#292) | no |
| 06-board-1440 | partial | S6b #212, S6c #213, S6d #214, S6e #215 | [S6b](shots/S6b/), [S6c](shots/S6c/), [S6d](shots/S6d/), [S6e](shots/S6e/) | passage tabs say "p. 1" without "¶1" (#255) | yes, 1440 both schemes |
| 06b-board-empty-1440 | done | S6d #214 | [S6d](shots/S6d/) | | no |
| 07a-diagram-ask-1440 | done | S7b #217 (S7a #216) | [S7b](shots/S7b/) | | no |
| 07b-diagram-building-1440 | done | S7b #217 | [S7b](shots/S7b/) | the arriving part has no label (the API sends whole lines) | no |
| 07c-diagram-done-1440 | partial | S7b #217 | [S7b](shots/S7b/) | the flash marks the whole paragraph (#123); Add to notebook (#276); one passage per part, part A as one box (#319) | the plate card only, on the board |
| 07d-diagram-crafted-hint | partial | S7b #217 | [S7b](shots/S7b/) | information only, no crafted-figure job (#319) | no |
| 08a-phone-library-390 | done | S2h #199 | [S2h](shots/S2h/) | | yes, 390 both schemes |
| 08b-phone-reader-390 | partial | S4e #205 | [S4e](shots/S4e/) | the margin tab on a phone is off the page or over the passage (#279) | yes, 390 both schemes |
| 08c-phone-notebook-390 | done | S5e #210 | [S5e](shots/S5e/) | | yes, 390 both schemes |
| 09a-library-other | partial | S2d #195, S2h #199 | [S2h](shots/S2h/) | no preview card over a focused spine, holders on one line, no chevron (#315) | 1440 lamp-lit face-out only |
| 09b-reader-other | partial | S4e #205 | [S4e](shots/S4e/) | no first-text time (#318) | yes, 1440 and 390 lamp-lit |
| 09c-board-other | partial | S6e #215 | [S6e](shots/S6e/) | the passage tabs and the Link as header say "p. 1" without "¶1" (#255), as on 06 | yes, 1440 and 390 lamp-lit |
| 10-design-system | done | S1d #191, #237 | [S1d](shots/S1d/) | | not checked |
| 11-motion | partial | S3 #200, S4b #202, S5e #210, S6c #213, S2d #195 | [S3](shots/S3/), [S5e](shots/S5e/), [S6c](shots/S6c/) | Enter in the search does not pull out (#313); Back's reverse page turn and the pen live on arrival (#316); every reduced moment held to its duration by S8's spec | the reduced path, by measurement |
| 12-prototype | done | S8 #218 | [S8](shots/S8/) | the 14 steps pass at 1440 and 390 in both schemes; on a phone steps 3–4 are the sheet and "Open the book" by design | yes |
| 13-ask-trace-options-1440 | done (option 1) | S4b #202 | [S4b](shots/S4b/) | option 1 is the owner's default; options 2 and 3 are the alternatives the frame offers, not built (one swappable layout component) | yes (option 1) |

Counts: 16 done (one of them option 1 of 13), 16 partial, 0 not done. Every partial names its issue; the
issues S8 filed are #313–#319.
