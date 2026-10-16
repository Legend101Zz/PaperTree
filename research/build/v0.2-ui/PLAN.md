# v0.2 UI build — PLAN

The slices, in order, each with its issue (a child of #175 / #182), acceptance tests, owned paths and size. **One
issue = one PR, about 600 changed lines at most** (generated files such as the lockfile do not count); anything
bigger is split. Every PR targets `release/v0.2`.

Inputs: `GAP-AUDIT.md` (what exists), `ADR-004` (what we build with), DESIGN.md (the target). Owner defaults used
(each marked "owner may change" in its PR): ask → answer → trace option 1; Reading now = the strip above the shelf;
"2 need a look" opens the Table filtered; diagrams = the engraved plate; recorded fixtures for tests with one live
smoke per AI slice (topics, explain/trace, diagrams), total ≤ $1.00 (estimate).

## Rules every slice follows

- **Product truths are acceptance tests in every slice** (`data-voice="ai|paper|you"` on every voice; every AI
  claim carries a marker that scrolls to and flashes its passage; every usage line says "estimate"; no
  "verified", "fact-checked" or "accurate" anywhere (a test scans the built UI strings); the seven relation kinds
  differ by colour AND a second cue; no generated art; the three reading modes, five highlight colours and the
  unplaced-highlight tray keep working; the v0.1 e2e suite stays green).
- Feature folders `apps/web/src/features/<feature>/` (components, hooks, model, api, index.ts, README.md); shared
  primitives and tokens in `packages/ui`; pure logic in `model/` with vitest; components ≤ ~250 lines, functions
  ≤ ~60; TSDoc on every export, Google docstrings on every public Python symbol, a header comment on every new file.
- Backend: forward-only migrations in `infrastructure/migrations/`, numbers **assigned below** so slices never
  collide; a CHECK change is a table rebuild (the 0005 pattern) and its version joins `BACKUP_BEFORE_VERSIONS`;
  user-owned rows store an `Anchor`, never a bare `block_id`; tests run against a real parse of a corpus paper;
  corpus-gated tests skip loudly.
- Visual check against `compare/F-final/<frame>.png` at the frame size (1440 × 900, 1180 × 820, 390 × 844; light and
  dark) into `research/build/v0.2-ui/shots/`; a Sonnet agent lists the differences; fix or record each.
- axe 0 serious/critical at 1440 and 390, light and dark; every action by keyboard; `prefers-reduced-motion`.
- Full uncached gate (lint incl. `next lint`, typecheck, test, prettier, ruff, ruff format, mypy, docstrings,
  pytest, web build) and e2e before the PR; a review subagent in its own worktree; merge without
  `--delete-branch` on stacked bases; `git merge-base --is-ancestor` after; STATE.md, the issue and RESULT.md
  updated.

## Migration numbers

| # | Slice | Contents |
| --- | --- | --- |
| 0006 | S2a | `reading_state`; `users.display_name` |
| 0007 | S2b | `topics`, `paper_topics` |
| 0008 | S3 | `paper_plate` (an Anchor on the chosen figure) |
| 0009 | S5a | `notebook_pages`, `notebook_items`, `notebook_strokes` |
| 0010 | S6a | rebuild `canvas_nodes` (kinds `question`, `notebook`, `diagram`; `source_page_id`, `source_diagram_id`); `canvas_edges.from_port`/`to_port` |
| 0011 | S7a | rebuild `ai_threads`/`ai_runs` (kind `diagram`, `topic`); `ai_diagram_parts`; `ai_messages.diagram_json` |

If a slice ahead in this table has not merged when a later one is ready, the later one waits or takes the next
free number at merge time (an applied migration file is immutable, so numbers are fixed only once merged).

## The slices

Sizes: S ≈ ≤ 300 lines, M ≈ 300–600. "Frames" are the design frames the slice must read as.

### S0 · Tooling — #184 (PR #186)

Lint rules (jsx-a11y, import order, no-explicit-any warn, jsdoc error in `src/features/**`), `packages/ui` doc lint,
docstrings on new Python modules, lefthook pre-commit, CONTRIBUTING.md. Owned: lint configs, `tools/`,
`lefthook.yml`, `CONTRIBUTING.md`, `ci.yml` (docstring step). Size M (config).

**S0b · Prettier covers `apps/web` — #187.** Found in S0's review: `.prettierignore` ignores `apps/`. One mechanical
format pass of `apps/web` (61 files at `79f637d`), nothing else, merged right after S0 so feature branches start
formatted.

### S1 · Foundations

| Issue | Slice | What | Frames | Owns | Size |
| --- | --- | --- | --- | --- | --- |
| S1a #188 | tokens, schemes, fonts, theme switch | Ex Libris tokens for daylight and lamp-lit under the `--pt-*` names (v0.1 names aliased); contrast test of the DESIGN.md pairs in both schemes; materials (laid, cloth, gilt, linen); the five faces via `next/font/local` + `@fontsource`; `data-pt-theme` switch (System / Daylight / Lamp-lit) with a no-flash script; Tailwind `dark:` on the same attribute | 10, 00 | `packages/ui/src/styles.css` (token section), `apps/web/src/app/{layout,fonts,globals}`, `features/settings/` | M |
| S1b #189 | interface components | Button (primary oxblood with gilt fillet, secondary, outline primary, danger; default/hover/pressed/focus/disabled), segmented switch, toolbar button, input with "Not sent; your text is kept", toast with Undo, sheet, sprout mark, label holder, reading-now row | 10 | `packages/ui/src/` (new component files + their CSS section) | M |
| S1c #190 | voices and citations | `data-voice` on `PaperText`/`ReflowedText`/`AiText` + a new `YouText`; numbered marker; page tab (cited, dashed "not verified"); call slip (M stamp); AI slip (AI tab + model line); trace row and trace list ("Show in paper", lit state, hung quotation mark); coverage readout; the banned-words scan of built UI strings | 10, 00, 04 | `packages/ui/src/` | M |
| S1d #191 | design-system page | A developer route rendering every token and component in both schemes (frame 10's board), axe-checked; the visual baseline later slices compare against | 10, 00 | `apps/web/src/app/design-system/`, `features/design-system/` | S |

### S2 · Library

| Issue | Slice | What | Frames | Owns | Size |
| --- | --- | --- | --- | --- | --- |
| S2a #192 | reading state + library facts (backend) | migration 0006; `PUT /papers/{id}/reading-state`; `LibraryPaper` gains `reading`, `year` (from the arXiv id), `arxiv_id`, `arxiv_category` (from the stamp, no re-parse), `thread_count`, `has_summary`; `users.display_name` + `PATCH /auth/me`; the progress rule as one tested function; the reader writes reading state (debounced) | 01, 01d, 02 | `infrastructure/migrations/0006_*`, `papertree_db/library.py`, `routers/papers.py`, `routers/auth.py`, `schemas.py` (library + me), reader position writer | M |
| S2b #193 | topics (backend + Flash suggestion) | migration 0007; `GET/POST/PATCH/DELETE /topics`; `GET /papers/{id}/topic-suggestion`, `PUT/DELETE /papers/{id}/topic`; deterministic suggestion from the arXiv category and the person's topics; a short `topic` run (Flash) only when that finds nothing; faux scenario; **one live smoke** | 01, 02, 03 | `0007_*`, `papertree_db/topics.py`, `routers/topics.py`, agent `topic` kind + prompt | M |
| S2c #194 | library links (backend) | `GET /library/links`: citation matches by arXiv id or normalised title, each labelled with how it matched; board links later | 01e | `routers/library.py`, `papertree_db/library.py` (links) | S |
| S2d #195 | the shelf | `features/library/`: header (sprout, central search with "/", Add papers, Aa with the theme switch, account), "Your library" + stats + "N need a look", view tabs, Arrange by; shelf layout model (rows per topic, spine width from pages capped at 48, states: ribbon, kraft, torn label); walnut plank, brass label holders; search filters in place (dim, never reorder, "2 of 24 match"); keyboard along the shelf (←/→, Enter, Esc, /); catalogue card in the band above; drop PDFs anywhere; upload progress surface | 01, 00 | `apps/web/src/features/library/`, `app/dashboard/` | M (may split d1/d2) |
| S2e #196 | reading now, empty, few, many | Reading-now strip with Continue; empty library (01b); face-out covers at ≤ 12 papers (01c); per-topic rows with "+n more" past ~40 (01f) | 01, 01b, 01c, 01f | `features/library/` | M |
| S2f #197 | Table view + "need a look" | ruled catalogue (Title, Authors, Year, Topic with source, Pages, State, Highlights, Last opened), sort, filter, row actions; "2 need a look" opens it filtered | 01d | `features/library/` (table) | M |
| S2g #198 | Topics and Map views | topic cards with spine skyline and banner (Figure 1 crop, cloth pattern or ornament); the reading-room plan with topic islands and only real links | 03, 01e | `features/library/` (topics, map) | M |
| S2h #199 | phone library | stacked library at 390: search, stats, Reading now, books lying flat under holders | 08a, 09a | `features/library/` (phone) | S |

### S3 · The opened book — #200

| Issue | Slice | What | Frames | Owns | Size |
| --- | --- | --- | --- | --- | --- |
| S3 #200 | pull out and open | Enter lifts the spine and turns the book out (02a), Enter again opens the spread (02): bookplate ("From the library of …", from `display_name`; asks once when unset), right page with topic + source line, year · arXiv · pages · figures, title, byline, the abstract with its tab, reading state, counts, **Read**, Summary, "Put it back (Esc)"; migration 0008 + `GET /papers/{id}/figures` + `PUT/DELETE /papers/{id}/plate` for "Use Figure 1 as the plate"; CSS 3D + WAAPI motion with the reduced path | 02a, 02, 11 | `features/book/`, `0008_*`, figures/plate routes | M (may split backend) |

### S4 · Reader and explain (ask → answer → trace)

| Issue | Slice | What | Frames | Owns | Size |
| --- | --- | --- | --- | --- | --- |
| S4a #201 | exchanges (backend) | thread list gains `ask` and a stable `created_at` order; citations gain a derived `locator` (page, ¶ among body paragraphs, section) with the front-matter rule from the audit; messages gain `coverage` (passages, citations, paragraphs, uncited); golden fixture = the stored Attention thread (b1/b6/b7/b8 → 1–4, 11 citations, 1 uncited) | 04, 13 | `evidence.py`, `routers/threads.py`, `papertree_db/ai.py` (list order), `schemas.py` (thread/citation/message) | M |
| S4b #202 | the exchange in the explain panel | `features/explain/`: `Exchange` = `CallSlip` + `AiSlip` + `TraceList` under `CoverageReadout` (one swappable layout component); passage numbering as a pure function; loads the stored threads; "Thread 1 of 2" menu named by asks; marker ↔ trace light each other; Show in paper scrolls and flashes (180/900/600, faint outline stays); margin tab "from marker 2 in the answer" beside the flashed passage; "no citation · the AI's own reading" | 04, 13, 12 steps 6–8 | `features/explain/`, the reader's flash | M (may split b1/b2) |
| S4c #203 | reader chrome | header (Library, Contents, title, "p. 2 of 15", Source · Guided · Split, zoom, Board, Explain), reader desk, the selection toolbar in the margin or docked (Explain · Ask · Highlight with five washes · Send to board · Explain with a diagram), Contents outline headings (#177), highlight card by mouse (#176) | 04, 09b | `features/reader/` (chrome), `components/reader/*` restyle | M |
| S4d #204 | streaming, stop, budget, summary | 04b streaming status and Stop; 04c "Stopped. The part that arrived is kept." + Retry (and the no-text variant), the budget refusal; 04d summary as an exchange with "not verified" tabs; highlight delete with Undo (#177) | 04b, 04c, 04d | `features/explain/` (states, summary) | M |
| S4e #205 | phone and lamp-lit reader | 08b bottom sheet over a peek of the page (call slip, answer with 44 px markers, Read the whole answer, trace rows as 44 px buttons, pinned footer); 09b lamp-lit reader with the dimmed PDF page; **one live explain smoke** | 08b, 09b | `features/explain/` (phone), reader dark page | M |

### S5 · The Dive-in notebook

| Issue | Slice | What | Frames | Owns | Size |
| --- | --- | --- | --- | --- | --- |
| S5a #206 | notebook (backend) | migration 0009; pages, items, strokes API; Dive in seeds a page from an exchange (call slip, AI slip, one quote card per distinct citation Anchor); counts; search over typed text, quotes and the AI slip; tests on a real parse | 05 | `0009_*`, `papertree_db/notebook.py`, `routers/notebooks.py` | M |
| S5b #207 | notebook model | page units and transform, stroke encoding (varint deltas + pressure), stroke → outline (perfect-freehand), lasso selection and stroke-eraser hit-testing, the notebook undo stack: pure, vitest, benchmarks | 05 | `features/notebook/model/` | M |
| S5c #208 | the page | `features/notebook/`: bound dot-grid page, the exchange block (call slip, AI slip, trace as quote cards), typed text, stickies, shapes, the five templates, the side panel (Paper, On this page, On the board), Back to the paper / Send page to board / Open board | 05 | `features/notebook/components/`, `app/paper/[id]/notebook/` | M |
| S5d #209 | ink and lasso | pen, highlighter, stroke eraser, lasso with its menu (Ask about this, Make sticky, Send to board, Copy, Delete), nibs EF/F/M, colours, undo/redo; pointer events with pen mode; ink latency measured | 05, 05b | `features/notebook/` (ink) | M |
| S5e #210 | Dive in, tablet, phone | "Dive in" from an exchange with the motion (cards lift 120 → page slides 360; reduced: 120 ms), the 1180 tablet layout with the pen, the 390 stack (view-only ink, pen opt-in, what the phone doesn't allow) | 05b, 08c, 11 | `features/notebook/` (layouts), explain → notebook | M |

### S6 · The board

| Issue | Slice | What | Frames | Owns | Size |
| --- | --- | --- | --- | --- | --- |
| S6a #211 | board (backend) | migration 0010 (rebuild): node kinds `question`, `notebook`, `diagram` (+ source ids), edge ports with a compatibility table (422 on a wrong pin); notebook-page card counts on read | 06 | `0010_*`, `papertree_db/canvas.py`, `routers/boards.py` | M |
| S6b #212 | cards, pins and threads | `features/board/`: index cards (passage, note, question, notebook page, diagram) and AI-slip cards; brass port pins (evidence in, question in, claim out, answer out) with `isValidConnection`; the seven threads (colour + stitch/glyph + paper tag); the legend; "Board" naming | 06, 00 | `features/board/` (nodes, edges) | M |
| S6c #213 | Link as | the picker at the midpoint (4 + 3 grid, keys 1–7, header naming both ends, Esc = plain link) and a keyboard way to start and finish a link | 06, 09c, 11 | `features/board/` (picker, keyboard) | M |
| S6d #214 | frames, minimap, toolbar, empty | frames as dashed outlines with paper tags (from groups), the minimap, the toolbar (Select, Add note, Add frame, Thread L, Fit all, zoom), the empty board (06b), phone first-open readable | 06, 06b | `features/board/` | M |
| S6e #215 | undo and scale | a command-stack undo/redo across moves, links, edits and deletes; 500 nodes (memoised cards, `onlyRenderVisibleElements`, simplified cards at low zoom) measured with the load average; lamp-lit board | 06, 09c | `features/board/` (history, perf) | M |

### S7 · AI diagrams

| Issue | Slice | What | Frames | Owns | Size |
| --- | --- | --- | --- | --- | --- |
| S7a #216 | diagram runs (backend) | migration 0011 (rebuild); agent `diagram` kind, `diagram-v1` prompt in `services/agent/src/prompts.ts` (not `packages/prompts`, which is Python helpers only), NDJSON lines validated with zod, `part`/`plate` SSE events, faux scenarios; the API resolves each quote to an Anchor (cited / not verified / inferred), stores parts, reserves budget; Redraw | 07a–c | `0011_*`, `services/agent/src/*`, `agent_client.py`, `routers/threads.py`, `papertree_db/ai.py` | M (may split agent/API) |
| S7b #217 | the plate | `features/diagram/`: slot-grid layout (pure, tested), the engraved SVG plate with pattern hatching, lettered parts and the key with markers and tabs, streaming placement with Stop, tapping a part flashes its passage, inferred parts dashed, "6 parts · 6 cited", Send to board / Add to notebook / Redraw, the usage line; the 07d offer card; **one live diagram smoke** | 07a–d | `features/diagram/` | M |

### S8 · Everywhere

| Issue | Slice | What | Frames | Owns | Size |
| --- | --- | --- | --- | --- | --- |
| S8 #218 | dark, phone, motion, a11y, the whole flow | the 14-step prototype flow as one Playwright e2e at 1440 and 390, light and dark, with axe 0 serious/critical; reduced-motion pass of every moment; the v0.1 e2e suite green; perf numbers (400 spines, 400 rows, 500 nodes, ink latency) with load averages; RESULT.md per frame | 08a–c, 09a–c, 11, 12 | `e2e/v02/`, fixes across features | M |

## Order and parallelism

1. S0 → S1a → (S1b ∥ S1c) → S1d. Backend slices only need S0: S2a, S4a and S5a can start beside S1.
2. Library: S2a → S2b → S2c (backend, in migration order) ∥ S2d → S2e → S2f → S2g → S2h (UI, after S1).
3. S3 after S2d (the shelf it pulls from) and S2a (display name).
4. Reader: S4a ∥ S4c; S4b after S1c and S4a; S4d after S4b; S4e last.
5. Notebook: S5a ∥ S5b; S5c after S1c and S5b; S5d after S5c; S5e after S4b.
6. Board: S6a after S5a (migration order); S6b → S6c → S6d → S6e.
7. Diagrams: S7a after S6a; S7b after S7a and S4b.
8. S8 last; the e2e for each slice's own flow lands with the slice.

At most three implementer agents at once, each in its own worktree and branch off `release/v0.2`, each with a
private scratch folder; e2e never runs in the worktree that serves the dev stack (it shares `apps/web/.next`).
