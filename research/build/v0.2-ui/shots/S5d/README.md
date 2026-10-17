# S5d shots against `reference/05-notebook-1440.png`

Slice S5d (#209), ink and the lasso on the notebook page, shot at 1440 × 900 on a PRODUCTION build
(`next build` + `next start`) against a copy of the v0.2 demo data. The page is a Dive-in from the
stored answer of thread `thr_01M508X9PC9K9HKHSVB2J9W1A1`, with one typed note; the ink was drawn
through the page's own pen, highlighter and lasso with Playwright's mouse.

- `05-notebook-ink-1440-light.png`, `05-notebook-ink-1440-dark.png`: blue-black pen writing under
  the note and an arrow to the answer, an amber highlighter wash (medium nib) across the note's
  first line, a green pen tick after the coverage line, and the lasso round the note and its
  writing with its menu open (its name now counts by kind: "Lasso selection: 1 note, 7 strokes").
  Lamp-lit is the "Aa" choice (`data-pt-theme="dark"`): the inks re-map to their lamp-lit tokens.
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
  On a phone (600 px and below) the page is wider than the screen, so the menu sits at the foot of
  the screen instead, wrapping its five actions; the phone's own notebook layout is S5e's.
- **Ink beside the open answer.** The frame's answer is open with ink in its margin. Here a stroke
  belongs to the layer it starts in, and the band the open answer pushed open has no stored place,
  so a stroke cannot START there (not-allowed cursor, and a note says why); it can pass through it.
  Ink begun beside the answer's first lines (above its stored box) stays put either way.
- **Ask about this.** The words reach the reader through this tab's storage, not the URL, and land
  in S4d's question box as its draft with the keyboard at their end; a note beside the panel says
  why they are in the question (the ask API takes passages of the paper, not notebook text).
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

Probe: `apps/web/scripts/ink-latency.mjs` (run it with `--web`, `--token` and `--page`; its header
says what it does and does not measure). The arithmetic is the feature's own `model/latency.ts`
(tested), loaded into the page as is. The first two run sets below were taken with the same code
from a scratch copy before it was committed; the third with the committed script.

What the columns measure, exactly:

- **written**: from a pointer sample's `timeStamp` to the moment the live path's `d` attribute is
  set (seen by a MutationObserver). The path is rewritten once per animation frame, so this is about
  one frame.
- **script work**: from the frame's start (its rAF time) to that write. JavaScript only: it ends
  before style, layout, paint and raster of the page's SVG, so it is NOT the whole cost of drawing a
  frame; a performance trace would include the rest.
- **next frame (proxy)**: the next rAF timestamp after the write. Headless Chromium has no display
  and no vsync, so this is a proxy for "on screen", not a glass-to-pixel measurement.
- Drivers: `cdp` is Playwright's mouse (trusted input through the browser's input pipeline; it
  sends one move per frame, so each lands just after a frame and waits a whole one). `page`
  dispatches untrusted `PointerEvent`s from a timer on the main thread at 240 Hz: no real coalescing
  and no input-to-main-thread delay, so its `written` numbers are optimistic. Read `cdp` first.

| run set (load average, 1 / 5 / 15 min) | driver | written: median / p95 | next frame (proxy): median / p95 | script work: median / p95 |
| --- | --- | --- | --- | --- |
| 01:16, 11.2 / 18.3 / 19.8 | cdp ×3 | 14.2–15.2 / 16.5–16.8 ms | 29.4–30.6 / 31.1–32.0 ms | 1.4–1.8 / 2.6–2.8 ms |
| 01:16, 11.2 / 18.3 / 19.8 | page ×3 | 8.3–8.9 / 15.8–16.3 ms | 23.2–23.8 / 30.3–31.6 ms | 1.0–2.1 / 2.3–2.7 ms |
| 01:22, 15.9 / 19.4 / 19.9 | cdp ×3 | 13.9–14.2 / 15.6–16.3 ms | 28.9–29.0 / 30.3–30.7 ms | 1.6–2.1 / 2.5 ms |
| 01:22, 15.9 / 19.4 / 19.9 | page ×3 | 8.0–9.1 / 16.0–16.7 ms | 23.2–24.1 / 30.7–32.0 ms | 1.2–2.2 / 2.3–2.4 ms |
| 02:45, 80.9 / 59.0 / 51.5 (committed probe, after the review fixes) | cdp ×3 | 13.2–14.1 / 15.7–16.1 ms | 28.1–29.0 / 30.3–30.8 ms | 1.4–2.2 / 2.5–2.6 ms |
| 02:45, 80.9 / 59.0 / 51.5 (committed probe, after the review fixes) | page ×3 | 7.8–8.5 / 16.1–16.5 ms | 23.1–24.4 / 31.2–31.8 ms | 1.0–1.5 / 2.4–2.5 ms |

Verdict against the 16 ms p95 budget: **PARTIAL.** The script work per frame is 2.3–2.8 ms p95,
but that leaves out style, layout and paint, so the draw path's whole cost is NOT measured here.
From a pointer sample to the path being written is about one frame (p95 15.6–16.7 ms, over 16 in
11 of 18 runs), because the live path is redrawn once per animation frame (RESEARCH-R2 §4): a sample
waits for the next frame. Drawing in the event handler instead would lower that number without
moving a pixel sooner (Chrome paints both in the same frame), so it was not done. The next frame
comes one frame later still (p95 30–32 ms at 60 Hz), and that is a proxy for the screen, not the
screen. The machine was loaded throughout (other agents' gates and builds; load 11 to 81).

**NOT MEASURED: a real tablet.** It needs a device pass on an iPad with an Apple Pencil: over HTTPS or
`localhost` (coalesced events need a secure context; a LAN IP over http drops to one sample per
event), at 120 Hz (ProMotion halves the frame wait to ~8 ms), with pressure, palm rejection (a
finger after the pen scrolls; while the pen is down a finger does nothing) and Scribble on, a
performance trace for style, layout and paint, and ideally a high-speed camera for glass-to-pixel
time. ADR-004 §5 keeps lazy-loaded Excalidraw ink as the fallback if the SVG path is too slow there.
