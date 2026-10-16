# GAP-A3: Dive-in notebook, board, design system, motion, phone notebook, lamp-lit board

Checked 2026-10-16 against commit 79f637d (worktree `v02-ui`), the running dev stack (web :18901, API :18902, agent FAUX) and the code. Paths are relative to `/Volumes/Mrigesh SSD/PaperTree-worktrees/v02-ui` unless absolute. Screenshots of the current app: `shots/`. Status words: exists / partial / missing / wrong (wrong = present but contradicts the design or a product truth).

Method notes. I read the frame PNGs, the ADR-004 §2.7/2.8, the migration `0005_reader_release.sql`, `routers/boards.py`, `schemas.py`, `apps/web/src/components/canvas/*`, `packages/ui/src/*`. The live API's `/openapi.json` lists every route (no notebook, ink, page or template route exists). I registered `audit-a3@example.test`, uploaded the corpus `attention-is-all-you-need.pdf` (parsed, `processing: ready`), POSTed 500 note nodes + 167 edges and measured the board. Demo data was only read (plus opening a Link-as dialog and cancelling it).

Environment surprise: part-way through, the web server on :18901 began calling the API at `http://127.0.0.1:18905` (connection refused) instead of :18902. Earlier shots worked. I did not touch it; my later scripts rewrite 18905 to 18902 with a Playwright route. Siblings may hit the same "Your canvas didn't load" state. See Risks.

---

## 1. Frame 05-notebook-1440 (the Dive-in notebook)

Overall: **nothing of the notebook exists.** `grep -ril "dive in|dive-in|notebook"` over `apps/web/src`, `services`, `packages`, `infrastructure` returns nothing. `apps/web/src/app/paper/[id]/` has only `read/` and `canvas/`. `GET /papers/{id}/notebook`, `/notebooks`, `/ink` all return 404. `perfect-freehand` is not in `apps/web/package.json`.

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 05 | "Dive in" entry from an explanation (button, opens the page) | missing | no string "Dive in" anywhere in src; explain panel only has Send to canvas (`apps/web/src/components/explain/index.tsx:188`) | none for the button; needs notebook create (below) | #208, #206, #207, #209 |
| 05 | Notebook route `/paper/<id>/notebook/<page>` | missing | `find apps/web/src/app/paper` shows read + canvas only | none (web route) | #208, #206, #207, #209 |
| 05 | Page starts from its exchange: call slip, AI slip, trace as numbered quote cards | missing | the data exists (threads, messages, citations: `GET /papers/{id}/threads/{tid}`) but no page seeds from it | `POST` notebook page seeded from `thread_id`+`message_id`; trace = anchors copied from the answer's citations | #208, #206, #207, #209 |
| 05 | Typed text blocks (Courier Prime), stickies, quote cards, shapes | missing | no component | page-item store (below) | #208, #206, #207, #209 |
| 05 | Ink layer: pen, highlighter, stroke eraser (raw points, `perfect-freehand` outlines) | missing | dep absent; ADR-004 §2.7 decided it, not built | stroke store, sync, size cap | #208, #206, #207, #209 |
| 05 | Templates: blank, dot grid, lined, Cornell, derivation grid | missing | none | `template` column on the page; no logic | #208, #206, #207, #209 |
| 05 | Lasso + selection menu (Ask about this, Make sticky, Send to board, Copy, Delete) | missing | none. "Ask about this" would call the existing ask path with a lassoed region (typed text only; ink is not readable by the model) | optional: `POST /papers/{id}/threads` already takes a prompt; needs a way to pass notebook-selected text as context | #208, #206, #207, #209 |
| 05 | Tool bar: pen, highlighter, eraser, lasso, shapes, text, sticky, crop, nib EF/F/M, 6 colours, undo/redo | missing | none | none (client); undo is local, strokes persisted on end | #208, #206, #207, #209 |
| 05 | "Paper" panel (template picker, "in use") | missing | none | none | #208, #206, #207, #209 |
| 05 | "On this page" counts (question, citations, passages, typed notes, stickies, ink) | missing | none. The count semantics ("Ink: yours" with no number; "search finds typed text, passages and the AI's answer, not handwriting") imply a search index over typed items | page search: index typed text + quote anchors; no OCR | #208, #206, #207, #209 |
| 05 | "On the board" card (miniature of the page, "4 quotes · 1 sticky", "Open it there") | missing | none | needs a `notebook` node kind on the board | #208, #206, #207, #209 |
| 05 | Page title "Dive in: the Transformer's central proposal" + "From your question on p. 1 ¶1 · 15 Oct" link | missing | none | `title`, `source_thread_id`, `source_message_id`, `source_anchor_json` on the page row | #208, #206, #207, #209 |
| 05 | Page storage keyed to the paper with Anchors, never bare `block_id` | missing | no table. Existing rule: owned rows keyed to paper_owners, anchor_json full record (`0005_reader_release.sql:306-360`, highlights at `:52-75`) | see §8 | #208, #206, #207, #209 |
| 05 | "Back to the paper" | partial | canvas has "Back to paper" (`CanvasView.tsx:122`); no page-aware return to the originating explanation | none | #208, #206, #207, #209 |
| 05 | "Send page to board" | missing | board has no such node kind (`canvas_nodes.kind` CHECK, `0005:310`) | `kind='notebook'` node, `source_page_id` | #208, #206, #207, #209 |
| 05 | "Open board" | partial | canvas route exists and an "Open canvas" link appears in the send toast (`canvas/toast.tsx`); there is no button in a notebook, which does not exist | none | #208, #206, #207, #209 |
| 05 | Fold marker "fold · 900" on the page edge | missing | design-only annotation (page bottom at 900 px) | none | #208, #206, #207, #209 |

## 2. Frame 05b-notebook-tablet-1180 (1180×820, with the pen)

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 05b | Left tool rail (vertical), page full-bleed | missing | none | none | #210 |
| 05b | Pen input: Pointer Events, pressure, coalesced events, palm rejection | missing | no pointer recorder in repo; ADR-004 §5 flags real-iPad latency as unproven | none; needs a device pass | #210 |
| 05b | Header: Back to the paper, title, Send page to board, Open board | missing | as above | none | #210 |
| 05b | The tablet width of today's canvas (what exists at 1180) | exists (old look) | `shots/05b-tablet-board-current.png`: toolbar of text buttons, React Flow controls, no rail | none | #210 |

## 3. Frame 08c-phone-notebook-390

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 08c | Stack view: call slip, AI slip (collapsed, "Read the whole answer"), "Stands on 4 passages" as full-width trace rows with "cited 5×" | missing | none | citation counts per passage ("cited 5×") need counting `[n]` markers per anchor in the answer; the answer's citations are already stored | #210 |
| 08c | "Your ink · view only" strip (strokes shown, not editable) | missing | none | stroke read path | #210 |
| 08c | Typed note editable on phone (Courier Prime, caret) | missing | none | same text-block store | #210 |
| 08c | Bottom bar: Text, Sticky, Highlight, "Pen: off" opt-in; "Lasso, shapes and templates: on a tablet or computer" | missing | none | none | #210 |
| 08c | Phone allows: typed text, sticky, highlight; does not allow lasso, shapes, templates, pen unless switched on | missing | no rules coded | none | #210 |
| 08c | Phone board (what exists today at 390) | wrong vs design | `shots/08c-phone-board-current.png`: the 7-button toolbar wraps to two rows and pushes the title "Canvas" to a third line; React Flow +/-/fit control stack bottom-left; nodes cut off at the right | none | #210 |

---

## 4. Frame 06-board-1440 (the board), 06b-board-empty-1440

Screens of the current app: `shots/06-board-current.png` (demo Attention board, 3 cards, 1 link), `shots/06b-board-empty-current.png` (DDPM, no board), `shots/06-link-as-picker-current.png`, `shots/06-board-500-current.png`.

Facts from the code. Board = one row per paper (`canvas_boards UNIQUE (owner_id, paper_id)`, `0005:313`; `paper_id` is nullable "cross-paper later"). Node kinds CHECK `excerpt, explanation, note, group` (`0005:310`). Edge kinds CHECK the seven in the design (`0005:343`). Edge rows carry no port, no created paper tag. React Flow components: `<Background>` + `<Controls>` only (`CanvasView.tsx:313`); no `MiniMap`, no `onlyRenderVisibleElements`.

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 06 | Header: "Board <paper title italic> · 11 cards · 7 threads · 2 frames" | partial | header says "Canvas" only (`CanvasView.tsx:124`, shot); no paper title, no counts | none (counts are client-side) | #211–#215 |
| 06 | Toolbar: Select, Add note, Add frame, Thread (L), Fit all, zoom % with − + | partial | has Add note, Select area, Group, Ungroup, Link, Delete, Fit all (`CanvasView.tsx:158-213`); no Thread tool, no `L` key, no zoom % readout, zoom is the RF control stack bottom-left | none | #211–#215 |
| 06 | "Add frame" (dashed outline frame, paper tag) | partial | "Group" needs 2+ cards selected and wraps them (`ctl.groupNodes`); frame node is a dashed box with an editable name (`nodes.tsx` GroupNode) but no empty "Add frame" and no paper tag | none for the button; paper tag: needs `paper_id` on nodes (cross-paper) | #211–#215 |
| 06 | Node kind: passage (excerpt) with `p. 1 ¶1` tab, quote, Open source | partial | `ExcerptNode`: header "Passage", Open source link, no page/¶ tab, no hanging quote marks, generic card (shot) | none (the tab is derivable from `source_anchor`) | #211–#215 |
| 06 | Node kind: AI explanation with call slip + "AI" tab + citations + "4 passages · 11 citations" footer + tokens/cost line | partial | `ExplanationNode`: AiText with `p. 1` chips; no call slip (the question), no footer, no usage line. Body is a **copy of text** (`body` ≤ 20k chars) + `source_message_id` | usage numbers for the footer: `ai_runs` has them; node needs the question text (title today = first words of the answer) | #211–#215 |
| 06 | Node kind: note (typed, Courier) | exists | `NoteNode` (`nodes.tsx`), edit on double-click or Edit button; UI font not Courier | none | #211–#215 |
| 06 | Node kind: **question** (call slip alone, "QUESTION" tag) | missing | CHECK has no `question` | add kind `question` (or derive from a thread) | #211–#215 |
| 06 | Node kind: **notebook page** card (miniature, "4 quotes · 1 sticky", Open page) | missing | no kind, no notebook | kind `notebook` + `source_page_id`, thumbnail or counts | #211–#215 |
| 06 | Node kind: **diagram** (engraved plate, "6 parts · 6 cited") | missing | no kind; diagrams are not built (sibling area A4) | kind `diagram` + `source_diagram_id` | #211–#215 |
| 06 | Typed ports on cards: evidence in (ring), question in (diamond), claim out (brass dot), answer out (brass diamond) | missing | one generic left target + right source `Handle` on every card (`nodes.tsx`, `Frame`); no handle ids, no `sourceHandle`/`targetHandle` in model or schema | edges need `from_port`/`to_port` (or derive from kind); rule: which kind-pairs connect | #211–#215 |
| 06 | Drag from a brass pin to make a thread | partial | drag from the dot handle works (xyflow `onConnect`, `CanvasView.tsx:99`); pins are blue discs, not brass; no compatibility highlight | none | #211–#215 |
| 06 | "Link as" picker: dashed "Link as ... → ..." header naming both ends, 4+3 grid with line swatch + number key, keys 1-7, Esc = plain link, 7 = plain link | wrong | `KindPicker.tsx`: modal dialog (scrim), title "How are these connected?", 7 text buttons in 2 columns, optional label field, no number keys (`grep` of the file: no key handler besides Escape), **Escape cancels and creates nothing** (design: Esc keeps a plain link), no swatch. Header does name both ends (shot) | none; the 7th kind: `relates` is today's plain link (label "relates to") | #211–#215 |
| 06 | Seven thread kinds, colour AND second cue (stitch, glyph) + a paper tag | partial | enum is exact (`schemas.py:745`, `model.ts:21`). Edge render is one grey line + pill label (`LabeledEdge.tsx:1-38`, shot) with the kind word; no colour per kind, no dash/stitch pattern, no glyph | none for rendering; paper tag needs cross-paper | #211–#215 |
| 06 | Edge labels on the line ("derives from", "supports") | exists | `LabeledEdge` pill (`06-board-current.png`); custom label overrides the kind | none | #211–#215 |
| 06 | Frames: dashed outline, paper tag ("Why attention only", "Mechanism") | partial | see Add frame; group renders behind its members | none | #211–#215 |
| 06 | Minimap ("Map · 100%", bottom-right) | missing | no `MiniMap` import in `CanvasView.tsx`; DOM check `.react-flow__minimap` false | none (xyflow `MiniMap`, restyle) | #211–#215 |
| 06 | Legend strip (THREADS + PINS rows, hint "Drag from a brass pin to make a thread.") | missing | none | none | #211–#215 |
| 06 | Deep multi-step undo/redo | partial | only a delete-undo toast, 8 s, one level (`useBoardController.ts:397-410`, toast `data-testid=undo-toast`). Moves, edits, links are not undoable | none server-side if the client replays PATCH/POST; node `version` already guards stale writes | #211–#215 |
| 06 | Selection frame + link bar (kind/label for a selected link) | exists | `edgebar` select + label input (`CanvasView.tsx:226`) | none | #211–#215 |
| 06 | Keyboard paths | partial | e2e `e2e/s7/canvas-keyboard.spec.ts`: Tab to focus nodes, Enter selects, arrows move, Delete deletes (Backspace does not by design, `deleteKeyCode={['Delete']}`). No keyboard way to start/finish a link (ADR-004 §2.8 says xyflow has none) | none | #211–#215 |
| 06 | Cards "Open source" returns to the passage | exists | `ExcerptNode` link `?focus=<node id>`, handled by `useFocusFromCanvas.ts`; anchor stored (`source_anchor_json`) so it survives a reparse | none | #211–#215 |
| 06 | Card sprawl: card body clip cue | wrong (v0.1 defect, see §7) | `.pt-cv-node__body {overflow:auto}` (`styles.css:2620`) with no fade/"more"; the AI card in the shot ends mid-sentence ("The motivation is that the dominant sequence") | none | #211–#215 |
| 06b | Empty board: ruled card with brass pin, sprout, "Nothing on this board yet. Select a passage and choose Send to board, or Dive in from an explanation.", "Back to the paper", two hints, "Map · empty" | partial | `EmptyState` exists with different words ("Nothing on your canvas yet ... Send to canvas ..."), primary button "Open the paper"; no sprout/pin, no hints, no minimap. Shot: `shots/06b-board-empty-current.png` | none | #214 |
| 06b | Words "board" vs "canvas" | wrong | the code, routes, toasts, buttons say "canvas" everywhere (`/paper/<id>/canvas`, "Send to canvas", "Add to canvas"); design says Board. PRODUCT.md/FINAL.md use Board | none (rename strings; keep the route or add `/board` alias) | #214 |

### 4.1 500-node measurement (own account, one real corpus paper)

Setup: paper `ppr_K20Z41HJW8FGTKTZKMBM2TW14N` (corpus Attention paper, parsed). 500 note nodes in a 25×20 grid (300×200 px pitch, 7,500×4,000 canvas px) + 167 `supports` edges via the real API (500 POSTs took 6.6 s, ~13 ms each). Headless Chromium 1440×900, dev server (`next dev`, so unoptimised), load average at runs 3.6 to 9.1 (`uptime` 15:47 and 15:49, other agents running).

| Measure | Result |
|---|---|
| `GET /papers/{id}/board` (500 nodes, 167 edges) | 237,582 bytes, 9.7 ms |
| Page load to first `.react-flow__node` | 553 ms |
| Nodes rendered into DOM | 500 of 500 (no virtualisation: `onlyRenderVisibleElements` not set), 167 edges |
| First view | `scale(0.2)` = the minZoom clamp: "Fit all" cannot show a 7,500 px board in 1440 px (needs 0.19). The first screen of a large board is a field of unreadable thumbnails (`shots/06-board-500-current.png`) |
| Wheel/ctrl zoom, 60 steps | frame interval median 16.7 ms, p95 17.7 ms, max 25 ms (vsync-limited at 0.2 to ~0.5 zoom) |
| Mouse pan, 40 moves | 695 ms total (17 ms/move) |
| Phone 390×844 first open | same 0.2 scale, 500 nodes in DOM (`shots/08c-phone-board-500-firstopen.png`) |

So 500 nodes is smooth for pan/zoom in this environment at low zoom. NOT CONFIRMED: frame times at zoom 1 with all 500 mounted (the viewport only shows ~12 cards then, but all 500 stay mounted); a real-device phone; a production build; a pointer drag of a card (React Flow re-renders `nodes` state per move).

---

## 5. Frame 09c-board-other (lamp-lit board)

Shot of the current app in dark: `shots/09c-board-other-current-dark.png`.

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 09c | Lamp-lit scheme exists (follows the OS) | partial | `styles.css:113` `@media (prefers-color-scheme: dark)` with `:root:not([data-pt-theme='light'])`; board renders dark (shot) | none | #215 |
| 09c | Explicit theme switch (daylight / lamp-lit; the "Aa" button in the header) | missing | `data-pt-theme` is only ever *read* in CSS and one test (`packages/ui/test/registers.spec.tsx`); no TSX sets it. There is only a `light` override, no `data-pt-theme='dark'` rule, so a user on a light OS cannot get dark. Also `apps/web/src/app/globals.css` still has dead `.dark` and `.sepia` classes | none (persist the choice in localStorage or a user pref) | #215 |
| 09c | Lamp-lit palette: warm walnut ground `#1C1714`, paper cards `#3D3226`, brass pins, lit-wash | wrong | dark today is neutral charcoal `#171614` / `#1f1e1b` with violet AI cards (`--pt-derived-ground: #1e1b2e`); not the warm study of the design (shot) | none | #215 |
| 09c | Board cards in lamp-lit (tags, ribbons, wires with glyphs) | missing | see §4 | none | #215 |

---

## 6. Frame 10-design-system, 00-strip, 11-motion, 12-prototype

### 6.1 Tokens and theming (frame 10)

Today's tokens: `packages/ui/src/styles.css` `:root` block (lines 24-110) declares 78 distinct `--pt-*` custom properties in total (cv/s3/explain families add more), dark overrides at `:113`. They are `--pt-ink, --pt-ground, --pt-rule, --pt-page-ground, --pt-panel-ground, --pt-derived-*, --pt-accent*` (ink blue `#2a4e8c`), `--pt-hl-*` and so on. `tokens.css` (design) defines roles: `--ground`, `--page`, `--ink`, `--font-*`, `--dur-*`, `--ease-*`, cloth, gilt, brass, walnut, with `:root[data-theme="light"|"dark"]` and an `@media` guard.

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 10 | Role tokens per scheme (Ground, Page, AI slip, Call slip, Board linen, Ink, Margin tab, Ribbon, Sticky ...) | partial | `--pt-*` has ~8 of the ~26 roles in kind (ground, ink, muted, rule, accent, derived). No Board linen, call-slip, margin-tab, ribbon, sticky, brass, walnut, cloth, gilt tokens | none | #191, #188, #189, #190 |
| 10 | Theme attribute | partial | `data-pt-theme='light'` override only (see 09c); design uses `data-theme="light"\|"dark"` | none | #191, #188, #189, #190 |
| 10 | Fonts: Libre Caslon Display/Text, Alegreya Sans/SC, Courier Prime | missing | `apps/web/src/app/layout.tsx:18-37`: deliberately the system stack (comment: `next/font/google` broke builds offline). `getComputedStyle(body).fontFamily` = `ui-sans-serif, system-ui, sans-serif`. `--pt-font-body` = `ui-serif, Georgia`, `--pt-font-derived` = `ui-rounded, 'SF Pro Rounded'`, `--pt-font-mono` = `ui-monospace`. Fonts must be self-hosted (the design's `tokens.css` `@import`s Google Fonts, which the repo's offline rule forbids) | none; add woff2 to `apps/web/public/fonts` | #191, #188, #189, #190 |
| 10 | Motion tokens (`--dur-quick 120`, sheet 240, pull 320, open 480, flash 180/900/600, eases) | missing | only `--pt-s3-motion: 160ms` (`styles.css:1717`); ~15 hard-coded durations | none | #191, #188, #189, #190 |
| 10 | Spacing/radius scale (4 px base; radius 2/3/4/14/50%) | partial | `--pt-radius: 10px`, `--pt-radius-panel: 12px`, `--pt-gap: 8px`; cards are 10-12 px rounded, the design is 2 px paper corners | none | #191, #188, #189, #190 |
| 10 | Elevation e1-e3 | partial | `--pt-sheet-shadow`, `--pt-float-shadow` (two levels) | none | #191, #188, #189, #190 |

Class families that would be restyled (selectors in `styles.css` / TSX files that use the prefix): `pt-cv` 33 selectors / 4 files; `pt-s3` 36 / 15 (the library, auth, buttons); `pt-explain` 29 / 4; `pt-hl` 12 / 3; `pt-reader` 4 / 4; `pt-guided` 3 / 1; `pt-btn` 4 / 17; `pt-state` 3 / 5; `pt-toast` 3 / 3; `pt-derived` 6 / 2; `pt-field` 1 / 4. `styles.css` is 3,005 lines and uses `var(--pt-*)` 382 times; a token swap reaches almost everything, but the shelf/book, spine, ribbon and brass parts have no CSS to restyle (greenfield). Tailwind classes in `apps/web` do not read the tokens (`packages/ui` is outside Tailwind's content globs, `styles.css:7-14`).

### 6.2 Shared components (DESIGN.md §3)

Exports today: `packages/ui/src/primitives.tsx`: `IconButton`, `Panel`, `SegmentedControl`, `Tabs`, `Sheet` (detents peek/half/full); `provenance.tsx`: `DerivedBlock`, `EquationView`, `TableView`, `FigureView`, `PaperText`, `ReflowedText`, `AiText`. `apps/web/src/components/ui/`: `Button` (`pt-s3-btn`: primary, secondary, ghost, danger; small/md/lg; loading), `Input` (label, hint, error via aria-describedby). Canvas has its own `toast.tsx`.

| Component (frame 10) | Status | Evidence / what is missing |
|---|---|---|
| Button states (default, hover, pressed, focus, disabled) | partial | `Button` has variants and loading; no "pressed" state style, no brass "To board" icon button variant |
| Primary (red) / Outline primary | partial | `pt-s3-btn--primary` is ink blue (`--pt-accent`), design is ribbon red |
| Text field + "Not sent; your text is kept" error state | partial | `Input` has error text; the "kept" wording and the red-ruled variant are absent |
| Segmented switch (Source / Guided / Split, icon-only) | partial | `SegmentedControl` exists; check icon-only form: NOT CONFIRMED |
| Call slip | missing | no component (explain panel renders the question as plain text) |
| AI slip ("AI" tab, source line, serif-less sans text) | partial | `AiText` / `DerivedBlock` with `⊙` and "AI interpretation" label; no tab, no source line |
| Numbered marker + margin tab (`p. 1 ¶1`) | partial | citation chips (`p. 1`) in `RichText`; not the numbered brown marker, no hanging margin tab, no "not verified" dashed variant |
| Trace list item (+ lit row, "Show in paper") | partial | citation rows exist in the explain panel (area A2); not this form |
| Coverage readout ("Stands on 4 passages · 11 citations · 1 paragraph uncited") | missing | grep finds nothing |
| Reading-now row (ribbon + progress + Continue) | missing | library/shelf (area A1) |
| Shelf label holder | missing | A1 |
| Link-as picker | wrong | see §4 |
| Port pins (idle/hover/target/dragging) | missing | xyflow `Handle` blue discs only (`.pt-cv-handle`) |
| Sprout mark | missing | no brand mark; `apps/web/src/app/icon.svg` is the only logo asset: NOT CONFIRMED what it shows |
| Toolbar button (labelled icon) | partial | `IconButton` with tooltip label, 44 px target |
| Toast with Undo | exists | `CanvasView.tsx:321` (`pt-toast pt-toast--lift`, Undo + Dismiss, 8 s) |
| Selection toolbar | exists | `reader/SelectionToolbar.tsx` (Highlight, Ask, Send to canvas) |
| Board card | partial | `Frame` in `nodes.tsx` (header label, body); none of the paper look |

### 6.3 Motion (frame 11)

| Sequence (frame 11) | Status | Evidence | Backend needed |
|---|---|---|---|
| Pull out (spine lifts, turns, cover faces you) | missing | no shelf yet (A1) | none |
| Open (cover swings, cross-fade) | missing | none | none |
| Dive in (page slides in carrying the exchange) | missing | no notebook | none |
| A thread connecting (dashed line follows pointer, picker settles, ink the wire) | missing | xyflow draws a default connection line; picker opens instantly | none |
| Citation flash (180 in / 900 hold / 600 out, faint outline stays) | partial | `.pt-flash` SVG fill+stroke, `1200ms ease-out` keyframe (`styles.css:1158-1190`), `FLASH_MS = 1200` (`ReaderWorkspace.tsx:236`); design total is 1680 ms with a persistent outline | none |
| Marker ↔ trace highlight (120 ms lighting of both) | missing / NOT CONFIRMED | no paired hover logic found by grep of `explain/`; `pt-explain-pulse` keyframe exists (`styles.css:2246`) | none |
| Search lights the shelf | missing | no shelf search lighting | none |
| Reduced motion | partial | three blocks: `styles.css:1674` (flash becomes a steady outline for 1200 ms; sheets and buttons: no transition), `:2059`, `:2427`, `:2845`; no shared token (`s3-motion` is only the 160 ms duration, there is no "motion off" token) and no per-sequence reduced variant as drawn (e.g. pull out cross-fade 120 ms) | none |

### 6.4 Frame 00-strip (tokens, seven thread kinds, buttons) and 12-prototype

00-strip content is the token/kinds/buttons summary: covered in §4 (kinds), §6.1 (tokens), §6.2 (buttons).

Prototype checklist (frame 12; the strip lists 1 Library, 2 Pull out, 3 Open, 4 Read, 5 Explain, 6 Dive in, 7 Board in the shot; the brief's steps 9-14 are the later ones):

| Step | Status | Path today |
|---|---|---|
| 1 Library | exists (old look) | `/dashboard` lists papers; no shelf |
| 2 Pull out | missing | no shelf, no pulled-book view |
| 3 Open | missing | click opens the reader directly |
| 4 Read | exists | `/paper/<id>/read` |
| 5 Explain | exists | explain panel, thread, citations (area A2) |
| 6/9 Dive in | missing | no path |
| 7/10 Notebook | missing | no path |
| 11 Board | partial | `/paper/<id>/canvas` exists; only via send-to-canvas or typing the URL: the reader has no persistent "Open board" button (only a toast link) |
| 12 A thread from the plate's brass pin | missing | no plate (diagrams not built) and no brass pins |
| 13 "Link as" | partial | picker exists, wrong shape (§4) |
| 14 supports | exists | `supports` can be created (demo board has one) |

---

## 7. v0.1 defects in my area (#178, #175)

| Defect | Verdict | Evidence |
|---|---|---|
| Phone first-open of a wide board fits at ~0.26 zoom | still present, changed form | first view is now "whole board" with `minZoom 0.2` (`CanvasView.tsx:70-72`). 500-card board opens at 0.2 on 390 and 1440 alike. A saved viewport wins over fit (`defaultViewport={ctl.initialViewport}`), so the demo board opened at 1.0 on a phone with half the card off-screen (`shots/08c-phone-board-current.png`). The design's board has a minimap and Fit all; neither is a fix at 390 |
| Card bodies clip with no cue | still present | `.pt-cv-node__body{overflow:auto}`, no fade, no "more" (`styles.css:2620`); AI card in the shot cut mid-sentence |
| Toast covers the composer at 390 | NOT CONFIRMED | the composer is on the reader. Canvas toast now has `--lift` that starts 72 px from the left so it clears the zoom controls (`styles.css:2858`); I did not test it over the reader's composer. The design's toast (frame 10) sits in the page, not fixed |
| A stale notice names unsaved text | fixed | `useBoardController.ts:181-200`: the notice names the card by what the server has after reload; comment says so |
| Dragging by the header label panned the pane once | NOT CONFIRMED | `pt-cv-node__head` is not `nodrag`, so a header drag moves the card as intended; the single pan was not reproducible from code. The new design's header is a paper tab, so the exact element changes |
| No `main` landmark | still present | DOM check on the canvas route at 1440: `document.querySelector('main') === null` (both the 3-node and 500-node boards); root is `div.pt-cv` (`styles.css:2443`) |
| The open-source e2e checks the viewport only | still present, partly | `e2e/s7/canvas-journey.spec.ts:335-340` reads the flash box against `page.viewportSize()`; there is no check that the anchor's text is the highlighted text. Not re-run here |

---

## 8. Backend designs needed

Repo rules to carry over: user-owned rows keyed `(owner_id, ...)` with composite FKs to `paper_owners (owner_id, paper_id)` and `ON DELETE CASCADE` (`0005:313-355`); every anchor stored as the full `Anchor` JSON (`anchor_json`, `anchorVersion = 1`, `json_extract($.id)` check as at `0005:71-74`), never a bare `block_id`; client-minted ids; `version` column and `409 stale_version` for edited rows; STRICT tables; `--;;` statement separators; Python twin `papertree_anchoring` validates.

### 8.1 Notebook pages (new migration `0006_notebook.sql`)

```
notebook_pages(
  page_id TEXT PK, owner_id TEXT NOT NULL, paper_id TEXT NOT NULL,
  title TEXT NOT NULL, template TEXT NOT NULL DEFAULT 'dot'
    CHECK (template IN ('blank','dot','lined','cornell','derivation')),
  source_thread_id TEXT, source_message_id TEXT,         -- the exchange it started from
  source_anchor_json TEXT CHECK (source_anchor_json IS NULL OR json_valid(source_anchor_json)),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (owner_id, page_id),
  FOREIGN KEY (owner_id, paper_id) REFERENCES paper_owners (owner_id, paper_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, source_thread_id) REFERENCES ai_threads (owner_id, thread_id)  -- ON DELETE SET NULL not possible with composite keys (see the canvas trigger note at 0005:329); use a trigger
) STRICT;

notebook_items(                      -- typed blocks, stickies, quote cards, shapes
  item_id TEXT PK, owner_id TEXT NOT NULL, page_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text','sticky','quote','shape','exchange')),
  x REAL, y REAL, w REAL, h REAL, z INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL DEFAULT '',                         -- text/sticky; shape = JSON in body
  anchor_json TEXT CHECK (anchor_json IS NULL OR json_valid(anchor_json)),   -- quote cards: REQUIRED
  CHECK (kind <> 'quote' OR anchor_json IS NOT NULL),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (owner_id, item_id),
  FOREIGN KEY (owner_id, page_id) REFERENCES notebook_pages (owner_id, page_id) ON DELETE CASCADE
) STRICT;

notebook_strokes(                    -- ink: raw points, outline computed client-side (perfect-freehand)
  stroke_id TEXT PK, owner_id TEXT NOT NULL, page_id TEXT NOT NULL,
  tool TEXT NOT NULL CHECK (tool IN ('pen','highlighter')),
  nib TEXT NOT NULL CHECK (nib IN ('EF','F','M')), color TEXT NOT NULL,
  points BLOB NOT NULL,              -- packed float32 x,y,pressure; cap ~20,000 points per stroke
  created_at TEXT NOT NULL,
  UNIQUE (owner_id, stroke_id),
  FOREIGN KEY (owner_id, page_id) REFERENCES notebook_pages (owner_id, page_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX notebook_items_by_page ON notebook_items (owner_id, page_id);
CREATE INDEX notebook_strokes_by_page ON notebook_strokes (owner_id, page_id, created_at);
```

Anchors: a quote card holds the full `Anchor` of its passage (copied from the AI answer's stored citations). The quote text is a display cache only, regenerated through the anchor resolver after a reparse, as `highlights` do (`anchor_resolutions` cache).

API (JSON, `Wire` models in `schemas.py`, router `routers/notebooks.py`, bearer auth like boards):

| Method, path | Request | Response | Errors |
|---|---|---|---|
| `POST /papers/{id}/notebook/pages` | `{page_id, title?, template?, source_thread_id?, source_message_id?}` ("Dive in") | 201 `{page, items}` where the server seeds `exchange` items: call slip (the user's question text), AI slip (the answer text), one `quote` item per distinct citation anchor in the answer (numbered by marker) | 404 no such paper/thread/message; 422 message not on this paper |
| `GET /papers/{id}/notebook/pages` | | `[{page_id, title, template, counts:{quotes, stickies, text, strokes}, version, updated_at}]` | 404 |
| `GET /notebook/pages/{pid}` | | `{page, items, strokes}` | 404 |
| `PATCH /notebook/pages/{pid}` | `{title?, template?, version}` | page | 409 `stale_version`, 422 |
| `DELETE /notebook/pages/{pid}` | | 204 (also removes its board card) | 404 |
| `POST /notebook/pages/{pid}/items`, `PATCH/DELETE .../items/{iid}` | item fields; quote needs `anchor` | item | 409, 422 (quote without anchor; anchor not on this paper) |
| `POST /notebook/pages/{pid}/strokes` (batch of strokes on pen-up), `DELETE .../strokes/{sid}` (eraser) | `[{stroke_id, tool, nib, color, points}]` | 201 / 204 | 413 over point cap, 422 |
| `GET /papers/{id}/notebook/search?q=` | | typed text + quote text + the AI slip text hits (not ink) | |

Board link: add `kind='notebook'` to the node CHECK and `source_page_id TEXT` on `canvas_nodes` (needs a table rebuild: SQLite cannot alter a CHECK; copy the 0005 pattern at `:52-75`). `POST /papers/{id}/board/nodes {kind:'notebook', source_page_id}` returns a node whose wire body carries `counts` ("4 quotes · 1 sticky") computed on read. The card holds the page id, never a copy of the content.

Test paper: `attention-is-all-you-need.pdf` (corpus; the exchange in frame 05 is its p. 1 ¶1 and p. 2 ¶2-¶4 citations; the demo threads already have these real stored answers).

### 8.2 Board

1. `canvas_nodes.kind` add `question`, `notebook`, `diagram` (CHECK rebuild, one migration). `question` needs `body` + `source_message_id` (the user's message); `diagram` needs `source_diagram_id` (area A4).
2. `canvas_edges`: add `from_port TEXT`, `to_port TEXT` (`evidence_in, question_in, claim_out, answer_out`), validated against a compatibility table in `papertree_db.canvas` (`CanvasRejected` 422 "that pin does not take that thread"). Keep nullable so the 7 existing kinds stay valid. Add `created_at` to the edge wire (the table has it; `_edge_wire` omits it).
3. Cross-paper tag: `canvas_nodes.paper_id TEXT NULL` + FK to `paper_owners`; `canvas_boards.paper_id` is already nullable "for cross-paper boards later" (`0005:313`) but UNIQUE `(owner_id, paper_id)` stops more than one board per paper; the design header shows "Board <paper>", so keep one board per paper and treat the paper tag as the node's source paper only if a second paper's cards ever land on it. NOT NEEDED for v0.2 if the board stays per paper (the frames show one paper's tag colours only on edges/frames: confirm with the owner).
4. Undo/redo: client command stack replaying `PATCH`/`POST`/`DELETE`; no server work; node `version` already rejects stale replays with 409.
5. Frames: today's `group` kind plus `paper tag` display; add `POST` with empty frame (w,h required already) so "Add frame" needs no server change.
6. A 500-card board returns 238 KB / 10 ms; no pagination needed at that size.

### 8.3 Theming and fonts
None server-side. Self-host the five font families as woff2; do not use the Google `@import` in the design's `tokens.css` (the repo builds offline: `layout.tsx:18-23`). Optional `PATCH /auth/me {theme}` to remember the choice across devices; otherwise `localStorage`.

---

## 9. Risks and surprises

- **The web app's API base moved mid-audit**: `:18901` began calling `http://127.0.0.1:18905` (refused), so any agent opening the web UI after about 15:45 sees "Your canvas didn't load" / `/auth/me` failing. Earlier shots in `shots/` (06-board-current, 09c, 08c phone, 05b) were taken before it. `API_BASE_URL` defaults to `http://localhost:8000` (`apps/web/src/lib/api/client.ts:31`) and reads `NEXT_PUBLIC_PAPERTREE_API_URL`; whoever started the web server set it. Not mine to fix.
- Edge render has neither colour nor second cue for the seven kinds; the whole "colour AND pattern" accessibility promise in the design (frame 10) is greenfield, not a restyle. Same for typed ports: every card has the same two handles.
- The "Link as" picker's Escape is the opposite of the design: today Esc creates nothing; design says Esc keeps a plain link (relates).
- "Canvas" vs "Board" wording is baked into route, buttons, toasts, empty state, e2e tests (`e2e/s7/*`), `lib/api/boards.ts` and test file names; a rename touches many tests.
- Explanation cards store a **copy of the answer text** (`body` ≤ 20,000), with only `source_message_id` as the link, so a card cannot show the trace ("4 passages · 11 citations") unless the web re-fetches the thread (it does: `useExplanationCitations.ts`, up to 6 threads per card lookup in `sendToCanvas.ts` `MAX_THREADS_SEARCHED`; a message in a 7th-newest thread fails to send, NOT CONFIRMED by a run).
- `/papers/{id}/pages` is the PDF's pages, not notebook pages: avoid the name clash when adding `notebook/pages`.
- Dark mode cannot be forced on a light OS (only `data-pt-theme='light'` override exists); the lamp-lit scheme as designed also needs new warm tokens, not a retune.
- Ink on an iPad Pencil is unproven (ADR-004 §5); the whole notebook has no code, tests, or contract (`contracts.md`) yet: this is the largest missing area.
- Not verified: reduced-motion behaviour of the picker/connect sequences (they do not exist); fonts' licences (Libre Caslon, Alegreya, Courier Prime are OFL / open); frame 00-strip beyond what its PNG shows (not opened separately).

---

## 10. Tally (rows with a Status word in sections 1-6)

Counted from the tables above (the 500-node measurement and the defects table not included): **exists 11, partial 31, missing 50, wrong 6** (98 rows). Rows marked 'NOT CONFIRMED' were counted by their best-evidence status.
