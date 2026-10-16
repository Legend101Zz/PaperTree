# S4e live explain smoke (#205)

One live explain run, 2026-10-16 20:39 UTC, the build's first live AI spend. Headless Chromium at 390 × 844
(light), the slice's own stack: web 18908 → API 18900 (a copy of the demo data root) → the agent on 18903 started
from this worktree in live mode with a fresh secret shared only with that API (so no other slice's API could reach
it), stopped by its PID right after. One run started and one finished (the agent's log: one `agent.run.start`, one
`agent.run.done`); no retry was needed. Key, secret and headers are not recorded anywhere.

| What | Value |
| --- | --- |
| Paper | "Attention Is All You Need" (`ppr_G9AYN750E5MG1NRBMGSQJ4N5JM`), signed in as the demo account |
| Passage (selected with the mouse) | p. 2 ¶2 (Introduction): "Recurrent models typically factor computation along the symbol positions of the input and output sequences." |
| Question | "Explain this passage." (the selection toolbar's Explain) |
| Model | `MiniMax-M3.1-Flash-Preview`, effort `low` (the explain default, ADR-003); the slip reads "M3.1 Flash · from the paper" |
| Tokens | 4,004 in · 394 out (190 of the input read from cache) = 4,398 |
| Cost | ≈ $0.0017 (estimate): the usage line reads "4,398 tokens · ≈ $0.0017 (estimate)"; the run's `cost_usd_est` 0.0016854, on M3 rates (MiniMax publishes no Flash price) |
| Time to first text | 2.20 s in the page (the Explain click to the first AI words on the slip); the run's `first_text_ms` 2,173 |
| Total | 3.84 s in the page (click to the settled answer); the run's `latency_ms` 3,813 |
| Answer | complete; 4 paragraphs, 4 passages, 9 citations, no uncited paragraph, no unresolved handle; tool calls 0 |
| Phone sheet | opened on the first paragraph with "Read the whole answer"; the pinned footer carried the usage line and To board |

Each marker, tapped in the sheet (`focusAnchor` with the flash), after "Read the whole answer":

| Marker | Handle | Passage (stored locator) | Lexical check | Flashed | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | b1 | p. 2 ¶2, Introduction (the selected passage) | supported | yes, tab "from marker 1 in the answer" | in view, so no scroll: the flash started while the sheet was still lowering to peek (240 ms); measured then, its last lines were still behind the sheet, and visible above it once the sheet settled (`08b-live-marker-flash-390x844-light.png`) |
| 2 | b6 | p. 12, References (entry [32]) | supported | yes, above the sheet | the model cited the bibliography entry for "[32]"; its locator carries no ¶ |
| 3 | b5 | p. 2 ¶4, Introduction | supported | yes, above the sheet | |
| 4 | b4 | p. 2 ¶3, Introduction | no verdict (`supported: null`) | yes, above the sheet | drawn as cited (only `false` is "not verified") |

The live markers' tabs read "p. 2" / "p. 12" without the ¶ during this session: a live citation has no locator until
the thread is read again (S4b, `features/explain/README.md`); the stored copy above has them.
