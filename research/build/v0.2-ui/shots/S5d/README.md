# S5d shots against `reference/05-notebook-1440.png`

Slice S5d (#209), ink and the lasso on the notebook page, shot at 1440 × 900 on a PRODUCTION build
(`next build` + `next start`) against a copy of the v0.2 demo data. The page is a Dive-in from the
stored answer of thread `thr_01M508X9PC9K9HKHSVB2J9W1A1`, with one typed note; the ink was drawn
through the page's own pen, highlighter and lasso with Playwright's mouse.

- `05-notebook-ink-1440-light.png`, `05-notebook-ink-1440-dark.png`: blue-black pen writing under
  the note and an arrow to the answer, an amber highlighter wash (medium nib) across the note's
  first line, a green pen tick after the coverage line, and the lasso round the note and its
  writing with its menu open ("Lasso selection, 8 items"). Lamp-lit is the "Aa" choice
  (`data-pt-theme="dark"`): the inks re-map to their lamp-lit tokens.
- `05-notebook-ink-1440-vs-reference.png`: frame 05 beside this build at the frame's 1440 × 1140.

## What still differs from frame 05

- **Ink sits under the cards.** The brief puts the ink layer above the page and below the items,
  as S5c's stored ink already was. So the frame's circle round "28.4 BLEU" on quote card 1 and its
  highlight over card 2's words would be hidden under those cards here; ink shows on the page, on
  typed notes (transparent) and round the cards, not on them. Owner's call if ink should go over
  the cards (it is one stacking change).
- **The lasso acts on typed words only.** The frame lassoes quote card 2 with ink and shows every
  action live. Here, because the AI cannot read handwriting and a quote is the paper's voice, Ask
  about this, Make sticky, Send to board and Copy take the typed notes and stickies inside the
  loop; for a card plus ink only Delete (the ink) is offered, and the others say why.
- **Menu placement.** The frame hangs the menu from the loop's left edge. Here a loop in the page's
  right half hangs it from its right edge, so it never runs off the page (as it did in a first shot).
- **Focus ring on Ask about this.** The menu takes the keyboard when it opens; the ring the frame
  draws shows only for keyboard use (`:focus-visible`), not after a pointer lasso.
- **Tool bar.** No crop tool ("Figure crop from the paper" is not in this slice). The lasso icon is
  lucide's `LassoSelect`, not the frame's dashed loop. The colour swatches show the PEN inks
  (amber `#a8650a`, green `#2c7442`, … by day) rather than the frame's pale highlight hues: those
  are what the pen writes, and they hold 3:1 on the page; the highlighter uses the pale washes.
- **Handwriting.** The frame's ink is a script face; here it is sample strokes drawn by a script,
  not words.
- From S5c, unchanged: the page title is the thread's own, the cards sit three to a row, the answer
  is collapsed, the panel has the search box (see `../S5c/DIFFERENCES.md`).

## Ink latency (production build, headless Chromium, 1440 × 900, scripted 200-point strokes)

Probe: `PaperTree-scratch/v02/tmp/s5d/scripts/latency.mjs` (not in the repo; raw output beside it);
the arithmetic is the feature's own `model/latency.ts` (tested), loaded into the page as is. Each pointer sample's `timeStamp` is paired with the frame that
wrote the live path ("written") and the next frame's rAF time ("on screen"); "work" is from the
frame's start to the path written, which is what the draw path itself costs. Two drivers: `page` =
200 PointerEvents dispatched in the page at 240 Hz (random phase against the frame, like a pen);
`cdp` = Playwright's mouse (one move per frame, each landing just after a frame).

| run set (load average, 1 / 5 / 15 min) | driver | written: median / p95 | on screen: median / p95 | work: median / p95 |
| --- | --- | --- | --- | --- |
| 01:16, 11.2 / 18.3 / 19.8 | page ×3 | 8.3–8.9 / 15.8–16.3 ms | 23.2–23.8 / 30.3–31.6 ms | 1.0–2.1 / 2.3–2.7 ms |
| 01:16, 11.2 / 18.3 / 19.8 | cdp ×3 | 14.2–15.2 / 16.5–16.8 ms | 29.4–30.6 / 31.1–32.0 ms | 1.4–1.8 / 2.6–2.8 ms |
| 01:22, 15.9 / 19.4 / 19.9 | page ×3 | 8.0–9.1 / 16.0–16.7 ms | 23.2–24.1 / 30.7–32.0 ms | 1.2–2.2 / 2.3–2.4 ms |
| 01:22, 15.9 / 19.4 / 19.9 | cdp ×3 | 13.9–14.2 / 15.6–16.3 ms | 28.9–29.0 / 30.3–30.7 ms | 1.6–2.1 / 2.5 ms |

Verdict against the 16 ms p95 budget: **PARTIAL.** The draw path's own work is 2.3–2.8 ms p95. From
the pointer event to the path being written is about one frame (p95 15.6–16.7 ms, over 16 in 7 of
12 runs), because the live path is redrawn once per animation frame (RESEARCH-R2 §4): a sample
waits for the next frame. Drawing in the event handler instead would lower that number without
moving a pixel sooner (Chrome paints both in the same frame), so it was not done. Pixels reach the
screen one frame later still (p95 30–32 ms at 60 Hz). The machine was loaded (other agents' gates
and builds; load 11–16).

**NOT MEASURED: a real tablet.** It needs a device pass on an iPad with an Apple Pencil: over HTTPS or
`localhost` (coalesced events need a secure context; a LAN IP over http drops to one sample per
event), at 120 Hz (ProMotion halves the frame wait to ~8 ms), with pressure, palm rejection
(`pointerRole`: a finger after the pen scrolls) and Scribble on, and ideally a high-speed camera for
glass-to-pixel time. ADR-004 §5 keeps lazy-loaded Excalidraw ink as the fallback if the SVG path is
too slow there.
