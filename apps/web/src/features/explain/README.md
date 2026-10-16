# explain

Ask → answer → trace in the reader's explain panel (#202, DESIGN.md §3–§4, ADR-004 §2.6). Every exchange is
a call slip (your ask), an AI slip (the answer, a numbered marker after each claim) and a numbered trace of
the passages it stands on, under a coverage line. A marker's number is its **passage** number: passages are
numbered 1..k in the order the thread first cites them, so marker 2 is the same passage in the answer, its
trace row and every later exchange of the thread.

## Data flow

UI (`components/ExplainPanel` → `ThreadView` → `Exchange`) → controller (`components/explain/useExplainActions`, a reducer holding the
live messages) + `hooks/useThreads` (react-query) → `api/threads` → `lib/api/threads` →
`GET /papers/{id}/threads` and `GET /papers/{id}/threads/{tid}` (`services/api` `routers/threads.py`) → DB
(`ai_threads`, `ai_messages`, `ai_citations`; each citation's `locator` and each answer's `coverage` are
derived on read from the parse, never stored).

- An empty panel opens on the newest stored thread (`opensOnNewest`); the thread menu orders threads by
  `created_at` ascending (`sortThreads`), because the API lists newest first and a follow-up must never
  renumber a thread.
- While an answer streams, the controller's live message is the truth. When it settles, `useThreads` reads
  the thread again and `mergeStored` replaces the live copy with the stored one (coverage, usage, times) under
  the same key: no duplicate, no remount. A live citation has no locator yet; its passage key mirrors the
  server's (`g{generation}:{block_id}`) or its handle finds it through the thread's other citations, so numbers
  never shift.
- **Markers and tabs never change under the reader (#252).** A marker appears as soon as its handle resolves:
  mid-stream for a passage the thread already cited (handles are stable across a thread's runs, so
  `PassageNumbers.handleCitations` finds `[b6]` before this answer's own citations arrive, #204), else when the
  answer settles (`done`). Its verdict is never borrowed (`supported: null` until its own citation lands). It
  carries the locator the thread already knows for its passage (`PassageNumbers.locatorOfKey`), else the page
  alone ("p. 4"). A partial handle at the end of a chunk (`[b`, `[b6, b`) is dropped, never shown. From then on they stay: when the stored copy lands, `mergeStored` keeps the live citations
  the markers were drawn from, so no marker is hidden, renumbered, remounted or re-tabbed, and a click at any
  moment reaches it. **The stored copy does not refine a tab that is already shown**: a finer "p. 4 ¶2" appears
  the next time the thread is opened (a fresh read). The same holds for this session's follow-ups: a passage
  first placed by an answer of this session shows the page and section ("p. 2", "Introduction") in every
  later exchange until the thread is reopened; only passages that stored (older) answers placed carry their
  "¶" at once. The stored copy does bring each citation's verdict: a citation it says is unsupported turns
  its marker and trace row to "not verified" (the honest direction; nothing else moves). An answer that showed
  no citations live (stopped before they arrived) takes the stored ones, shown once, in final form. Nothing is
  held. If the live and stored citation sets ever differ, a development build warns in the console.
- **A claim with no resolved citation is the AI's own reading.** A paragraph is cited only when one of its
  handles resolves; a `[b9]` the run never resolved draws no marker, so its paragraph goes under "no citation
  · the AI's own reading" and the readout counts it (DESIGN §4.6). The server's `uncited_paragraphs` counts
  any handle, so the client does not use it for this.
- **New thread** (owner may change): `startFresh()` empties the panel and keeps it from reopening on the
  newest thread, so the next free question starts a new thread. Explain on a selection always starts one.
- **A read that fails** (404, network) shows a designed failure with Try again and New thread
  (`ThreadReadFailure`), never a blank panel; a 404 is not retried and re-reads the list.
- **Streaming and Stop (#204, frames 04b/04c).** While it streams, the AI tab row shows the working label
  ("Starting…" before a word arrives, "Reading the paper…" or "Writing…", dotted pulse) and **Stop**, whose row
  is sticky in the panel's scroll so a long answer never scrolls it away; a typed caret ends the text (dots and
  caret hold still under reduced motion). After Stop, the slip's footer says "Stopped. The part that arrived is
  kept." (or "Stopped before any text arrived."), with Retry and the run's usage when it reported any; a stored
  `aborted` answer reads the same (`wasStopped`). Focus hands over Stop → Retry → Stop (`AnswerParts`), never
  to `<body>`. **Until the stopped answer's stored copy lands** (`awaitingStored`, about a second) it is drawn
  as while streaming: a paragraph citing a handle the thread has not seen yet is held as cited, and the trace
  and readout wait, so nothing is shown "uncited" and then moved. If that read never lands, the answer stays
  in this state (no trace) rather than guess.
- **Refusals before the stream (#204).** Only a documented pre-stream code on an error status counts
  (`refusedBeforeStream`; a 200 with an empty stream does not). A refused new ask is stamped "not sent" and its
  words go back into the composer, never over words typed since. **The composer's text is the controller's**
  (`state.draft`), so it survives the summary view and a closed panel, and the card says "your text is kept in
  the box below" only while the box still holds that question (`refusalSentence`). A refused **Retry** leaves
  the answer it would have replaced as it was, says "Your retry was not sent", never stamps the question that
  was sent, and keeps the note through the stored re-read until the reader's next ask or retry
  (`ThreadMessage.refusal`). The daily cap is `BudgetCard`: "Daily spend cap reached", the figures and today's
  usage by kind from `GET /usage`; "Change the daily cap" is left out until the app has a place for it (#256).
- **Folded answers (#204, owner may change).** A long thread (three exchanges or more) opens with its last two
  whole and earlier answers folded: two lines, "4 passages · 11 citations …" and Show (`opensFolded`, read once
  at mount, so nothing folds or gains a toggle under the reader). Retry on a folded answer unfolds it first.
- **Live markers after a re-parse.** Handles are stable within a thread's runs on one generation. After a
  re-parse the server keeps only handles whose block still exists and numbers new ones after them, so a handle
  can name a different block in the new run; until that run's citations land, a live marker could show the
  old passage's number. Rare (a re-parse during a thread), and corrected at `done`.
- **The summary as an exchange (#204, frame 04d).** `SummaryExchange`: the call slip "Summary of the whole
  paper" ("cached · 15 Oct" from `created_at`), the bullets on the AI slip with numbered markers and "not
  verified" tabs per bullet, the footer's facts ("Cached 15 Oct · no new tokens used · made with M3", or the
  new run's usage) with Summarise again, then "Stands on 7 passages on 6 pages · 8 bullets · 11 citations · 3
  bullets not verified" and the trace by page. A passage the open thread cited keeps its number: summary
  citations carry no locator (#257), so `buildSummary` keys them as the server keys passages
  (`g{generation}:{block id}`). A citation is one bullet citing one passage (the frame's 10 merged two blocks of
  p. 10). Dive in and Send to board wait for APIs that take a summary (#258).
- `buildExchanges` pairs asks and answers and builds each answer's paragraphs (the server's
  `answer_paragraphs` rule), markers, trace rows ("where · cited n×", the paper's words, "not verified" when
  `supported === false`) and coverage.

## On screen

- `components/ExplainPanel.tsx`: the drawer (≥ 768 px) or sheet; its header holds the thread menu, Summarize
  and Close. `components/ThreadView.tsx`: the thread as exchanges (or the summary) above the `Composer`.
- `components/Exchange.tsx`: THE layout of one exchange (frame 13 option 1, the owner's default; owner may
  change): `CallSlip` (stamped "not sent" when refused) → `AnswerSlip` (markers inline, marker + tab in the margin, the uncited run under "no
  citation · the AI's own reading") → `CoverageReadout` → `TraceList`. One component behind `ExchangeProps`,
  so the sidenote or claim → evidence options of frame 13 could replace it. A marker and its trace row light
  each other on hover and focus (120 ms); either one runs the citation flash.
- `components/ThreadMenu.tsx`: "‹ Thread 1 of 2 ›" and a listbox of the threads named by their asks, ending in
  "New thread" (owner may change). A switch keeps focus in the menu, never on the drawer.
- The citation flash is the reader's (`components/reader/flash.ts`, `ReaderWorkspace.focusAnchor`, `.pt-flash`),
  in phases: `scroll` (240 ms, only if the passage is off screen; nothing painted) → `flash`
  (`data-flash="true"`: in 180 → hold 900 → out 600) → `linger` (`data-flash="linger"`, a faint outline) until
  the next pointer press or key (capture phase). `components/FlashMarginTab.tsx` draws "from marker 2 in the
  answer" beside the passage in `flash` and `linger`. Guided mode does not have it yet (#245).
- `components/explain` keeps a thin re-export (`index.tsx`, the path `ReaderWorkspace` imports) and still owns
  the controller (`useExplainActions`), the summary's working and failed states (`SummaryView`) and `RichText`
  (the canvas cards use it); moving those into the feature is the next split.

## Key files

- `model/passages.ts`: passage keys and numbers, handle runs (`[b1, b8]` is two markers). Pure, tested on the
  golden thread (`test/fixtures/attention-thread.json`, frame 04's real stored thread).
- `model/exchange.ts` and `model/answer.ts`: the exchange and answer view models. `model/anchor.ts`: the
  typed selector lookup and display quotes. Pure, tested.
- `model/messages.ts`: the panel's message shape (`ThreadMessage`, the controller's `ViewMessage`), stored →
  panel, and the live + stored merge. Pure, tested.
- `model/states.ts`: the Stop note and its no-text rule, "not sent", the daily-cap figures and usage rows, the
  folded answer. Pure, tested (`states.spec.ts`).
- `model/summary.ts`: the summary's view model (numbers shared with the thread, the counting rule, the trace by
  page). Pure, tested on the real cached summary (`test/fixtures/attention-summary.json`).
- `model/threads.ts`: menu order, position, a stored thread's origin, the thread an empty panel opens on.
- `api/threads.ts`: query keys and fetchers. `hooks/useThreads.ts`: the reads, the open-on-newest, the merge.
