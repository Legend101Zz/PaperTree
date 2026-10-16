# S4d shots: streaming, Stop, the daily cap, the summary as an exchange (#204)

Taken 2026-10-16, re-taken 2026-10-17 after the review fixes and the rebase onto S4c's reader chrome, with headless Chromium (Playwright 1.63, deviceScaleFactor 1, `animations: 'disabled'` so the
caret and the dots are caught on) against the slice's own dev server (web 18908 → API 18900 on a COPY of the
demo data root), signed in as `demo@example.test`, on the REAL stored thread `thr_01M508X9PC9K9HKHSVB2J9W1A1` of
"Attention Is All You Need" (frame 04's thread, picked as Thread 1 in the menu).

**The follow-up's stream is recorded, not live.** The shared faux agent refuses runs from a slice's own API
(`agent_unavailable`), so the page's `fetch` plays the SSE frames of a follow-up for
`POST …/threads/{id}/messages` and holds the stream open: `run`, two `text` chunks whose `[b6]` and `[b1]` are
the thread's passages 2 and 1, then a `status` "Reading the paper". Stop then really aborts that stream and
POSTs the cancel (404 here: the run is not the server's); the same wrapper then answers the thread's
stored re-read with what a real cancel persists (the asked question and the `aborted` answer with the
citations minted for what arrived), so the stopped answer settles as it does live. The daily-cap shot is the same wrapper answering
the next follow-up with the API's 429 `budget_exhausted` envelope; the figures line and today's usage are the
real `GET /usage` of the data copy (≈ $0.00 of $1.00). The live path is covered by `e2e/v02/explain-states.spec.ts`
(faux agent), which this slice may not run.

| File | Frame | What |
| --- | --- | --- |
| `04b-streaming-1440-light.png`, `-dark.png` | 04b | a follow-up streaming: "AI ●●● Reading the paper…" on the tab row, Stop at its right, markers 2 and 1 in the live text with their final tabs (`p. 2 ¶2`, `p. 1 ¶1`), the typed caret after "sequence", the composer's Ask waiting |
| `04b-long-answer-sticky-stop-1440-light.png` | 04b | a long streaming answer scrolled to its end: Stop stays in view at the top of the panel (its row is sticky). Measured at 1440 and 390, both schemes: Stop inside the scroll box in all 4 |
| `04c-stopped-1440-light.png`, `-dark.png` | 04c state 1 | after Stop and the stored re-read: "Stopped · M3.1 Flash" on the tab row, the part that arrived kept with its markers, "Stopped. The part that arrived is kept." and Retry on the slip's footer, "Stands on 2 passages · 3 citations · 1 paragraph uncited (the AI's own reading)" and its trace |
| `04d-summary-1440-light.png`, `-dark.png`, `04d-summary-1440x1920-*.png` (the frame's height) | 04d | the REAL cached summary (`GET /papers/{id}/summary`, no run) on a new thread: header "Summary [cached]", the call slip "Summary of the whole paper" with "cached · 15 Oct", "M3 · from the paper", 8 bullets with numbered markers 1–7 and margin tabs, dashed "not verified" tabs on the 3 unsupported bullets, "Cached 15 Oct · no new tokens used · made with M3", Summarise again, "Stands on 7 passages on 6 pages · 8 bullets · 11 citations · 3 bullets not verified" and the trace by page ("Abstract · cited 4× · 1 not verified", "5.1 Training Data and Batching · cited once", …) |
| `04d-summary-with-thread-1-1440-light.png`, `-dark.png` | 04d | the same summary with Thread 1 open: the Abstract keeps the thread's number 1, the new passages continue at 5–10 |
| `04c-daily-cap-1440-light.png`, `-dark.png` | 04c state 2 | the refused follow-up: its call slip stamped NOT SENT, the card "Daily spend cap reached", the figures, "Your question was not sent; your text is kept in the box below. …", the note on who sets the cap, "See today's usage", and the question back in the composer |

axe-core 4.12.1 over the whole page (colour contrast ON) in all five states (04b, 04c ×2, 04d ×2) at 1440 × 900
and 390 × 844, light and dark: **0 serious or critical** (20 runs, re-run on the rebased branches).

## Remaining differences, and why

1. **"Summarize paper" instead of "Summary"** in the panel header: the toggle's words are S4b's.
2. **04b shows the FIRST answer streaming with markers;** here it is a follow-up. A first answer's citations
   arrive just before `done`, so its markers can only appear then; mid-stream, only handles the thread already
   resolved can draw a marker (the brief's rule: never a raw or guessed handle). Live markers for a first
   answer need a per-citation SSE event from the API (GAP-A2 §B5).
3. **No live trace** ("Stands on 2 passages so far · 3 citations", "cited 2× so far", "More passages join as
   the answer cites them."): the trace appears when the answer settles or is stopped, as in S4b.
4. **No usage line after Stop:** a stopped run that reported no usage shows none (unknown is never 0). The
   frame's "2,914 tokens · ≈ $0.0011" shows when the stored run carries usage (tested in
   `s4d-explain-states.spec.tsx`).
5. **The working label says "Starting…" before a word arrives, "Writing…" while text flows,** and the tool's
   label only when the model reads mid-answer (the shot's last frame is such a `status`).
6. **"Change the daily cap" is left out:** the cap is a server setting with no place in the app (#256); the card
   says who sets it instead of linking nowhere. **"See today's usage"** opens today's runs by kind in place
   (there is no usage page).
7. **The earlier answer is not folded** in the 04c state-2 shot: a thread opens folded only when it has three
   exchanges or more (no such thread in the demo data); the fold is tested in `s4d-explain-states.spec.tsx`.
8. **The thread shows its two earlier exchanges above** (the frame shows one): the shots continue the real
   frame-04 thread.
9. **04d: 11 citations and 7 passages, not 10 and 6.** The frame's trace has one row per page and merged the
   two Conclusion blocks of p. 10 that the last bullet cites; here passages are blocks, as in the thread (so
   the same passage keeps the same number on both surfaces). The rule is the frame's (a citation = one bullet
   citing one passage, twice in one bullet counts once), and the readout says "7 passages on 6 pages".
10. **04d: no Dive in, no Send to board** (#258: their APIs take a message, not a summary). **No ¶ on the
    summary's tabs and the section names are the anchor's** ("Decoder:", where the frame says "3.1 Encoder and
    Decoder Stacks"): summary citations carry no locator (#257).
11. **04d: the bullet dot is the AI face's small "•"**, lighter than the frame's disc; the composer reads "Ask a
    follow-up …" (the frame: "Ask anything about the paper").
