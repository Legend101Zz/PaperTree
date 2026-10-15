# PaperTree v0.1 — S9 hands-on result

The S9 test is the release's hands-on walk: every feature used by hand in a real browser on the final
`release/v0.1` head, against the real stack (API, worker, agent with the real MiniMax key, web) started as
the README says, on a fresh data root.

- **Head:** `60ae507` (after the last fix, #172). Where an earlier S9 pass is carried over instead of
  re-walked, the item says so, with the reason.
- **Browser:** system Google Chrome 155, visible window, driven through Playwright (`channel: chrome`), at
  1440 × 900 and 390 × 844, light and dark.
  - The Mac screen was locked for the whole final walk. The Claude-in-Chrome extension's tab reported
    `visibilityState: hidden`, and pdf.js renders nothing in a hidden tab, so the prompt's fallback
    (Playwright with system Chrome) was used.
- **Papers:**
  - YOLO (1506.02640) and DDPM (2006.11239).
  - ViT (2010.11929v2), the fresh paper never used for tuning, `sha256:8ce7b839…`.
  - Mask R-CNN (1703.06870), for the "still reading" state.
  - A broken PDF.
- **Account:** a new local test account. Parse times were about 2–4 s per paper.
- **Live spend in the final walk:** 5 runs, $0.0118 (estimate).
- **Screenshot labels:** shots named `final-*` were taken on `60ae507`. Numbered shots (`01-` to `43-`) come from the pre-S9 walk on `7220396` or `d03f520`. Where a PASS on the final head cites a numbered shot, the shot illustrates the screen, and the PASS rests on the final-head measurement in the same row.
- **Evidence:** screenshots are cited by their label in the evidence store, which is kept outside the
  repository: `PaperTree-evidence/v0.1/s9/shots/<file>`. The step-by-step log is
  `PaperTree-evidence/v0.1/orchestrator/RUNS.md`, section "FINAL S9 on 60ae507".

Results are PASS, PARTIAL or FAIL; nothing PARTIAL is rounded up.

"Carried" means the item passed by hand in the pre-S9 walk on release heads `7220396` or `d03f520`, and
was not re-walked on `60ae507`. Between those heads and the final head the code changed in two PRs:

- **#173:** two lines of library-card screen-reader text, the explain renderer's handling of partial
  answers, canvas Shift multi-select, the favicon, and the DB's first-start locking.
- **#172:** only the reader (`apps/web` reader files, e2e specs, and one `@media (max-width: 639px)`
  block in `packages/ui/src/styles.css`).

Neither touches the upload, cancel, empty-state, agent-unavailable or budget paths. Two of those
changes were re-walked on the final head instead of being carried: canvas Shift multi-select, and
Stop followed by Retry (which goes through the partial-answer renderer).

## Feature table

### Auth

| Item                                   | Result | Evidence                                                                 | Screenshot                                                           |
| -------------------------------------- | ------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Register a new email                   | PASS   | lands on the empty library                                               | `01-register-1440-light.png`, `02-library-empty-1440-light.png`      |
| Wrong password                         | PASS   | "Invalid email or password. Check them and try again."                   | `03-login-wrong-password-1440-light.png`                             |
| Sign out revokes the server session    | PASS   | `POST /auth/logout`; the old token then gets 401 on `/papers`            | —                                                                    |
| Protected link → login → same page     | PASS   | `/paper/…/canvas` → `/login?next=%2Fpaper%2F…%2Fcanvas` → back to canvas | `04-next-redirect-missing-paper-1440-light.png`                      |

### Library and upload

| Item                                           | Result         | Evidence                                                                                                                                | Screenshot                                                        |
| ---------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| File-picker upload, progress                   | PASS           | 5 file-input uploads on the final head (YOLO, DDPM, ViT, Mask R-CNN and the broken PDF, which was later deleted); the moving progress bar is carried from the pre-S9 walk (throttled)                                                                    | `05-upload-progress-1440-light.png`                               |
| Drag and drop upload                           | PASS (carried) | ViT dropped in the pre-S9 walk (synthetic drop event)                                                                                           | `07-dragover-1440-light.png`                                      |
| Cancel mid-upload                              | PASS (carried) | throttled; "Cancelled", 0 rows                                                                                                          | `06-upload-cancelled-1440-light.png`                              |
| Queued → Reading (n/3) → Ready, no reload      | PASS           | Mask R-CNN on the final head; YOLO/DDPM/ViT                                                                                             | `08-library-ready-1440-light.png`                                 |
| Card shows title and page count                | PASS           | 10 / 25 / 22 pages                                                                                                                      | `08-library-ready-1440-light.png`                                 |
| Broken PDF → Failed + reason → Retry           | PASS           | "Could not read · This file could not be read as a PDF. It may be damaged, scanned without text or password protected." + Retry         | `final-broken-pdf.png`                                            |
| Delete (inline confirm)                        | PASS           | "Delete this paper and its highlights? This cannot be undone." → gone from `/papers`                                                    | `10-delete-confirm-1440-light.png`                                |
| Empty state                                    | PASS (carried) | upload call to action, no sample cards                                                                                                  | `02-library-empty-1440-light.png`                                 |
| 390 px                                         | PASS           | no horizontal page scroll; axe 0 serious at 390 light and dark                                                                          | `33-library-390-light.png`, `33-library-390-dark.png`             |

### Reader

| Item                                                | Result | Evidence                                                                                                                                                                                                                       | Screenshot                                                                     |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Real pages, selectable text, visible                | PASS   | 3,081 text-layer spans in the DDPM window (measured in the walk; RUNS.md); `visibilityState` visible                                                                                                                                                           | `11-reader-source-1440-light.png`                                              |
| Zoom in/out/fit width keeps the top line            | PASS   | DDPM p.2: the top line stays "Figure 2:" at 4–10 px through 150 %, 90 %, fit width, 125 %, +, −                                                                                                                                | —                                                                              |
| Source → Guided → Split → Source keeps position      | PASS   | DDPM p.2: Guided opens at the Figure 2 card with "This paper presents progress…" next; Split shows both panes aligned; back in Source the top line is unchanged                                                                 | `final-mode-guided-ddpm-p2.png`, `final-mode-split-ddpm-p2.png`                |
| Guided shows a figure once (R9)                     | PASS   | DDPM Figure 2: one crop. The crop includes its own caption, so the caption reads twice (v0.2 polish)                                                                                                                            | `final-mode-guided-ddpm-p2.png`                                                |
| Navigator: outline, pages, highlights               | PASS   | three tabs; "Page 6" jumps to scrollTop 5046 (the page top); a highlight entry jumps to it; thumbnails render                                                                                                                  | `final-navigator-outline-yolo.png`, `final-navigator-pages-yolo.png`, `final-navigator-highlights4-yolo.png` |
| "Still reading" state                               | PASS   | Mask R-CNN opened while parsing: the PDF is readable at once, a banner says so, "Guided and Split open when the paper has been read"; turns Ready without a reload                                                              | `final-still-reading-maskrcnn.png`, `final-still-reading-done-maskrcnn.png`    |
| Error state                                         | PASS (carried) | missing paper → plain message (pre-S9 walk); PDF-engine error copy covered by `e2e/rfix/pdf-engine-error.spec.ts`                                                                                                           | `04-next-redirect-missing-paper-1440-light.png`                                |
| Reload keeps position                               | PASS   | scrollTop 4300 → 4300 (DDPM), 457 → 457 (YOLO)                                                                                                                                                                                 | —                                                                              |
| Keyboard navigation                                 | PASS   | see "Everywhere"                                                                                                                                                                                                              | `final-kbd-highlight-focus-yolo.png`                                           |
| 390 px header (H390)                                | PASS   | `scrollWidth` 390; title on one line with an ellipsis; every header control ≥ 40 px; zoom select 100 px; light and dark                                                                                                       | `final-H390-reader-light.png`, `final-H390-reader-dark.png`                    |

### Highlights

| Item                                                         | Result  | Evidence                                                                                                                                                                                                                                                                                                                                                                                              | Screenshot                                                                                         |
| ------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Body sentence by mouse; drag ending in blank space (R1)      | PASS    | exact selections; R1b: a drag starting 40 px right of "…where they are." selects exactly "We reframe … where they are." (255 chars); a leftward drag into the margin snaps to the pointer's line                                                                                                                                                                                                       | `final-R1b-A-blank-start-yolo.png`                                                                 |
| Shift+click into blank space (R1b)                           | PARTIAL | the end snaps correctly to "…where they are." (no more 1,090-char run-on), but the START loses 1–2 characters when the first click is at the very start of the line: a click 1 px inside "W" gave " reframe…", a click 1.5 px left of it gave "e reframe…" (2 of 2 tries)                                                                                                                                                                                                                                                                  | `final-R1b-B-shift-click-yolo.png`                                                                 |
| Table cell                                                   | PASS    | YOLO Table 1 cell "Fast YOLO" (p.6), stored as an Anchor with block, quote and ShapeSelector quads                                                                                                                                                                                                                                                                                                    | `final-hl-table-cell-yolo-p6.png`                                                                  |
| Figure label                                                 | PASS    | "Figure 1:" (p.1), 9 chars                                                                                                                                                                                                                                                                                                                                                                            | `final-hl-figure-label-yolo-p1.png`                                                                |
| Multi-paragraph selection                                    | PASS    | 1,460 chars from "Current detection systems…" (left column) to "…where they are." (right column). Note: it includes the Figure 1 caption and in-figure labels that sit between the columns in reading order                                                                                                                                                                                            | `final-hl-multi-paragraph-yolo-p1.png`, `final-hl-multi-paragraph-yolo-p1-top.png`                 |
| Change colour; add a note                                    | PASS    | Contents → Highlights → Edit → Green and a note: 2 PATCH; stored `green` + the note; green after reload                                                                                                                                                                                                                                                                                               | `43-highlight-green-after-reload-1440-light.png`                                                   |
| Delete                                                       | PASS    | Edit → Delete → gone from `/highlights` (no undo — v0.2)                                                                                                                                                                                                                                                                                                                                              | —                                                                                                  |
| Reload → identical                                           | PASS    | 7 painted rects on YOLO (measured in the walk; RUNS.md); size and page-relative position identical after reload (painted from stored quads)                                                                                                                                                                                                                                                                                                   | —                                                                                                  |
| Orphaned anchor: in the tray, painted nowhere                | PASS    | The API refuses a foreign `pdfSha256` (422 `anchor_mismatch`) and an anchor without quads (422 `anchor_incomplete`). An orphan was therefore seeded in the DB, as `e2e/s4` `insertOrphan` does. Tray: "1 highlighted passage could not be placed on the page", the reason, "Go to page 2", "Delete highlight"; painted count unchanged                                                                   | `final-orphan-tray-open-yolo.png`                                                                  |
| No page jump on Highlight (R2)                               | PARTIAL | not reproduced on the final head: DDPM p.5 at 125 %: 2 highlights at DPR 1 and 1 at DPR 2 (1414 × 858) → scrollTop 4300 → 4300, 4300 → 4300, 3908 → 3908; 0 scroll events. Not reproduced. **Caveat:** the jump was first reproduced at 15:4x through the Chrome extension in the owner's Chrome. That environment could not be re-walked (screen locked); the root cause was never found; #172 guards against it (hold scroll + `overflow-anchor: none`) | `final-R2-highlight-ddpm-p5-1414.png`, `final-R2-dpr2-highlight3-ddpm-p5.png`                      |

### AI (live MiniMax)

| Item                                       | Result         | Evidence                                                                                                                                                         | Screenshot                                                |
| ------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Explain a selection: streams, tool status  | PASS           | ViT, Flash: status "Reading the selected passage…", first text 2.4 s, done 4.7 s, 12 page chips                                                                  | `final-explain-vit-flash.png`                             |
| Follow-up that says "that"                 | PASS           | "Why does that need position embeddings added to it?" → about the patch embeddings; 8.7 s (`ai_runs` latency 8,694 ms)                                                                        | `final-followup-stop-vit.png`                             |
| Free question                              | PASS           | YOLO, M3: first text 4.3 s, 5.7 s total, 2 tool calls (outline, search)                                                                                          | `final-kbd-ask-yolo.png`                                  |
| Cancel mid-answer                          | PASS           | "Stopped. The partial answer is kept above." + Retry; run row `aborted`. When Stop comes before any text, the copy still says "kept above" (v0.2 nit)            | `final-followup-stop-vit.png`                             |
| Retry after an error                       | PASS (carried) | agent stopped → designed "agent unavailable" error → agent restarted → Retry answers (pre-S9 walk; agent and API unchanged since apart from #173's DB start-up lock handling)                                    | `19-agent-unavailable-1440-light.png`, `20-retry-ok-1440-light.png` |
| Citation chip → scrolls and flashes        | PASS           | ViT chip "Show the passage on p. 3" → the patch-embedding paragraph outlined                                                                                     | `final-chip-flash-vit.png`                                |
| Summary with chips; reload → cached        | PASS           | ViT, M3: 7 bullets, 17.7 s; reload → summary in 283 ms, `ai_runs` 5 → 5                                                                                          | `final-summary-vit.png`                                   |
| Usage line                                 | PASS           | "4,569 tokens · ≈ $0.0017 (estimate)"                                                                                                                            | `final-explain-vit-flash.png`                             |
| AI text visibly distinct                   | PASS           | "⊙ AI INTERPRETATION" tinted block vs the paper's quoted words with a page marker; light and dark                                                                | `final-chip-flash-vit.png`, `31-reader-panel-1440-dark.png` |
| Daily budget message                       | PASS (carried) | API restarted with a tiny cap on the test data root → the budget message (pre-S9 walk; API unchanged since apart from #173's DB start-up lock handling)                                                         | `21-budget-exhausted-1440-light.png`                      |

### Canvas

| Item                                       | Result | Evidence                                                                                                         | Screenshot                                                            |
| ------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Send a passage; send an explanation        | PASS   | toolbar "Send to canvas" → 1 POST + toast; explanation → "Answer added to your canvas."                          | `final-canvas-passage-yolo.png`, `final-canvas-vit.png`               |
| Drag                                       | PASS   | exactly 1 PATCH                                                                                                  | `final-canvas-edit-link-yolo.png`                                     |
| Connect with a labelled edge               | PASS   | Link → "How are these connected?" with 6 kinds → "supports" (1 POST)                                             | `final-canvas-edit-link-yolo.png`                                     |
| Edit a note                                | PASS   | Edit → text → saved (node PATCH)                                                                                 | `final-canvas-edit-link-yolo.png`                                     |
| Group (Shift multi-select)                 | PASS   | Shift+click selects 2; Group → POST frame + 2 PATCH                                                              | `final-canvas-group-yolo.png`                                         |
| Delete + Undo                              | PASS   | Delete key → DELETE (node and its edge go); Undo → node and edge restored                                        | `26-canvas-undo-toast-1440-light.png`                                 |
| Reload → identical                         | PASS   | node ids, text, positions and the edge equal after reload                                                        | —                                                                     |
| "Open source" lands on the passage         | PASS   | `?focus=` → "We reframe object detection…" in view                                                               | `final-canvas-open-source-yolo.png`                                   |
| Highlights but no sends → empty canvas     | PASS   | DDPM: `board: null`, "Nothing on your canvas yet …"                                                              | `final-canvas-empty-ddpm.png`                                         |

### Everywhere

| Item                                    | Result | Evidence                                                                                                                                                                                                                            | Screenshot                                                                          |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Dark and light                          | PASS   | reader, Guided, library, canvas, explain                                                                                                                                                                                           | `30-library-1440-dark.png`, `final-H390-reader-dark.png`                            |
| Keyboard-only journey                   | PASS   | Tab → library card → Enter → reader; arrow keys switch modes; Contents opens with Enter and closes with Escape (focus returns); Enter on a focused highlight opens its card; Ask AI → 3 Tabs → composer → answer                                                    | `final-kbd-ask-yolo.png`, `final-kbd-highlight-focus-yolo.png`                      |
| axe 0 serious                           | PASS   | axe-core 4.12.1: 0 serious or critical on reader Source, reader Guided and library × 1440/390 × light/dark (12 of 12)                                                                                                               | —                                                                                   |
| Console free of errors                  | PASS   | No app errors. The one browser-logged entry is the designed 409 from `/ir` while Mask R-CNN was still parsing                                                                                                                       | —                                                                                   |
| Journey E per step                      | PASS   | Ask `req_01M4ZVQBQNV12VDW8M0BNSFX9T` is in the API and agent logs. Its `ai_runs` row records model, tokens, cost, first text, latency and `code_path` `api.threads.ask>agent.v1.runs>pi.createAgentSession>minimax.anthropic-messages`. During the explain, the agent's only external socket was `[2405:200:1630:a05::312c:c919]:443`, an `api.minimax.io` AAAA address | —                                                                                   |

## Journeys (§5)

- **A — PASS:** register, upload a real PDF, the worker finishes, and that paper opens with real pages and
  selectable text.
- **B — PASS:** highlight, reload, same highlight and anchor; zoom and mode switches keep position; the
  orphan is in the tray and painted nowhere.
- **C — PASS:** select, explain (live), follow-up, citation lands on the right passage; a grounded summary;
  AI and paper text are distinct.
- **D — PASS:** passage and explanation sent, then move, connect, edit, group, reload: persisted. Source
  cards open their passages, and nothing is auto-populated.
- **E — PASS:** see the table above.
- **F — PASS:** CI is green on `60ae507`, including the live journey. In the final uncached local gate every step passed except prettier: its first run failed only on an untracked `.pytest_cache/README.md`, and it passed after the `.prettierignore` fix in this PR. Numbers are in `docs/METRICS.md`.

## Defects left (known limits, v0.2)

- **R2 (PARTIAL):** root cause unknown. It is guarded by #172 and was not reproduced on the final head,
  but it was never re-walked where it was first seen (the Chrome extension in the owner's Chrome).
- **Shift+click (PARTIAL):** when the first click is at the very start of a line, the selection loses
  its first 1–2 characters.
- **Selection:**
  - A selection across columns includes figure captions and labels that sit between the columns.
  - A painted highlight opens its card only from the keyboard or Contents, not by mouse click.
- **Guided:** a figure crop includes its caption, so the caption reads twice.
- **Highlights:** delete has no undo; the Contents outline shows raw block-type labels ("title",
  "author").
- **Explain:** after Stop before any text, the copy says the partial answer is "kept above".
- **Zoom at 390:** a resized desktop window restores the saved 125 % zoom at 390 px, so the page is
  wider than the pane (a phone does not inherit it; localStorage is per browser).
- **Canvas:**
  - Phone first-open of a wide board is tiny.
  - The toast covers the composer at 390.
  - Dragging by the header label panned the pane once.
  - The canvas page has no `main` landmark (axe "region", moderate).
- **Accessibility:** on DDPM p.2 the pdf.js text layer exposes raw `latexit` base64 and NUL characters to
  assistive tech.
- **Logging:** a cancelled upload is logged by the API as a 500 `ClientDisconnect` error.
- **Model mistakes seen:** "pretrained on" answered with the VOC training set; "a7 × 7" is in the model's
  own text.
