# split

The split view (#344, v0.3 journey step 7): the paper on the left, the REAL board on the right
("Board beside", key B), a draggable divider between them. `ReaderWorkspace` mounts it; the board's
side of the arrangement is `features/board`'s `BoardHost`.

- `hooks/useBoardBeside.ts`: whether it is open, the card the board is to open on (`arrival`), where
  the divider sits, which side is folded, what is remembered, the B key. While open it sets
  `data-pt-board` and `--pt-board-width` on `<html>`, and the page makes room exactly as for the explain
  drawer (`components/split.css`); the reader's bar keeps the full width. Under 768 px it does not open:
  the full-width board opens instead, on the same card.
- `model/split.ts` (pure): the board's width from a SHARE of the window (so the split survives a resize),
  the minimums (360 paper, 400 board), the divider by key (Left grows the board, Right the paper, Shift
  four times as far, Home/End), the first-branch widening (`widenForBranch`: the paper folds to a
  strip, once per opening, never remembered), and the remembered split (`papertree/split`,
  try/catch).
- `components/BoardBeside.tsx`: the pane, an ARIA window splitter (`role="separator"`, focusable,
  valued), two fold buttons (hide the paper / hide the board, each a 44 px strip with one click to
  restore) and the host it gives the board.
- `model/passageDrag.ts`: the passage a drag from the paper has in the air (set by `SourcePane` on
  `dragstart`, read by the board over the pane and at the drop).

**Sharing the right side.** Explain and the board take the same place: opening one closes the other
(`ReaderActionsMount`). **Esc, one level per press:** the selection (the reader's, which is used up so
the board does not also act on it), then what the board has open (menu, picker, ask box, path focus,
Outline), then the board itself. **Reading mode.** While the board is beside, the reader's own
Source | Guided | Split control drops its "Split" segment (the word is the board's). **The selection
menu** always docks there (`placeToolbar({dockOnly})`).

Tests: `model/split.spec.ts`, `hooks/useBoardBeside.spec.tsx`, `components/BoardBeside.spec.tsx`,
`test/board-beside-mount.spec.tsx` (the wiring), `features/board/hooks/useDropIn.spec.tsx`,
`e2e/v03/split-view.spec.ts` (journey step 7 on the faux agent).
