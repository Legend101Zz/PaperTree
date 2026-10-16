# GAP-A2: reader, explain (ask → answer → trace), summary, AI diagrams, phone, lamp-lit reader

- Date: 2026-10-16. Commit audited: `79f637d` (worktree `v02-ui`, v0.1.0 + docs).
- Checked: the running dev stack (web :18901, API :18902, agent :18903 in FAUX mode) as `demo@example.test`, the stored real threads on "Attention Is All You Need" (`ppr_G9AYN750E5MG1NRBMGSQJ4N5JM`), and the code in `apps/web/src/components/{explain,reader}`, `packages/ui/src`, `services/agent/src`, `services/api/python/papertree_api`, `infrastructure/migrations/0005_reader_release.sql`, `contracts/agent`.
- Frames: 00-strip, 04, 04b, 04c, 04d, 07a-d, 08b, 09b, 13 and prototype steps 5-8. Design PNGs in `/Volumes/Mrigesh SSD/PaperTree-design/v0.2/compare/F-final/`.
- Screenshots of the current app: `shots/`.
- Status words: exists / partial / missing / wrong. "NOT CONFIRMED" = could not verify.
- Data facts used throughout (read from the API): the demo thread `thr_01M508X9PC9K9HKHSVB2J9W1A1` is kind `explain`, 4 messages; its answer 1 has 4 citations with handles b1, b6, b7, b8 (pages 1, 2, 2, 2); answer 2 has 3 (b6, b1, b8). The design's "4 passages · 11 citations" is exactly this thread (6,286 + 490 = 6,776 tokens, $0.0027, first text 2,358 ms).

## Method notes

- Screenshots are in `shots/` next to this file (absolute: `shots/`). The app was driven with headless Chromium scripts (selection by real mouse drag, Ask, Stop, Summarize, chip click) as `demo@example.test`. The agent is FAUX, so the answer text in screenshots is scripted ("Faux answer ..."); every STORED-thread fact comes from the real MiniMax answers returned by `GET /papers/{id}/threads/{tid}`.
- I created three throwaway threads on the demo account's Attention paper (selection explain, two asks with `[faux:slow]`/`[faux:stall]` tags). I deleted nothing.
- Not done (marked NOT CONFIRMED where it matters): the budget refusal on a live run (no way to reach $1.00 without a real model; read from code), any real-model streaming, tablet size, Chrome Safari-specific selection behaviour.

## Summary of the biggest findings (read this first)

1. **The ask → answer → trace UI is a different product from v0.1's drawer, but ~80% of its data already exists in the API.** Everything the trace needs is in the stored thread: the ask (first user message), the selected passage (`origin_anchor`), per-citation anchors with `SectionPathSelector` ("Abstract", "Introduction"), `supported`, and the run's usage. Passage numbers, "cited 5×", "11 citations" and "1 paragraph uncited" all derive exactly from the real stored answer (checked by script: 11 `[bN]` occurrences, 4 distinct handles, 5 paragraphs, the 5th without a marker, the same as frame 04).
2. **The Explain panel cannot open a stored thread.** `threadsApi.list`/`get` are used by the canvas code and by Stop's re-fetch, but the panel itself never lists threads. Re-opening the panel on a paper that has a stored thread shows "Select a passage in the paper and press Ask" (`shots/04-panel-open-fresh-current.png`). Thread "1 of 2", "< >" paging and "exchanges named by their asks" therefore need front-end work AND one small list-endpoint change (the list does not return the ask).
3. **There is no `diagram` run kind anywhere** (CHECK constraint, agent `Kind`, prompts, faux, SSE event names, API `RunKind`). It is a full new vertical slice; sketched below.
4. **Reader chrome in the design (page indicator, Board, Explain tab, docked toolbar with five washes, margin tab "from marker 2 in the answer") is mostly missing**; the v0.1 reader is a different layout (Contents, mode switch, zoom select, Canvas, a floating "Ask AI" button).
5. **ADR-004 §2.9 says the diagram prompt goes in `packages/prompts`. That package is Python-only (sanitise/untrusted/channels).** The real prompts are TypeScript in `services/agent/src/prompts.ts`. The ADR path is wrong; the diagram prompt belongs there (and the `explain-v1/ask-v1/summary-v1` version names and the `PROMPT_FOR_KIND` map in `contract.ts`).
6. **Frame 04's "AI's own reading" paragraph depends on a prompt convention, not a structure.** The prompt (`prompts.ts`) tells the model to write "This is my reading, not the paper's claim." with no citation. The real stored answer obeys it, but nothing marks or checks it; "uncited paragraph" can be computed, "the AI's own reading" label must be asserted by the client for any uncited paragraph (which is right for the product truth, and wrong for headings/lead-ins that are legitimately uncited).

## Frame 00-strip: type voices, markers/tabs, "cited"/"not verified", AI vs paper marking

Current-app evidence: `shots/04-answer-current.png`, `shots/04d-summary-current.png`, `shots/08b-phone-reader-current.png`.

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 00 | Voice: THE PAPER (Caslon, quoted in the trace and the slip) | partial | `PaperText` sets `data-register="paper"` (`packages/ui/src/provenance.tsx:308`); used for the quote above the thread (`explain/index.tsx` `Quote`). Typeface is the v0.1 serif/sans pair, not Libre Caslon (tokens not in the app yet). | none | #190 |
| 00 | Voice: THE AI (Alegreya Sans on the tinted slip, standing "AI" tab) | partial | `AiText` gives a tinted purple block with `⊙ AI interpretation` header and `data-register="ai"` (`provenance.tsx:402-420`); there is no "AI" tab, no model name ("M3.1 Flash · from the paper"). `AiText` takes a `model` prop but `AnswerView` does not pass it (`shots/04-answer-current.png` shows "AI INTERPRETATION" only). | none; `model` is already on `Message.run.model` | #190 |
| 00 | Voice: YOU, TYPED (Courier Prime, pen blue-black, on a ruled call slip with initial and time) | wrong | The person's follow-up renders as a grey bubble `<p class="pt-explain__question" data-user-message>` in the UI sans, no initial, no time, no register attribute (`explain/index.tsx`, `shots/04c-stopped-current.png`). For the first ask the person's text is not shown at all: only the selected quote appears (`shots/04-answer-current.png`), so "Explain this passage" is invisible. | none (message `created_at` is on the wire) | #190 |
| 00 | Voice: YOU, IN INK (script, for notebook) | missing | No handwriting register anywhere in `apps/web/src` or `packages/ui/src` (grep `data-register` finds only ai, paper, reflowed). Out of A2's area (notebook) but the register attribute set has no "you" value. | none for the attribute; ink data is the notebook's | #190 |
| 00 | Page tab, cited (`p. 1 ¶1` ribbon) | partial | Chip shows `p. N` only (`CitationChip.tsx:21`, `citationPageLabel`); no paragraph number, not a ribbon, and it is a pill 107x28 px at 390 wide (below 44 px). | `¶` is derivable (see "Backend designs", item B1) | #190 |
| 00 | Page tab, not verified (dashed, "p. 7" + "not verified") | partial | Exists: `supported === false` gives `data-supported="false"` and a "not verified" flag in the chip (`CitationChip.tsx:34-43`, dashed styling in `styles.css`). Design puts "not verified" under the tab in the margin and adds the lexical-check wording; the information is there. | none | #190 |
| 00 | Numbered marker after a claim (`[1]`) | missing | Chips replace `[bN]` in place and are per citation, not per passage (`RichText.tsx:74-96`). No numbering function exists. | none server-side; derive (B1) | #190 |
| 00 | Marker lit (navy ring, on hover/focus, 120 ms) | missing | `.pt-chip` has no lit state tied to a trace row; no trace rows exist. | none | #190 |
| 00 | Sidenote: marker + tab in the answer's margin | missing | No margin column in `AnswerView`; chips sit inline. | none | #190 |
| 00 | "No citation, the AI's own reading" marking for uncited prose | missing | `RichText` renders uncited paragraphs identically to cited ones. The answer text of the stored thread contains the uncited paragraph (verified), so it is computable. | none (B2); a prompt-side guarantee is a separate hardening item | #190 |
| 00 | Product truth: AI text visibly differs from the paper's words and the person's words, on every surface | partial | Two of three voices have an attribute (ai, paper); the person's words have none, and the explain panel, the summary and the canvas card all pass through `AiText` (good: `AnswerView`, `SummaryView`). The product truth holds for AI vs paper; it is NOT yet enforced for "you". | none | #190 |
| 00 | Product truth: no "verified", "fact-checked" or "accurate" label | exists | `grep -ri "verified\|fact-check\|accurate"` in `apps/web/src` and `packages/ui/src` finds only "not verified" (`CitationChip.tsx`), comments, and auth `sessionUnverified`. No positive "verified" label exists. | none | #190 |
| 00 | Usage line always ends "(estimate)" | exists | `formatUsage`: `≈ $0.0014 (estimate)` (`AnswerView.tsx:23-28`; observed in `shots/04-answer-current.png`). Budget line also says "(estimate)" (`BudgetDetail`). | none | #190 |

## Frame 04: reader + explain (ask → answer → trace), 1440

Current: `shots/04-reader-closed-current.png` (closed), `shots/04-selection-toolbar-current.png` (selection), `shots/04-answer-current.png` (answered), `shots/04-panel-open-fresh-current.png` (panel reopened, no thread).

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 04 | Chrome: Library / Contents / title / "p. 2 of 15" | partial | Library ("Back to your library"), Contents and the title exist; **no page indicator** anywhere (no "of 15" in `apps/web/src/components/reader`, header screenshot `04-reader-closed-current.png`). `page_count` is on `LibraryPaper`. | none | #202, #201, #203 |
| 04 | Chrome: Source / Guided / Split | exists | `ModeSwitch.tsx`; visible in every screenshot. | none | #202, #201, #203 |
| 04 | Chrome: zoom "Fit width" menu | partial | `-`, a 125% select, `+`, and a separate "Fit width" button (`ZoomControl.tsx`). Design merges Fit width into the select. | none | #202, #201, #203 |
| 04 | Chrome: Board / Explain tab pair | wrong | Top right is "Canvas" (a link) and a floating blue "Ask AI" button bottom-right (`explain/index.tsx:332`); there is no Explain/Summary tab in the bar. Naming is "canvas" everywhere (also "Send to canvas"), the design says "board". | none | #202, #201, #203 |
| 04 | Explain panel: right column with header (Explain, thread menu, Summary, close) | partial | Drawer with title "Explain" + "Close" (`index.tsx` ExplainPanel); "Summarize paper" is a button inside the body (not the header). No thread menu, no prev/next. | list endpoint change (B3) | #202, #201, #203 |
| 04 | Thread menu "Thread 1 of 2" with arrows | missing | The panel never calls `threadsApi.list`; a stored thread cannot be opened (`shots/04-panel-open-fresh-current.png`: empty state on a paper that has a stored thread, verified via `GET /papers/{id}/threads` returning `thr_01M508X9…`). | `GET /papers/{id}/threads` must return the ask and counts (B3) | #202, #201, #203 |
| 04 | Call slip: the selected passage (italic, truncated) + page tab `p. 1 ¶1` + the typed ask + time | partial | The passage is shown in `Quote` (`dehyphenate`, "Show all"), page label `p. 2` from the PageSelector. The ask is NOT shown for the first turn, no time, no `¶`. | none: the ask is the thread's first user message (`ai_messages` ordinal 0, verified: "Explain this passage."); time = `created_at` | #202, #201, #203 |
| 04 | The ask is stored with each exchange (passage AND question) | partial | Passage: `ai_threads.origin_anchor_json` (one per thread, verified full Anchor with 6 selectors). Question: `ai_messages` role `user` content (verified, ordinal 0 and 2). BUT a **follow-up carries no passage of its own**: `FollowUp` is `{question, retry_of}` only (`schemas.py:636-641`), and the follow-up route rebuilds the seed from the thread's origin (`threads.py` follow_up). A new selection always starts a new thread. That matches frame 04's second call slip (plain question, no tab). | none unless a follow-up should be able to carry a new passage (then `FollowUp.anchor` + `ai_messages.anchor_json`, see B4) | #202, #201, #203 |
| 04 | Exchanges named by their asks | wrong | Thread title = the selected passage truncated to 80 chars (`threads.py:_title`, stored `title` = "We propose a new simple network architecture, the Transformer, based solely on…"); the ask is not in the thread list payload. | Option: add `ask` (first user message, 120 chars) to `Thread` wire (B3) | #202, #201, #203 |
| 04 | AI slip: M3.1 Flash · from the paper | partial | See 00: model on the wire (`run.model` = "MiniMax-M3.1-Flash-Preview"), not displayed; "from the paper" has no source. | none | #202, #201, #203 |
| 04 | Answer paragraphs with numbered markers; each marker numbered by passage | missing | Chips are per citation row with `marker` = the run handle ("b6"), `ordinal` = order within the message. The stored answer's handles b1, b6, b7, b8 map to design markers 1, 2, 3, 4 **exactly** by first use (verified against frame 04 text). Handles are thread-stable (`ai_run_handles`, inherited via `thread_handles`), so thread-wide numbering is derivable; the second answer in the stored thread cites b6 first and the design shows it as marker 2, which is what thread-wide numbering gives. | none (B1) | #202, #201, #203 |
| 04 | Margin page tabs `p. 2 ¶2` beside each claim | missing | No margin; `p. N` inline. `¶` needs a per-page paragraph index (B1: derivable but fragile, see Risks). | none (B1) | #202, #201, #203 |
| 04 | "NO CITATION · THE AI'S OWN READING" block | missing | See 00. | none (B2) | #202, #201, #203 |
| 04 | Usage line `6,776 tokens · ≈ $0.0027 (estimate) · first text after 2.4 s` | partial | Tokens and cost exist; "first text after N s" is missing in UI. The data is on the wire (`run.first_text_ms` = 2358 for the stored answer, verified), but `formatUsage` (`AnswerView.tsx:15-29`) ignores it. Also tokens = in + out (6,286 + 490 = 6,776, matches the design). | none | #202, #201, #203 |
| 04 | Actions under the answer: Dive in / Explain with a diagram / Send to board | partial | Only "Send to canvas". No "Dive in" (no notebook feature in the app: `grep -i "dive in\|notebook"` finds nothing in `apps/web/src`), no "Explain with a diagram". | Dive in = notebook (other agent); diagram = new run kind (see 07) | #202, #201, #203 |
| 04 | Trace: "Stands on 4 passages · 11 citations · 1 paragraph uncited" | missing | Not rendered. Derivable from the stored answer: 11 `[bN]` occurrences (regex = `MARKER_PATTERN` in `contract.ts`), 4 distinct handles, 5 paragraphs split on blank lines, the 5th without a marker (checked by script, equals the frame). | none (B2) | #202, #201, #203 |
| 04 | Trace rows: number, tab, section name, "cited 5x", quote excerpt, "Show in paper" | partial | Data exists: the citation `anchor` has a TextQuoteSelector and a `SectionPathSelector` with `path: ["Introduction"]` (verified on all 4 citations). No trace list UI; chips do the "show in paper" action (`onCite` -> `focusAnchor(..., {flash:true})`, `index.tsx`), and it flashes (checked in the live app). | none (B1/B2) | #202, #201, #203 |
| 04 | Trace row lit with its marker; the other way round | missing | Needs the trace list. | none | #202, #201, #203 |
| 04 | Margin tab "from marker 2 in the answer" beside the flashed passage in the paper | missing | The flash exists (`.pt-flash`, 1,200 ms, SVG rect over the page) but carries no label or margin tab (`styles.css:1158-1180`). | none | #202, #201, #203 |
| 04 | Citation flash timing (scroll 240 → in 180 → hold 900 → out 600, faint outline stays) | partial | Measured in the live app after a chip click: opacity 0.76 at 100 ms, 1.0 at 400 ms, 0.38 at 1,000 ms, gone by 1,500 ms. v0.1 is a single 1,200 ms ease-out ending at 0; no persistent faint outline. | none | #202, #201, #203 |
| 04 | Streaming second ask shown live, `Reading the paper…` + Stop | exists | Status labels "Thinking", "Reading the paper" (`useExplainActions.ts:658-659`), Stop button in the composer (`index.tsx`), observed in `shots/04b-streaming-current.png`. Placement differs (Stop in the composer, not on the AI tab row). | none | #202, #201, #203 |
| 04 | Composer with "M" initial: "Ask a follow-up, or any question about the paper" + oxblood Ask | partial | Same placeholder text (`index.tsx`, `pt-explain__input`). No initial, not Courier; the text is cleared as soon as it is sent (`index.tsx:108`), which conflicts with 04c's "your text is kept". | none | #202, #201, #203 |
| 04 | Selection toolbar: Explain / Ask / Highlight + five washes / Send to board, in the margin or docked at the top, never over the lines | wrong | Float toolbar: Highlight, "⊙ Ask", Canvas, Copy (`SelectionToolbar.tsx:125`). It is placed ABOVE the selection and covers the paragraph above (`shots/04-selection-toolbar-current.png`: the bar sits on the lines of the previous paragraph). No separate Explain vs Ask (Ask = explain with "Explain this passage."; `ThreadCreate.question` default). Five washes exist as data (`HIGHLIGHT_COLORS` amber, green, blue, pink, purple; API `HighlightColor`) but are picked after the fact in the highlight card, not in the toolbar. | none (the five colours are already accepted by `POST /papers/{id}/highlights`) | #202, #201, #203 |
| 04 | Page edge "fold · 900" ruler | n/a | A review annotation of the mock, not a feature. | none | #202, #201, #203 |

## Frame 04b: streaming

Current: `shots/04b-streaming-before-text-current.png`, `shots/04b-streaming-current.png`.

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 04b | Status label while streaming ("Reading the paper…", dotted pulse) | exists | `StatusLine` (`AnswerView.tsx`), labels from `useExplainActions.ts:655-662`; seen at 250 ms ("Thinking…") in the live app. | none | #204 |
| 04b | Stop on the AI tab row; Stop turns into Retry | partial | Stop lives in the composer row (replaces Ask); Retry exists after Stop (`AnswerView.tsx:160-170`). | none | #204 |
| 04b | Markers appear in the live text as the claim finishes | partial | While streaming, citations are stripped (`RichText.tsx:75`: `if (ctx.streaming) ... node.after`) and chips appear only when the run is done. Design 04 (bottom) shows a marker `[2]` appearing mid-stream with its tab. | agent stream: needs an event per citation or the client can parse `[bN]` on the fly (no server change if the handle-to-passage map is already known: it is not; it is minted on `done`/persist). Backend: emit a `cite` SSE event as each handle resolves (see B5) | #204 |
| 04b | Text cursor (typed caret) at the end of the stream | missing | No caret element (`AnswerView`). | none | #204 |

## Frame 04c: stopped and budget states

Current: `shots/04c-stopped-current.png`, `shots/04c-stopped-before-text-current.png`, `shots/04c-error-current.png`.

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 04c-1 | "Stopped. The part that arrived is kept." + Retry + tokens | wrong | Copy is "Stopped. The partial answer is kept above." (`AnswerView.tsx:150`); the Retry button exists. No usage line after Stop (the stopped message is not given usage in the UI; the server persists usage for aborted runs: NOT CONFIRMED). The trace "Stands on 2 passages · 3 citations" after Stop is not rendered. After Stop the client re-fetches the thread after 900 ms to pick up the stored citations (`useExplainActions.ts:430-460`), so citations exist. | none | #204 |
| 04c-1 | Stop before any text (v0.1 defect "kept above" with nothing above) | wrong (still present) | The note renders on `message.stopped` with no `hasText` check (`AnswerView.tsx:148`). Reproducing "no text yet" in FAUX was not possible (`[faux:stall]` emits 3 deltas before stalling). Code reading only: NOT CONFIRMED live. | none | #204 |
| 04c-2 | Budget refusal card: "Daily spend cap reached", "≈ $0.97 of $1.00 used in the last 24 hours (estimate).", "Your question was not sent; your text is kept in the box below.", "Change the daily cap", "See today's usage" | partial | The figures line exists with the exact wording (`BudgetDetail`, `AnswerView.tsx:46-62`, fed by `GET /usage`: `cost_usd_est`, `budget_usd`). Headline is "You've used today's AI budget." (`errors.ts:33`); the body says "Reading, highlighting and the canvas are not affected" (fine). NOT shown: "Your question was not sent / text kept" (the text is cleared on send, `index.tsx:108`); no "NOT SENT" stamp; no "Change the daily cap" and no "See today's usage" link. Not reproduced live (would need $1.00 spend): code only. | **Change the daily cap needs backend**: today the cap is a server env var (`PAPERTREE_DAILY_BUDGET_USD`, `settings.py:144`), not a per-user setting; `GET /usage` returns `budget_usd` read-only. See B6 | #204 |
| 04c-2 | Collapsed first answer: "4 passages · 11 citations … Show" | missing | No collapse/summary of earlier answers. | none | #204 |
| 04c | Error copy for other failures (overloaded, timeout, auth, ...) | exists | `errors.ts` has a sentence + next step for every code (`FailureNote`), each with Retry where retryable. | none | #204 |

## Frame 04d: summary

Current: `shots/04d-summary-current.png`.

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 04d | Summary view with "cached" badge and "Summary of the whole paper, cached · 15 Oct" slip | partial | Summary view exists (`SummaryView.tsx`, "Summarize paper" / "Back to conversation"), and the cached summary renders straight from `GET /papers/{id}/summary` (state `ready`, `created_at` 2026-10-15T17:14:41Z, `model` MiniMax-M3: verified). No "cached" badge, no date, no call slip. | none (all fields are on `Summary`) | #204 |
| 04d | 8 bullets with citations; "not verified" on bullets | partial | API: 8 bullets, `supported` false on 3 (verified), citations per bullet (1 or 2). UI shows chips per citation with "not verified" and dashed outline (`shots/04d-summary-current.png`), matching the design intent but as v0.1 pills. Design says "3 bullets not verified", the API's bullet-level `supported` yields 3: consistent. | none | #204 |
| 04d | Footer "Cached 15 Oct · no new tokens used · made with M3" + Dive in / Send to board / Summarise again | partial | "Regenerate summary" exists; "no new tokens used" has no source in the UI (a cached read costs nothing, true by construction: `summary.py` returns the stored derivation); Dive in missing. | none | #204 |
| 04d | Trace "Stands on 6 pages · 8 bullets · 10 citations · 3 bullets not verified" (rows grouped by page, with section names and "1 not verified") | missing | Not rendered. API returns 11 citations over 8 bullets in this summary (counting per bullet: 1+1+1+1+1+2+2+2); the design's "10" may be distinct-citation dedupe: **mismatch to resolve** (design says 10, data says 11 occurrences). Section names derivable from `SectionPathSelector`. | none | #204 |
| 04d | Same marker numbers as the Explain answer for the same passage | missing | Summary citations are minted per run (`ai_citations` for the summary derivation), their handles are not shared with the explain thread. Numbers can be assigned per surface (first use), but "the same passage keeps the same number in every later surface" (ADR-004 §2.6) needs a key: a passage's identity is its resolved block + generation. The summary's anchors have BlockSelector blockIds, so identity is computable. | none (B1) | #204 |

## Frames 07a-07d: AI diagrams (the engraved plate)

Nothing exists. Evidence of absence: `grep -ril diagram` across the repo (excluding `archive/`, `node_modules`) finds only `research/` documents; no hit in `apps/`, `packages/`, `services/`, `infrastructure/`, `contracts/`. The only run kinds are `explain | ask | summary` in four places: SQL (`0005_reader_release.sql:188` for threads, `:238` for `ai_runs.kind`), the agent (`services/agent/src/contract.ts` `Kind`, `PromptVersion`, `PROMPT_FOR_KIND`), the SSE event names (`services/agent/src/sse.ts:9`, `'run' | 'status' | 'text' | 'usage' | 'done'`, and `contracts/agent/run-events.schema.json:9`), and the API (`agent_client.py:92-94` `RunKind`, `PROMPT_VERSIONS`, `CODE_PATHS`, `LIMITS`; `schemas.py` `ThreadKind`). No screenshot of the current app is possible; the closest current state is `shots/04-selection-toolbar-current.png` (no "Explain with a diagram" action).

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 07a | Toolbar action "Explain with a diagram" (docked at the top of the column) | missing | `SelectionToolbar.tsx` has no such action. | none server-side for the button; the run is below | #217, #216 |
| 07a | Ask slip "Explain with a diagram" with the selected passage tab and time | missing | Would be an exchange whose ask text is the fixed question; the thread model supports it if `kind` allows (see B7). | thread kind `diagram` or a per-message kind | #217, #216 |
| 07a | Empty plate with the dashed "PLATE 1" placeholder, "Thinking…", Stop | missing | No plate component. | none | #217, #216 |
| 07b | Streaming parts: each part placed as it arrives, last part ghosted "arriving…", "3 parts so far · 3 cited", Stop freezes the plate | missing | Needs a streaming part event and a client slot grid (ADR-004 §2.9). | new SSE event `diagram` (B7) | #217, #216 |
| 07c | Done plate: lettered rows A-F, boxed parts, hatched edges, cited quote per part with marker + page tab, "6 parts · 6 cited · drawn by AI from pp. 3-4" | missing | No renderer. Reader data is ready: quote resolving uses the existing `evidence` lexical checker (`evidence.py:523-533` `claim_supported`) which already yields supported/neutral/unsupported for claims; for a diagram the check is "does the verbatim quote occur in the passage" (a stricter, simpler test, to be written). | quote resolver in `evidence.py` (B7) | #217, #216 |
| 07c | Tapping a part flashes its passage | missing (reusable) | `focusAnchor(anchor, {flash:true})` exists and works (measured). | none | #217, #216 |
| 07c | Inferred parts dashed, "Inferred, no passage"; readout "7 parts · 6 cited" | missing | Needs `cite: null` in the spec and a count in the readout. | spec field (B7) | #217, #216 |
| 07c | Send to board / Add to notebook / Redraw | missing | `sendToCanvas({kind:'explanation', messageId})` exists for answers (`actions.ts`) but its node kinds are `excerpt | explanation | note | group` (`schemas.py` NodeKind); a plate needs a new node kind. Notebook does not exist. Redraw = a new run on the same thread (`retry_of` exists, but only for unfinished answers: `_retry_target` raises 422 otherwise). | new canvas node kind `diagram`; relax `retry_of` or add `regenerate_of` (B7) | #217, #216 |
| 07c | Usage line "3,982 tokens · ≈ $0.0016 (estimate)" and the daily cap shared with other runs | missing | The usage machinery generalises: `ai_runs` has all the columns, `require_budget` and `RUN_RESERVE_USD[kind]` (keyed by kind, so a new kind needs a reserve) (`agent_client.py:890-908`). | `RUN_RESERVE_USD["diagram"]`, `LIMITS["diagram"]` (B7) | #217, #216 |
| 07d | Offer card "Make a crafted figure" (optional, slow, queue/not now) | missing | Out of scope for the job itself; the OFFER card needs only copy + a `jobs` row kind later. The `jobs` table exists (`0002_jobs.sql`) but is the parse queue. | none for the card; "Queue the job" is out of scope | #217 |
| 07d | Queued / Ready states | missing | Out of scope. | out of scope | #217 |

## Frame 08b: phone reader, 390

Current: `shots/08b-phone-reader-closed-current.png`, `shots/08b-phone-guided-current.png`, `shots/08b-phone-reader-current.png` (sheet with an answer).

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 08b | Phone header: back arrow, title, "p. 2", menu icon | partial | Header is back arrow, "Contents 1", the title (truncated to "Attention Is ..."), "Canvas" (`shots/08b-phone-reader-closed-current.png`). No page number, no menu. | none | #205 |
| 08b | Bottom sheet over a peek of the page | exists | `Sheet` below 768 px with detents (`explain/index.tsx` `Sheet`, `onCite` lowers it to `peek` so the flashed passage is visible). Seen in `shots/08b-phone-reader-current.png`. Grab handle present. | none | #205 |
| 08b | Sheet header: "Explain", "Thread 1 of 2" dropdown, close | partial | "Explain" + "Dismiss" (✕). No thread menu. | B3 | #205 |
| 08b | Call slip quote on two lines + tab `p. 1 ¶1` | partial | `Quote` shows the quote with "p. 2"; truncation by words, not two lines. | none | #205 |
| 08b | AI slip clipped to a first paragraph with "Read the whole answer" | missing | The whole answer is shown; no clamp/expand. | none | #205 |
| 08b | Trace rows as 44 px buttons (number, tab, excerpt, chevron) | missing | No trace. Existing chips are 107 x 28 px (measured with `getBoundingClientRect` at 390: `107x28`); the phone's other buttons: Source/Guided/Split are 54 x 44; "Contents" 101 x 40; "Ask AI" 68 x 40. | none | #205 |
| 08b | 44 px marker targets | wrong | Chips 28 px high. Design markers are small numerals with a 44 px hit area. | none | #205 |
| 08b | Pinned footer: usage, Dive in / Diagram / To board, follow-up box | partial | Composer is pinned at the bottom ("Ask a follow-up…" + Ask). Usage, Dive in, Diagram, To board are in the scrolling answer area (usage + "Send to canvas"), not pinned. | none | #205 |
| 08b | Zoom restore at 390 (v0.1 defect #175) | NOT CONFIRMED | Not tested (needs a zoom change, reload, compare). `Fit width` is a `<select>` at 390 (`08b-phone-reader-closed-current.png`). | none | #205 |
| 08b | "Ask AI" floating button overlapping text in Guided at 390 | wrong (still present) | `shots/08b-phone-guided-current.png`: the blue "Ask AI" button sits over the paragraph text in Guided mode ("Google Research" row). | none | #205 |

## Frame 09b: reader, lamp-lit (dark)

Current: `shots/09b-reader-other-current-dark.png`.

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 09b | Dark scheme for the reader chrome and the explain panel | partial | `prefers-color-scheme: dark` darkens the chrome and panel (observed). Surfaces are flat dark greys with a purple AI block, not the walnut/lamp palette. | none | #205 |
| 09b | Paper page dimmed to warm ivory ("lamp-lit"), not white | missing | The PDF page stays pure white in dark mode (`shots/09b-reader-other-current-dark.png`); the design page is `#E8E0CC`-like. Needs a CSS filter or canvas tint on the pdf.js page layer. | none | #205 |
| 09b | Typed voice in blue on dark ("Explain this passage" in blue Courier), AI slip on dark brown, tabs as gold ribbons | missing | Same gaps as 00, in dark. | none | #205 |
| 09b | Selected passage highlight in dark (blue-grey wash) and the flash ring in a lighter navy | NOT CONFIRMED | Not tested in dark. | none | #205 |

## Frame 13: ask → answer → trace, three ways (option 1 is the default)

No current-app counterpart; see Frame 04. Option 1 (call slip, answer, trace) is the chosen default.

| Frame | Feature | Status | Evidence | Backend needed | Issue |
|---|---|---|---|---|---|
| 13 | Option 1 as the default layout | missing | See 04. | none beyond B1-B3 | #202 |
| 13 | "¶4 folded · 4 citations" (long answers fold after the third paragraph) | missing | Whole answers always shown. Counts derive from the same paragraph split as B2. | none | #202 |
| 13 | Option 2 (sidenotes) / Option 3 (claim → evidence pairs) kept switchable behind one component | missing | Not built; ADR-004 §2.6 says one layout behind a small interface. Option 3 needs the quote text per citation (anchor TextQuoteSelector: present) and the claim sentence boundary (client split on `[bN]`: present in `RichText` parse). | none | #202 |

## Prototype steps (frame 12-prototype): 5 Read, 6 select a sentence, 7 Explain, 8 marker 2 lights passage 2 on p. 2

| Step | Feature | Status | Evidence | Backend needed |
|---|---|---|---|---|
| 5 | Read: reader opens with the topic cloth/book context and the "Reading now" strip | NOT CONFIRMED | Belongs to A1 (shelf). The reader itself opens at `/paper/<id>/read` (works). | none |
| 6 | Select a sentence: toolbar appears | partial | Works (real mouse drag), but the bar is the v0.1 one and covers preceding lines (`shots/04-selection-toolbar-current.png`). | none |
| 7 | Explain: panel opens with the call slip, streams the answer | partial | Ask opens the drawer and streams (`shots/04b-streaming-current.png`); no slip, no numbered markers, no trace. | B1-B3 |
| 8 | Marker 2 lights passage 2 on p. 2, with the margin tab "from marker 2 in the answer" | partial | Clicking a chip scrolls and flashes the passage (1,200 ms, measured) in the live app; no marker numbers, no margin tab, no lit marker or lit trace row. `shots/prototype-step8-chip-flash-current.png`. | none |

## Backend designs needed

Repo rules applied: user-owned rows store an `Anchor` (`@papertree/anchoring`, Python twin `papertree_anchoring`), never a bare `block_id` (a `block_id` column is allowed only as a hint, like `ai_citations.block_id`); every FK between owned tables includes `owner_id` (0001 rule, see `0005_reader_release.sql`); migrations are forward-only, one transaction, statements separated by `--;;`, tables `STRICT`. SQLite cannot alter a `CHECK`, so changing a `kind` list means the rebuild pattern 0005 itself uses (`..._new`, copy, drop, rename; see `highlights_new`).

Test paper for all of it: **"Attention Is All You Need"** (`ppr_G9AYN750E5MG1NRBMGSQJ4N5JM`, generation 1, parser 1.0.0, 546 blocks, 15 pages), with its stored thread `thr_01M508X9PC9K9HKHSVB2J9W1A1` as the golden fixture for numbering/coverage: expected passage numbers b1→1, b6→2, b7→3, b8→4; 11 citations; 5 paragraphs, 1 uncited; trace "cited 5x / once / 2x / 3x". The 04d numbers use the stored summary (8 bullets, 3 `supported=false`). For diagrams use the same paper's p. 4 section 3.2.1 (the frames' own example), plus DDPM (`ppr_8R49S8PQEX6TW0XSX9ZBHS0KV6`, 25 pages, equation-heavy) as the stress case.

### B1. Passage numbers and the "p. 2 ¶2" locator (no migration)

- **Need:** markers numbered by passage, thread-wide and surface-wide; `¶` per page; section name per trace row.
- **Derivable today:** yes for numbers and sections. Passage identity inside a thread = the run handle (`ai_run_handles` makes `handle → block_id` stable across a thread's runs: `threads.py` follow_up inherits `thread_handles`); across surfaces (explain vs summary vs diagram) identity = `(generation, BlockSelector.blockId)` of the citation anchor, which the stored citation anchors carry (verified). Number = index of first use in reading order of the thread, then summary, then diagram.
- **Where to compute:** one pure function, tested against the golden fixture. Prefer the API so every client (web, notebook, board card) agrees. Add to the `Citation` wire an optional, derived `locator`:
  `locator: { passage_key: string, page_index: int, para_index: int | null, section_path: string[], section_heading: string | null }`
  built in `evidence.py` from the loaded index (already loaded per request: `evidence.load_index`). `para_index` = 1-based position among blocks of that page with `flow == 'body'` and `type in ('paragraph','abstract')` ordered by `order` (heading and caption excluded). No schema change (not stored, so it survives re-parses; stored anchors stay the only user-owned truth).
- **Defect to handle in the rule:** page 1 of the test paper starts with a misparsed paragraph ("Provided proper attribution is provided...", `type=paragraph`, `order 0`) before the abstract, so the abstract becomes `¶2`, while the design says `p. 1 ¶1`. And on page 2 "Model Architecture" is typed `paragraph` (a heading mis-typed). The locator therefore needs either a documented tolerance (show `¶` only when the block is a `paragraph`/`abstract`, and drop the number for the first page's front matter), or a fix in the parser's heading classification. See Risks.
- **Errors:** none (derived); `locator` null when the anchor has no resolvable block in the promoted generation (orphan).

### B2. Coverage readout and uncited paragraphs (no migration)

- **Wire:** add to `Message` (assistant, complete or partial): 
  `coverage: { passages: int, citations: int, paragraphs: int, uncited_paragraph_indexes: int[], not_verified: int }`.
- **Rule:** split `content` on blank lines; `citations` = count of `MARKER_PATTERN` occurrences (`[b1]` and `[b1, b8]` each count per handle), `passages` = distinct handles, `uncited` = paragraphs with no marker. Skip pure headings/list lead-ins (a paragraph that is only a Markdown heading). Verified on the stored answer: 11 / 4 / 5 / uncited = [4]. The summary equivalent is `bullets`, `bullets not verified` = `supported=false` bullets.
- **"The AI's own reading" label:** shown by the client for every uncited paragraph (product truth: uncited AI prose is always labelled), independent of what the model wrote. The prompt line ("This is my reading, not the paper's claim.") stays as belt and braces; do not parse it.
- **Errors:** none.

### B3. Thread list that can drive "Thread 1 of 2" and "exchanges named by their asks"

- `GET /papers/{paper_id}/threads` → `Thread[]` today: `{thread_id, kind, title, origin_anchor, created_at, updated_at, message_count}`. Add `ask: string` (first user message content, truncated to 160 chars), `last_status` (`complete|partial|error|aborted|streaming` of the last assistant message) and `kind` stays. Order by `created_at` ascending so "n of N" is stable; today `list_threads` orders by `updated_at DESC, thread_id DESC` (`papertree_db/ai.py:347`), so a follow-up reshuffles the thread numbers: either change the order or add `created_at` ordering for the menu.
- No migration: `ask` is a join on `ai_messages` (`ordinal = 0`, role `user`). Optional: stop truncating `title` to the passage; keep as is, add `ask` instead.
- Panel behaviour: opening the panel on a paper with stored threads loads the list and selects the newest; `GET /papers/{id}/threads/{tid}` already returns full messages + citations + run summary (verified).
- Errors: 404 `not_found` as today.

### B4. (Optional) A follow-up that carries its own passage

Design does not need it (the second slip in frame 04 has no tab). If wanted: `FollowUp.anchor: AnchorV1In | None` (`schemas.py:636`), checked with `check_anchor`, stored on the user message: migration `ALTER TABLE ai_messages ADD COLUMN anchor_json TEXT CHECK (anchor_json IS NULL OR json_valid(anchor_json))` and `evidence.plan_seed` called on it, handles assigned like the origin's. Stored as an Anchor, not a block id.

### B5. Live markers while streaming (04b bottom)

- Today markers are stripped during the stream and appear after `done` (`RichText.tsx:75`). To show marker `[2]` with its tab mid-stream the API broker (which already parses `[bN]` for persistence) should emit an SSE `citation` event `{message_id, ordinal, marker, citation_id, page_index, locator, supported: null}` as soon as a handle is complete and resolvable. Contract: add to §2.6 (`schemas.py` `Sse*` models) and `contracts/api`; the agent contract is unchanged (it streams `text` only). Cheap alternative: client parses `[bN]` as it streams and shows a numbered marker without a tab, then fills in on `done`. Recommended for v0.2 first cut.

### B6. Daily cap that the person can change (04c-2)

- Today: env `PAPERTREE_DAILY_BUDGET_USD` (`settings.py:98,144`), read-only through `GET /usage` (`budget_usd`).
- Migration (new `0006_*.sql`): 
  ```sql
  CREATE TABLE user_settings (
    owner_id TEXT PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
    daily_budget_usd REAL CHECK (daily_budget_usd IS NULL OR daily_budget_usd > 0),
    updated_at TEXT NOT NULL
  ) STRICT;
  ```
- API: `GET /me/settings` → `{daily_budget_usd: number | null, daily_budget_max_usd: number}`; `PUT /me/settings` `{daily_budget_usd: number | null}` → 200 same shape; 422 `validation_failed` when above the server ceiling (new env `PAPERTREE_DAILY_BUDGET_MAX_USD`); `require_budget` (`agent_client.py:890`) uses `min(user value, ceiling)` else the env default; `GET /usage` returns the effective `budget_usd`.
- "Your question was not sent; your text is kept": client-only (do not clear the composer until the run is accepted; the 429 comes before any row is written, `threads.py` docstring) plus a `not_sent` stamp state.

### B7. The `diagram` run kind (07a-07c)

**Contract and prompt (agent, TypeScript).** `services/agent/src/contract.ts`: `Kind` and `PromptVersion` add `'diagram'` / `'diagram-v1'`, `PROMPT_FOR_KIND.diagram = 'diagram-v1'`; `contracts/agent/run-request.schema.json` kind enum + the if/then (a diagram run requires a seed). `services/agent/src/prompts.ts`: a `diagram-v1` TASK and rules (NDJSON lines `plate`, `part`, `link`, `end`; quote verbatim or `null`; ≤ 12 parts; the stored model rule "Ground every statement ... only in passages" stays). The packages/prompts Python package is NOT the place (it only has `sanitise`, `untrusted`, `channels`); only the datamark/untrusted helpers live there and are reused through the API.
**Streaming parts.** `services/agent/src/sse.ts` `AgentEventName` adds `'part'` (and the contract `run-events.schema.json`): `event: part` `{letter, label, text, kind, after: string[], edge?: string[], cite: {quote, page?} | null}`; `event: plate` `{title}`. `run.ts` splits text deltas on `\n`, `JSON.parse` + `zod` validate per line, skips bad lines with a `status` frame (R3 doc's Q1 proposal, which I read and agree with; its zod schema is the contract). Faux: add `[faux:diagram]` to `faux.ts:443-470` scenarios (and one `[faux:diagram-bad]` with a broken line) so e2e can run without a key. The model emitting strict NDJSON is NOT CONFIRMED (no live model call here).
**API.**
- `RunKind` (`agent_client.py:92`), `PROMPT_VERSIONS`, `CODE_PATHS`, `LIMITS["diagram"]` (deadline ~90 s, max output ~2,000 tokens, tools allowed only `get_passage`/`get_section`), `RUN_RESERVE_USD["diagram"]` (so the daily cap and the reservation logic apply).
- `POST /papers/{paper_id}/threads` body `{kind: "diagram", anchor, question?: "Explain with a diagram."}` → SSE `run`, `status`, `part`*, `plate`, `usage`, `done` (same pre-stream errors as explain: 404, 409 `not_parsed`/`busy`, 422 `anchor_mismatch`, 429 `budget_exhausted`, 503). Resolution of each `cite.quote` to an Anchor happens in the API broker (it owns `evidence.py`): found verbatim → anchor + `supported=true`; present with differences → anchor + `supported=false` ("not verified"); `cite: null` → no anchor ("inferred"). The SSE `part` the browser sees carries `cite: {citation_id, anchor, locator, supported} | null`.
- Redraw: `POST /papers/{id}/threads/{tid}/messages` with `{question, redraw_of: "msg_..."}` (new field next to `retry_of`, `schemas.py:641`; `_retry_target` currently rejects completed answers, so do not reuse `retry_of`).
- Read: `GET /papers/{id}/threads/{tid}` returns, for a diagram message, `diagram: {title, parts: [...], status}` (messages stay `role/content/status/run/citations`; `content` holds the raw NDJSON so nothing is lost).
**Migration (new `0006_*.sql`; rebuild pattern).**
```sql
-- 1. widen two CHECKs by rebuilding ai_threads and ai_runs (kind adds 'diagram'); copy rows, drop, rename,
--    recreate ai_threads_by_paper / ai_runs_by_owner. All FKs keep (owner_id, ...) pairs as in 0005.
CREATE TABLE ai_diagram_parts (
  part_id      TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  message_id   TEXT NOT NULL,
  letter       TEXT NOT NULL CHECK (letter GLOB '[A-L]'),
  ordinal      INTEGER NOT NULL CHECK (ordinal >= 0),
  label        TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  part_kind    TEXT NOT NULL CHECK (part_kind IN ('input','step','output','concept')),
  after_json   TEXT NOT NULL CHECK (json_valid(after_json) AND json_type(after_json) = 'array'),
  cite_quote   TEXT,                                   -- the model's quote, kept to show "not verified"
  anchor_json  TEXT CHECK (anchor_json IS NULL OR json_valid(anchor_json)),   -- NULL = inferred or unresolved
  supported    INTEGER CHECK (supported IS NULL OR supported IN (0, 1)),
  generation   INTEGER NOT NULL,
  block_id     TEXT,                                   -- hint only; never an FK
  page_index   INTEGER CHECK (page_index IS NULL OR page_index >= 0),
  UNIQUE (owner_id, part_id),
  UNIQUE (message_id, letter),
  FOREIGN KEY (owner_id, message_id) REFERENCES ai_messages (owner_id, message_id) ON DELETE CASCADE
) STRICT;
```
Plate title and `link` lines go in a `diagram_json` column on the message (add `ALTER TABLE ai_messages ADD COLUMN diagram_json TEXT CHECK (diagram_json IS NULL OR json_valid(diagram_json))`) or the run row's `tool_calls_json` neighbour; the rows above are the user-owned citations, anchors only.
**Board.** `NodeKind` (`schemas.py:744`) adds `diagram`; canvas node payload `{message_id}`; "Send to board" reuses `sendToCanvas`.
**Tests:** `[faux:diagram]` through the API with the Attention paper, asserting 6 parts, letters A-F, parts with `after` only on earlier letters, a `cite: null` part with `anchor_json IS NULL`, the daily cap refusing a diagram run, Stop leaving the plate frozen with `status partial`.

## v0.1 defects in my area (#175, #176, #177, #179)

Status words here: **still present / removed by the new design / fixed / NOT CONFIRMED**. "Removed by the design" means the drawn design no longer has the thing; it is still present in the running app until the new UI ships.

| Defect | Status | Evidence |
|---|---|---|
| 390 px zoom restore | NOT CONFIRMED | Not exercised. At 390 the zoom control is a native `<select>` showing "Fit width" (`shots/08b-phone-reader-closed-current.png`); the design (08b) drops the zoom control from the phone header, which would remove the surface. |
| Guided figure crop includes the caption | NOT CONFIRMED (code partly fixed) | `guidedFigures.ts` (RFIX2 R9) dedupes whole-crop vs panels and one caption per card. Whether the crop image itself still includes the caption text is a pixel question not tested. The design's own figure placeholder reads "Figure 1 · page image" with the caption set below it, i.e. the design wants the crop without caption. |
| Contents outline: raw block-type labels | still present | `Navigator.tsx:652` prints `{leaf.type}` for front-matter and "outside the section tree" leaves. |
| Contents: "Belongs to no section" | still present | `Navigator.tsx:570` note text. (Frame 02 for the Contents is A1's, not drawn in my frames.) |
| Highlight card not openable by mouse | likely still present | `HighlightOverlay.tsx` documents "NOT A POINTER TARGET" (the layer is `pointer-events: none`, line ~22/126), so the card opens by keyboard only; the live click was not tried. NOT CONFIRMED live. |
| "Ask AI" button overlaps text at 390 | still present | `shots/08b-phone-guided-current.png`. Removed by design (the Explain tab/pinned sheet replace the floating button). |
| Guided strip ("Reflowed from the PDF" band) wraps at 390 | still present (mild) | Two-column strip with 2-line text each (`shots/08b-phone-guided-current.png`). |
| "kept above" after Stop before any text | still present (code) | `AnswerView.tsx:148-151` shows the note regardless of text. Design copy changes the sentence ("Stopped. The part that arrived is kept.") but the design still needs a no-text variant ("Stopped before anything arrived."). Not reproduced live. |
| "p. 3 p. 3 p. 3" chips | still present; removed by the new design | `RichText.tsx:74-96` emits one chip per citation with no dedupe; numbered markers replace it (ADR-004 §2.6). |
| Highlight delete has no undo | still present | No undo path in `HighlightCard.tsx`/`useHighlights.ts` (grep "undo" finds nothing). Design: "Put it back" is in the interface-voice list (00-strip). Backend: soft delete or a `highlights` restore (not designed; a client-held tombstone for N seconds plus re-POST of the same Anchor is enough with the current API). |
| R2 highlight scroll | NOT CONFIRMED | Not tested. |
| Shift+click start | NOT CONFIRMED | `useSelectionCapture.ts` has no `shift` handling (grep); not tested live. |
| Cross-column selection | NOT CONFIRMED | Not tested (needs a two-column paper such as YOLO/ResNet). |
| `latexit` base64 in the text layer | NOT CONFIRMED | `/papers/{id}/blocks` for all four demo papers contains no block text with "latexit" (0 of 540/1013/825/546 blocks). It lives, if at all, in the PDF's own text layer (pdf.js), not in the IR; not tested. |

## Risks and surprises

1. **The paragraph number (`¶`) is not reliable on this parser.** On the test paper, page 1's first `paragraph` is the "Provided proper attribution ..." banner, so the abstract is `¶2`, not the design's `¶1`; on page 2 the heading "Model Architecture" is typed `paragraph` (frame 04's `¶4` for "In this work we propose..." happens to be right because the heading comes after it). Showing a wrong "¶" is a misattribution risk exactly where the product promises traceability. Either gate `¶` on block types with a confidence rule, or fix the parser's heading typing first (it is parser work, not UI).
2. **ADR-004 §2.9's prompt location is wrong** (`packages/prompts` is Python-only). Not harmful, but the S7 slice would start in the wrong directory.
3. **Summary vs explain numbering.** The design promises "the same passage keeps the same number in the answer, the trace and every later surface". The summary's citations are separate rows per run, so the key must be the anchor's resolved block, and that key changes if the paper is re-parsed (new generation). Numbers computed per view are safe; numbers stored anywhere would be a bug (store only anchors).
4. **Thread list reorders after a follow-up** (`ORDER BY updated_at DESC`), which would make "Thread 1 of 2" drift.
5. **The first ask is invisible today.** The default explain question "Explain this passage." is stored but never shown, so the new call slip is also a correctness fix for "what did I ask".
6. **Stored answers carry multi-handle citations** (`[b1, b8]` in answer 2 of the real thread). `MARKER_PATTERN` handles it; a per-claim marker row needs two numbers on one claim, which the design's single "p. 2 ¶2" tab does not draw (it shows two ribbons in one place, e.g. "1 p. 1 ¶1 / 4 p. 2 ¶4" in 04's last paragraph: fine, but the layout must allow it).
7. **"first text after 2.4 s" is data we already have** (`first_text_ms` 2,358 for the real answer) but it is the model's first delta of any kind per `run.ts`'s own comment ("the model's first delta of any kind", `run.ts:227`), which can be a thinking delta, not the first visible text. Label carefully or measure first `text` event.
8. **Daily cap is per server, not per person**; "Change the daily cap" in the budget card is a promise the backend cannot keep today (B6).
9. **Dark mode keeps the PDF page white.** The "lamp-lit" frame (09b) asks for a tinted page; any tint changes how highlights and the selection read, so it needs a pass on the overlay colours (`--pt-hl-*` are tuned for white).
10. **Design says "Board"; the app says "Canvas" everywhere**, including route `/paper/<id>/canvas` and API `canvas_*` tables. A rename is a product decision and touches e2e names (not backend breaking: wire strings can stay).
11. **Summary counts mismatch with the frame:** the stored summary yields 11 citations over 8 bullets; frame 04d reads "10 citations". Either the design's dedupe rule (same passage within one bullet) differs from the stored rows, or the mock is off by one. Decide the counting rule before building the readout.
