# S4b shots: ask → answer → trace in the explain panel (#202)

Taken 2026-10-16 with headless Chromium (Playwright 1.63, deviceScaleFactor 1) against the slice's own dev
server (web 18904 → API 18909 on a COPY of the demo data root), signed in as `demo@example.test`, on the REAL
stored thread `thr_01M508X9PC9K9HKHSVB2J9W1A1` of "Attention Is All You Need" (frame 04's exchange). Steps:
open the panel ("Ask AI"; it opens on the newest of the account's 6 threads), pick Thread 1 in the thread
menu, hover and click marker 2, shoot 700 ms later (inside the flash's 900 ms hold). Compare with
`../../reference/04-reader-explain-1440.png` (1440 × 2240).

| File | What |
| --- | --- |
| `04-explain-1440x900-light.png`, `-dark.png` | the frame's fold: exchange 1, marker 2 lit (navy), trace row 2 lit, passage 2 flashed on p. 2 with "from marker 2 in the answer" in the margin |
| `04-explain-1440x2240-light.png`, `-dark.png` | the full frame height: both exchanges, the trace, the uncited paragraph, the follow-up's markers keeping the thread's numbers (its first marker is 2, p. 2 ¶2) |
| `04-explain-390x844-light.png`, `-dark.png` | the phone sheet (frame 08b is S4e's; shown so the panel is seen not to break) |

axe-core 4.12.1 on the panel (menu open, Thread 1, marker 2 lit) at 1440 and 390, light and dark: **0 serious or
critical** (moderate only: `landmark-no-duplicate-banner` on the phone Sheet, which is `packages/ui`'s).

## What matches frame 04

Panel 640 px at 1440; "Explain | ‹ Thread 1 of N › | … | ×" header; call slip with the quoted selection
(Caslon italic, one line, ellipsis) and its tab `p. 1 ¶1`, the ask in Courier pen ink and the time; the AI slip
under its standing "AI" tab with "M3.1 Flash · from the paper"; markers numbered by passage (b1, b6, b7, b8 →
1–4) inline after each claim, and marker + tab level with each paragraph in the margin (`p. 1 ¶1`, `p. 2 ¶2`,
`p. 2 ¶3`, `p. 2 ¶4`); paragraph 5 under "no citation · the AI's own reading" in italic; usage
`6,776 tokens · ≈ $0.0027 (estimate)`; "Stands on 4 passages · 11 citations · 1 paragraph uncited (the AI's own
reading)"; trace rows with marker, tab, "Abstract · cited 5×" / "Introduction · cited once / 2× / 3×", the
paper's words with the hung quotation mark, Show in paper; the lit row opens its quote to three lines; the
follow-up's call slip has no tab; the flashed passage has the navy ring and the margin tab.

## Remaining differences, and why

1. **Reader chrome** (no "p. 2 of 15", "Canvas" instead of Board / Explain tab, zoom select plus "Fit width",
   the v0.1 floating "Ask AI" launcher, the v0.1 selection toolbar): S4c (#203) owns the reader chrome.
2. **"Summarize paper"** in the header where the design says "Summary": kept the v0.1 name because the summary
   specs and e2e use it; the summary as an exchange is S4d (#204).
3. **Stamp "D"** (the signed-in account's initial, demo@…) where the design shows the owner's "M"; and the
   stamp sits inside the slip (S1c's `CallSlip`) where the design has a left gutter with M / ◇ / ¶ icons.
4. **Time 22:44**: the stored 17:14 UTC in the reader's zone (IST); the design's 21:14 is sample.
5. **No "· first text after 2.4 s"** in the usage line: `run.first_text_ms` counts the model's first delta of
   any kind, which can be thinking (GAP-A2 Risk 7); left for S4d to label honestly rather than mislabel.
6. **Actions under the answer**: only "Send to canvas". Dive in is the notebook (S5e), Explain with a diagram
   is S7b, and the board rename is not this slice's.
7. **The second exchange is complete**, not streaming with Stop on the AI tab row: the stored thread is
   complete; streaming placement and the caret are S4d.
8. **Composer** (no M stamp, sans placeholder, the v0.1 Ask button): S4d / 04c.
9. **Flash wash** is `--pt-lit-wash` (18 %) where the mock uses 22 %, and the mock's outer 7 px halo is not drawn
   (the flash is an SVG polygon over the PDF page; a halo would need a second stroked polygon).
10. **Margin sidenotes are per paragraph** (S1c's `AiParagraph` cell, level with the paragraph's first line),
    where the mock floats each one level with its own claim line.
11. **Trace markers are 16 px** (S1c's compact `NumberedMarker`); the mock draws 20 px squares in the trace.
12. **The margin tab has its own paper backing** so it reads on the white PDF page in both schemes (the dark
    scheme keeps the PDF page white until S4e's lamp-lit page); the mock draws it bare on the page margin.
13. **"Thread 1 of 6"**: the demo account has six threads (the audit's faux ones); the design's "1 of 2" is
    sample.
14. **Page position**: the passage was already in view, so the flash did not scroll (scroll only if needed);
    the frame shows p. 2 at the top.
15. **Dark scheme**: the PDF page stays white (lamp-lit page is S4e, #205).
