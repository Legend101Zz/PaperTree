# Changelog

All notable changes to PaperTree are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each release's measured results, and what got
better or worse, are in [`docs/METRICS.md`](docs/METRICS.md).

## [Unreleased]

## [0.3.0] - unreleased

The "tutor" release: a book comes off the shelf and opens in one move, an answer reads like a tutor
explaining, and the board becomes a branching tree you can lay beside the paper. v0.3 is not tagged yet:
its pull requests (#350, #352 to #373) are the work of the v0.3 build, and the figures below come from a
metrics pass on the build, not from a CI run. What got better or worse, with numbers, is in
[`docs/METRICS.md`](docs/METRICS.md#v03-against-v02).

### Added

- **The shelf and the spread:** a click takes the book off the shelf and opens it (spines stand on planks
  and have widths that follow the paper). The spread has At a glance (a short sheet made in the background),
  Continue, Rename, Topic, and Delete with Undo.
- **Tutor answers:** an explanation comes in sections (TL;DR, In plain words, How it works, In the paper), in plain words, with maths set in KaTeX, an inline
  diagram that draws the mechanism, levels (simpler or deeper), and Check yourself. Sources are quiet: a
  small mark you open, not chips between the words.
- **Mermaid diagrams:** the figure in "How it works" is a ` ```mermaid ` fence, and the model picks the kind
  that fits: flowchart, sequence, state, mindmap, timeline, quadrant, xy chart or class diagram.
  - The agent runs Mermaid's own parser on the fence before an answer is stored. It repairs what it can
    (split statements, quoted shape characters, one mindmap root), asks the model once to repair the rest,
    and otherwise drops the fence, so a reload shows what the live answer showed.
  - The browser loads `mermaid` 12.2.0 lazily, only once a fence has closed, and shows a quiet "drawing…"
    placeholder until then. It draws with Mermaid's strict security level, themed from the app's tokens
    (Light, Sepia and Dark pages, Daylight and Lamp-lit rooms), and redraws when they change. A fence that
    does not parse draws nothing.
  - A figure scales to its room but never below 70 % of its drawn size; a wider one scrolls sideways and is
    a keyboard-reachable region. On a board card the figure is a whole-diagram preview, and "larger" opens
    it in a dialog.
  - A stress test of four rounds of live MiniMax-M3.1-Flash answers over the eight corpus papers: round 1
    (prompt only) drew 91 diagrams and 4 failed to render; rounds 2 to 4 left the reader 237 diagrams and 0
    failed to render, in light and dark.
- **Dark and sepia pages:** the paper itself can be read light-on-dark or in sepia (the Aa menu); figures
  sit on a mat that never covers a caption or a label.
- **The selection menu** sits beside the selection, with one paint band per line.
- **The branching board:** ask on a card, branch from words in an answer, focus on a path, Tidy, and an
  Outline you can Export. A card's asks read the path that leads to it.
- **Board beside:** the paper and the board side by side in a split view; drag text in, and a source flash
  shows where it came from.
- **Images:** select a figure, a table or any area, then ask about it, explain it, or send it to the board
  as an image card, from tight high-DPI crops. The agent has an `image` run kind.

### Changed

- **Every run kind runs on MiniMax-M3.1-Flash** (the GA id), at effort low for explain and glance and
  medium for ask, summary and image ([ADR-003](research/architecture-decisions/ADR-003-model-policy.md),
  revision 2026-11-19). Cost is priced at MiniMax's published Flash rates ($0.15 in, $0.60 out, $0.015
  cache read per million). Prompts are about 55 % shorter and the seed budget is half (1,500 tokens).
- **The Summary** no longer shows how many passages it stands on or which bullet was not verified.
- **Send to board** places a long passage in a card sized to it, in view.
- **The agent bench** (`services/agent/bench`) is one arm, the shipped policy, with kinds for follow-up,
  glance, image and board ask.

### Removed

- Citation chips and the repeated page flags between the words of an answer; the "verified" and
  "grounded" readouts, and the API's grounding verdicts (`ai_citations.supported`, a diagram part's
  `supported`; migration 0015, #351) with their verifier and dead code (Wave 6b).
- The catalogue card on the spread (replaced by the open-and-read spread), "Explain with a diagram" as a
  separate selection action (the diagram is inline in the answer), and the per-word datamarks in prompts.
- The Read / Open the book buttons and the Delete card (the click opens the book, Delete has Undo).

### Fixed

- **Shelf and board, #373:** six fixes found while taking the v0.3 screenshots.
  - A short plank shelf no longer scrolls or clips its first and last label holders.
  - The board header's card count no longer runs under the tools.
  - The Enter hint on the board's Follow up button is readable, and the heading sliver beside it is gone.
  - A tree that grows a branch pushes its neighbour clear instead of sliding under it.
  - An answer sent from the reader, with no children, is a tree of one: only a tree that grows pushes.
  - The Board-beside bar clips its title instead of showing a sliver of it.
- **Issues closed:** #323 (env files and `contracts.md` list v0.2's model variables), #336 to #346 (shelf
  and book opening, maths, tutor answers, quiet sources, Summary readout, board send, split view, dark
  reading, the selection menu), #348 (image selection and asks), #349 (UI changes found by playing the
  prototype, in part) and #351 (grounding verdicts). #359 (circle a region an answer talks about) and #361
  (an e2e job that can hang) stay open.
- **Pull requests:** #350 (Wave 0), #352 to #358 and #360 (Waves 1 to 3: reading, selection, shelf, spread,
  tutor answer), #362 to #365 (Wave 4: the board), #366 and #367 (Wave 5: images), #368 and #369 (Wave 6:
  the reader split, live-check fixes, the dead-code sweep), #370 to #372 (Wave 6: diagram layout, docs,
  Mermaid) and #373 (Wave 7: this README, the v0.3 screenshots and demo, and the six fixes above). #363 was
  closed and replaced by #364.

## [0.2.0] - 2026-10-17

The "Ex Libris" release: PaperTree becomes a reading room. The papers stand on a shelf. The reader
explains a passage with numbered markers that flash the passages they stand on, and an AI diagram cites
every part. A notebook page starts from an answer, and the board (v0.1's canvas) lays out what you found.
The whole interface was built from one design: of its 32 frames, 16 are done and 16 are partial, and
each partial frame has an issue ([`RESULT.md`](research/build/v0.2-ui/RESULT.md), "Frames"). The full
notes are on the [GitHub release](https://github.com/Legend101Zz/PaperTree/releases/tag/v0.2.0);
what got better or worse, with numbers, is in
[`docs/METRICS.md`](docs/METRICS.md#v02-against-v01).

### Added

- **Library:** the papers stand as cloth spines on a walnut shelf, a row per topic under a brass label
  holder, with a ribbon, a kraft wrap or a torn label for their state; face-out covers for twelve papers or
  fewer, and rows that scroll sideways past 40. Search dims what does not match and never reorders. Reading
  now lists up to three papers with Continue; the place is kept on the server.
- **The book:** Enter pulls a spine out and opens the spread: a bookplate (the name is asked for once, never
  made up), or the paper's Figure 1 as the plate; the topic and its source, the figures the parser found,
  the abstract with its page tab, your place, Read and Summary.
- **Topics, the Map and the Table:** topic cards, with suggestions from the arXiv category or one short AI
  run, labelled as such and never applied without you; a Map that draws only real citation links, each
  labelled with how it matched; a sortable, filterable catalogue in which a missing value is a dash.
- **The explain exchange:** ask → answer → trace, with markers numbered by passage, a coverage line, and a
  flash with a margin tab ("from marker 2 in the answer"); "no citation · the AI's own reading" for an
  uncited claim; folded earlier answers; the summary as an exchange; the daily-cap card with today's usage
  by kind.
- **Diagrams:** "Explain with a diagram" draws an engraved plate of up to twelve lettered parts that stream
  in and never move. Each part is cited, not verified or inferred, and tapping one flashes its passage.
  Stop, Redraw and Send to board.
- **The notebook:** Dive in makes one bound page per answer with its quote cards. It has typed notes,
  stickies, shapes and five templates; pen, highlighter, eraser and lasso; undo and redo; search; and Send
  page to board.
- **The board:** index and AI-slip cards with brass pins; seven thread kinds told apart by colour and a
  second cue; Link as (keys 1–7) and threading by keyboard (L); frames, a minimap and a toolbar; undo and
  redo (100 steps); 500 cards, drawn as glances below 45 % zoom.
- **Lamp-lit**, a dark scheme that keeps the PDF page paper, and a System / Daylight / Lamp-lit switch
  (Aa), kept per browser.
- **Phone and tablet layouts:** flat books and bottom sheets in the library; the explain panel as a bottom
  sheet; the notebook as a stack on a phone, and with a tool rail, pen input and palm rejection on a
  tablet.
- **Reduced motion:** every moment has a reduced path (one 120 ms fade, or nothing), held to the design's
  durations by an e2e spec.
- **The agent's `diagram` and `topic` run kinds**, with `PAPERTREE_MODEL_DIAGRAM`, `PAPERTREE_MODEL_TOPIC`
  and their effort variables; `NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM` for the `/design-system` page in a
  production build.
- **Migrations 0006–0011:** reading state, the notebook, the board's rebuild, topics, the plate and
  diagrams. The database is copied to `.pre-0008.bak` and `.pre-0011.bak` before the two rebuilds.
- **Tooling:** feature folders with pure, tested models; lint rules for docs, imports and accessibility;
  docstrings on new Python modules, checked in CI; Prettier on `apps/web`; a lefthook pre-commit hook; the
  prototype-flow and reduced-motion e2e specs (88 specs in CI).
- **Dependencies:** `perfect-freehand` 1.2.3 (MIT) and five Fontsource font packages (SIL OFL 1.1)
  ([ADR-004](research/architecture-decisions/ADR-004-v0.2-ui-stack.md)).
- **The project:** the MIT license (`LICENSE`), with Mrigesh Thakur as the author; the README, with a demo
  recording, screenshots of the real app, the release notes and metrics, and the v0.3 plans; this
  changelog. All three were added after the v0.1.0 tag (#183), so they are first released here.

### Changed

- **The reader's header** (Library, Contents, the title, "p. 2 of 15", Source · Guided · Split, zoom, Board,
  Explain) sits over a reader desk; below 768 px it is one row with a menu.
- **The selection toolbar** sits in the page margin beside the selection, or docked at the top of the
  column, and never covers a selected line. It has Explain, Ask, Highlight in five washes, Send to board,
  Copy and Explain with a diagram.
- **Citations:** the repeated page chips ("p. 3 p. 3 p. 3") are replaced by markers numbered by passage
  and a trace of the passages.
- **The canvas is now the board** everywhere a person sees it, at `/paper/<id>/board`;
  `/paper/<id>/canvas` redirects there. The API, the tables and the wire types keep their v0.1 names, and
  the tables are rebuilt in migration 0008 so that a thread names its pins.
- **The library:** v0.1's card grid is replaced by the shelf and its catalogue card.
- **Design tokens and type:** the Ex Libris values under the same `--pt-*` names, and self-hosted
  typefaces (Libre Caslon, Alegreya Sans, Courier Prime).
- **CI:** the E2E job's timeout goes from 40 to 60 minutes, and the Python job also runs
  `tools/check-docstrings.sh`.

### Fixed

- **v0.1.0's known defects:**
  - Contents showed raw block-type labels and "Belongs to no section" (#177).
  - A painted highlight opened its card only from the keyboard or Contents; a click opens it now (#176's
    hit-testing rule).
  - Highlight delete had no undo (#177).
  - After Stop before any text, the copy said the partial answer was "kept above"; it now says "Stopped
    before any text arrived." (#204).
  - At 390 px the floating Ask AI button covered the text; the explain panel is a bottom sheet now (#205).
  - Board card bodies clipped with no cue; they fade and offer "more" now (#214).
  - The canvas page had no `main` landmark; the board has one (#214).
- **Found and fixed during the v0.2 build, before release:**
  - "Send page to board" placed the page's card by the board as the page had read it when it opened, so a
    card added since (in another tab, or by the reader's Send to board) was covered. The lasso's Send to
    board had the same defect. Both now read the board again first (#218, PR #320).
  - The shared button rule eased its fill colour over 120 ms, so just after a theme switch axe found a
    contrast failure. Buttons now ease only their shadow and transform, guarded by a test (PR #302; two more
    transitions are #308).
  - Web unit tests sent unmocked requests to `127.0.0.1:8000`: 97 connection attempts in a full run, now 0.
    A guard fails any such test (#310, PR #312).
  - Answer markers vanished and reappeared when an answer settled, so a click in the gap was lost (#252,
    PR #253).

### Known issues

- **Safari:** in Safari 26.3.1, selecting text in Source mode does not open Explain or Ask; it works in
  Chrome (#327). CI's e2e runs Chromium only.
- **Design frames:** 16 of the 32 frames are partial, each with an issue.
- **Other limits:** the grounding check is still lexical (#179); the citation flash does not work in Guided
  mode (#245); the env files and `contracts.md` do not list v0.2's variables yet (#323). The full list is
  the README's [Known limits (v0.2.0)](README.md#known-limits-v020). The open work is planned in the v0.3
  tracker, [#329](https://github.com/Legend101Zz/PaperTree/issues/329).

## [0.1.0] - 2026-10-15

The first usable release. Upload a research paper, read it as the real PDF or as reflowed text,
highlight passages, ask an AI to explain a passage or the whole paper (every claim is cited back to the
page), and lay out what you found on a canvas. It runs locally, with MiniMax as the model backend. The
full notes are on the [GitHub release](https://github.com/Legend101Zz/PaperTree/releases/tag/v0.1.0);
every feature below was checked in a real browser (Chrome, driven through Playwright) on the release
code, or carried over from an earlier walk where the feature table says so
([`research/build/READER-RELEASE-RESULT.md`](research/build/READER-RELEASE-RESULT.md)).

### Added

- **Library and upload:** register, sign in and sign out (signing out revokes the server session); upload
  by file picker or drag and drop, with progress and Cancel; cards go Queued → Reading (n/3) → Ready
  without a reload and show the real title and page count; a PDF that can't be read says why and offers
  Retry; Delete asks first.
- **Reader:** Source (the PDF with selectable text), Guided (the paper's own words in one column) and
  Split; zoom, mode switches and reloads keep your place; Contents with outline, pages and highlights
  tabs; a paper that is still being read can be opened at once.
- **Highlights:** on a sentence, a table cell, a figure label or across paragraphs; colour, note, delete.
  Stored as anchors and painted from stored quads, identical after reload. A highlight that can't be
  placed goes to a tray with the reason.
- **AI:** explain a selection with streaming and status labels; follow-ups and free questions; Stop keeps
  the partial answer; Retry after an error; citation chips scroll to and flash the cited passage; a
  cached paper summary with cited bullets; a usage line with tokens and estimated cost; AI text styled
  apart from the paper's words; a daily spend cap (`PAPERTREE_DAILY_BUDGET_USD`, default $1.00).
- **Canvas:** send passages and explanations; drag; labelled links (supports, contradicts, derives from,
  answers, compares with, references, or a plain link); notes; groups; delete with Undo; "Open source"
  lands on the passage.
- **Evidence:** every AI run records model, provider, tokens, cost, first-text time, latency, request id
  and the exact code path in `ai_runs`.
- **Everywhere:** 1440 and 390 px, light and dark, keyboard navigation; axe 0 serious or critical in 12
  of 12 page × width × theme combinations.
- **Model policy** ([ADR-003](research/architecture-decisions/ADR-003-model-policy.md)): explain (and
  follow-ups in an explain thread) on `MiniMax-M3.1-Flash-Preview` at effort low; ask (and its follow-ups)
  and summary on `MiniMax-M3`.
- **CI:** Prettier, `next build`, the corpus tests, Playwright journeys A–D and a live journey against the
  real model, added to typecheck, lint, unit tests and codegen drift.

### Known issues

- Highlighting once scrolled the reader (seen once, not reproduced on the release code, guarded, cause
  not found): PARTIAL.
- A Shift+click selection that starts at the very start of a line loses its first 1–2 characters:
  PARTIAL.
- The grounding check is lexical; a selection across columns includes the caption between them;
  highlight delete has no undo; the Contents outline shows raw block labels; the phone canvas first opens
  tiny; test-model runs are recorded in `ai_runs` like real ones. The full list is in
  [`docs/METRICS.md`](docs/METRICS.md) → "Known defects at release", and the fixes are planned in
  [#182](https://github.com/Legend101Zz/PaperTree/issues/182).

[Unreleased]: https://github.com/Legend101Zz/PaperTree/compare/v0.2.0...HEAD
[0.3.0]: https://github.com/Legend101Zz/PaperTree/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Legend101Zz/PaperTree/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Legend101Zz/PaperTree/releases/tag/v0.1.0
