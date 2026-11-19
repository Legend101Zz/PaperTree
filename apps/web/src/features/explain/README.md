# explain

Ask → answer in the reader's explain panel (#202, #340, #341, DESIGN.md §3–§4, ADR-004 §2.6). Every exchange is
a call slip (your ask) and an AI slip (the answer). **The AI is a tutor, not an auditor**: there is no
"verified / not verified", no numbered chip or marker, no margin column of page flags, no "Stands on N passages"
readout and no passage list. The agent still writes `[bN]` handles after a claim; the renderer never draws
them, it gathers them per paragraph (`model/answer.sourcesOf`) into ONE quiet line under it:
`From the paper: p. 1 · p. 4` (pages de-duplicated, in page order), or `General knowledge` when no handle of the
paragraph resolved. Each page is a button (`SourceLine` in `@papertree/ui`): hover or focus peeks the passage's
first words, a click runs the reader's citation flash on the cited Anchor. The flash has no margin tab.

## Data flow

UI (`components/ExplainPanel` → `ThreadView` → `Exchange`) → controller (`components/explain/useExplainActions`, a reducer holding the
live messages) + `hooks/useThreads` (react-query) → `api/threads` → `lib/api/threads` →
`GET /papers/{id}/threads` and `GET /papers/{id}/threads/{tid}` (`services/api` `routers/threads.py`) → DB
(`ai_threads`, `ai_messages`, `ai_citations`; each citation's `locator` is derived on read from the parse,
never stored).

- An empty panel opens on the newest stored thread (`opensOnNewest`); the thread menu orders threads by
  `created_at` ascending (`sortThreads`), because the API lists newest first and a follow-up must never
  renumber a thread.
- While an answer streams, the controller's live message is the truth. When it settles, `useThreads` reads
  the thread again and `mergeStored` replaces the live copy with the stored one (usage, times, citations) under
  the same key: no duplicate, no remount.
- **A source line never changes under the reader (#252).** A page appears as soon as its handle resolves:
  mid-stream for a passage the thread already cited (handles are stable across a thread's runs, so
  `ThreadHandles.handleCitations` finds `[b6]` before this answer's own citations arrive, #204), else when the
  answer settles (`done`). "General knowledge" is said only once the answer has settled (`AnswerModel.live`),
  so no paragraph is called general and then given a page. A partial handle at the end of a chunk (`[b`,
  `[b6, b`) is dropped, never shown (`stripPartialTail`). A handle that resolves to nothing is dropped and
  gives no page.
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
  whole and earlier answers folded: two lines and Show (`opensFolded`, read once
  at mount, so nothing folds or gains a toggle under the reader). Retry on a folded answer unfolds it first.
- **The summary as an exchange (#204, frame 04d, #341).** `SummaryExchange`: the call slip "Summary of the whole
  paper" ("cached · 15 Oct" from `created_at`), the bullets on the AI slip, each with its one quiet source line
  (the same `AnswerText`), and the footer's facts ("Cached 15 Oct · no new tokens used · made with M3", or the
  new run's usage) with Summarise again. No readout, no passage list, no "some points could not be linked"
  note. A new run's footer puts its usage last, so the line ends "(estimate)"; Retry after a failed "Summarise
  again" asks for a new run again (`SummaryView.regenerate`). Dive in and Send to board wait for APIs that
  take a summary (#258).
- `buildExchanges` pairs asks and answers and builds each answer's paragraphs (the server's former
  `answer_paragraphs` rule: blank-line split, bare headings dropped), each with its sources.

- **The phone sheet (#205, frame 08b), below 768 px.** The sheet's own header holds "Explain", the thread menu
  ("Thread 1 of 2 ⌄", no step arrows) and Summary beside the ×. Each answer shows its first paragraph and "Read the
  whole answer" (`model/phone.clipAnswer`; one button that becomes Show less, so focus stays on it). It holds while an
  answer streams too: the first paragraph grows in view and the rest arrives behind the button, so nothing the
  reader saw folds away. An answer of one paragraph has no button. Each page of a source line is a button on the
  touch size (`.pt-source__page--touch`: its tap area reaches about 44 px). The last complete answer's usage line
  and To board are pinned above the follow-up box, outside the scroll (`PinnedFooter`, `model/phone.pinnedExchange`),
  so they never cover the answer; earlier answers keep theirs in the scroll. Dive in (S5e, #293) sits before To board
  there, 44 px, through the same one-request `useDiveIn` ("Dive in to answer 2" when the thread has several); the
  footers in the scroll give it 44 px on the phone too. Diagram is not drawn there (#217's plate starts from the
  selection toolbar, not from an answer): never a dead button. A page tap lowers
  the sheet to peek and runs the flash with `bottomInset` = the peek's height, so a passage behind the peek scrolls
  up first; a passage already in view starts flashing while the sheet is still lowering. In a landscape phone
  (max-height 500 px) the sheet opens full height under the header and the pinned footer takes one line.

## On screen

- `components/ExplainPanel.tsx`: the drawer (≥ 768 px) or sheet; its header holds the thread menu, Summarize
  and Close. `components/PinnedFooter.tsx`: the phone sheet's pinned usage line and To board. `components/ThreadView.tsx`: the thread as exchanges (or the summary) above the `Composer`.
- `components/Exchange.tsx`: THE layout of one exchange (frame 13 option 1, the owner's default; owner may
  change): `CallSlip` (stamped "not sent" when refused) → `AnswerSlip` (each paragraph through `AnswerText`, with its source line). One component behind
  `ExchangeProps`.
- A **diagram thread** (#217) is drawn by `features/diagram`: `ThreadView` gives each exchange whose answer
  carries a plate to `DiagramExchange` (plates numbered 1, 2…) and
  draws no composer (a plate is redrawn, never continued).
- **Dive in** (S5e, #210): the answer's footer has Dive in (frame 04's oxblood outline) before Send to
  board, on every complete stored answer; it is the notebook's `useDiveIn` (`features/notebook`), which
  makes the answer's page once and opens it with the Dive-in motion. A sample paper (no server) has no
  Dive in.
- `components/ThreadMenu.tsx`: "‹ Thread 1 of 2 ›" and a listbox of the threads named by their asks, ending in
  "New thread" (owner may change). A switch keeps focus in the menu, never on the drawer.
- The citation flash is the reader's (`components/reader/flash.ts`, `ReaderWorkspace.focusAnchor`, `.pt-flash`),
  in phases: `scroll` (240 ms, only if the passage is off screen; nothing painted) → `flash`
  (`data-flash="true"`: in 180 → hold 900 → out 600) → `linger` (`data-flash="linger"`, a faint outline) until
  the next pointer press or key (capture phase).
- `components/explain` keeps a thin re-export (`index.tsx`, the path `ReaderWorkspace` imports) and still owns
  the controller (`useExplainActions`), and the summary's working and failed states (`SummaryView`); moving those into
  the feature is the next split.

## Key files

- `model/passages.ts`: handle runs (`[b1, b8]` is two handles) and the thread's handle → citation map. Pure.
  The golden thread (`test/fixtures/attention-thread.json`) is frame 04's real stored thread.
- `model/exchange.ts` and `model/answer.ts`: the exchange and answer view models (paragraph → sources). `model/anchor.ts`: the
  typed selector lookup and display quotes. Pure, tested.
- `model/messages.ts`: the panel's message shape (`ThreadMessage`, the controller's `ViewMessage`), stored →
  panel, and the live + stored merge. Pure, tested.
- `model/states.ts`: the Stop note and its no-text rule, "not sent", the daily-cap figures and usage rows, the
  folded answer. Pure, tested (`states.spec.ts`).
- `model/summary.ts`: the summary's view model (one paragraph, with its sources, per bullet). Pure, tested on the real cached summary (`test/fixtures/attention-summary.json`).
- `model/threads.ts`: menu order, position, a stored thread's origin, the thread an empty panel opens on.
- `model/phone.ts`: the phone sheet's first-paragraph clip and which answer the footer pins. Pure, tested
  (`phone.spec.ts`, on the golden thread).
- `api/threads.ts`: query keys and fetchers. `hooks/useThreads.ts`: the reads, the open-on-newest, the merge.
