# S7b shots (#217): the engraved plate

Taken at 1440 × 900 (and 390 × 844) on a copy of the demo data root, "Attention Is All You Need", §3.2.1 ¶1 selected
with the mouse on p. 4, beside `reference/07a`–`07d`. The 07a and 07b states are the recorded faux frames
(`apps/web/test/fixtures/diagram-plate.sse`) fed to the real panel one at a time, because the faux agent draws a whole
plate in ~0.2 s; 07c and the board are the faux agent's `[faux:diagram]` run end to end; the live plate is
[`live-smoke.md`](live-smoke.md).

| File | What |
| --- | --- |
| `07a-1440-light.png`, `-dark.png` | the ask, the dashed empty Plate 1, Thinking…, Stop |
| `07b-1440-light.png`, `-dark.png` | three parts placed, D arriving, "3 parts so far · 3 cited" |
| `07b-stopped-1440-light.png`, `-dark.png` | Stop at three parts: frozen, "Stopped. The parts that arrived are kept.", Redraw |
| `07a-stopped-empty-1440-light.png`, `-dark.png` | a keyboard Stop while "Thinking…": "Stopped before any part arrived.", focus on Retry, no plate |
| `07c-1440-light.png`, `-dark.png` | the finished faux plate: six parts, F inferred, the readout, the usage line |
| `07c-flash-C-1440-light.png`, `-dark.png` | part C tapped: its passage flashes, the margin tab says "from part C, Scale ÷ √dk" |
| `07c-sent-1440-light.png` | Send to board done ("On your board", the toast) |
| `07d-offer-1440-light.png`, `-dark.png`, `07d-offer-390-light.png` | the 07d offer as information only, with Not now |
| `07c-390-light.png` | the phone sheet: the drawing above its key |
| `06-board-plate-1440-light.png`, `06-board-plate-card-1440-light.png`, `-dark.png` | the board's diagram card: the stored plate drawn small, title, "6 parts · 5 cited" |
| `07c-live-as-run-1440-light.png` | the live plate (M3.1 Flash) at the end of the run |
| `07c-live-1440-light.png`, `-dark.png`, `07c-live-flash-F-1440-light.png` | the same stored plate re-opened with the label fitting (no new run); taken before the review round, so the old Stop and single dot |
| `compare-07a-light.png` … `compare-07d-light.png` | each frame (left) beside the build (right) |

axe (in the browser, axe-core 4.10, whole page): **0 serious, 0 critical** at 1440 and 390, daylight and lamp-lit,
on the drawing plate (07b) and the finished plate after a flash and an inferred tap (07c), on both branches after the
review round (rebased on S4d). What remains is moderate and not this slice's: `region` on pdf.js's hidden canvas (every
width), and at 390 `landmark-no-duplicate-banner` / `landmark-unique` on the reader bar.

The review round (on S4d's explain panel) changed what these shots show: S4d's three-dot working label and its sticky
32 px Stop on the tab row; a Stop before any part draws no plate and says so; a not-verified part is dotted with a
caption and a dashed (or "?") marker; the call slip's tab reads "p. 4 ¶1" from the plate's parts; the 07d card says a
crafted figure "may come later".

## Remaining differences from 07a–07d

**From the data, on purpose (honest, not fixable in the UI):**

- 07b: the part still arriving shows its letter and "arriving…" but no label: the API sends a part only when its line
  is complete (raw lines are not forwarded), so the frame's "Softmax arriving…" cannot be known. No dashed arrow into it
  either (its `after` is unknown until it lands).
- 07c: the flash marks the whole paragraph, not the quoted words ("divide each by √d_k" in the frame): part Anchors
  are block Anchors (#123, whole-block anchors only). Five parts on one paragraph flash the same paragraph.
- 07c: one passage per part. The frame's part C has a second entry ("why scale?", passage 2); the contract has one
  `cite` per part.
- 07c: the frame draws part A as three symbol boxes (Q, K, V); the build draws one box per part with its label.
- 07c: the faux plate's F is inferred, so the faux readout is "6 parts · 5 cited"; the frame shows the inferred part
  as a separate "second state". The live plate reads "6 parts · 6 cited · drawn by AI from p. 4".
- 07c: "Add to notebook" is left out: a notebook page holds no diagram item (#276). The faux shots' model line reads
  "M3" (the faux model reports MiniMax-M3); the live one reads "M3.1 Flash".
- 07d: information only. No "Queue the job" button and no Queued / Ready states (the crafted-figure job is out of
  scope), so the card says a crafted figure "may come later" and is not available yet; it shows under the first
  finished plate of a thread (there is no list of "well-known ideas" to offer it for) until Not now, remembered for
  that plate.

**Layout and chrome (other slices' decisions, or small):**

- The explain drawer is 640 px at 1440 (S4b), the frame's 800: the drawing is on a 300-unit grid (boxes 150 wide, the
  frame's 156) and the key column is narrower, so long labels go to two lines at 13 px or are cut with "…" (the key keeps
  every word) and some key rows put the marker and tab on a second line.
- Panel header: "Thread n of n", "Summarize paper" (S4b), not "Summary". In the faux shots the call slip reads
  "[faux:diagram] Explain with a diagram." once the stored copy lands: that is the dev scenario tag the shots add to the
  request; the live run's slip reads "Explain with a diagram.".
- A lane label is cut to the room before the next lane at its height, or left out of the drawing when not even three
  letters fit (the key always says it: "Arrows in from D and A (V).").
- The board card's miniature is the plate's own grid drawn small (boxes, hatching, arrows, letters, no labels), in a
  150 px frame; the frame's card shows a wider, freer sketch.
- At 390 the plate stacks the drawing above its key (a container query below 520 px).
