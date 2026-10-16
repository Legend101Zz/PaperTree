# S6d shots (#214): header, toolbar, frames, minimap, the empty board

Taken on 2026-10-17 at 1440 × 900 (and 390 × 844) on a copy of the v0.2 data, beside
`reference/06-board-1440.png`, `06b-board-empty-1440.png` (daylight) and `09c-board-other.png`
(lamp-lit). The demo Attention board's three cards and one thread were given two frames through the
API ("Why attention only" round the AI card and the passage, "Mechanism" round the note); the DDPM
paper has no board (06b). Board shots are after Fit all.

| File                                                   | What                                                      |
| ------------------------------------------------------ | --------------------------------------------------------- |
| `06-board-1440-light.png`, `-dark.png`                 | header with counts, toolbar, two frames, minimap, legend  |
| `06-board-1440-more-light.png`                         | "More board tools": v0.1's Group, Ungroup and Delete      |
| `06b-board-empty-1440-light.png`, `-dark.png`          | the empty board                                           |
| `06-board-390-light.png`, `-dark.png`                  | the phone: one row (arrow, "Board", five tools), Map      |
| `06-board-390-more-light.png`                          | the phone's More: Select and the zoom joined the menu     |
| `06b-board-empty-390-light.png`, `-dark.png`           | the empty board on a phone                                |

axe (serious or critical, WCAG 2.2 AA tags plus best practice, colour contrast on): 0 on every shot
above (1440 and 390, daylight and lamp-lit, the menu open). The Add frame → drop a card in → move
the frame by its tag walk was driven in Chromium on this stack: the frame opened centred with its
name selected, the dropped note was saved with the frame's `group_id`, and moving the frame moved
the note by the same distance (`e2e/v02/board-chrome.spec.ts` asserts the same).

## Departures from the frames, on purpose

- **The zoom readout is live**: "89%" after Fit all, and "Map · 89%"; the − and + turn off at
  20 % and 200 %. On 06b the mock-up shows "100%" without − and +; the board keeps them.
- **"More board tools" (⋯)** after the zoom: the frames have no place for v0.1's Group, Ungroup and
  Delete, and #214 keeps them within reach ("Frame selected cards", "Remove frame", "Delete").
- **Thread (L) is off until a card is selected** (it says why on hover and stays focusable); with
  one card it starts the keyboard walk from its brass pin (as L does), with two it links them.
- **A frame's tag paints under a card that overlaps it**: frames sit below every card (S6b's
  rule), so a card dragged over a tag hides it until it is moved off.
- **Under 1100 px the tools are icons** (names kept); on a phone Select and the zoom live in More
  and the minimap folds behind a "Map" button at the top right, clear of the legend and the toast.

## Still different from the frames

- Data, not design: the demo board has 3 cards, 1 thread and 2 frames, not 11 / 7 / 2, so the
  count line, the minimap's blocks and the frames' contents differ; the Thread tool is shown at
  rest, not pressed mid-thread.
- The minimap is xyflow's: its view box hugs the visible area with xyflow's padding (the mock-up
  draws a fixed inset box); blocks keep the cards' real proportions; xyflow's "React Flow"
  attribution sits under it.
- The lamp-lit minimap ground is mixed from the tokens (`linen` 94 % + `ink`), a shade lighter than
  the mock-up's `#2A231D`; every edge on it is checked at 3:1 (`pins-contrast.spec.ts`).
- The empty card's sprout is the shared `SproutMark` at 48 (its stroke is heavier than the mock-up's
  hairline), and its shadow is the `e2` token rather than the mock-up's blurred shadow layer.
- On a phone the demo board opens on its saved (desktop) viewport, so cards run off the right edge;
  the issue's "readable phone first open" is not in this slice (see the summary).
- After Fit all on a phone (zoom ≈ 0.35) axe reports `target-size` on in-card pins and buttons: the
  cards' hit areas are their `::after` rings, which axe does not measure, and pins stop growing at
  50 % zoom (S6b). Unchanged by this slice; not counted in the 0 above, which is at first open.
