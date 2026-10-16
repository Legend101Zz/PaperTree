# S6c shots (#213): "Link as" and linking by keyboard

Taken on 2026-10-17 at 1440 × 900 (and 390 × 844) against the demo Attention board on a copy of the
v0.2 data (S6b's seeded cards and seven threads), beside `reference/06-board-1440.png` (daylight)
and `reference/09c-board-other.png` (lamp-lit). The picker is opened the way frame 06 shows it: a
thread dragged from the diagram's brass pin to the evidence pin of Passage p. 1.

| File                                          | What                                                         |
| --------------------------------------------- | ------------------------------------------------------------ |
| `06-link-as-1440-light.png`, `-dark.png`      | the picker at the thread's midpoint, the dashed thread under |
| `06-link-as-390-light.png`, `-dark.png`       | the phone: two columns, opened from the keyboard (L, Enter)  |
| `06-keyboard-target-1440-light.png`           | L on a note: the highlighted target, its ring, the thread    |
| `06-change-kind-1440-light.png`               | the selected thread's Kind button opens the same picker      |

axe (serious or critical) with the picker open: 0 at 1440 and 390, daylight and lamp-lit, and 0 at
1440 in both schemes while a keyboard target is highlighted. Motion: `pt-linkas-settle` 0.24 s on
the settle curve; `none` under `prefers-reduced-motion: reduce` (computed style, Chromium).

## Departures from the frame, on purpose

- **"1–7 · Esc = plain link"**, not "1–7 · Esc cancels". #213 and DESIGN.md §3.9 say Escape leaves
  a plain link, so the hint says what the key does. When the picker changes a saved thread's kind,
  it reads "Esc = no change".
- **"Add a label"** under the grid: v0.1's optional label, folded so it is never between a person
  and a key. The frame has no label field.
- The picker sits centred on the thread's midpoint, kept 16 px inside the board; in frame 06 the
  composition puts it at the lower left.

## Still different from the frame

- Header, toolbar ("Thread (L)"), frames with paper tags, minimap: v0.1 until S6d (#214). The L key
  works on a focused card today; the toolbar button that names it is S6d's.
- The header reads "Passage p. 1", not "Passage p. 1 ¶1": an anchor carries no paragraph (S6b's
  note; the paragraph is a server-side locator).
- The waiting thread is drawn in the focus token (`--pt-focus`), as S6b's drag line is; the mock-up
  draws it in the pen navy (`#1E2A4A`).
- The option swatches are `ThreadSwatch` at 128 px, so their marks follow the board's own threads
  (`THREAD_LINES`): fewer crosses on "contradicts" than the mock-up's six.
