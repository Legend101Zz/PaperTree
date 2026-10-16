# board

The linen board (frame 06, lamp-lit 09c): index cards and AI-slip cards that a person sends from
the paper, joined by typed threads. v0.2 slices: S6a (#211, backend), S6b (#212, cards, pins,
threads), S6c (#213, Link as and keyboard linking), S6d (#214, frames, minimap, toolbar, empty
board, the Board wording), S6e (#215, undo and 500 cards).

## The cards

| Wire kind     | Card                                                       | Voices                         |
| ------------- | ---------------------------------------------------------- | ------------------------------ |
| `excerpt`     | passage: page tab from the anchor, hung quote, Open source | paper                          |
| `explanation` | call slip with the question, AI slip with numbered markers | you (the ask), ai (the answer) |
| `note`        | ruled index card in Courier, M stamp, edit in place        | you                            |
| `question`    | call slip alone, "question" tag                            | you                            |
| `notebook`    | miniature of the page's items, counts, Open page           | none (a pointer to a page)     |
| `diagram`     | AI slip with an empty plate and the title until S7 lands   | ai                             |
| `group`       | the v0.1 dashed frame (S6d redraws it)                     | none                           |

Every number a card prints is read from the API: the page tab from `source_anchor`, the notebook
counts from the board read's `counts`, the explanation footer from the message's `coverage` and
`run`. When a read fails the card shows its own words and leaves the number out. A body that does
not fit fades and offers "more", which grows the card in place (GAP-A3 §7).

## Pins and threads

Each card offers the brass port pins of `model/pins.ts`'s `PIN_TABLE` (a copy of the server's;
`pins.spec.ts` reads `papertree_db/canvas.py` and fails when they differ): open circle = evidence
in (left), open diamond = question in (top), brass circle = claim out (right), brass diamond =
answer out (bottom). A thread is dragged from a brass pin (a dashed navy line); every open pin it
can land on lights; a drop the server would refuse shows its sentence ("That pin does not take
that thread.") and saves nothing; a good drop opens "Link as" (below) and the thread is saved with
`from_port` / `to_port`. Pins are named buttons; Enter presses one, which is xyflow's
click-to-connect; Escape or a click on the empty board cancels it. The toolbar's Link takes
its pins from the table (`resolvePorts`) and refuses a pair no pin can hold. A stored thread with
no pins is drawn between the pins the table names, or two hidden fallback handles every card and
frame carries (`edgeHandles`), so no stored thread is ever invisible. The seven threads draw their colour token and the cue `THREAD_LINES`
(`@papertree/ui`) gives each kind, with a paper tag (glyph and words) beside the line; the legend
strip uses the same `ThreadSwatch`.

## Link as, and linking by keyboard (S6c, #213)

`LinkAsPicker` is frame 06's picker: no scrim, it settles in at the thread's midpoint (240 ms,
the settle curve; at once under reduced motion), a header naming both ends (`endName`: a passage by
its page tab, other cards by kind and first words) and the seven kinds in a 4 + 3 grid (two
columns on a phone), each drawn by `ThreadSwatch` with its key. Keys 1–7 choose, Enter or a click
chooses the focused kind, the arrows walk the grid, Tab stays inside it. **Escape keeps a plain
link** (`relates`, "7 = plain link"): v0.1's Escape saved nothing, and that changed on purpose. A
press outside the picker counts as Escape. "Add a label" unfolds the optional label field. Focus
goes back to where the thread started: the source pin after a drag, the card after L, the button
that asked otherwise. Kinds are enabled from the server's pin table (`kindChoices`); that table
limits pins, not kinds, so every pair the server takes offers all seven, and a pair it refuses
offers none, each saying why on focus. The selected-thread bar's Kind button (`ThreadBar`) opens
the same picker on the saved thread; there Escape changes nothing.

Keyboard linking (`useKeyboardLink`; xyflow has none, ADR-004 §2.8) reuses the click-to-connect
state: **L** on a focused card starts a thread from its first brass pin (as does Enter on a brass
pin). Every card that can take it is a target (`linkTargets`, landing on the pin of the same shape
first), walked in reading order (rows of card tops within 96 px, top to bottom, then left to
right) starting at the card nearest the source; Tab, → and ↓ step forward, Shift+Tab, ← and ↑
back, wrapping. Focus follows the highlight (xyflow pans to it), a dashed navy thread
(`ThreadPreview`) shows where it would go, Enter opens the picker, and Escape cancels with nothing
saved and focus back where it started. The board's live region says "Linking from …", "Target: …,
2 of 5" and "Linked as supports."

A numbered marker opens `/paper/<id>/read?focus=<card>&cite=<citation>`; the reader's
`useFocusFromCanvas` reads the citation's anchor from the thread and flashes the passage.

## Data flow

UI (`BoardView`, the cards) → `useBoardController` (local first, then one request per explicit
gesture; a settled board makes no request) → `lib/api/boards` → `routers/boards.py` →
`papertree_db.canvas` (SQLite rows, migration 0008). The cards' extras come from
`useCardSources` → `lib/api/threads` and `api/notebook.ts` (`GET /notebook/pages/{pid}`), read once
per set of cards.

## Key files

- `components/BoardView.tsx`: the page: header, toolbar, the xyflow board, the empty state.
- `components/CardPins.tsx`, `ThreadEdge.tsx`, `ThreadLegend.tsx`: pins, threads, legend;
  `hooks/useThreadDrawing.ts`: drawing a thread (validity, lit pins, refusal, the pending thread).
- `components/LinkAsPicker.tsx`, `LinkAsLayer.tsx` (placement, focus back), `ThreadPreview.tsx`,
  `ThreadBar.tsx`, `linkAs.css`; `hooks/useLinkAs.ts` (which thread, the save, the live region),
  `hooks/useKeyboardLink.ts`; `model/linkAs.ts` (kinds per pin pair, keys, the Escape rule,
  placement, grid moves) and `model/keyboardLink.ts` (targets, reading order, nearest first).
- `model/pins.ts`: the pin table and `canConnect`. `model/threads.ts`: wire kind → design kind,
  the curve between two pins, where the cue marks and the tag go.
- `components/cards/`: one file per card family, `CardShell` (stock, handles, the clip) and
  `index.ts` (`nodeTypes`).
- `hooks/useBoardController.ts`: the only module that writes.
- `hooks/useCardSources.ts`: the thread and notebook reads behind the cards, once per id.
- `model/flow.ts`: wire rows ↔ xyflow nodes and edges, names. `model/cards.ts`: what each card
  shows (pure). `model/clip.ts`: the fade and "more" rule.
- `components/cards.css`, `threads.css`, `legend.css`, `linkAs.css`: the cards, the pins and
  threads, the legend, the picker, from `--pt-*` tokens.

The reader-side helpers (`components/canvas/sendToCanvas.ts`, `toast.tsx`, `duplicate.ts`,
`useFocusFromCanvas.ts`) stay where the reader imports them until the Board wording sweep (S6d).
