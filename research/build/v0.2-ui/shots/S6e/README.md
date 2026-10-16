# S6e shots (#215): undo and redo, the 500-card board, the lamp-lit board

Taken on 2026-10-17 on a PRODUCTION build (`next build` + `next start`) of `v02/s6e2-board-scale`, against a
copy of the v0.2 data, at 1440 × 900 (and 390 × 844, touch). The demo Attention board was given S6d's two frames
through the API ("Why attention only" round the AI card and the passage, "Mechanism" round the note). The
500-card board is the demo account's ResNet paper: 500 passage cards, each a real body paragraph of the promoted
parse (99 paragraphs, each used about five times) with the reader's whole-block source anchor
(`papertree_anchoring.capture_anchor`), in GAP-A3 §4.1's 25 × 20 grid at a 300 × 200 pitch, and 167
`supports` threads, all created through the API.

| File | What |
| --- | --- |
| `06-board-1440-light.png`, `09c-board-1440-dark.png` | the demo board after Fit all and one arrow-key move: Undo is on ("Undo move of “Next: read 3.2 on multi-head attention.”"), Redo off |
| `09c-beside-reference.png` | the lamp-lit board beside `reference/09c-board-other.png` |
| `06-board-500-1440-light.png`, `09c-board-500-1440-dark.png` | 500 cards at the first view (the 20 % floor): every card a glance (kind and words) |
| `06-board-500-zoom100-1440-light.png`, `09c-board-500-zoom100-1440-dark.png` | the same board at 106 %: full cards, 25 of 500 in the page |
| `06-board-390-first-*.png` | a phone on the board's saved (desktop) view, as S6d shot it |
| `06-board-390-fit-*.png` | a phone after Fit all (≈ 25 %): an ordinary board stays in full (see below) |
| `06-board-390-more-light.png` | the phone's More after Add note and typing: "Undo edit of an empty note" and Redo (off) are its first two entries (44 px); its Undo then took both steps back |
| `06-board-500-390-*.png` | 500 cards on a phone: 140 glances in the page |

axe (serious or critical; WCAG 2.2 AA tags plus best practice, colour contrast on): **0 on every shot above but
`06-board-390-fit-*`**, at 1440 and 390, daylight and lamp-lit. Before a glance's pins stopped being targets, the
500-card board's 20 % view had 942 `target-size` hits (2.8 px pins); none now.

`06-board-390-fit-*` (an ordinary 3-card board after Fit all on a phone, ≈ 25 %) has 7 `target-size` hits, the
ones S6d recorded and left: the brass pins (3–4 px on screen) and a "more" button whose grown hit area is its
`::after`, which axe does not measure. Unchanged by S6e on purpose: glances on a small board would fix both (a
glance has no in-card buttons and its pins are not targets), but `e2e/s7/w2ui-canvas.spec.ts` holds v0.1's rule
(W2UI #141) that a phone's first view keeps tappable in-card buttons, so glances are limited to boards of 150
cards or more (`bigBoard`). Changing that rule is the owner's call.

## 500 cards, measured

Performance API in the page (rAF frame intervals during each gesture, `PerformanceObserver` long tasks, a
`MutationObserver` for the first card), headless Chromium 1440 × 900, production build, the probe in
`PaperTree-scratch/v02/tmp/s6e/probe/measure500.mjs`. Frame intervals are p50 / p95 / max in ms (16.7 = one
frame at 60 Hz). Pan: 40 mouse moves on the empty board; zoom: 30 wheel steps; drag: one card, 40 moves; Fit all:
the toolbar's. This box was shared and loaded the whole time (the load averages are beside each run).

Two runs each (one "before" run at 106 %: the first one's wheel missed the board); "before" is this branch's first
commit (undo, no scale work), "after" the build these shots came from.

| Run (load 1/5/15 at start) | First card | In the page | Pan | Zoom | Drag one card | Fit all |
| --- | --- | --- | --- | --- | --- | --- |
| before, first view 20 % (19.7 27.7 36.5; 19.4 26.1 35.2) | 937; 1,302 ms | 500 full cards, 11,836 elements | 16.7/83.3/133; 16.7/33.3/117 | 16.7/50/67; 16.7/50/50 | 16.7/16.7/50; 16.7/16.7/117 | 16.7/16.7/67; 16.7/33.3/50 |
| before, at 106 % (19.4 26.5 35.6) | | 500 full cards | 16.7/33.3/83 | 16.7/50/50 | 16.7/16.7/17 | 16.7/33.3/67 |
| **after**, first view 20 % (23.7 25.3 25.5; 27.1 26.1 25.8) | 860; 806 ms | 500 glances, 6,372 elements | 16.7/33.3/100; 16.7/33.3/100 | 16.7/16.7/33; 16.7/16.7/33 | 16.7/16.7/17; 16.7/16.7/33 | 16.7/16.7/67; 16.7/16.7/100 |
| **after**, at 106 % (25.5 25.7 25.6; 27.5 26.1 25.8) | | 30 full cards (25 after the pan) | 16.7/33.3/100; 16.7/50/117 | 16.7/16.7/17; 16.7/16.7/33 | 16.7/16.7/50; 16.7/16.7/17 | 16.7/100/117; 16.7/16.7/117 |

What changed: the wheel zoom went from p95 50 ms to one frame (both views); the first view holds 6,372 elements
instead of 11,836; dragging one card was already one frame at p95 and stays so; pan at the first view went from
p95 33–83 to 33 (two earlier "after" runs of the same scale code read p95 16.7). What got worse: at 106 % a pan
mounts cards as they come into view (p95 33–50), and Fit all from 106 % mounts about 470 glances at once (one
frame of 100–117 ms; 233 ms in one run at load 27–31). A settled 500-card board made **0 requests in 15 s**,
before and after. The first card's time moves with the load (646 to 2,352 ms over six "after" runs), so it is not
a gain to claim. Long tasks during the first load: 2 (324–581 ms in all) before and after.

**The v0.1 baseline (GAP-A3 §4.1)** was measured on `next dev`, load 3.6–9.1, with 500 v0.1 note cards (plain
text, no texture): first card 553 ms, all 500 in the page, wheel zoom 16.7 / 17.7 / 25, mouse pan 17 ms a move. The
v0.2 cards before this slice were heavier (ruled stock, shadows, real paragraphs in Caslon) and zoomed at p95 50
ms; after it the zoom is back at one frame at p95 (max 33) under a load three to six times v0.1's. Pan "ms a move"
here (37–104) is the Playwright round trip under this load, not the page (its frame p50 stays at 16.7), so it is
not compared. Not measured in v0.1 and so not compared: a card drag, the 100 % view, a production build.

NOT CONFIRMED: a real device (a phone, a tablet), a quiet box, a frame rate above 60 Hz.

## The lamp-lit board (09c)

Every colour on the board is a token. The board's own tints were the daylight ones in both schemes; by lamplight
they are now lit with 09c's values (the linen's threads, the index card's red rule and blue ruling, the header's
laid lines, the call slip's ruling: `cards.css`'s dark block). `lamplit.spec.ts` holds the seven thread colours
(line and cue) and the pins to 3:1 on linen and on the cards, and card words, glances, thread tags and the legend to
4.5:1, in both schemes; all pass on the tokens as they are (no token needed a new value).

## Still different from the frames

- Data, not design: the demo board has 3 cards, 1 thread and 2 frames, not 11 / 7 / 2.
- The Undo and Redo icons after Thread are not in frame 06 or 09c (the frames have no undo); they are icons with
  their names kept, and the names say what they take back.
- 09c's linen reads as a fine weave; ours uses its values (`rgb(255 230 190 / 7%)`, 3 px) and reads a little
  fainter in the screenshot, behind the board's own scale.
- The 500-card grid's 40 px gap is narrower than a thread tag, so at 100 % the tag of a short thread hides under
  the next card ("suppor…"): the layout of the seeded data, not of a person's board.
- Fixed after the review: `--pt-call-slip-rule` is lit in `@papertree/ui`'s dark blocks, so call slips by lamplight
  read the same on the board, in the reader and in the notebook (it was lit on the board only).
