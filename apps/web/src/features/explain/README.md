# explain

Ask → answer → trace in the reader's explain panel (#202, DESIGN.md §3–§4, ADR-004 §2.6). Every exchange is
a call slip (your ask), an AI slip (the answer, a numbered marker after each claim) and a numbered trace of
the passages it stands on, under a coverage line. A marker's number is its **passage** number: passages are
numbered 1..k in the order the thread first cites them, so marker 2 is the same passage in the answer, its
trace row and every later exchange of the thread.

## Data flow

UI (`components/explain` panel) → controller (`components/explain/useExplainActions`, a reducer holding the
live messages) + `hooks/useThreads` (react-query) → `api/threads` → `lib/api/threads` →
`GET /papers/{id}/threads` and `GET /papers/{id}/threads/{tid}` (`services/api` `routers/threads.py`) → DB
(`ai_threads`, `ai_messages`, `ai_citations`; each citation's `locator` and each answer's `coverage` are
derived on read from the parse, never stored).

- An empty panel opens on the newest stored thread (`opensOnNewest`); the thread menu orders threads by
  `created_at` ascending (`sortThreads`), because the API lists newest first and a follow-up must never
  renumber a thread.
- While an answer streams, the controller's live message is the truth. When it settles, `useThreads` reads
  the thread again and `mergeStored` replaces the live copy with the stored one (locators, coverage) under
  the same key: no duplicate, no remount. A live citation has no locator yet; its handle finds its passage
  through the thread's other citations, so numbers never shift.
- `buildExchanges` pairs asks and answers and builds each answer's paragraphs (the server's
  `answer_paragraphs` rule), markers, trace rows ("where · cited n×", the paper's words, "not verified" when
  `supported === false`) and coverage.

## Key files

- `model/passages.ts`: passage keys and numbers, handle runs (`[b1, b8]` is two markers). Pure, tested on the
  golden thread (`test/fixtures/attention-thread.json`, frame 04's real stored thread).
- `model/exchange.ts`: the exchange view model. Pure, tested.
- `model/messages.ts`: the panel's message shape (`ThreadMessage`, the controller's `ViewMessage`), stored →
  panel, and the live + stored merge. Pure, tested.
- `model/threads.ts`: menu order, position, a stored thread's origin, the thread an empty panel opens on.
- `api/threads.ts`: query keys and fetchers. `hooks/useThreads.ts`: the reads, the open-on-newest, the merge.
