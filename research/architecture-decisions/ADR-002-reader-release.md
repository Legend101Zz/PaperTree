# ADR-002: Reader release architecture

- Status: **Accepted** 2026-09-25 (architecture judge; accepted by the reader-release lead with the §10 defaults, open to owner override on #141). Code base `6ff15ad`. Companion files: `research/build/reader-release/contracts.md` (the shared contracts) and `research/build/reader-release/slice-plan.md` (the work). Tracker: #141.
- Labels: **MEASURED** = the judge re-ran it this session; the scripts and tested SQL are in `judge-evidence/` (the architecture session's local evidence store, not committed; the migration probe is ported to `packages/db/python/tests/test_0005_saved_shapes.py` in S0). **QUOTED** = taken from a named discovery report, the Pi spike or a proposal.

## 1. Context

- **The brief.** A fast research-paper reader with reliable PDF understanding, persistent highlights, grounded AI explanations and summaries, and an intentional canvas. Journeys A–F must be walked in a real foreground browser, with a real worker, real persistence and real MiniMax calls.
- **Binding owner rulings.**
  - AI runs through the **Pi SDK** (`createAgentSession()`, MiniMax-M3, paper tools only), in a small Node service that `services/api` brokers.
  - **Epic 4 (audio) is OUT. Epic 5 (canvas) is IN.**
- **The baseline at `6ff15ad`** (QUOTED, journey-baseline):

  | Journey | State | What fails |
  |---|---|---|
  | A | partial | The card appears only after a reload. DDPM dead-letters on G7. |
  | B | fails | The text layer covers the Highlight button, a highlight paints the whole block, nothing persists, and a mode switch blanks an uploaded PDF. |
  | C | partial | 2 of 5 asks returned 504 at the 4,096-token ceiling. Answers took 10.9–72.6 s. There are no follow-ups and no summary. |
  | D | missing | No canvas exists. |

  The 3,122 existing tests pass uncached (QUOTED, gates-baseline). None of them drives a browser.
- **The Pi SDK works** once the host adds 11 guards (QUOTED, spike-verify "Must fix").

## 2. Options considered

At least 3 measurements from each proposal were re-run.

- **A, focused repair: all re-runs reproduced.** DDPM parses with the crop clip plus R21 re-parenting (25 pages, 463 blocks, valid). Median over-paint is 17.3x on YOLO and 17.6x on ResNet. Cross-parser re-anchoring gives 201 anchors, 0 orphans, 199 verified by text. The demo data holds 1 legacy highlight.

- **B, PDF-first: mostly reproduced.** Stamping covers 60.8 / 57.2 / 63.1 % of text-layer items, citable blocks are found in the pdf.js text for 98.3 / 99.3 %, and `page_count` costs 0.19–0.58 ms at upload. The Guided card counts did not reproduce: the product serialisation gives 187 cards and 4 "OUR SUMMARY", matching the live browser's 159 text cards, where B reported 203 and 5. The defects themselves do reproduce.

- **C, parser swap: partially reproduced.** Repo-gold reading order is 0.586 per page but 0.900 pooled, with 11 of 36 pages having no matched pair. On fresh pages 1–2, YOLO's 23 gold paragraphs land in 9 blocks and ResNet's 14 in 5. No single hybrid variant shows both of C's claims: "0 mistyped" is the untyped hybrid, while macro-F1 0.352 is the typed hybrid, which still mistypes 6 YOLO body paragraphs. pymupdf-layout peaked at 844 MB RSS on YOLO.

| Proposal | User value | Latency | PDF fidelity | Maintainability | Migration cost (10 = cheap) | Data risk (10 = safe) | Total |
|---|---|---|---|---|---|---|---|
| A focused repair | 7 | 8 | 6 | 6 | 7 | 9 | **43** |
| B PDF-first | 6 | 9 | 7 | 8 | 6 | 7 | **43** |
| C parser/IR replace | 6 | 7 | 5 | 5 | 4 | 6 | **33** |

**The tie goes to A**: lower migration and data risk (MEASURED: this ADR's 0005 was applied to backup copies of both saved data roots), it keeps the reading modes the brief names, and it keeps the resolver that produced 0 orphans across a real parser change.

**B's winning idea moves into A without a new Anchor format.** Paint each user object from its stored geometry. MEASURED: when the same text is captured on another parse, its quads move a median 0.00 pt but up to 5.6 pt (p90 1.7–3.0 pt).

## 3. Decision

1. **Keep the v2 core**: FastAPI `services/api` as the only public edge and the source of paper data; one SQLite file with `packages/jobs` feeding the worker; the PyMuPDF worker emitting PaperIR 1.0.0 (schema unchanged); the T0–T6 resolver in `@papertree/anchoring`; the pdf.js reader with Source, Guided and Split.
2. **User objects belong to the paper, and their paint does not depend on the parse.**
   - Migration 0005 keys highlights, anchors, threads and canvas rows to `paper_owners`, never to a generation.
   - Every new anchor stores a `ShapeSelector` (line quads) and a `TextQuoteSelector`.
   - Source mode paints the **stored** quads whenever `anchor.doc.pdfSha256` equals the paper's `source_hash`. Inside one paper that is always true, because `paper_id` is derived from the bytes.
   - The ladder only **links** anchors to blocks: for Guided marks, the Navigator, AI seeds and "open source". A re-parse changes links, never paint.
3. **Every text-layer item can be captured.** Stamped items keep their IR offsets (MEASURED prose coverage 88.7 / 90.3 / 98.2 %). Unstamped items get quads from pdf.js item geometry via `bridge.ts`, plus a quote from the page's own text (MEASURED stamping is 2.1 / 4.9 / 0.6 % for table cells and 0 % for text inside figures). `locateByText`'s first-occurrence guess is removed.
4. **AI runs through `services/agent`**: Node 22 with Pi 0.87.1 and pi-ai 0.87.1 pinned exactly, MiniMax-M3 with the key only in the agent's environment, four read-only paper tools served by `/internal/agent/runs/{run_id}/*` under a run token, and all 11 spike-verify guards in one wrapper. The API brokers the SSE stream, persists threads, runs and citations, and mints citation Anchors with Python `papertree_anchoring` (#124).
5. **Parse quality improves through measured, targeted rules**: G7 crop clip, R21 re-parent, salvage to `partial`, numeric-heading suppression, a bound on abstract spill, column-aware paragraph splitting. They are scored against fresh gold written from page images plus the repo gold, with pooled reading order. A pymupdf-layout `RegionModel` probe runs in a probe venv outside `uv.lock` and is adopted only under the S2 rule with owner approval. The heuristic parser ships by default.
6. **Guided stays, in the paper's register.** It is a deterministic reflow of verbatim paper text, shown with a "Reflowed from the PDF" marker. The ⊙ mark is reserved for model output.
7. **Canvas data is rows**: boards, nodes and edges, with groups stored as nodes. A board is created only by an explicit send. Opening a canvas never writes.
8. **One README, accurate env examples, and CI that runs every gate uncached.** That includes prettier, `next build`, the agent tests, the corpus, and a Playwright A–D job against a faux agent.

## 4. Active runtime path per journey (target)

| Journey | Path |
|---|---|
| A | `POST /papers` (XHR, with progress) writes `uploads/<id>.pdf` and a `paper_owners` row with `page_count`, then enqueues `parse(gen N)` and returns 202. The card polls `GET /papers`. The worker runs three job steps: `parse`, `persist`, `promote`. The reader fetches `/file` (gated on ownership) into pdf.js, and `/ir` (gzip, signed asset URLs). |
| B | The text layer feeds `useSelectionCapture` (IR offsets or item geometry), which calls `captureAnchor`. `POST /papers/{id}/highlights` writes in one transaction. The overlay paints the stored quads. On reload, `GET` returns the highlights; the T0 cache or the ladder links them to the generation, and `PUT …/resolutions` records the result. After a re-parse, links re-resolve and paint does not change. An unresolvable anchor appears in `UnanchoredTray` with its reason. |
| C | Toolbar Ask sends `POST /papers/{id}/threads` (SSE). The API writes `ai_threads`, `ai_messages` and `ai_runs`, then calls the agent's `POST /v1/runs` (SSE). Pi calls MiniMax and `GET /internal/agent/runs/{run}/…`. On `done`, the API checks citations against the handles seen in the run, mints Anchors, flags them with `verify_grounding`, and persists. A chip click resolves the anchor, scrolls to it and flashes it. Summary: `POST /papers/{id}/summary` (SSE) writes `derivations(kind='paper_summary')`. |
| D | Send to canvas calls `POST /papers/{id}/board/nodes`; the board is created on the first send. The canvas renders with `@xyflow/react`. Drag, edit and group each `PATCH` one row. Connect calls `POST …/edges`. "Open source" goes to `/paper/{id}/read?focus=<node>`, which resolves the anchor and flashes it. |
| E | `X-Request-Id` on every response. JSON logs carry `request_id`, `job_id` and `run_id`. `jobs` and `job_steps` record progress. `ai_runs` records `code_path`, provider, model, `agent_sdk`, tokens and cost. Both services expose `/healthz`. |
| F | Uncached `turbo lint/typecheck/test --force`, pytest with the corpus, ruff, mypy, prettier, `next build`, the agent's `node --test`, and Playwright A–D against the faux agent. A smoke test with the live key runs only when the key is present. |

## 5. Removed, and when

Every item was reference-checked with `grep -a`; the full table is in `slice-plan.md` §R.

| Slice | Removed |
|---|---|
| S0 | `lib/api.ts`, `store/readerStore.ts`, `lib/anchorStore.ts`, `types/index.ts` (`User` moves). The TS db twin. `vlm.py`. |
| S3, S4 | The dead library bridge, the audio claims, the Notes and Chapters tabs, `fixtures.loadPaper`, the `NotParsedYet` copy. |
| S5 | `ask.py`. In agent-tools: `turn`, `provider`, `runtime`, `registry`, `results`, `tools`. In prompts: `caps`, `system`, `advisory`. |
| S6 | `components/inspector/*`. `AnswerView` and `CitationChip` move to the new explain panel. |
| S8 | The memory write side (the security tests are re-seeded with raw INSERTs). Docker files. Both `.env.example` files and `README.md` are rewritten. The dead utils and dependencies, and the v1 canvas CSS. |

## 6. Migrating saved papers and highlights

1. **Back up first.** At API start, while 0005 is still pending, write `papertree.sqlite.pre-0005.bak` with the SQLite backup API. The migration is forward-only, so this backup is the rollback.
2. **Apply 0005 in one transaction.** MEASURED on backup copies of both data roots:

   | Data root | Time | Rows |
   |---|---|---|
   | demo | 13.4 ms | all counts identical |
   | baseline | 10.7 ms | the dead-lettered DDPM gains a `paper_owners` row, so it appears as Failed with Retry |

   On both: `foreign_key_check` is empty and `integrity_check` is ok, a re-run is a no-op, and the owner-FK audit finds 0 violations in 22 FKs.
3. **Convert the legacy highlight in SQL** into a full Anchor v1. Its Block, Page and Shape selectors are built from the **block's** geometry, because the row itself holds a placeholder polygon `[[0,0],[1,0],[1,1],[0,1]]` (MEASURED). On first open, the reader adds a quote through `PUT …/resolutions {upgraded_anchor}`.
4. **Nothing is re-parsed automatically.** In a simulated re-parse (gen 2 promoted, gen 1 deleted), the highlight survived and only its cache row died (MEASURED).
5. **Rewrite `asset://` URIs when served**, and clean up staging JSON after promotion.

## 7. Scope

- **IN**: journeys A–F; library states (queued, reading, ready, partial, failed with Retry) plus Cancel and Delete; Source, Guided and Split; highlights with colour and note; explain, ask, follow-ups and summary with usage and cost shown; the minimal canvas (#6 F5.1/F5.3/F5.7/F5.8, groups, 7 labelled edge kinds); parser fixes with a measured report; desktop and 390 px; cleanup and one README.

- **OUT**: Epic 4 audio (#5), deferred, with every audio claim removed from the UI; OCR and equation LaTeX; cross-paper boards (the schema allows them later); canvas minimap, frames, 50-step undo and 500-node performance; a grounding **rate** (#62 needs human-written questions; grounding is flagged per answer only).

## 8. Conflicts with existing docs (current truth wins; docs are corrected in S8, specs by the slice that owns them)

| Doc | Says | Truth, and the change |
|---|---|---|
| AGENTS.md header | "CURRENT PHASE: read #78"; Epics 4 and 5 blocked | The reader-release tracker replaces #78. Canvas is in, audio is out. |
| AGENTS.md §4 | "anchoring is TS-only, Python returns a SourceRegion"; "resnet 974 blocks / 25 relations" | Python `papertree_anchoring` exists and is wired in S5. ResNet has 955 blocks and 176 relations (QUOTED, triage #120). New hazard: paint from stored quads, never from re-derived geometry. |
| #139 / #7 | #5 and #6 out of scope, Epic 4 next; gate item 2 is ticked | The owner's brief overrides: #6 is in, #5 is deferred. Gate item 2 stays PARTIAL until the S4 walk. |
| EPIC-03 F3.4 + EPIC-03-RESULT §6.1 | "Pydantic AI over the registry", then amended to `ChatCompletionsTurn`, runtime swappable in under 100 lines | The Pi ruling supersedes both. The Python loop, provider and `test_runtime_swappable` go. F3.4's "no filesystem, no shell, egress only to the model" is kept, and tested by the M5/M6 mutants. |
| EPIC-02 F2.5 / `reader/provenance.spec` | Guided renders in the ⊙ derived register | The brief: "UI distinguishes paper content from AI interpretation." Guided text is verbatim paper, so it gets the paper register plus a "Reflowed" marker; the spec is rewritten. |
| ADR-001 §Versioning | promote only if at least 99 % of anchors migrate | Paint no longer depends on the parse, so promotion is unconditional. The re-anchor rate is measured per parser change (S2/S4 probes) and reported, not enforced. |
| EPIC-05 Owns | `apps/api/.../canvas/**` | The paths S7 owns in `slice-plan.md`. |
| EPIC-01-RESULT / DOCLING.md | zero-ML by default; heavy stacks never in `uv.lock` | Kept. The layout-model probe stays outside the lock. |
| README, `.env.example`, `docker-compose.yml` | v1: Mongo, OpenRouter, npm, `LLM_API_KEY`, `NEXT_PUBLIC_API_URL` | Rewritten or removed in S8. The only variables are those in `contracts.md` §7. |

## 9. Consequences

- **Gains.** A highlight paints from the same stored PDF-space quads across reload, zoom, mode change and re-parse. Tables and figure labels can be highlighted. There is one MiniMax client instead of two, and about 6–7k dead lines go. A better parser can be added later as a new generation without losing highlights: 201 anchors survived a real parser change with 0 orphans (MEASURED).

- **Costs.** Three runtimes remain (Python, Node, browser), and the PaperIR machinery and both anchoring bindings stay. Parse quality stays heuristic: pooled reading order of 0.900 hides merged and mistyped units, so the S2 numbers decide what ships. The Pi SDK is pre-1.0; it is pinned exactly, and a faux-provider suite guards every bump.

## 10. Owner questions (the default applies if unanswered)

1. **Guided register.** Default: the paper register with a "Reflowed" marker, and ⊙ for AI only. This contradicts EPIC-02 F2.5.
2. **Layout model** (an AGPL/Artifex ONNX dependency, about 0.8 GB peak RSS). Default: not in this release, unless the S2 rule passes and you approve a new memory bar.
3. **Deleting the memory write side and the TS db twin** (0 product importers each). Default: delete them, the twin in S0 and the write side in S8.
4. **Spend cap.** Default: `PAPERTREE_DAILY_BUDGET_USD=1.00` per user.
