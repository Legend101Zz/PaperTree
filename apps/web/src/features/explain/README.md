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
- **Markers and tabs never change under the reader (#252).** Markers appear when the answer settles (`done`),
  each with the locator the thread already knows for its passage (`PassageNumbers.locatorOfKey`), else the page
  alone ("p. 4"). From then on they stay: when the stored copy lands, `mergeStored` keeps the live citations
  the markers were drawn from, so no marker is hidden, renumbered, remounted or re-tabbed, and a click at any
  moment reaches it. **The stored copy does not refine a tab that is already shown**: a finer "p. 4 ¶2" appears
  the next time the thread is opened (a fresh read). An answer that showed no citations live (stopped before
  they arrived) takes the stored ones, which are shown once, in final form. Nothing is held.
- **A claim with no resolved citation is the AI's own reading.** A paragraph is cited only when one of its
  handles resolves; a `[b9]` the run never resolved draws no marker, so its paragraph goes under "no citation
  · the AI's own reading" and the readout counts it (DESIGN §4.6). The server's `uncited_paragraphs` counts
  any handle, so the client does not use it for this.
- **New thread** (owner may change): `startFresh()` empties the panel and keeps it from reopening on the
  newest thread, so the next free question starts a new thread. Explain on a selection always starts one.
- **A read that fails** (404, network) shows a designed failure with Try again and New thread
  (`ThreadReadFailure`), never a blank panel; a 404 is not retried and re-reads the list.
- `buildExchanges` pairs asks and answers and builds each answer's paragraphs (the server's
  `answer_paragraphs` rule), markers, trace rows ("where · cited n×", the paper's words, "not verified" when
  `supported === false`) and coverage.

## On screen

- `components/ExplainPanel.tsx`: the drawer (≥ 768 px) or sheet; its header holds the thread menu, Summarize
  and Close. `components/ThreadView.tsx`: the thread as exchanges (or the summary) above the `Composer`.
- `components/Exchange.tsx`: THE layout of one exchange (frame 13 option 1, the owner's default; owner may
  change): `CallSlip` → `AnswerSlip` (markers inline, marker + tab in the margin, the uncited run under "no
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
  the controller (`useExplainActions`), the summary view and `RichText` (the summary and the canvas cards use
  it); moving those into the feature is the next split.

## Key files

- `model/passages.ts`: passage keys and numbers, handle runs (`[b1, b8]` is two markers). Pure, tested on the
  golden thread (`test/fixtures/attention-thread.json`, frame 04's real stored thread).
- `model/exchange.ts` and `model/answer.ts`: the exchange and answer view models. `model/anchor.ts`: the
  typed selector lookup and display quotes. Pure, tested.
- `model/messages.ts`: the panel's message shape (`ThreadMessage`, the controller's `ViewMessage`), stored →
  panel, and the live + stored merge. Pure, tested.
- `model/threads.ts`: menu order, position, a stored thread's origin, the thread an empty panel opens on.
- `api/threads.ts`: query keys and fetchers. `hooks/useThreads.ts`: the reads, the open-on-newest, the merge.
