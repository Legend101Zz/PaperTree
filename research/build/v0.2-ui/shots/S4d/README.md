# S4d shots: streaming, Stop, the daily cap (#204)

Taken 2026-10-16 with headless Chromium (Playwright 1.63, deviceScaleFactor 1, `animations: 'disabled'` so the
caret and the dots are caught on) against the slice's own dev server (web 18908 → API 18900 on a COPY of the
demo data root), signed in as `demo@example.test`, on the REAL stored thread `thr_01M508X9PC9K9HKHSVB2J9W1A1` of
"Attention Is All You Need" (frame 04's thread, picked as Thread 1 in the menu).

**The follow-up's stream is recorded, not live.** The shared faux agent refuses runs from a slice's own API
(`agent_unavailable`), so the page's `fetch` plays the SSE frames of a follow-up for
`POST …/threads/{id}/messages` and holds the stream open: `run`, two `text` chunks whose `[b6]` and `[b1]` are
the thread's passages 2 and 1, then a `status` "Reading the paper". Stop then really aborts that stream and
POSTs the cancel (404 here: the run is not the server's). The daily-cap shot is the same wrapper answering
the next follow-up with the API's 429 `budget_exhausted` envelope; the figures line and today's usage are the
real `GET /usage` of the data copy (≈ $0.00 of $1.00). The live path is covered by `e2e/v02/explain-states.spec.ts`
(faux agent), which this slice may not run.

| File | Frame | What |
| --- | --- | --- |
| `04b-streaming-1440-light.png`, `-dark.png` | 04b | a follow-up streaming: "AI ●●● Reading the paper…" on the tab row, Stop at its right, markers 2 and 1 in the live text with their final tabs (`p. 2 ¶2`, `p. 1 ¶1`), the typed caret after "sequence", the composer's Ask waiting |
| `04c-stopped-1440-light.png`, `-dark.png` | 04c state 1 | after Stop: "Stopped · AI model" on the tab row, the part that arrived kept with its markers, "Stopped. The part that arrived is kept." and Retry on the slip's footer, "Stands on 2 passages · 3 citations · 1 paragraph uncited (the AI's own reading)" and its trace |
| `04c-daily-cap-1440-light.png`, `-dark.png` | 04c state 2 | the refused follow-up: its call slip stamped NOT SENT, the card "Daily spend cap reached", the figures, "Your question was not sent; your text is kept in the box below. …", the note on who sets the cap, "See today's usage", and the question back in the composer |

axe-core 4.12.1 over the whole page (colour contrast ON) in all three states at 1440 × 900 and 390 × 844, light
and dark: **0 serious or critical** (12 runs).

## Remaining differences, and why

1. **Reader chrome and the header** ("Canvas", the zoom select, "Summarize paper" instead of "Summary"): S4c
   (#203) owns the reader chrome; the toggle's words are S4b's.
2. **04b shows the FIRST answer streaming with markers;** here it is a follow-up. A first answer's citations
   arrive just before `done`, so its markers can only appear then; mid-stream, only handles the thread already
   resolved can draw a marker (the brief's rule: never a raw or guessed handle). Live markers for a first
   answer need a per-citation SSE event from the API (GAP-A2 §B5).
3. **No live trace** ("Stands on 2 passages so far · 3 citations", "cited 2× so far", "More passages join as
   the answer cites them."): the trace appears when the answer settles or is stopped, as in S4b.
4. **"Stopped · AI model", no usage line:** a stopped run that reported no usage shows none (unknown is never
   0), and with no `usage` event there is no model name to show. The frame's "2,914 tokens · ≈ $0.0011" shows
   when the stored run carries usage (tested in `s4d-explain-states.spec.tsx`).
5. **The working label says "Writing…" while text flows** and the tool's label only when the model reads
   mid-answer (the shot's last frame is such a `status`).
6. **"Change the daily cap" is left out:** the cap is a server setting with no place in the app (#256); the card
   says who sets it instead of linking nowhere. **"See today's usage"** opens today's runs by kind in place
   (there is no usage page).
7. **The earlier answer is not folded** in the 04c state-2 shot: a thread opens folded only when it has three
   exchanges or more (no such thread in the demo data); the fold is tested in `s4d-explain-states.spec.tsx`.
8. **The thread shows its two earlier exchanges above** (the frame shows one): the shots continue the real
   frame-04 thread.
