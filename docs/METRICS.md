# PaperTree metrics

This is the release-history metrics page. Every release adds one column to the table in "The releases at a glance" and one "vX against vY" section, so that anyone can see what a release measured and how it got better (or worse) than the one before. Rules: every number is re-measured for that release and names its raw source, never carried over from an older page; a comparison is made only between like and like (the same papers, the same judge panel, the same kind of run); what got worse is written down with its cause; a result that is only partly there is written as PARTIAL and is not rounded up. Cells that need the final gate on the release head or the final hands-on walk read `[FINAL GATE]` or `[S9]` until the release owner fills them. Evidence is cited by label (for example `PaperTree-evidence/01-discovery/journey-baseline.md`); the evidence store is kept outside the repository.

v0.1 is the first release, so it is compared against two pre-release baselines: the discovery walk at `6ff15ad` (2026-09-25) and the handoff gate at `45fb2db` (2026-09-26). The journeys are the ones in ADR-002: A upload and read, B highlights, C grounded explanation and summary, D canvas, E evidence of which code and provider ran, F the gates and CI.

## The releases at a glance

| Metric                                           | discovery `6ff15ad` (2026-09-25)                                                                                                                                              | handoff `45fb2db` (2026-09-26)                                                                                   | v0.1 (2026-10-15)                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Journey A (upload, parse, read)                  | PARTIAL: DDPM upload dead-letters in about 17 s (FAIL); YOLO opens but the card appears only after a manual reload, shows 0 pages, thumbnails never render                    | API PASS; the web library still read the pre-S1 row shape (cards said "Queued", showed the paper id and 0 pages) | Interim orchestrator walks (da896fa, 8bebef6): upload to Ready without a reload PASS, real title and 10 pages, DDPM upload to Ready PASS. Final: `[S9]`                                                                                                           |
| Journey B (highlights)                           | FAIL: mouse click cannot create one; a keyboard one paints the whole block, never reaches the server, vanishes on reload; a mode switch blanks the PDF                        | PASS in e2e (Journey B on an uploaded YOLO)                                                                      | Interim walk: highlight paint exact, POST 201 (da896fa). Walk findings R1, R2 sent to the fix wave. Final: `[S9]`                                                                                                                                                 |
| Journey C (explain, follow-up, summary)          | PARTIAL: real MiniMax-M3 calls with citations, but 2 of 5 asks returned 504, no follow-up, no summary                                                                         | never run end to end                                                                                             | Interim walks: explain streams with tool status and chips, summary via UI with cited bullets, cached on reload (ai_runs 19 to 19). Final: `[S9]`                                                                                                                  |
| Journey D (canvas)                               | FAIL: no canvas exists, `/canvas` is a 404                                                                                                                                    | not built (routes were 501 stubs)                                                                                | Interim walk: passage plus explanation sent, canvas shows 2 nodes. Final: `[S9]`                                                                                                                                                                                  |
| Journey E (which code and provider ran)          | DONE: code paths read; one TLS socket to the MiniMax edge seen during a call                                                                                                  | not observed anywhere                                                                                            | Observed at 8bebef6: the agent's only remote socket was an `api.minimax.io` address plus 127.0.0.1; `ai_runs` rows carry code_path, provider, model, agent_sdk, tokens, cost. Final: `[S9]`                                                                       |
| Journey F (gates and CI)                         | all green except prettier (25 files failing, #118)                                                                                                                            | all green except one wall-clock test (#80) that failed at load 15 and load 60                                    | baseline re-measured on main `4a29bc7`: all green. Final head: `[FINAL GATE]`                                                                                                                                                                                     |
| 390 px reader                                    | FAIL (page scrollWidth 622; dashboard PASS)                                                                                                                                   | not walked                                                                                                       | `[S9]`                                                                                                                                                                                                                                                            |
| Papers that parse (of 14)                        | 12 (DDPM dead-letters on a clip-box check; Mask R-CNN fails; the 14-paper count is from the S2 base measurement)                                                              | 14                                                                                                               | 14 (re-measured by the S2R review; DDPM and Mask R-CNN also pass through the real worker)                                                                                                                                                                         |
| Parser: repo-gold pooled reading order (6 pages) | 0.900 (235/261), 26 discordant pairs (S2 base)                                                                                                                                | 0.962 (230/239), 9 discordant pairs                                                                              | 0.962 (230/239), 9 discordant pairs (re-measured by S2R). Macro-F1 per paper in the next section                                                                                                                                                                  |
| TS tests (turbo test)                            | 1,389: anchoring 300, document-ir 864, db 43, ui 41, web 141                                                                                                                  | 1,625: document-ir 864, anchoring 336, web 262, agent 113, ui 50 (db TS twin deleted)                            | main `4a29bc7`: 1,625 (same split). Final head: `[FINAL GATE]`                                                                                                                                                                                                    |
| pytest                                           | 1,733 passed, 2 skipped, 0 failed (361.3 s, load 6-7)                                                                                                                         | 2,135 passed, 1 failed (#80), 1 skipped, 1 xfailed (1,436 s, load 10 to 60)                                      | main `4a29bc7`: 2,136 passed, 1 skipped, 1 xfailed, 0 failed (460 s, load 2 to 5). Final head: `[FINAL GATE]`                                                                                                                                                     |
| e2e specs (Playwright)                           | 0 (no browser test existed)                                                                                                                                                   | 5 passed (4.0 min)                                                                                               | main `4a29bc7`: 5 passed (87 s). On the CI branch: 11 specs. Final head: `[FINAL GATE]`                                                                                                                                                                           |
| Agent tests                                      | none (the agent service did not exist)                                                                                                                                        | 113 pass                                                                                                         | main `4a29bc7`: 113. S5F branch: 138. Final head: `[FINAL GATE]`                                                                                                                                                                                                  |
| CI: what ran                                     | 3 jobs: TypeScript (typecheck, lint, test, codegen drift), Python (pytest, ruff, mypy), fixture validation. No prettier, no `next build`, no corpus, no browser, no live call | same as the discovery column                                                                                     | 6 jobs: Prettier, fixtures, Web build (`next build`), TypeScript (adds agent tests), E2E (Playwright A to D on a faux agent), Python (adds corpus and fresh-set tests, asserts nothing skipped). Plus a live-journey workflow (real model, on a label or by hand) |
| CI wall clock                                    | not recorded; CI pytest alone was 39.44 s (1,515 passed, 136 skipped)                                                                                                         | not recorded                                                                                                     | CI run 38702211039: Prettier 30 s, fixtures 24 s, Web build 57 s, TypeScript 1 m 50 s, E2E 5 m 28 s, Python 14 m 44 s (slowest job). Final head: `[FINAL GATE]`                                                                                                   |
| AI first text, explain                           | not split out (the endpoint did not stream; the Inspector was empty for 10 to 40 s)                                                                                           | not measured (never run live)                                                                                    | Flash, release head 8bebef6, load 2 to 3: p50 2.13 s, n=9. A/B Flash: p50 1.82 s, n=12, load 7.6                                                                                                                                                                  |
| AI total latency (answers)                       | M3 via UI or curl: 3 answers in 10.9, 29.0 and 72.6 s; 2 of 5 asks returned 504 after 26.1 and 40.4 s                                                                         | not measured                                                                                                     | A/B Flash explain total p50 5.12 s (n=12), ask 6.69 s (n=4); M3 explain 15.29 s (n=12), ask 11.75 s (n=4); summary M3 21.82 s (n=2). 0 of 38 A/B runs ended in error (35 complete, 3 partial summaries)                                                           |
| Tokens and cost per explain                      | M3 ask runs: 33,150 in / 3,631 out and 115,742 in / 10,451 out (cost not recorded)                                                                                            | not measured                                                                                                     | Flash explain: mean 4,489 in / 449 out, about $0.0019 (estimate on M3 rates); M3 explain 3,901 in / 1,397 out, $0.0029 (A/B). Live journey M3 on `4a29bc7`: 3,349 in / 795 out, $0.0020                                                                           |
| Tokens and cost per follow-up                    | no follow-up existed                                                                                                                                                          | not measured                                                                                                     | M3 live journey: 4,183 in / 1,224 out, $0.0027. Other policy numbers: see "AI: latency, tokens and cost"                                                                                                                                                          |
| Tokens and cost per summary                      | no summary existed                                                                                                                                                            | first live try FAILED (14 tool calls, `tool_budget_exhausted`, no text; 38,199 in / 466 out, $0.0148)            | after the S5F digest: YOLO 4,837 in / 966 out, $0.00262, 0 tool calls; DDPM 5,295 in / 888 out, $0.00266                                                                                                                                                          |
| Highlight persistence                            | none (in memory, 0 server rows, gone on reload)                                                                                                                               | persisted; painted from stored quads                                                                             | persisted; painted from stored quads; reload identical `[S9]`                                                                                                                                                                                                     |
| Summary                                          | none                                                                                                                                                                          | API only, no UI, never run live                                                                                  | works: YOLO complete, 7 bullets, 7 of 7 supported; DDPM partial (8 bullets, 7 supported, the 8th honestly uncited). UI walk: `[S9]`                                                                                                                               |
| Canvas                                           | none                                                                                                                                                                          | none (501 stubs)                                                                                                 | minimal (nodes, labelled edges, groups, reload persistence); final verdict `[S9]`                                                                                                                                                                                 |
| Known defects                                    | 23 open issues (issues triage at `6ff15ad`)                                                                                                                                   | tracker #141; not counted                                                                                        | 10 walk findings R1 to R10 on the ledger so far, plus review should-fix items; final count `[S9]` (see the last section)                                                                                                                                          |

## Parser quality by paper

Source: `research/benchmarks/READER-RELEASE-PARSER.md`, section "Independent review (v0.1)" (R.4), re-measured by the S2R track. Base is the first parent of the S2 merge (the `18f69ec` lineage); head is `release/v0.1` including S2. Each paper was parsed in a fresh subprocess; the repo gold covers 6 papers, 36 pages, one annotator, no inter-annotator agreement. "RO" is reading order. The S2R review reproduced 83 of 83 per-type F1 cells and every quality number; it did not reproduce the peak-RSS figures in the S2 report (see the end of this section).

### Repo gold (6 papers)

| Paper                     | Blocks base to head | Per-page RO base to head | Pooled RO base to head             | Macro-F1 base to head           | Outcome base to head |
| ------------------------- | ------------------- | ------------------------ | ---------------------------------- | ------------------------------- | -------------------- |
| a3c-algorithmheavy        | 1232 to 1287        | 0.667 to 0.667           | 1.000 (4/4) to 1.000 (9/9)         | 0.3932 to 0.4185 (+0.0253)      | complete to complete |
| attention-is-all-you-need | 480 to 546          | 0.389 to 0.667           | 0.921 (35/38) to 1.000 (47/47)     | 0.2899 to 0.3528 (+0.0629)      | complete to complete |
| bert-2col                 | 681 to 770          | 0.699 to 0.833           | 0.806 (54/67) to 1.000 (49/49)     | 0.3523 to 0.3752 (+0.0229)      | complete to complete |
| gpt3-longform-singlecol   | 4597 to 4860        | 0.222 to 0.333           | 0.778 (7/9) to 1.000 (9/9)         | 0.3429 to 0.3416 (-0.0013)      | complete to complete |
| neural-odes-mathheavy     | 626 to 679          | 0.611 to 0.611           | 0.975 (39/40) to 0.975 (39/40)     | 0.2175 to 0.2280 (+0.0105)      | complete to complete |
| resnet-cvpr-2col          | 955 to 1013         | 0.929 to 0.894           | 0.932 (96/103) to 0.906 (77/85)    | 0.3257 to 0.3575 (+0.0318)      | complete to complete |
| all six                   |                     |                          | 0.900 (235/261) to 0.962 (230/239) | mean 0.3203 to 0.3456 (+0.0253) |                      |

The mean macro-F1 is the plain mean of the six rows above (base 1.9215 / 6, head 2.0736 / 6); the S2R sensitivity table also reports 0.3456 for head. Quote the discordant count beside the pooled rate: scored pairs fell from 261 to 239 while discordant pairs fell from 26 to 9, so part of the rise is a smaller denominator.

### The other eight papers (no repo gold)

| Paper                     | Outcome base to head                         | Blocks base to head |
| ------------------------- | -------------------------------------------- | ------------------- |
| ddpm-2006.11239           | FAILED (SemanticValidationError) to complete | none to 540         |
| maskrcnn-1703.06870       | FAILED (ValueError) to complete              | none to 899         |
| yolo-1506.02640           | complete to complete                         | 770 to 825          |
| flashattention-2205.14135 | complete to complete                         | 3261 to 3438        |
| sbert-1908.10084          | complete to complete                         | 628 to 704          |
| adam-1412.6980            | complete to complete                         | 321 to 359          |
| pdf-to-tree-acl2col       | complete to complete                         | 486 to 538          |
| superglue-tableheavy      | complete to complete                         | 846 to 955          |

### Fresh gold, pages 1 and 2

The fresh gold has 125 anchor units from two model annotators plus an adjudicator; owner review is pending (#54), so it informs but does not gate. Base did not parse DDPM or Mask R-CNN, so the like-with-like comparison uses the four papers that parse at both (YOLO, FlashAttention, SBERT, Adam); the head column for all six follows.

| Check (pages 1 and 2)                 | base, 4 papers | head, same 4 papers | head, all 6 papers |
| ------------------------------------- | -------------- | ------------------- | ------------------ |
| Gold paragraphs merged into one block | 45 of 52       | 8 of 52             | 10 of 71           |
| Body text typed as something else     | 13 of 60       | 0 of 60             | 0 of 83            |
| Headings typed correctly (typed/gold) | 8 of 13        | 11 of 13            | 15 of 19           |
| Numeric-only headings produced        | 11             | 0                   | 0                  |
| False headings                        | 0              | 0                   | 0                  |
| Title read first                      | 3 of 4 papers  | 4 of 4 papers       | 6 of 6 papers      |
| Pairwise reading order within page    | 485 of 519     | 519 of 519          | 652 of 652         |
| Captions                              | 4 of 4         | 4 of 4              | 8 of 8             |

Other parser facts from the same review: determinism over 20 fresh-process runs each on YOLO, DDPM and Mask R-CNN gave 1 distinct output and 1 block-id sequence per paper; speed is unchanged within noise (for example gpt3 0.081 to 0.072 s per page); 15 of 16 mutants of the new parser rules were killed (the survivor is the duplicate-id salvage lane, which only a real-PDF test pins and that test skips without the corpus).

### Accepted regressions

1. **ResNet pooled reading order 0.932 to 0.906** (per-page 0.929 to 0.894). Cause: the paragraph-split rule (`b96ed98`) splits runs of printed paragraphs that the gold boxes as one region, so those regions stop matching and their pairs leave the pool (116 to 80 pairs). All 8 discordant pairs left at head are against annotation defects in the gold (footnotes the guide says are out of body order; a second wide figure box drawn after the text). The parser's own real discordant pairs on ResNet went from 2 to 0. Accepted by the S2R review; the gold files are not this track's to edit, and the two defects go to the gold review (#54). The owner still has to ratify the merge-rule exception.
2. **GPT-3 macro-F1 0.3429 to 0.3416 (-0.0013)**; paragraph F1 0.190 to 0.174. Cause: two extra predicted paragraph blocks (18 to 20; page 30 correctly rises from 1 to 7, page 15 falls from 15 to 11) against a gold that holds only 3 paragraph regions on those pages. A precision effect of a correct split on a three-region gold. The S2 report's own explanation was wrong; the S2R review replaced it.

Other per-type F1 drops over 0.05, all from the same paragraph-split rule against multi-paragraph gold boxes: a3c paragraph 0.417 to 0.357, bert paragraph 0.545 to 0.342, resnet paragraph 0.575 to 0.404; and attention caption 0.667 to 0.500 (the raw gold types that caption box as a figure).

Not reproduced: the S2 report's peak-RSS figures. S2R measured gpt3 at 507 to 511 MB on head against 499 to 509 MB on base (about +8 MB), 8.8 MB under the 520 MB ratchet at load 9 to 10. Tuning risk: all thresholds were chosen on the same 14 papers they are scored on, and there is no held-out paper; the paragraph cues sit on a plateau (indent 0.3 to 0.8 em and skip 0.25 to 0.4 em give identical results), which argues against fitting to the gold but is not an out-of-sample test.

## AI: latency, tokens and cost

Every row names its source, n and the machine load. Cost is the API's own estimate (`cost_usd_est`); MiniMax-M3.1-Flash-Preview has no published price, so Flash costs are estimates on M3 rates. Machine load was not controlled, and the arms of each comparison ran one after the other, so latency gaps are confounded by load (stated per row).

### Baseline: M3 through the old API loop, `6ff15ad`

Source: `PaperTree-evidence/01-discovery/journey-baseline.md` (section 4 and the Playwright pass), live MiniMax-M3, YOLO, n=5 asks, load not recorded.

| Run                                     | Result                            | Time   | Tokens in / out  |
| --------------------------------------- | --------------------------------- | ------ | ---------------- |
| UI explain, selection 1                 | 200                               | 10.9 s | not captured     |
| UI explain, selection 2                 | 504 (4,096-token ceiling, step 2) | 40.4 s | n/a              |
| UI explain, selection 3                 | 504 (same, step 1)                | 26.1 s | n/a              |
| curl, same question                     | 200                               | 29.0 s | 33,150 / 3,631   |
| UI explain, "Humans glance at an image" | 200                               | 72.6 s | 115,742 / 10,451 |

No cost was recorded at that commit. There was no first-text split (the endpoint did not stream), no follow-up and no summary.

### Release starting point: M3 on `4a29bc7`

Source: `docs/release/v0.1/PLAN.md`, first live journey (2026-10-15 12:10 IST), YOLO over HTTP, one run per step. The summary row is the defect that S5F then fixed.

| Step      | First text | Total  | Tokens in / out | Cost est. | Result                                       |
| --------- | ---------- | ------ | --------------- | --------- | -------------------------------------------- |
| explain   | 7.9 s      | 12.4 s | 3,349 / 795     | $0.0020   | complete                                     |
| follow-up | 8.9 s      | 14.0 s | 4,183 / 1,224   | $0.0027   | complete                                     |
| free ask  | 8.6 s      | 11.2 s | 4,568 / 623     | $0.0023   | complete, 4 tool calls                       |
| summary   | none       | 26.3 s | 38,199 / 466    | $0.0148   | FAIL: 14 tool calls, `tool_budget_exhausted` |
| cancel    | 12.6 s     | 12.6 s | 0 / 0           | $0.0003   | aborted, partial kept; usage recorded as 0   |

Like with like against the baseline: the same paper (YOLO), same kind (explain), same model (M3): total 10.9 s (baseline, UI) against 12.4 s here, so the model's speed is not what changed; what changed is input size (33,150 tokens on a baseline ask against 3,349 on an explain here; the two runs are not the same request, so read it as the order of magnitude) and that nothing returned 504.

### Model A/B: M3 against Flash

Source: `docs/release/v0.1/MODEL-AB.md` and `research/architecture-decisions/ADR-003-model-policy.md`, 38 live runs on YOLO and DDPM, estimated $0.18 on M3 rates, evidence label `t0-impl/ab1`. Arms ran one after the other (M3 first); M3 rows ran at load 8.7 to 9.7, Flash rows at 3.6 to 7.6, which favours Flash on every latency number.

| Kind    | Arm          | n   | Complete         | First text p50 / p90 (ms) | Total p50 (ms) | Out / reasoning tokens (mean) | Cost per run | Load |
| ------- | ------------ | --- | ---------------- | ------------------------- | -------------- | ----------------------------- | ------------ | ---- |
| explain | M3           | 12  | 12               | 9,281 / 26,422            | 15,290         | 1,397 / 827                   | $0.0029      | 8.7  |
| explain | Flash low    | 12  | 12               | 1,824 / 3,489             | 5,124          | 449 / 34                      | $0.0019      | 7.6  |
| ask     | M3           | 4   | 4                | 8,118 / 8,897             | 11,754         | 857 / 223                     | $0.0065      | 9.7  |
| ask     | Flash low    | 4   | 4                | 4,038 / 6,320             | 6,687          | 519 / 15                      | $0.0046      | 5.3  |
| summary | M3           | 2   | 2                | 14,040 / 14,158           | 21,820         | 1,014 / 314                   | $0.0136      | 9.0  |
| summary | Flash low    | 2   | 0 (both partial) | 6,478 / 6,820             | 11,080         | 935 / 0                       | $0.0093      | 4.6  |
| summary | Flash medium | 2   | 1 (one partial)  | 11,368 / 13,767           | 17,770         | 1,343 / 0                     | $0.0155      | 3.6  |

Only the explain rows (12 runs per arm) support a latency distribution; ask (n=4) and summary (n=2) are too thin to decide anything. The single-judge usefulness sample (12 pairs, style gives the arm away) was: explain M3 4.19 against Flash 4.25; ask M3 4.56 against Flash 3.94; summary M3 4.62, Flash low 4.25, Flash medium 4.12.

### Live runs on the release head (orchestrator, 8bebef6, load 2 to 3)

Source: `PaperTree-evidence/v0.1/orchestrator/RUNS.md`, "Live measurements on release 8bebef6". The ledger does not name the model for the follow-up and ask rows.

| Kind           | n              | First text (s)                                             | Total (s)          | Cost / other                                                                           |
| -------------- | -------------- | ---------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| explain, Flash | 9              | 6.05 1.55 2.13 4.83 5.32 1.29 1.32 and 4.84 1.60; p50 2.13 | not recorded       | about $0.0015 to $0.0019 per run; citations supported mostly true (7/7, 6/6, 5/7, 4/6) |
| follow-up      | 2              | 8.68 and 6.2                                               | not recorded       | not recorded                                                                           |
| ask            | 2              | 7.11 and 8.18 (3 tools)                                    | not recorded       | not recorded                                                                           |
| summary, M3    | 1 (plus run 3) | 26.3 (run 3: 8.5)                                          | 30.7 (run 3: 12.7) | 7 bullets, 13 of 13 supported                                                          |
| cancel         | 1              | n/a                                                        | n/a                | aborted; tokens null                                                                   |

### S5F: before and after on the same paragraph

Source: `PaperTree-evidence/v0.1/s5f-impl/REPORT.md` sections 0, 2, 6 and 7, YOLO and DDPM, M3, real key in the agent environment only.

| Measure                                                      | Before (`4a29bc7`)                 | After (S5F head)                                                 |
| ------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------- |
| Summary result (YOLO)                                        | FAILED, no text, 14 tool calls     | complete, 7 bullets, 7 supported, 0 tool calls                   |
| Summary input / output tokens, cost                          | 38,199 / 466, $0.01483             | 4,837 / 966, $0.00262 (DDPM: 5,295 / 888, $0.00266)              |
| Summary first text / total                                   | none / 26.3 s                      | 7.9 s / 11.2 s (DDPM 11.4 s / 18.0 s)                            |
| Aborted run usage                                            | stored as 0 tokens and $0          | NULL when the provider reported none; real numbers when reported |
| Explain first text p50 / p90, n=6, M3                        | 8.45 s / 14.00 s (load 6.1 to 8.4) | 20.62 s / 26.87 s (load 4.0 to 6.4): WORSE, see below            |
| Explain total p50                                            | 16.06 s                            | 25.23 s: WORSE                                                   |
| Citations judged supported (88 labelled pairs; one labeller) | recall 0.13, precision 1.00        | recall 0.65, precision 1.00                                      |
| Same on a 50-pair holdout                                    | recall 0.47, precision 1.00        | recall 0.77, precision 1.00                                      |

## Answer quality (judged sample)

Source: `docs/release/v0.1/QUALITY.md`, aggregated from `qual-gen/items.jsonl` and the three judges' `scores.json`. **This is a judged sample by 3 model judges on 3 papers (Neural ODEs, BERT, DDPM), 24 scored answers, one fixed question per paper per kind. It is not a grounding rate**: it says nothing about what share of PaperTree answers are correct. A real grounding rate needs human-written questions and human scoring (Tier C, #62). The judges are language models that read the same texts, partly saw arm names, and may share biases; cells hold 3 items, so a 0.3 gap is one or two scores moving.

Mean of the three judges, scores 1 to 5 (grounded, citations land, readable, useful, and their mean):

| Kind / arm             | n items | Grounded | Citations land | Readable | Useful | Mean of 4 |
| ---------------------- | ------- | -------- | -------------- | -------- | ------ | --------- |
| explain / Flash        | 6       | 4.39     | 4.44           | 4.56     | 4.33   | 4.43      |
| ask / Flash            | 3       | 4.00     | 4.22           | 4.33     | 4.00   | 4.14      |
| ask / M3               | 3       | 4.11     | 4.22           | 4.44     | 4.67   | 4.36      |
| follow-up / Flash      | 3       | 3.22     | 3.22           | 4.11     | 3.44   | 3.50      |
| follow-up / M3         | 3       | 3.78     | 4.22           | 4.00     | 4.11   | 4.03      |
| summary / M3           | 3       | 4.67     | 4.44           | 4.00     | 3.00   | 4.03      |
| summary / Flash medium | 3       | 3.44     | 3.67           | 4.00     | 4.33   | 3.86      |

- Defects counted by the judges (summed over 3 judges): unsupported claims explain/Flash 11, ask Flash 9 against M3 8, follow-up Flash 15 against M3 8, summary M3 3 against Flash medium 14; wrong citations follow-up Flash 9 against M3 0, summary Flash medium 4 against M3 0.
- Pair preferences (not blind; item ids and style gave the arm away): ask, M3 4 votes, ties 2, Flash 3 (9 votes); summary, M3 5, Flash medium 4.
- Inter-judge agreement: all three within one point on 23 or 24 of 24 items for every score. That is agreement between three models reading the same text, not proof the scores are right.
- The API's own `supported` flag: explain 20 of 29 citations (69%), ask 15 of 20 (Flash) and 14 of 19 (M3), follow-up 0 of 18 (Flash) and 1 of 15 (M3), summary 37 of 43 (M3) and 44 of 50 (Flash medium). Follow-up citations are almost never flagged supported (1 of 33) while the judges found most of them land, so the verifier's follow-up number is not an accuracy figure.
- Latency and cost in this run (load 2.4 to 6.6, arms at different times): explain/Flash median first text 2.9 s, total 6.2 s, $0.0017 (n=6); ask Flash 13.7 s first text, 16.9 s total, $0.0048 against M3 16.1 s, 20.3 s, $0.0064 (n=3 each); summary M3 7.0 s first text, 10.0 s total, $0.0026 against Flash medium 6.3 s, 8.6 s, $0.0046 (n=3 each).
- Weak spots found by reading: flipped facts ("can be evaluated" turned into "cannot"; two Flash medium summaries inverted a claim), a missed stated limitation (DDPM's non-competitive log likelihoods), a backwards noise-step reading in an M3 follow-up, one invented quote in an M3 ask answer, and M3 summaries without headline numbers.

Model policy at the time of writing (from the orchestrator's ledger): explain on Flash, summary on M3, and ask plus follow-ups moved to M3 after this panel (the implementation is in track w2api; its merge is not confirmed in the ledger). Confirm against the release head: `[FINAL GATE]`.

## v0.1 against the pre-release baselines

### Better, with numbers

- **Papers that parse: 12 to 14 of 14.** DDPM (was a dead letter after about 17 s) and Mask R-CNN now parse; both also pass through the real worker (S2R R.6).
- **Parser reading order**: repo-gold pooled 0.900 to 0.962, discordant pairs 26 to 9; five of six papers gain macro-F1 (mean 0.3203 to 0.3456). Fresh pages 1 and 2, same four papers: merged paragraphs 45 of 52 to 8 of 52, mistyped body text 13 of 60 to 0 of 60, numeric-only headings 11 to 0, title first 3 of 4 to 4 of 4.
- **Answers no longer fail on a token ceiling.** Baseline: 2 of 5 asks returned 504. A/B: 0 of 38 live runs ended in error (35 complete, 3 partial summaries). Orchestrator live runs on the release head: no failed explain, ask or follow-up in the rows above.
- **First text.** Explain first text p50 2.13 s on Flash at load 2 to 3 (n=9) and 1.82 s in the A/B (n=12), inside the 5 s bar; M3 explain first text was 9.28 s in the A/B and 8.45 s in the S5F baseline. The baseline had no first-text signal at all.
- **Input size.** One M3 ask took 33,150 input tokens at `6ff15ad`; an M3 explain takes 3,349 to 4,262 on the new agent path (different requests, so an order of magnitude, not a ratio).
- **Summary exists and is cheap.** None at the baselines; the first live attempt failed (38,199 tokens, $0.0148); after the digest seed a YOLO summary is 4,837 tokens and $0.00262, and a second request is served from the cache with the run count unchanged.
- **Highlights persist** (none to persisted, painted from stored quads), **canvas exists** (none to minimal), **follow-ups exist**, and the library updates without a reload (interim walk). Final verdicts: `[S9]`.
- **Honest citation check.** Recall of truly supported citations 0.13 to 0.65 on the first labelled set and 0.47 to 0.77 on the holdout, with precision 1.00 before and after (one labeller, small sets, one paper family).
- **Tests.** TS 1,389 to 1,625 (+236, handoff); pytest 1,733 to 2,136 passed (+403, `4a29bc7`); e2e 0 to 5 locally and 11 specs in CI; agent tests 0 to 113 (138 on the S5F branch).
- **CI checks what it did not.** Prettier (25 files failing at the baseline, clean now), `next build`, the corpus tests (about 220 Python tests and 10 web `stamp.spec` tests that never ran in CI), Playwright A to D, and a live-journey job. Proven by planting three failures in one commit (CI run 38699701467): Prettier, Web build and E2E went red for exactly those reasons and the other jobs stayed green. The live job ran once green: 70,061 tokens, $0.0263 estimated, 4 `ai_runs` rows, no key in any log.
- **Mutation checks**: S5F 13 of 13 mutants killed; S2R 15 of 16 parser-rule mutants killed.

### WORSE, with cause

- **ResNet pooled reading order 0.932 to 0.906** (per-page 0.929 to 0.894). Accepted: the paragraph-split rule shrank the scored pool and what remains is annotation defects in the gold; real discordant pairs 2 to 0. The owner still ratifies the merge-rule exception.
- **GPT-3 macro-F1 -0.0013** (0.3429 to 0.3416). Accepted: two extra correct paragraph splits against a gold with 3 paragraph regions.
- **Other per-type drops** from the same rule: bert paragraph F1 0.545 to 0.342, resnet 0.575 to 0.404, a3c 0.417 to 0.357; attention caption 0.667 to 0.500.
- **Explain first text on M3 got slower in the S5F sample**: p50 8.45 s to 20.62 s, p90 14.00 s to 26.87 s, total p50 16.06 s to 25.23 s (n=6 each, loads 6.1 to 8.4 against 4.0 to 6.4). Not attributed: thinking characters doubled (median 1,754 to 3,456) and model throughput fell from 76 to 60 tokens per second, so it may be the datamarked quote or a slower, wordier model on that afternoon; n is too small to separate them. Explain was moved to Flash, which measured 2.13 s p50 (n=9) on the release head; M3 explain on the final code was not re-measured.
- **The Python CI job now takes about 15 minutes** (14 m 44 s on CI run 38702211039, about 9.5 min of that pytest) because the corpus tests now run; at the baseline the whole CI pytest was 39.44 s, with 136 tests skipped. A Linux-only failure of the peak-RSS test (710.5 MB, five times, in the full run but not alone) is handled by running that test in its own process.
- **Datamarking the seed quote costs +12.0% input tokens** (3,919 to 4,391 on a controlled probe, +472 tokens, about $0.00014 per explain). Chosen by the owner for prompt-injection safety.
- **Grounding check leaks more fabricated claims in mixed cases.** 3 of 18 fabricated claims judged supported (was 2 of 18); 5 of 13 fabricated claims sharing a marker with an honest claim keep the citation supported (was 0 of 13, only because the old rule marked almost every citation unsupported). The check is lexical: negation, comparator and role swaps pass.
- **Flash is not shown to hold quality on ask, follow-up and summary.** Judged mean: ask 4.14 against 4.36 (M3), follow-up 3.50 against 4.03; Flash medium summaries had 14 unsupported claims against 3 and flipped facts. Hence explain on Flash only, summary on M3, ask moved to M3.
- **GPT-3 peak RSS** is about 8 MB above base (507 to 511 MB against 499 to 509 MB), 8.8 MB under the 520 MB ratchet.
- **Local gate times are not comparable and not an improvement claim**: pytest 361 s (1,733 tests, load 6 to 7), 1,436 s (handoff, load up to 60), 460 s (2,136 tests, load 2 to 5).
- **The #80 wall-clock test is load-sensitive**: failed at load 15 and at load 60, passes at 518 to 526 ms on a quiet machine. Known, not a regression.

### NOT MEASURED

- A grounding rate from human-written questions and human scoring (Tier C, #62). The judged sample above is not that.
- OCR and scanned PDFs; table-heavy and long-paper question answering; a held-out parser paper (all thresholds were chosen on the 14 papers they are scored on); owner review of the fresh gold (#54).
- Audio (Epic 4 is out of this release).
- A real Flash price (costs are estimates on M3 rates); latency under concurrent users; the final-turn tool-budget guard on a live model (proven offline only); the daily spend cap live (proven offline only).
- Browser performance (page render time, Lighthouse), the 390 px reader, dark and light themes, axe results: `[S9]`.
- Explain latency on the final release head after the model change, and the final ask model's latency: `[FINAL GATE]`.

## Known defects at release

Final list and count: `[S9]`.

Recorded so far in the orchestrator ledger (`PaperTree-evidence/v0.1/orchestrator/RUNS.md`), walk findings and review should-fix items, none rounded away:

- R1 a drag ending in blank space selects the wrong text; R2 the page jumps about 100 px on Highlight; R6 a worker-load failure is blamed on the PDF (all three sent to the fix wave).
- R3 the explain quote keeps PDF hyphenation ("sin- gle") and can cut mid-word; R4 a stray "." on its own line after a chip; R5 the canvas explanation node shows raw `[b1]` markers; R7 the canvas toast dismisses before it can be clicked (under 4 s); R10 explain shows raw `*markdown*` emphasis (UI wave 2).
- R8 Source to Guided opens at the paper top (position lost); R9 Guided shows a figure twice (the whole figure and its sub-image crops) (fix wave 2 or known defect).
- Library and canvas: the unverified-session banner never retries; a failed card repeats; a stale upload row sits above a failed card; Backspace delete has no undo; no size caps on body, label or coordinates; duplicate passage cards; in-card targets under 40 px at 390; phone first-open is cropped; a stale notice persists; the open-source e2e checks the viewport only.
- AI path: the API reports `aborted` rather than `agent_unavailable` when the agent dies mid-answer; the verifier marks some real citations unsupported; follow-up citations supported 1 of 33 in the quality panel; the spend-cap tests cover only the explain path (4 mutants survive); out-of-passage names count as neutral and "Table 9 on page 14" counts as supported; a fabricated claim beside an honest one stays supported; fixtures were edited in place; an orphaned reservation; one of eight summaries stalled under concurrency; an internal `get_section` call returned 422.
- Parser: the duplicate-id salvage lane has no CI test (the real-PDF test skips without the corpus); the caption-start rule is case-sensitive (the fix was measured and rejected because it lowers macro-F1 on all six papers); text lost beside a table is a strict xfail; no held-out parser paper.
- CI: on Linux the agent audit's kernel network-deny assertion expects a macOS error code and skips loudly; corpus URLs other than neural-odes are not version-pinned (a checksum step fails loudly on drift).
- Docs: the README gate table, a false `MINIMAX_API_KEY` troubleshooting claim, the build needing the corpus, the dev server binding all interfaces, and a stale `PAPERTREE_LLM_API_KEY` comment in the web client were opened as README follow-ups (#167).

## Sources

Discovery walk `6ff15ad`: `PaperTree-evidence/01-discovery/journey-baseline.md`, `gates-baseline.md`, `issues-triage.md`. Handoff gate `45fb2db`: `PaperTree-evidence/05-final-gate/summary.txt` and logs, `research/build/reader-release/NEXT-SESSION.md`, `research/architecture-decisions/ADR-002-reader-release.md` section 1. v0.1: `PaperTree-evidence/v0.1/orchestrator/RUNS.md`, `PaperTree-evidence/v0.1/orchestrator/gate-main-4a29bc7/` (`SUMMARY.txt` and logs), `docs/release/v0.1/PLAN.md`, `MODEL-AB.md`, `QUALITY.md`, `research/benchmarks/READER-RELEASE-PARSER.md`, `research/architecture-decisions/ADR-003-model-policy.md`, and the track reports `PaperTree-evidence/v0.1/{s5f-impl,ci-impl,ci-fix,s2r-impl,t0-impl}/REPORT.md`.
